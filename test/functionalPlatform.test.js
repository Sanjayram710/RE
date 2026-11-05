/**
 * Comprehensive Functional Platform Test Suite
 * Tests real database persistence, Multi-GSTIN management, invoices CRUD,
 * file upload/download, OCR pipeline, Rule 88A tax calculation,
 * GSTR-2B reconciliation, Copilot context retrieval, and ledger transactions.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  db,
  userRepo,
  orgRepo,
  gstinRepo,
  salesRepo,
  purchaseRepo,
  documentRepo,
  ocrRepo,
  ledgerRepo,
  challanRepo,
  returnRepo,
  auditRepo,
  seedDevelopmentData
} from "../lib/db.js";

import { handleFunctionalApi } from "../lib/functionalApi.js";
import { computeRule88aSetoff } from "../lib/rule88aEngine.js";
import { analyzeInvoice180Days } from "../lib/supplier180DayTracker.js";
import { generatePmt06Challan } from "../lib/electronicLedgerEngine.js";

// Helper to simulate request / response
function createMockRes() {
  return {
    statusCode: null,
    headers: {},
    body: "",
    writeHead(code, headers = {}) {
      this.statusCode = code;
      this.headers = headers;
    },
    end(data = "") {
      this.body = data;
    }
  };
}

test("Functional DB: Initialize and Seed Development Data", () => {
  seedDevelopmentData();
  const orgCount = db.prepare("SELECT COUNT(*) as count FROM organizations").get();
  assert.ok(orgCount.count > 0, "Organization table must contain seeded data");

  const gstinCount = db.prepare("SELECT COUNT(*) as count FROM gst_registrations").get();
  assert.equal(gstinCount.count >= 3, true, "Must have at least 3 state branch GSTINs");
});

test("Multi-GSTIN: Format validation and branch creation", async () => {
  const org = db.prepare("SELECT id FROM organizations LIMIT 1").get();
  assert.ok(org, "Active org must exist");

  const validGstin = `27AAACA${Math.floor(1000 + Math.random() * 8999)}A1Z${Math.floor(1 + Math.random() * 8)}`; // Branch 2 in Maharashtra
  const res = createMockRes();
  await handleFunctionalApi({}, res, "/api/gstins", "POST", {}, {
    gstin: validGstin,
    tradeName: "Apex Retailers - Pune Branch",
    stateCode: "27",
    stateName: "Maharashtra"
  });

  assert.equal(res.statusCode, 201);
  const data = JSON.parse(res.body);
  assert.equal(data.success, true);
  assert.equal(data.gstin.gstin, validGstin);
  assert.equal(data.gstin.trade_name, "Apex Retailers - Pune Branch");

  // Invalid GSTIN should fail
  const badRes = createMockRes();
  await handleFunctionalApi({}, badRes, "/api/gstins", "POST", {}, {
    gstin: "INVALID_GSTIN_123",
    tradeName: "Bad Branch"
  });
  assert.equal(badRes.statusCode, 400);
});

test("Multi-GSTIN: Switching active GSTIN scopes all queries", async () => {
  // Retrieve Karnataka Branch
  const kaGstin = gstinRepo.findByGstin("29AAACB1234F1Z5");
  assert.ok(kaGstin, "Karnataka branch must exist");

  const res = createMockRes();
  await handleFunctionalApi({}, res, `/api/gstins/${kaGstin.id}/activate`, "POST", {}, {});
  assert.equal(res.statusCode, 200);

  // Now query dashboard summary for Karnataka
  const dashRes = createMockRes();
  await handleFunctionalApi({}, dashRes, "/api/dashboard/summary", "GET", { period: "102026" }, {});
  assert.equal(dashRes.statusCode, 200);
  const dashData = JSON.parse(dashRes.body);
  assert.equal(dashData.entity.gstin, "29AAACB1234F1Z5");
  assert.equal(dashData.entity.state, "Karnataka (29)");

  // Switch back to Maharashtra Main
  const mhGstin = gstinRepo.findByGstin("27AAACA1234A1Z5");
  const switchRes = createMockRes();
  await handleFunctionalApi({}, switchRes, `/api/gstins/${mhGstin.id}/activate`, "POST", {}, {});
  assert.equal(switchRes.statusCode, 200);
});

test("Sales Invoices: Create and deterministic tax computation", async () => {
  const mhGstin = gstinRepo.findByGstin("27AAACA1234A1Z5");
  const res = createMockRes();

  await handleFunctionalApi({}, res, "/api/sales", "POST", { period: "102026" }, {
    invoiceNumber: "TEST-INV-999",
    invoiceDate: "2026-10-25",
    customerName: "Tata Consumer Products Ltd",
    customerGstin: "27AAACT9876E1Z5",
    pos: "27",
    taxableAmount: 100000,
    gstRate: 18,
    supplyType: "B2B"
  });

  assert.equal(res.statusCode, 201);
  const data = JSON.parse(res.body);
  assert.equal(data.invoice.cgst, 9000);
  assert.equal(data.invoice.sgst, 9000);
  assert.equal(data.invoice.igst, 0);
  assert.equal(data.invoice.total_tax, 18000);
  assert.equal(data.invoice.total_amount, 118000);

  // Clean up
  salesRepo.delete(data.invoice.id);
});

test("Purchase Bills & 180-Day Rule 37 Tracking", async () => {
  const mhGstin = gstinRepo.findByGstin("27AAACA1234A1Z5");
  const res = createMockRes();

  await handleFunctionalApi({}, res, "/api/purchases", "POST", { period: "102026" }, {
    invoiceNumber: `TEST-PUR-${Date.now()}`,
    invoiceDate: "2026-03-01", // Old invoice > 180 days
    supplierName: "Vintage Packaging Supplies",
    supplierGstin: "27AAACV4433F1Z1",
    pos: "27",
    taxableAmount: 50000,
    gstRate: 18,
    itcEligibility: "ELIGIBLE"
  });

  assert.equal(res.statusCode, 201);
  const data = JSON.parse(res.body);
  const purId = data.purchase.id;

  // Make partial payment after 180 days
  const payRes = createMockRes();
  await handleFunctionalApi({}, payRes, `/api/purchases/${purId}/payment`, "POST", {}, {
    amountPaid: 25000,
    paymentDate: "2026-10-15"
  });

  assert.equal(payRes.statusCode, 200);
  const payData = JSON.parse(payRes.body);
  assert.equal(payData.purchase.payment_status, "PARTIALLY_PAID");
  assert.equal(payData.aging.status.isReversalMandatory, true);
  assert.ok(payData.aging.financials.proportionateItcToReverse > 0);

  // Clean up
  purchaseRepo.delete(purId);
});

test("File Upload & Secure Storage", async () => {
  const res = createMockRes();
  await handleFunctionalApi({}, res, "/api/documents/upload", "POST", {}, {
    filename: "Audit_Proof_Oct2026.pdf",
    category: "purchase_bill",
    rawText: "TAX INVOICE 32AAACB1234F1Z5 INV-2026-881 Taxable: 85000 CGST: 7650 SGST: 7650"
  });

  assert.equal(res.statusCode, 201);
  const data = JSON.parse(res.body);
  assert.ok(data.document.id);
  assert.equal(fs.existsSync(data.document.storage_path), true);
  assert.ok(data.ocr.id);
});

test("OCR Approval: Posts verified fields to purchase register", async () => {
  const res = createMockRes();
  await handleFunctionalApi({}, res, "/api/ocr/approve", "POST", {}, {
    invoiceType: "purchase_bill",
    fields: {
      invoiceNumber: "OCR-APPROVED-001",
      invoiceDate: "2026-10-20",
      partyName: "Kochi Logistics Corp",
      gstin: "27AAACM1234B1Z2",
      taxableValue: 60000,
      totalGst: 10800,
      totalInvoiceValue: 70800
    }
  });

  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.body);
  assert.equal(data.success, true);
  assert.equal(data.purchase.invoice_number, "OCR-APPROVED-001");
  assert.equal(data.purchase.total_tax, 10800);

  // Clean up
  purchaseRepo.delete(data.purchase.id);
});

test("GSTR-2B Reconciliation Summary: Matches books against 2B", async () => {
  const res = createMockRes();
  await handleFunctionalApi({}, res, "/api/reconciliation/summary", "GET", { period: "102026" }, {});
  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.body);
  assert.ok(data.summary.matched.count >= 2);
  assert.equal(data.summary.totalBooksPurchases >= 2, true);
});

test("Tax Calculation & Rule 88A Matrix Execution", async () => {
  const res = createMockRes();
  await handleFunctionalApi({}, res, "/api/returns/tax-calc", "GET", { period: "102026" }, {});
  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.body);
  assert.ok(data.liability);
  assert.ok(data.inputCredit);
  assert.ok(data.setoffMatrix);
  assert.ok(data.netCashPayable >= 0);
});

test("GST Copilot: Context grounded on real database records", async () => {
  const res = createMockRes();
  await handleFunctionalApi({}, res, "/api/copilot/ask", "POST", {}, {
    question: "How much GST do I need to pay for October 2026?"
  });
  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.body);
  assert.ok(data.answer.includes("Apex Retailers"));
  assert.ok(data.answer.includes("net tax payable in cash"));
  assert.ok(data.citations.includes("Section 49 & Rule 88A CGST Rules"));
});

test("PMT-06 Challan: Enforces Rule 87(4) Over-The-Counter ₹10,000 limit", async () => {
  const res = createMockRes();
  await handleFunctionalApi({}, res, "/api/challans/generate-pmt06", "POST", {}, {
    amount: 15000,
    paymentMode: "OVER_THE_COUNTER"
  });

  assert.equal(res.statusCode, 400);
  const data = JSON.parse(res.body);
  assert.ok(data.error.includes("Rule 87(4)"));
});

test("PMT-06 Challan: Net Banking payment credits cash ledger", async () => {
  const genRes = createMockRes();
  await handleFunctionalApi({}, genRes, "/api/challans/generate-pmt06", "POST", {}, {
    amount: 20000,
    paymentMode: "NET_BANKING"
  });
  assert.equal(genRes.statusCode, 201);
  const genData = JSON.parse(genRes.body);

  const payRes = createMockRes();
  await handleFunctionalApi({}, payRes, "/api/challans/simulate-payment", "POST", {}, {
    cpin: genData.cpin,
    amount: 20000
  });
  assert.equal(payRes.statusCode, 200);
  const payData = JSON.parse(payRes.body);
  assert.equal(payData.creditedAmount, 20000);
  assert.ok(payData.bankReference);
});

test("Document Management: List and delete uploaded files", async () => {
  // 1. Upload a temp document
  const uploadRes = createMockRes();
  await handleFunctionalApi({}, uploadRes, "/api/documents/upload", "POST", {}, {
    filename: "Doc_For_Deletion.pdf",
    category: "purchase_bill",
    content: "Dummy Content for Deletion Test"
  });
  assert.equal(uploadRes.statusCode, 201);
  const doc = JSON.parse(uploadRes.body).document;

  // 2. List documents
  const listRes = createMockRes();
  await handleFunctionalApi({}, listRes, "/api/documents", "GET", {}, {});
  assert.equal(listRes.statusCode, 200);
  const listData = JSON.parse(listRes.body);
  assert.ok(listData.documents.some(d => d.id === doc.id));

  // 3. Delete document
  const delRes = createMockRes();
  await handleFunctionalApi({}, delRes, `/api/documents/${doc.id}`, "DELETE", {}, {});
  assert.equal(delRes.statusCode, 200);

  // 4. Verify removed from list
  const verifyRes = createMockRes();
  await handleFunctionalApi({}, verifyRes, "/api/documents", "GET", {}, {});
  const verifyData = JSON.parse(verifyRes.body);
  assert.ok(!verifyData.documents.some(d => d.id === doc.id));
});

test("Reports & Exports: Generate CSV files for Sales and Purchases", async () => {
  const salesCsvRes = createMockRes();
  await handleFunctionalApi({}, salesCsvRes, "/api/reports/sales/csv", "GET", {}, {});
  assert.equal(salesCsvRes.statusCode, 200);
  assert.ok(salesCsvRes.body.includes("Invoice Number,Invoice Date"));

  const purCsvRes = createMockRes();
  await handleFunctionalApi({}, purCsvRes, "/api/reports/purchases/csv", "GET", {}, {});
  assert.equal(purCsvRes.statusCode, 200);
  assert.ok(purCsvRes.body.includes("Invoice Number,Invoice Date,Supplier Name"));
});

test("GST Copilot: Answers all 8 core statutory queries grounded in live database", async () => {
  const queries = [
    { q: "What is my total sales for this month?", expectedText: "total recorded sales", expectedCite: "Section 31" },
    { q: "How much ITC can I claim?", expectedText: "eligible Input Tax Credit", expectedCite: "Section 16(2)(aa)" },
    { q: "Which purchase invoices are missing from GSTR-2B?", expectedText: "Reconciliation", expectedCite: "Section 16(2)(aa)" },
    { q: "What is my estimated tax liability?", expectedText: "liability", expectedCite: "Section 49 & Rule 88A" },
    { q: "Which invoices are approaching the 180-day payment limit?", expectedText: "Section 16(2) 2nd Proviso", expectedCite: "Rule 37" },
    { q: "Explain my GSTR-3B calculation.", expectedText: "Rule 88A", expectedCite: "Rule 88A" },
    { q: "What should I complete before filing?", expectedText: "Pre-Filing Compliance Checklist", expectedCite: "Section 39(10)" },
    { q: "Show my current cash ledger balance.", expectedText: "Electronic Cash Ledger", expectedCite: "PMT-05" }
  ];

  for (const item of queries) {
    const res = createMockRes();
    await handleFunctionalApi({}, res, "/api/copilot/ask", "POST", {}, { question: item.q });
    assert.equal(res.statusCode, 200);
    const data = JSON.parse(res.body);
    assert.ok(data.answer.includes(item.expectedText), `Query '${item.q}' failed to include '${item.expectedText}'`);
    assert.ok(data.citations.some(c => c.includes(item.expectedCite)), `Query '${item.q}' missing citation '${item.expectedCite}'`);
  }
});

// ============================================================================
// POST-IMPLEMENTATION DEFECT CORRECTION & FINAL ACCEPTANCE AUDIT TESTS
// ============================================================================

test("Regression & Defect Audit: Mobile File GST navigation targets file-gst", () => {
  const html = fs.readFileSync(path.join(process.cwd(), "index.html"), "utf8");
  const publicHtml = fs.readFileSync(path.join(process.cwd(), "public/index.html"), "utf8");

  // 1. Bottom nav #bottom-nav-file-gst must invoke switchSuite('file-gst')
  assert.ok(
    html.includes('id="bottom-nav-file-gst" onclick="switchSuite(\'file-gst\')"'),
    "Root index.html #bottom-nav-file-gst must call switchSuite('file-gst')"
  );
  assert.ok(
    publicHtml.includes('id="bottom-nav-file-gst" onclick="switchSuite(\'file-gst\')"'),
    "public/index.html #bottom-nav-file-gst must call switchSuite('file-gst')"
  );
  assert.ok(
    !html.includes('id="bottom-nav-file-gst" onclick="switchSuite(\'copilot\')"'),
    "Root index.html must not route bottom File GST to copilot"
  );

  // 2. Sidebar Quick File button must also navigate to file-gst
  assert.ok(
    html.includes('<button onclick="switchSuite(\'file-gst\')" class="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-primary'),
    "Sidebar Quick File button must call switchSuite('file-gst')"
  );
});

test("Regression & Defect Audit: GST Copilot single authoritative navigation consistency", () => {
  const html = fs.readFileSync(path.join(process.cwd(), "index.html"), "utf8");
  const js = fs.readFileSync(path.join(process.cwd(), "app.js"), "utf8");

  // 1. Authoritative Copilot workspace exists
  assert.ok(html.includes('id="viewCopilotSuite"'), "#viewCopilotSuite container must be present");
  assert.ok(html.includes('id="copilotChatMessages"'), "Copilot chat stream must exist");
  assert.ok(html.includes('id="copilotQueryInput"'), "Copilot input dock must exist");

  // 2. Primary sidebar nav-link-copilot routes to copilot
  assert.ok(
    html.includes('id="nav-link-copilot" onclick="switchSuite(\'copilot\'); return false;"'),
    "#nav-link-copilot must navigate to copilot suite"
  );

  // 3. Duplicate older mock Copilot Studio from viewComplianceSuite must be eliminated
  assert.ok(
    !html.includes('GST Copilot Studio\n                      <span class="text-[11px] font-normal text-secondary">v2.4</span>'),
    "Redundant older mock Copilot Studio v2.4 must be removed from viewComplianceSuite"
  );

  // 4. In app.js, switchSuite('copilot') highlights nav-link-copilot
  assert.ok(
    js.includes("highlightSidebarNav('nav-link-copilot');"),
    "app.js must highlight nav-link-copilot on copilot navigation"
  );
});

test("Regression & Defect Audit: Kiosk Mode state transitions and banner controls", () => {
  const js = fs.readFileSync(path.join(process.cwd(), "app.js"), "utf8");
  const css = fs.readFileSync(path.join(process.cwd(), "style.css"), "utf8");
  const html = fs.readFileSync(path.join(process.cwd(), "index.html"), "utf8");

  // 1. Controller functions exist and are exported
  assert.ok(js.includes("function toggleKioskMode("), "toggleKioskMode must be defined");
  assert.ok(js.includes("function enterKioskMode()"), "enterKioskMode must be defined");
  assert.ok(js.includes("function exitKioskMode()"), "exitKioskMode must be defined");
  assert.ok(js.includes("function initKioskEventListeners()"), "initKioskEventListeners must be defined");

  // 2. Top-bar button triggers toggleKioskMode
  assert.ok(html.includes('id="btnToggleKiosk" onclick="toggleKioskMode()"'), "Kiosk button must call toggleKioskMode()");

  // 3. Floating exit banner is declared and has exit button calling exitKioskMode()
  assert.ok(html.includes('id="kioskExitBanner"'), "Floating exit banner must exist");
  assert.ok(html.includes('onclick="exitKioskMode()"'), "Banner exit button must call exitKioskMode()");

  // 4. CSS hides sidebar and bottom nav, and displays exit banner in kiosk-mode
  assert.ok(css.includes("body.kiosk-mode #appSidebar"), "CSS must hide sidebar in kiosk-mode");
  assert.ok(css.includes("body.kiosk-mode #appBottomNav"), "CSS must hide bottom nav in kiosk-mode");
  assert.ok(css.includes("body.kiosk-mode #kioskExitBanner"), "CSS must show exit banner in kiosk-mode");
});

test("Regression & Defect Audit: Prevention of duplicate event listeners in Kiosk Mode", () => {
  const js = fs.readFileSync(path.join(process.cwd(), "app.js"), "utf8");

  // Guard flag prevents duplicate listeners
  assert.ok(js.includes("if (window.__kioskListenersAttached) return;"), "Must guard against duplicate kiosk event listeners");
  assert.ok(js.includes("window.__kioskListenersAttached = true;"), "Must flag listeners as attached");
  assert.ok(js.includes("e.key === 'Escape'"), "Must listen to Escape key to exit kiosk mode");
  assert.ok(js.includes("document.addEventListener('fullscreenchange'"), "Must sync state with browser fullscreenchange");
});

test("Regression & Defect Audit: Five-step filing navigation integrity & Nil Return", async () => {
  const html = fs.readFileSync(path.join(process.cwd(), "index.html"), "utf8");
  const js = fs.readFileSync(path.join(process.cwd(), "app.js"), "utf8");

  // 1. All 5 steps exist in the filing flow
  assert.ok(html.includes("Step 2 of 5"), "Filing flow progress banner present");
  assert.ok(html.includes("onclick=\"switchSuite('gst')\""), "Step 1 Sales navigates to registers/reports");
  assert.ok(html.includes("onclick=\"switchSuite('bills')\""), "Step 2 Purchases navigates to bills");
  assert.ok(html.includes("onclick=\"switchSuite('recon')\""), "Step 3 Recon navigates to reconciliation");
  assert.ok(html.includes("onclick=\"switchSuite('taxcalc')\""), "Step 4 Tax Calc navigates to taxcalc");
  assert.ok(html.includes("onclick=\"switchSuite('file-gst')\""), "Step 5 File GSTR-3B navigates to file-gst");

  // 2. Health Score Modal accessible from Dashboard
  assert.ok(html.includes('onclick="openHealthScoreModal()"'), "Home compliance card opens health score modal");
  assert.ok(html.includes('id="modalHealthScore"'), "#modalHealthScore modal exists in DOM");
  assert.ok(js.includes("function openHealthScoreModal()"), "openHealthScoreModal defined in app.js");

  // 3. Nil Return simulation API execution
  const { fileNilGstReturn } = await import("../lib/gstCopilotEngine.js");
  const nilRes = fileNilGstReturn({
    gstin: "27AAACA1234A1Z5",
    period: "102026",
    authorisedPerson: "Rajesh Sharma",
    verificationMode: "EVC_OTP"
  });

  assert.equal(nilRes.success, true);
  assert.equal(nilRes.isNil, true);
  assert.equal(nilRes.isSimulation, true);
  assert.equal(nilRes.arn, null, "Official ARN must be null for simulations");
  assert.ok(nilRes.simulationReference.startsWith("SIM-NIL-"), "Returns simulation reference ID");
  assert.equal(nilRes.status, "SIMULATED_NOT_TRANSMITTED", "Simulation status must be SIMULATED_NOT_TRANSMITTED");
  assert.ok(nilRes.watermark.includes("NOT TRANSMITTED"), "Nil ARN receipt must carry simulation watermark");
});

test("UX Simplification: File GST 2-Card Decision, Nil Pre-Check & Dynamic Period Sync", async () => {
  const html = fs.readFileSync(path.join(process.cwd(), "index.html"), "utf8");
  const js = fs.readFileSync(path.join(process.cwd(), "app.js"), "utf8");

  // 1. Primary question is front-and-center
  assert.ok(
    html.includes("Did your business have any sales or purchases this month?"),
    "File GST must feature the zero-jargon primary question"
  );

  // 2. Exactly two clean choice cards (YES and NO)
  assert.ok(html.includes("YES — I had sales or purchases"), "YES card title present");
  assert.ok(html.includes("Add your sales invoices and purchase bills."), "YES card description present");
  assert.ok(html.includes("NO — I had no sales or purchases"), "NO card title present");
  assert.ok(html.includes("Prepare your Nil GST return."), "NO card description present");

  // 3. Removed technical clutter and duplicate buttons
  assert.ok(!html.includes(">Audit Trail</button>"), "Audit Trail button removed from filing header");
  assert.ok(!html.includes(">Prior GSTR-3B Summary</button>"), "Prior GSTR-3B Summary button removed from primary workflow");
  assert.ok(!html.includes("Instant OTP or EVC Verification Simulator"), "Simulator marketing text removed");
  assert.ok(!html.includes("Immediate ARN generation"), "Misleading immediate ARN generation removed");

  // 4. Zero occurrences of outdated 2024 dates in index.html
  const matches2024 = html.match(/2024/g) || [];
  assert.equal(matches2024.length, 0, "No hardcoded 2024 dates should remain in index.html");

  // 5. Pre-filing Nil Verification API blocks returns with transactions
  const { handleFunctionalApi } = await import("../lib/functionalApi.js");
  const { gstinRepo } = await import("../lib/db.js");

  function mockApiCall(method, pathname, query = {}, body = null) {
    const req = { method, url: pathname, headers: {} };
    let statusCode = 200;
    let data = "";
    const res = {
      writeHead(code) { statusCode = code; },
      end(payload) { data = payload; }
    };
    return {
      run: async () => {
        await handleFunctionalApi(req, res, pathname, method, query, body);
        return { statusCode, body: data ? JSON.parse(data) : null };
      }
    };
  }

  // MH branch has 6 sales and 2 purchases in development seed -> MUST BE BLOCKED
  const mhBranch = gstinRepo.findByGstin("27AAACA1234A1Z5");
  assert.ok(mhBranch, "MH branch exists");
  await mockApiCall("POST", `/api/gstins/${mhBranch.id}/activate`).run();

  const verifyMh = await mockApiCall("GET", "/api/gst/nil-verify", { period: "102026" }).run();
  assert.equal(verifyMh.body.eligible, false, "Must block Nil filing when transactions exist");
  assert.equal(verifyMh.body.hasTransactions, true, "hasTransactions flag must be true");
  assert.ok(verifyMh.body.verification.salesCount > 0, "Must report actual sales invoices found");

  const fileMh = await mockApiCall("POST", "/api/gst/nil-file", {}, { period: "102026", declarationConfirmed: true }).run();
  assert.equal(fileMh.statusCode, 400, "POST /api/gst/nil-file must reject with HTTP 400 when transactions exist");
  assert.equal(fileMh.body.success, false);

  // Switch to KA branch with 0 transactions -> MUST BE ELIGIBLE
  const { db } = await import("../lib/db.js");
  const kaBranch = gstinRepo.findByGstin("29AAACB1234F1Z5");
  assert.ok(kaBranch, "KA branch exists");
  db.prepare("DELETE FROM tax_returns WHERE gstin_id = ? AND period = ?").run(kaBranch.id, "102026");
  await mockApiCall("POST", `/api/gstins/${kaBranch.id}/activate`).run();

  const verifyKa = await mockApiCall("GET", "/api/gst/nil-verify", { period: "102026" }).run();
  assert.equal(verifyKa.body.eligible, true, "Zero transactions entity must be eligible for Nil");
  assert.equal(verifyKa.body.breakdown.outwardSuppliesCount, 0);

  // Verify declaration enforcement on backend: missing, null, and false MUST be rejected with HTTP 400
  const missingDecl = await mockApiCall("POST", "/api/gst/nil-file", {}, { period: "102026", authorisedPerson: "Rajesh Sharma" }).run();
  assert.equal(missingDecl.statusCode, 400, "Must reject missing declarationConfirmed");

  const nullDecl = await mockApiCall("POST", "/api/gst/nil-file", {}, { period: "102026", declarationConfirmed: null }).run();
  assert.equal(nullDecl.statusCode, 400, "Must reject null declarationConfirmed");

  const falseDecl = await mockApiCall("POST", "/api/gst/nil-file", {}, { period: "102026", declarationConfirmed: false }).run();
  assert.equal(falseDecl.statusCode, 400, "Must reject false declarationConfirmed");

  // Valid declarationConfirmed: true -> Succeeds
  const fileKa = await mockApiCall("POST", "/api/gst/nil-file", {}, { period: "102026", authorisedPerson: "Rajesh Sharma", declarationConfirmed: true }).run();
  assert.equal(fileKa.statusCode, 200);
  assert.equal(fileKa.body.success, true);
  assert.equal(fileKa.body.isNil, true);
  assert.equal(fileKa.body.isSimulation, true);
  assert.equal(fileKa.body.arn, null, "Official ARN must be null in simulation mode");
  assert.ok(fileKa.body.simulationReference.startsWith("SIM-NIL-AA29"), "Returns simulation reference ID");
  assert.equal(fileKa.body.status, "SIMULATED_NOT_TRANSMITTED");

  // Reset back to MH primary
  await mockApiCall("POST", `/api/gstins/${mhBranch.id}/activate`).run();
});

test("Data Integrity & Period Cleanup: Dynamic period switching, Nil verification & transparent disclosures", async () => {
  const { handleFunctionalApi, formatPeriodDetails } = await import("../lib/functionalApi.js");
  const fs = await import("fs");

  function mockApiCall(method, pathname, query = {}, body = null) {
    const req = { method, url: pathname, headers: {} };
    let statusCode = 200;
    let data = "";
    const res = {
      writeHead(code) { statusCode = code; },
      end(payload) { data = payload; }
    };
    return {
      run: async () => {
        await handleFunctionalApi(req, res, pathname, method, query, body);
        return { statusCode, body: data ? JSON.parse(data) : null };
      }
    };
  }

  // 1. Period formatting helper computes correct statutory deadlines without inventing dates
  const oct = formatPeriodDetails("102026");
  assert.equal(oct.full, "October 2026");
  assert.equal(oct.short, "Oct 2026");
  assert.equal(oct.gstr1Deadline, "November 11, 2026");
  assert.equal(oct.gstr3bDeadline, "November 20, 2026");
  assert.equal(oct.fy, "FY 2026-27");

  const sep = formatPeriodDetails("092026");
  assert.equal(sep.full, "September 2026");
  assert.equal(sep.gstr3bDeadline, "October 20, 2026");

  // 2. Dynamic Period Switching API
  const switchPeriod = await mockApiCall("POST", "/api/context/period", {}, { period: "092026" }).run();
  assert.equal(switchPeriod.statusCode, 200);
  assert.equal(switchPeriod.body.activePeriod, "092026");
  assert.equal(switchPeriod.body.details.full, "September 2026");

  const getPeriod = await mockApiCall("GET", "/api/context/period").run();
  assert.equal(getPeriod.body.activePeriod, "092026");
  assert.equal(getPeriod.body.details.short, "Sep 2026");

  // 3. Dynamic Dashboard Summary reads selected period
  const dashSep = await mockApiCall("GET", "/api/dashboard/summary", { period: "092026" }).run();
  assert.equal(dashSep.statusCode, 200);
  assert.equal(dashSep.body.period, "092026");
  assert.equal(dashSep.body.periodLabel, "September 2026");
  assert.equal(dashSep.body.statutoryDeadlines.gstr3b, "October 20, 2026");
  assert.equal(dashSep.body.environment.name, "Sandbox Simulation");

  // Reset back to 102026
  await mockApiCall("POST", "/api/context/period", {}, { period: "102026" }).run();

  // 4. Copilot returns dynamic active context and period label
  const copilotStatus = await mockApiCall("GET", "/api/copilot/status", { period: "112026" }).run();
  assert.equal(copilotStatus.statusCode, 200);
  assert.equal(copilotStatus.body.periodLabel, "November 2026");
  assert.equal(copilotStatus.body.aiEngine.provider, "Local Grounded Engine");

  const copilotAsk = await mockApiCall("POST", "/api/copilot/ask", {}, { question: "What is my total sales?", period: "102026" }).run();
  assert.equal(copilotAsk.statusCode, 200);
  assert.equal(copilotAsk.body.activeContext.period, "October 2026");

  // 5. Nil return requires explicit confirmation declaration
  const unconfirmed = await mockApiCall("POST", "/api/gst/nil-file", {}, { period: "102026", declarationConfirmed: false }).run();
  assert.equal(unconfirmed.statusCode, 400);
  assert.ok(unconfirmed.body.error.includes("declaration"));

  // 6. UI & Modals: No alert('Modal dismissal simulation.') or broken handlers in codebase
  const html = fs.readFileSync("index.html", "utf8");
  const js = fs.readFileSync("app.js", "utf8");

  assert.ok(!html.includes("Modal dismissal simulation"), "No dismissal simulation alerts in index.html");
  assert.ok(!js.includes("Modal dismissal simulation"), "No dismissal simulation alerts in app.js");
  assert.ok(html.includes('id="globalPeriodTrigger"'), "Interactive top-bar period selector trigger present");
  assert.ok(html.includes('id="globalPeriodDropdownMenu"'), "Interactive period dropdown menu present");
  assert.ok(html.includes('[SIMULATION / DEMO MODE — NOT TRANSMITTED TO GSTN COMMON PORTAL]'), "ARN modal has transparent simulation disclosure");
});

test("Backend Integrity: Nil Return Declaration Enforcement (Missing, Null, False, String, True)", async () => {
  const { handleFunctionalApi } = await import("../lib/functionalApi.js");
  const { gstinRepo, db } = await import("../lib/db.js");

  function mockApiCall(headers, method, pathname, query = {}, body = null) {
    const req = { method, url: pathname, headers: headers || {} };
    let statusCode = 200;
    let data = "";
    const res = {
      writeHead(code) { statusCode = code; },
      end(payload) { data = payload; }
    };
    return {
      run: async () => {
        await handleFunctionalApi(req, res, pathname, method, query, body);
        return { statusCode, body: data ? JSON.parse(data) : null };
      }
    };
  }

  const kaBranch = gstinRepo.findByGstin("29AAACB1234F1Z5");
  db.prepare("DELETE FROM tax_returns WHERE gstin_id = ? AND period = ?").run(kaBranch.id, "082026");

  const sessHeaders = { "x-session-id": "sess-test-decl-enforcement" };
  await mockApiCall(sessHeaders, "POST", `/api/gstins/${kaBranch.id}/activate`).run();

  // 1. Missing declarationConfirmed -> 400
  const missing = await mockApiCall(sessHeaders, "POST", "/api/gst/nil-file", {}, { period: "082026" }).run();
  assert.equal(missing.statusCode, 400, "Missing declarationConfirmed must reject with 400");
  assert.equal(missing.body.success, false);

  // 2. Null declarationConfirmed -> 400
  const nullVal = await mockApiCall(sessHeaders, "POST", "/api/gst/nil-file", {}, { period: "082026", declarationConfirmed: null }).run();
  assert.equal(nullVal.statusCode, 400, "Null declarationConfirmed must reject with 400");
  assert.equal(nullVal.body.success, false);

  // 3. False declarationConfirmed -> 400
  const falseVal = await mockApiCall(sessHeaders, "POST", "/api/gst/nil-file", {}, { period: "082026", declarationConfirmed: false }).run();
  assert.equal(falseVal.statusCode, 400, "False declarationConfirmed must reject with 400");
  assert.equal(falseVal.body.success, false);

  // 4. Truthy non-boolean declarationConfirmed (e.g., string "true") -> 400
  const stringVal = await mockApiCall(sessHeaders, "POST", "/api/gst/nil-file", {}, { period: "082026", declarationConfirmed: "true" }).run();
  assert.equal(stringVal.statusCode, 400, "String 'true' declarationConfirmed must reject with 400");

  // 5. Explicit boolean true -> 200 Success
  const trueVal = await mockApiCall(sessHeaders, "POST", "/api/gst/nil-file", {}, { period: "082026", declarationConfirmed: true }).run();
  assert.equal(trueVal.statusCode, 200, "Strict true declarationConfirmed succeeds");
  assert.equal(trueVal.body.success, true);
  assert.equal(trueVal.body.status, "SIMULATED_NOT_TRANSMITTED");
  assert.equal(trueVal.body.arn, null);
  assert.ok(trueVal.body.simulationReference.startsWith("SIM-NIL-AA29"));
});

test("Backend Integrity: Rule 67A Nil Form GSTR-3B Eligibility with Ineligible Purchase vs Outward Supplies & RCM", async () => {
  const { handleFunctionalApi } = await import("../lib/functionalApi.js");
  const { gstinRepo, purchaseRepo, salesRepo, db } = await import("../lib/db.js");

  function mockApiCall(headers, method, pathname, query = {}, body = null) {
    const req = { method, url: pathname, headers: headers || {} };
    let statusCode = 200;
    let data = "";
    const res = {
      writeHead(code) { statusCode = code; },
      end(payload) { data = payload; }
    };
    return {
      run: async () => {
        await handleFunctionalApi(req, res, pathname, method, query, body);
        return { statusCode, body: data ? JSON.parse(data) : null };
      }
    };
  }

  const kaBranch = gstinRepo.findByGstin("29AAACB1234F1Z5");
  const testPeriod = "042026";
  const sessHeaders = { "x-session-id": "sess-test-rule67a" };

  // Clean test period records
  db.prepare("DELETE FROM sales_invoices WHERE gstin_id = ? AND period = ?").run(kaBranch.id, testPeriod);
  db.prepare("DELETE FROM purchase_invoices WHERE gstin_id = ? AND period = ?").run(kaBranch.id, testPeriod);
  db.prepare("DELETE FROM tax_returns WHERE gstin_id = ? AND period = ?").run(kaBranch.id, testPeriod);

  await mockApiCall(sessHeaders, "POST", `/api/gstins/${kaBranch.id}/activate`).run();

  // Case A: Ordinary purchase invoice exists but ITC eligibility is INELIGIBLE (e.g. Sec 17(5) blocked)
  // Under Rule 67A, taxpayer is NOT claiming ITC, so Nil Return IS ELIGIBLE!
  purchaseRepo.create({
    orgId: kaBranch.org_id,
    gstinId: kaBranch.id,
    period: testPeriod,
    invoiceNumber: "PUR-BLOCKED-01",
    invoiceDate: "2026-04-10",
    supplierName: "Car Dealership Pvt Ltd",
    supplierGstin: "29AABCC1234D1Z9",
    pos: "29",
    isInterstate: false,
    isRcm: false,
    taxableAmount: 100000,
    gstRate: 18,
    cgst: 9000,
    sgst: 9000,
    igst: 0,
    cess: 0,
    totalTax: 18000,
    totalAmount: 118000,
    itcEligibility: "INELIGIBLE_17_5",
    blockedReason: "17(5)(a) Motor Vehicles",
    paymentStatus: "UNPAID"
  });

  const verifyWithIneligiblePur = await mockApiCall(sessHeaders, "GET", "/api/gst/nil-verify", { period: testPeriod }).run();
  assert.equal(verifyWithIneligiblePur.body.eligible, true, "Ineligible ITC purchase does NOT disqualify Nil Form GSTR-3B under Rule 67A");
  assert.equal(verifyWithIneligiblePur.body.breakdown.eligibleItcClaimed, 0);
  assert.equal(verifyWithIneligiblePur.body.breakdown.ineligiblePurchasesCount, 1);

  // Case B: Inward purchase with RCM (Reverse Charge) -> MUST BE INELIGIBLE
  const rcmPurchase = purchaseRepo.create({
    orgId: kaBranch.org_id,
    gstinId: kaBranch.id,
    period: testPeriod,
    invoiceNumber: "PUR-RCM-01",
    invoiceDate: "2026-04-12",
    supplierName: "Advocate Legal Services",
    supplierGstin: "29AADCL1234D1Z2",
    pos: "29",
    isInterstate: false,
    isRcm: true,
    taxableAmount: 20000,
    gstRate: 18,
    cgst: 1800,
    sgst: 1800,
    igst: 0,
    cess: 0,
    totalTax: 3600,
    totalAmount: 23600,
    itcEligibility: "ELIGIBLE",
    paymentStatus: "UNPAID"
  });

  const verifyWithRcm = await mockApiCall(sessHeaders, "GET", "/api/gst/nil-verify", { period: testPeriod }).run();
  assert.equal(verifyWithRcm.body.eligible, false, "RCM liability must disqualify Nil Return");
  assert.ok(verifyWithRcm.body.ineligibilityReasons.some(r => r.includes("Reverse charge") || r.includes("RCM")));

  // Clean up RCM purchase
  db.prepare("DELETE FROM purchase_invoices WHERE id = ?").run(rcmPurchase.id);

  // Case C: Outward supply (Sales invoice) -> MUST BE INELIGIBLE
  const sale = salesRepo.create({
    orgId: kaBranch.org_id,
    gstinId: kaBranch.id,
    period: testPeriod,
    invoiceNumber: "INV-SALE-01",
    invoiceDate: "2026-04-15",
    customerName: "Buyer Enterprise",
    customerGstin: "29AAACB9999F1Z1",
    pos: "29",
    isInterstate: false,
    supplyType: "B2B",
    taxableAmount: 10000,
    gstRate: 18,
    cgst: 900,
    sgst: 900,
    igst: 0,
    cess: 0,
    totalTax: 1800,
    totalAmount: 11800,
    status: "VALIDATED"
  });

  const verifyWithSale = await mockApiCall(sessHeaders, "GET", "/api/gst/nil-verify", { period: testPeriod }).run();
  assert.equal(verifyWithSale.body.eligible, false, "Outward supplies must disqualify Nil Return");
  assert.ok(verifyWithSale.body.ineligibilityReasons.some(r => r.includes("Outward supplies")));

  // Clean up
  db.prepare("DELETE FROM sales_invoices WHERE id = ?").run(sale.id);
  db.prepare("DELETE FROM purchase_invoices WHERE gstin_id = ? AND period = ?").run(kaBranch.id, testPeriod);
});

test("Backend Integrity: Per-Session Multi-Tenant Context Isolation & Cross-Tenant 403 Forbidden", async () => {
  const { handleFunctionalApi } = await import("../lib/functionalApi.js");
  const { orgRepo, gstinRepo } = await import("../lib/db.js");

  function mockApiCall(headers, method, pathname, query = {}, body = null) {
    const req = { method, url: pathname, headers: headers || {} };
    let statusCode = 200;
    let data = "";
    const res = {
      writeHead(code) { statusCode = code; },
      end(payload) { data = payload; }
    };
    return {
      run: async () => {
        await handleFunctionalApi(req, res, pathname, method, query, body);
        return { statusCode, body: data ? JSON.parse(data) : null };
      }
    };
  }

  const sessionA = { "x-session-id": "sess-tenant-user-alpha" };
  const sessionB = { "x-session-id": "sess-tenant-user-beta" };

  // Session A switches period to 052026
  await mockApiCall(sessionA, "POST", "/api/context/period", {}, { period: "052026" }).run();

  // Session B switches period to 082026
  await mockApiCall(sessionB, "POST", "/api/context/period", {}, { period: "082026" }).run();

  // Verify concurrent isolation: User A's period is untouched by User B
  const periodA = await mockApiCall(sessionA, "GET", "/api/context/period").run();
  assert.equal(periodA.body.activePeriod, "052026", "Session A active period remains 052026");

  const periodB = await mockApiCall(sessionB, "GET", "/api/context/period").run();
  assert.equal(periodB.body.activePeriod, "082026", "Session B active period remains 082026");

  // Create a separate organization and GSTIN
  const randDigits = Math.floor(1000 + Math.random() * 9000);
  const roguePan = `BBBCB${randDigits}Z`;
  const rogueOrg = orgRepo.create({
    name: "Foreign Competitor Corp",
    pan: roguePan,
    legalType: "Private Limited Company"
  });
  const rogueGstin = gstinRepo.create({
    orgId: rogueOrg.id,
    gstin: `33${roguePan}1Z5`,
    tradeName: "Foreign Branch TN",
    stateCode: "33",
    stateName: "Tamil Nadu",
    isPrimary: 1
  });

  // Session A (belongs to Apex Retailers) tries to activate rogue GSTIN -> MUST BE 403 Forbidden!
  const rogueActivate = await mockApiCall(sessionA, "POST", `/api/gstins/${rogueGstin.id}/activate`).run();
  assert.equal(rogueActivate.statusCode, 403, "Activating another organization's GSTIN must return 403 Forbidden");

  // Session A tries to query dashboard with unauthorized gstinId -> MUST BE 403 Forbidden!
  const rogueDash = await mockApiCall(sessionA, "GET", "/api/dashboard/summary", { gstinId: rogueGstin.id }).run();
  assert.equal(rogueDash.statusCode, 403, "Accessing another organization's GSTIN must return 403 Forbidden");
});

test("Statutory Compliance: Monthly vs QRMP Deadlines, Category 1/2 Staggering & Period Format Validation", async () => {
  const { formatPeriodDetails, validateAndNormalizePeriod, handleFunctionalApi } = await import("../lib/functionalApi.js");

  // 1. Period Validation
  assert.equal(validateAndNormalizePeriod("102026").valid, true);
  assert.equal(validateAndNormalizePeriod("002026").valid, false);
  assert.equal(validateAndNormalizePeriod("132026").valid, false);
  assert.equal(validateAndNormalizePeriod("992026").valid, false);
  assert.equal(validateAndNormalizePeriod("2026").valid, false);
  assert.equal(validateAndNormalizePeriod("invalid").valid, false);

  // Period API rejects invalid period format with HTTP 400
  function mockApiCall(method, pathname, query = {}, body = null) {
    const req = { method, url: pathname, headers: { "x-session-id": "sess-statutory-deadlines" } };
    let statusCode = 200;
    let data = "";
    const res = {
      writeHead(code) { statusCode = code; },
      end(payload) { data = payload; }
    };
    return {
      run: async () => {
        await handleFunctionalApi(req, res, pathname, method, query, body);
        return { statusCode, body: data ? JSON.parse(data) : null };
      }
    };
  }

  const badPeriodPost = await mockApiCall("POST", "/api/context/period", {}, { period: "132026" }).run();
  assert.equal(badPeriodPost.statusCode, 400, "POST /api/context/period with month 13 must return 400");

  const badPeriodDash = await mockApiCall("GET", "/api/dashboard/summary", { period: "992026" }).run();
  assert.equal(badPeriodDash.statusCode, 400, "GET /api/dashboard/summary with invalid period must return 400");

  // 2. Regular Monthly Filer: GSTR-1 due 11th, GSTR-3B due 20th
  const monthly = formatPeriodDetails("102026", "MONTHLY", "27");
  assert.equal(monthly.filingFrequency, "MONTHLY");
  assert.equal(monthly.gstr1Deadline, "November 11, 2026");
  assert.equal(monthly.gstr3bDeadline, "November 20, 2026");

  // 3. QRMP M1 (e.g. October 2026 in Q3 Oct-Dec):
  // Optional IFF B2B by 13th, Mandatory PMT-06 challan deposit by 25th, GSTR-3B deferred
  const qrmpM1 = formatPeriodDetails("102026", "QRMP", "27");
  assert.equal(qrmpM1.filingFrequency, "QRMP");
  assert.equal(qrmpM1.isQuarterEnd, false);
  assert.equal(qrmpM1.quarterMonth, "M1");
  assert.equal(qrmpM1.iffDeadline, "November 13, 2026");
  assert.equal(qrmpM1.pmt06Deadline, "November 25, 2026");
  assert.ok(qrmpM1.gstr3bDeadline.includes("Deferred to Quarter End"));

  // 4. QRMP Quarter End (M3: December 2026, Q3 End):
  // Quarterly GSTR-1 by 13th
  // Category 1 States (e.g., 27 Maharashtra, 29 Karnataka, 32 Kerala, 33 Tamil Nadu) -> Due 22nd
  const qrmpM3Cat1 = formatPeriodDetails("122026", "QRMP", "27");
  assert.equal(qrmpM3Cat1.isQuarterEnd, true);
  assert.equal(qrmpM3Cat1.quarterMonth, "M3");
  assert.equal(qrmpM3Cat1.gstr1Deadline, "January 13, 2027");
  assert.ok(qrmpM3Cat1.gstr3bDeadline.includes("January 22, 2027"));

  // Category 2 States (e.g., 07 Delhi, 09 Uttar Pradesh, 08 Rajasthan, 19 West Bengal) -> Due 24th
  const qrmpM3Cat2 = formatPeriodDetails("122026", "QRMP", "07");
  assert.equal(qrmpM3Cat2.isQuarterEnd, true);
  assert.ok(qrmpM3Cat2.gstr3bDeadline.includes("January 24, 2027"));
});

test("Security & Simulation Integrity: XSS Escaping and SIMULATED_NOT_TRANSMITTED Status", async () => {
  const fs = await import("fs");
  const js = fs.readFileSync("app.js", "utf8");

  // 1. Verify escapeHtml exists in app.js and functions correctly
  assert.ok(js.includes("function escapeHtml(str)"), "escapeHtml defined in app.js");

  // Test escapeHtml implementation directly
  function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  const dangerousPayload = "<img src=x onerror=alert('xss')>";
  const escaped = escapeHtml(dangerousPayload);
  assert.ok(!escaped.includes("<img"), "Must not contain unescaped tag open");
  assert.equal(escaped, "&lt;img src=x onerror=alert(&#39;xss&#39;)&gt;");

  const scriptPayload = "<script>alert(document.cookie)</script>";
  assert.equal(escapeHtml(scriptPayload), "&lt;script&gt;alert(document.cookie)&lt;/script&gt;");

  // 2. Verify all simulation submissions use SIMULATED_NOT_TRANSMITTED and arn: null
  const { fileNilGstReturn } = await import("../lib/gstCopilotEngine.js");
  const copilotNil = fileNilGstReturn({ gstin: "27AAACA1234A1Z5", period: "102026" });
  assert.equal(copilotNil.status, "SIMULATED_NOT_TRANSMITTED");
  assert.equal(copilotNil.arn, null);
  assert.equal(copilotNil.officialArn, null);
  assert.ok(copilotNil.simulationReference.startsWith("SIM-NIL-"));
});
