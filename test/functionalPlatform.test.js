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
