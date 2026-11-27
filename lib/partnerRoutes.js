import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { db } from "./db.js";
import {
  TRAINING_MODULES,
  requirePartnerAccess,
  requireAdminAccess,
  registerPartner,
  getPartnerProfileSummary,
  updatePartnerProfile,
  adminUpdatePartnerStatus,
  assignTerritory,
  getPartnerTerritories,
  onboardCustomer,
  respondCustomerConsent,
  listPartnerCustomers,
  addGstinForPartnerCustomer,
  createAdminLead,
  updatePartnerLead,
  convertLeadToCustomer,
  recordPartnerCommission,
  requestPartnerPayout,
  adminProcessPayout,
  getPartnerFilingMonitor,
  getPartnerLeaderboard,
  logPartnerActivity,
  notifyPartner
} from "./partnerEngine.js";
import { toPaise } from "./moneyPaise.js";

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

function savePartnerDocFile(partnerId, fileItem, docType) {
  const filename = fileItem.filename || `doc_${Date.now()}.pdf`;
  const ext = path.extname(filename).toLowerCase();
  const allowedExts = [".pdf", ".png", ".jpg", ".jpeg"];
  if (!allowedExts.includes(ext)) {
    return { status: 400, error: "Unsupported document format. Allowed: PDF, PNG, JPG, JPEG." };
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

  const dir = path.join(process.cwd(), "data", "uploads", "partner");
  fs.mkdirSync(dir, { recursive: true });
  const storedKey = `${crypto.randomUUID()}${ext}`;
  const storagePath = path.join(dir, storedKey);
  fs.writeFileSync(storagePath, bytes);

  const id = `pdoc-${crypto.randomUUID()}`;
  db.prepare(`
    INSERT INTO partner_documents (id, partner_id, doc_type, original_name, storage_path, mime_type, size_bytes, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'UPLOADED')
  `).run(id, partnerId, docType || "KYC_DOCUMENT", filename, storagePath, fileItem.contentType || "application/octet-stream", bytes.length);

  return { status: 201, document: db.prepare("SELECT id, partner_id, doc_type, original_name, mime_type, size_bytes, status, created_at FROM partner_documents WHERE id = ?").get(id) };
}

export async function handlePartnerRoutes(req, res, pathname, method, query, body, context) {
  // 1. Public Partner Registration
  if (pathname === "/api/partner/register" && method === "POST") {
    const result = registerPartner(body);
    if (result.error) return sendJson(res, result.status, { error: result.error });
    res.setHeader("Set-Cookie", [
      buildCookie("simplegst_session", result.session.token, req, { httpOnly: true }),
      buildCookie("simplegst_csrf", result.session.csrf_token, req, { httpOnly: false })
    ]);
    return sendJson(res, 201, {
      success: true,
      csrfToken: result.session.csrf_token,
      partner: getPartnerProfileSummary(result.partner)
    });
  }

  // 2. Customer Consent Endpoints (Customer Dashboard / Settings)
  if (pathname === "/api/customer/partner-consents" && method === "GET") {
    if (!context?.authenticated || !context.user) return sendJson(res, 401, { error: "Authentication required" });
    const rows = db.prepare(`
      SELECT pc.*, p.business_name as partner_business_name, p.partner_code, p.category as partner_category
      FROM partner_customers pc
      JOIN partners p ON p.id = pc.partner_id
      WHERE pc.customer_user_id = ?
      ORDER BY pc.created_at DESC
    `).all(context.user.id);
    return sendJson(res, 200, { success: true, consents: rows });
  }

  if (pathname.startsWith("/api/customer/partner-consents/") && pathname.endsWith("/respond") && method === "POST") {
    if (!context?.authenticated || !context.user) return sendJson(res, 401, { error: "Authentication required" });
    const id = pathname.split("/")[4];
    const result = respondCustomerConsent(context.user.id, id, body?.action);
    if (result.error) return sendJson(res, result.status, { error: result.error });
    return sendJson(res, 200, { success: true, customer: result.customer });
  }

  // 3. Admin Partner Management Endpoints
  if (pathname.startsWith("/api/admin/partners")) {
    const adm = requireAdminAccess(context);
    if (!adm.ok) return sendJson(res, adm.status, { error: adm.error });

    if (pathname === "/api/admin/partners" && method === "GET") {
      const partners = db.prepare("SELECT * FROM partners ORDER BY created_at DESC").all().map(p => getPartnerProfileSummary(p));
      return sendJson(res, 200, { success: true, partners });
    }
    if (pathname.match(/^\/api\/admin\/partners\/[^/]+\/status$/) && method === "POST") {
      const partnerId = pathname.split("/")[4];
      const result = adminUpdatePartnerStatus(partnerId, context.user.id, body || {});
      if (result.error) return sendJson(res, result.status, { error: result.error });
      return sendJson(res, 200, { success: true, partner: getPartnerProfileSummary(result.partner) });
    }
    if (pathname === "/api/admin/partners/territories" && method === "POST") {
      const result = assignTerritory(context.user.id, body || {});
      if (result.error) return sendJson(res, result.status, { error: result.error });
      return sendJson(res, 201, { success: true, territoryIds: result.territoryIds });
    }
    if (pathname === "/api/admin/partners/leads" && method === "POST") {
      const result = createAdminLead(context.user.id, body || {});
      if (result.error) return sendJson(res, result.status, { error: result.error });
      return sendJson(res, 201, { success: true, lead: result.lead });
    }
    if (pathname === "/api/admin/partners/commission-rules" && method === "GET") {
      return sendJson(res, 200, { success: true, rules: db.prepare("SELECT * FROM partner_commission_rules").all() });
    }
    if (pathname === "/api/admin/partners/commission-rules" && method === "PUT") {
      const { ruleType, rateType = "PERCENT", rateValue, isActive = 1 } = body || {};
      if (!ruleType || rateValue === undefined) return sendJson(res, 400, { error: "ruleType and rateValue are required" });
      db.prepare(`
        UPDATE partner_commission_rules SET rate_type = ?, rate_value = ?, is_active = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
        WHERE rule_type = ?
      `).run(rateType, Number(rateValue), isActive ? 1 : 0, context.user.id, ruleType);
      return sendJson(res, 200, { success: true, rules: db.prepare("SELECT * FROM partner_commission_rules").all() });
    }
    if (pathname === "/api/admin/partners/commissions" && method === "POST") {
      const amtPaise = body?.transactionAmountPaise !== undefined ? Number(body.transactionAmountPaise) : toPaise(body?.transactionAmount || 0);
      const result = recordPartnerCommission({
        partnerId: body?.partnerId,
        customerId: body?.customerId || null,
        transactionRef: body?.transactionRef,
        sourceType: body?.sourceType,
        description: body?.description,
        transactionAmountPaise: amtPaise
      });
      if (result.error) return sendJson(res, result.status, { error: result.error });
      return sendJson(res, 201, { success: true, commission: result.commission });
    }
    if (pathname === "/api/admin/partners/payouts" && method === "GET") {
      const payouts = db.prepare(`
        SELECT pr.*, p.business_name, p.partner_code
        FROM partner_payout_requests pr JOIN partners p ON p.id = pr.partner_id
        ORDER BY pr.created_at DESC
      `).all();
      return sendJson(res, 200, { success: true, payouts });
    }
    if (pathname.match(/^\/api\/admin\/partners\/payouts\/[^/]+\/process$/) && method === "POST") {
      const payoutId = pathname.split("/")[5];
      const result = adminProcessPayout(payoutId, context.user.id, body || {});
      if (result.error) return sendJson(res, result.status, { error: result.error });
      return sendJson(res, 200, { success: true, payout: result.payout });
    }
    if (pathname === "/api/admin/partners/tiers" && method === "GET") {
      return sendJson(res, 200, { success: true, tiers: db.prepare("SELECT * FROM partner_tier_configs").all() });
    }
    if (pathname === "/api/admin/partners/tiers" && method === "PUT") {
      const { tier, minCustomers, minConversions, minRevenuePaise, commissionBonusBps } = body || {};
      if (!tier) return sendJson(res, 400, { error: "tier is required" });
      db.prepare(`
        UPDATE partner_tier_configs SET min_customers = ?, min_conversions = ?, min_revenue_paise = ?, commission_bonus_bps = ?, updated_at = CURRENT_TIMESTAMP
        WHERE tier = ?
      `).run(Number(minCustomers || 0), Number(minConversions || 0), Number(minRevenuePaise || 0), Number(commissionBonusBps || 0), tier);
      return sendJson(res, 200, { success: true, tiers: db.prepare("SELECT * FROM partner_tier_configs").all() });
    }
    if (pathname === "/api/admin/partners/services" && method === "GET") {
      return sendJson(res, 200, { success: true, services: db.prepare("SELECT * FROM partner_services").all() });
    }
    if (pathname === "/api/admin/partners/services" && method === "PUT") {
      const { id, pricePaise, commissionBps, isAvailable } = body || {};
      if (!id) return sendJson(res, 400, { error: "Service id is required" });
      db.prepare("UPDATE partner_services SET price_paise = ?, commission_bps = ?, is_available = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(Number(pricePaise || 0), Number(commissionBps || 0), isAvailable ? 1 : 0, id);
      return sendJson(res, 200, { success: true, services: db.prepare("SELECT * FROM partner_services").all() });
    }
    if (pathname === "/api/admin/partners/tickets" && method === "GET") {
      const tickets = db.prepare(`
        SELECT t.*, p.business_name, p.partner_code FROM partner_support_tickets t
        JOIN partners p ON p.id = t.partner_id ORDER BY t.updated_at DESC
      `).all();
      return sendJson(res, 200, { success: true, tickets });
    }
    if (pathname.match(/^\/api\/admin\/partners\/tickets\/[^/]+\/reply$/) && method === "POST") {
      const ticketId = pathname.split("/")[5];
      const ticket = db.prepare("SELECT * FROM partner_support_tickets WHERE id = ?").get(ticketId);
      if (!ticket) return sendJson(res, 404, { error: "Ticket not found" });
      if (!body?.message) return sendJson(res, 400, { error: "Reply message is required" });
      db.prepare("INSERT INTO partner_support_messages (id, ticket_id, sender_user_id, sender_role, message) VALUES (?, ?, ?, 'ADMIN', ?)")
        .run(`pmsg-${crypto.randomUUID()}`, ticketId, context.user.id, String(body.message).trim());
      if (body.status) {
        db.prepare("UPDATE partner_support_tickets SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(body.status, ticketId);
      }
      notifyPartner(ticket.partner_id, {
        category: "SUPPORT",
        title: "Support ticket updated",
        message: `Admin replied to ticket: ${ticket.subject}`,
        relatedModule: "support",
        relatedId: ticketId
      });
      return sendJson(res, 200, { success: true });
    }
    return sendJson(res, 404, { error: "Admin partner endpoint not found" });
  }

  // 4. Partner Endpoints (allowPending: true for profile, status, documents, notifications, support, training)
  if (!pathname.startsWith("/api/partner/")) return false;

  const pendingAllowedPaths = [
    "/api/partner/profile",
    "/api/partner/documents",
    "/api/partner/notifications",
    "/api/partner/support",
    "/api/partner/training"
  ];
  const allowPending = pendingAllowedPaths.some(p => pathname === p || pathname.startsWith(p + "/"));
  const gate = requirePartnerAccess(context, { allowPending });
  if (!gate.ok) return sendJson(res, gate.status, { error: gate.error });
  const partner = gate.partner;

  if (pathname === "/api/partner/profile" && method === "GET") {
    return sendJson(res, 200, { success: true, profile: getPartnerProfileSummary(partner) });
  }
  if (pathname === "/api/partner/profile" && method === "PUT") {
    const result = updatePartnerProfile(partner, context.user, body);
    if (result.error) return sendJson(res, result.status, { error: result.error });
    return sendJson(res, 200, { success: true, profile: result.profile });
  }
  if (pathname === "/api/partner/documents" && method === "POST") {
    const fileItem = body?.files?.[0] || body;
    if (!fileItem || (!fileItem.data && !fileItem.filename)) {
      return sendJson(res, 400, { error: "Verification file upload is required." });
    }
    const result = savePartnerDocFile(partner.id, fileItem, body?.docType || "KYC_DOCUMENT");
    if (result.error) return sendJson(res, result.status, { error: result.error });
    logPartnerActivity(partner.id, context.user.id, "PARTNER_DOC_UPLOADED", { docType: result.document.doc_type });
    return sendJson(res, 201, { success: true, document: result.document });
  }
  if (pathname === "/api/partner/training" && method === "GET") {
    return sendJson(res, 200, { success: true, modules: TRAINING_MODULES });
  }
  if (pathname === "/api/partner/notifications" && method === "GET") {
    const items = db.prepare("SELECT * FROM partner_notifications WHERE partner_id = ? ORDER BY created_at DESC LIMIT 50").all(partner.id);
    const unread = items.filter(i => !i.is_read).length;
    return sendJson(res, 200, { success: true, unreadCount: unread, notifications: items });
  }
  if (pathname === "/api/partner/notifications/read-all" && method === "POST") {
    db.prepare("UPDATE partner_notifications SET is_read = 1 WHERE partner_id = ?").run(partner.id);
    return sendJson(res, 200, { success: true });
  }
  if (pathname.match(/^\/api\/partner\/notifications\/[^/]+\/read$/) && method === "POST") {
    const id = pathname.split("/")[4];
    db.prepare("UPDATE partner_notifications SET is_read = 1 WHERE id = ? AND partner_id = ?").run(id, partner.id);
    return sendJson(res, 200, { success: true });
  }
  if (pathname === "/api/partner/support/tickets" && method === "GET") {
    const tickets = db.prepare("SELECT * FROM partner_support_tickets WHERE partner_id = ? ORDER BY updated_at DESC").all(partner.id);
    return sendJson(res, 200, { success: true, tickets });
  }
  if (pathname === "/api/partner/support/tickets" && method === "POST") {
    const { category, subject, description } = body || {};
    if (!category || !subject || !description) return sendJson(res, 400, { error: "category, subject, and description are required" });
    const id = `ptkt-${crypto.randomUUID()}`;
    db.prepare(`
      INSERT INTO partner_support_tickets (id, partner_id, category, subject, description, status)
      VALUES (?, ?, ?, ?, ?, 'OPEN')
    `).run(id, partner.id, category, String(subject).trim(), String(description).trim());
    db.prepare("INSERT INTO partner_support_messages (id, ticket_id, sender_user_id, sender_role, message) VALUES (?, ?, ?, 'PARTNER', ?)")
      .run(`pmsg-${crypto.randomUUID()}`, id, context.user.id, String(description).trim());
    return sendJson(res, 201, { success: true, ticket: db.prepare("SELECT * FROM partner_support_tickets WHERE id = ?").get(id) });
  }
  if (pathname.match(/^\/api\/partner\/support\/tickets\/[^/]+$/) && method === "GET") {
    const id = pathname.split("/")[5];
    const ticket = db.prepare("SELECT * FROM partner_support_tickets WHERE id = ? AND partner_id = ?").get(id, partner.id);
    if (!ticket) return sendJson(res, 404, { error: "Ticket not found" });
    const messages = db.prepare("SELECT * FROM partner_support_messages WHERE ticket_id = ? ORDER BY created_at ASC").all(id);
    return sendJson(res, 200, { success: true, ticket, messages });
  }
  if (pathname.match(/^\/api\/partner\/support\/tickets\/[^/]+\/reply$/) && method === "POST") {
    const id = pathname.split("/")[5];
    const ticket = db.prepare("SELECT * FROM partner_support_tickets WHERE id = ? AND partner_id = ?").get(id, partner.id);
    if (!ticket) return sendJson(res, 404, { error: "Ticket not found" });
    if (!body?.message) return sendJson(res, 400, { error: "Message is required" });
    db.prepare("INSERT INTO partner_support_messages (id, ticket_id, sender_user_id, sender_role, message) VALUES (?, ?, ?, 'PARTNER', ?)")
      .run(`pmsg-${crypto.randomUUID()}`, id, context.user.id, String(body.message).trim());
    db.prepare("UPDATE partner_support_tickets SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
    return sendJson(res, 200, { success: true });
  }

  // Approved-only endpoints below:
  if (pathname === "/api/partner/overview" && method === "GET") {
    const totalCustomers = db.prepare("SELECT COUNT(*) as c FROM partner_customers WHERE partner_id = ?").get(partner.id)?.c || 0;
    const activeCustomers = db.prepare("SELECT COUNT(*) as c FROM partner_customers WHERE partner_id = ? AND onboarding_status = 'ACTIVE'").get(partner.id)?.c || 0;
    const newLeads = db.prepare("SELECT COUNT(*) as c FROM partner_leads WHERE partner_id = ? AND status IN ('NEW','ASSIGNED')").get(partner.id)?.c || 0;
    const convertedLeads = db.prepare("SELECT COUNT(*) as c FROM partner_leads WHERE partner_id = ? AND status = 'CONVERTED'").get(partner.id)?.c || 0;
    const totalCommissionPaise = db.prepare("SELECT COALESCE(SUM(commission_amount_paise),0) as s FROM partner_commissions WHERE partner_id = ? AND status IN ('APPROVED','PAYABLE','PAID')").get(partner.id)?.s || 0;
    const pendingPayoutsPaise = db.prepare("SELECT COALESCE(SUM(amount_paise),0) as s FROM partner_payout_requests WHERE partner_id = ? AND status = 'PENDING'").get(partner.id)?.s || 0;
    const filings = getPartnerFilingMonitor(partner.id, {});
    const recentLeads = db.prepare("SELECT * FROM partner_leads WHERE partner_id = ? ORDER BY created_at DESC LIMIT 5").all(partner.id);
    const recentCustomers = db.prepare("SELECT * FROM partner_customers WHERE partner_id = ? ORDER BY created_at DESC LIMIT 5").all(partner.id);
    const recentActivities = db.prepare("SELECT * FROM partner_activity_logs WHERE partner_id = ? ORDER BY created_at DESC LIMIT 8").all(partner.id);
    return sendJson(res, 200, {
      success: true,
      kpis: {
        totalCustomers,
        activeCustomers,
        newLeads,
        convertedLeads,
        pendingGstReturns: filings.metrics.returnsPending,
        totalCommissionPaise,
        pendingPayoutsPaise
      },
      dueDates: filings.dueDates,
      recentLeads,
      recentCustomers,
      recentActivities
    });
  }

  if (pathname === "/api/partner/territories" && method === "GET") {
    return sendJson(res, 200, { success: true, territories: getPartnerTerritories(partner.id) });
  }

  if (pathname === "/api/partner/customers" && method === "GET") {
    const resList = listPartnerCustomers(partner.id, query || {});
    return sendJson(res, 200, { success: true, ...resList });
  }
  if (pathname === "/api/partner/customers" && method === "POST") {
    const result = onboardCustomer(partner, context.user.id, body);
    if (result.error) return sendJson(res, result.status, { error: result.error });
    return sendJson(res, 201, { success: true, customer: result.customer, consentRequired: result.consentRequired });
  }
  if (pathname.match(/^\/api\/partner\/customers\/[^/]+\/gstins$/) && method === "POST") {
    const customerId = pathname.split("/")[4];
    const result = addGstinForPartnerCustomer(partner, context.user.id, customerId, body || {});
    if (result.error) return sendJson(res, result.status, { error: result.error });
    return sendJson(res, 201, { success: true, gstin: result.gstin });
  }

  if (pathname === "/api/partner/leads" && method === "GET") {
    const leads = db.prepare("SELECT * FROM partner_leads WHERE partner_id = ? ORDER BY created_at DESC").all(partner.id);
    return sendJson(res, 200, { success: true, leads });
  }
  if (pathname.match(/^\/api\/partner\/leads\/[^/]+$/) && method === "GET") {
    const leadId = pathname.split("/")[4];
    const lead = db.prepare("SELECT * FROM partner_leads WHERE id = ? AND partner_id = ?").get(leadId, partner.id);
    if (!lead) return sendJson(res, 404, { error: "Lead not found" });
    const activities = db.prepare("SELECT * FROM partner_lead_activities WHERE lead_id = ? ORDER BY created_at DESC").all(leadId);
    return sendJson(res, 200, { success: true, lead, activities });
  }
  if (pathname.match(/^\/api\/partner\/leads\/[^/]+$/) && method === "PATCH") {
    const leadId = pathname.split("/")[4];
    const result = updatePartnerLead(partner, context.user.id, leadId, body || {});
    if (result.error) return sendJson(res, result.status, { error: result.error });
    return sendJson(res, 200, { success: true, lead: result.lead });
  }
  if (pathname.match(/^\/api\/partner\/leads\/[^/]+\/convert$/) && method === "POST") {
    const leadId = pathname.split("/")[4];
    const result = convertLeadToCustomer(partner, context.user.id, leadId, body || {});
    if (result.error) return sendJson(res, result.status, { error: result.error });
    return sendJson(res, 200, { success: true, lead: result.lead, customer: result.customer, commission: result.commission });
  }

  if (pathname === "/api/partner/filings" && method === "GET") {
    const data = getPartnerFilingMonitor(partner.id, {
      period: query?.period,
      statusFilter: query?.status || "",
      gstinFilter: query?.gstin || ""
    });
    return sendJson(res, 200, { success: true, ...data });
  }
  if (pathname === "/api/partner/filings/remind" && method === "POST") {
    const { customerId, period } = body || {};
    const cust = db.prepare("SELECT * FROM partner_customers WHERE id = ? AND partner_id = ? AND consent_granted = 1").get(customerId, partner.id);
    if (!cust) return sendJson(res, 404, { error: "Consented customer not found" });
    logPartnerActivity(partner.id, context.user.id, "FILING_REMINDER_SENT", { customerId, period });
    return sendJson(res, 200, { success: true, message: `Filing reminder logged for ${cust.business_name}` });
  }

  if (pathname === "/api/partner/commissions" && method === "GET") {
    const rows = db.prepare("SELECT * FROM partner_commissions WHERE partner_id = ? ORDER BY created_at DESC").all(partner.id);
    const sumBy = (statuses) => rows.filter(r => statuses.includes(r.status)).reduce((a, b) => a + b.commission_amount_paise, 0);
    return sendJson(res, 200, {
      success: true,
      summary: {
        totalEarnedPaise: sumBy(["APPROVED", "PAYABLE", "PAID"]),
        pendingPaise: sumBy(["PENDING", "UNDER_REVIEW"]),
        approvedPaise: sumBy(["APPROVED"]),
        paidPaise: sumBy(["PAID"]),
        availableForPayoutPaise: rows.filter(r => ["APPROVED", "PAYABLE"].includes(r.status) && !r.payout_request_id).reduce((a, b) => a + b.commission_amount_paise, 0)
      },
      commissions: rows
    });
  }
  if (pathname === "/api/partner/payouts" && method === "GET") {
    const payouts = db.prepare("SELECT * FROM partner_payout_requests WHERE partner_id = ? ORDER BY created_at DESC").all(partner.id);
    return sendJson(res, 200, { success: true, payouts });
  }
  if (pathname === "/api/partner/payouts" && method === "POST") {
    const amtPaise = body?.amountPaise !== undefined ? Number(body.amountPaise) : toPaise(body?.amount || 0);
    const result = requestPartnerPayout(partner, context.user.id, {
      amountPaise: amtPaise,
      bankAccountNumber: body?.bankAccountNumber,
      ifsc: body?.ifsc
    });
    if (result.error) return sendJson(res, result.status, { error: result.error });
    return sendJson(res, 201, { success: true, payout: result.payout });
  }

  if (pathname === "/api/partner/performance" && method === "GET") {
    const tiers = db.prepare("SELECT * FROM partner_tier_configs ORDER BY min_customers ASC").all();
    const profile = getPartnerProfileSummary(partner);
    return sendJson(res, 200, { success: true, currentTier: partner.tier, stats: profile.stats, tiers });
  }
  if (pathname === "/api/partner/leaderboard" && method === "GET") {
    return sendJson(res, 200, { success: true, leaderboard: getPartnerLeaderboard(partner.id) });
  }

  if (pathname === "/api/partner/referrals" && method === "GET") {
    const referrals = db.prepare("SELECT * FROM partner_referrals WHERE partner_id = ? ORDER BY created_at DESC").all(partner.id);
    return sendJson(res, 200, {
      success: true,
      referralCode: partner.referral_code,
      referralUrl: `/partner?ref=${encodeURIComponent(partner.referral_code)}`,
      referrals
    });
  }
  if (pathname === "/api/partner/referrals/track" && method === "POST") {
    const email = String(body?.referredEmail || "").trim().toLowerCase();
    const mobile = String(body?.referredMobile || "").trim();
    if (!email) return sendJson(res, 400, { error: "Referred email is required" });
    if (email === partner.email || (mobile && mobile === partner.mobile)) {
      return sendJson(res, 400, { error: "Self-referrals are not permitted." });
    }
    const dup = db.prepare("SELECT id FROM partner_referrals WHERE partner_id = ? AND referred_email = ?").get(partner.id, email);
    if (dup) return sendJson(res, 409, { error: "Referral already recorded for this email." });
    const id = `pref-${crypto.randomUUID()}`;
    db.prepare(`
      INSERT INTO partner_referrals (id, partner_id, referral_code, referred_email, referred_mobile, source, status)
      VALUES (?, ?, ?, ?, ?, ?, 'REGISTERED')
    `).run(id, partner.id, partner.referral_code, email, mobile || null, body?.source || "LINK");
    return sendJson(res, 201, { success: true, referral: db.prepare("SELECT * FROM partner_referrals WHERE id = ?").get(id) });
  }

  if (pathname === "/api/partner/services" && method === "GET") {
    const services = db.prepare("SELECT * FROM partner_services WHERE is_available = 1").all();
    return sendJson(res, 200, { success: true, services });
  }
  if (pathname === "/api/partner/service-orders" && method === "GET") {
    const orders = db.prepare(`
      SELECT o.*, c.business_name as customer_name
      FROM partner_service_orders o JOIN partner_customers c ON c.id = o.customer_id
      WHERE o.partner_id = ? ORDER BY o.created_at DESC
    `).all(partner.id);
    return sendJson(res, 200, { success: true, orders });
  }
  if (pathname === "/api/partner/service-orders" && method === "POST") {
    const { customerId, serviceId, notes } = body || {};
    const cust = db.prepare("SELECT * FROM partner_customers WHERE id = ? AND partner_id = ? AND consent_granted = 1").get(customerId, partner.id);
    if (!cust) return sendJson(res, 403, { error: "Consented customer is required before ordering an add-on service." });
    const svc = db.prepare("SELECT * FROM partner_services WHERE id = ? AND is_available = 1").get(serviceId);
    if (!svc) return sendJson(res, 404, { error: "Service not found or unavailable." });
    const commPaise = Math.round((svc.price_paise * svc.commission_bps) / 10000);
    const id = `pord-${crypto.randomUUID()}`;
    db.prepare(`
      INSERT INTO partner_service_orders (id, partner_id, customer_id, service_id, service_name, amount_paise, commission_paise, status, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'REQUESTED', ?)
    `).run(id, partner.id, customerId, svc.id, svc.name, svc.price_paise, commPaise, notes || null);
    return sendJson(res, 201, { success: true, order: db.prepare("SELECT * FROM partner_service_orders WHERE id = ?").get(id) });
  }

  if (pathname === "/api/partner/activities" && method === "GET") {
    const activities = db.prepare("SELECT * FROM partner_activity_logs WHERE partner_id = ? ORDER BY created_at DESC LIMIT 50").all(partner.id);
    return sendJson(res, 200, { success: true, activities });
  }

  return sendJson(res, 404, { error: "Partner endpoint not found" });
}
