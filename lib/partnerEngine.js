import crypto from "node:crypto";
import { db, userRepo, orgRepo, gstinRepo, sessionRepo } from "./db.js";
import { validatePan, validateGstin } from "./validate.js";
import { toPaise, fromPaise, percentOfPaise } from "./moneyPaise.js";
import { getStatutoryDueDates } from "./dueDateEngine.js";

const PARTNER_CATEGORIES = [
  "Chartered Accountant",
  "Tax Consultant",
  "GST Practitioner",
  "Accounting Firm",
  "Business Consultant",
  "Referral Partner",
  "Other"
];

export const TRAINING_MODULES = [
  { id: "trn-1", title: "Getting started with SimpleGST", category: "Onboarding", duration: "8 min", summary: "Navigate the Partner Dashboard, client workspaces, and permissions." },
  { id: "trn-2", title: "Partner onboarding guide", category: "Onboarding", duration: "10 min", summary: "Complete KYC verification, PAN/GSTIN checks, and territory mapping." },
  { id: "trn-3", title: "Customer onboarding tutorial", category: "Customers", duration: "12 min", summary: "Invite customers, obtain GST consent, and link multi-state GSTINs." },
  { id: "trn-4", title: "GST basics for retail & SMEs", category: "GST", duration: "15 min", summary: "Understand CGST, SGST, IGST, HSN codes, and threshold rules." },
  { id: "trn-5", title: "GSTR-1 guide", category: "Filing", duration: "14 min", summary: "B2B, B2CL, B2CS classification, credit/debit notes, and due dates." },
  { id: "trn-6", title: "GSTR-3B guide", category: "Filing", duration: "16 min", summary: "Rule 88A cross-utilization order, RCM cash tax, and ITC offset." },
  { id: "trn-7", title: "GSTR-2B and ITC reconciliation guide", category: "Reconciliation", duration: "18 min", summary: "Match supplier bills, resolve variances, and track 180-day Rule 37." },
  { id: "trn-8", title: "Lead management tutorial", category: "Growth", duration: "10 min", summary: "Accept territory leads, log follow-ups, and convert to active clients." },
  { id: "trn-9", title: "Commission and referral guide", category: "Earnings", duration: "9 min", summary: "How tier bonuses, referral rewards, and payout requests work." }
];

export function maskPan(pan) {
  const s = String(pan || "").trim().toUpperCase();
  if (s.length < 10) return s ? "****" : "";
  return `${s.slice(0, 4)}*****${s.slice(-1)}`;
}

export function maskGstin(gstin) {
  const s = String(gstin || "").trim().toUpperCase();
  if (s.length < 15) return s ? "****" : "";
  return `${s.slice(0, 4)}*******${s.slice(-4)}`;
}

function validateStrongPassword(pwd) {
  const p = String(pwd || "");
  if (p.length < 8) return "Password must be at least 8 characters.";
  if (!/[A-Z]/.test(p)) return "Password must contain at least one uppercase letter.";
  if (!/[a-z]/.test(p)) return "Password must contain at least one lowercase letter.";
  if (!/[0-9]/.test(p)) return "Password must contain at least one digit.";
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(p)) return "Password must contain at least one special character.";
  return null;
}

export function logPartnerActivity(partnerId, actorUserId, action, details = {}) {
  db.prepare(`
    INSERT INTO partner_activity_logs (id, partner_id, actor_user_id, action, details_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(`pact-${crypto.randomUUID()}`, partnerId, actorUserId || null, action, JSON.stringify(details));
}

export function notifyPartner(partnerId, { category, title, message, relatedModule = null, relatedId = null }) {
  db.prepare(`
    INSERT INTO partner_notifications (id, partner_id, category, title, message, related_module, related_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(`pnot-${crypto.randomUUID()}`, partnerId, category, title, message, relatedModule, relatedId);
}

export function getPartnerByUserId(userId) {
  if (!userId) return null;
  return db.prepare("SELECT * FROM partners WHERE user_id = ?").get(userId) || null;
}

export function requirePartnerAccess(context, { allowPending = false } = {}) {
  if (!context?.authenticated || !context.user) {
    return { ok: false, status: 401, error: "Authentication required" };
  }
  const partner = getPartnerByUserId(context.user.id);
  if (!partner) {
    return { ok: false, status: 403, error: "Partner profile not found for this account" };
  }
  if (!allowPending && partner.status !== "APPROVED") {
    return {
      ok: false,
      status: 403,
      error: `Partner account status is '${partner.status}'. Only approved and active partners can access this feature.`
    };
  }
  return { ok: true, partner };
}

export function requireAdminAccess(context) {
  if (!context?.authenticated || !context.user) {
    return { ok: false, status: 401, error: "Authentication required" };
  }
  if (context.userRole !== "OWNER") {
    return { ok: false, status: 403, error: "Forbidden: Admin privileges required" };
  }
  const partner = getPartnerByUserId(context.user.id);
  if (partner) {
    return { ok: false, status: 403, error: "Forbidden: Partner accounts cannot access Admin APIs" };
  }
  return { ok: true };
}

export function registerPartner(body) {
  const {
    fullName, businessName, email, mobile, password, businessType,
    pan, gstin, address, state, district, city, pincode, category,
    yearsExperience = 0, submitAsDraft = false
  } = body || {};

  if (!fullName || !businessName || !email || !mobile || !password || !businessType || !pan || !address || !state || !district || !city || !pincode || !category) {
    return { status: 400, error: "All required partner registration fields must be provided." };
  }
  if (!PARTNER_CATEGORIES.includes(category)) {
    return { status: 400, error: `Invalid partner category. Allowed: ${PARTNER_CATEGORIES.join(", ")}` };
  }
  const emailVal = String(email).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) {
    return { status: 400, error: "Invalid email address format." };
  }
  const mobVal = String(mobile).trim();
  if (!/^[6-9]\d{9}$/.test(mobVal)) {
    return { status: 400, error: "Invalid 10-digit Indian mobile number." };
  }
  const pinVal = String(pincode).trim();
  if (!/^\d{6}$/.test(pinVal)) {
    return { status: 400, error: "Invalid 6-digit PIN code." };
  }
  const panCheck = validatePan(String(pan).trim().toUpperCase());
  if (!panCheck.valid) {
    return { status: 400, error: panCheck.error || "Invalid PAN format." };
  }
  let gstinVal = null;
  if (gstin && String(gstin).trim()) {
    const gCheck = validateGstin(String(gstin).trim().toUpperCase());
    if (!gCheck.valid) {
      return { status: 400, error: gCheck.error || "Invalid GSTIN format." };
    }
    gstinVal = String(gstin).trim().toUpperCase();
  }
  const pwdErr = validateStrongPassword(password);
  if (pwdErr) return { status: 400, error: pwdErr };

  if (userRepo.findByEmail(emailVal) || db.prepare("SELECT id FROM partners WHERE email = ?").get(emailVal)) {
    return { status: 409, error: "An account with this email already exists." };
  }
  if (db.prepare("SELECT id FROM partners WHERE mobile = ?").get(mobVal) || db.prepare("SELECT id FROM users WHERE mobile_number = ?").get(mobVal)) {
    return { status: 409, error: "An account with this mobile number already exists." };
  }

  const partnerId = `prt-${crypto.randomUUID()}`;
  const partnerCode = `PRT-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
  const referralCode = `SGST-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
  const initialStatus = submitAsDraft ? "DRAFT" : "SUBMITTED";

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
      INSERT INTO partners (
        id, user_id, partner_code, full_name, business_name, email, mobile,
        business_type, pan, gstin, address, state, district, city, pincode,
        category, years_experience, status, tier, referral_code
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Bronze', ?)
    `).run(
      partnerId, createdUser.id, partnerCode, String(fullName).trim(), String(businessName).trim(),
      emailVal, mobVal, String(businessType).trim(), String(pan).trim().toUpperCase(), gstinVal,
      String(address).trim(), String(state).trim(), String(district).trim(), String(city).trim(),
      pinVal, category, Math.max(0, Number.parseInt(yearsExperience, 10) || 0), initialStatus, referralCode
    );

    logPartnerActivity(partnerId, createdUser.id, "PARTNER_REGISTERED", { status: initialStatus, category });
    notifyPartner(partnerId, {
      category: "VERIFICATION",
      title: submitAsDraft ? "Partner draft saved" : "Application submitted for review",
      message: submitAsDraft
        ? "Complete and submit your partner application for verification."
        : "Your partner application is submitted and awaiting admin review.",
      relatedModule: "profile",
      relatedId: partnerId
    });
    db.exec("COMMIT;");
  } catch (err) {
    db.exec("ROLLBACK;");
    throw err;
  }

  const session = sessionRepo.create({ userId: createdUser.id });
  const partner = db.prepare("SELECT * FROM partners WHERE id = ?").get(partnerId);
  return { status: 201, partner, user: createdUser, session };
}

export function getPartnerProfileSummary(partner) {
  const custCount = db.prepare("SELECT COUNT(*) as c FROM partner_customers WHERE partner_id = ? AND onboarding_status = 'ACTIVE'").get(partner.id)?.c || 0;
  const totalLeads = db.prepare("SELECT COUNT(*) as c FROM partner_leads WHERE partner_id = ?").get(partner.id)?.c || 0;
  const conversions = db.prepare("SELECT COUNT(*) as c FROM partner_leads WHERE partner_id = ? AND status = 'CONVERTED'").get(partner.id)?.c || 0;
  const commEarnedPaise = db.prepare("SELECT COALESCE(SUM(commission_amount_paise), 0) as s FROM partner_commissions WHERE partner_id = ? AND status IN ('APPROVED','PAYABLE','PAID')").get(partner.id)?.s || 0;
  const territories = db.prepare("SELECT * FROM partner_territories WHERE partner_id = ? AND status = 'ACTIVE'").all(partner.id);
  const docs = db.prepare("SELECT id, doc_type, original_name, mime_type, size_bytes, status, created_at FROM partner_documents WHERE partner_id = ? ORDER BY created_at DESC").all(partner.id);

  return {
    id: partner.id,
    partnerCode: partner.partner_code,
    fullName: partner.full_name,
    businessName: partner.business_name,
    logoUrl: partner.logo_url,
    email: partner.email,
    mobile: partner.mobile,
    businessType: partner.business_type,
    category: partner.category,
    yearsExperience: partner.years_experience,
    panMasked: maskPan(partner.pan),
    gstinMasked: partner.gstin ? maskGstin(partner.gstin) : null,
    address: partner.address,
    state: partner.state,
    district: partner.district,
    city: partner.city,
    pincode: partner.pincode,
    status: partner.status,
    rejectionReason: partner.rejection_reason,
    tier: partner.tier,
    referralCode: partner.referral_code,
    createdAt: partner.created_at,
    territories,
    documents: docs,
    stats: {
      totalCustomers: custCount,
      totalLeads,
      totalConversions: conversions,
      commissionEarnedPaise: commEarnedPaise,
      commissionEarned: fromPaise(commEarnedPaise)
    }
  };
}

export function updatePartnerProfile(partner, user, body) {
  const { fullName, businessName, address, city, district, state, pincode, yearsExperience, logoUrl, pan, gstin, email, mobile, currentPassword, submitApplication } = body || {};
  const touchingSensitive = Boolean(
    (pan && pan.toUpperCase() !== partner.pan) ||
    (gstin && gstin.toUpperCase() !== (partner.gstin || "")) ||
    (email && email.toLowerCase() !== partner.email) ||
    (mobile && mobile !== partner.mobile)
  );
  if (touchingSensitive) {
    if (!currentPassword || !userRepo.verifyPassword(user.password_hash, currentPassword)) {
      return { status: 403, error: "Current password verification is required to change PAN, GSTIN, email, or mobile." };
    }
    if (pan) {
      const pc = validatePan(String(pan).trim().toUpperCase());
      if (!pc.valid) return { status: 400, error: pc.error };
    }
    if (gstin) {
      const gc = validateGstin(String(gstin).trim().toUpperCase());
      if (!gc.valid) return { status: 400, error: gc.error };
    }
  }
  if (pincode && !/^\d{6}$/.test(String(pincode).trim())) {
    return { status: 400, error: "Invalid 6-digit PIN code." };
  }

  const nextStatus = submitApplication && partner.status === "DRAFT" ? "SUBMITTED" : partner.status;
  db.prepare(`
    UPDATE partners SET
      full_name = ?, business_name = ?, address = ?, city = ?, district = ?, state = ?, pincode = ?,
      years_experience = ?, logo_url = ?, pan = ?, gstin = ?, email = ?, mobile = ?,
      status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    fullName || partner.full_name,
    businessName || partner.business_name,
    address || partner.address,
    city || partner.city,
    district || partner.district,
    state || partner.state,
    pincode || partner.pincode,
    yearsExperience !== undefined ? Math.max(0, Number.parseInt(yearsExperience, 10) || 0) : partner.years_experience,
    logoUrl !== undefined ? logoUrl : partner.logo_url,
    pan ? String(pan).trim().toUpperCase() : partner.pan,
    gstin ? String(gstin).trim().toUpperCase() : partner.gstin,
    email ? String(email).trim().toLowerCase() : partner.email,
    mobile ? String(mobile).trim() : partner.mobile,
    nextStatus,
    partner.id
  );
  logPartnerActivity(partner.id, user.id, "PARTNER_PROFILE_UPDATED", { touchingSensitive, nextStatus });
  const updated = db.prepare("SELECT * FROM partners WHERE id = ?").get(partner.id);
  return { status: 200, profile: getPartnerProfileSummary(updated) };
}

export function adminUpdatePartnerStatus(partnerId, adminUserId, { status, rejectionReason }) {
  const allowed = ["UNDER_REVIEW", "APPROVED", "REJECTED", "SUSPENDED"];
  if (!allowed.includes(status)) {
    return { status: 400, error: `Invalid target status. Allowed: ${allowed.join(", ")}` };
  }
  const partner = db.prepare("SELECT * FROM partners WHERE id = ?").get(partnerId);
  if (!partner) return { status: 404, error: "Partner not found" };
  if (status === "REJECTED" && (!rejectionReason || !String(rejectionReason).trim())) {
    return { status: 400, error: "Rejection reason is required when rejecting an application." };
  }

  db.prepare(`
    UPDATE partners SET status = ?, rejection_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(status, status === "REJECTED" ? String(rejectionReason).trim() : null, partnerId);

  logPartnerActivity(partnerId, adminUserId, `ADMIN_STATUS_${status}`, { rejectionReason: rejectionReason || null });
  notifyPartner(partnerId, {
    category: "VERIFICATION",
    title: `Partner application ${status.toLowerCase().replace(/_/g, " ")}`,
    message: status === "APPROVED"
      ? "Your partner account is approved. You now have access to all partner tools."
      : status === "REJECTED"
        ? `Application rejected: ${rejectionReason}`
        : `Your partner status changed to ${status}.`,
    relatedModule: "profile",
    relatedId: partnerId
  });

  return { status: 200, partner: db.prepare("SELECT * FROM partners WHERE id = ?").get(partnerId) };
}

export function assignTerritory(adminUserId, { partnerId, state, district, city, pincodes = [], allowOverlap = false }) {
  const partner = db.prepare("SELECT * FROM partners WHERE id = ?").get(partnerId);
  if (!partner) return { status: 404, error: "Partner not found" };
  if (!state || !district || !city || !Array.isArray(pincodes) || pincodes.length === 0) {
    return { status: 400, error: "State, district, city, and at least one 6-digit PIN code are required." };
  }

  const cleanPins = [...new Set(pincodes.map(p => String(p).trim()))];
  for (const pin of cleanPins) {
    if (!/^\d{6}$/.test(pin)) return { status: 400, error: `Invalid PIN code '${pin}'. Expected 6 digits.` };
    if (!allowOverlap) {
      const conflict = db.prepare(`
        SELECT t.id, p.business_name FROM partner_territories t
        JOIN partners p ON p.id = t.partner_id
        WHERE t.pincode = ? AND t.status = 'ACTIVE' AND t.partner_id != ?
      `).get(pin, partnerId);
      if (conflict) {
        return { status: 409, error: `PIN code ${pin} is already assigned to partner '${conflict.business_name}'. Enable allowOverlap to override.` };
      }
    }
  }

  const created = [];
  db.exec("BEGIN IMMEDIATE;");
  try {
    for (const pin of cleanPins) {
      const existingSame = db.prepare("SELECT id FROM partner_territories WHERE partner_id = ? AND pincode = ?").get(partnerId, pin);
      if (existingSame) {
        db.prepare("UPDATE partner_territories SET state = ?, district = ?, city = ?, status = 'ACTIVE', allow_overlap = ? WHERE id = ?")
          .run(state, district, city, allowOverlap ? 1 : 0, existingSame.id);
        created.push(existingSame.id);
      } else {
        const id = `terr-${crypto.randomUUID()}`;
        db.prepare(`
          INSERT INTO partner_territories (id, partner_id, state, district, city, pincode, status, allow_overlap)
          VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?)
        `).run(id, partnerId, state, district, city, pin, allowOverlap ? 1 : 0);
        created.push(id);
      }
    }
    logPartnerActivity(partnerId, adminUserId, "TERRITORIES_ASSIGNED", { pincodes: cleanPins });
    db.exec("COMMIT;");
  } catch (err) {
    db.exec("ROLLBACK;");
    throw err;
  }
  return { status: 201, territoryIds: created };
}

export function getPartnerTerritories(partnerId) {
  const rows = db.prepare("SELECT * FROM partner_territories WHERE partner_id = ? ORDER BY state, district, pincode").all(partnerId);
  return rows.map(r => ({
    ...r,
    customersCount: db.prepare("SELECT COUNT(*) as c FROM partner_customers WHERE partner_id = ? AND pincode = ?").get(partnerId, r.pincode)?.c || 0,
    leadsCount: db.prepare("SELECT COUNT(*) as c FROM partner_leads WHERE partner_id = ? AND pincode = ?").get(partnerId, r.pincode)?.c || 0
  }));
}

export function onboardCustomer(partner, actorUserId, body) {
  const { customerName, businessName, email, mobile, businessType, pan, gstin, state, district, address, pincode } = body || {};
  if (!customerName || !businessName || !email || !mobile || !businessType || !pan || !state || !district || !address || !pincode) {
    return { status: 400, error: "All required customer fields must be filled." };
  }
  const emailVal = String(email).trim().toLowerCase();
  const mobVal = String(mobile).trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) return { status: 400, error: "Invalid customer email." };
  if (!/^[6-9]\d{9}$/.test(mobVal)) return { status: 400, error: "Invalid 10-digit customer mobile number." };
  if (!/^\d{6}$/.test(String(pincode).trim())) return { status: 400, error: "Invalid 6-digit PIN code." };

  const panCheck = validatePan(String(pan).trim().toUpperCase());
  if (!panCheck.valid) return { status: 400, error: panCheck.error };

  let cleanGstin = null;
  if (gstin && String(gstin).trim()) {
    cleanGstin = String(gstin).trim().toUpperCase();
    const gc = validateGstin(cleanGstin);
    if (!gc.valid) return { status: 400, error: gc.error };
  }

  const alreadyLinked = db.prepare("SELECT id FROM partner_customers WHERE partner_id = ? AND (email = ? OR mobile = ?)").get(partner.id, emailVal, mobVal);
  if (alreadyLinked) {
    return { status: 409, error: "This customer is already in your partner customer list." };
  }

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
        legalType: String(businessType).trim(),
        address: String(address).trim(),
        state: String(state).trim()
      });
      orgRepo.addMember(org.id, u.id, "OWNER");
      orgId = org.id;
      if (cleanGstin) {
        const dupGst = db.prepare("SELECT id FROM gst_registrations WHERE gstin = ?").get(cleanGstin);
        if (dupGst) {
          db.exec("ROLLBACK;");
          return { status: 409, error: `GSTIN '${cleanGstin}' is already registered on SimpleGST. Request customer consent instead.` };
        }
        const sc = cleanGstin.slice(0, 2);
        gstinRepo.create({
          orgId: org.id,
          gstin: cleanGstin,
          tradeName: String(businessName).trim(),
          stateCode: sc,
          stateName: String(state).trim(),
          address: String(address).trim(),
          isPrimary: 1
        });
      }
    } else {
      const orgs = orgRepo.getUserOrgs(existingUser.id);
      orgId = orgs[0]?.id || null;
    }

    const pcId = `pcust-${crypto.randomUUID()}`;
    const onboardingStatus = existingUser ? "CONSENT_PENDING" : "INVITED";
    db.prepare(`
      INSERT INTO partner_customers (
        id, partner_id, customer_user_id, org_id, customer_name, business_name, email, mobile,
        business_type, pan, state, district, address, pincode, onboarding_status, consent_granted
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).run(
      pcId, partner.id, custUserId, orgId, String(customerName).trim(), String(businessName).trim(),
      emailVal, mobVal, String(businessType).trim(), String(pan).trim().toUpperCase(),
      String(state).trim(), String(district).trim(), String(address).trim(), String(pincode).trim(),
      onboardingStatus
    );

    logPartnerActivity(partner.id, actorUserId, "CUSTOMER_ONBOARDING_INITIATED", { customerId: pcId, existingUser: Boolean(existingUser) });
    db.exec("COMMIT;");
    const created = db.prepare("SELECT * FROM partner_customers WHERE id = ?").get(pcId);
    return { status: 201, customer: created, consentRequired: true };
  } catch (err) {
    db.exec("ROLLBACK;");
    throw err;
  }
}

export function respondCustomerConsent(customerUserId, partnerCustomerId, action) {
  const link = db.prepare("SELECT * FROM partner_customers WHERE id = ?").get(partnerCustomerId);
  if (!link) return { status: 404, error: "Partner invitation not found" };
  if (link.customer_user_id !== customerUserId) {
    return { status: 403, error: "Forbidden: Only the customer account owner can approve or revoke partner access." };
  }
  if (action === "APPROVE") {
    db.prepare(`
      UPDATE partner_customers
      SET consent_granted = 1, onboarding_status = 'ACTIVE', consent_granted_at = CURRENT_TIMESTAMP, revoked_at = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(partnerCustomerId);
    notifyPartner(link.partner_id, {
      category: "CUSTOMER",
      title: "Customer consent approved",
      message: `${link.business_name} accepted your invitation and granted GST workspace access.`,
      relatedModule: "customers",
      relatedId: link.id
    });
    logPartnerActivity(link.partner_id, customerUserId, "CUSTOMER_CONSENT_APPROVED", { customerId: link.id });
  } else if (action === "REVOKE") {
    db.prepare(`
      UPDATE partner_customers
      SET consent_granted = 0, onboarding_status = 'REVOKED', revoked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(partnerCustomerId);
    logPartnerActivity(link.partner_id, customerUserId, "CUSTOMER_CONSENT_REVOKED", { customerId: link.id });
  } else {
    return { status: 400, error: "Invalid action. Expected APPROVE or REVOKE." };
  }
  return { status: 200, customer: db.prepare("SELECT * FROM partner_customers WHERE id = ?").get(partnerCustomerId) };
}

export function listPartnerCustomers(partnerId, { search = "", status = "", page = 1, limit = 20, sort = "newest" } = {}) {
  let sql = "SELECT * FROM partner_customers WHERE partner_id = ?";
  const params = [partnerId];
  if (status) {
    sql += " AND onboarding_status = ?";
    params.push(status);
  }
  if (search) {
    const q = `%${String(search).trim()}%`;
    sql += " AND (customer_name LIKE ? OR business_name LIKE ? OR email LIKE ? OR mobile LIKE ?)";
    params.push(q, q, q, q);
  }
  sql += sort === "name" ? " ORDER BY business_name ASC" : " ORDER BY created_at DESC";
  const all = db.prepare(sql).all(...params);
  const offset = (Math.max(1, Number(page)) - 1) * Math.max(1, Number(limit));
  const paged = all.slice(offset, offset + Number(limit)).map(c => {
    const gstins = (c.consent_granted && c.org_id)
      ? db.prepare("SELECT id, gstin, state_code, state_name, filing_frequency, is_active FROM gst_registrations WHERE org_id = ?").all(c.org_id)
      : [];
    const lastFiling = gstins[0]
      ? db.prepare("SELECT return_type, period, status, filing_date FROM tax_returns WHERE gstin_id = ? ORDER BY filing_date DESC LIMIT 1").get(gstins[0].id)
      : null;
    return {
      ...c,
      pan: maskPan(c.pan),
      gstinCount: gstins.length,
      gstins,
      lastFilingStatus: c.consent_granted ? (lastFiling ? `${lastFiling.return_type} ${lastFiling.status}` : "Not Started") : "Consent Pending"
    };
  });
  return { total: all.length, page: Number(page), limit: Number(limit), customers: paged };
}

export function addGstinForPartnerCustomer(partner, actorUserId, customerId, { gstin, tradeName, stateCode, stateName, filingFrequency = "MONTHLY" }) {
  const link = db.prepare("SELECT * FROM partner_customers WHERE id = ? AND partner_id = ?").get(customerId, partner.id);
  if (!link) return { status: 404, error: "Customer not found in your partner list." };
  if (!link.consent_granted || link.onboarding_status !== "ACTIVE" || !link.org_id) {
    return { status: 403, error: "Customer consent is required before managing GSTINs." };
  }
  const cleanGstin = String(gstin || "").trim().toUpperCase();
  const gc = validateGstin(cleanGstin);
  if (!gc.valid) return { status: 400, error: gc.error };

  const dup = db.prepare("SELECT id FROM gst_registrations WHERE gstin = ?").get(cleanGstin);
  if (dup) return { status: 409, error: `GSTIN '${cleanGstin}' already exists.` };

  const created = gstinRepo.create({
    orgId: link.org_id,
    gstin: cleanGstin,
    tradeName: tradeName || link.business_name,
    stateCode: stateCode || cleanGstin.slice(0, 2),
    stateName: stateName || link.state,
    address: link.address,
    filingFrequency,
    isPrimary: 0
  });
  logPartnerActivity(partner.id, actorUserId, "CUSTOMER_GSTIN_ADDED", { customerId, gstin: cleanGstin });
  return { status: 201, gstin: created };
}

export function createAdminLead(adminUserId, body) {
  const { partnerId, customerName, businessName, phone, email, gstin, pincode, city, district, leadSource = "ADMIN", priority = "MEDIUM" } = body || {};
  const partner = db.prepare("SELECT * FROM partners WHERE id = ?").get(partnerId);
  if (!partner) return { status: 404, error: "Target partner not found" };
  if (!customerName || !businessName || !phone) {
    return { status: 400, error: "Customer name, business name, and phone are required." };
  }
  const id = `lead-${crypto.randomUUID()}`;
  const leadCode = `LD-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
  db.prepare(`
    INSERT INTO partner_leads (
      id, lead_code, partner_id, customer_name, business_name, phone, email, gstin, pincode, city, district, lead_source, priority, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ASSIGNED')
  `).run(id, leadCode, partnerId, customerName, businessName, phone, email || null, gstin || null, pincode || null, city || null, district || null, leadSource, priority);

  db.prepare(`
    INSERT INTO partner_lead_activities (id, lead_id, partner_id, actor_user_id, action, notes)
    VALUES (?, ?, ?, ?, 'LEAD_ASSIGNED', ?)
  `).run(`lact-${crypto.randomUUID()}`, id, partnerId, adminUserId, `Assigned from ${leadSource}`);

  notifyPartner(partnerId, {
    category: "LEAD",
    title: "New lead assigned",
    message: `Lead ${leadCode} (${businessName}) has been assigned to you.`,
    relatedModule: "leads",
    relatedId: id
  });
  return { status: 201, lead: db.prepare("SELECT * FROM partner_leads WHERE id = ?").get(id) };
}

export function updatePartnerLead(partner, actorUserId, leadId, { status, followUpDate, notes }) {
  const lead = db.prepare("SELECT * FROM partner_leads WHERE id = ? AND partner_id = ?").get(leadId, partner.id);
  if (!lead) return { status: 404, error: "Lead not found or not assigned to you." };
  const allowed = ["ACCEPTED", "CONTACTED", "INTERESTED", "FOLLOW_UP_REQUIRED", "NOT_INTERESTED", "REJECTED", "INACTIVE"];
  if (status && !allowed.includes(status)) {
    return { status: 400, error: `Invalid lead status update. Allowed: ${allowed.join(", ")}` };
  }
  if (lead.status === "CONVERTED") {
    return { status: 409, error: "Converted leads cannot be changed." };
  }

  db.prepare(`
    UPDATE partner_leads SET status = ?, follow_up_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(status || lead.status, followUpDate !== undefined ? followUpDate : lead.follow_up_date, leadId);

  db.prepare(`
    INSERT INTO partner_lead_activities (id, lead_id, partner_id, actor_user_id, action, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(`lact-${crypto.randomUUID()}`, leadId, partner.id, actorUserId, status ? `STATUS_${status}` : "FOLLOWUP_NOTE", notes || "");

  return { status: 200, lead: db.prepare("SELECT * FROM partner_leads WHERE id = ?").get(leadId) };
}

export function convertLeadToCustomer(partner, actorUserId, leadId, body = {}) {
  const lead = db.prepare("SELECT * FROM partner_leads WHERE id = ? AND partner_id = ?").get(leadId, partner.id);
  if (!lead) return { status: 404, error: "Lead not found or not assigned to you." };
  if (lead.status === "CONVERTED" || lead.converted_customer_id) {
    return { status: 409, error: "Duplicate conversion blocked: Lead is already converted." };
  }

  const custPayload = {
    customerName: body.customerName || lead.customer_name,
    businessName: body.businessName || lead.business_name,
    email: body.email || lead.email,
    mobile: body.mobile || lead.phone,
    businessType: body.businessType || "Proprietorship",
    pan: body.pan || (lead.gstin && lead.gstin.length >= 12 ? lead.gstin.slice(2, 12) : null),
    gstin: body.gstin || lead.gstin || null,
    state: body.state || partner.state,
    district: body.district || lead.district || partner.district,
    address: body.address || `${lead.city || partner.city}, ${partner.state}`,
    pincode: body.pincode || lead.pincode || partner.pincode
  };

  if (!custPayload.email || !custPayload.pan) {
    return { status: 400, error: "Customer email and PAN are required to convert lead." };
  }

  const onboardRes = onboardCustomer(partner, actorUserId, custPayload);
  if (onboardRes.status !== 201 && onboardRes.status !== 409) {
    return onboardRes;
  }

  const customerRecord = onboardRes.customer || db.prepare("SELECT * FROM partner_customers WHERE partner_id = ? AND email = ?").get(partner.id, String(custPayload.email).toLowerCase());
  db.prepare(`
    UPDATE partner_leads SET status = 'CONVERTED', converted_customer_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(customerRecord.id, leadId);

  db.prepare(`
    INSERT INTO partner_lead_activities (id, lead_id, partner_id, actor_user_id, action, notes)
    VALUES (?, ?, ?, ?, 'LEAD_CONVERTED', ?)
  `).run(`lact-${crypto.randomUUID()}`, leadId, partner.id, actorUserId, `Converted to customer ${customerRecord.id}`);

  // Optional qualifying subscription commission if transaction amount provided
  let commission = null;
  if (body.subscriptionAmount && Number(body.subscriptionAmount) > 0) {
    const commRes = recordPartnerCommission({
      partnerId: partner.id,
      customerId: customerRecord.id,
      transactionRef: body.transactionRef || `CONV-${leadId}`,
      sourceType: "SUBSCRIPTION",
      description: `Lead conversion subscription (${customerRecord.business_name})`,
      transactionAmountPaise: toPaise(body.subscriptionAmount)
    });
    if (commRes.status === 201) commission = commRes.commission;
  }

  return { status: 200, lead: db.prepare("SELECT * FROM partner_leads WHERE id = ?").get(leadId), customer: customerRecord, commission };
}

export function recordPartnerCommission({ partnerId, customerId = null, transactionRef, sourceType, description, transactionAmountPaise }) {
  if (!transactionRef || !sourceType || !Number.isInteger(transactionAmountPaise) || transactionAmountPaise <= 0) {
    return { status: 400, error: "Valid transactionRef, sourceType, and positive integer transactionAmountPaise required." };
  }
  const existing = db.prepare("SELECT id FROM partner_commissions WHERE transaction_ref = ?").get(transactionRef);
  if (existing) {
    return { status: 409, error: `Duplicate commission blocked for transaction '${transactionRef}'.` };
  }

  const partner = db.prepare("SELECT * FROM partners WHERE id = ?").get(partnerId);
  if (!partner) return { status: 404, error: "Partner not found" };
  const rule = db.prepare("SELECT * FROM partner_commission_rules WHERE rule_type = ? AND is_active = 1").get(sourceType);
  if (!rule) return { status: 400, error: `No active commission rule configured for '${sourceType}'.` };
  const tierCfg = db.prepare("SELECT * FROM partner_tier_configs WHERE tier = ?").get(partner.tier);
  const bonusBps = tierCfg?.commission_bonus_bps || 0;

  let commPaise = 0;
  let rateLabel = "";
  if (rule.rate_type === "FIXED") {
    commPaise = rule.rate_value;
    rateLabel = `Fixed ₹${fromPaise(rule.rate_value)}`;
  } else {
    const totalBps = rule.rate_value + bonusBps;
    commPaise = Math.round((transactionAmountPaise * totalBps) / 10000);
    rateLabel = `${(totalBps / 100).toFixed(2)}%`;
  }

  const id = `pcom-${crypto.randomUUID()}`;
  db.prepare(`
    INSERT INTO partner_commissions (
      id, partner_id, transaction_ref, customer_id, source_type, description,
      transaction_amount_paise, commission_rate_label, commission_amount_paise, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'APPROVED')
  `).run(id, partnerId, transactionRef, customerId, sourceType, description || sourceType, transactionAmountPaise, rateLabel, commPaise);

  notifyPartner(partnerId, {
    category: "COMMISSION",
    title: "Commission recorded",
    message: `Commission of ₹${fromPaise(commPaise)} (${rateLabel}) recorded for ${sourceType}.`,
    relatedModule: "commissions",
    relatedId: id
  });

  return { status: 201, commission: db.prepare("SELECT * FROM partner_commissions WHERE id = ?").get(id) };
}

export function requestPartnerPayout(partner, actorUserId, { amountPaise, bankAccountNumber, ifsc }) {
  const amt = Number.parseInt(amountPaise, 10);
  if (!Number.isInteger(amt) || amt <= 0) {
    return { status: 400, error: "Positive payout amount in paise is required." };
  }
  const cleanAcc = String(bankAccountNumber || "").replace(/\s+/g, "");
  const cleanIfsc = String(ifsc || "").trim().toUpperCase();
  if (cleanAcc.length < 6 || !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(cleanIfsc)) {
    return { status: 400, error: "Valid bank account number and 11-character IFSC are required." };
  }
  const maskedAcc = `XXXX${cleanAcc.slice(-4)}`;

  db.exec("BEGIN IMMEDIATE;");
  try {
    const approvedRow = db.prepare(`
      SELECT COALESCE(SUM(commission_amount_paise), 0) as s
      FROM partner_commissions
      WHERE partner_id = ? AND status IN ('APPROVED', 'PAYABLE') AND payout_request_id IS NULL
    `).get(partner.id);
    const available = approvedRow?.s || 0;
    if (amt > available) {
      db.exec("ROLLBACK;");
      return { status: 400, error: `Requested payout (₹${fromPaise(amt)}) exceeds available approved balance (₹${fromPaise(available)}).` };
    }

    const reqId = `ppay-${crypto.randomUUID()}`;
    db.prepare(`
      INSERT INTO partner_payout_requests (id, partner_id, amount_paise, bank_account_masked, ifsc, status)
      VALUES (?, ?, ?, ?, ?, 'PENDING')
    `).run(reqId, partner.id, amt, maskedAcc, cleanIfsc);

    // Reserve commissions in FIFO order up to requested amount
    const eligibleComms = db.prepare(`
      SELECT id, commission_amount_paise FROM partner_commissions
      WHERE partner_id = ? AND status IN ('APPROVED', 'PAYABLE') AND payout_request_id IS NULL
      ORDER BY created_at ASC
    `).all(partner.id);

    let remaining = amt;
    for (const c of eligibleComms) {
      if (remaining <= 0) break;
      db.prepare("UPDATE partner_commissions SET status = 'PAYABLE', payout_request_id = ? WHERE id = ?").run(reqId, c.id);
      remaining -= c.commission_amount_paise;
    }

    logPartnerActivity(partner.id, actorUserId, "PAYOUT_REQUESTED", { payoutId: reqId, amountPaise: amt });
    db.exec("COMMIT;");
    return { status: 201, payout: db.prepare("SELECT * FROM partner_payout_requests WHERE id = ?").get(reqId) };
  } catch (err) {
    db.exec("ROLLBACK;");
    throw err;
  }
}

export function adminProcessPayout(payoutId, adminUserId, { status, rejectionReason }) {
  if (!["APPROVED", "REJECTED", "PAID"].includes(status)) {
    return { status: 400, error: "Invalid payout status. Allowed: APPROVED, REJECTED, PAID" };
  }
  const payout = db.prepare("SELECT * FROM partner_payout_requests WHERE id = ?").get(payoutId);
  if (!payout) return { status: 404, error: "Payout request not found" };
  if (status === "REJECTED" && !rejectionReason) {
    return { status: 400, error: "Rejection reason is required." };
  }

  db.exec("BEGIN IMMEDIATE;");
  try {
    db.prepare(`
      UPDATE partner_payout_requests SET status = ?, rejection_reason = ?, processed_by = ?, processed_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(status, status === "REJECTED" ? rejectionReason : null, adminUserId, payoutId);

    if (status === "PAID") {
      db.prepare("UPDATE partner_commissions SET status = 'PAID', payout_date = CURRENT_TIMESTAMP WHERE payout_request_id = ?").run(payoutId);
    } else if (status === "REJECTED") {
      db.prepare("UPDATE partner_commissions SET status = 'APPROVED', payout_request_id = NULL WHERE payout_request_id = ?").run(payoutId);
    }

    notifyPartner(payout.partner_id, {
      category: "PAYOUT",
      title: `Payout ${status.toLowerCase()}`,
      message: status === "PAID"
        ? `Payout of ₹${fromPaise(payout.amount_paise)} has been processed.`
        : status === "REJECTED"
          ? `Payout rejected: ${rejectionReason}`
          : `Payout request approved for processing.`,
      relatedModule: "commissions",
      relatedId: payoutId
    });
    db.exec("COMMIT;");
    return { status: 200, payout: db.prepare("SELECT * FROM partner_payout_requests WHERE id = ?").get(payoutId) };
  } catch (err) {
    db.exec("ROLLBACK;");
    throw err;
  }
}

export function getPartnerFilingMonitor(partnerId, { period, statusFilter = "", gstinFilter = "" } = {}) {
  const now = new Date();
  const activePeriod = period || `${String(now.getMonth() + 1).padStart(2, "0")}${now.getFullYear()}`;
  const dueInfo = getStatutoryDueDates(activePeriod);

  const customers = db.prepare(`
    SELECT * FROM partner_customers
    WHERE partner_id = ? AND consent_granted = 1 AND onboarding_status = 'ACTIVE' AND org_id IS NOT NULL
  `).all(partnerId);

  const items = [];
  for (const cust of customers) {
    const gstins = db.prepare("SELECT * FROM gst_registrations WHERE org_id = ? AND is_active = 1").all(cust.org_id);
    for (const g of gstins) {
      if (gstinFilter && !g.gstin.includes(gstinFilter.toUpperCase())) continue;
      const salesCnt = db.prepare("SELECT COUNT(*) as c FROM sales_invoices WHERE gstin_id = ? AND period = ?").get(g.id, activePeriod)?.c || 0;
      const purCnt = db.prepare("SELECT COUNT(*) as c FROM purchase_invoices WHERE gstin_id = ? AND period = ?").get(g.id, activePeriod)?.c || 0;
      const reconCnt = db.prepare("SELECT COUNT(*) as c FROM reconciliation_results WHERE gstin_id = ? AND period = ?").get(g.id, activePeriod)?.c || 0;
      const gstr1Row = db.prepare("SELECT status, filing_date FROM tax_returns WHERE gstin_id = ? AND period = ? AND return_type = 'GSTR1' LIMIT 1").get(g.id, activePeriod);
      const gstr3bRow = db.prepare("SELECT status, filing_date FROM tax_returns WHERE gstin_id = ? AND period = ? AND return_type = 'GSTR3B' LIMIT 1").get(g.id, activePeriod);

      const gstr1Status = gstr1Row ? gstr1Row.status : (salesCnt > 0 ? "UNDER_PREPARATION" : "NOT_STARTED");
      const gstr3bStatus = gstr3bRow ? gstr3bRow.status : ((salesCnt > 0 || purCnt > 0) ? "UNDER_PREPARATION" : "NOT_STARTED");
      const reconStatus = reconCnt > 0 ? "RECONCILED" : (purCnt > 0 ? "PENDING" : "NOT_STARTED");
      const overallStatus = gstr3bRow ? "FILED" : (salesCnt === 0 && purCnt === 0 ? "DATA_PENDING" : "UNDER_PREPARATION");

      if (statusFilter && overallStatus !== statusFilter) continue;

      items.push({
        customerId: cust.id,
        customerName: cust.business_name,
        gstin: g.gstin,
        period: activePeriod,
        gstr1Status,
        gstr3bStatus,
        reconStatus,
        dueDate: dueInfo?.gstr3b || "20th of next month",
        filingStatus: overallStatus,
        lastUpdated: gstr3bRow?.filing_date || cust.updated_at
      });
    }
  }

  return {
    period: activePeriod,
    dueDates: dueInfo,
    metrics: {
      totalCustomers: customers.length,
      returnsPending: items.filter(i => i.filingStatus !== "FILED").length,
      returnsCompleted: items.filter(i => i.filingStatus === "FILED").length,
      overdueReturns: items.filter(i => i.filingStatus === "OVERDUE").length
    },
    items
  };
}

export function getPartnerLeaderboard(currentPartnerId) {
  const approved = db.prepare("SELECT id, partner_code, business_name, tier, state FROM partners WHERE status = 'APPROVED'").all();
  const rows = approved.map(p => {
    const customers = db.prepare("SELECT COUNT(*) as c FROM partner_customers WHERE partner_id = ? AND onboarding_status = 'ACTIVE'").get(p.id)?.c || 0;
    const conversions = db.prepare("SELECT COUNT(*) as c FROM partner_leads WHERE partner_id = ? AND status = 'CONVERTED'").get(p.id)?.c || 0;
    const revenuePaise = db.prepare("SELECT COALESCE(SUM(transaction_amount_paise), 0) as s FROM partner_commissions WHERE partner_id = ? AND status != 'REJECTED' AND status != 'REVERSED'").get(p.id)?.s || 0;
    const score = customers * 10 + conversions * 25 + Math.floor(revenuePaise / 100000);
    return {
      isSelf: p.id === currentPartnerId,
      partnerCode: p.partner_code,
      displayName: p.id === currentPartnerId ? p.business_name : `${p.business_name.slice(0, 3)}*** (${p.state})`,
      tier: p.tier,
      customers,
      conversions,
      revenuePaise,
      score
    };
  });
  rows.sort((a, b) => b.score - a.score);
  return rows.map((r, idx) => ({ ...r, rank: idx + 1 }));
}
