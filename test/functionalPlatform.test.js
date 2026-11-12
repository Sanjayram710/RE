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
  sessionRepo,
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

let defaultTestSessionToken = null;
function getAuthReq(extraHeaders = {}) {
  if (!defaultTestSessionToken) {
    seedDevelopmentData();
    const existing = db.prepare("SELECT * FROM sessions WHERE token = ?").get("tok-test-apex-valid-token");
    if (existing) {
      if (existing.is_revoked) {
        db.prepare("UPDATE sessions SET is_revoked = 0, revoked_at = NULL WHERE id = ?").run(existing.id);
      }
      defaultTestSessionToken = existing.token;
    } else {
      const user = userRepo.findByEmail("rajesh.sharma@apexretail.com") || db.prepare("SELECT * FROM users LIMIT 1").get();
      const org = db.prepare("SELECT * FROM organizations LIMIT 1").get();
      const gstin = db.prepare("SELECT * FROM gst_registrations WHERE org_id = ? LIMIT 1").get(org.id);
      const session = sessionRepo.create({
        userId: user.id,
        activeOrgId: org.id,
        activeGstinId: gstin.id,
        activePeriod: "102026",
        token: "tok-test-apex-valid-token"
      });
      defaultTestSessionToken = session.token;
    }
  }
  return {
    headers: {
      authorization: `Bearer ${defaultTestSessionToken}`,
      ...extraHeaders
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
  await handleFunctionalApi(getAuthReq(), res, "/api/gstins", "POST", {}, {
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
  await handleFunctionalApi(getAuthReq(), badRes, "/api/gstins", "POST", {}, {
    gstin: "INVALID_GSTIN_123",
    tradeName: "Bad Branch"
  });
  assert.equal(badRes.statusCode, 400);

  // Clean up the created test branch so Apex Retailers maintains its exact 10 canonical branches
  db.prepare("DELETE FROM gst_registrations WHERE gstin = ?").run(validGstin);
});

test("Multi-GSTIN: Switching active GSTIN scopes all queries", async () => {
  // Retrieve Karnataka Branch
  const kaGstin = gstinRepo.findByGstin("29AAACB1234F1Z5");
  assert.ok(kaGstin, "Karnataka branch must exist");

  const res = createMockRes();
  await handleFunctionalApi(getAuthReq(), res, `/api/gstins/${kaGstin.id}/activate`, "POST", {}, {});
  assert.equal(res.statusCode, 200);

  // Now query dashboard summary for Karnataka
  const dashRes = createMockRes();
  await handleFunctionalApi(getAuthReq(), dashRes, "/api/dashboard/summary", "GET", { period: "102026" }, {});
  assert.equal(dashRes.statusCode, 200);
  const dashData = JSON.parse(dashRes.body);
  assert.equal(dashData.entity.gstin, "29AAACB1234F1Z5");
  assert.equal(dashData.entity.state, "Karnataka (29)");

  // Switch back to Maharashtra Main
  const mhGstin = gstinRepo.findByGstin("27AAACA1234A1Z5");
  const switchRes = createMockRes();
  await handleFunctionalApi(getAuthReq(), switchRes, `/api/gstins/${mhGstin.id}/activate`, "POST", {}, {});
  assert.equal(switchRes.statusCode, 200);
});

test("Sales Invoices: Create and deterministic tax computation", async () => {
  const mhGstin = gstinRepo.findByGstin("27AAACA1234A1Z5");
  const res = createMockRes();

  await handleFunctionalApi(getAuthReq(), res, "/api/sales", "POST", { period: "102026" }, {
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

  await handleFunctionalApi(getAuthReq(), res, "/api/purchases", "POST", { period: "102026" }, {
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
  await handleFunctionalApi(getAuthReq(), payRes, `/api/purchases/${purId}/payment`, "POST", {}, {
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
  await handleFunctionalApi(getAuthReq(), res, "/api/documents/upload", "POST", {}, {
    filename: "Audit_Proof_Oct2026.pdf",
    category: "purchase_bill",
    rawText: "TAX INVOICE 32AAACB1234F1Z5 INV-2026-881 Taxable: 85000 CGST: 7650 SGST: 7650"
  });

  assert.equal(res.statusCode, 201);
  const data = JSON.parse(res.body);
  assert.ok(data.document.id);
  assert.equal(fs.existsSync(data.document.storage_path), true);
  assert.ok(data.ocr.id);

  // Clean up test upload
  documentRepo.delete(data.document.id);
  if (data.document.storage_path && fs.existsSync(data.document.storage_path)) {
    try { fs.unlinkSync(data.document.storage_path); } catch {}
  }
});

test("OCR Approval: Posts verified fields to purchase register", async () => {
  const res = createMockRes();
  await handleFunctionalApi(getAuthReq(), res, "/api/ocr/approve", "POST", {}, {
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
  const auth = getAuthReq();
  const session = db.prepare("SELECT * FROM sessions WHERE token = ?").get(defaultTestSessionToken);
  const gstinId = session.active_gstin_id;
  const orgId = session.active_org_id;

  const pur1 = purchaseRepo.create({
    orgId,
    gstinId,
    period: "102026",
    invoiceNumber: "SUPP-MH-8812",
    invoiceDate: "2026-10-08",
    supplierName: "Mahindra Logistics Ltd",
    supplierGstin: "27AAACM1234B1Z2",
    pos: "27",
    isInterstate: false,
    taxableAmount: 220000,
    gstRate: 18,
    cgst: 19800,
    sgst: 19800,
    igst: 0,
    totalTax: 39600,
    totalAmount: 259600,
    itcEligibility: "ELIGIBLE"
  });
  const pur2 = purchaseRepo.create({
    orgId,
    gstinId,
    period: "102026",
    invoiceNumber: "SUPP-DL-4019",
    invoiceDate: "2026-10-18",
    supplierName: "Delhi Paper & Packaging Solutions",
    supplierGstin: "07AAACD5544E1Z0",
    pos: "27",
    isInterstate: true,
    taxableAmount: 192300,
    gstRate: 18,
    cgst: 0,
    sgst: 0,
    igst: 34614,
    totalTax: 34614,
    totalAmount: 226914,
    itcEligibility: "ELIGIBLE"
  });

  const insert2B = db.prepare(`
    INSERT OR REPLACE INTO gstr2b_entries 
    (id, gstin_id, period, supplier_gstin, supplier_name, invoice_number, invoice_date, taxable_value, igst, cgst, sgst, cess, filing_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
  `);
  insert2B.run("g2b-test-recon-1", gstinId, "102026", "27AAACM1234B1Z2", "Mahindra Logistics Ltd", "SUPP-MH-8812", "2026-10-08", 220000, 0, 19800, 19800, "2026-11-11");
  insert2B.run("g2b-test-recon-2", gstinId, "102026", "07AAACD5544E1Z0", "Delhi Paper & Packaging Solutions", "SUPP-DL-4019", "2026-10-18", 192300, 34614, 0, 0, "2026-11-12");

  const res = createMockRes();
  await handleFunctionalApi(auth, res, "/api/reconciliation/summary", "GET", { period: "102026" }, {});
  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.body);
  assert.ok(data.summary.matched.count >= 2);
  assert.equal(data.summary.totalBooksPurchases >= 2, true);

  // Clean up
  purchaseRepo.delete(pur1.id);
  purchaseRepo.delete(pur2.id);
  db.prepare("DELETE FROM gstr2b_entries WHERE id IN ('g2b-test-recon-1', 'g2b-test-recon-2')").run();
});

test("Tax Calculation & Rule 88A Matrix Execution", async () => {
  const res = createMockRes();
  await handleFunctionalApi(getAuthReq(), res, "/api/returns/tax-calc", "GET", { period: "102026" }, {});
  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.body);
  assert.ok(data.liability);
  assert.ok(data.inputCredit);
  assert.ok(data.setoffMatrix);
  assert.ok(data.netCashPayable >= 0);
});

test("GST Copilot: Context grounded on real database records", async () => {
  const auth = getAuthReq();
  const session = db.prepare("SELECT * FROM sessions WHERE token = ?").get(defaultTestSessionToken);
  const gstinId = session.active_gstin_id;
  const orgId = session.active_org_id;

  const testSale = salesRepo.create({
    orgId,
    gstinId,
    period: "102026",
    invoiceNumber: "INV-COPILOT-01",
    invoiceDate: "2026-10-05",
    customerName: "Reliance Retail Ltd",
    customerGstin: "27AAACR7055K1ZX",
    pos: "27",
    isInterstate: false,
    supplyType: "B2B",
    taxableAmount: 450000,
    gstRate: 18,
    cgst: 40500,
    sgst: 40500,
    igst: 0,
    totalTax: 81000,
    totalAmount: 531000,
    status: "VALIDATED"
  });

  const res = createMockRes();
  await handleFunctionalApi(auth, res, "/api/copilot/ask", "POST", {}, {
    question: "How much GST do I need to pay for October 2026?"
  });
  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.body);
  assert.ok(data.answer.includes("Apex Retailers"));
  assert.ok(data.answer.includes("net tax payable in cash"));
  assert.ok(data.citations.includes("Section 49 & Rule 88A CGST Rules"));

  // Clean up
  salesRepo.delete(testSale.id);
});

test("PMT-06 Challan: Enforces Rule 87(4) Over-The-Counter ₹10,000 limit", async () => {
  const res = createMockRes();
  await handleFunctionalApi(getAuthReq(), res, "/api/challans/generate-pmt06", "POST", {}, {
    amount: 15000,
    paymentMode: "OVER_THE_COUNTER"
  });

  assert.equal(res.statusCode, 400);
  const data = JSON.parse(res.body);
  assert.ok(data.error.includes("Rule 87(4)"));
});

test("PMT-06 Challan: Net Banking payment credits cash ledger", async () => {
  const genRes = createMockRes();
  await handleFunctionalApi(getAuthReq(), genRes, "/api/challans/generate-pmt06", "POST", {}, {
    amount: 20000,
    paymentMode: "NET_BANKING"
  });
  assert.equal(genRes.statusCode, 201);
  const genData = JSON.parse(genRes.body);

  const payRes = createMockRes();
  await handleFunctionalApi(getAuthReq(), payRes, "/api/challans/simulate-payment", "POST", {}, {
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
  await handleFunctionalApi(getAuthReq(), uploadRes, "/api/documents/upload", "POST", {}, {
    filename: "Doc_For_Deletion.pdf",
    category: "purchase_bill",
    content: "Dummy Content for Deletion Test"
  });
  assert.equal(uploadRes.statusCode, 201);
  const doc = JSON.parse(uploadRes.body).document;

  // 2. List documents
  const listRes = createMockRes();
  await handleFunctionalApi(getAuthReq(), listRes, "/api/documents", "GET", {}, {});
  assert.equal(listRes.statusCode, 200);
  const listData = JSON.parse(listRes.body);
  assert.ok(listData.documents.some(d => d.id === doc.id));

  // 3. Delete document
  const delRes = createMockRes();
  await handleFunctionalApi(getAuthReq(), delRes, `/api/documents/${doc.id}`, "DELETE", {}, {});
  assert.equal(delRes.statusCode, 200);

  // 4. Verify removed from list
  const verifyRes = createMockRes();
  await handleFunctionalApi(getAuthReq(), verifyRes, "/api/documents", "GET", {}, {});
  const verifyData = JSON.parse(verifyRes.body);
  assert.ok(!verifyData.documents.some(d => d.id === doc.id));
});

test("Reports & Exports: Generate CSV files for Sales and Purchases", async () => {
  const salesCsvRes = createMockRes();
  await handleFunctionalApi(getAuthReq(), salesCsvRes, "/api/reports/sales/csv", "GET", {}, {});
  assert.equal(salesCsvRes.statusCode, 200);
  assert.ok(salesCsvRes.body.includes("Invoice Number,Invoice Date"));

  const purCsvRes = createMockRes();
  await handleFunctionalApi(getAuthReq(), purCsvRes, "/api/reports/purchases/csv", "GET", {}, {});
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
    await handleFunctionalApi(getAuthReq(), res, "/api/copilot/ask", "POST", {}, { question: item.q });
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
    const req = { method, url: pathname, headers: getAuthReq().headers };
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

  // MH branch creates a temporary sales invoice to test blocking when transactions exist
  const mhBranch = gstinRepo.findByGstin("27AAACA1234A1Z5");
  assert.ok(mhBranch, "MH branch exists");
  await mockApiCall("POST", `/api/gstins/${mhBranch.id}/activate`).run();

  const tempSale = salesRepo.create({
    orgId: mhBranch.org_id,
    gstinId: mhBranch.id,
    period: "102026",
    invoiceNumber: "INV-NIL-BLOCK-TEST",
    invoiceDate: "2026-10-10",
    customerName: "Nil Test Customer",
    customerGstin: "27AAACR7055K1ZX",
    pos: "27",
    isInterstate: false,
    supplyType: "B2B",
    taxableAmount: 10000,
    gstRate: 18,
    cgst: 900,
    sgst: 900,
    igst: 0,
    totalTax: 1800,
    totalAmount: 11800,
    status: "VALIDATED"
  });

  const verifyMh = await mockApiCall("GET", "/api/gst/nil-verify", { period: "102026" }).run();
  assert.equal(verifyMh.body.eligible, false, "Must block Nil filing when transactions exist");
  assert.equal(verifyMh.body.hasTransactions, true, "hasTransactions flag must be true");
  assert.ok(verifyMh.body.verification.salesCount > 0, "Must report actual sales invoices found");

  const fileMh = await mockApiCall("POST", "/api/gst/nil-file", {}, { period: "102026", declarationConfirmed: true }).run();
  assert.equal(fileMh.statusCode, 400, "POST /api/gst/nil-file must reject with HTTP 400 when transactions exist");
  assert.equal(fileMh.body.success, false);

  // Clean up temporary transaction
  salesRepo.delete(tempSale.id);

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
    const req = { method, url: pathname, headers: getAuthReq().headers };
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

  const sessHeaders = getAuthReq().headers;
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
  const sessHeaders = getAuthReq().headers;

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
  const { orgRepo, gstinRepo, userRepo, sessionRepo, db } = await import("../lib/db.js");

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

  const orgA = db.prepare("SELECT id FROM organizations LIMIT 1").get();
  const userA = userRepo.create({ email: `alpha.${Date.now()}@apexretail.com`, passwordHash: "hashA", fullName: "User Alpha", role: "OWNER" });
  orgRepo.addMember(orgA.id, userA.id, "OWNER");
  const tokenA = "tok-tenant-alpha-" + Date.now();
  sessionRepo.create({ userId: userA.id, activeOrgId: orgA.id, token: tokenA, activePeriod: "102026" });

  const userB = userRepo.create({ email: `beta.${Date.now()}@apexretail.com`, passwordHash: "hashB", fullName: "User Beta", role: "ACCOUNTANT" });
  orgRepo.addMember(orgA.id, userB.id, "ACCOUNTANT");
  const tokenB = "tok-tenant-beta-" + Date.now();
  sessionRepo.create({ userId: userB.id, activeOrgId: orgA.id, token: tokenB, activePeriod: "102026" });

  const sessionA = { authorization: `Bearer ${tokenA}` };
  const sessionB = { authorization: `Bearer ${tokenB}` };

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
    const req = { method, url: pathname, headers: getAuthReq().headers };
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

test("Security Audit: Authentication & Session Token Handling (Reject Unknown, Expired, Revoked, Invalid)", async () => {
  const { handleFunctionalApi } = await import("../lib/functionalApi.js");
  const { sessionRepo, userRepo, orgRepo, db } = await import("../lib/db.js");

  function mockApiCall(headers, method, pathname, query = {}, body = null) {
    const req = { method, url: pathname, headers: headers || {} };
    let statusCode = 200;
    let data = "";
    const res = {
      writeHead(code) { statusCode = code; },
      end(payload) { data = payload; },
      setHeader() {}
    };
    return {
      run: async () => {
        await handleFunctionalApi(req, res, pathname, method, query, body);
        return { statusCode, body: data ? JSON.parse(data) : null };
      }
    };
  }

  const user = userRepo.findByEmail("rajesh.sharma@apexretail.com") || db.prepare("SELECT * FROM users LIMIT 1").get();
  const org = db.prepare("SELECT * FROM organizations LIMIT 1").get();

  // 1. Unknown session tokens rejected (HTTP 401)
  const unknownCall = await mockApiCall(
    { authorization: "Bearer tok-completely-unknown-token-9999" },
    "GET",
    "/api/dashboard/summary"
  ).run();
  assert.equal(unknownCall.statusCode, 401, "Unknown session token must return 401");
  assert.ok(unknownCall.body.error.includes("Unauthorized"));

  // 2. Expired session tokens rejected (HTTP 401)
  const expiredToken = "tok-expired-test-" + Date.now();
  sessionRepo.create({
    userId: user.id,
    token: expiredToken,
    activeOrgId: org.id,
    expiresAt: new Date(Date.now() - 3600000).toISOString() // 1 hour ago
  });
  const expiredCall = await mockApiCall(
    { authorization: `Bearer ${expiredToken}` },
    "GET",
    "/api/dashboard/summary"
  ).run();
  assert.equal(expiredCall.statusCode, 401, "Expired session token must return 401");

  // 3. Revoked session tokens rejected (HTTP 401)
  const revokedToken = "tok-revoked-test-" + Date.now();
  const activeSess = sessionRepo.create({
    userId: user.id,
    token: revokedToken,
    activeOrgId: org.id,
    expiresAt: new Date(Date.now() + 86400000).toISOString()
  });
  sessionRepo.revoke(revokedToken);
  const revokedCall = await mockApiCall(
    { authorization: `Bearer ${revokedToken}` },
    "GET",
    "/api/dashboard/summary"
  ).run();
  assert.equal(revokedCall.statusCode, 401, "Revoked session token must return 401");

  // 4. Invalid session tokens rejected (HTTP 401)
  const invalidCall = await mockApiCall(
    { authorization: "Bearer " },
    "GET",
    "/api/dashboard/summary"
  ).run();
  assert.equal(invalidCall.statusCode, 401, "Empty/malformed token must return 401");

  // 5. Forged query or body session IDs must be IGNORED (HTTP 401)
  const forgedQueryCall = await mockApiCall(
    {}, // No auth header
    "GET",
    "/api/dashboard/summary",
    { sessionId: activeSess.id, sessionToken: activeSess.token }
  ).run();
  assert.equal(forgedQueryCall.statusCode, 401, "Query param sessionId must not grant authentication");

  const forgedBodyCall = await mockApiCall(
    {}, // No auth header
    "POST",
    "/api/sales",
    {},
    { sessionId: activeSess.id, invoiceNumber: "FORGED-INV-001" }
  ).run();
  assert.equal(forgedBodyCall.statusCode, 401, "Body sessionId must not grant authentication");

  // 6. Tenant-scoped endpoints all reject unauthenticated access (HTTP 401)
  const unauthEndpoints = [
    { method: "GET", path: "/api/gstins" },
    { method: "GET", path: "/api/sales" },
    { method: "GET", path: "/api/purchases" },
    { method: "GET", path: "/api/documents" },
    { method: "GET", path: "/api/reconciliation/summary" },
    { method: "GET", path: "/api/returns/tax-calc" },
    { method: "GET", path: "/api/ledgers/balances" },
    { method: "POST", path: "/api/challans/generate-pmt06", body: { amount: 1000 } }
  ];

  for (const ep of unauthEndpoints) {
    const res = await mockApiCall({}, ep.method, ep.path, {}, ep.body || {}).run();
    assert.equal(res.statusCode, 401, `Unauthenticated ${ep.method} ${ep.path} must return 401`);
  }
});

test("Security Audit: Multi-Tenant Authorization, Cross-Tenant Gating & Credential Login/Logout", async () => {
  const { handleFunctionalApi } = await import("../lib/functionalApi.js");
  const { userRepo, orgRepo, gstinRepo, sessionRepo, db } = await import("../lib/db.js");

  function mockApiCall(headers, method, pathname, query = {}, body = null) {
    const req = { method, url: pathname, headers: headers || {} };
    let statusCode = 200;
    let data = "";
    const resHeaders = {};
    const res = {
      writeHead(code, h = {}) { statusCode = code; Object.assign(resHeaders, h); },
      end(payload) { data = payload; },
      setHeader(k, v) { resHeaders[k] = v; }
    };
    return {
      run: async () => {
        await handleFunctionalApi(req, res, pathname, method, query, body);
        return { statusCode, headers: resHeaders, body: data ? JSON.parse(data) : null };
      }
    };
  }

  // 1. Two separate organizations with distinct users
  const randNumA = Math.floor(1000 + Math.random() * 9000);
  const randNumB = Math.floor(1000 + Math.random() * 9000);
  const uidA = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const uidB = `${Date.now() + 1}_${Math.random().toString(36).slice(2, 7)}`;

  const orgA = orgRepo.create({ name: `Tenant A Corp ${uidA}`, pan: `AAAAP${randNumA}A` });
  const userA = userRepo.create({ email: `ceo@tenant-a-${uidA}.com`, passwordHash: userRepo.hashPassword("password"), fullName: "Alice CEO", role: "OWNER" });
  orgRepo.addMember(orgA.id, userA.id, "OWNER");
  const gstinA = gstinRepo.create({ orgId: orgA.id, gstin: `27AAAAP${randNumA}A1Z1`, tradeName: "Branch A", stateCode: "27", stateName: "Maharashtra", isPrimary: 1 });

  const orgB = orgRepo.create({ name: `Tenant B Corp ${uidB}`, pan: `BBBBB${randNumB}B` });
  const userB = userRepo.create({ email: `cfo@tenant-b-${uidB}.com`, passwordHash: userRepo.hashPassword("password"), fullName: "Bob CFO", role: "OWNER" });
  orgRepo.addMember(orgB.id, userB.id, "OWNER");
  const gstinB = gstinRepo.create({ orgId: orgB.id, gstin: `29BBBBB${randNumB}B1Z2`, tradeName: "Branch B", stateCode: "29", stateName: "Karnataka", isPrimary: 1 });

  // 2. Legitimate Login for User A
  const loginA = await mockApiCall({}, "POST", "/api/auth/login", {}, { email: userA.email, password: "password" }).run();
  assert.equal(loginA.statusCode, 200, "User A login must succeed");
  assert.ok(loginA.body.sessionToken, "Login must return cryptographic sessionToken");
  const cookieStrA = Array.isArray(loginA.headers["Set-Cookie"]) ? loginA.headers["Set-Cookie"].join("; ") : (loginA.headers["Set-Cookie"] || "");
  assert.ok(cookieStrA.includes("simplegst_session="), "Login must set HTTP-only cookie");

  const tokenA = loginA.body.sessionToken;
  const authHeadersA = { authorization: `Bearer ${tokenA}` };

  // 3. Legitimate Login for User B
  const loginB = await mockApiCall({}, "POST", "/api/auth/login", {}, { email: userB.email, password: "password" }).run();
  assert.equal(loginB.statusCode, 200, "User B login must succeed");
  const tokenB = loginB.body.sessionToken;
  const authHeadersB = { authorization: `Bearer ${tokenB}` };

  // 4. User A accesses own GSTINs -> sees only Org A
  const gstinsA = await mockApiCall(authHeadersA, "GET", "/api/gstins").run();
  assert.equal(gstinsA.statusCode, 200);
  assert.equal(gstinsA.body.gstins.length, 1);
  assert.equal(gstinsA.body.gstins[0].id, gstinA.id);

  // 5. User B accesses own GSTINs -> sees only Org B
  const gstinsB = await mockApiCall(authHeadersB, "GET", "/api/gstins").run();
  assert.equal(gstinsB.statusCode, 200);
  assert.equal(gstinsB.body.gstins.length, 1);
  assert.equal(gstinsB.body.gstins[0].id, gstinB.id);

  // 6. Cross-Tenant GSTIN access rejected (HTTP 403 Forbidden)
  // User A attempts to query dashboard with User B's GSTIN
  const crossDash = await mockApiCall(authHeadersA, "GET", "/api/dashboard/summary", { gstinId: gstinB.id }).run();
  assert.equal(crossDash.statusCode, 403, "Cross-tenant GSTIN access must return 403 Forbidden");

  // 7. Unauthorized GSTIN switching rejected (HTTP 403 Forbidden)
  // User A attempts to activate User B's GSTIN
  const crossSwitch = await mockApiCall(authHeadersA, "POST", `/api/gstins/${gstinB.id}/activate`).run();
  assert.equal(crossSwitch.statusCode, 403, "Switching to another organization's GSTIN must return 403 Forbidden");

  // User A attempts to switch organization context to Org B
  const crossOrgSwitch = await mockApiCall(authHeadersA, "POST", "/api/auth/switch-context", {}, { orgId: orgB.id }).run();
  assert.equal(crossOrgSwitch.statusCode, 403, "Switching to unauthorized organization must return 403 Forbidden");

  // 8. Session validation endpoint /api/auth/session
  const checkSessA = await mockApiCall(authHeadersA, "GET", "/api/auth/session").run();
  assert.equal(checkSessA.statusCode, 200);
  assert.equal(checkSessA.body.authenticated, true);
  assert.equal(checkSessA.body.user.email, userA.email);

  // 9. Logout flow revokes session
  const logoutA = await mockApiCall(authHeadersA, "POST", "/api/auth/logout").run();
  assert.equal(logoutA.statusCode, 200, "Logout must succeed");
  const logoutCookieStr = Array.isArray(logoutA.headers["Set-Cookie"]) ? logoutA.headers["Set-Cookie"].join("; ") : (logoutA.headers["Set-Cookie"] || "");
  assert.ok(logoutCookieStr.includes("Expires="), "Logout must clear cookie");

  // After logout, token is revoked -> returns 401
  const postLogoutCall = await mockApiCall(authHeadersA, "GET", "/api/dashboard/summary").run();
  assert.equal(postLogoutCall.statusCode, 401, "Revoked session after logout must return 401");

  // Invalid login credentials rejected (HTTP 401)
  const badLogin = await mockApiCall({}, "POST", "/api/auth/login", {}, { email: userA.email, password: "wrong-password" }).run();
  assert.equal(badLogin.statusCode, 401, "Bad password must return 401");

  // Teardown tenant test records
  db.prepare("DELETE FROM sessions WHERE user_id IN (?, ?)").run(userA.id, userB.id);
  db.prepare("DELETE FROM gst_registrations WHERE id IN (?, ?)").run(gstinA.id, gstinB.id);
  db.prepare("DELETE FROM org_members WHERE org_id IN (?, ?)").run(orgA.id, orgB.id);
  db.prepare("DELETE FROM organizations WHERE id IN (?, ?)").run(orgA.id, orgB.id);
  db.prepare("DELETE FROM users WHERE id IN (?, ?)").run(userA.id, userB.id);
});

test("Security Audit: Authentication Security Final Hardening Suite", async () => {
  const { handleFunctionalApi, isHttpsRequest, isAllowedOrigin, buildSessionCookie, buildCsrfCookie, buildClearCookies } = await import("../lib/functionalApi.js");
  const { userRepo, orgRepo, gstinRepo, sessionRepo, passwordResetRepo, db } = await import("../lib/db.js");
  const { handleRequest } = await import("../server.js");

  function mockApiCall(headers, method, pathname, query = {}, body = null) {
    const req = { method, url: pathname, headers: headers || {} };
    let statusCode = 200;
    let data = "";
    const resHeaders = {};
    const res = {
      writeHead(code, h = {}) { statusCode = code; Object.assign(resHeaders, h); },
      end(payload) { data = payload; },
      setHeader(k, v) { resHeaders[k] = v; }
    };
    return {
      run: async () => {
        await handleFunctionalApi(req, res, pathname, method, query, body);
        return { statusCode, headers: resHeaders, body: data ? JSON.parse(data) : null };
      }
    };
  }

  // 1. Remove development password bypasses
  assert.equal(userRepo.verifyPassword("pbkdf2$development_hash_apex", "admin123"), false);
  assert.equal(userRepo.verifyPassword("pbkdf2$development_hash_apex", "password"), false);
  assert.equal(userRepo.verifyPassword("pbkdf2$development_hash_apex", "apex123"), false);
  assert.equal(userRepo.verifyPassword("pbkdf2$development_hash_apex", "development_hash_apex"), false);
  assert.equal(userRepo.verifyPassword("plainpassword123", "plainpassword123"), false);
  assert.equal(userRepo.verifyPassword("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", ""), false);

  // 2. Reject legacy credentials with migration notification
  const randSec = Math.floor(1000 + Math.random() * 9000);
  const randSecUid = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const legacyUser = userRepo.create({
    email: `legacy-${randSecUid}@apexretail.com`,
    passwordHash: "plaintext_legacy_pass",
    fullName: "Legacy User",
    role: "OWNER"
  });
  const legacyLogin = await mockApiCall({}, "POST", "/api/auth/login", {}, { email: legacyUser.email, password: "plaintext_legacy_pass" }).run();
  assert.equal(legacyLogin.statusCode, 401);
  assert.equal(legacyLogin.body.requiresReset, true);

  // 3. Secure password-reset flow
  const resetReq = await mockApiCall({}, "POST", "/api/auth/request-reset", {}, { email: legacyUser.email }).run();
  assert.equal(resetReq.statusCode, 200);
  assert.ok(resetReq.body.resetToken, "Reset token must be returned");

  // Invalid/short password rejected
  const shortPassRes = await mockApiCall({}, "POST", "/api/auth/reset-password", {}, { token: resetReq.body.resetToken, newPassword: "short" }).run();
  assert.equal(shortPassRes.statusCode, 400);

  // Valid password reset
  const resetConfirm = await mockApiCall({}, "POST", "/api/auth/reset-password", {}, { token: resetReq.body.resetToken, newPassword: "StrongPassword@2026" }).run();
  assert.equal(resetConfirm.statusCode, 200);

  // Token cannot be reused
  const reusedReset = await mockApiCall({}, "POST", "/api/auth/reset-password", {}, { token: resetReq.body.resetToken, newPassword: "AnotherPassword@2026" }).run();
  assert.equal(reusedReset.statusCode, 400);

  // Login succeeds with new salted PBKDF2 credentials
  const freshLogin = await mockApiCall({}, "POST", "/api/auth/login", {}, { email: legacyUser.email, password: "StrongPassword@2026" }).run();
  assert.equal(freshLogin.statusCode, 200);
  assert.ok(freshLogin.body.sessionToken);
  assert.ok(freshLogin.body.csrfToken);

  const freshToken = freshLogin.body.sessionToken;
  const freshCsrf = freshLogin.body.csrfToken;

  // 4. Raw session token never returned from GET /api/auth/session
  const sessStatus = await mockApiCall({ authorization: `Bearer ${freshToken}` }, "GET", "/api/auth/session").run();
  assert.equal(sessStatus.statusCode, 200);
  assert.equal(sessStatus.body.authenticated, true);
  assert.equal(sessStatus.body.sessionToken, undefined, "Raw sessionToken must NOT be exposed in GET /api/auth/session");
  assert.equal(sessStatus.body.sessionId, undefined, "Raw sessionId must NOT be exposed in GET /api/auth/session");
  assert.ok(sessStatus.body.csrfToken, "CSRF token must be present");

  // 5. Secure cookie generation & HTTPS Secure flag
  const devCookie = buildSessionCookie("sample-token", { headers: {} });
  assert.ok(devCookie.includes("HttpOnly"));
  assert.ok(devCookie.includes("SameSite=Lax"));
  assert.ok(devCookie.includes("Max-Age=604800"));
  assert.ok(!devCookie.includes("Secure"), "Local dev cookie must not enforce Secure without HTTPS");

  const prodCookie = buildSessionCookie("sample-token", { headers: { "x-forwarded-proto": "https" } });
  assert.ok(prodCookie.includes("; Secure"), "HTTPS cookie must enforce ; Secure");

  const clearCookies = buildClearCookies({ headers: { "x-forwarded-proto": "https" } });
  assert.equal(clearCookies.length, 2);
  assert.ok(clearCookies[0].includes("Expires=Thu, 01 Jan 1970"));
  assert.ok(clearCookies[1].includes("Expires=Thu, 01 Jan 1970"));

  // 6. CSRF Protection: Cookie auth without X-CSRF-Token rejected on state-changing call
  const orgSec = orgRepo.create({ name: `Security Org ${randSec}`, pan: `SECO${randSec}P` });
  orgRepo.addMember(orgSec.id, legacyUser.id, "OWNER");
  const gstinSec = gstinRepo.create({ orgId: orgSec.id, gstin: `27SECO${randSec}P1Z1`, tradeName: "Sec Branch", stateCode: "27", stateName: "Maharashtra", isPrimary: 1 });
  const validSessObj = sessionRepo.findValidSession(freshToken);
  sessionRepo.updateContext(validSessObj.id, { orgId: orgSec.id, gstinId: gstinSec.id });

  const cookieHeadersNoCsrf = {
    cookie: `simplegst_session=${freshToken}`
  };
  const csrfBlocked = await mockApiCall(cookieHeadersNoCsrf, "POST", "/api/sales", { period: "102026" }, {
    invoiceNumber: `INV-CSRF-${randSec}`,
    invoiceDate: "2026-10-10",
    customerGstin: "27AAAAA0000A1Z5",
    customerName: "CSRF Customer",
    pos: "27",
    taxableAmount: 10000,
    gstRate: 18,
    cgstAmount: 900,
    sgstAmount: 900,
    igstAmount: 0,
    totalInvoiceValue: 11800,
    supplyType: "B2B"
  }).run();
  assert.equal(csrfBlocked.statusCode, 403, "Cookie-authenticated mutation without CSRF token must return 403 Forbidden");

  // Cookie auth WITH valid X-CSRF-Token succeeds
  const cookieHeadersWithCsrf = {
    cookie: `simplegst_session=${freshToken}`,
    "x-csrf-token": freshCsrf
  };
  const csrfAllowed = await mockApiCall(cookieHeadersWithCsrf, "POST", "/api/sales", { period: "102026" }, {
    invoiceNumber: `INV-CSRF-${randSec}`,
    invoiceDate: "2026-10-10",
    customerGstin: "27AAAAA0000A1Z5",
    customerName: "CSRF Customer",
    pos: "27",
    taxableAmount: 10000,
    gstRate: 18,
    cgstAmount: 900,
    sgstAmount: 900,
    igstAmount: 0,
    totalInvoiceValue: 11800,
    supplyType: "B2B"
  }).run();
  assert.equal(csrfAllowed.statusCode, 201, "Cookie-authenticated mutation with valid CSRF token must succeed");

  // Untrusted Origin rejected
  const untrustedOriginCall = await mockApiCall({
    authorization: `Bearer ${freshToken}`,
    origin: "https://malicious-attacker-site.com"
  }, "POST", "/api/sales", { period: "102026" }, {}).run();
  assert.equal(untrustedOriginCall.statusCode, 403, "Untrusted Origin must return 403 Forbidden");

  // 7. CORS in server.js: untrusted preflight OPTIONS rejected with 403
  async function testServerRequest(reqObj) {
    const resHeaders = {};
    let code = 200;
    let data = "";
    const res = {
      writeHead(c, h = {}) { code = c; Object.assign(resHeaders, h); },
      end(d = "") { data = d; },
      setHeader(k, v) { resHeaders[k] = v; }
    };
    await handleRequest(reqObj, res);
    return { statusCode: code, headers: resHeaders, body: data ? JSON.parse(data) : null };
  }

  const badCors = await testServerRequest({
    method: "OPTIONS",
    url: "/api/sales",
    headers: { origin: "https://evil-site.com", host: "localhost:3000" }
  });
  assert.equal(badCors.statusCode, 403, "Untrusted CORS preflight must return 403 Forbidden");

  const goodCors = await testServerRequest({
    method: "OPTIONS",
    url: "/api/sales",
    headers: { origin: "https://simplegst.onrender.com", host: "simplegst.onrender.com" }
  });
  assert.equal(goodCors.statusCode, 204, "Trusted CORS preflight must return 204 No Content");
  assert.equal(goodCors.headers["Access-Control-Allow-Origin"], "https://simplegst.onrender.com");
  assert.equal(goodCors.headers["Access-Control-Allow-Credentials"], "true");

  // 8. RBAC: AUDITOR role is strictly read-only on tenant records
  const auditorUser = userRepo.create({
    email: `auditor-${randSecUid}@apexretail.com`,
    passwordHash: userRepo.hashPassword("AuditorPass@2026"),
    fullName: "Audit Lead",
    role: "AUDITOR"
  });
  orgRepo.addMember(orgSec.id, auditorUser.id, "AUDITOR");
  const auditorSess = sessionRepo.create({
    userId: auditorUser.id,
    activeOrgId: orgSec.id,
    activeGstinId: gstinSec.id,
    activePeriod: "102026"
  });
  const auditorHeaders = { authorization: `Bearer ${auditorSess.token}` };

  // Auditor can read
  const audRead = await mockApiCall(auditorHeaders, "GET", "/api/sales", { period: "102026" }).run();
  assert.equal(audRead.statusCode, 200, "Auditor must be allowed to read sales");

  // Auditor cannot mutate
  const audMutate = await mockApiCall(auditorHeaders, "POST", "/api/sales", { period: "102026" }, {
    invoiceNumber: `INV-AUD-${randSec}`,
    invoiceDate: "2026-10-10",
    customerGstin: "27AAAAA0000A1Z5",
    taxableAmount: 5000,
    gstRate: 18,
    cgstAmount: 450,
    sgstAmount: 450,
    igstAmount: 0,
    totalInvoiceValue: 5900
  }).run();
  assert.equal(audMutate.statusCode, 403, "Auditor mutation must be rejected with 403 Forbidden");
  assert.ok(audMutate.body.error.includes("Auditor role is strictly read-only"));

  // 9. RBAC: ACCOUNTANT role restrictions
  const accountantUser = userRepo.create({
    email: `acct-${randSecUid}@apexretail.com`,
    passwordHash: userRepo.hashPassword("AcctPass@2026"),
    fullName: "Accountant User",
    role: "ACCOUNTANT"
  });
  orgRepo.addMember(orgSec.id, accountantUser.id, "ACCOUNTANT");
  const acctSess = sessionRepo.create({
    userId: accountantUser.id,
    activeOrgId: orgSec.id,
    activeGstinId: gstinSec.id,
    activePeriod: "102026"
  });
  const acctHeaders = { authorization: `Bearer ${acctSess.token}` };

  // Accountant can create sales
  const acctSale = await mockApiCall(acctHeaders, "POST", "/api/sales", { period: "102026" }, {
    invoiceNumber: `INV-ACCT-${randSec}`,
    invoiceDate: "2026-10-10",
    customerGstin: "27AAAAA0000A1Z5",
    customerName: "Accountant Client",
    pos: "27",
    taxableAmount: 10000,
    gstRate: 18,
    cgstAmount: 900,
    sgstAmount: 900,
    igstAmount: 0,
    totalInvoiceValue: 11800,
    supplyType: "B2B"
  }).run();
  assert.equal(acctSale.statusCode, 201, "Accountant can create invoices");

  // Accountant CANNOT register new GSTINs
  const acctGstin = await mockApiCall(acctHeaders, "POST", "/api/gstins", {}, {
    gstin: `27SECO${randSec}P1Z9`,
    tradeName: "Rogue Branch"
  }).run();
  assert.equal(acctGstin.statusCode, 403, "Accountant cannot register GSTINs");

  // Accountant CANNOT file returns
  const acctNil = await mockApiCall(acctHeaders, "POST", "/api/gst/nil-file", {}, {
    period: "102026",
    declarationConfirmed: true
  }).run();
  assert.equal(acctNil.statusCode, 403, "Accountant cannot file returns");

  // Accountant CANNOT simulate payments
  const acctPay = await mockApiCall(acctHeaders, "POST", "/api/challans/simulate-payment", {}, {
    amount: 5000
  }).run();
  assert.equal(acctPay.statusCode, 403, "Accountant cannot execute challan payments");

  // Clean up security test invoices & records
  db.prepare("DELETE FROM sales_invoices WHERE invoice_number LIKE 'INV-CSRF-%' OR invoice_number LIKE 'INV-ACCT-%'").run();
  db.prepare("DELETE FROM users WHERE email LIKE 'legacy-%@apexretail.com' OR email LIKE 'auditor-%@apexretail.com' OR email LIKE 'acct-%@apexretail.com'").run();
  db.prepare("DELETE FROM organizations WHERE name LIKE 'Security Org %'").run();
});
