import crypto from "node:crypto";
import * as XLSX from "xlsx";
import { db, userRepo, orgRepo, gstinRepo, sessionRepo, salesRepo, purchaseRepo, reconciliationRepo } from "./db.js";
import { validatePan, validateGstin } from "./validate.js";
import { toPaise, fromPaise, percentOfPaise } from "./moneyPaise.js";
import { computeRule88aSetoff } from "./rule88aEngine.js";
import { classifySalesRegisterForGstr1 } from "./gstr1StatutoryClassifier.js";
import { runReconciliation } from "./reconciliationEngine.js";
import { getStatutoryDueDates } from "./dueDateEngine.js";
import { maskPan, maskGstin, getPartnerByUserId } from "./partnerEngine.js";

export const CA_CATEGORIES = [
  "Chartered Accountant",
  "GST Practitioner",
  "Tax Consultant",
  "Accountant",
  "Accounting Firm",
  "GST Agent"
];

export const CA_STAFF_ROLES = [
  "CA Firm Owner",
  "Senior Accountant",
  "Accountant",
  "GST Executive",
  "Reviewer"
];

export const CA_TRAINING_MODULES = [
  { id: "catrn-1", title: "GST Basics & Statutory Framework", category: "GST", duration: "12 min", summary: "CGST, SGST, IGST, place of supply, and composition vs regular schemes." },
  { id: "catrn-2", title: "GSTR-1 Preparation Guide", category: "Filing", duration: "14 min", summary: "B2B, B2CL, B2CS, exports, credit/debit notes, and invoice validation." },
  { id: "catrn-3", title: "GSTR-3B & Rule 88A Guide", category: "Filing", duration: "16 min", summary: "Cross-utilization order, RCM cash tax, and electronic ledger offsets." },
  { id: "catrn-4", title: "GSTR-2B Reconciliation & ITC Guide", category: "Reconciliation", duration: "18 min", summary: "Matched vs mismatched ITC, Section 17(5) blocked credit, and Rule 37 180-day aging." },
  { id: "catrn-5", title: "Invoice OCR Review Guide", category: "Documents", duration: "10 min", summary: "Verify extracted HSN, taxable value, CGST/SGST/IGST, and prevent duplicates." },
  { id: "catrn-6", title: "Filing Approval Workflow", category: "Compliance", duration: "9 min", summary: "Maker-checker review, customer approval sign-off, and audit trail." },
  { id: "catrn-7", title: "Customer Onboarding & Bulk Import", category: "Onboarding", duration: "11 min", summary: "Invite existing SimpleGST users, bulk CSV/XLSX import, and consent rules." }
];

function validateStrongPassword(pwd) {
  const p = String(pwd || "");
  if (p.length < 8) return "Password must be at least 8 characters.";
  if (!/[A-Z]/.test(p)) return "Password must contain at least one uppercase letter.";
  if (!/[a-z]/.test(p)) return "Password must contain at least one lowercase letter.";
  if (!/[0-9]/.test(p)) return "Password must contain at least one digit.";
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(p)) return "Password must contain at least one special character.";
  return null;
}

export function logCaActivity(caId, actorUserId, action, details = {}) {
  db.prepare(`
    INSERT INTO ca_activity_logs (id, ca_id, actor_user_id, action, details_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(`caact-${crypto.randomUUID()}`, caId, actorUserId || null, action, JSON.stringify(details));
}

export function notifyCa(caId, { category, title, message, relatedCustomerId = null, relatedGstin = null, linkTab = null }) {
  db.prepare(`
    INSERT INTO ca_notifications (id, ca_id, category, title, message, related_customer_id, related_gstin, link_tab)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(`canot-${crypto.randomUUID()}`, caId, category, title, message, relatedCustomerId, relatedGstin, linkTab);
}

export function resolveCaActor(context, { allowPending = false } = {}) {
  if (!context?.authenticated || !context.user) {
    return { ok: false, status: 401, error: "Authentication required" };
  }
  const ownProfile = db.prepare("SELECT * FROM ca_profiles WHERE user_id = ?").get(context.user.id);
  if (ownProfile) {
    if (!allowPending && ownProfile.status !== "APPROVED") {
      return {
        ok: false,
        status: 403,
        error: `CA account status is '${ownProfile.status}'. Only approved CA/GST Agent accounts can access this feature.`
      };
    }
    return { ok: true, ca: ownProfile, isStaff: false, staffId: null, staffRole: "CA Firm Owner" };
  }

  const staff = db.prepare(`
    SELECT s.*, c.status as ca_status
    FROM ca_staff_members s
    JOIN ca_profiles c ON c.id = s.ca_id
    WHERE s.user_id = ? AND s.status = 'ACTIVE'
    LIMIT 1
  `).get(context.user.id);

  if (staff) {
    const ca = db.prepare("SELECT * FROM ca_profiles WHERE id = ?").get(staff.ca_id);
    if (!allowPending && ca.status !== "APPROVED") {
      return { ok: false, status: 403, error: `CA firm status is '${ca.status}'.` };
    }
    return { ok: true, ca, isStaff: true, staffId: staff.id, staffRole: staff.role };
  }

  return { ok: false, status: 403, error: "CA / GST Agent profile not found for this account" };
}

export function requireCaAdmin(context) {
  if (!context?.authenticated || !context.user) {
    return { ok: false, status: 401, error: "Authentication required" };
  }
  if (context.userRole !== "OWNER") {
    return { ok: false, status: 403, error: "Forbidden: Admin privileges required" };
  }
  const ca = db.prepare("SELECT id FROM ca_profiles WHERE user_id = ?").get(context.user.id);
  if (ca) {
    return { ok: false, status: 403, error: "Forbidden: CA accounts cannot access Admin APIs" };
  }
  return { ok: true };
}

export function registerCaProfile(body) {
  const {
    fullName, email, mobile, password, category, firmName, membershipNumber = "",
    yearsExperience = 0, pan, gstin = "", officeAddress, state, district, pincode,
    bankHolderName = "", bankAccountNumber = "", bankIfsc = "", bankName = "", bankAccountType = "",
    photoUrl = null, submitAsDraft = false
  } = body || {};

  if (!fullName || !email || !mobile || !password || !category || !firmName || !pan || !officeAddress || !state || !district || !pincode) {
    return { status: 400, error: "All required personal, professional, and office fields must be provided." };
  }
  if (!CA_CATEGORIES.includes(category)) {
    return { status: 400, error: `Invalid category. Allowed: ${CA_CATEGORIES.join(", ")}` };
  }
  const emailVal = String(email).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) return { status: 400, error: "Invalid email format." };
  const mobVal = String(mobile).trim();
  if (!/^[6-9]\d{9}$/.test(mobVal)) return { status: 400, error: "Invalid 10-digit mobile number." };
  const pinVal = String(pincode).trim();
  if (!/^\d{6}$/.test(pinVal)) return { status: 400, error: "Invalid 6-digit PIN code." };

  const panCheck = validatePan(String(pan).trim().toUpperCase());
  if (!panCheck.valid) return { status: 400, error: panCheck.error || "Invalid PAN format." };

  let gstinVal = null;
  if (gstin && String(gstin).trim()) {
    gstinVal = String(gstin).trim().toUpperCase();
    const gc = validateGstin(gstinVal);
    if (!gc.valid) return { status: 400, error: gc.error || "Invalid GSTIN format." };
  }

  const pwdErr = validateStrongPassword(password);
  if (pwdErr) return { status: 400, error: pwdErr };

  if (userRepo.findByEmail(emailVal) || db.prepare("SELECT id FROM ca_profiles WHERE email = ?").get(emailVal)) {
    return { status: 409, error: "An account with this email already exists." };
  }
  if (db.prepare("SELECT id FROM ca_profiles WHERE mobile = ?").get(mobVal) || db.prepare("SELECT id FROM users WHERE mobile_number = ?").get(mobVal)) {
    return { status: 409, error: "An account with this mobile number already exists." };
  }

  const caId = `ca-${crypto.randomUUID()}`;
  const caCode = `CA-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
  const initialStatus = submitAsDraft ? "DRAFT" : "SUBMITTED";
  const maskedAcc = bankAccountNumber ? `XXXX${String(bankAccountNumber).replace(/\s+/g, "").slice(-4)}` : null;

  let createdUser;
  db.exec("BEGIN IMMEDIATE;");
  try {
    createdUser = userRepo.create({
      email: emailVal,
      passwordHash: userRepo.hashPassword(password),
      fullName: String(fullName).trim(),
      mobileNumber: mobVal,
      role: "CA",
      onboardingStatus: "COMPLETED",
      onboardingStep: 4
    });

    db.prepare(`
      INSERT INTO ca_profiles (
        id, user_id, ca_code, full_name, email, mobile, category, firm_name, membership_number,
        years_experience, pan, gstin, office_address, state, district, pincode,
        bank_holder_name, bank_account_masked, bank_ifsc, bank_name, bank_account_type, photo_url, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      caId, createdUser.id, caCode, String(fullName).trim(), emailVal, mobVal, category,
      String(firmName).trim(), String(membershipNumber || "").trim() || null,
      Math.max(0, Number.parseInt(yearsExperience, 10) || 0),
      String(pan).trim().toUpperCase(), gstinVal, String(officeAddress).trim(),
      String(state).trim(), String(district).trim(), pinVal,
      bankHolderName || null, maskedAcc, bankIfsc ? String(bankIfsc).trim().toUpperCase() : null,
      bankName || null, bankAccountType || null, photoUrl, initialStatus
    );

    logCaActivity(caId, createdUser.id, "CA_REGISTERED", { status: initialStatus, category });
    notifyCa(caId, {
      category: "VERIFICATION",
      title: submitAsDraft ? "CA application draft saved" : "CA application submitted",
      message: submitAsDraft
        ? "Complete and submit your CA profile and verification documents."
        : "Your CA / GST Agent application is submitted and awaiting admin verification.",
      linkTab: "profile"
    });
    db.exec("COMMIT;");
  } catch (err) {
    db.exec("ROLLBACK;");
    throw err;
  }

  const session = sessionRepo.create({ userId: createdUser.id });
  const profile = db.prepare("SELECT * FROM ca_profiles WHERE id = ?").get(caId);
  return { status: 201, profile: getCaProfileSummary(profile), user: createdUser, session };
}

export function getCaProfileSummary(ca) {
  const docs = db.prepare("SELECT id, doc_type, original_name, mime_type, size_bytes, status, created_at FROM ca_verification_documents WHERE ca_id = ? ORDER BY created_at DESC").all(ca.id);
  const partnerProfile = getPartnerByUserId(ca.user_id);
  return {
    id: ca.id,
    caCode: ca.ca_code,
    fullName: ca.full_name,
    email: ca.email,
    mobile: ca.mobile,
    category: ca.category,
    firmName: ca.firm_name,
    membershipNumber: ca.membership_number,
    yearsExperience: ca.years_experience,
    panMasked: maskPan(ca.pan),
    gstinMasked: ca.gstin ? maskGstin(ca.gstin) : null,
    officeAddress: ca.office_address,
    state: ca.state,
    district: ca.district,
    pincode: ca.pincode,
    bankAccountMasked: ca.bank_account_masked,
    bankIfsc: ca.bank_ifsc,
    bankName: ca.bank_name,
    status: ca.status,
    rejectionReason: ca.rejection_reason,
    createdAt: ca.created_at,
    documents: docs,
    hasApprovedPartnerRole: Boolean(partnerProfile && partnerProfile.status === "APPROVED")
  };
}

export function adminUpdateCaStatus(caId, adminUserId, { status, rejectionReason }) {
  const allowed = ["UNDER_REVIEW", "APPROVED", "REJECTED", "SUSPENDED"];
  if (!allowed.includes(status)) return { status: 400, error: `Invalid status. Allowed: ${allowed.join(", ")}` };
  const ca = db.prepare("SELECT * FROM ca_profiles WHERE id = ?").get(caId);
  if (!ca) return { status: 404, error: "CA profile not found" };
  if (status === "REJECTED" && (!rejectionReason || !String(rejectionReason).trim())) {
    return { status: 400, error: "Rejection reason is required." };
  }
  db.prepare("UPDATE ca_profiles SET status = ?, rejection_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(status, status === "REJECTED" ? String(rejectionReason).trim() : null, caId);

  logCaActivity(caId, adminUserId, `ADMIN_CA_${status}`, { rejectionReason: rejectionReason || null });
  notifyCa(caId, {
    category: "VERIFICATION",
    title: `CA application ${status.toLowerCase().replace(/_/g, " ")}`,
    message: status === "APPROVED"
      ? "Your CA / GST Agent account is approved and active."
      : status === "REJECTED"
        ? `Application rejected: ${rejectionReason}`
        : `Account status changed to ${status}.`,
    linkTab: "profile"
  });
  return { status: 200, profile: getCaProfileSummary(db.prepare("SELECT * FROM ca_profiles WHERE id = ?").get(caId)) };
}

export function assertCustomerAuthorized(actor, customerId) {
  const cust = db.prepare("SELECT * FROM ca_customer_assignments WHERE id = ? AND ca_id = ?").get(customerId, actor.ca.id);
  if (!cust) return { ok: false, status: 404, error: "Customer not found in your CA workspace." };
  if (!cust.consent_granted || cust.consent_status !== "ACTIVE" || !cust.org_id) {
    return { ok: false, status: 403, error: "Explicit customer consent is required before accessing this customer's GST workspace." };
  }
  if (actor.isStaff) {
    const direct = cust.assigned_staff_id === actor.staffId;
    const mapped = db.prepare("SELECT id FROM ca_staff_customer_assignments WHERE staff_id = ? AND customer_id = ?").get(actor.staffId, customerId);
    if (!direct && !mapped) {
      return { ok: false, status: 403, error: "Forbidden: Staff member is not assigned to this customer." };
    }
  }
  return { ok: true, customer: cust };
}

export function addCaCustomer(ca, actorUserId, body) {
  const { customerName, businessName, email, mobile, businessType = "Proprietorship", pan, gstin = "", state, district, address, pincode } = body || {};
  if (!customerName || !businessName || !email || !mobile || !pan || !state || !district || !address || !pincode) {
    return { status: 400, error: "All required customer fields must be provided." };
  }
  const emailVal = String(email).trim().toLowerCase();
  const mobVal = String(mobile).trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) return { status: 400, error: "Invalid customer email." };
  if (!/^[6-9]\d{9}$/.test(mobVal)) return { status: 400, error: "Invalid 10-digit customer mobile." };
  if (!/^\d{6}$/.test(String(pincode).trim())) return { status: 400, error: "Invalid 6-digit PIN code." };
  const panCheck = validatePan(String(pan).trim().toUpperCase());
  if (!panCheck.valid) return { status: 400, error: panCheck.error };

  let cleanGstin = null;
  if (gstin && String(gstin).trim()) {
    cleanGstin = String(gstin).trim().toUpperCase();
    const gc = validateGstin(cleanGstin);
    if (!gc.valid) return { status: 400, error: gc.error };
  }

  const dup = db.prepare("SELECT id FROM ca_customer_assignments WHERE ca_id = ? AND (email = ? OR mobile = ?)").get(ca.id, emailVal, mobVal);
  if (dup) return { status: 409, error: "This customer is already linked or invited in your CA workspace." };

  const existingUser = userRepo.findByEmail(emailVal) || db.prepare("SELECT * FROM users WHERE mobile_number = ?").get(mobVal);
  let custUserId = existingUser ? existingUser.id : null;
  let orgId = null;

  db.exec("BEGIN IMMEDIATE;");
  try {
    if (!existingUser) {
      const tempPwd = crypto.randomBytes(12).toString("hex") + "A1!";
      const u = userRepo.create({
        email: emailVal,
        passwordHash: userRepo.hashPassword(tempPwd),
        fullName: String(customerName).trim(),
        mobileNumber: mobVal,
        role: "OWNER",
        onboardingStatus: "IN_PROGRESS",
        onboardingStep: 2
      });
      custUserId = u.id;
      const org = orgRepo.create({
        name: String(businessName).trim(),
        pan: String(pan).trim().toUpperCase(),
        legalType: businessType,
        address: String(address).trim(),
        state: String(state).trim()
      });
      orgRepo.addMember(org.id, u.id, "OWNER");
      orgId = org.id;
      if (cleanGstin) {
        const dupGst = db.prepare("SELECT id FROM gst_registrations WHERE gstin = ?").get(cleanGstin);
        if (dupGst) {
          db.exec("ROLLBACK;");
          return { status: 409, error: `GSTIN '${cleanGstin}' already exists on SimpleGST. Link the existing customer via consent instead.` };
        }
        gstinRepo.create({
          orgId: org.id,
          gstin: cleanGstin,
          tradeName: String(businessName).trim(),
          stateCode: cleanGstin.slice(0, 2),
          stateName: String(state).trim(),
          address: String(address).trim(),
          isPrimary: 1
        });
      }
    } else {
      orgId = orgRepo.getUserOrgs(existingUser.id)[0]?.id || null;
    }

    const id = `cacust-${crypto.randomUUID()}`;
    const consentStatus = existingUser ? "CONSENT_PENDING" : "INVITED";
    db.prepare(`
      INSERT INTO ca_customer_assignments (
        id, ca_id, customer_user_id, org_id, customer_name, business_name, email, mobile,
        business_type, pan, state, district, address, pincode, consent_status, consent_granted
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).run(
      id, ca.id, custUserId, orgId, String(customerName).trim(), String(businessName).trim(),
      emailVal, mobVal, businessType, String(pan).trim().toUpperCase(), String(state).trim(),
      String(district).trim(), String(address).trim(), String(pincode).trim(), consentStatus
    );

    logCaActivity(ca.id, actorUserId, "CA_CUSTOMER_INVITED", { customerId: id, existingUser: Boolean(existingUser) });
    db.exec("COMMIT;");
    return { status: 201, customer: db.prepare("SELECT * FROM ca_customer_assignments WHERE id = ?").get(id) };
  } catch (err) {
    db.exec("ROLLBACK;");
    throw err;
  }
}

export function respondCaCustomerConsent(customerUserId, assignmentId, action) {
  const link = db.prepare("SELECT * FROM ca_customer_assignments WHERE id = ?").get(assignmentId);
  if (!link) return { status: 404, error: "CA authorization request not found" };
  if (link.customer_user_id !== customerUserId) {
    return { status: 403, error: "Forbidden: Only the customer owner can grant or revoke CA access." };
  }
  if (action === "APPROVE") {
    db.prepare(`
      UPDATE ca_customer_assignments
      SET consent_granted = 1, consent_status = 'ACTIVE', consent_granted_at = CURRENT_TIMESTAMP, revoked_at = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(assignmentId);
    notifyCa(link.ca_id, {
      category: "CONSENT",
      title: "Customer authorized CA access",
      message: `${link.business_name} accepted your invitation and granted GST access.`,
      relatedCustomerId: link.id,
      linkTab: "customers"
    });
  } else if (action === "REVOKE") {
    db.prepare(`
      UPDATE ca_customer_assignments
      SET consent_granted = 0, consent_status = 'REVOKED', revoked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(assignmentId);
  } else {
    return { status: 400, error: "Invalid action. Expected APPROVE or REVOKE." };
  }
  return { status: 200, customer: db.prepare("SELECT * FROM ca_customer_assignments WHERE id = ?").get(assignmentId) };
}

export function previewBulkCustomerImport(ca, fileItem) {
  const filename = fileItem?.filename || "import.csv";
  const ext = filename.split(".").pop().toLowerCase();
  if (!["csv", "xlsx", "xls"].includes(ext)) {
    return { status: 400, error: "Unsupported bulk import format. Upload CSV or XLSX." };
  }
  const bytes = Buffer.isBuffer(fileItem.data) ? fileItem.data : Buffer.from(fileItem.data || "");
  if (bytes.length === 0) return { status: 400, error: "Uploaded file is empty." };

  let rows = [];
  try {
    const wb = XLSX.read(bytes, { type: "buffer" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  } catch (err) {
    return { status: 400, error: `Could not parse ${ext.toUpperCase()} file: ${err.message}` };
  }

  const jobId = `caimp-${crypto.randomUUID()}`;
  const seenEmails = new Set();
  const seenGstins = new Set();
  const records = [];
  let validCount = 0, invalidCount = 0, dupCount = 0;

  rows.forEach((raw, idx) => {
    const norm = {
      customerName: String(raw.customerName || raw.customer_name || raw["Customer Name"] || "").trim(),
      businessName: String(raw.businessName || raw.business_name || raw["Business Name"] || "").trim(),
      email: String(raw.email || raw.Email || "").trim().toLowerCase(),
      mobile: String(raw.mobile || raw.Mobile || "").trim(),
      businessType: String(raw.businessType || raw.business_type || raw["Business Type"] || "Proprietorship").trim(),
      pan: String(raw.pan || raw.PAN || "").trim().toUpperCase(),
      gstin: String(raw.gstin || raw.GSTIN || "").trim().toUpperCase(),
      state: String(raw.state || raw.State || "").trim(),
      district: String(raw.district || raw.District || "").trim(),
      address: String(raw.address || raw.Address || "").trim(),
      pincode: String(raw.pincode || raw.PIN || raw["PIN Code"] || "").trim()
    };

    let status = "VALID";
    let errMsg = "";
    if (!norm.customerName || !norm.businessName || !norm.email || !norm.mobile || !norm.pan || !norm.state || !norm.district || !norm.address || !norm.pincode) {
      status = "INVALID";
      errMsg = "Missing required fields";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(norm.email)) {
      status = "INVALID";
      errMsg = "Invalid email format";
    } else if (!/^[6-9]\d{9}$/.test(norm.mobile)) {
      status = "INVALID";
      errMsg = "Invalid 10-digit mobile";
    } else if (!/^\d{6}$/.test(norm.pincode)) {
      status = "INVALID";
      errMsg = "Invalid 6-digit PIN code";
    } else if (!validatePan(norm.pan).valid) {
      status = "INVALID";
      errMsg = "Invalid PAN format";
    } else if (norm.gstin && !validateGstin(norm.gstin).valid) {
      status = "INVALID";
      errMsg = "Invalid GSTIN format";
    } else if (seenEmails.has(norm.email) || db.prepare("SELECT id FROM ca_customer_assignments WHERE ca_id = ? AND email = ?").get(ca.id, norm.email)) {
      status = "DUPLICATE";
      errMsg = "Duplicate customer email";
    } else if (norm.gstin && (seenGstins.has(norm.gstin) || db.prepare("SELECT id FROM gst_registrations WHERE gstin = ?").get(norm.gstin))) {
      status = "DUPLICATE";
      errMsg = "Duplicate GSTIN already registered";
    }

    if (norm.email) seenEmails.add(norm.email);
    if (norm.gstin) seenGstins.add(norm.gstin);
    if (status === "VALID") validCount++;
    else if (status === "DUPLICATE") dupCount++;
    else invalidCount++;

    records.push({ rowIndex: idx + 1, norm, status, errMsg });
  });

  db.exec("BEGIN IMMEDIATE;");
  try {
    db.prepare(`
      INSERT INTO ca_bulk_import_jobs (id, ca_id, filename, file_type, total_records, valid_records, invalid_records, duplicate_records, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PREVIEW')
    `).run(jobId, ca.id, filename, ext.toUpperCase(), rows.length, validCount, invalidCount, dupCount);

    const insRec = db.prepare(`
      INSERT INTO ca_bulk_import_records (id, job_id, row_index, raw_json, status, error_message)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const r of records) {
      insRec.run(`caimpr-${crypto.randomUUID()}`, jobId, r.rowIndex, JSON.stringify(r.norm), r.status, r.errMsg || null);
    }
    db.exec("COMMIT;");
  } catch (err) {
    db.exec("ROLLBACK;");
    throw err;
  }

  return {
    status: 201,
    job: db.prepare("SELECT * FROM ca_bulk_import_jobs WHERE id = ?").get(jobId),
    records: db.prepare("SELECT * FROM ca_bulk_import_records WHERE job_id = ? ORDER BY row_index ASC").all(jobId)
  };
}

export function confirmBulkCustomerImport(ca, actorUserId, jobId) {
  const job = db.prepare("SELECT * FROM ca_bulk_import_jobs WHERE id = ? AND ca_id = ?").get(jobId, ca.id);
  if (!job) return { status: 404, error: "Import job not found" };
  if (job.status === "COMPLETED") return { status: 409, error: "Import job already confirmed." };

  const validRows = db.prepare("SELECT * FROM ca_bulk_import_records WHERE job_id = ? AND status = 'VALID' ORDER BY row_index ASC").all(jobId);
  let imported = 0, failed = 0;

  for (const rec of validRows) {
    const parsed = JSON.parse(rec.raw_json);
    const res = addCaCustomer(ca, actorUserId, parsed);
    if (res.status === 201) {
      db.prepare("UPDATE ca_bulk_import_records SET status = 'IMPORTED' WHERE id = ?").run(rec.id);
      imported++;
    } else {
      db.prepare("UPDATE ca_bulk_import_records SET status = 'FAILED', error_message = ? WHERE id = ?").run(res.error || "Import failed", rec.id);
      failed++;
    }
  }

  db.prepare("UPDATE ca_bulk_import_jobs SET imported_records = ?, status = 'COMPLETED' WHERE id = ?").run(imported, jobId);
  return {
    status: 200,
    job: db.prepare("SELECT * FROM ca_bulk_import_jobs WHERE id = ?").get(jobId),
    imported,
    failed
  };
}

export function prepareCaReturn(actor, { customerId, gstinId, returnType, period }) {
  if (!["GSTR1", "GSTR3B"].includes(returnType)) {
    return { status: 400, error: "returnType must be GSTR1 or GSTR3B" };
  }
  if (!/^\d{6}$/.test(String(period || ""))) {
    return { status: 400, error: "period must be 6-digit MMYYYY format" };
  }
  const auth = assertCustomerAuthorized(actor, customerId);
  if (!auth.ok) return { status: auth.status, error: auth.error };

  const gstinRow = db.prepare("SELECT * FROM gst_registrations WHERE id = ? AND org_id = ?").get(gstinId, auth.customer.org_id);
  if (!gstinRow) return { status: 404, error: "GSTIN not found for this customer" };

  const sales = salesRepo.list(gstinRow.id, period);
  const purchases = purchaseRepo.list(gstinRow.id, period);
  const validationErrors = [];
  if (sales.length === 0 && purchases.length === 0) {
    validationErrors.push("No sales or purchase invoices recorded for this period.");
  }

  let summary = {};
  if (returnType === "GSTR1") {
    const classified = classifySalesRegisterForGstr1(sales);
    const taxablePaise = sales.reduce((a, s) => a + toPaise(s.taxable_amount), 0);
    const taxPaise = sales.reduce((a, s) => a + toPaise(s.total_tax), 0);
    summary = {
      invoiceCount: sales.length,
      taxablePaise,
      totalTaxPaise: taxPaise,
      gstr1Tables: classified?.summary || {}
    };
  } else {
    const outIgst = sales.reduce((a, s) => a + toPaise(s.igst), 0);
    const outCgst = sales.reduce((a, s) => a + toPaise(s.cgst), 0);
    const outSgst = sales.reduce((a, s) => a + toPaise(s.sgst), 0);
    const eligiblePur = purchases.filter(p => p.itc_eligibility === "ELIGIBLE");
    const itcIgst = eligiblePur.reduce((a, p) => a + toPaise(p.igst), 0);
    const itcCgst = eligiblePur.reduce((a, p) => a + toPaise(p.cgst), 0);
    const itcSgst = eligiblePur.reduce((a, p) => a + toPaise(p.sgst), 0);
    const rcmPaise = purchases.filter(p => p.is_rcm).reduce((a, p) => a + toPaise(p.total_tax), 0);

    const setoff = computeRule88aSetoff(
      { igst: fromPaise(outIgst), cgst: fromPaise(outCgst), sgst: fromPaise(outSgst), cess: 0 },
      { igst: fromPaise(itcIgst), cgst: fromPaise(itcCgst), sgst: fromPaise(itcSgst), cess: 0 }
    );
    summary = {
      salesCount: sales.length,
      purchasesCount: purchases.length,
      outputLiabilityPaise: outIgst + outCgst + outSgst,
      eligibleItcPaise: itcIgst + itcCgst + itcSgst,
      rcmCashPaise: rcmPaise,
      netCashPayablePaise: (setoff.paise?.netCashPayable || 0) + rcmPaise,
      setoffMatrix: setoff
    };
  }

  const existingMax = db.prepare("SELECT COALESCE(MAX(version), 0) as mv FROM ca_filing_approvals WHERE gstin_id = ? AND return_type = ? AND period = ?")
    .get(gstinRow.id, returnType, period)?.mv || 0;
  const id = `caapp-${crypto.randomUUID()}`;
  const version = existingMax + 1;

  db.prepare(`
    INSERT INTO ca_filing_approvals (
      id, ca_id, customer_id, org_id, gstin_id, gstin, return_type, period, version,
      summary_json, validation_errors_json, status, prepared_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?)
  `).run(
    id, actor.ca.id, customerId, auth.customer.org_id, gstinRow.id, gstinRow.gstin,
    returnType, period, version, JSON.stringify(summary), JSON.stringify(validationErrors),
    actor.staffRole || "CA"
  );

  db.prepare(`
    INSERT INTO ca_approval_history (id, approval_id, actor_user_id, actor_role, action, notes)
    VALUES (?, ?, ?, ?, 'PREPARED_DRAFT', ?)
  `).run(`caah-${crypto.randomUUID()}`, id, actor.ca.user_id, actor.staffRole || "CA", `Prepared ${returnType} v${version}`);

  return { status: 201, approval: db.prepare("SELECT * FROM ca_filing_approvals WHERE id = ?").get(id) };
}

export function submitApprovalToCustomer(actor, approvalId) {
  const app = db.prepare("SELECT * FROM ca_filing_approvals WHERE id = ? AND ca_id = ?").get(approvalId, actor.ca.id);
  if (!app) return { status: 404, error: "Return preparation record not found." };
  const auth = assertCustomerAuthorized(actor, app.customer_id);
  if (!auth.ok) return { status: auth.status, error: auth.error };

  db.prepare(`
    UPDATE ca_filing_approvals
    SET status = 'AWAITING_CUSTOMER_APPROVAL', reviewed_by = ?, submitted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(actor.staffRole || "CA", approvalId);

  db.prepare(`
    INSERT INTO ca_approval_history (id, approval_id, actor_user_id, actor_role, action, notes)
    VALUES (?, ?, ?, ?, 'SUBMITTED_FOR_CUSTOMER_APPROVAL', 'Sent to customer for approval')
  `).run(`caah-${crypto.randomUUID()}`, approvalId, actor.ca.user_id, actor.staffRole || "CA");

  return { status: 200, approval: db.prepare("SELECT * FROM ca_filing_approvals WHERE id = ?").get(approvalId) };
}

export function customerRespondReturnApproval(customerUserId, approvalId, { action, reason = "" }) {
  const app = db.prepare(`
    SELECT a.*, c.customer_user_id, c.business_name
    FROM ca_filing_approvals a
    JOIN ca_customer_assignments c ON c.id = a.customer_id
    WHERE a.id = ?
  `).get(approvalId);
  if (!app) return { status: 404, error: "Approval request not found" };
  if (app.customer_user_id !== customerUserId) {
    return { status: 403, error: "Forbidden: Only the authorized customer can approve or reject this return." };
  }
  if (!["APPROVE", "REJECT", "REQUEST_CHANGES"].includes(action)) {
    return { status: 400, error: "Invalid action. Allowed: APPROVE, REJECT, REQUEST_CHANGES" };
  }
  if ((action === "REJECT" || action === "REQUEST_CHANGES") && !String(reason).trim()) {
    return { status: 400, error: "Reason or requested change note is required." };
  }

  const nextStatus = action === "APPROVE" ? "APPROVED" : action === "REJECT" ? "REJECTED" : "CHANGES_REQUESTED";
  db.prepare(`
    UPDATE ca_filing_approvals
    SET status = ?, approved_by = ?, rejection_reason = ?, approved_at = CASE WHEN ? = 'APPROVED' THEN CURRENT_TIMESTAMP ELSE approved_at END, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(nextStatus, customerUserId, reason || null, nextStatus, approvalId);

  db.prepare(`
    INSERT INTO ca_approval_history (id, approval_id, actor_user_id, actor_role, action, notes)
    VALUES (?, ?, ?, 'CUSTOMER', ?, ?)
  `).run(`caah-${crypto.randomUUID()}`, approvalId, customerUserId, nextStatus, reason || "Customer approved return");

  notifyCa(app.ca_id, {
    category: "APPROVAL",
    title: `Customer ${nextStatus.toLowerCase().replace(/_/g, " ")} ${app.return_type}`,
    message: `${app.business_name} (${app.gstin}) marked ${app.return_type} ${app.period} as ${nextStatus}.`,
    relatedCustomerId: app.customer_id,
    relatedGstin: app.gstin,
    linkTab: "approvals"
  });

  return { status: 200, approval: db.prepare("SELECT * FROM ca_filing_approvals WHERE id = ?").get(approvalId) };
}

export function fileApprovedCaReturn(actor, approvalId) {
  const app = db.prepare("SELECT * FROM ca_filing_approvals WHERE id = ? AND ca_id = ?").get(approvalId, actor.ca.id);
  if (!app) return { status: 404, error: "Return record not found" };
  const auth = assertCustomerAuthorized(actor, app.customer_id);
  if (!auth.ok) return { status: auth.status, error: auth.error };

  if (!["APPROVED", "READY_TO_FILE"].includes(app.status)) {
    return {
      status: 403,
      error: `Unauthorized filing blocked: Return status is '${app.status}'. Explicit customer approval is required before filing.`
    };
  }

  // Never simulate GST filing or generate fake ARNs in production or without live GSP integration
  return {
    status: 503,
    integrationPending: true,
    error: "GSP filing integration is not connected. Return is approved and Ready to File; transmit via your authorized GSTN GSP gateway.",
    approval: app
  };
}

export function getCaComplianceOverview(actor, period) {
  const now = new Date();
  const activePeriod = period || `${String(now.getMonth() + 1).padStart(2, "0")}${now.getFullYear()}`;
  const dueInfo = getStatutoryDueDates(activePeriod);

  let custSql = "SELECT * FROM ca_customer_assignments WHERE ca_id = ? AND consent_granted = 1 AND consent_status = 'ACTIVE'";
  const params = [actor.ca.id];
  if (actor.isStaff) {
    custSql += " AND (assigned_staff_id = ? OR id IN (SELECT customer_id FROM ca_staff_customer_assignments WHERE staff_id = ?))";
    params.push(actor.staffId, actor.staffId);
  }
  const customers = db.prepare(custSql).all(...params);
  const items = [];
  for (const c of customers) {
    const gstins = c.org_id ? db.prepare("SELECT * FROM gst_registrations WHERE org_id = ? AND is_active = 1").all(c.org_id) : [];
    for (const g of gstins) {
      const g1 = db.prepare("SELECT status, filing_date FROM tax_returns WHERE gstin_id = ? AND period = ? AND return_type = 'GSTR1' LIMIT 1").get(g.id, activePeriod);
      const g3b = db.prepare("SELECT status, filing_date FROM tax_returns WHERE gstin_id = ? AND period = ? AND return_type = 'GSTR3B' LIMIT 1").get(g.id, activePeriod);
      const recon = db.prepare("SELECT COUNT(*) as c FROM reconciliation_results WHERE gstin_id = ? AND period = ?").get(g.id, activePeriod)?.c || 0;
      const app = db.prepare("SELECT status FROM ca_filing_approvals WHERE gstin_id = ? AND period = ? ORDER BY version DESC LIMIT 1").get(g.id, activePeriod);

      const complianceStatus = g3b
        ? "Compliant"
        : app?.status === "AWAITING_CUSTOMER_APPROVAL"
          ? "Awaiting Approval"
          : (g1 || recon > 0)
            ? "Filing Pending"
            : "Awaiting Documents";

      items.push({
        customerId: c.id,
        customerName: c.business_name,
        gstinId: g.id,
        gstin: g.gstin,
        filingFrequency: g.filing_frequency || "MONTHLY",
        period: activePeriod,
        gstr1Status: g1 ? g1.status : "Not Started",
        gstr3bStatus: g3b ? g3b.status : "Not Started",
        reconStatus: recon > 0 ? "Reconciled" : "Pending",
        dueDate: g.filing_frequency === "QRMP" ? (dueInfo?.qrmp || dueInfo?.gstr3b) : (dueInfo?.gstr3b || "20th of next month"),
        lastFilingDate: g3b?.filing_date || null,
        complianceStatus
      });
    }
  }
  return { period: activePeriod, dueDates: dueInfo, items };
}
