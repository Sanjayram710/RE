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
  seedDevelopmentData
} from "../lib/db.js";

import { handleFunctionalApi } from "../lib/functionalApi.js";

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

let testSessionToken = null;
function getAuthReq(extraHeaders = {}) {
  if (!testSessionToken) {
    seedDevelopmentData();
    const existing = db.prepare("SELECT * FROM sessions WHERE token = ?").get("tok-test-persistence-token");
    if (existing) {
      if (existing.is_revoked) {
        db.prepare("UPDATE sessions SET is_revoked = 0, revoked_at = NULL WHERE id = ?").run(existing.id);
      }
      testSessionToken = existing.token;
    } else {
      const user = userRepo.findByEmail("rajesh.sharma@apexretail.com") || db.prepare("SELECT * FROM users LIMIT 1").get();
      const org = db.prepare("SELECT * FROM organizations LIMIT 1").get();
      const gstin = db.prepare("SELECT * FROM gst_registrations WHERE org_id = ? LIMIT 1").get(org.id);
      const session = sessionRepo.create({
        userId: user.id,
        activeOrgId: org.id,
        activeGstinId: gstin.id,
        activePeriod: "102026",
        token: "tok-test-persistence-token"
      });
      testSessionToken = session.token;
    }
  }
  return {
    headers: {
      authorization: `Bearer ${testSessionToken}`,
      ...extraHeaders
    }
  };
}

test("Invoice Persistence: Sales invoice creation persistently stores in SQLite", async () => {
  seedDevelopmentData();
  const testInvNo = `INV-PERSIST-${Date.now().toString().slice(-6)}`;
  const res = createMockRes();

  await handleFunctionalApi(getAuthReq(), res, "/api/sales", "POST", { period: "102026" }, {
    invoiceNumber: testInvNo,
    invoiceDate: "2026-10-20",
    customerName: "Persistent Tech Solutions Pvt Ltd",
    customerGstin: "27BBBCC0981D1Z2",
    pos: "27",
    taxableAmount: 150000,
    gstRate: 18,
    supplyType: "B2B"
  });

  assert.equal(res.statusCode, 201, "Sales invoice must return 201 Created");
  const data = JSON.parse(res.body);
  assert.equal(data.success, true);
  assert.equal(data.invoice.invoice_number, testInvNo);
  assert.equal(data.invoice.taxable_amount, 150000);
  assert.equal(data.invoice.cgst, 13500);
  assert.equal(data.invoice.sgst, 13500);
  assert.equal(data.invoice.total_amount, 177000);

  // Directly verify SQLite row in database
  const dbRow = db.prepare("SELECT * FROM sales_invoices WHERE invoice_number = ?").get(testInvNo);
  assert.ok(dbRow, "Invoice must exist as a real row in SQLite");
  assert.equal(dbRow.taxable_amount, 150000);
  assert.equal(dbRow.customer_name, "Persistent Tech Solutions Pvt Ltd");
});

test("Invoice Persistence: Duplicate sales invoice numbers are rejected", async () => {
  const testInvNo = `INV-DUP-${Date.now().toString().slice(-6)}`;
  const res1 = createMockRes();

  await handleFunctionalApi(getAuthReq(), res1, "/api/sales", "POST", { period: "102026" }, {
    invoiceNumber: testInvNo,
    invoiceDate: "2026-10-21",
    customerName: "First Buyer",
    customerGstin: "27BBBCC0981D1Z2",
    pos: "27",
    taxableAmount: 50000,
    gstRate: 18
  });
  assert.equal(res1.statusCode, 201);

  // Attempt duplicate
  const res2 = createMockRes();
  await handleFunctionalApi(getAuthReq(), res2, "/api/sales", "POST", { period: "102026" }, {
    invoiceNumber: testInvNo,
    invoiceDate: "2026-10-22",
    customerName: "Second Buyer",
    taxableAmount: 60000,
    gstRate: 18
  });
  assert.equal(res2.statusCode, 400, "Duplicate sales invoice must return 400");
  const data = JSON.parse(res2.body);
  assert.ok(data.error.includes("UNIQUE") || data.error.includes("Failed to create"), "Must indicate uniqueness constraint");
});

test("Invoice Persistence: Sales creation validates required fields", async () => {
  const res = createMockRes();
  await handleFunctionalApi(getAuthReq(), res, "/api/sales", "POST", { period: "102026" }, {
    invoiceNumber: "", // Missing invoiceNumber
    invoiceDate: "2026-10-21",
    customerName: "Buyer",
    taxableAmount: 50000
  });
  assert.equal(res.statusCode, 400, "Missing fields must return 400");
});

test("Invoice Persistence: Purchase bill creation persistently stores in SQLite", async () => {
  const testBillNo = `BILL-PERSIST-${Date.now().toString().slice(-6)}`;
  const res = createMockRes();

  await handleFunctionalApi(getAuthReq(), res, "/api/purchases", "POST", { period: "102026" }, {
    invoiceNumber: testBillNo,
    invoiceDate: "2026-10-18",
    supplierName: "Reliance Logistics & Infrastructure",
    supplierGstin: "27AAACR1234F1Z8",
    pos: "27",
    taxableAmount: 80000,
    gstRate: 18,
    itcEligibility: "ELIGIBLE",
    isRcm: false
  });

  assert.equal(res.statusCode, 201, "Purchase bill must return 201 Created");
  const data = JSON.parse(res.body);
  assert.equal(data.success, true);
  assert.equal(data.purchase.invoice_number, testBillNo);
  assert.equal(data.purchase.itc_eligibility, "ELIGIBLE");
  assert.equal(data.purchase.cgst, 7200);
  assert.equal(data.purchase.sgst, 7200);

  // Directly verify SQLite row
  const dbRow = db.prepare("SELECT * FROM purchase_invoices WHERE invoice_number = ?").get(testBillNo);
  assert.ok(dbRow, "Purchase bill must exist in SQLite");
  assert.equal(dbRow.supplier_name, "Reliance Logistics & Infrastructure");
  assert.equal(dbRow.taxable_amount, 80000);
});

test("Invoice Persistence: Purchase bills with INELIGIBLE ITC are correctly marked", async () => {
  const testBillNo = `BILL-INELIGIBLE-${Date.now().toString().slice(-6)}`;
  const res = createMockRes();

  await handleFunctionalApi(getAuthReq(), res, "/api/purchases", "POST", { period: "102026" }, {
    invoiceNumber: testBillNo,
    invoiceDate: "2026-10-19",
    supplierName: "Apex Corporate Club & Catering",
    supplierGstin: "27AAACC4321D1Z1",
    pos: "27",
    taxableAmount: 40000,
    gstRate: 18,
    itcEligibility: "INELIGIBLE",
    blockedReason: "Section 17(5)(b) Food, beverages & outdoor catering"
  });

  assert.equal(res.statusCode, 201);
  const data = JSON.parse(res.body);
  assert.ok(data.purchase.itc_eligibility.startsWith("INELIGIBLE"), "Must be marked as ineligible ITC");
  assert.equal(data.purchase.blocked_reason, "Section 17(5)(b) Food, beverages & outdoor catering");

  const dbRow = db.prepare("SELECT * FROM purchase_invoices WHERE invoice_number = ?").get(testBillNo);
  assert.ok(dbRow.itc_eligibility.startsWith("INELIGIBLE"), "Database row must record ineligible ITC status");
});

test("Invoice Persistence: Data persists across simulated browser refresh", async () => {
  const testInvNo = `INV-REFRESH-${Date.now().toString().slice(-6)}`;
  const createRes = createMockRes();

  await handleFunctionalApi(getAuthReq(), createRes, "/api/sales", "POST", { period: "102026" }, {
    invoiceNumber: testInvNo,
    invoiceDate: "2026-10-22",
    customerName: "Refresh Verification Corp",
    pos: "27",
    taxableAmount: 200000,
    gstRate: 18
  });
  assert.equal(createRes.statusCode, 201);

  // Simulate refresh: GET /api/sales?period=102026
  const listRes = createMockRes();
  await handleFunctionalApi(getAuthReq(), listRes, "/api/sales", "GET", { period: "102026" }, {});
  assert.equal(listRes.statusCode, 200);
  const listData = JSON.parse(listRes.body);
  const found = listData.invoices.find(inv => inv.invoice_number === testInvNo);
  assert.ok(found, "Saved sales invoice must be returned by GET /api/sales after refresh");
  assert.equal(found.taxable_amount, 200000);
});

test("Invoice Persistence: Tenant isolation prevents cross-tenant access", async () => {
  // Session active GSTIN determines tenant identity - client-supplied tenant ID is ignored
  const mhGstin = gstinRepo.findByGstin("27AAACA1234A1Z5");
  const kaGstin = gstinRepo.findByGstin("29AAACB1234F1Z5");

  // Create an invoice under Maharashtra GSTIN
  const mhInvNo = `INV-MH-${Date.now().toString().slice(-4)}`;
  const res1 = createMockRes();
  await handleFunctionalApi(getAuthReq(), res1, "/api/sales", "POST", { period: "102026" }, {
    invoiceNumber: mhInvNo,
    invoiceDate: "2026-10-15",
    customerName: "MH Customer",
    pos: "27",
    taxableAmount: 50000,
    gstRate: 18
  });
  assert.equal(res1.statusCode, 201);

  // Switch session active GSTIN to Karnataka
  const switchRes = createMockRes();
  await handleFunctionalApi(getAuthReq(), switchRes, `/api/gstins/${kaGstin.id}/activate`, "POST", {}, {});
  assert.equal(switchRes.statusCode, 200);

  // Query sales under Karnataka session - MH invoice must NOT appear
  const kaSalesRes = createMockRes();
  await handleFunctionalApi(getAuthReq(), kaSalesRes, "/api/sales", "GET", { period: "102026" }, {});
  const kaData = JSON.parse(kaSalesRes.body);
  const leakFound = kaData.invoices.find(inv => inv.invoice_number === mhInvNo);
  assert.equal(leakFound, undefined, "Karnataka session must not see Maharashtra invoices (Tenant Isolation)");

  // Restore session back to Maharashtra
  const restoreRes = createMockRes();
  await handleFunctionalApi(getAuthReq(), restoreRes, `/api/gstins/${mhGstin.id}/activate`, "POST", {}, {});
  assert.equal(restoreRes.statusCode, 200);
});

test("Invoice Persistence: Central Bills & Docs upload and OCR approval workflow", async () => {
  // 1. Upload document
  const uploadRes = createMockRes();
  await handleFunctionalApi(getAuthReq(), uploadRes, "/api/documents/upload", "POST", {}, {
    filename: "TaxInvoice_Vendor_7788.pdf",
    category: "purchase_bill",
    rawText: "Tax Invoice 7788 from Apex Logistics for Rs 45000 GSTIN 27AAACA1234A1Z5"
  });
  assert.equal(uploadRes.statusCode, 201, "Upload must succeed with 201");
  const uploadData = JSON.parse(uploadRes.body);
  assert.ok(uploadData.document && uploadData.document.id);
  assert.ok(uploadData.ocr && uploadData.ocr.id);

  // 2. Approve OCR into Purchase Register
  const approveRes = createMockRes();
  const ocrBillNo = `BILL-OCR-${Date.now().toString().slice(-4)}`;
  await handleFunctionalApi(getAuthReq(), approveRes, "/api/ocr/approve", "POST", {}, {
    documentId: uploadData.document.id,
    invoiceType: "purchase_bill",
    fields: {
      invoiceNumber: ocrBillNo,
      invoiceDate: "2026-10-18",
      partyName: "Apex Logistics & Haulage",
      gstin: "27AAACA1234A1Z5",
      taxableValue: 45000,
      totalGst: 8100,
      totalInvoiceValue: 53100
    }
  });
  assert.equal(approveRes.statusCode, 200);
  const approveData = JSON.parse(approveRes.body);
  assert.equal(approveData.success, true);

  // Verify in purchase repo
  const dbBill = db.prepare("SELECT * FROM purchase_invoices WHERE invoice_number = ?").get(ocrBillNo);
  assert.ok(dbBill, "Approved OCR purchase bill must exist in purchase register database");
  assert.equal(dbBill.taxable_amount, 45000);
});


test("Invoice Persistence & Security: Cookie session without CSRF token is rejected with 403", async () => {
  seedDevelopmentData();
  const sessionToken = "tok-csrf-test-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7);
  const csrfToken = "csrf-secret-" + Date.now();
  const user = userRepo.findByEmail("rajesh.sharma@apexretail.com");
  const org = db.prepare("SELECT * FROM organizations LIMIT 1").get();
  const gstin = db.prepare("SELECT * FROM gst_registrations WHERE org_id = ? LIMIT 1").get(org.id);
  
  sessionRepo.create({
    userId: user.id,
    token: sessionToken,
    csrfToken: csrfToken,
    activeOrgId: org.id,
    activeGstinId: gstin.id,
    activePeriod: "102026"
  });

  // 1. Missing CSRF header with cookie auth -> 403 Forbidden
  const cookieReqNoCsrf = {
    headers: {
      cookie: `simplegst_session=${sessionToken}`
    }
  };
  const res1 = createMockRes();
  await handleFunctionalApi(cookieReqNoCsrf, res1, "/api/sales", "POST", { period: "102026" }, {
    invoiceNumber: `INV-CSRF-NO-${Date.now().toString().slice(-4)}`,
    invoiceDate: "2026-10-20",
    customerName: "CSRF Test Customer",
    pos: "27",
    taxableAmount: 10000,
    gstRate: 18
  });
  assert.equal(res1.statusCode, 403, "Cookie session state-changing request without CSRF token must return 403");
  const errBody = JSON.parse(res1.body);
  assert.ok(errBody.error.includes("CSRF"));

  // 2. Valid CSRF header with cookie auth -> 201 Created
  const cookieReqWithCsrf = {
    headers: {
      cookie: `simplegst_session=${sessionToken}`,
      "x-csrf-token": csrfToken
    }
  };
  const res2 = createMockRes();
  await handleFunctionalApi(cookieReqWithCsrf, res2, "/api/sales", "POST", { period: "102026" }, {
    invoiceNumber: `INV-CSRF-OK-${Date.now().toString().slice(-4)}`,
    invoiceDate: "2026-10-20",
    customerName: "CSRF Test Customer",
    pos: "27",
    taxableAmount: 10000,
    gstRate: 18
  });
  assert.equal(res2.statusCode, 201, "Cookie session with valid X-CSRF-Token must succeed with 201");
});

test("Place of Supply: Explicit POS determines IGST vs CGST+SGST independently of customer GSTIN", async () => {
  // Case A: Customer has Gujarat GSTIN (24), but goods are supplied within Maharashtra (POS = 27)
  // Under Section 10(1)(c) of IGST Act: Intra-State -> CGST + SGST
  const invNoIntra = `INV-POS-INTRA-${Date.now().toString().slice(-4)}`;
  const resA = createMockRes();
  await handleFunctionalApi(getAuthReq(), resA, "/api/sales", "POST", { period: "102026" }, {
    invoiceNumber: invNoIntra,
    invoiceDate: "2026-10-22",
    customerName: "Gujarat Buyer - Mumbai Over the Counter",
    customerGstin: "24AAACG1234F1Z8", // 24-Gujarat
    pos: "27", // Explicit Place of Supply is 27-Maharashtra!
    taxableAmount: 100000,
    gstRate: 18
  });
  assert.equal(resA.statusCode, 201);
  const dataA = JSON.parse(resA.body);
  assert.equal(dataA.invoice.is_interstate, 0, "POS = 27 for seller in 27 must be Intra-State");
  assert.equal(dataA.invoice.cgst, 9000);
  assert.equal(dataA.invoice.sgst, 9000);
  assert.equal(dataA.invoice.igst, 0);

  // Case B: Customer has Maharashtra GSTIN (27), but delivery/POS is shipped to Karnataka (POS = 29)
  // Inter-State -> IGST
  const invNoInter = `INV-POS-INTER-${Date.now().toString().slice(-4)}`;
  const resB = createMockRes();
  await handleFunctionalApi(getAuthReq(), resB, "/api/sales", "POST", { period: "102026" }, {
    invoiceNumber: invNoInter,
    invoiceDate: "2026-10-22",
    customerName: "MH Buyer - Shipped to Bangalore Warehouse",
    customerGstin: "27AAACA1234A1Z5", // 27-Maharashtra
    pos: "29", // Explicit Place of Supply is 29-Karnataka!
    taxableAmount: 100000,
    gstRate: 18
  });
  assert.equal(resB.statusCode, 201);
  const dataB = JSON.parse(resB.body);
  assert.equal(dataB.invoice.is_interstate, 1, "POS = 29 for seller in 27 must be Inter-State");
  assert.equal(dataB.invoice.igst, 18000);
  assert.equal(dataB.invoice.cgst, 0);
  assert.equal(dataB.invoice.sgst, 0);
});

test("Purchase Workflow: ITC Eligibility flows into dashboard and reconciliation summaries", async () => {
  const eligibleBillNo = `BILL-EL-${Date.now().toString().slice(-4)}`;
  const ineligibleBillNo = `BILL-INEL-${Date.now().toString().slice(-4)}`;

  // 1. Create Eligible purchase bill
  const resEl = createMockRes();
  await handleFunctionalApi(getAuthReq(), resEl, "/api/purchases", "POST", { period: "102026" }, {
    invoiceNumber: eligibleBillNo,
    invoiceDate: "2026-10-15",
    supplierName: "Apex Software & IT Solutions",
    supplierGstin: "27AAACS1122D1Z3",
    pos: "27",
    taxableAmount: 100000,
    gstRate: 18,
    itcEligibility: "ELIGIBLE"
  });
  assert.equal(resEl.statusCode, 201);

  // 2. Create Ineligible purchase bill (blocked u/s 17(5))
  const resInel = createMockRes();
  await handleFunctionalApi(getAuthReq(), resInel, "/api/purchases", "POST", { period: "102026" }, {
    invoiceNumber: ineligibleBillNo,
    invoiceDate: "2026-10-15",
    supplierName: "Grand Palace Hotel & Banquets",
    supplierGstin: "27AAACG9988C1Z4",
    pos: "27",
    taxableAmount: 50000,
    gstRate: 18,
    itcEligibility: "INELIGIBLE_17_5",
    blockedReason: "Section 17(5)(b) Outdoor catering & hospitality"
  });
  assert.equal(resInel.statusCode, 201);

  // 3. Check dashboard summary
  const dashRes = createMockRes();
  await handleFunctionalApi(getAuthReq(), dashRes, "/api/dashboard/summary", "GET", { period: "102026" }, {});
  assert.equal(dashRes.statusCode, 200);
  const dashData = JSON.parse(dashRes.body);
  assert.ok(dashData.metrics.totalEligibleItc > 0, "Dashboard must calculate eligible ITC");
  assert.ok(dashData.metrics.blockedItc >= 9000, "Blocked ITC must include the ineligible purchase bill tax (₹9,000)");
});

test("UI Suite Navigation: submitNewPurchase, submitNewInvoice, and saveExtractedInvoice transition to purchase and sales registers", () => {
  const appJs = fs.readFileSync(path.resolve("app.js"), "utf8");

  // Validate submitNewPurchase triggers switchSuite('purchase')
  assert.match(
    appJs,
    /function submitNewPurchase[\s\S]*?switchSuite\(['"]purchase['"]\)/,
    "submitNewPurchase must invoke switchSuite('purchase') upon saving"
  );

  // Validate submitNewInvoice triggers switchSuite('sales')
  assert.match(
    appJs,
    /function submitNewInvoice[\s\S]*?switchSuite\(['"]sales['"]\)/,
    "submitNewInvoice must invoke switchSuite('sales') upon saving"
  );

  // Validate saveExtractedInvoice triggers switchSuite('sales') and switchSuite('purchase')
  assert.match(
    appJs,
    /function saveExtractedInvoice[\s\S]*?switchSuite\(['"]sales['"]\)[\s\S]*?switchSuite\(['"]purchase['"]\)/,
    "saveExtractedInvoice must invoke switchSuite for both sales and purchase types"
  );
});
