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
  assert.ok(nilRes.arn.startsWith("NIL-"), "Nil ARN must have standard prefix");
  assert.ok(nilRes.watermark.includes("SIMULATION MODE"), "Nil ARN receipt must carry simulation watermark");
});
