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
