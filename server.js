import { handleFunctionalApi, isAllowedOrigin } from "./lib/functionalApi.js";
import { parseMultipartBuffer } from "./lib/multipart.js";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { exportReport } from "./lib/reportsEngine.js";
import { validatePan, validateGstin, validateInvoiceRow } from "./lib/validate.js";
import { calculateGstSummary } from "./lib/gst.js";
import {
  getGspMode,
  logGspRequest,
  authAdapter,
  gstr1Adapter,
  gstr2bAdapter,
  gstr3bAdapter,
  imsAdapter,
  getAllApis,
  executeGspApi,
  runAllApisHealthCheck
} from "./lib/gsp/index.js";
import {
  DEMO_BUSINESS,
  DEMO_SALES,
  DEMO_PURCHASES,
  DEMO_EXCEPTIONS,
  DEMO_RECONCILIATION,
  DEMO_ITR
} from "./lib/demoData.js";
import { parseItdPrefillJson, generateSampleItdPrefillJson } from "./lib/prefillParser.js";
import { parseBrokerCsv, parseBrokerTrades, getSampleBrokerTrades } from "./lib/brokerPnlParser.js";
import { analyzeNoticeDiscrepancies, generateStatutoryReplyDraft } from "./lib/noticeEngine.js";
import { vaultStore } from "./lib/vaultStore.js";
import { generateEinvoice, cancelEinvoice, getEinvoiceDetails, listEinvoices } from "./lib/einvoiceEngine.js";
import { generateEwayBill, updatePartBVehicle, cancelEwayBill, listEwayBills } from "./lib/ewaybillEngine.js";
import { computeCapitalLossSetOff, scanTaxLossHarvesting } from "./lib/taxLossHarvesting.js";
import { getVendorRiskLeaderboard, generateWithholdingNotice } from "./lib/vendorRiskEngine.js";
import { getMultiGstinSummary } from "./lib/multiGstinEngine.js";
import { consolidateGstr9AnnualReturn } from "./lib/gstr9Engine.js";
import { execute2TierVerification } from "./lib/panGstinValidator.js";
import { validateCin, lookupMcaCompany } from "./lib/mcaEngine.js";
import { calculateComplianceScore } from "./lib/complianceScoreEngine.js";
import { getStatutoryDueDates, generateNotificationPayload } from "./lib/dueDateEngine.js";
import { getOrCreateReferralCode, redeemReferralCredit } from "./lib/referralEngine.js";
import { validateStartupApplication, BUSINESS_TYPES } from "./lib/startupExpressEngine.js";
import { getCopilotPipelineData, answerCopilotQuestion, fileNilGstReturn } from "./lib/gstCopilotEngine.js";
import { extractDocumentData, SAMPLE_DOCUMENTS } from "./lib/aiDocumentExtractorEngine.js";
import { getCadenceSchedule, calculateDelayEscalation, STATUTORY_SEQUENCE } from "./lib/statutoryCadenceEngine.js";
import { computeRule88aSetoff } from "./lib/rule88aEngine.js";
import { processRcmInwardSupply, aggregateRcmBatch, NOTIFIED_RCM_CATEGORIES } from "./lib/rcmEngine.js";
import { analyzeInvoice180Days, auditPurchaseRegister180Days } from "./lib/supplier180DayTracker.js";
import { classifyOutwardInvoice, classifySalesRegisterForGstr1, B2CL_STATUTORY_THRESHOLD } from "./lib/gstr1StatutoryClassifier.js";
import { validateGstr1Prerequisites, validateGstr3bPrerequisites, simulateReturnFiling } from "./lib/gstrReturnLifecycleEngine.js";
import { createEmptyCashLedger, createEmptyCreditLedger, generatePmt06Challan, executePmt09Transfer } from "./lib/electronicLedgerEngine.js";
import { getPracticeDashboardSummary, getPracticeComplianceMatrix, generateClientReminder, getPracticeAuditLogs, PRACTICE_CLIENTS } from "./lib/caPracticeManager.js";
import { STATUTORY_RULES } from "./lib/statutoryRulesConfig.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 3000;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",
  ".csv": "text/csv; charset=utf-8"
};

// In-memory store for generated error reports and expert bookings
const errorReportStore = new Map();
const expertBookingStore = new Map();

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  // Support pre-parsed request body in serverless environments (e.g. Vercel)
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === "object") {
      return Promise.resolve(req.body);
    }
    if (typeof req.body === "string") {
      try {
        return Promise.resolve(req.body ? JSON.parse(req.body) : {});
      } catch {
        return Promise.resolve({ rawText: req.body });
      }
    }
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", chunk => { chunks.push(chunk); });
    req.on("end", () => {
      const buffer = Buffer.concat(chunks);
      const contentType = req.headers["content-type"] || "";

      if (contentType.toLowerCase().includes("multipart/form-data")) {
        try {
          const parsed = parseMultipartBuffer(buffer, contentType);
          resolve(parsed);
          return;
        } catch (err) {
          console.error("Multipart parsing failed:", err.message);
        }
      }

      const body = buffer.toString("utf8");
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        // Fallback for raw text/CSV
        resolve({ rawText: body, rawBuffer: buffer });
      }
    });
    req.on("error", reject);
  });
}

export async function handleRequest(req, res) {
  try {
    // Seamless URL resolution across local Node and Vercel Serverless
    let requestPath = req.url || "/";
    const vercelOriginal = req.headers["x-vercel-original-path"] || req.headers["x-matched-path"] || req.headers["x-forwarded-uri"] || req.headers["x-original-url"];
    if (vercelOriginal && !vercelOriginal.endsWith("index.js")) {
      requestPath = vercelOriginal;
    } else if (req.query && req.query.path) {
      const slug = Array.isArray(req.query.path) ? req.query.path.join("/") : req.query.path;
      requestPath = `/api/${slug}`;
    }

    const parsedUrl = new URL(requestPath, `http://${req.headers.host || "localhost"}`);
    let pathname = parsedUrl.pathname;
    if (pathname === "/api/index.js" || pathname === "/api/index") {
      pathname = "/api";
    }
    const method = req.method;
    const query = Object.assign({}, Object.fromEntries(parsedUrl.searchParams.entries()), req.query || {});

    // Hardened CORS & Origin Verification
    const origin = req.headers["origin"];
    const host = req.headers.host;
    const isOriginAllowed = isAllowedOrigin(origin, host);

    if (origin) {
      if (isOriginAllowed) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Credentials", "true");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Session-Token, X-CSRF-Token, X-Period, X-GSTIN-ID, client-id");
      } else if (method === "OPTIONS") {
        // Reject untrusted cross-origin preflight immediately with 403 Forbidden
        res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Forbidden: Untrusted Origin in preflight" }));
        return;
      }
    }

    if (method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // ---------------------------------------------------------
    // 0. FUNCTIONAL API ROUTER (Database-backed Multi-GSTIN, Invoices, Documents, OCR, Ledgers)
    // ---------------------------------------------------------
    let requestBody = {};
    if (method === "POST" || method === "PUT" || method === "PATCH") {
      requestBody = await readBody(req);
      req.body = requestBody; // Cache parsed body for downstream handlers
    }

    const isHandled = await handleFunctionalApi(req, res, pathname, method, query, requestBody);
    if (isHandled !== false) {
      return;
    }

    // ---------------------------------------------------------
    // 0b. GET /api or /api/ (API Catalog & Directory)
    // ---------------------------------------------------------
    if ((pathname === "/api" || pathname === "/api/") && method === "GET") {
      return sendJson(res, 200, {
        service: "SimpleGST Functional API Gateway",
        version: "2.0.0",
        status: "ONLINE",
        webApp: "http://localhost:3000/",
        activeGstin: "27AAACA1234A1Z5",
        endpoints: {
          session: "/api/auth/session",
          devSession: "/api/auth/dev-session",
          sales: "/api/sales",
          purchases: "/api/purchases",
          documentUpload: "/api/documents/upload",
          ocrApprove: "/api/ocr/approve",
          periodContext: "/api/context/period",
          dashboard: "/api/dashboard",
          reconciliation: "/api/reconciliation",
          taxCalculation: "/api/tax-calculation",
          electronicLedgers: "/api/ledgers",
          reportsExport: "/api/export/:report?format=(excel|csv)",
          gstinLookup: "/api/gstin/lookup?gstin=27AAACA1234A1Z5",
          taxpayerSearch: "/api/taxpayer/search?gstin=27AAACA1234A1Z5",
          gsp182Apis: "/api/gsp/apis"
        }
      });
    }

    // ---------------------------------------------------------
    // 1. GET /api/mode
    // ---------------------------------------------------------
    if (pathname === "/api/mode" && method === "GET") {
      const gsp = getGspMode();
      logGspRequest("GET_MODE", { mode: gsp.mode });
      return sendJson(res, 200, {
        mode: gsp.mode,
        isLive: gsp.isLive,
        environment: gsp.isLive ? "GSP Sandbox Live Gateway" : "In-Memory Simulation (Demo)",
        notes: [
          "Demo files. Not official GST portal or income tax portal files.",
          "Filing is simulated in demo mode."
        ]
      });
    }

    // ---------------------------------------------------------
    // 2. GET /api/sample-data
    // ---------------------------------------------------------
    if (pathname === "/api/sample-data" && method === "GET") {
      const taxSummary = calculateGstSummary(DEMO_SALES, DEMO_PURCHASES, DEMO_EXCEPTIONS);
      return sendJson(res, 200, {
        business: DEMO_BUSINESS,
        salesInvoices: DEMO_SALES,
        purchaseInvoices: DEMO_PURCHASES,
        exceptions: DEMO_EXCEPTIONS,
        reconciliation: DEMO_RECONCILIATION,
        taxCalculation: taxSummary,
        itrData: DEMO_ITR
      });
    }

    // ---------------------------------------------------------
    // 2b. POST /api/itr/compute (ITR Tax Calculation Engine)
    // ---------------------------------------------------------
    if (pathname === "/api/itr/compute" && method === "POST") {
      const body = await readBody(req);
      const income = body.income || {};
      const ay = body.assessmentYear || "2025-26";
      const activeRegime = body.taxRegime || "NEW";

      const { computeTaxForAy } = await import("./lib/taxConfig.js");
      const newRegimeComp = computeTaxForAy(income, "NEW", ay);
      const oldRegimeComp = computeTaxForAy(income, "OLD", ay);
      const activeComp = activeRegime === "OLD" ? oldRegimeComp : newRegimeComp;

      return sendJson(res, 200, {
        success: true,
        assessmentYear: ay,
        activeRegime,
        activeComputation: activeComp,
        newRegime: newRegimeComp,
        oldRegime: oldRegimeComp,
        recommendedRegime: newRegimeComp.totalTaxWithCess <= oldRegimeComp.totalTaxWithCess ? "NEW" : "OLD",
        savingsWithRecommendation: Math.abs(newRegimeComp.totalTaxWithCess - oldRegimeComp.totalTaxWithCess)
      });
    }

    // ---------------------------------------------------------
    // 2c. POST /api/itr/file (Sandbox ITR E-Filing & ARN)
    // ---------------------------------------------------------
    if (pathname === "/api/itr/file" && method === "POST") {
      const body = await readBody(req);
      const otp = body.otp;
      if (!otp || String(otp).trim().length !== 6) {
        return sendJson(res, 400, { success: false, error: "Valid 6-digit EVC OTP is required." });
      }
      if (!body.consent) {
        return sendJson(res, 400, { success: false, error: "Taxpayer declaration consent checkbox is mandatory." });
      }
      const pan = (body.pan || "CVBBC4433W").toUpperCase();
      const ackNumber = `ITRV${new Date().getFullYear()}${Math.floor(1000000000 + Math.random() * 9000000000)}`;
      return sendJson(res, 200, {
        success: true,
        mode: "sandbox-demo",
        pan,
        acknowledgementNumber: ackNumber,
        filingDate: new Date().toISOString(),
        formType: "ITR-1 (Sahaj)",
        status: "Successfully Filed & E-Verified (Sandbox)",
        notice: "Demo files. Not official GST portal or income tax portal files."
      });
    }

    // ---------------------------------------------------------
    // 2d. GET & POST /api/expert/ (ClearTax Expert Assisted Filing & 1-Month Free Trial)
    // ---------------------------------------------------------
    if (pathname === "/api/expert/plans" && method === "GET") {
      return sendJson(res, 200, {
        success: true,
        plans: [
          {
            id: "plan-free-trial",
            category: "free_trial",
            title: "1-Month Free Pro CA Advisory & Return Filing Trial",
            originalPrice: 2999,
            price: 0,
            turnaround: "Instant Activation • 24hr CA Review",
            badge: "Free for 1 Month",
            isFreeTrial: true,
            features: [
              "1-on-1 Consultation with Senior Chartered Accountant",
              "Old vs New Tax Regime Arbitrage & Deduction Audit",
              "Automated Form 16, AIS/TIS & 26AS Reconciliation",
              "Section 80C, 80D, 80CCD & HRA Tax Optimization",
              "ClearTax Client Workspace with Real-Time CA Chat",
              "100% Free for 30 Days • Zero Advance Payment"
            ]
          },
          {
            id: "plan-salaried",
            category: "filing",
            title: "Salaried & Multi-Form 16 Tax Filing",
            originalPrice: 2499,
            price: 999,
            turnaround: "Within 24 Hours",
            badge: "Most Popular",
            features: [
              "Consolidation of Multiple Form 16s & job switches",
              "HRA, LTA, and Section 10 allowances audit",
              "Old vs New Regime tax optimization",
              "Form 26AS & AIS tax credit reconciliation",
              "1-on-1 Dedicated CA Review"
            ]
          },
          {
            id: "plan-capital-gains",
            category: "wealth",
            title: "Capital Gains, Traders & Investors",
            originalPrice: 5999,
            price: 2499,
            turnaround: "Within 24-48 Hours",
            badge: "Investor Special",
            features: [
              "Direct broker statement import (Zerodha, Groww, etc.)",
              "Intraday, F&O and short/long-term gains calculation",
              "Loss set-off & carry-forward (Schedule CFL)",
              "Section 112A grandfathering verification",
              "Full ITR-2 / ITR-3 expert filing"
            ]
          },
          {
            id: "plan-fast-ds",
            category: "foreign",
            title: "Foreign Assets, RSUs & FAST-DS Disclosure",
            originalPrice: 14999,
            price: 4999,
            turnaround: "Within 48 Hours",
            badge: "Tech & NRI Choice",
            features: [
              "US Stocks, RSUs, ESPP & foreign accounts",
              "Mandatory Schedule FA disclosure & valuation",
              "Foreign Tax Credit (Form 67) & DTAA relief",
              "Black Money Act penalty protection audit",
              "Senior Cross-Border Tax CA consultation"
            ]
          },
          {
            id: "plan-business",
            category: "gst_tds",
            title: "Business & Freelancers (Section 44ADA/44AD)",
            originalPrice: 7999,
            price: 3499,
            turnaround: "Within 24-48 Hours",
            badge: "Self-Employed",
            features: [
              "Presumptive taxation under Section 44AD / 44ADA",
              "Turnover verification & expense deduction optimization",
              "Advance tax computation and scheduling",
              "GST vs ITR revenue reconciliation",
              "End-to-end filing with compliance review"
            ]
          },
          {
            id: "plan-notice-defense",
            category: "past_filings",
            title: "Notice Management & Scrutiny Defense",
            originalPrice: 11999,
            price: 4499,
            turnaround: "Priority 12 Hours",
            badge: "Notice Protect",
            features: [
              "Analysis of Section 143(1), 139(9), or 148 notices",
              "AIS vs ITR discrepancy resolution",
              "Statutory response drafting for e-Filing portal",
              "Rectification JSON preparation & resubmission",
              "Dedicated CA case representation"
            ]
          }
        ]
      });
    }

    if (pathname === "/api/expert/claim-free-trial" && method === "POST") {
      const body = await readBody(req);
      const pan = (body.pan || DEMO_BUSINESS.pan || "CVBBC4433W").toUpperCase();
      const bookingId = `CT-TRIAL-${Date.now().toString().slice(-6)}`;
      const trialRecord = {
        bookingId,
        pan,
        clientName: body.clientName || "Sanjay Harshi",
        phone: body.phone || "9876543210",
        email: body.email || "sanjay@example.com",
        planId: "plan-free-trial",
        planTitle: "1-Month Free Pro CA Advisory & Filing Trial",
        basePrice: 2999,
        discountPercent: 100,
        finalPrice: 0,
        isFreeTrial: true,
        activatedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        daysRemaining: 30,
        assignedExpert: {
          id: "ca-anwin",
          name: "CA Anwin Ramachandran",
          membershipNo: "ICAI #512891",
          role: "Senior Direct Tax & FAST-DS Specialist",
          rating: 4.9,
          reviewsCount: "8,420+",
          nextSlot: "Today, 03:00 PM (IST)"
        },
        slot: body.slot || "Today at 03:00 PM (IST)",
        meetingLink: `https://meet.cleartax.simplegst.internal/${bookingId}`,
        stage: "ca_draft_ready",
        status: "Active 1-Month Free Trial",
        computationDraft: {
          assessmentYear: "2025-26",
          financialYear: "2024-25",
          grossSalary: 1500000,
          capitalGains: 100000,
          section80C: 150000,
          section80D: 25000,
          hraExemption: 120000,
          oldRegimeTax: 273000,
          newRegimeTax: 140400,
          recommendedRegime: "New Tax Regime (Section 115BAC)",
          taxSavedByCA: 132600,
          eligibleRefund: 24600,
          status: "Verified by CA Anwin Ramachandran"
        },
        chatHistory: [
          {
            sender: "CA Anwin Ramachandran",
            role: "Chartered Accountant",
            time: "Today, 09:30 AM",
            text: "Hello Sanjay! I have activated your 1-Month Free Expert Assisted Filing Trial. I audited your Form 16 and AIS records; by adopting Section 115BAC New Tax Regime with your deductions, you save ₹1,32,600! Review your computation draft below and feel free to ask questions here."
          }
        ]
      };
      expertBookingStore.set(pan, trialRecord);
      return sendJson(res, 200, { success: true, booking: trialRecord });
    }

    if (pathname === "/api/expert/book" && method === "POST") {
      const body = await readBody(req);
      const { planId, clientName, pan, phone, slot, couponCode } = body;
      const cleanPan = (pan || "CVBBC4433W").toUpperCase();
      
      let basePrice = 2499;
      let planTitle = "Salaried & Multi-Form 16 Tax Filing";
      if (planId === "plan-free-trial") { basePrice = 2999; planTitle = "1-Month Free Pro CA Advisory & Filing Trial"; }
      else if (planId === "plan-salaried") { basePrice = 999; planTitle = "Salaried & Multi-Form 16 Tax Filing"; }
      else if (planId === "plan-capital-gains") { basePrice = 2499; planTitle = "Capital Gains, Traders & Investors"; }
      else if (planId === "plan-fast-ds") { basePrice = 4999; planTitle = "Foreign Assets, RSUs & FAST-DS Disclosure"; }
      else if (planId === "plan-business") { basePrice = 3499; planTitle = "Business & Freelancers (Section 44ADA/44AD)"; }
      else if (planId === "plan-notice-defense") { basePrice = 4499; planTitle = "Notice Management & Scrutiny Defense"; }

      let discountPercent = 0;
      const code = (couponCode || "").toUpperCase();
      if (planId === "plan-free-trial" || code === "FREE30DAYS" || code === "CLEARTAXFREE" || code === "1MONTHFREE") {
        discountPercent = 100;
      } else if (code === "TAXHERO65") {
        discountPercent = 65;
      }
      const finalPrice = Math.round(basePrice * (1 - discountPercent / 100));
      const bookingId = `CT-EXP-${Date.now().toString().slice(-6)}`;
      
      const record = {
        bookingId,
        clientName: clientName || "Sanjay Harshi",
        pan: cleanPan,
        phone: phone || "9876543210",
        planId: planId || "plan-free-trial",
        planTitle,
        basePrice,
        discountPercent,
        finalPrice,
        isFreeTrial: finalPrice === 0,
        currency: "INR",
        assignedExpert: {
          id: "ca-anwin",
          name: "CA Anwin Ramachandran",
          membershipNo: "ICAI #512891",
          role: "Senior Direct Tax & FAST-DS Specialist",
          rating: 4.9,
          reviewsCount: "8,420+",
          experience: "11+ Years"
        },
        slot: slot || "Today at 03:00 PM (IST)",
        meetingLink: `https://meet.cleartax.simplegst.internal/${bookingId}`,
        stage: "ca_draft_ready",
        status: finalPrice === 0 ? "Active 1-Month Free Trial" : "Confirmed (Sandbox Booking)",
        guarantee: "100% Accuracy & Notice Defense Guarantee Included",
        computationDraft: {
          assessmentYear: "2025-26",
          financialYear: "2024-25",
          grossSalary: 1500000,
          capitalGains: 100000,
          section80C: 150000,
          section80D: 25000,
          hraExemption: 120000,
          oldRegimeTax: 273000,
          newRegimeTax: 140400,
          recommendedRegime: "New Tax Regime (Section 115BAC)",
          taxSavedByCA: 132600,
          eligibleRefund: 24600,
          status: "Verified by CA Anwin Ramachandran"
        },
        chatHistory: [
          {
            sender: "CA Anwin Ramachandran",
            role: "Chartered Accountant",
            time: "Today, 09:30 AM",
            text: "Hello! Your consultation is confirmed. I have audited your tax profile and prepared a regime optimization computation. Check the draft computation below and let me know if you have any questions."
          }
        ]
      };
      expertBookingStore.set(cleanPan, record);
      return sendJson(res, 200, { success: true, ...record });
    }

    if (pathname.startsWith("/api/expert/status") && method === "GET") {
      const parts = pathname.split("/");
      const pan = (parts[parts.length - 1] || "CVBBC4433W").toUpperCase();
      let record = expertBookingStore.get(pan);
      if (!record) {
        record = {
          bookingId: `CT-TRIAL-DEMO`,
          pan,
          clientName: "Sanjay Harshi",
          planId: "plan-free-trial",
          planTitle: "1-Month Free Pro CA Advisory & Filing Trial",
          basePrice: 2999,
          discountPercent: 100,
          finalPrice: 0,
          isFreeTrial: true,
          daysRemaining: 30,
          assignedExpert: {
            id: "ca-anwin",
            name: "CA Anwin Ramachandran",
            membershipNo: "ICAI #512891",
            role: "Senior Direct Tax & FAST-DS Specialist",
            rating: 4.9,
            reviewsCount: "8,420+",
            nextSlot: "Today, 03:00 PM (IST)"
          },
          slot: "Today at 03:00 PM (IST)",
          meetingLink: `https://meet.cleartax.simplegst.internal/CT-TRIAL-DEMO`,
          stage: "ca_draft_ready",
          status: "Active 1-Month Free Trial",
          computationDraft: {
            assessmentYear: "2025-26",
            financialYear: "2024-25",
            grossSalary: 1500000,
            capitalGains: 100000,
            section80C: 150000,
            section80D: 25000,
            hraExemption: 120000,
            oldRegimeTax: 273000,
            newRegimeTax: 140400,
            recommendedRegime: "New Tax Regime (Section 115BAC)",
            taxSavedByCA: 132600,
            eligibleRefund: 24600,
            status: "Verified by CA Anwin Ramachandran"
          },
          chatHistory: [
            {
              sender: "CA Anwin Ramachandran",
              role: "Chartered Accountant",
              time: "Today, 09:30 AM",
              text: "Hello Sanjay! I have activated your 1-Month Free Expert Assisted Filing Trial. I audited your Form 16 and AIS records; by adopting Section 115BAC New Tax Regime with your deductions, you save ₹1,32,600! Review your computation draft below and feel free to ask questions here."
            }
          ]
        };
        expertBookingStore.set(pan, record);
      }
      return sendJson(res, 200, { success: true, booking: record });
    }

    if (pathname === "/api/expert/chat" && method === "POST") {
      const body = await readBody(req);
      const pan = (body.pan || "CVBBC4433W").toUpperCase();
      const message = body.message || "";
      let record = expertBookingStore.get(pan);
      if (!record) {
        record = { chatHistory: [] };
        expertBookingStore.set(pan, record);
      }
      record.chatHistory = record.chatHistory || [];
      record.chatHistory.push({
        sender: "You",
        role: "Client",
        time: "Just now",
        text: message
      });

      let replyText = "Thank you for your message. As your assigned Chartered Accountant, I have logged this note. I will address this in detail during our scheduled consultation.";
      const lower = message.toLowerCase();
      if (lower.includes("regime") || lower.includes("old vs new") || lower.includes("115bac")) {
        replyText = "Based on your total gross income of ₹15,00,000, the New Regime (Section 115BAC) yields a tax liability of ₹1,40,400 compared to ₹2,73,000 under the Old Regime—giving you an immediate tax saving of ₹1,32,600!";
      } else if (lower.includes("80c") || lower.includes("80d") || lower.includes("deduction")) {
        replyText = "Under Old Regime, you can claim up to ₹1.5L under 80C and ₹25K under 80D. However, even with ₹2,95,000 total deductions, the lower slab rates of Section 115BAC still beat the Old Regime for your income profile.";
      } else if (lower.includes("free") || lower.includes("trial") || lower.includes("charge")) {
        replyText = "Your 1-Month Free Expert Filing Trial is 100% active with ₹0 fees. You receive unlimited CA advisory, calculation reviews, and e-filing authorization for the next 30 days without any automatic charges.";
      } else if (lower.includes("broker") || lower.includes("capital gain") || lower.includes("stock") || lower.includes("crypto")) {
        replyText = "For equity trades, under Finance Act 2024, listed STCG is taxed @ 20% and LTCG @ 12.5% above the new ₹1.25L exemption threshold. I will automatically reconcile your Zerodha/Groww P&L in Schedule CG.";
      } else if (lower.includes("file") || lower.includes("approve") || lower.includes("ack")) {
        replyText = "You can click 'Approve Draft Computation' below to authorize e-filing. We will transmit the validated JSON to the Income Tax Department sandbox and issue your instant ITR-V acknowledgement number.";
      }

      const caReply = {
        sender: "CA Anwin Ramachandran",
        role: "Chartered Accountant",
        time: "Just now",
        text: replyText
      };
      record.chatHistory.push(caReply);

      return sendJson(res, 200, {
        success: true,
        reply: caReply,
        chatHistory: record.chatHistory
      });
    }

    if (pathname === "/api/expert/approve-draft" && method === "POST") {
      const body = await readBody(req);
      const pan = (body.pan || "CVBBC4433W").toUpperCase();
      let record = expertBookingStore.get(pan);
      const ackNumber = `ITR2026${Math.floor(10000000 + Math.random() * 90000000)}`;
      if (record) {
        record.stage = "efiled";
        record.ackNumber = ackNumber;
        record.filedAt = new Date().toISOString();
        record.status = "Filed & Verified via EVC";
      }
      return sendJson(res, 200, {
        success: true,
        pan,
        ackNumber,
        status: "Return Filed Successfully",
        verificationMode: "Aadhaar OTP / EVC (Simulated)",
        message: "Your ITR computation draft has been approved and successfully transmitted to the Income Tax e-Filing sandbox. ITR-V Acknowledgement generated!"
      });
    }

    // ---------------------------------------------------------
    // 2e. Official CBDT Pre-fill JSON Importer
    // ---------------------------------------------------------
    if (pathname === "/api/itr/sample-prefill" && method === "GET") {
      const pan = parsedUrl.searchParams.get("pan") || "CVBBC4433W";
      const sample = generateSampleItdPrefillJson(pan);
      return sendJson(res, 200, sample);
    }

    if (pathname === "/api/itr/prefill-import" && method === "POST") {
      const body = await readBody(req);
      try {
        const parsed = parseItdPrefillJson(body.rawJson || body);
        return sendJson(res, 200, parsed);
      } catch (err) {
        return sendJson(res, 400, { success: false, error: err.message });
      }
    }

    // ---------------------------------------------------------
    // 2f. Broker Tax P&L Parser (Zerodha, Groww, Upstox)
    // ---------------------------------------------------------
    if (pathname === "/api/itr/broker-pnl" && method === "POST") {
      const body = await readBody(req);
      try {
        let result;
        if (body.csvText) {
          result = parseBrokerCsv(body.csvText);
        } else if (Array.isArray(body.trades)) {
          result = parseBrokerTrades(body.trades);
        } else {
          result = parseBrokerTrades(getSampleBrokerTrades());
        }
        return sendJson(res, 200, result);
      } catch (err) {
        return sendJson(res, 400, { success: false, error: err.message });
      }
    }

    // ---------------------------------------------------------
    // 2g. Tax Document Vault API
    // ---------------------------------------------------------
    if (pathname === "/api/vault/documents" && method === "GET") {
      const category = parsedUrl.searchParams.get("category") || "all";
      const docs = vaultStore.listDocuments(category);
      return sendJson(res, 200, { success: true, count: docs.length, documents: docs });
    }

    if (pathname === "/api/vault/upload" && method === "POST") {
      const body = await readBody(req);
      const newDoc = vaultStore.addDocument(body);
      return sendJson(res, 200, { success: true, document: newDoc });
    }

    // ---------------------------------------------------------
    // 2h. Notice Defense & Scrutiny Engine (143(1), 139(9), 148)
    // ---------------------------------------------------------
    if (pathname === "/api/notices/analyze" && method === "POST") {
      const body = await readBody(req);
      const analysis = analyzeNoticeDiscrepancies(body.filedData, body.intimationData);
      return sendJson(res, 200, analysis);
    }

    if (pathname === "/api/notices/generate-draft" && method === "POST") {
      const body = await readBody(req);
      const draft = generateStatutoryReplyDraft(body);
      return sendJson(res, 200, draft);
    }

    if (pathname === "/api/notices/submit-reply" && method === "POST") {
      const body = await readBody(req);
      const ackDin = `ACK-${Date.now().toString().slice(-8)}`;
      return sendJson(res, 200, {
        success: true,
        mode: "sandbox-demo",
        submissionId: ackDin,
        din: body.din || "CPC/2526/89401283",
        section: body.section || "143(1)",
        status: "Submitted to ITD Portal (Simulated e-Filing)",
        timestamp: new Date().toISOString(),
        notice: "Demo files. Not official GST portal or income tax portal files."
      });
    }

    // ---------------------------------------------------------
    // 2i. E-Invoicing & IRP Sandbox Engine
    // ---------------------------------------------------------
    if (pathname === "/api/einvoice/generate" && method === "POST") {
      const body = await readBody(req);
      try {
        const einvoice = generateEinvoice(body);
        return sendJson(res, 200, einvoice);
      } catch (err) {
        return sendJson(res, 400, { success: false, error: err.message });
      }
    }

    if (pathname === "/api/einvoice/cancel" && method === "POST") {
      const body = await readBody(req);
      try {
        const result = cancelEinvoice(body.irn, body.reason, body.remarks);
        return sendJson(res, 200, result);
      } catch (err) {
        return sendJson(res, 400, { success: false, error: err.message });
      }
    }

    if (pathname === "/api/einvoice/details" && method === "GET") {
      const irn = parsedUrl.searchParams.get("irn");
      const details = getEinvoiceDetails(irn);
      return sendJson(res, 200, details);
    }

    if (pathname === "/api/einvoice/list" && method === "GET") {
      return sendJson(res, 200, { success: true, count: listEinvoices().length, einvoices: listEinvoices() });
    }

    // ---------------------------------------------------------
    // 2j. E-Way Bill (EWB) Lifecycle Engine
    // ---------------------------------------------------------
    if (pathname === "/api/ewaybill/generate" && method === "POST") {
      const body = await readBody(req);
      try {
        const ewb = generateEwayBill(body);
        return sendJson(res, 200, ewb);
      } catch (err) {
        return sendJson(res, 400, { success: false, error: err.message });
      }
    }

    if (pathname === "/api/ewaybill/update-part-b" && method === "POST") {
      const body = await readBody(req);
      try {
        const result = updatePartBVehicle(body.ewbNo, body);
        return sendJson(res, 200, result);
      } catch (err) {
        return sendJson(res, 400, { success: false, error: err.message });
      }
    }

    if (pathname === "/api/ewaybill/cancel" && method === "POST") {
      const body = await readBody(req);
      try {
        const result = cancelEwayBill(body.ewbNo, body.cancelReason, body.cancelRemarks);
        return sendJson(res, 200, result);
      } catch (err) {
        return sendJson(res, 400, { success: false, error: err.message });
      }
    }

    if (pathname === "/api/ewaybill/list" && method === "GET") {
      return sendJson(res, 200, { success: true, count: listEwayBills().length, ewayBills: listEwayBills() });
    }

    // ---------------------------------------------------------
    // 2k. Capital Gains Set-off & Tax Loss Harvesting
    // ---------------------------------------------------------
    if (pathname === "/api/itr/set-off-losses" && method === "POST") {
      const body = await readBody(req);
      const result = computeCapitalLossSetOff(body);
      return sendJson(res, 200, result);
    }

    if (pathname === "/api/itr/tax-loss-harvesting" && method === "POST") {
      const body = await readBody(req);
      const result = scanTaxLossHarvesting(body.holdings || [], body.realizedGains);
      return sendJson(res, 200, result);
    }

    // ---------------------------------------------------------
    // 2l. Vendor Compliance & ITC at Risk Command Center
    // ---------------------------------------------------------
    if (pathname === "/api/vendor-risk/leaderboard" && method === "GET") {
      const leaderboard = getVendorRiskLeaderboard(DEMO_PURCHASES);
      return sendJson(res, 200, leaderboard);
    }

    if (pathname === "/api/vendor-risk/withholding-notice" && method === "POST") {
      const body = await readBody(req);
      const notice = generateWithholdingNotice(body);
      return sendJson(res, 200, notice);
    }

    // ---------------------------------------------------------
    // 2m. Multi-GSTIN Corporate Compliance Summary
    // ---------------------------------------------------------
    if (pathname === "/api/multi-gstin/summary" && method === "GET") {
      const pan = parsedUrl.searchParams.get("pan") || "AAACB1234F";
      try {
        const summary = getMultiGstinSummary(pan);
        return sendJson(res, 200, summary);
      } catch (err) {
        return sendJson(res, 400, { success: false, error: err.message });
      }
    }

    // ---------------------------------------------------------
    // 2n. GSTR-9 Annual Return Auto-Consolidation
    // ---------------------------------------------------------
    if (pathname === "/api/gstr9/consolidate" && method === "GET") {
      const gstin = parsedUrl.searchParams.get("gstin") || "32ABCDE1234F1Z5";
      const fy = parsedUrl.searchParams.get("fy") || "2025-26";
      try {
        const gstr9 = consolidateGstr9AnnualReturn(gstin, fy);
        return sendJson(res, 200, gstr9);
      } catch (err) {
        return sendJson(res, 400, { success: false, error: err.message });
      }
    }

    // ---------------------------------------------------------
    // MCA Corporate Registry Lookup (/api/mca/lookup)
    // ---------------------------------------------------------
    if (pathname === "/api/mca/lookup") {
      try {
        const cin = query.cin || (method === "POST" ? (await readBody(req)).cin : null);
        if (!cin) {
          return sendJson(res, 400, { success: false, error: "Query parameter 'cin' is required." });
        }
        return sendJson(res, 200, lookupMcaCompany(cin));
      } catch (err) {
        return sendJson(res, 200, { success: false, error: err.message || "Failed to process MCA CIN lookup" });
      }
    }

    // ---------------------------------------------------------
    // Compliance Health Score (/api/compliance/score)
    // ---------------------------------------------------------
    if (pathname === "/api/compliance/score") {
      const params = method === "POST" ? await readBody(req) : {};
      return sendJson(res, 200, calculateComplianceScore(params));
    }

    // ---------------------------------------------------------
    // Statutory Due-Date Deadlines (/api/compliance/due-dates)
    // ---------------------------------------------------------
    if (pathname === "/api/compliance/due-dates" && method === "GET") {
      return sendJson(res, 200, { success: true, dueDates: getStatutoryDueDates() });
    }

    // ---------------------------------------------------------
    // Multi-Channel Notification Simulator (/api/notifications/simulate)
    // ---------------------------------------------------------
    if (pathname === "/api/notifications/simulate" && method === "POST") {
      const body = await readBody(req);
      const payload = generateNotificationPayload(body);
      return sendJson(res, 200, { success: true, payload });
    }

    // ---------------------------------------------------------
    // Referral Growth Loop (/api/referral/stats & /api/referral/redeem)
    // ---------------------------------------------------------
    if (pathname === "/api/referral/stats" && method === "GET") {
      const gstin = query.gstin || "32ABCDE1234F1Z5";
      const businessName = query.businessName || "Malabar Spice Traders";
      return sendJson(res, 200, getOrCreateReferralCode(gstin, businessName));
    }

    if (pathname === "/api/referral/redeem" && method === "POST") {
      const body = await readBody(req);
      return sendJson(res, 200, redeemReferralCredit(body.code, Number(body.amount) || 0));
    }

    // ---------------------------------------------------------
    // Startup Express Onboarding (/api/startup-express/types & submit)
    // ---------------------------------------------------------
    if (pathname === "/api/startup-express/types" && method === "GET") {
      return sendJson(res, 200, { success: true, businessTypes: BUSINESS_TYPES });
    }

    if (pathname === "/api/startup-express/submit" && method === "POST") {
      const body = await readBody(req);
      return sendJson(res, 200, validateStartupApplication(body));
    }

    // ---------------------------------------------------------
    // GST Copilot Plain-English Pipeline (/api/copilot/pipeline & /api/copilot/ask)
    // ---------------------------------------------------------
    if (pathname === "/api/copilot/pipeline" && method === "GET") {
      const period = query.period || "102026";
      return sendJson(res, 200, { success: true, pipeline: getCopilotPipelineData(period) });
    }

    if (pathname === "/api/copilot/ask" && method === "POST") {
      const body = await readBody(req);
      return sendJson(res, 200, { success: true, result: answerCopilotQuestion(body.question) });
    }

    // ---------------------------------------------------------
    // 1-Click Nil GST Return Filing (/api/gst/nil-file)
    // ---------------------------------------------------------
    if (pathname === "/api/gst/nil-file" && method === "POST") {
      const body = await readBody(req);
      return sendJson(res, 200, fileNilGstReturn(body));
    }

    // ---------------------------------------------------------
    // AI Document Extraction Engine (/api/ai/extract-doc & sample-docs)
    // ---------------------------------------------------------
    if (pathname === "/api/ai/extract-doc" && method === "POST") {
      const body = await readBody(req);
      return sendJson(res, 200, extractDocumentData(body));
    }

    if (pathname === "/api/ai/sample-docs" && method === "GET") {
      return sendJson(res, 200, { success: true, samples: SAMPLE_DOCUMENTS });
    }

    // ---------------------------------------------------------
    // Statutory Cadence Sequence & Escalation Calculator
    // ---------------------------------------------------------
    if (pathname === "/api/compliance/cadence" && method === "GET") {
      const day = parseInt(query.day || "7", 10);
      return sendJson(res, 200, { success: true, schedule: getCadenceSchedule(day), statutoryMilestones: STATUTORY_SEQUENCE });
    }

    if (pathname === "/api/compliance/escalation") {
      const params = method === "POST" ? await readBody(req) : query;
      return sendJson(res, 200, calculateDelayEscalation({
        delayDays: params.delayDays || params.days,
        isNil: params.isNil === true || params.isNil === "true",
        netTaxLiability: params.netTaxLiability || params.tax
      }));
    }

    // ---------------------------------------------------------
    // Statutory Rules & CA Audit Engine Endpoints
    // ---------------------------------------------------------
    if (pathname === "/api/statutory/rules-config" && method === "GET") {
      return sendJson(res, 200, { success: true, config: STATUTORY_RULES });
    }

    if (pathname === "/api/statutory/rule88a-setoff" && method === "POST") {
      const body = await readBody(req);
      const liabilities = body.liabilities || { igst: 100000, cgst: 50000, sgst: 50000 };
      const itc = body.itc || { igst: 120000, cgst: 40000, sgst: 40000 };
      const setoff = computeRule88aSetoff(liabilities, itc, body.options);
      return sendJson(res, 200, { success: true, ...setoff });
    }

    if (pathname === "/api/statutory/rcm-process" && (method === "POST" || method === "GET")) {
      const body = method === "POST" ? await readBody(req) : {};
      const supplies = body.inwardSupplies || DEMO_PURCHASES;
      const result = aggregateRcmBatch(supplies);
      return sendJson(res, 200, { success: true, ...result, notifiedCategories: NOTIFIED_RCM_CATEGORIES });
    }

    if (pathname === "/api/statutory/180-day-tracker" && (method === "POST" || method === "GET")) {
      const body = method === "POST" ? await readBody(req) : {};
      const invoices = body.invoices || DEMO_PURCHASES;
      const asOfDate = body.asOfDate || query.asOfDate;
      const result = auditPurchaseRegister180Days(invoices, asOfDate);
      return sendJson(res, 200, { success: true, ...result });
    }

    if (pathname === "/api/statutory/gstr1-classify" && (method === "POST" || method === "GET")) {
      const body = method === "POST" ? await readBody(req) : {};
      const invoices = body.invoices || DEMO_SALES;
      const gstin = body.gstin || DEMO_BUSINESS.gstin;
      const result = classifySalesRegisterForGstr1(invoices, gstin);
      return sendJson(res, 200, { success: true, ...result });
    }

    if (pathname === "/api/statutory/lifecycle/validate-gstr1" && method === "POST") {
      const body = await readBody(req);
      const result = validateGstr1Prerequisites(body);
      return sendJson(res, 200, { success: true, ...result });
    }

    if (pathname === "/api/statutory/lifecycle/validate-gstr3b" && method === "POST") {
      const body = await readBody(req);
      const result = validateGstr3bPrerequisites(body);
      return sendJson(res, 200, { success: true, ...result });
    }

    if (pathname === "/api/statutory/lifecycle/simulate-filing" && method === "POST") {
      const body = await readBody(req);
      const result = simulateReturnFiling(body.returnType || "GSTR3B", body);
      return sendJson(res, 200, { success: true, ...result });
    }

    if (pathname === "/api/statutory/ledgers" && method === "GET") {
      const gstin = query.gstin || DEMO_BUSINESS.gstin;
      return sendJson(res, 200, {
        success: true,
        gstin,
        cashLedger: createEmptyCashLedger(gstin),
        creditLedger: createEmptyCreditLedger(gstin)
      });
    }

    if (pathname === "/api/statutory/pmt06/generate" && method === "POST") {
      const body = await readBody(req);
      const gstin = body.gstin || DEMO_BUSINESS.gstin;
      const amounts = body.amounts || { cgstTax: 1000, sgstTax: 1000 };
      const challan = generatePmt06Challan(gstin, amounts, body.mode || "NET_BANKING", true);
      return sendJson(res, 200, { success: true, challan });
    }

    if (pathname === "/api/statutory/pmt09/transfer" && method === "POST") {
      const body = await readBody(req);
      const ledger = body.cashLedger || createEmptyCashLedger(body.gstin);
      ledger.majorHeads.IGST.tax = 10000;
      ledger.majorHeads.IGST.total = 10000;
      const result = executePmt09Transfer(ledger, body.transferRequest || {
        fromMajor: "IGST",
        fromMinor: "tax",
        toMajor: "CGST",
        toMinor: "tax",
        amount: 2500
      });
      return sendJson(res, 200, { success: true, result });
    }

    // ---------------------------------------------------------
    // CA Multi-Client Practice Management Endpoints (Multi-Tenant & Isolated)
    // ---------------------------------------------------------
    if (pathname === "/api/practice/summary" && method === "GET") {
      const caId = query?.caId || "CA_SANJAY";
      return sendJson(res, 200, { success: true, ...getPracticeDashboardSummary(caId) });
    }

    if (pathname === "/api/practice/compliance-matrix" && method === "GET") {
      const caId = query?.caId || "CA_SANJAY";
      return sendJson(res, 200, { success: true, matrix: getPracticeComplianceMatrix(caId) });
    }

    if (pathname === "/api/practice/reminder" && method === "POST") {
      const body = await readBody(req);
      const caId = body.caId || "CA_SANJAY";
      const reminder = generateClientReminder(body.clientId || "CLI-001", caId);
      return sendJson(res, 200, { success: true, reminder });
    }

    if (pathname === "/api/practice/audit-logs" && method === "GET") {
      const caId = query?.caId || "CA_SANJAY";
      return sendJson(res, 200, { success: true, logs: getPracticeAuditLogs(caId) });
    }

    // ---------------------------------------------------------
    // 3. POST /api/validate (PAN / GSTIN / Row)
    // ---------------------------------------------------------
    if (pathname === "/api/validate" && method === "POST") {
      const body = await readBody(req);
      const { type, value, row, ownGstin } = body;

      if (type === "pan") {
        return sendJson(res, 200, validatePan(value));
      } else if (type === "gstin") {
        return sendJson(res, 200, validateGstin(value));
      } else if (type === "row" || row) {
        return sendJson(res, 200, validateInvoiceRow(row || body, ownGstin));
      } else {
        // Validate both if value provided
        const gstinRes = validateGstin(value);
        const panRes = validatePan(value);
        return sendJson(res, 200, { gstin: gstinRes, pan: panRes });
      }
    }

    // ---------------------------------------------------------
    // 3b. POST /api/pan-gstin/verify-2tier
    // ---------------------------------------------------------
    if (pathname === "/api/pan-gstin/verify-2tier" && method === "POST") {
      const body = await readBody(req);
      const result = await execute2TierVerification(body.pan, body.gstin);
      return sendJson(res, 200, result);
    }

    // ---------------------------------------------------------
    // 3c. GET & POST /api/gstin/lookup & /api/taxpayer/search
    // (Public GSTIN Search, Scraper & Taxpayer Verification)
    // ---------------------------------------------------------
    if ((pathname === "/api/gstin/lookup" || pathname === "/api/taxpayer/search") && (method === "GET" || method === "POST")) {
      const body = method === "POST" ? await readBody(req) : {};
      const gstinParam = (query.gstin || query.q || body.gstin || body.q || "").trim().toUpperCase();
      const panParam = (query.pan || body.pan || (gstinParam && gstinParam.length >= 12 ? gstinParam.slice(2, 12) : "")).trim().toUpperCase();

      if (!gstinParam && !panParam) {
        return sendJson(res, 400, {
          success: false,
          error: "Query parameter 'gstin' (15 digits) or 'pan' (10 digits) is required. Example: /api/gstin/lookup?gstin=27AAACA1234A1Z5"
        });
      }

      const targetGstin = gstinParam || `27${panParam}1Z5`;
      const [taxpayerRes, panRes, trackRes] = await Promise.all([
        executeGspApi(180, { gstin: targetGstin }),
        panParam ? executeGspApi(179, { gstin: targetGstin, pan: panParam }) : Promise.resolve({ branches: [] }),
        executeGspApi(182, { gstin: targetGstin })
      ]);

      return sendJson(res, 200, {
        success: true,
        query: gstinParam || panParam,
        gstin: targetGstin,
        pan: panParam,
        taxpayer: {
          legalName: taxpayerRes.legal_name || "Apex Retail Solutions Pvt Ltd",
          tradeName: taxpayerRes.trade_name || "Apex Retail",
          status: taxpayerRes.status || "Active",
          taxpayerType: taxpayerRes.taxpayer_type || "Regular",
          constitution: taxpayerRes.constitution || "Private Limited Company",
          dateOfRegistration: taxpayerRes.date_of_registration || "01/07/2017",
          stateCode: targetGstin.slice(0, 2),
          einvoiceStatus: taxpayerRes.einvoice_status || "Mandatory (Turnover > 5 Cr)",
          complianceRating: taxpayerRes.compliance_rating || "98.4%"
        },
        branches: panRes.branches || [],
        filingHistory: trackRes.filing_history || []
      });
    }

    // ---------------------------------------------------------
    // 4. POST /api/invoices/import
    // ---------------------------------------------------------
    if ((pathname === "/api/invoices/import" || pathname === "/api/import") && method === "POST") {
      const body = await readBody(req);
      const invoices = Array.isArray(body.invoices) ? body.invoices : (body.rawCsv ? parseCsvInvoices(body.rawCsv) : []);
      const ownGstin = body.ownGstin || DEMO_BUSINESS.gstin;

      const validRows = [];
      const errorRows = [];

      invoices.forEach((row, index) => {
        const valRes = validateInvoiceRow(row, ownGstin);
        if (valRes.valid) {
          validRows.push({ ...valRes.sanitized, rowNumber: index + 1, id: `inv-${Date.now()}-${index}` });
        } else {
          errorRows.push({
            rowNumber: index + 1,
            raw: row,
            errorReason: valRes.errors.join("; ")
          });
        }
      });

      const reportId = `err_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      if (errorRows.length > 0) {
        errorReportStore.set(reportId, {
          timestamp: new Date().toISOString(),
          errorRows,
          type: body.type || "sales"
        });
      }

      return sendJson(res, 200, {
        success: true,
        totalRows: invoices.length,
        validCount: validRows.length,
        errorCount: errorRows.length,
        validRows,
        errorRows,
        errorReportId: errorRows.length > 0 ? reportId : null,
        errorReportDownloadUrl: errorRows.length > 0 ? `/api/invoices/error-report?reportId=${reportId}&format=xlsx` : null
      });
    }

    // ---------------------------------------------------------
    // 5. GET/POST /api/invoices/error-report
    // ---------------------------------------------------------
    if (pathname === "/api/invoices/error-report") {
      const reportId = parsedUrl.searchParams.get("reportId");
      const format = (parsedUrl.searchParams.get("format") || "xlsx").toLowerCase();

      let errorRows = [];
      if (reportId && errorReportStore.has(reportId)) {
        errorRows = errorReportStore.get(reportId).errorRows;
      } else if (method === "POST") {
        const body = await readBody(req);
        errorRows = body.errorRows || [];
      }

      try {
        const exported = exportReport("error_report", format, { errorRows });
        res.writeHead(200, {
          "Content-Type": exported.contentType,
          "Content-Disposition": `attachment; filename="${exported.filename}"`,
          "X-Report-Filename": exported.filename,
          "X-Row-Count": exported.rowCount,
          "X-File-Size": exported.size
        });
        return res.end(exported.content);
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    }

    // ---------------------------------------------------------
    // 6. GET /api/returns/3b-summary (Deterministic rules calculation)
    // ---------------------------------------------------------
    if (pathname === "/api/returns/3b-summary" && method === "GET") {
      const summary = calculateGstSummary(DEMO_SALES, DEMO_PURCHASES, DEMO_EXCEPTIONS);
      return sendJson(res, 200, {
        success: true,
        period: "102026",
        periodLabel: "October 2026",
        business: DEMO_BUSINESS,
        ...summary,
        howCalculated: {
          step1_outputTax: `Gross Sales ₹${summary.taxableSales.toLocaleString("en-IN")} yielded total output tax of ₹${summary.outputTax.total.toLocaleString("en-IN")} (IGST ₹${summary.outputTax.igst.toLocaleString("en-IN")}, CGST ₹${summary.outputTax.cgst.toLocaleString("en-IN")}, SGST ₹${summary.outputTax.sgst.toLocaleString("en-IN")}).`,
          step2_itcEligibility: `Gross Purchase ITC ₹${summary.grossItc.toLocaleString("en-IN")} less ₹${summary.heldItc.toLocaleString("en-IN")} held exceptions equals net eligible credit of ₹${summary.eligibleItc.total.toLocaleString("en-IN")}.`,
          step3_setOff: `IGST credit is set off first against IGST output, remaining against CGST/SGST. CGST credit offsets CGST liability; SGST credit offsets SGST liability.`,
          step4_netPayable: `Net cash payable: Output Tax (₹${summary.outputTax.total.toLocaleString("en-IN")}) - Eligible ITC (₹${summary.eligibleItc.total.toLocaleString("en-IN")}) = ₹${summary.netPayable.total.toLocaleString("en-IN")}.`
        }
      });
    }

    // ---------------------------------------------------------
    // 7. POST /api/export/:report or /api/export/gst or /api/export/itr
    // ---------------------------------------------------------
    if (pathname.startsWith("/api/export") && (method === "POST" || method === "GET")) {
      const parts = pathname.split("/").filter(Boolean);
      let reportName = parts[2] || parsedUrl.searchParams.get("report") || "sales_register";
      const format = (parsedUrl.searchParams.get("format") || "xlsx").toLowerCase();
      const body = method === "POST" ? await readBody(req) : {};
      const assessmentYear = parsedUrl.searchParams.get("ay") || body.assessmentYear || "2025-26";

      const contextData = {
        salesInvoices: body.salesInvoices || DEMO_SALES,
        purchaseInvoices: body.purchaseInvoices || DEMO_PURCHASES,
        reconData: body.reconciliation || DEMO_RECONCILIATION,
        errorRows: body.errorRows || [],
        historyRecords: body.historyRecords || [],
        assessmentYear,
        taxCalc: body.taxCalculation || calculateGstSummary(
          body.salesInvoices || DEMO_SALES,
          body.purchaseInvoices || DEMO_PURCHASES,
          DEMO_EXCEPTIONS
        ),
        itrData: body.personalInfo ? body : (body.itrData || DEMO_ITR),
        gstin: body.gstin || DEMO_BUSINESS.gstin,
        period: body.filingPeriod || DEMO_BUSINESS.filingPeriod
      };

      try {
        const exported = exportReport(reportName, format, contextData);
        res.writeHead(200, {
          "Content-Type": exported.contentType,
          "Content-Disposition": `attachment; filename="${exported.filename}"`,
          "X-Report-Filename": exported.filename,
          "X-Row-Count": exported.rowCount,
          "X-File-Size": exported.size
        });
        return res.end(exported.content);
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    }

    // ---------------------------------------------------------
    // 8. GSP Adapters Layer API Endpoints
    // ---------------------------------------------------------
    if (pathname.startsWith("/api/gsp/")) {
      // 8a. Auth
      if (pathname === "/api/gsp/auth/otp" && method === "POST") {
        const body = await readBody(req);
        const result = await authAdapter.requestOtp(body.gstin || DEMO_BUSINESS.gstin, body.mobile);
        return sendJson(res, result.allowed === false ? 501 : 200, result);
      }
      if (pathname === "/api/gsp/auth/token" && method === "POST") {
        const body = await readBody(req);
        const result = await authAdapter.requestAuthToken(body.gstin || DEMO_BUSINESS.gstin, body.otp);
        return sendJson(res, result.allowed === false ? 501 : 200, result);
      }

      // 8b. GSTR-1
      if (pathname === "/api/gsp/gstr1/summary" && method === "GET") {
        const result = await gstr1Adapter.getSummary(DEMO_BUSINESS.gstin, parsedUrl.searchParams.get("period") || "102026");
        return sendJson(res, result.allowed === false ? 501 : 200, result);
      }
      if (pathname === "/api/gsp/gstr1/file" && method === "POST") {
        const body = await readBody(req);
        const result = await gstr1Adapter.fileGstr1(body.gstin || DEMO_BUSINESS.gstin, body.period || "102026", body.otp, body.consent);
        return sendJson(res, result.success ? 200 : 400, result);
      }

      // 8c. GSTR-2B
      if (pathname === "/api/gsp/gstr2b/details" && method === "GET") {
        const result = await gstr2bAdapter.getDetails(DEMO_BUSINESS.gstin, parsedUrl.searchParams.get("period") || "102026");
        return sendJson(res, result.allowed === false ? 501 : 200, result);
      }

      // 8d. GSTR-3B
      if (pathname === "/api/gsp/gstr3b/details" && method === "GET") {
        const result = await gstr3bAdapter.getDetails(DEMO_BUSINESS.gstin, parsedUrl.searchParams.get("period") || "102026");
        return sendJson(res, result.allowed === false ? 501 : 200, result);
      }
      if (pathname === "/api/gsp/gstr3b/offset" && method === "POST") {
        const body = await readBody(req);
        const result = await gstr3bAdapter.offsetLiability(body.gstin || DEMO_BUSINESS.gstin, body.period || "102026", body.offsetData);
        return sendJson(res, result.allowed === false ? 501 : 200, result);
      }
      if (pathname === "/api/gsp/gstr3b/file" && method === "POST") {
        const body = await readBody(req);
        const result = await gstr3bAdapter.fileGstr3b(body.gstin || DEMO_BUSINESS.gstin, body.period || "102026", body.otp, body.consent);
        return sendJson(res, result.success ? 200 : 400, result);
      }

      // 8e. IMS
      if (pathname === "/api/gsp/ims/invoices" && method === "GET") {
        const result = await imsAdapter.getInvoices(DEMO_BUSINESS.gstin, parsedUrl.searchParams.get("period") || "102026");
        // Status partial returns 501 Not available yet
        return sendJson(res, result.allowed === false ? 501 : 200, result);
      }
      if (pathname === "/api/gsp/ims/action" && method === "POST") {
        const body = await readBody(req);
        const result = await imsAdapter.saveAction(body.gstin || DEMO_BUSINESS.gstin, body.period || "102026", body.actions);
        return sendJson(res, result.allowed === false ? 501 : 200, result);
      }

      // 8f. 182 Statutory APIs Hub & Universal Dispatcher
      if (pathname === "/api/gsp/apis" && method === "GET") {
        return sendJson(res, 200, {
          total: 182,
          apis: getAllApis()
        });
      }
      if (pathname === "/api/gsp/invoke" && method === "POST") {
        const body = await readBody(req);
        const result = await executeGspApi(body.id, body.options || body);
        const statusCode = result.httpStatusCode || (result.status_cd === "0" && !result.isSuccess ? 400 : 200);
        return sendJson(res, statusCode, result);
      }
      if (pathname === "/api/gsp/health-check" && (method === "GET" || method === "POST")) {
        const body = method === "POST" ? await readBody(req) : {};
        const result = await runAllApisHealthCheck(body.gstin || DEMO_BUSINESS.gstin);
        return sendJson(res, 200, result);
      }
    }

    // ---------------------------------------------------------
    // 9. Static File Serving (from public/ or root)
    // ---------------------------------------------------------
    let relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");

    // Check multiple candidate locations across local Node and Vercel serverless bundles
    const candidatePaths = [
      path.join(__dirname, "public", relativePath),
      path.join(__dirname, relativePath),
      path.join(process.cwd(), "public", relativePath),
      path.join(process.cwd(), relativePath)
    ];

    let targetFile = null;
    for (const p of candidatePaths) {
      try {
        if (fs.existsSync(p) && fs.statSync(p).isFile()) {
          targetFile = p;
          break;
        }
      } catch {}
    }

    if (!targetFile) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not Found: " + relativePath);
      return;
    }

    try {
      const content = await fs.promises.readFile(targetFile);
      const ext = path.extname(targetFile).toLowerCase();
      const contentType = MIME_TYPES[ext] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": contentType });
      res.end(content);
      return;
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Server Error: " + err.message);
      return;
    }
  } catch (err) {
    console.error("[SimpleGST Request Handler Error]:", err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({
        error: "Internal Server Error",
        message: err.message
      }));
    }
  }
}

export function createServer() {
  return http.createServer(handleRequest);
}

function parseCsvInvoices(csvText) {
  const lines = csvText.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.replace(/^"|"$/g, "").trim());
  const invoices = [];

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(",").map(p => p.replace(/^"|"$/g, "").trim());
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = parts[idx];
    });
    invoices.push(obj);
  }
  return invoices;
}

function escapeXmlVal(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Start server if executed directly (and not in a serverless environment like Vercel)
const isVercelEnv = Boolean(process.env.VERCEL || process.env.NOW_REGION || process.env.AWS_LAMBDA_FUNCTION_NAME);
if (!isVercelEnv && process.argv[1] && process.argv[1].endsWith("server.js")) {
  const server = createServer();
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`[SimpleGST] Port ${PORT} is already in use.`);
      console.error(`[SimpleGST] Tip: You can set a different port, e.g.: $env:PORT=3001; npm start`);
      process.exit(1);
    } else {
      console.error(`[SimpleGST] Server error:`, err);
      process.exit(1);
    }
  });
  server.listen(PORT, () => {
    const gspMode = getGspMode();
    console.log(`[SimpleGST] Server active at http://localhost:${PORT}`);
    console.log(`• Mode:          ${gspMode.mode} (${gspMode.isLive ? "LIVE GSP SANDBOX" : "DEMO / MOCK"})`);
    console.log(`• Web App:       http://localhost:${PORT}/`);
    console.log(`• Exports API:   http://localhost:${PORT}/api/export/:report?format=(json|excel|csv)`);
    console.log(`• Import API:    http://localhost:${PORT}/api/invoices/import`);
  });
}

handleRequest.createServer = createServer;
handleRequest.handleRequest = handleRequest;

export default handleRequest;
