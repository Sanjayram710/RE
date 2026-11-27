import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { db, userRepo, gstinRepo, salesRepo, purchaseRepo, reconciliationRepo, gstr2bRepo } from "./db.js";
import { validateGstin } from "./validate.js";
import { toPaise, percentOfPaise } from "./moneyPaise.js";
import { runReconciliation } from "./reconciliationEngine.js";
import { maskPan, getPartnerByUserId } from "./partnerEngine.js";
import {
  CA_TRAINING_MODULES,
  CA_STAFF_ROLES,
  resolveCaActor,
  requireCaAdmin,
  registerCaProfile,
  getCaProfileSummary,
  adminUpdateCaStatus,
  assertCustomerAuthorized,
  addCaCustomer,
  respondCaCustomerConsent,
  previewBulkCustomerImport,
  confirmBulkCustomerImport,
  prepareCaReturn,
  submitApprovalToCustomer,
  customerRespondReturnApproval,
  fileApprovedCaReturn,
  getCaComplianceOverview,
  logCaActivity,
  notifyCa
} from "./caEngine.js";

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function buildCookie(name, value, req, { httpOnly = true } = {}) {
  const isSecure = req?.headers?.["x-forwarded-proto"] === "https" || Boolean(req?.socket?.encrypted);
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "SameSite=Lax", "Max-Age=604800"];
  if (httpOnly) parts.push("HttpOnly");
  if (isSecure) parts.push("Secure");
  return parts.join("; ");
}

function saveCaVerificationDoc(caId, fileItem, docType) {
  const filename = fileItem.filename || `ca_doc_${Date.now()}.pdf`;
  const ext = path.extname(filename).toLowerCase();
  if (![".pdf", ".png", ".jpg", ".jpeg"].includes(ext)) {
    return { status: 400, error: "Unsupported format. Allowed: PDF, PNG, JPG, JPEG." };
  }
  const bytes = Buffer.isBuffer(fileItem.data) ? fileItem.data : Buffer.from(fileItem.data || "");
  if (bytes.length === 0 || bytes.length > 15 * 1024 * 1024) {
    return { status: 400, error: "Document must be between 1 byte and 15 MB." };
  }
  if (ext === ".pdf" && !bytes.subarray(0, 16).toString("latin1").includes("%PDF-")) {
    return { status: 400, error: "Invalid PDF magic bytes." };
  }
  if (ext === ".png" && !bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { status: 400, error: "Invalid PNG magic bytes." };
  }
  if ((ext === ".jpg" || ext === ".jpeg") && (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff)) {
    return { status: 400, error: "Invalid JPEG magic bytes." };
  }

  const dir = path.join(process.cwd(), "data", "uploads", "ca");
  fs.mkdirSync(dir, { recursive: true });
  const storagePath = path.join(dir, `${crypto.randomUUID()}${ext}`);
  fs.writeFileSync(storagePath, bytes);

  const id = `cadoc-${crypto.randomUUID()}`;
  db.prepare(`
    INSERT INTO ca_verification_documents (id, ca_id, doc_type, original_name, storage_path, mime_type, size_bytes, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'UPLOADED')
  `).run(id, caId, docType || "CA_CREDENTIAL", filename, storagePath, fileItem.contentType || "application/octet-stream", bytes.length);

  return { status: 201, document: db.prepare("SELECT id, ca_id, doc_type, original_name, mime_type, size_bytes, status, created_at FROM ca_verification_documents WHERE id = ?").get(id) };
}

export async function handleCaRoutes(req, res, pathname, method, query, body, context) {
  // 1. Public CA Registration
  if (pathname === "/api/ca/register" && method === "POST") {
    const result = registerCaProfile(body);
    if (result.error) return sendJson(res, result.status, { error: result.error });
    res.setHeader("Set-Cookie", [
      buildCookie("simplegst_session", result.session.token, req, { httpOnly: true }),
      buildCookie("simplegst_csrf", result.session.csrf_token, req, { httpOnly: false })
    ]);
    return sendJson(res, 201, {
      success: true,
      csrfToken: result.session.csrf_token,
      profile: result.profile
    });
  }

  // 2. Customer CA Consent & Return Approval Endpoints (for /app Customer Dashboard)
  if (pathname === "/api/customer/ca-consents" && method === "GET") {
    if (!context?.authenticated || !context.user) return sendJson(res, 401, { error: "Authentication required" });
    const rows = db.prepare(`
      SELECT ca_cust.*, cp.firm_name, cp.ca_code, cp.category
      FROM ca_customer_assignments ca_cust
      JOIN ca_profiles cp ON cp.id = ca_cust.ca_id
      WHERE ca_cust.customer_user_id = ?
      ORDER BY ca_cust.created_at DESC
    `).all(context.user.id);
    return sendJson(res, 200, { success: true, consents: rows });
  }

  if (pathname.match(/^\/api\/customer\/ca-consents\/[^/]+\/respond$/) && method === "POST") {
    if (!context?.authenticated || !context.user) return sendJson(res, 401, { error: "Authentication required" });
    const id = pathname.split("/")[4];
    const result = respondCaCustomerConsent(context.user.id, id, body?.action);
    if (result.error) return sendJson(res, result.status, { error: result.error });
    return sendJson(res, 200, { success: true, customer: result.customer });
  }

  if (pathname === "/api/customer/ca-approvals" && method === "GET") {
    if (!context?.authenticated || !context.user) return sendJson(res, 401, { error: "Authentication required" });
    const rows = db.prepare(`
      SELECT a.*, cp.firm_name, cp.ca_code
      FROM ca_filing_approvals a
      JOIN ca_customer_assignments c ON c.id = a.customer_id
      JOIN ca_profiles cp ON cp.id = a.ca_id
      WHERE c.customer_user_id = ?
      ORDER BY a.updated_at DESC
    `).all(context.user.id);
    return sendJson(res, 200, { success: true, approvals: rows });
  }

  if (pathname.match(/^\/api\/customer\/ca-approvals\/[^/]+\/respond$/) && method === "POST") {
    if (!context?.authenticated || !context.user) return sendJson(res, 401, { error: "Authentication required" });
    const id = pathname.split("/")[4];
    const result = customerRespondReturnApproval(context.user.id, id, body || {});
    if (result.error) return sendJson(res, result.status, { error: result.error });
    return sendJson(res, 200, { success: true, approval: result.approval });
  }

  // 3. Admin CA Management Endpoints
  if (pathname.startsWith("/api/admin/cas")) {
    const adm = requireCaAdmin(context);
    if (!adm.ok) return sendJson(res, adm.status, { error: adm.error });

    if (pathname === "/api/admin/cas" && method === "GET") {
      const profiles = db.prepare("SELECT * FROM ca_profiles ORDER BY created_at DESC").all().map(p => getCaProfileSummary(p));
      return sendJson(res, 200, { success: true, cas: profiles });
    }
    if (pathname.match(/^\/api\/admin\/cas\/[^/]+\/status$/) && method === "POST") {
      const caId = pathname.split("/")[4];
      const result = adminUpdateCaStatus(caId, context.user.id, body || {});
      if (result.error) return sendJson(res, result.status, { error: result.error });
      return sendJson(res, 200, { success: true, profile: result.profile });
    }
    return sendJson(res, 404, { error: "Admin CA endpoint not found" });
  }

  // 4. CA / GST Agent Endpoints
  if (!pathname.startsWith("/api/ca/")) return false;

  const pendingPaths = ["/api/ca/profile", "/api/ca/documents", "/api/ca/notifications", "/api/ca/support", "/api/ca/training"];
  const allowPending = pendingPaths.some(p => pathname === p || pathname.startsWith(p + "/"));
  const gate = resolveCaActor(context, { allowPending });
  if (!gate.ok) return sendJson(res, gate.status, { error: gate.error });
  const { ca } = gate;

  if (pathname === "/api/ca/profile" && method === "GET") {
    return sendJson(res, 200, { success: true, profile: getCaProfileSummary(ca), staffRole: gate.staffRole, isStaff: gate.isStaff });
  }
  if (pathname === "/api/ca/profile" && method === "PUT") {
    if (gate.isStaff) return sendJson(res, 403, { error: "Only CA Firm Owner can update firm profile." });
    const { firmName, officeAddress, state, district, pincode, membershipNumber, submitApplication } = body || {};
    const nextStatus = submitApplication && ca.status === "DRAFT" ? "SUBMITTED" : ca.status;
    db.prepare(`
      UPDATE ca_profiles SET firm_name = ?, office_address = ?, state = ?, district = ?, pincode = ?, membership_number = ?, status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(firmName || ca.firm_name, officeAddress || ca.office_address, state || ca.state, district || ca.district, pincode || ca.pincode, membershipNumber !== undefined ? membershipNumber : ca.membership_number, nextStatus, ca.id);
    logCaActivity(ca.id, context.user.id, "CA_PROFILE_UPDATED", { nextStatus });
    return sendJson(res, 200, { success: true, profile: getCaProfileSummary(db.prepare("SELECT * FROM ca_profiles WHERE id = ?").get(ca.id)) });
  }
  if (pathname === "/api/ca/documents" && method === "POST") {
    const fileItem = body?.files?.[0] || body;
    if (!fileItem || (!fileItem.data && !fileItem.filename)) return sendJson(res, 400, { error: "Verification file required." });
    const resDoc = saveCaVerificationDoc(ca.id, fileItem, body?.docType || "CA_CREDENTIAL");
    if (resDoc.error) return sendJson(res, resDoc.status, { error: resDoc.error });
    return sendJson(res, 201, { success: true, document: resDoc.document });
  }
  if (pathname === "/api/ca/training" && method === "GET") {
    return sendJson(res, 200, { success: true, modules: CA_TRAINING_MODULES });
  }
  if (pathname === "/api/ca/notifications" && method === "GET") {
    const items = db.prepare("SELECT * FROM ca_notifications WHERE ca_id = ? ORDER BY created_at DESC LIMIT 50").all(ca.id);
    return sendJson(res, 200, { success: true, unreadCount: items.filter(i => !i.is_read).length, notifications: items });
  }
  if (pathname === "/api/ca/notifications/read-all" && method === "POST") {
    db.prepare("UPDATE ca_notifications SET is_read = 1 WHERE ca_id = ?").run(ca.id);
    return sendJson(res, 200, { success: true });
  }
  if (pathname === "/api/ca/support/tickets" && method === "GET") {
    return sendJson(res, 200, { success: true, tickets: db.prepare("SELECT * FROM ca_support_tickets WHERE ca_id = ? ORDER BY updated_at DESC").all(ca.id) });
  }
  if (pathname === "/api/ca/support/tickets" && method === "POST") {
    const { category, subject, description } = body || {};
    if (!category || !subject || !description) return sendJson(res, 400, { error: "category, subject, and description are required" });
    const id = `catkt-${crypto.randomUUID()}`;
    db.prepare("INSERT INTO ca_support_tickets (id, ca_id, category, subject, description) VALUES (?, ?, ?, ?, ?)")
      .run(id, ca.id, category, String(subject).trim(), String(description).trim());
    db.prepare("INSERT INTO ca_support_messages (id, ticket_id, sender_user_id, sender_role, message) VALUES (?, ?, ?, 'CA', ?)")
      .run(`camsg-${crypto.randomUUID()}`, id, context.user.id, String(description).trim());
    return sendJson(res, 201, { success: true, ticket: db.prepare("SELECT * FROM ca_support_tickets WHERE id = ?").get(id) });
  }

  // Approved-only routes below:
  if (pathname === "/api/ca/overview" && method === "GET") {
    const compliance = getCaComplianceOverview(gate, query?.period);
    let custSql = "SELECT * FROM ca_customer_assignments WHERE ca_id = ?";
    const params = [ca.id];
    if (gate.isStaff) {
      custSql += " AND (assigned_staff_id = ? OR id IN (SELECT customer_id FROM ca_staff_customer_assignments WHERE staff_id = ?))";
      params.push(gate.staffId, gate.staffId);
    }
    const allCustomers = db.prepare(custSql).all(...params);
    const activeCustomers = allCustomers.filter(c => c.consent_granted && c.consent_status === "ACTIVE");
    const approvals = db.prepare("SELECT * FROM ca_filing_approvals WHERE ca_id = ? ORDER BY updated_at DESC").all(ca.id);
    const revenuePaise = db.prepare("SELECT COALESCE(SUM(total_paise), 0) as s FROM ca_service_invoices WHERE ca_id = ? AND status = 'PAID'").get(ca.id)?.s || 0;
    const activities = db.prepare("SELECT * FROM ca_activity_logs WHERE ca_id = ? ORDER BY created_at DESC LIMIT 8").all(ca.id);

    return sendJson(res, 200, {
      success: true,
      kpis: {
        totalCustomers: allCustomers.length,
        activeCustomers: activeCustomers.length,
        totalGstins: compliance.items.length,
        returnsPending: compliance.items.filter(i => i.complianceStatus !== "Compliant").length,
        returnsPrepared: approvals.filter(a => a.status === "DRAFT").length,
        returnsAwaitingApproval: approvals.filter(a => a.status === "AWAITING_CUSTOMER_APPROVAL").length,
        returnsFiled: compliance.items.filter(i => i.complianceStatus === "Compliant").length,
        overdueCustomers: compliance.items.filter(i => i.complianceStatus === "Overdue").length,
        monthlyRevenuePaise: revenuePaise
      },
      dueDates: compliance.dueDates,
      recentCustomers: allCustomers.slice(0, 5),
      pendingApprovals: approvals.filter(a => ["DRAFT", "AWAITING_CUSTOMER_APPROVAL", "CHANGES_REQUESTED"].includes(a.status)).slice(0, 5),
      recentActivities: activities
    });
  }

  // Customers
  if (pathname === "/api/ca/customers" && method === "GET") {
    let sql = "SELECT * FROM ca_customer_assignments WHERE ca_id = ?";
    const params = [ca.id];
    if (gate.isStaff) {
      sql += " AND (assigned_staff_id = ? OR id IN (SELECT customer_id FROM ca_staff_customer_assignments WHERE staff_id = ?))";
      params.push(gate.staffId, gate.staffId);
    }
    if (query?.status) { sql += " AND consent_status = ?"; params.push(query.status); }
    if (query?.search) {
      const q = `%${String(query.search).trim()}%`;
      sql += " AND (customer_name LIKE ? OR business_name LIKE ? OR email LIKE ? OR mobile LIKE ?)";
      params.push(q, q, q, q);
    }
    sql += " ORDER BY created_at DESC";
    const all = db.prepare(sql).all(...params).map(c => {
      const gstins = (c.consent_granted && c.org_id)
        ? db.prepare("SELECT id, gstin, trade_name, state_code, state_name, filing_frequency, is_active FROM gst_registrations WHERE org_id = ?").all(c.org_id)
        : [];
      return { ...c, pan: maskPan(c.pan), gstinCount: gstins.length, gstins };
    });
    return sendJson(res, 200, { success: true, total: all.length, customers: all });
  }
  if (pathname === "/api/ca/customers" && method === "POST") {
    const result = addCaCustomer(ca, context.user.id, body);
    if (result.error) return sendJson(res, result.status, { error: result.error });
    return sendJson(res, 201, { success: true, customer: result.customer });
  }
  if (pathname.match(/^\/api\/ca\/customers\/[^/]+$/) && method === "GET") {
    const custId = pathname.split("/")[4];
    const auth = assertCustomerAuthorized(gate, custId);
    if (!auth.ok) return sendJson(res, auth.status, { error: auth.error });
    const gstins = db.prepare("SELECT * FROM gst_registrations WHERE org_id = ?").all(auth.customer.org_id);
    const invoices = gstins[0] ? salesRepo.list(gstins[0].id) : [];
    const purchases = gstins[0] ? purchaseRepo.list(gstins[0].id) : [];
    const returns = gstins[0] ? db.prepare("SELECT * FROM tax_returns WHERE gstin_id = ? ORDER BY filing_date DESC").all(gstins[0].id) : [];
    return sendJson(res, 200, { success: true, customer: { ...auth.customer, pan: maskPan(auth.customer.pan) }, gstins, invoices, purchases, returns });
  }
  if (pathname.match(/^\/api\/ca\/customers\/[^/]+\/gstins$/) && method === "POST") {
    const custId = pathname.split("/")[4];
    const auth = assertCustomerAuthorized(gate, custId);
    if (!auth.ok) return sendJson(res, auth.status, { error: auth.error });
    const cleanGstin = String(body?.gstin || "").trim().toUpperCase();
    const gc = validateGstin(cleanGstin);
    if (!gc.valid) return sendJson(res, 400, { error: gc.error });
    if (db.prepare("SELECT id FROM gst_registrations WHERE gstin = ?").get(cleanGstin)) {
      return sendJson(res, 409, { error: `GSTIN '${cleanGstin}' already exists.` });
    }
    const created = gstinRepo.create({
      orgId: auth.customer.org_id,
      gstin: cleanGstin,
      tradeName: body?.tradeName || auth.customer.business_name,
      stateCode: cleanGstin.slice(0, 2),
      stateName: body?.stateName || auth.customer.state,
      address: auth.customer.address,
      filingFrequency: body?.filingFrequency || "MONTHLY",
      isPrimary: 0
    });
    logCaActivity(ca.id, context.user.id, "CA_GSTIN_ADDED", { customerId: custId, gstin: cleanGstin });
    return sendJson(res, 201, { success: true, gstin: created });
  }

  // Bulk Import
  if (pathname === "/api/ca/bulk-import/template" && method === "GET") {
    const csv = "customerName,businessName,email,mobile,businessType,pan,gstin,state,district,address,pincode\n" +
      "Ramesh Kumar,Ramesh Kirana Store,ramesh@example.com,9876543210,Proprietorship,AAACR1234E,27AAACR1234E1Z5,Maharashtra,Pune,FC Road Pune,411004\n";
    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="SimpleGST_CA_Bulk_Customer_Template.csv"'
    });
    res.end(csv);
    return true;
  }
  if (pathname === "/api/ca/bulk-import/preview" && method === "POST") {
    const fileItem = body?.files?.[0] || body;
    const result = previewBulkCustomerImport(ca, fileItem);
    if (result.error) return sendJson(res, result.status, { error: result.error });
    return sendJson(res, 201, { success: true, job: result.job, records: result.records });
  }
  if (pathname.match(/^\/api\/ca\/bulk-import\/[^/]+\/confirm$/) && method === "POST") {
    const jobId = pathname.split("/")[4];
    const result = confirmBulkCustomerImport(ca, context.user.id, jobId);
    if (result.error) return sendJson(res, result.status, { error: result.error });
    return sendJson(res, 200, { success: true, job: result.job, imported: result.imported, failed: result.failed });
  }
  if (pathname.match(/^\/api\/ca\/bulk-import\/[^/]+\/errors\.csv$/) && method === "GET") {
    const jobId = pathname.split("/")[4];
    const job = db.prepare("SELECT * FROM ca_bulk_import_jobs WHERE id = ? AND ca_id = ?").get(jobId, ca.id);
    if (!job) return sendJson(res, 404, { error: "Job not found" });
    const badRows = db.prepare("SELECT * FROM ca_bulk_import_records WHERE job_id = ? AND status IN ('INVALID','DUPLICATE','FAILED') ORDER BY row_index ASC").all(jobId);
    let csv = "Row,Status,Error,Email,PAN,GSTIN\n";
    for (const r of badRows) {
      const p = JSON.parse(r.raw_json);
      csv += `${r.row_index},"${r.status}","${String(r.error_message || "").replace(/"/g, '""')}","${p.email || ""}","${p.pan || ""}","${p.gstin || ""}"\n`;
    }
    res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="Import_Errors_${jobId}.csv"` });
    res.end(csv);
    return true;
  }
  if (pathname === "/api/ca/bulk-import/jobs" && method === "GET") {
    return sendJson(res, 200, { success: true, jobs: db.prepare("SELECT * FROM ca_bulk_import_jobs WHERE ca_id = ? ORDER BY created_at DESC LIMIT 20").all(ca.id) });
  }

  // Return Preparation & Approvals
  if (pathname === "/api/ca/returns/prepare" && method === "POST") {
    const result = prepareCaReturn(gate, body || {});
    if (result.error) return sendJson(res, result.status, { error: result.error });
    return sendJson(res, 201, { success: true, approval: result.approval });
  }
  if (pathname === "/api/ca/approvals" && method === "GET") {
    const rows = db.prepare(`
      SELECT a.*, c.business_name as customer_name
      FROM ca_filing_approvals a JOIN ca_customer_assignments c ON c.id = a.customer_id
      WHERE a.ca_id = ? ORDER BY a.updated_at DESC
    `).all(ca.id);
    return sendJson(res, 200, { success: true, approvals: rows });
  }
  if (pathname.match(/^\/api\/ca\/approvals\/[^/]+\/submit$/) && method === "POST") {
    const id = pathname.split("/")[4];
    const result = submitApprovalToCustomer(gate, id);
    if (result.error) return sendJson(res, result.status, { error: result.error });
    return sendJson(res, 200, { success: true, approval: result.approval });
  }
  if (pathname.match(/^\/api\/ca\/approvals\/[^/]+\/file$/) && method === "POST") {
    const id = pathname.split("/")[4];
    const result = fileApprovedCaReturn(gate, id);
    return sendJson(res, result.status, result);
  }
  if (pathname.match(/^\/api\/ca\/approvals\/[^/]+\/history$/) && method === "GET") {
    const id = pathname.split("/")[4];
    const app = db.prepare("SELECT * FROM ca_filing_approvals WHERE id = ? AND ca_id = ?").get(id, ca.id);
    if (!app) return sendJson(res, 404, { error: "Approval not found" });
    return sendJson(res, 200, { success: true, history: db.prepare("SELECT * FROM ca_approval_history WHERE approval_id = ? ORDER BY created_at ASC").all(id) });
  }

  // Customer Invoices & Reconciliation (reusing existing salesRepo, purchaseRepo, reconciliationEngine)
  if (pathname.match(/^\/api\/ca\/customers\/[^/]+\/reconciliation$/) && method === "GET") {
    const custId = pathname.split("/")[4];
    const auth = assertCustomerAuthorized(gate, custId);
    if (!auth.ok) return sendJson(res, auth.status, { error: auth.error });
    const gstinId = query?.gstinId || db.prepare("SELECT id FROM gst_registrations WHERE org_id = ? LIMIT 1").get(auth.customer.org_id)?.id;
    if (!gstinId) return sendJson(res, 200, { success: true, items: [], summary: {} });
    const period = query?.period || `${String(new Date().getMonth() + 1).padStart(2, "0")}${new Date().getFullYear()}`;
    const purchases = purchaseRepo.list(gstinId, period);
    const g2b = gstr2bRepo.list(gstinId, period);
    const recon = runReconciliation({ gstinId, period, purchases, gstr2bEntries: g2b });
    return sendJson(res, 200, { success: true, period, ...recon });
  }

  // Compliance Calendar & Reminders
  if (pathname === "/api/ca/compliance" && method === "GET") {
    return sendJson(res, 200, { success: true, ...getCaComplianceOverview(gate, query?.period) });
  }
  if (pathname === "/api/ca/compliance/remind" && method === "POST") {
    const auth = assertCustomerAuthorized(gate, body?.customerId);
    if (!auth.ok) return sendJson(res, auth.status, { error: auth.error });
    logCaActivity(ca.id, context.user.id, "COMPLIANCE_REMINDER_SENT", { customerId: body?.customerId, period: body?.period });
    return sendJson(res, 200, { success: true, message: `Compliance reminder logged for ${auth.customer.business_name}` });
  }

  // Billing (Professional Service Invoices separated from Partner Commissions)
  if (pathname === "/api/ca/billing" && method === "GET") {
    const invoices = db.prepare(`
      SELECT i.*, c.business_name as customer_name
      FROM ca_service_invoices i JOIN ca_customer_assignments c ON c.id = i.customer_id
      WHERE i.ca_id = ? ORDER BY i.created_at DESC
    `).all(ca.id);
    const partner = getPartnerByUserId(ca.user_id);
    const partnerCommissions = (partner && partner.status === "APPROVED")
      ? db.prepare("SELECT * FROM partner_commissions WHERE partner_id = ? ORDER BY created_at DESC").all(partner.id)
      : [];
    return sendJson(res, 200, {
      success: true,
      serviceInvoices: invoices,
      hasApprovedPartnerRole: Boolean(partner && partner.status === "APPROVED"),
      partnerCommissions
    });
  }
  if (pathname === "/api/ca/billing" && method === "POST") {
    const auth = assertCustomerAuthorized(gate, body?.customerId);
    if (!auth.ok) return sendJson(res, auth.status, { error: auth.error });
    const amountPaise = body?.amountPaise !== undefined ? Number(body.amountPaise) : toPaise(body?.amount || 0);
    if (!amountPaise || amountPaise <= 0 || !body?.serviceDescription) {
      return sendJson(res, 400, { error: "serviceDescription and positive amount are required." });
    }
    const gstRate = Number(body?.gstRate ?? 18);
    const taxPaise = percentOfPaise(amountPaise, gstRate);
    const totalPaise = amountPaise + taxPaise;
    const invNum = `CAINV-${Date.now().toString().slice(-6)}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
    const id = `cainv-${crypto.randomUUID()}`;
    db.prepare(`
      INSERT INTO ca_service_invoices (id, ca_id, customer_id, invoice_number, service_description, amount_paise, tax_paise, total_paise, status, due_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'UNPAID', ?)
    `).run(id, ca.id, auth.customer.id, invNum, String(body.serviceDescription).trim(), amountPaise, taxPaise, totalPaise, body?.dueDate || null);
    return sendJson(res, 201, { success: true, invoice: db.prepare("SELECT * FROM ca_service_invoices WHERE id = ?").get(id) });
  }
  if (pathname.match(/^\/api\/ca\/billing\/[^/]+\/mark-paid$/) && method === "POST") {
    const id = pathname.split("/")[4];
    const inv = db.prepare("SELECT * FROM ca_service_invoices WHERE id = ? AND ca_id = ?").get(id, ca.id);
    if (!inv) return sendJson(res, 404, { error: "Service invoice not found" });
    db.prepare("UPDATE ca_service_invoices SET status = 'PAID', paid_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
    return sendJson(res, 200, { success: true, invoice: db.prepare("SELECT * FROM ca_service_invoices WHERE id = ?").get(id) });
  }

  // Team & Staff Management
  if (pathname === "/api/ca/team" && method === "GET") {
    if (gate.isStaff) return sendJson(res, 403, { error: "Only CA Firm Owner can manage team." });
    const staff = db.prepare("SELECT * FROM ca_staff_members WHERE ca_id = ? ORDER BY created_at DESC").all(ca.id);
    const assignments = db.prepare("SELECT * FROM ca_staff_customer_assignments WHERE ca_id = ?").all(ca.id);
    return sendJson(res, 200, { success: true, staff, assignments });
  }
  if (pathname === "/api/ca/team/invite" && method === "POST") {
    if (gate.isStaff) return sendJson(res, 403, { error: "Only CA Firm Owner can invite staff." });
    const { fullName, email, role = "Accountant", password = "Staff@1234" } = body || {};
    if (!fullName || !email || !CA_STAFF_ROLES.includes(role)) {
      return sendJson(res, 400, { error: "Valid fullName, email, and role are required." });
    }
    const emailVal = String(email).trim().toLowerCase();
    if (db.prepare("SELECT id FROM ca_staff_members WHERE ca_id = ? AND email = ?").get(ca.id, emailVal)) {
      return sendJson(res, 409, { error: "Staff member already invited." });
    }
    let user = userRepo.findByEmail(emailVal);
    if (!user) {
      user = userRepo.create({
        email: emailVal,
        passwordHash: userRepo.hashPassword(password),
        fullName: String(fullName).trim(),
        role: "ACCOUNTANT",
        onboardingStatus: "COMPLETED",
        onboardingStep: 4
      });
    }
    const id = `castf-${crypto.randomUUID()}`;
    db.prepare("INSERT INTO ca_staff_members (id, ca_id, user_id, full_name, email, role, status) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')")
      .run(id, ca.id, user.id, String(fullName).trim(), emailVal, role);
    return sendJson(res, 201, { success: true, staff: db.prepare("SELECT * FROM ca_staff_members WHERE id = ?").get(id) });
  }
  if (pathname === "/api/ca/team/assign" && method === "POST") {
    if (gate.isStaff) return sendJson(res, 403, { error: "Only CA Firm Owner can assign customers to staff." });
    const { staffId, customerId, taskType = "GST_RETURN_PREP" } = body || {};
    const stf = db.prepare("SELECT id FROM ca_staff_members WHERE id = ? AND ca_id = ?").get(staffId, ca.id);
    const cst = db.prepare("SELECT id FROM ca_customer_assignments WHERE id = ? AND ca_id = ?").get(customerId, ca.id);
    if (!stf || !cst) return sendJson(res, 404, { error: "Staff or customer not found in your CA firm." });
    db.prepare("UPDATE ca_customer_assignments SET assigned_staff_id = ? WHERE id = ?").run(staffId, customerId);
    db.prepare("INSERT OR IGNORE INTO ca_staff_customer_assignments (id, ca_id, staff_id, customer_id, task_type, task_status) VALUES (?, ?, ?, ?, ?, 'PENDING')")
      .run(`casca-${crypto.randomUUID()}`, ca.id, staffId, customerId, taskType);
    return sendJson(res, 201, { success: true });
  }

  if (pathname === "/api/ca/activities" && method === "GET") {
    return sendJson(res, 200, { success: true, activities: db.prepare("SELECT * FROM ca_activity_logs WHERE ca_id = ? ORDER BY created_at DESC LIMIT 50").all(ca.id) });
  }

  return sendJson(res, 404, { error: "CA endpoint not found" });
}
