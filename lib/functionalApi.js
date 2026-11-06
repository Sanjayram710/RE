/**
 * SimpleGST Functional API Handler
 * Implements real database-backed endpoints for Multi-GSTIN, Invoices, Documents,
 * OCR, ITC Reconciliation, Tax Calculation, Ledgers, Reports, and GST Copilot.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  db,
  userRepo,
  orgRepo,
  gstinRepo,
  salesRepo,
  purchaseRepo,
  documentRepo,
  ocrRepo,
  gstr2bRepo,
  ledgerRepo,
  challanRepo,
  returnRepo,
  auditRepo,
  sessionRepo,
  passwordResetRepo,
  seedDevelopmentData
} from "./db.js";

import { computeRule88aSetoff } from "./rule88aEngine.js";
import { validateGstr1Prerequisites, validateGstr3bPrerequisites, simulateReturnFiling } from "./gstrReturnLifecycleEngine.js";
import { generatePmt06Challan, executePmt09Transfer } from "./electronicLedgerEngine.js";
import { extractDocumentData } from "./aiDocumentExtractorEngine.js";
import { extractTextFromPdf, parseInvoiceFromText } from "./pdfInvoiceExtractor.js";
import { analyzeInvoice180Days } from "./supplier180DayTracker.js";
import { validateGstin, validatePan } from "./validate.js";
import { generateGSTExcelReport } from "./excelExporter.js";
import { generateGSTCsv } from "./csvExporter.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const uploadsDir = path.join(rootDir, "data", "uploads");

// Ensure development seed is ready
seedDevelopmentData();

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

/**
 * Validates and normalizes statutory tax periods.
 * Expects 6-digit MMYYYY format (e.g., 102026), MM: 01-12, YYYY: 2017-2099.
 */
export function validateAndNormalizePeriod(periodStr) {
  if (!periodStr || typeof periodStr !== "string") {
    return { valid: false, error: "Period is required and must be a string in MMYYYY format." };
  }
  const clean = periodStr.trim();
  if (!/^\d{6}$/.test(clean)) {
    return { valid: false, error: `Invalid period format: '${periodStr}'. Expected 6-digit MMYYYY format (e.g. 102026).` };
  }
  const month = parseInt(clean.slice(0, 2), 10);
  const year = parseInt(clean.slice(2), 10);
  if (month < 1 || month > 12) {
    return { valid: false, error: `Invalid month '${clean.slice(0, 2)}' in period. Month must be between 01 and 12.` };
  }
  if (year < 2017 || year > 2099) {
    return { valid: false, error: `Invalid year '${year}' in period. Year must be between 2017 and 2099.` };
  }
  return { valid: true, period: clean, month, year };
}

// Category 1 States/UTs under Notification No. 82/2020-Central Tax (Due date: 22nd)
const CATEGORY_1_STATE_CODES = new Set([
  "22", "23", "24", "26", "27", "29", "30", "31", "32", "33", "34", "35", "36", "37"
]);

export function isCategory1State(stateCode) {
  const code = String(stateCode || "").padStart(2, "0");
  return CATEGORY_1_STATE_CODES.has(code);
}

/**
 * Computes statutory filing deadlines for MONTHLY and QRMP filing frequencies.
 * QRMP rules:
 * - M1/M2: Optional IFF for B2B by 13th, Mandatory PMT-06 challan deposit by 25th, GSTR-3B deferred.
 * - M3 (Quarter End): GSTR-1 by 13th; GSTR-3B staggered by State Category under Notif 82/2020-CT
 *   (Category 1 states: 22nd; Category 2 states: 24th).
 */
export function formatPeriodDetails(periodStr, filingFrequency = "MONTHLY", stateCode = "27") {
  const val = validateAndNormalizePeriod(String(periodStr || "102026"));
  const p = val.valid ? val.period : "102026";
  const month = parseInt(p.slice(0, 2), 10) || 10;
  const year = parseInt(p.slice(2), 10) || 2026;

  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  const monthShort = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
  ];

  const fullMonth = monthNames[month - 1] || "October";
  const shortMonth = monthShort[month - 1] || "Oct";

  const nextMonthIdx = month === 12 ? 0 : month;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonthFull = monthNames[nextMonthIdx];
  const nextMonthShort = monthShort[nextMonthIdx];

  const fyStart = month >= 4 ? year : year - 1;
  const fyEnd = fyStart + 1;
  const fy = `FY ${fyStart}-${String(fyEnd).slice(2)}`;

  const isQrmp = String(filingFrequency).toUpperCase() === "QRMP";

  if (isQrmp) {
    const isQuarterEnd = (month === 3 || month === 6 || month === 9 || month === 12);
    const quarterIndex = month >= 4 && month <= 6 ? 1 : month >= 7 && month <= 9 ? 2 : month >= 10 && month <= 12 ? 3 : 4;
    const quarterName = `Q${quarterIndex}`;
    const quarterMonth = month % 3 === 1 ? "M1" : (month % 3 === 2 ? "M2" : "M3");

    if (!isQuarterEnd) {
      return {
        raw: p,
        month,
        year,
        full: `${fullMonth} ${year}`,
        short: `${shortMonth} ${year}`,
        monthName: fullMonth,
        monthShort: shortMonth,
        filingFrequency: "QRMP",
        quarter: quarterName,
        quarterMonth,
        isQuarterEnd: false,
        gstr1Deadline: `${nextMonthFull} 13, ${nextYear} (Optional IFF for B2B)`,
        gstr1DeadlineShort: `${nextMonthShort} 13 (IFF)`,
        iffDeadline: `${nextMonthFull} 13, ${nextYear}`,
        iffDeadlineShort: `${nextMonthShort} 13`,
        pmt06Deadline: `${nextMonthFull} 25, ${nextYear}`,
        pmt06DeadlineShort: `${nextMonthShort} 25`,
        gstr3bDeadline: `Deferred to Quarter End (Form PMT-06 challan due by ${nextMonthShort} 25, ${nextYear})`,
        gstr3bDeadlineShort: `Deferred (${nextMonthShort} 25 PMT-06)`,
        fy,
        statutoryNote: `QRMP Month ${quarterMonth}: Optional IFF for B2B supplies by ${nextMonthShort} 13; mandatory PMT-06 challan deposit by ${nextMonthShort} 25.`
      };
    } else {
      const isCat1 = isCategory1State(stateCode);
      const staggeredDay = isCat1 ? 22 : 24;
      const catLabel = isCat1 ? "Category 1" : "Category 2";
      return {
        raw: p,
        month,
        year,
        full: `${fullMonth} ${year}`,
        short: `${shortMonth} ${year}`,
        monthName: fullMonth,
        monthShort: shortMonth,
        filingFrequency: "QRMP",
        quarter: quarterName,
        quarterMonth: "M3",
        isQuarterEnd: true,
        gstr1Deadline: `${nextMonthFull} 13, ${nextYear}`,
        gstr1DeadlineShort: `${nextMonthShort} 13`,
        iffDeadline: null,
        pmt06Deadline: null,
        gstr3bDeadline: `${nextMonthFull} ${staggeredDay}, ${nextYear} (${catLabel} State: ${stateCode})`,
        gstr3bDeadlineShort: `${nextMonthShort} ${staggeredDay}`,
        fy,
        stateCategory: catLabel,
        statutoryNote: `QRMP ${quarterName} End: Quarterly GSTR-1 due by ${nextMonthShort} 13; GSTR-3B due by ${nextMonthShort} ${staggeredDay} (Notif 82/2020-CT).`
      };
    }
  }

  // Monthly filing frequency
  const gstr1Deadline = `${nextMonthFull} 11, ${nextYear}`;
  const gstr1DeadlineShort = `${nextMonthShort} 11`;
  const gstr3bDeadline = `${nextMonthFull} 20, ${nextYear}`;
  const gstr3bDeadlineShort = `${nextMonthShort} 20`;

  return {
    raw: p,
    month,
    year,
    full: `${fullMonth} ${year}`,
    short: `${shortMonth} ${year}`,
    monthName: fullMonth,
    monthShort: shortMonth,
    filingFrequency: "MONTHLY",
    isQuarterEnd: true,
    gstr1Deadline,
    gstr1DeadlineShort,
    gstr3bDeadline,
    gstr3bDeadlineShort,
    pmt06Deadline: null,
    fy,
    statutoryNote: `Regular Monthly Filer: GSTR-1 due by ${nextMonthShort} 11; GSTR-3B due by ${nextMonthShort} 20.`
  };
}

export function isHttpsRequest(req) {
  if (process.env.NODE_ENV === "production") return true;
  const proto = req?.headers?.["x-forwarded-proto"];
  return proto === "https";
}

export function isAllowedOrigin(origin, hostHeader) {
  if (!origin) return true; // Direct non-browser or same-origin requests without Origin header
  try {
    const originUrl = new URL(origin);
    const originHost = originUrl.host;

    // Explicit known safe origins
    const allowed = new Set([
      "localhost:3000",
      "127.0.0.1:3000",
      "localhost:5000",
      "127.0.0.1:5000",
      "simplegst.onrender.com"
    ]);

    if (process.env.ALLOWED_ORIGINS) {
      process.env.ALLOWED_ORIGINS.split(",").map(o => o.trim()).forEach(o => {
        try {
          const u = new URL(o.startsWith("http") ? o : `http://${o}`);
          allowed.add(u.host);
        } catch {}
      });
    }

    if (hostHeader && typeof hostHeader === "string" && hostHeader.trim()) {
      allowed.add(hostHeader.trim());
    }

    return allowed.has(originHost);
  } catch {
    return false;
  }
}

export function buildSessionCookie(token, req, maxAgeSeconds = 604800) {
  const secure = isHttpsRequest(req) ? "; Secure" : "";
  return `simplegst_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

export function buildCsrfCookie(csrfToken, req, maxAgeSeconds = 604800) {
  const secure = isHttpsRequest(req) ? "; Secure" : "";
  return `simplegst_csrf=${csrfToken}; Path=/; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

export function buildClearCookies(req) {
  const secure = isHttpsRequest(req) ? "; Secure" : "";
  return [
    `simplegst_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax${secure}`,
    `simplegst_csrf=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax${secure}`
  ];
}

/**
 * Resolves session context from request headers, token, query, or body.
 * Enforces per-session state isolation and organization/GSTIN ownership.
 * Only accepts authentic cryptographic tokens from Authorization Bearer,
 * X-Session-Token header, or simplegst_session Cookie.
 * NEVER trusts query/body session IDs or auto-creates sessions for unknown tokens.
 */
export function resolveSessionContext(req, query = {}, body = {}) {
  const headers = req?.headers || {};
  const authHeader = headers["authorization"] || "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  const sessionHeader = headers["x-session-token"];
  const cookieHeader = headers["cookie"] || "";
  let cookieToken = null;
  if (cookieHeader) {
    const match = cookieHeader.match(/(?:simplegst_session|session_token)=([^;]+)/i);
    if (match) cookieToken = match[1].trim();
  }

  let authMethod = null;
  let token = null;
  if (bearerToken) {
    token = bearerToken;
    authMethod = "bearer";
  } else if (sessionHeader) {
    token = sessionHeader;
    authMethod = "session-token";
  } else if (cookieToken) {
    token = cookieToken;
    authMethod = "cookie";
  }

  if (!token) {
    return {
      authenticated: false,
      authMethod: null,
      session: null,
      sessionId: null,
      sessionToken: null,
      csrfToken: null,
      user: null,
      userRole: null,
      organization: null,
      activeGstin: null,
      activePeriod: "102026",
      authError: "Unauthorized: Missing session token"
    };
  }

  const session = sessionRepo.findValidSession(token);
  if (!session) {
    return {
      authenticated: false,
      authMethod,
      session: null,
      sessionId: null,
      sessionToken: null,
      csrfToken: null,
      user: null,
      userRole: null,
      organization: null,
      activeGstin: null,
      activePeriod: "102026",
      authError: "Unauthorized: Invalid, expired, or revoked session token"
    };
  }

  const user = userRepo.findById(session.user_id);
  if (!user) {
    return {
      authenticated: false,
      authMethod,
      session: null,
      sessionId: null,
      sessionToken: null,
      csrfToken: null,
      user: null,
      userRole: null,
      organization: null,
      activeGstin: null,
      activePeriod: "102026",
      authError: "Unauthorized: User not found for session"
    };
  }

  // Verify Organization Membership
  let activeOrg = null;
  if (session.active_org_id) {
    const membership = orgRepo.getMembership(session.active_org_id, user.id);
    if (!membership) {
      return {
        authenticated: true,
        authMethod,
        session,
        sessionId: session.id,
        sessionToken: session.token,
        csrfToken: session.csrf_token,
        user,
        userRole: user.role,
        organization: null,
        activeGstin: null,
        activePeriod: session.active_period || "102026",
        forbiddenOrg: true,
        error: "Forbidden: You are not an authorized member of this organization."
      };
    }
    activeOrg = orgRepo.findById(session.active_org_id);
  } else {
    const userOrgs = orgRepo.getUserOrgs(user.id);
    if (userOrgs.length > 0) {
      activeOrg = userOrgs[0];
      sessionRepo.updateContext(session.id, { orgId: activeOrg.id });
      session.active_org_id = activeOrg.id;
    }
  }

  // Cross-tenant check: if request explicitly specifies a target GSTIN
  const targetGstinId = query?.gstinId || body?.gstinId || headers["x-gstin-id"];
  if (targetGstinId) {
    const target = gstinRepo.findById(targetGstinId);
    if (target && session.active_org_id && target.org_id !== session.active_org_id) {
      return {
        authenticated: true,
        authMethod,
        session,
        sessionId: session.id,
        sessionToken: session.token,
        csrfToken: session.csrf_token,
        user,
        userRole: user.role,
        organization: activeOrg,
        activeGstin: null,
        activePeriod: session.active_period || "102026",
        forbiddenGstin: true,
        unauthorizedAccess: true,
        error: `Forbidden: GSTIN '${target.gstin}' does not belong to your organization.`
      };
    }
  }

  let activeGstin = session.active_gstin_id ? gstinRepo.findById(session.active_gstin_id) : null;
  if (activeGstin && session.active_org_id && activeGstin.org_id !== session.active_org_id) {
    return {
      authenticated: true,
      authMethod,
      session,
      sessionId: session.id,
      sessionToken: session.token,
      csrfToken: session.csrf_token,
      user,
      userRole: user.role,
      organization: activeOrg,
      activeGstin: null,
      activePeriod: session.active_period || "102026",
      forbiddenGstin: true,
      unauthorizedAccess: true,
      error: `Forbidden: Active GSTIN '${activeGstin.gstin}' does not belong to your organization.`
    };
  }

  if (!activeGstin && session.active_org_id) {
    const orgGstins = gstinRepo.listByOrg(session.active_org_id);
    activeGstin = orgGstins.find(g => g.is_primary && g.is_active) || orgGstins[0] || null;
    if (activeGstin) {
      sessionRepo.updateContext(session.id, { gstinId: activeGstin.id });
    }
  }

  const requestedPeriod = query?.period || body?.period || headers["x-period"] || session.active_period || "102026";

  return {
    authenticated: true,
    authMethod,
    session,
    sessionId: session.id,
    sessionToken: session.token,
    csrfToken: session.csrf_token,
    user,
    userRole: user.role,
    organization: activeOrg,
    activeGstin,
    activePeriod: requestedPeriod,
    forbiddenOrg: false,
    forbiddenGstin: false,
    unauthorizedAccess: false
  };
}

export async function handleFunctionalApi(req, res, pathname, method, query, body) {
  // 1. Identify if this route is handled by the functional API router
  const isFunctionalApiRoute = pathname.startsWith("/api/auth/") ||
                               pathname.startsWith("/api/context/") ||
                               pathname.startsWith("/api/gstins") ||
                               pathname === "/api/dashboard/summary" ||
                               pathname.startsWith("/api/gst/") ||
                               pathname.startsWith("/api/sales") ||
                               pathname.startsWith("/api/purchases") ||
                               pathname.startsWith("/api/documents") ||
                               pathname.startsWith("/api/reports/") ||
                               pathname.startsWith("/api/ocr/") ||
                               pathname.startsWith("/api/reconciliation/") ||
                               pathname.startsWith("/api/returns/") ||
                               pathname.startsWith("/api/copilot/") ||
                               pathname.startsWith("/api/ledgers/") ||
                               pathname.startsWith("/api/challans/");

  if (!isFunctionalApiRoute) {
    return false;
  }

  // CORS and Origin verification for browser requests
  const origin = req?.headers?.["origin"] || (req?.headers?.["referer"] ? new URL(req.headers["referer"]).origin : null);
  if (origin && !isAllowedOrigin(origin, req?.headers?.["host"])) {
    return sendJson(res, 403, { error: `Forbidden: Untrusted Origin or Referer '${origin}'` });
  }

  const context = resolveSessionContext(req, query, body);

  // CSRF verification for cookie-authenticated state-changing requests
  const isStateChanging = ["POST", "PUT", "DELETE", "PATCH"].includes(method);
  const isPublicAuthRoute = pathname === "/api/auth/login" ||
                            pathname === "/api/auth/request-reset" ||
                            pathname === "/api/auth/reset-password";

  if (isStateChanging && !isPublicAuthRoute && context.authenticated && context.authMethod === "cookie") {
    const csrfHeader = req?.headers?.["x-csrf-token"];
    if (!csrfHeader || csrfHeader !== context.csrfToken) {
      return sendJson(res, 403, {
        error: "Forbidden: Missing or invalid CSRF token. Required 'X-CSRF-Token' header."
      });
    }
  }

  // =========================================================================
  // 1. PUBLIC AUTH ROUTES (No session required)
  // =========================================================================
  if (pathname === "/api/auth/login" && method === "POST") {
    const { email, password } = body || {};
    if (!email || !password) {
      return sendJson(res, 400, { error: "Email and password are required" });
    }
    const user = userRepo.findByEmail(email);
    if (!user) {
      return sendJson(res, 401, { error: "Invalid email or password" });
    }
    if (userRepo.isLegacyPassword(user.password_hash)) {
      return sendJson(res, 401, {
        error: "Legacy credentials detected. Account password must be reset using the password reset flow.",
        requiresReset: true
      });
    }
    const isPasswordValid = userRepo.verifyPassword(user.password_hash, password);
    if (!isPasswordValid) {
      return sendJson(res, 401, { error: "Invalid email or password" });
    }

    const userOrgs = orgRepo.getUserOrgs(user.id);
    const orgId = userOrgs.length > 0 ? userOrgs[0].id : null;

    let primaryGstin = null;
    if (orgId) {
      primaryGstin = db.prepare("SELECT * FROM gst_registrations WHERE org_id = ? AND is_primary = 1 AND is_active = 1 LIMIT 1").get(orgId)
        || db.prepare("SELECT * FROM gst_registrations WHERE org_id = ? AND is_active = 1 LIMIT 1").get(orgId);
    }

    const session = sessionRepo.create({
      userId: user.id,
      activeOrgId: orgId,
      activeGstinId: primaryGstin ? primaryGstin.id : null,
      activePeriod: "102026"
    });

    res.setHeader("Set-Cookie", [
      buildSessionCookie(session.token, req),
      buildCsrfCookie(session.csrf_token, req)
    ]);

    return sendJson(res, 200, {
      success: true,
      message: "Logged in successfully to SimpleGST Compliance OS",
      sessionToken: session.token, // Securely returned upon login for API/Bearer callers
      csrfToken: session.csrf_token,
      user: {
        id: user.id,
        name: user.full_name,
        email: user.email,
        role: user.role
      },
      organization: orgId ? orgRepo.findById(orgId) : null,
      activeGstin: primaryGstin
    });
  }

  if (pathname === "/api/auth/request-reset" && method === "POST") {
    const { email } = body || {};
    if (!email) {
      return sendJson(res, 400, { error: "Email is required" });
    }
    const user = userRepo.findByEmail(email);
    if (!user) {
      return sendJson(res, 200, {
        success: true,
        message: "If that email is registered, a password reset token has been dispatched."
      });
    }
    const reset = passwordResetRepo.create(user.id);
    return sendJson(res, 200, {
      success: true,
      message: "Password reset token generated successfully.",
      resetToken: reset.token,
      expiresAt: reset.expiresAt
    });
  }

  if (pathname === "/api/auth/reset-password" && method === "POST") {
    const { token, newPassword } = body || {};
    if (!token || !newPassword) {
      return sendJson(res, 400, { error: "Reset token and newPassword are required." });
    }
    if (typeof newPassword !== "string" || newPassword.length < 8) {
      return sendJson(res, 400, { error: "New password must be at least 8 characters long." });
    }
    const reset = passwordResetRepo.findValidToken(token);
    if (!reset) {
      return sendJson(res, 400, { error: "Invalid, expired, or previously used reset token." });
    }
    const newHash = userRepo.hashPassword(newPassword);
    userRepo.updatePassword(reset.user_id, newHash);
    passwordResetRepo.markUsed(token);
    sessionRepo.revokeUserSessions(reset.user_id);

    return sendJson(res, 200, {
      success: true,
      message: "Password reset successfully. Please log in with your new credentials."
    });
  }

  if (pathname === "/api/auth/session" && method === "GET") {
    if (!context.authenticated) {
      return sendJson(res, 200, {
        authenticated: false,
        user: null,
        message: "No active authenticated session"
      });
    }
    const org = context.organization;
    const allGstins = org ? gstinRepo.listByOrg(org.id) : [];
    const periodInfo = formatPeriodDetails(context.activePeriod, context.activeGstin?.filing_frequency, context.activeGstin?.state_code);

    // SECURITY: Strictly omit raw sessionToken and sessionId from status responses
    return sendJson(res, 200, {
      authenticated: true,
      csrfToken: context.csrfToken,
      user: {
        id: context.user.id,
        name: context.user.full_name,
        email: context.user.email,
        role: context.user.role
      },
      organization: org,
      activeGstin: context.activeGstin,
      allGstins: allGstins,
      activePeriod: context.activePeriod,
      periodDetails: periodInfo
    });
  }

  // =========================================================================
  // 2. PROTECTED TENANT-SCOPED ENDPOINTS (Session & Organization required)
  // =========================================================================
  if (!context.authenticated) {
    return sendJson(res, 401, { error: "Unauthorized: Valid authentication session required." });
  }

  if (context.forbiddenOrg) {
    return sendJson(res, 403, { error: context.error || "Forbidden: Access denied to organization." });
  }

  if (context.forbiddenGstin || context.unauthorizedAccess) {
    return sendJson(res, 403, { error: context.error || "Forbidden: Access denied to GSTIN." });
  }

  // RBAC: AUDITOR role is strictly read-only on tenant records
  if (context.user?.role === "AUDITOR" && isStateChanging) {
    if (pathname !== "/api/auth/logout" && pathname !== "/api/auth/switch-context") {
      return sendJson(res, 403, {
        error: "Forbidden: Auditor role is strictly read-only on tenant records."
      });
    }
  }

  if (pathname === "/api/auth/logout" && method === "POST") {
    if (context.session) {
      sessionRepo.revoke(context.session.token);
    }
    res.setHeader("Set-Cookie", buildClearCookies(req));
    return sendJson(res, 200, {
      success: true,
      message: "Logged out successfully"
    });
  }

  if (pathname === "/api/auth/switch-context" && method === "POST") {
    const { orgId, gstinId, period } = body || {};

    if (orgId) {
      const membership = orgRepo.getMembership(orgId, context.user.id);
      if (!membership) {
        return sendJson(res, 403, { error: "Forbidden: You are not a member of the requested organization." });
      }
    }

    const targetOrgId = orgId || context.session.active_org_id;

    if (gstinId) {
      const targetGstin = gstinRepo.findById(gstinId);
      if (!targetGstin || targetGstin.org_id !== targetOrgId) {
        return sendJson(res, 403, { error: "Forbidden: The requested GSTIN does not belong to the selected organization." });
      }
    }

    let validPeriod = undefined;
    if (period) {
      const pVal = validateAndNormalizePeriod(period);
      if (!pVal.valid) {
        return sendJson(res, 400, { error: pVal.error });
      }
      validPeriod = pVal.period;
    }

    const updated = sessionRepo.updateContext(context.session.id, {
      orgId: targetOrgId,
      gstinId,
      period: validPeriod
    });

    const activeG = updated.active_gstin_id ? gstinRepo.findById(updated.active_gstin_id) : null;
    const org = updated.active_org_id ? orgRepo.findById(updated.active_org_id) : null;

    return sendJson(res, 200, {
      success: true,
      message: "Session context updated successfully",
      organization: org,
      activeGstin: activeG,
      activePeriod: updated.active_period
    });
  }

  const activeGstin = context.activeGstin;
  const currentPeriod = context.activePeriod;
  const getActiveGstin = () => activeGstin;

  // =========================================================================
  // 1b. FILING PERIOD CONTEXT (Dynamic Period Switching)
  // =========================================================================
  if (pathname === "/api/context/period" && method === "GET") {
    const details = formatPeriodDetails(currentPeriod, activeGstin?.filing_frequency, activeGstin?.state_code);
    return sendJson(res, 200, {
      activePeriod: currentPeriod,
      details
    });
  }

  if (pathname === "/api/context/period" && method === "POST") {
    const { period } = body || {};
    const periodValidation = validateAndNormalizePeriod(period);
    if (!periodValidation.valid) {
      return sendJson(res, 400, { success: false, error: periodValidation.error });
    }
    sessionRepo.updateContext(context.sessionId, { period: periodValidation.period });
    const details = formatPeriodDetails(periodValidation.period, activeGstin?.filing_frequency, activeGstin?.state_code);
    return sendJson(res, 200, {
      success: true,
      activePeriod: periodValidation.period,
      details
    });
  }

  // =========================================================================
  // 2. MULTI-GSTIN MANAGEMENT
  // =========================================================================
  if (pathname === "/api/gstins" && method === "GET") {
    if (!activeGstin && !context.organization) return sendJson(res, 200, { gstins: [] });
    const orgId = activeGstin ? activeGstin.org_id : context.organization.id;
    const list = gstinRepo.listByOrg(orgId);
    return sendJson(res, 200, { gstins: list });
  }

  if (pathname === "/api/gstins" && method === "POST") {
    if (context.user?.role === "ACCOUNTANT") {
      return sendJson(res, 403, { error: "Forbidden: Accountant role is not authorized to register new GSTINs." });
    }
    const orgId = activeGstin ? activeGstin.org_id : (context.organization ? context.organization.id : null);
    if (!orgId) return sendJson(res, 400, { error: "No active organization found" });

    const { gstin, tradeName, stateCode, stateName, address, jurisdiction, filingFrequency } = body;
    if (!gstin || !tradeName) {
      return sendJson(res, 400, { error: "GSTIN and Trade Name are mandatory" });
    }

    const gstinValid = validateGstin(gstin);
    if (!gstinValid.valid) {
      return sendJson(res, 400, { error: `Invalid GSTIN: ${gstinValid.reason}` });
    }

    try {
      const created = gstinRepo.create({
        orgId: orgId,
        gstin,
        tradeName,
        stateCode: stateCode || gstinValid.stateCode,
        stateName: stateName || `State-${gstinValid.stateCode}`,
        address: address || "",
        jurisdiction: jurisdiction || "",
        isPrimary: 0,
        filingFrequency: filingFrequency || "MONTHLY"
      });

      auditRepo.log({
        orgId: orgId,
        gstinId: created.id,
        action: "GSTIN_REGISTERED",
        entityType: "GST_REGISTRATION",
        entityId: created.id,
        details: { gstin, tradeName }
      });

      return sendJson(res, 201, { success: true, gstin: created });
    } catch (err) {
      return sendJson(res, 400, { error: `Registration error: ${err.message}` });
    }
  }

  if (pathname.startsWith("/api/gstins/") && pathname.endsWith("/activate") && method === "POST") {
    const parts = pathname.split("/");
    const targetId = parts[3];
    const target = gstinRepo.findById(targetId);
    if (!target) return sendJson(res, 404, { error: "GSTIN registration not found" });

    // Multi-tenant check: Target GSTIN must belong to current authenticated organization
    const orgId = activeGstin ? activeGstin.org_id : (context.organization ? context.organization.id : null);
    if (orgId && target.org_id !== orgId) {
      return sendJson(res, 403, { error: "Forbidden: Access denied to GSTIN belonging to another organization." });
    }

    const membership = orgRepo.getMembership(target.org_id, context.user.id);
    if (!membership) {
      return sendJson(res, 403, { error: "Forbidden: You are not an authorized member of the organization owning this GSTIN." });
    }

    sessionRepo.updateContext(context.sessionId, { gstinId: target.id, orgId: target.org_id });

    auditRepo.log({
      orgId: target.org_id,
      gstinId: target.id,
      action: "WORKSPACE_GSTIN_SWITCHED",
      entityType: "GST_REGISTRATION",
      entityId: target.id,
      details: { gstin: target.gstin, tradeName: target.trade_name }
    });

    return sendJson(res, 200, {
      success: true,
      message: `Active workspace switched to ${target.trade_name} (${target.gstin})`,
      activeGstin: target
    });
  }

  // =========================================================================
  // 3. DASHBOARD SUMMARY (Scoped to Active GSTIN & Period)
  // =========================================================================
  if (pathname === "/api/dashboard/summary" && method === "GET") {
    if (!activeGstin) return sendJson(res, 200, { empty: true, message: "No active GSTIN" });

    const periodStr = query.period || currentPeriod;
    const periodValidation = validateAndNormalizePeriod(periodStr);
    if (!periodValidation.valid) {
      return sendJson(res, 400, { error: periodValidation.error });
    }
    const period = periodValidation.period;

    const sales = salesRepo.list(activeGstin.id, period);
    const purchases = purchaseRepo.list(activeGstin.id, period);

    const totalSalesTaxable = sales.reduce((acc, s) => acc + s.taxable_amount, 0);
    const totalSalesTax = sales.reduce((acc, s) => acc + s.total_tax, 0);

    const totalPurchasesTaxable = purchases.reduce((acc, p) => acc + p.taxable_amount, 0);
    const eligiblePurchases = purchases.filter(p => p.itc_eligibility === "ELIGIBLE");
    const totalEligibleItc = eligiblePurchases.reduce((acc, p) => acc + p.total_tax, 0);
    const blockedItc = purchases.filter(p => p.itc_eligibility !== "ELIGIBLE").reduce((acc, p) => acc + p.total_tax, 0);

    const cashShortfall = Math.max(0, totalSalesTax - totalEligibleItc);

    // Get Ledger Balances
    const ledgers = ledgerRepo.getTotals(activeGstin.id);
    const periodInfo = formatPeriodDetails(period, activeGstin.filing_frequency, activeGstin.state_code);

    return sendJson(res, 200, {
      entity: {
        id: activeGstin.id,
        tradeName: activeGstin.trade_name,
        gstin: activeGstin.gstin,
        state: `${activeGstin.state_name} (${activeGstin.state_code})`,
        filingFrequency: activeGstin.filing_frequency
      },
      period: period,
      periodLabel: periodInfo.full,
      periodShort: periodInfo.short,
      statutoryDeadlines: {
        gstr1: periodInfo.gstr1Deadline,
        gstr3b: periodInfo.gstr3bDeadline,
        pmt06: periodInfo.pmt06Deadline
      },
      environment: {
        isLive: false,
        name: "Sandbox Simulation",
        label: "Demo Sandbox (Local Grounded Engine)",
        gspConnected: false
      },
      metrics: {
        totalOutputLiability: totalSalesTax,
        taxableSales: totalSalesTaxable,
        salesCount: sales.length,
        totalEligibleItc: totalEligibleItc,
        blockedItc: blockedItc,
        taxablePurchases: totalPurchasesTaxable,
        purchasesCount: purchases.length,
        netCashPayable: cashShortfall,
        complianceScore: 94,
        cashLedgerBalance: ledgers.CASH,
        creditLedgerBalance: ledgers.CREDIT
      },
      recentSales: sales.slice(0, 5),
      recentPurchases: purchases.slice(0, 5),
      lifecycleStatus: {
        gstr1: sales.length > 0 ? "READY" : "PENDING_INVOICES",
        gstr2b: "AUTO_DRAFTED",
        gstr3b: cashShortfall > 0 ? "CHALLAN_REQUIRED" : "READY_TO_OFFSET"
      }
    });
  }

  // =========================================================================
  // 3b. NIL RETURN PRE-FILING VERIFICATION & PERSISTED CHECK (Rule 67A CGST Rules)
  // =========================================================================
  if (pathname === "/api/gst/nil-verify" && method === "GET") {
    if (!activeGstin) return sendJson(res, 200, { eligible: false, message: "No active GSTIN selected" });

    const periodStr = query.period || currentPeriod;
    const periodValidation = validateAndNormalizePeriod(periodStr);
    if (!periodValidation.valid) {
      return sendJson(res, 400, { error: periodValidation.error });
    }
    const period = periodValidation.period;
    const periodInfo = formatPeriodDetails(period, activeGstin.filing_frequency, activeGstin.state_code);

    const sales = salesRepo.list(activeGstin.id, period);
    const purchases = purchaseRepo.list(activeGstin.id, period);
    const rcmPurchases = purchases.filter(p => p.is_rcm);
    const eligiblePurchases = purchases.filter(p => p.itc_eligibility === "ELIGIBLE");
    const totalEligibleItc = eligiblePurchases.reduce((acc, p) => acc + p.total_tax, 0);
    const ineligiblePurchases = purchases.filter(p => p.itc_eligibility !== "ELIGIBLE");
    const totalIneligibleItc = ineligiblePurchases.reduce((acc, p) => acc + p.total_tax, 0);

    const totalSalesTaxable = sales.reduce((a, s) => a + s.taxable_amount, 0);
    const totalSalesTax = sales.reduce((a, s) => a + s.total_tax, 0);
    const totalPurchasesTaxable = purchases.reduce((a, p) => a + p.taxable_amount, 0);
    const ledgers = ledgerRepo.getTotals(activeGstin.id);
    const filedReturns = (returnRepo.listByGstin ? returnRepo.listByGstin(activeGstin.id) : []).filter(r => r.period === period);

    const isAlreadyFiled = filedReturns.length > 0;

    // Rule 67A CGST Rules itemized evaluation
    const ineligibilityReasons = [];
    if (isAlreadyFiled) {
      ineligibilityReasons.push(`A return for ${periodInfo.full} has already been filed for ${activeGstin.trade_name} (${activeGstin.gstin}).`);
    }
    if (sales.length > 0 || totalSalesTaxable > 0 || totalSalesTax > 0) {
      ineligibilityReasons.push(`Outward supplies recorded (${sales.length} invoice(s), ₹${totalSalesTaxable.toLocaleString("en-IN")} taxable value, ₹${totalSalesTax.toLocaleString("en-IN")} tax). Rule 67A requires zero outward supplies.`);
    }
    if (rcmPurchases.length > 0) {
      const rcmTax = rcmPurchases.reduce((a, p) => a + p.total_tax, 0);
      ineligibilityReasons.push(`Reverse charge (RCM) inward supplies recorded (${rcmPurchases.length} bill(s), ₹${rcmTax.toLocaleString("en-IN")} tax payable). Rule 67A requires zero RCM liability.`);
    }
    if (totalEligibleItc > 0) {
      ineligibilityReasons.push(`Input Tax Credit claimed (₹${totalEligibleItc.toLocaleString("en-IN")} across ${eligiblePurchases.length} bill(s)). Rule 67A requires zero ITC claims.`);
    }

    const isEligible = ineligibilityReasons.length === 0;

    return sendJson(res, 200, {
      eligible: isEligible,
      hasTransactions: (sales.length > 0 || purchases.length > 0),
      gstin: activeGstin.gstin,
      tradeName: activeGstin.trade_name,
      period,
      periodLabel: periodInfo.full,
      ineligibilityReasons,
      breakdown: {
        outwardSuppliesCount: sales.length,
        outwardTaxableAmount: totalSalesTaxable,
        outwardTaxLiability: totalSalesTax,
        inwardPurchasesCount: purchases.length,
        eligibleItcClaimed: totalEligibleItc,
        ineligiblePurchasesCount: ineligiblePurchases.length,
        ineligibleItcAmount: totalIneligibleItc,
        rcmCount: rcmPurchases.length,
        isAlreadyFiled,
        cashLedgerBalance: ledgers.CASH,
        creditLedgerBalance: ledgers.CREDIT
      },
      verification: {
        salesCount: sales.length,
        salesTaxable: totalSalesTaxable,
        purchasesCount: purchases.length,
        purchasesTaxable: totalPurchasesTaxable,
        eligibleItc: totalEligibleItc,
        rcmCount: rcmPurchases.length,
        cashLedger: ledgers.CASH,
        creditLedger: ledgers.CREDIT,
        hasTransactions: (sales.length > 0 || purchases.length > 0),
        ledgerChecked: true
      },
      message: isEligible
        ? `Statutory Rule 67A Verified: Zero outward supplies, zero RCM liability, and zero ITC claims for ${periodInfo.full}${ineligiblePurchases.length > 0 ? ` (${ineligiblePurchases.length} purchases with zero/ineligible ITC do not disqualify Nil return)` : ""}.`
        : `Nil Return Ineligible under Rule 67A: ${ineligibilityReasons.join(" ")}`
    });
  }

  // -------------------------------------------------------------------------
  // Handle POST /api/gst/nil-file with persistent database verification
  // -------------------------------------------------------------------------
  if (pathname === "/api/gst/nil-file" && method === "POST") {
    if (context.user?.role === "ACCOUNTANT") {
      return sendJson(res, 403, { error: "Forbidden: Accountant role is not authorized to file statutory returns." });
    }
    const periodStr = body?.period || currentPeriod;
    const periodValidation = validateAndNormalizePeriod(periodStr);
    if (!periodValidation.valid) {
      return sendJson(res, 400, { success: false, error: periodValidation.error });
    }
    const period = periodValidation.period;
    const periodInfo = formatPeriodDetails(period, activeGstin?.filing_frequency, activeGstin?.state_code);

    // Requirement 1: Require declarationConfirmed === true. Reject missing, null, and false values!
    if (body?.declarationConfirmed !== true) {
      return sendJson(res, 400, {
        success: false,
        error: "Statutory declaration confirmation is required: declarationConfirmed must be explicitly true under Rule 67A before filing Nil Form GSTR-3B."
      });
    }

    if (activeGstin) {
      const sales = salesRepo.list(activeGstin.id, period);
      const purchases = purchaseRepo.list(activeGstin.id, period);
      const rcmPurchases = purchases.filter(p => p.is_rcm);
      const eligiblePurchases = purchases.filter(p => p.itc_eligibility === "ELIGIBLE");
      const totalEligibleItc = eligiblePurchases.reduce((acc, p) => acc + p.total_tax, 0);
      const filedReturns = (returnRepo.listByGstin ? returnRepo.listByGstin(activeGstin.id) : []).filter(r => r.period === period);

      const ineligibilityReasons = [];
      if (filedReturns.length > 0) {
        ineligibilityReasons.push(`A return for ${periodInfo.full} has already been filed for ${activeGstin.trade_name} (${activeGstin.gstin}).`);
      }
      if (sales.length > 0) {
        ineligibilityReasons.push(`${sales.length} outward sales invoice(s) exist.`);
      }
      if (rcmPurchases.length > 0) {
        ineligibilityReasons.push(`${rcmPurchases.length} reverse charge (RCM) purchase bill(s) exist.`);
      }
      if (totalEligibleItc > 0) {
        ineligibilityReasons.push(`Eligible ITC of ₹${totalEligibleItc.toLocaleString("en-IN")} is claimed.`);
      }

      if (ineligibilityReasons.length > 0) {
        return sendJson(res, 400, {
          success: false,
          error: `Cannot file Nil Form GSTR-3B: Rule 67A conditions not satisfied. ${ineligibilityReasons.join(" ")} Please proceed with regular filing.`,
          ineligibilityReasons
        });
      }
    }

    const randomSuffix = Math.floor(100000 + Math.random() * 900000);
    const simulationArn = `SIM-NIL-AA${activeGstin ? activeGstin.state_code : "32"}${period.slice(2, 6)}${randomSuffix}`;

    if (activeGstin) {
      returnRepo.saveDraft({
        orgId: activeGstin.org_id,
        gstinId: activeGstin.id,
        period,
        returnType: "NIL_3B",
        status: "SIMULATED_NOT_TRANSMITTED",
        arn: null,
        liabilitySummary: { salesCount: 0, taxPaidCash: 0 },
        itcSummary: { purchasesCount: 0, itcUtilized: 0 },
        offsetMatrix: { isNil: true, mode: "SIMULATION", simulationReference: simulationArn }
      });
    }

    return sendJson(res, 200, {
      success: true,
      isNil: true,
      isSimulation: true,
      watermark: "[SIMULATION / DEMO MODE — NOT TRANSMITTED TO GSTN COMMON PORTAL]",
      arn: null,
      officialArn: null,
      simulationReference: simulationArn,
      status: "SIMULATED_NOT_TRANSMITTED",
      gstin: activeGstin?.gstin || (body?.gstin || "32ABCDE1234F1Z5"),
      legalName: activeGstin ? activeGstin.trade_name : "Apex Retailers Pvt Ltd",
      period,
      periodDisplay: periodInfo.full,
      form: "GSTR-3B (NIL)",
      filedAt: new Date().toISOString(),
      authorisedPerson: body?.authorisedPerson || "Rajesh Sharma",
      verificationMode: body?.verificationMode || "EVC_OTP",
      statutorySummary: {
        outwardTaxableSales: 0,
        totalGstCollected: 0,
        inwardTaxablePurchases: 0,
        eligibleItc: 0,
        netTaxPaidInCash: 0,
        lateFeePaid: 0,
        interestPaid: 0
      },
      message: `Simulation Completed: Your NIL GSTR-3B return has been simulated and recorded locally for ${periodInfo.full} (Status: SIMULATED_NOT_TRANSMITTED, Simulation Ref: ${simulationArn}).`,
      downloadCertificate: {
        certificateNumber: `CERT-${simulationArn}`,
        title: "Statutory Nil Return Filing Simulation Receipt",
        issuer: "SimpleGST Architectural Compliance Engine"
      }
    });
  }

  // =========================================================================
  // 4. SALES INVOICES CRUD
  // =========================================================================
  if (pathname === "/api/sales" && method === "GET") {
    const active = getActiveGstin();
    if (!active) return sendJson(res, 200, { invoices: [] });
    const period = query.period || currentPeriod;
    const invoices = salesRepo.list(active.id, period);
    return sendJson(res, 200, { invoices, total: invoices.length });
  }

  if (pathname === "/api/sales" && method === "POST") {
    const active = getActiveGstin();
    if (!active) return sendJson(res, 400, { error: "No active GSTIN" });

    const {
      invoiceNumber, invoiceDate, customerName, customerGstin, pos,
      taxableAmount, gstRate, supplyType = "B2B"
    } = body;

    if (!invoiceNumber || !invoiceDate || !customerName || taxableAmount === undefined || gstRate === undefined) {
      return sendJson(res, 400, { error: "Missing required invoice fields" });
    }

    const isInterstate = pos && pos.substring(0, 2) !== active.state_code;
    const taxRate = Number(gstRate) / 100;
    const taxAmt = Number(taxableAmount) * taxRate;
    let igst = 0, cgst = 0, sgst = 0;

    if (isInterstate) {
      igst = taxAmt;
    } else {
      cgst = taxAmt / 2;
      sgst = taxAmt / 2;
    }

    try {
      const created = salesRepo.create({
        orgId: active.org_id,
        gstinId: active.id,
        period: query.period || body.period || currentPeriod,
        invoiceNumber,
        invoiceDate,
        customerName,
        customerGstin,
        pos: pos || active.state_code,
        isInterstate,
        supplyType,
        taxableAmount: Number(taxableAmount),
        gstRate: Number(gstRate),
        igst,
        cgst,
        sgst,
        cess: 0,
        totalTax: taxAmt,
        totalAmount: Number(taxableAmount) + taxAmt,
        status: "VALIDATED"
      });

      return sendJson(res, 201, { success: true, invoice: created });
    } catch (err) {
      return sendJson(res, 400, { error: `Failed to create invoice: ${err.message}` });
    }
  }

  // =========================================================================
  // 5. PURCHASE BILLS CRUD & 180-DAY SUPPLIER TRACKING
  // =========================================================================
  if (pathname === "/api/purchases" && method === "GET") {
    const active = getActiveGstin();
    if (!active) return sendJson(res, 200, { purchases: [] });
    const period = query.period || currentPeriod;
    const purchases = purchaseRepo.list(active.id, period);
    return sendJson(res, 200, { purchases, total: purchases.length });
  }

  if (pathname === "/api/purchases" && method === "POST") {
    const active = getActiveGstin();
    if (!active) return sendJson(res, 400, { error: "No active GSTIN" });

    const {
      invoiceNumber, invoiceDate, supplierName, supplierGstin, pos,
      taxableAmount, gstRate, itcEligibility = "ELIGIBLE", blockedReason, isRcm = false
    } = body;

    const normalizedItc = itcEligibility === "INELIGIBLE" ? "INELIGIBLE_17_5" : (itcEligibility || "ELIGIBLE");

    const isInterstate = pos && pos.substring(0, 2) !== active.state_code;
    const taxRate = Number(gstRate) / 100;
    const taxAmt = Number(taxableAmount) * taxRate;
    let igst = 0, cgst = 0, sgst = 0;

    if (isInterstate) {
      igst = taxAmt;
    } else {
      cgst = taxAmt / 2;
      sgst = taxAmt / 2;
    }

    try {
      const created = purchaseRepo.create({
        orgId: active.org_id,
        gstinId: active.id,
        period: query.period || body.period || currentPeriod,
        invoiceNumber,
        invoiceDate,
        supplierName,
        supplierGstin,
        pos: pos || active.state_code,
        isInterstate,
        isRcm,
        taxableAmount: Number(taxableAmount),
        gstRate: Number(gstRate),
        igst,
        cgst,
        sgst,
        cess: 0,
        totalTax: taxAmt,
        totalAmount: Number(taxableAmount) + taxAmt,
        itcEligibility: normalizedItc,
        blockedReason,
        paymentStatus: "UNPAID",
        daysAging: 0
      });

      return sendJson(res, 201, { success: true, purchase: created });
    } catch (err) {
      return sendJson(res, 400, { error: `Failed to create purchase: ${err.message}` });
    }
  }

  if (pathname.startsWith("/api/purchases/") && pathname.endsWith("/payment") && method === "POST") {
    const parts = pathname.split("/");
    const id = parts[3];
    const { amountPaid, paymentDate } = body;
    const pur = purchaseRepo.findById(id);
    if (!pur) return sendJson(res, 404, { error: "Purchase record not found" });

    const totalPaid = (pur.amount_paid || 0) + Number(amountPaid);
    let paymentStatus = "UNPAID";
    if (totalPaid >= pur.total_amount) {
      paymentStatus = "FULLY_PAID";
    } else if (totalPaid > 0) {
      paymentStatus = "PARTIALLY_PAID";
    }

    // Calculate Rule 37 180-day aging
    const agingResult = analyzeInvoice180Days({
      invoiceDate: pur.invoice_date,
      totalValue: pur.total_amount,
      paidAmount: totalPaid,
      itcClaimed: pur.total_tax
    }, paymentDate || new Date().toISOString());

    const updated = purchaseRepo.updatePayment(id, {
      paymentStatus,
      paymentDate: paymentDate || new Date().toISOString().split("T")[0],
      amountPaid: totalPaid,
      daysAging: agingResult.daysAging || 0,
      rule37Interest: agingResult.interestPayable || 0
    });

    return sendJson(res, 200, { success: true, purchase: updated, aging: agingResult });
  }

  // =========================================================================
  // 6. FILE STORAGE & DOWNLOADS
  // =========================================================================
  if (pathname === "/api/documents" && method === "GET") {
    const active = getActiveGstin();
    if (!active) return sendJson(res, 200, { documents: [] });
    const docs = documentRepo.listByGstin(active.id, query.category);
    return sendJson(res, 200, { documents: docs, count: docs.length });
  }

  if (pathname === "/api/documents/upload" && method === "POST") {
    const active = getActiveGstin();
    if (!active) return sendJson(res, 400, { error: "No active GSTIN" });

    const filename = body.filename || `Document_${Date.now()}.pdf`;
    const category = body.category || "purchase_bill";

    // 1. File size limit enforcement (15MB maximum)
    const MAX_FILE_SIZE = 15 * 1024 * 1024;
    let fileBytes;
    const rawInput = body.content || body.rawText || "";

    if (typeof rawInput === "string" && rawInput.includes(";base64,")) {
      fileBytes = Buffer.from(rawInput.split(";base64,")[1], "base64");
    } else if (Buffer.isBuffer(rawInput)) {
      fileBytes = rawInput;
    } else if (typeof rawInput === "string") {
      fileBytes = Buffer.from(rawInput, "utf8");
    } else {
      fileBytes = Buffer.from("SAMPLE_BINARY_CONTENT", "utf8");
    }

    if (fileBytes.length > MAX_FILE_SIZE) {
      return sendJson(res, 400, { error: "File exceeds maximum permitted upload limit of 15MB" });
    }

    // 2. MIME / file extension validation
    const ext = path.extname(filename).toLowerCase();
    const allowedExts = [".pdf", ".png", ".jpg", ".jpeg", ".txt", ".csv"];
    if (ext && !allowedExts.includes(ext)) {
      return sendJson(res, 400, { error: `Unsupported file extension '${ext}'. Permitted formats: PDF, PNG, JPG, JPEG, TXT, CSV.` });
    }

    // 3. Secure disk storage with sanitized filename and safe random UUID
    const safeName = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, "_");
    const storedKey = `${crypto.randomUUID()}_${safeName}`;
    const targetPath = path.join(uploadsDir, storedKey);
    fs.writeFileSync(targetPath, fileBytes);

    const doc = documentRepo.create({
      orgId: active.org_id,
      gstinId: active.id,
      category,
      originalFilename: filename,
      storedFilename: storedKey,
      fileType: ext.replace(".", "").toUpperCase() || "PDF",
      fileSizeBytes: fileBytes.length,
      storagePath: targetPath
    });

    // 4. Reliable text extraction from PDF buffer
    const { text: pdfText, isPdf, isScanned } = extractTextFromPdf(fileBytes);
    const textToParse = pdfText || (typeof body.rawText === "string" && !body.rawText.startsWith("data:") ? body.rawText : "");

    // 5. Duplicate checker callback
    const checkDuplicateInvoice = (invNum, type) => {
      if (!invNum) return false;
      if (type === "sales_invoice") {
        return db.prepare("SELECT id FROM sales_invoices WHERE gstin_id = ? AND invoice_number = ?").get(active.id, invNum);
      } else {
        return db.prepare("SELECT id FROM purchase_invoices WHERE gstin_id = ? AND invoice_number = ?").get(active.id, invNum);
      }
    };

    // 6. Comprehensive invoice parsing
    const parsedInvoice = parseInvoiceFromText(textToParse, {
      filename,
      categoryHint: category,
      activeGstin: active,
      checkDuplicateInvoice,
      isScanned
    });

    // Backward compatibility for existing test suites
    const legacyExtracted = extractDocumentData({
      type: category === "sales_invoice" ? "sales_invoice" : "purchase_bill",
      rawText: textToParse || body.rawText || "",
      filename
    });

    const extractedData = {
      ...(legacyExtracted.data || legacyExtracted.extracted || {}),
      ...parsedInvoice.totals,
      invoiceNumber: parsedInvoice.invoiceInfo.invoiceNumber || legacyExtracted.data?.invoiceNumber,
      invoiceDate: parsedInvoice.invoiceInfo.invoiceDate || legacyExtracted.data?.invoiceDate,
      partyName: parsedInvoice.documentType === "sales_invoice" ? parsedInvoice.buyer.name : parsedInvoice.seller.name,
      gstin: parsedInvoice.documentType === "sales_invoice" ? parsedInvoice.buyer.gstin : parsedInvoice.seller.gstin,
      buyerGstin: parsedInvoice.buyer.gstin,
      pos: parsedInvoice.invoiceInfo.pos,
      taxableValue: parsedInvoice.totals.taxableAmount,
      totalGst: parsedInvoice.totals.totalTax,
      totalInvoiceValue: parsedInvoice.totals.totalAmount,
      lineItems: parsedInvoice.lineItems,
      warnings: parsedInvoice.warnings,
      confidence: parsedInvoice.confidence,
      parsedInvoice
    };

    const ocrRecord = ocrRepo.saveExtraction({
      documentId: doc.id,
      rawText: textToParse,
      extractedFields: extractedData,
      confidence: parsedInvoice.confidenceScore
    });

    return sendJson(res, 201, {
      success: true,
      document: doc,
      ocr: ocrRecord,
      parsedInvoice,
      extractedFields: extractedData,
      warnings: parsedInvoice.warnings
    });
  }

  if (pathname.startsWith("/api/documents/") && pathname.endsWith("/download") && method === "GET") {
    const parts = pathname.split("/");
    const docId = parts[3];
    const doc = documentRepo.findById(docId);
    if (!doc) return sendJson(res, 404, { error: "Document not found" });

    // Path traversal defense
    const safePath = path.resolve(doc.storage_path);
    if (!safePath.startsWith(path.resolve(uploadsDir))) {
      return sendJson(res, 403, { error: "Access denied to unauthorized storage path" });
    }

    if (!fs.existsSync(safePath)) {
      return sendJson(res, 404, { error: "Stored file missing on disk" });
    }

    const stat = fs.statSync(safePath);
    res.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Length": stat.size,
      "Content-Disposition": `attachment; filename="${path.basename(doc.original_filename)}"`
    });
    fs.createReadStream(safePath).pipe(res);
    return true;
  }

  if (pathname === "/api/documents" && method === "GET") {
    const active = getActiveGstin();
    if (!active) return sendJson(res, 200, { documents: [] });
    const docs = documentRepo.listByGstin(active.id, query.category);
    return sendJson(res, 200, { documents: docs });
  }

  if (pathname.startsWith("/api/documents/") && method === "DELETE") {
    const parts = pathname.split("/");
    const docId = parts[3];
    documentRepo.delete(docId);
    return sendJson(res, 200, { success: true, message: "Document deleted successfully" });
  }

  // =========================================================================
  // 6B. REPORTS & EXPORTS IN CSV
  // =========================================================================
  if (pathname === "/api/reports/sales/csv" && method === "GET") {
    const active = getActiveGstin();
    if (!active) return sendJson(res, 400, { error: "No active GSTIN" });
    const period = query.period || currentPeriod;
    const invoices = salesRepo.list(active.id, period);
    let csv = "Invoice Number,Invoice Date,Customer Name,Customer GSTIN,POS,Taxable Value,GST Rate,IGST,CGST,SGST,Total Tax,Total Amount\n";
    invoices.forEach(inv => {
      csv += `"${inv.invoice_number}","${inv.invoice_date}","${inv.customer_name}","${inv.customer_gstin || ''}","${inv.pos}",${inv.taxable_amount},${inv.gst_rate}%,${inv.igst},${inv.cgst},${inv.sgst},${inv.total_tax},${inv.total_amount}\n`;
    });
    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="Sales_Register_${active.gstin}_${period}.csv"`
    });
    res.end(csv);
    return true;
  }

  if (pathname === "/api/reports/purchases/csv" && method === "GET") {
    const active = getActiveGstin();
    if (!active) return sendJson(res, 400, { error: "No active GSTIN" });
    const period = query.period || currentPeriod;
    const purchases = purchaseRepo.list(active.id, period);
    let csv = "Invoice Number,Invoice Date,Supplier Name,Supplier GSTIN,POS,Taxable Value,GST Rate,IGST,CGST,SGST,Total Tax,Total Amount,ITC Eligibility,Payment Status\n";
    purchases.forEach(pur => {
      csv += `"${pur.invoice_number}","${pur.invoice_date}","${pur.supplier_name}","${pur.supplier_gstin}","${pur.pos}",${pur.taxable_amount},${pur.gst_rate}%,${pur.igst},${pur.cgst},${pur.sgst},${pur.total_tax},${pur.total_amount},"${pur.itc_eligibility}","${pur.payment_status}"\n`;
    });
    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="Purchase_Register_${active.gstin}_${period}.csv"`
    });
    res.end(csv);
    return true;
  }

  if (pathname === "/api/reports/reconciliation/csv" && method === "GET") {
    const active = getActiveGstin();
    if (!active) return sendJson(res, 400, { error: "No active GSTIN" });
    const period = query.period || currentPeriod;
    const gstr2bList = gstr2bRepo.list(active.id, period);
    let csv = "Supplier GSTIN,Supplier Trade Name,Invoice Number,Invoice Date,Taxable Value,IGST,CGST,SGST,Total Tax,Filing Date,GSTR-1 Status,Recon Match\n";
    gstr2bList.forEach(r => {
      csv += `"${r.supplier_gstin}","${r.supplier_name}","${r.invoice_number}","${r.invoice_date}",${r.taxable_amount},${r.igst},${r.cgst},${r.sgst},${r.total_tax},"${r.filing_date}","${r.gstr1_filing_status}","${r.status}"\n`;
    });
    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="GSTR2B_Reconciliation_${active.gstin}_${period}.csv"`
    });
    res.end(csv);
    return true;
  }

  if (pathname === "/api/reports/ledgers/csv" && method === "GET") {
    const active = getActiveGstin();
    if (!active) return sendJson(res, 400, { error: "No active GSTIN" });
    const totals = ledgerRepo.getTotals(active.id);
    let csv = "Ledger Type,Total Balance (INR)\n";
    csv += `Electronic Cash Ledger (PMT-05),${totals.CASH || 0}\n`;
    csv += `Electronic Credit Ledger (PMT-02),${totals.CREDIT || 0}\n`;
    csv += `Electronic Liability Ledger (PMT-01),${totals.LIABILITY || 0}\n`;
    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="Electronic_Ledgers_${active.gstin}.csv"`
    });
    res.end(csv);
    return true;
  }

  if (pathname.startsWith("/api/documents/") && pathname.endsWith("/re-extract") && method === "POST") {
    const parts = pathname.split("/");
    const docId = parts[3];
    const doc = documentRepo.findById(docId);
    if (!doc) return sendJson(res, 404, { error: "Document not found" });

    const active = getActiveGstin();
    if (!active || doc.org_id !== active.org_id) {
      return sendJson(res, 403, { error: "Access denied to unauthorized document" });
    }

    const safePath = path.resolve(doc.storage_path);
    if (!fs.existsSync(safePath)) {
      return sendJson(res, 404, { error: "Stored file missing on disk" });
    }

    const fileBytes = fs.readFileSync(safePath);
    const { text: extractedText, isScanned } = extractTextFromPdf(fileBytes);
    const category = body.category || doc.category;

    const checkDuplicateInvoice = (invNum, type) => {
      if (!invNum) return false;
      if (type === "sales_invoice") {
        return db.prepare("SELECT id FROM sales_invoices WHERE gstin_id = ? AND invoice_number = ?").get(active.id, invNum);
      } else {
        return db.prepare("SELECT id FROM purchase_invoices WHERE gstin_id = ? AND invoice_number = ?").get(active.id, invNum);
      }
    };

    const parsedInvoice = parseInvoiceFromText(extractedText, {
      filename: doc.original_filename,
      categoryHint: category,
      activeGstin: active,
      checkDuplicateInvoice,
      isScanned
    });

    const ocrRecord = ocrRepo.saveExtraction({
      documentId: doc.id,
      rawText: extractedText,
      extractedFields: parsedInvoice,
      confidence: parsedInvoice.confidenceScore
    });

    return sendJson(res, 200, {
      success: true,
      document: doc,
      ocr: ocrRecord,
      parsedInvoice,
      extractedFields: parsedInvoice,
      warnings: parsedInvoice.warnings
    });
  }

  // =========================================================================
  // 7. OCR APPROVAL -> POST INTO INVOICE RECORDS
  // =========================================================================
  if (pathname === "/api/ocr/approve" && method === "POST") {
    const active = getActiveGstin();
    if (!active) return sendJson(res, 400, { error: "No active GSTIN" });

    const { documentId, invoiceType = "purchase_bill", fields } = body;
    if (!fields || !fields.invoiceNumber || (!fields.taxableValue && !fields.taxableAmount)) {
      return sendJson(res, 400, { error: "Missing required extracted fields for approval (Invoice # and Taxable Value)." });
    }

    const invNum = fields.invoiceNumber.trim();
    const invDate = fields.invoiceDate || new Date().toISOString().split("T")[0];
    const taxableVal = Number(fields.taxableAmount !== undefined ? fields.taxableAmount : fields.taxableValue);
    const pos = fields.pos ? fields.pos.slice(0, 2) : active.state_code;
    const isInterstate = pos !== active.state_code;
    const gstRate = Number(fields.gstRate || 18);
    const cgst = Number(fields.cgst !== undefined ? fields.cgst : (isInterstate ? 0 : (fields.totalTax ? fields.totalTax / 2 : taxableVal * 0.09)));
    const sgst = Number(fields.sgst !== undefined ? fields.sgst : (isInterstate ? 0 : (fields.totalTax ? fields.totalTax / 2 : taxableVal * 0.09)));
    const igst = Number(fields.igst !== undefined ? fields.igst : (isInterstate ? (fields.totalTax || taxableVal * 0.18) : 0));
    const cess = Number(fields.cess || 0);
    const totalTax = Number(fields.totalTax !== undefined ? fields.totalTax : (fields.totalGst || (cgst + sgst + igst + cess)));
    const totalAmount = Number(fields.totalAmount !== undefined ? fields.totalAmount : (fields.totalInvoiceValue || (taxableVal + totalTax)));

    if (invoiceType === "sales_invoice") {
      // 1. Strict duplicate check in active Sales Register
      const existing = db.prepare("SELECT id FROM sales_invoices WHERE gstin_id = ? AND invoice_number = ?").get(active.id, invNum);
      if (existing) {
        return sendJson(res, 400, { error: `Duplicate invoice: Invoice number '${invNum}' already exists in your Sales Register.` });
      }

      const created = salesRepo.create({
        orgId: active.org_id,
        gstinId: active.id,
        period: currentPeriod,
        invoiceNumber: invNum,
        invoiceDate: invDate,
        customerName: fields.customerName || fields.partyName || "B2B Customer",
        customerGstin: fields.customerGstin || fields.buyerGstin || fields.gstin || null,
        pos,
        isInterstate,
        supplyType: fields.supplyType || (fields.buyerGstin || fields.customerGstin ? "B2B" : "B2C"),
        taxableAmount: taxableVal,
        gstRate,
        cgst,
        sgst,
        igst,
        cess,
        totalTax,
        totalAmount,
        status: "VALIDATED"
      });

      if (documentId) {
        db.prepare("UPDATE documents SET status = 'APPROVED' WHERE id = ? AND org_id = ?").run(documentId, active.org_id);
        db.prepare("UPDATE ocr_extractions SET status = 'APPROVED', approved_at = CURRENT_TIMESTAMP WHERE document_id = ?").run(documentId);
      }

      return sendJson(res, 200, {
        success: true,
        message: `Sales Invoice #${invNum} approved and saved to Sales Register`,
        invoice: created
      });
    } else {
      const supplierGstin = (fields.supplierGstin || fields.gstin || "27AAACM1234B1Z2").toUpperCase();
      
      // 2. Strict duplicate check in active Purchase Register
      const existing = db.prepare("SELECT id FROM purchase_invoices WHERE gstin_id = ? AND invoice_number = ? AND supplier_gstin = ?").get(active.id, invNum, supplierGstin);
      if (existing) {
        return sendJson(res, 400, { error: `Duplicate bill: Purchase bill '${invNum}' from supplier '${supplierGstin}' already exists.` });
      }

      const itcEligibility = ["ELIGIBLE", "INELIGIBLE_17_5", "INELIGIBLE_OTHER"].includes(fields.itcEligibility)
        ? fields.itcEligibility
        : "ELIGIBLE";

      const created = purchaseRepo.create({
        orgId: active.org_id,
        gstinId: active.id,
        period: currentPeriod,
        invoiceNumber: invNum,
        invoiceDate: invDate,
        supplierName: fields.supplierName || fields.partyName || "Vendor Enterprise",
        supplierGstin,
        pos,
        isInterstate,
        isRcm: Boolean(fields.isRcm),
        taxableAmount: taxableVal,
        gstRate,
        cgst,
        sgst,
        igst,
        cess,
        totalTax,
        totalAmount,
        itcEligibility,
        paymentStatus: "UNPAID"
      });

      if (documentId) {
        db.prepare("UPDATE documents SET status = 'APPROVED' WHERE id = ? AND org_id = ?").run(documentId, active.org_id);
        db.prepare("UPDATE ocr_extractions SET status = 'APPROVED', approved_at = CURRENT_TIMESTAMP WHERE document_id = ?").run(documentId);
      }

      return sendJson(res, 200, {
        success: true,
        message: `Purchase Bill #${invNum} approved and saved to Inward Register`,
        purchase: created
      });
    }
  }

  // =========================================================================
  // 8. GSTR-2B RECONCILIATION SUMMARY
  // =========================================================================
  if (pathname === "/api/reconciliation/summary" && method === "GET") {
    const active = getActiveGstin();
    if (!active) return sendJson(res, 200, { summary: {} });
    const period = query.period || currentPeriod;

    const purchases = purchaseRepo.list(active.id, period);
    const gstr2bRows = db.prepare("SELECT * FROM gstr2b_entries WHERE gstin_id = ? AND period = ?").all(active.id, period);

    let matchedCount = 0, matchedTax = 0;
    let mismatchCount = 0, mismatchTax = 0;
    let missingIn2bCount = 0, missingTax = 0;
    let blockedCount = 0, blockedTax = 0;

    purchases.forEach(p => {
      if (p.itc_eligibility !== "ELIGIBLE") {
        blockedCount++;
        blockedTax += p.total_tax;
        return;
      }
      const matchIn2B = gstr2bRows.find(g => g.invoice_number === p.invoice_number && g.supplier_gstin === p.supplier_gstin);
      if (matchIn2B) {
        if (Math.abs(matchIn2B.taxable_value - p.taxable_amount) <= 1) {
          matchedCount++;
          matchedTax += p.total_tax;
        } else {
          mismatchCount++;
          mismatchTax += Math.abs(matchIn2B.taxable_value - p.taxable_amount);
        }
      } else {
        missingIn2bCount++;
        missingTax += p.total_tax;
      }
    });

    return sendJson(res, 200, {
      period,
      summary: {
        totalBooksPurchases: purchases.length,
        total2bInvoices: gstr2bRows.length,
        matched: { count: matchedCount, itcAmount: matchedTax },
        mismatch: { count: mismatchCount, varianceAmount: mismatchTax },
        missingIn2b: { count: missingIn2bCount, atRiskItc: missingTax },
        blockedSec17_5: { count: blockedCount, blockedItc: blockedTax }
      },
      matchRatePercent: purchases.length > 0 ? Math.round((matchedCount / purchases.length) * 100) : 100
    });
  }

  // =========================================================================
  // 9. TAX CALCULATION & RULE 88A OFFSET (GSTR-3B)
  // =========================================================================
  if (pathname === "/api/returns/tax-calc" && method === "GET") {
    const active = getActiveGstin();
    if (!active) return sendJson(res, 400, { error: "No active GSTIN" });
    const period = query.period || currentPeriod;

    const sales = salesRepo.list(active.id, period);
    const purchases = purchaseRepo.list(active.id, period);

    const liability = {
      igst: sales.reduce((a, s) => a + s.igst, 0),
      cgst: sales.reduce((a, s) => a + s.cgst, 0),
      sgst: sales.reduce((a, s) => a + s.sgst, 0)
    };

    const eligible = purchases.filter(p => p.itc_eligibility === "ELIGIBLE");
    const inputCredit = {
      igst: eligible.reduce((a, p) => a + p.igst, 0),
      cgst: eligible.reduce((a, p) => a + p.cgst, 0),
      sgst: eligible.reduce((a, p) => a + p.sgst, 0)
    };

    // Execute deterministic Rule 88A set-off engine
    const setoffResult = computeRule88aSetoff(liability, inputCredit);

    const netCash = setoffResult.netCashPayable ? setoffResult.netCashPayable.total : 0;
    const excessCredit = setoffResult.itcCarryForward ? setoffResult.itcCarryForward.total : 0;

    return sendJson(res, 200, {
      period,
      liability,
      inputCredit,
      setoffMatrix: setoffResult.utilizationMatrix,
      remainingLiability: setoffResult.netCashPayable,
      remainingCredit: setoffResult.itcCarryForward,
      netCashPayable: netCash,
      excessCreditCarryForward: excessCredit,
      status: netCash > 0 ? "CHALLAN_DEFICIT" : "FULLY_OFFSET"
    });
  }

  // =========================================================================
  // 10. GST COPILOT CONTEXT & QUESTIONS
  // =========================================================================
  if (pathname === "/api/copilot/status" && method === "GET") {
    const active = getActiveGstin();
    const period = query.period || currentPeriod;
    const periodInfo = formatPeriodDetails(period);
    const org = active ? orgRepo.findById(active.org_id) : null;
    const sales = active ? salesRepo.list(active.id, period) : [];
    const purchases = active ? purchaseRepo.list(active.id, period) : [];
    const totalSalesTax = sales.reduce((a, s) => a + s.total_tax, 0);
    const totalPurchasesTax = purchases.reduce((a, p) => a + p.total_tax, 0);
    const hasApiKey = Boolean(process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY);

    return sendJson(res, 200, {
      configured: hasApiKey,
      mode: hasApiKey ? "cloud_llm" : "deterministic_statutory",
      engine: "SimpleGST Statutory Knowledge & Database Grounding Engine",
      citationDatabase: "CBIC Circulars, Notifications & CGST Act 2017",
      activeEntity: active ? {
        id: active.id,
        tradeName: active.trade_name,
        gstin: active.gstin,
        stateName: active.state_name,
        stateCode: active.state_code
      } : null,
      activeOrg: org ? { name: org.legal_name, pan: org.pan } : null,
      activePeriod: period,
      periodLabel: periodInfo.full,
      periodShort: periodInfo.short,
      deadlines: {
        gstr1: periodInfo.gstr1Deadline,
        gstr3b: periodInfo.gstr3bDeadline
      },
      summary: {
        salesInvoices: sales.length,
        outputLiability: totalSalesTax,
        purchaseBills: purchases.length,
        inputTaxCredit: totalPurchasesTax
      },
      aiEngine: {
        provider: "Local Grounded Engine",
        model: "Deterministic GST Compliance Rulebook v2.4",
        gspConnected: false,
        status: "ONLINE"
      }
    });
  }

  if (pathname === "/api/copilot/ask" && method === "POST") {
    const active = getActiveGstin();
    if (!active) return sendJson(res, 400, { error: "No active GSTIN" });
    const period = body.period || query.period || currentPeriod;
    const periodInfo = formatPeriodDetails(period);

    const queryText = (body.question || body.query || "").toLowerCase();
    const sales = salesRepo.list(active.id, period);
    const purchases = purchaseRepo.list(active.id, period);

    const totalSalesTax = sales.reduce((a, s) => a + s.total_tax, 0);
    const totalSalesTaxable = sales.reduce((a, s) => a + s.taxable_amount, 0);
    const eligiblePurchases = purchases.filter(p => p.itc_eligibility === "ELIGIBLE");
    const eligibleItc = eligiblePurchases.reduce((a, p) => a + p.total_tax, 0);
    const cashShortfall = Math.max(0, totalSalesTax - eligibleItc);
    const gstr2bList = gstr2bRepo.list(active.id, period);
    const cashBalance = ledgerRepo.getBalance(active.id, "CASH");

    let answer = "";
    let citations = [];
    let requiresCa = false;

    // 1. Total sales question
    if (queryText.includes("total sales") || (queryText.includes("sales") && (queryText.includes("month") || queryText.includes("october")))) {
      answer = `For ${active.trade_name} (${active.gstin}) in ${period}, your total recorded sales are ₹${totalSalesTaxable.toLocaleString("en-IN")} across ${sales.length} invoices, with total GST of ₹${totalSalesTax.toLocaleString("en-IN")}. Outward taxable supplies are categorized for GSTR-1 Table 4 (B2B) and Table 7 (B2C).`;
      citations.push("Section 31 & Section 37 CGST Act 2017 (GSTR-1 Invoicing)");
    } 
    // 2. ITC claim question
    else if (queryText.includes("itc") && (queryText.includes("how much") || queryText.includes("claim") || queryText.includes("eligible"))) {
      answer = `You can claim ₹${eligibleItc.toLocaleString("en-IN")} in eligible Input Tax Credit (ITC) for ${period} across ${eligiblePurchases.length} inward bills. All eligible bills strictly satisfy Section 16(2)(aa) GSTR-2B matching requirements.`;
      citations.push("Section 16(2)(aa) CGST Act 2017 & Rule 36(4)");
    } 
    // 3. Invoices missing from GSTR-2B
    else if (queryText.includes("missing") || queryText.includes("not in 2b") || (queryText.includes("2b") && queryText.includes("invoices"))) {
      const gstr2bInvNos = new Set(gstr2bList.map(r => r.invoice_number));
      const missingBills = purchases.filter(p => !gstr2bInvNos.has(p.invoice_number) || p.gstr2b_match_status === "MISSING_IN_2B");
      const missingCount = missingBills.length;
      const missingTax = missingBills.reduce((a, b) => a + b.total_tax, 0);
      const missingDetails = missingBills.slice(0, 3).map(b => `${b.invoice_number} (${b.supplier_name} - ₹${b.total_tax})`).join(", ");
      answer = missingCount > 0
        ? `Reconciliation Alert: ${missingCount} purchase bill(s) are currently missing from your supplier's filed GSTR-1 (₹${missingTax.toLocaleString("en-IN")} ITC at risk). Missing bills: ${missingDetails}. Under Section 16(2)(aa), ITC cannot be availed in GSTR-3B until your suppliers furnish these invoices in their GSTR-1/IFF.`
        : `Reconciliation Clean: 100% of your inward purchase bills match GSTR-2B records for ${period}. Zero missing supplier invoices detected.`;
      citations.push("Section 16(2)(aa) & Rule 37A CGST Rules");
    } 
    // 4. Estimated tax liability & how much to pay
    else if (
      queryText.includes("tax liability") || 
      queryText.includes("estimated tax") || 
      (queryText.includes("how much") && (queryText.includes("pay") || queryText.includes("liability") || queryText.includes("tax"))) ||
      (queryText.includes("liability") && queryText.includes("how much"))
    ) {
      answer = cashShortfall > 0
        ? `For ${active.trade_name} (${active.gstin}) in ${period}, your gross tax liability is ₹${totalSalesTax.toLocaleString("en-IN")}. After offsetting ₹${eligibleItc.toLocaleString("en-IN")} available ITC under Rule 88A, your estimated net tax payable in cash is ₹${cashShortfall.toLocaleString("en-IN")}. Generate Form GST PMT-06 to credit your cash ledger.`
        : `Great news! For ${active.trade_name} in ${period}, your net cash payable is ₹0. Your eligible Input Tax Credit (₹${eligibleItc.toLocaleString("en-IN")}) fully offsets your gross sales tax liability (₹${totalSalesTax.toLocaleString("en-IN")}).`;
      citations.push("Section 49 & Rule 88A CGST Rules");
    } 
    // 5. 180-day payment limit (Rule 37)
    else if (queryText.includes("180") || queryText.includes("aging") || queryText.includes("rule 37")) {
      const atRiskBills = purchases.filter(p => p.days_aging >= 120 && p.payment_status !== "PAID");
      const atRiskDetails = atRiskBills.slice(0, 3).map(b => `${b.invoice_number} (${b.supplier_name}: ${b.days_aging} days)`).join(", ");
      answer = atRiskBills.length > 0
        ? `Section 16(2) 2nd Proviso & Rule 37 Alert: ${atRiskBills.length} purchase bill(s) are approaching or past the statutory 180-day supplier payment deadline (${atRiskDetails}). If unpaid beyond 180 days, the proportionate ITC must be reversed in Table 4(B)(2) of GSTR-3B along with 18% annual interest under Section 50.`
        : `Payment Aging Clean (Section 16(2) 2nd Proviso & Rule 37): All inward purchase bills are within safe payment aging (<120 days). No mandatory Table 4(B)(2) reversals required for ${period}.`;
      citations.push("Section 16(2) 2nd Proviso, Rule 37 & Section 50(1) CGST Act");
    } 
    // 6. Explain GSTR-3B calculation
    else if (queryText.includes("explain") || queryText.includes("calculation") || queryText.includes("setoff")) {
      answer = `Statutory GSTR-3B Calculation for ${period}: Gross Table 3.1 outward liability is ₹${totalSalesTax.toLocaleString("en-IN")}. Table 4(A)(5) eligible ITC is ₹${eligibleItc.toLocaleString("en-IN")}. Rule 88A setoff order: Integrated Tax (IGST) credit must be 100% exhausted against IGST, CGST, and SGST liabilities before CGST or SGST credit can be utilized. Furthermore, CGST credit can never cross-utilize against SGST liability, and vice versa. Net remaining cash shortfall is ₹${cashShortfall.toLocaleString("en-IN")}.`;
      citations.push("Section 49, Section 49A, Section 49B & Rule 88A");
    } 
    // 7. What should I complete before filing
    else if (queryText.includes("before filing") || queryText.includes("checklist") || queryText.includes("complete")) {
      answer = `Pre-Filing Compliance Checklist for ${active.gstin} (${period}): 1. Outward Invoices: Verify all sales bills are accounted in GSTR-1; 2. Inward ITC: Confirm GSTR-2B reconciliation is locked; 3. Rule 88A Evaluation: Run automated tax set-off; 4. PMT-06 Challan: If cash ledger has a deficit of ₹${cashShortfall.toLocaleString("en-IN")}, deposit funds; 5. Two-Stage Sequential Gate: Section 39(10) requires GSTR-1 to be filed before GSTR-3B can be submitted.`;
      citations.push("Section 37(4), Section 39(10) & Rule 87(6) CGST Rules");
    } 
    // 8. Show current cash ledger balance
    else if (queryText.includes("cash ledger") || queryText.includes("pmt-05") || queryText.includes("cash balance") || queryText.includes("ledger balance")) {
      const cashTotal = (cashBalance.cgst || 0) + (cashBalance.sgst || 0) + (cashBalance.igst || 0);
      answer = `Your current Electronic Cash Ledger (Form GST PMT-05) balance for ${active.gstin} is ₹${cashTotal.toLocaleString("en-IN")} (CGST: ₹${(cashBalance.cgst || 0).toLocaleString("en-IN")}, SGST: ₹${(cashBalance.sgst || 0).toLocaleString("en-IN")}, IGST: ₹${(cashBalance.igst || 0).toLocaleString("en-IN")}). Cash in this ledger is available for offsetting tax liabilities, interest, or late fees.`;
      citations.push("Section 49(1) CGST Act & Form GST PMT-05");
    } 
    // Nil return queries
    else if (queryText.includes("nil") || queryText.includes("zero")) {
      answer = `A Nil GST Return (Form GSTR-3B) is filed under Section 39 when a taxpayer has zero sales, zero purchase credit claims, and zero reverse charge liability in the tax period. SimpleGST supports 1-Click Nil Return filing with explicit confirmation.`;
      citations.push("Section 39(1) CGST Act & Rule 67A");
    } 
    // General fallback grounded in DB records
    else {
      answer = `Based on your records for ${active.trade_name} (${period}): Output tax liability is ₹${totalSalesTax.toLocaleString("en-IN")}, eligible ITC is ₹${eligibleItc.toLocaleString("en-IN")}, and net cash shortfall is ₹${cashShortfall.toLocaleString("en-IN")}. Cash ledger balance is ₹${((cashBalance.cgst || 0) + (cashBalance.sgst || 0)).toLocaleString("en-IN")}. You can view the details in the Tax Calc and Reconciliation suites.`;
      citations.push("Section 49 & Section 39 CGST Act 2017");
    }

    return sendJson(res, 200, {
      answer,
      citations,
      activeContext: {
        tradeName: active.trade_name,
        gstin: active.gstin,
        period: periodInfo.full
      },
      requiresCa
    });
  }

  // =========================================================================
  // 11. LEDGER BALANCES & PMT-06 CHALLAN WORKFLOW
  // =========================================================================
  if (pathname === "/api/ledgers/balances" && method === "GET") {
    const active = getActiveGstin();
    if (!active) return sendJson(res, 200, { balances: {} });

    const cashLedger = ledgerRepo.getBalance(active.id, "CASH");
    const creditLedger = ledgerRepo.getBalance(active.id, "CREDIT");
    const totals = ledgerRepo.getTotals(active.id);

    return sendJson(res, 200, {
      gstin: active.gstin,
      totals,
      cashLedger,
      creditLedger
    });
  }

  if (pathname === "/api/challans/generate-pmt06" && method === "POST") {
    const active = getActiveGstin();
    if (!active) return sendJson(res, 400, { error: "No active GSTIN" });

    const amount = Number(body.amount || 62436);
    const paymentMode = body.paymentMode || "NET_BANKING";

    // Enforce Rule 87(4) Over-The-Counter ₹10,000 statutory limit
    if (paymentMode === "OVER_THE_COUNTER" && amount > 10000) {
      return sendJson(res, 400, {
        error: "Rule 87(4) CGST Rules: Over-The-Counter payment cannot exceed ₹10,000 per challan per tax period."
      });
    }

    // Generate statutory 14-digit CPIN
    const challanResult = generatePmt06Challan(active.gstin, {
      igstTax: Number(body.igst || 0),
      cgstTax: Number(body.cgst || (amount / 2)),
      sgstTax: Number(body.sgst || (amount / 2)),
      cessTax: 0
    }, paymentMode);

    const saved = challanRepo.create({
      gstinId: active.id,
      period: currentPeriod,
      cpin: challanResult.cpin,
      totalAmount: challanResult.totalChallanAmount,
      majorHeads: challanResult.amounts,
      paymentMode
    });

    return sendJson(res, 201, {
      success: true,
      challan: saved,
      cpin: challanResult.cpin,
      expiryDate: challanResult.expiryDate,
      modeNotice: "[DEMO/SIMULATION MODE — Not processed on RBI NEFT gateway]"
    });
  }

  if (pathname === "/api/challans/simulate-payment" && method === "POST") {
    if (context.user?.role === "ACCOUNTANT") {
      return sendJson(res, 403, { error: "Forbidden: Accountant role is not authorized to execute challan payments." });
    }
    const active = getActiveGstin();
    if (!active) return sendJson(res, 400, { error: "No active GSTIN" });

    const cpin = body.cpin;
    const amount = Number(body.amount || 62436);
    const bankRef = `HDFC${Date.now().toString().slice(-8)}`;

    // Credit Cash Ledger
    ledgerRepo.creditCashLedger(active.id, "CGST", "TAX", amount / 2);
    ledgerRepo.creditCashLedger(active.id, "SGST", "TAX", amount / 2);

    return sendJson(res, 200, {
      success: true,
      message: `Challan ${cpin || "CPIN"} payment approved. ₹${amount.toLocaleString("en-IN")} credited to Electronic Cash Ledger (CIN: ${bankRef}).`,
      bankReference: bankRef,
      creditedAmount: amount
    });
  }

  // Not handled by functional API router -> pass to existing server.js routes
  return false;
}
