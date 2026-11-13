/**
 * Comprehensive Automated Tests for SimpleGST Reconciliation Module
 * Covers GSTR-2B parsing, deterministic matching, side-by-side comparison,
 * investigation workflow, multi-GSTIN isolation, and CSV export.
 */

import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";

import {
  db,
  gstinRepo,
  purchaseRepo,
  gstr2bRepo,
  reconciliationRepo,
  sessionRepo,
  userRepo,
  seedDevelopmentData
} from "../lib/db.js";

import { handleFunctionalApi } from "../lib/functionalApi.js";
import { parseGstr2bJson, parseGstr2bExcel, parseGstr2bCsv, parseGstr2bFile } from "../lib/gstr2bParser.js";
import { runReconciliation, normalizeInvoiceNumber } from "../lib/reconciliationEngine.js";

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
function getAuthReq(token = null) {
  const t = token || testSessionToken;
  return {
    headers: {
      authorization: `Bearer ${t}`,
      "content-type": "application/json"
    }
  };
}

test("Reconciliation Suite: Test Setup & Session Initializer", () => {
  seedDevelopmentData();
  const user = db.prepare("SELECT * FROM users LIMIT 1").get();
  const gstin = db.prepare("SELECT * FROM gst_registrations LIMIT 1").get();
  assert.ok(user, "User must exist");
  assert.ok(gstin, "GSTIN must exist");
  const orgId = gstin.org_id;

  const session = sessionRepo.create({
    userId: user.id,
    activeOrgId: orgId,
    activeGstinId: gstin.id,
    activePeriod: "102026",
    token: `tok-recon-test-${Date.now()}`
  });
  testSessionToken = session.token;
  assert.ok(testSessionToken);
});

test("GSTR-2B Parser: Parses Official GSTN Portal JSON structure", () => {
  const gstnPortalJson = {
    data: {
      docdata: {
        b2b: [
          {
            ctin: "27AABCC1234F1Z1",
            trdNm: "Cloudflare India Pvt Ltd",
            inv: [
              {
                inum: "INV-2026-089",
                dt: "12-10-2026",
                val: 93088,
                itcavl: "Y",
                items: [
                  {
                    itmdet: {
                      txval: 78888,
                      rt: 18,
                      iamt: 14200,
                      camt: 0,
                      samt: 0,
                      csamt: 0
                    }
                  }
                ]
              }
            ]
          }
        ]
      }
    }
  };

  const res = parseGstr2bJson(gstnPortalJson);
  assert.equal(res.valid, true);
  assert.equal(res.records.length, 1);
  const r = res.records[0];
  assert.equal(r.supplierGstin, "27AABCC1234F1Z1");
  assert.equal(r.supplierName, "Cloudflare India Pvt Ltd");
  assert.equal(r.invoiceNumber, "INV-2026-089");
  assert.equal(r.invoiceDate, "2026-10-12");
  assert.equal(r.taxableValue, 78888);
  assert.equal(r.igst, 14200);
  assert.equal(r.totalTax, 14200);
  assert.equal(r.itcAvailable, "Y");
});

test("GSTR-2B Parser: Parses GSTN Excel Sheet (.xlsx) with standard columns", () => {
  const wb = XLSX.utils.book_new();
  const wsData = [
    ["GSTIN of Supplier", "Trade/Legal Name", "Invoice number", "Invoice Date", "Invoice Value", "Place of supply", "Rate", "Taxable Value (₹)", "Integrated Tax (₹)", "Central Tax (₹)", "State/UT Tax (₹)", "Cess (₹)", "ITC Availability"],
    ["27AAACR1234D1Z2", "Reliance Retail Digital Ltd", "PUR-OCT-039", "15/10/2026", "53100", "27-Maharashtra", 18, 45000, 0, 4050, 4050, 0, "Y"],
    ["27AABCZ1122D1Z1", "Zenith Logistics Hub", "ZEN/24/991", "18/10/2026", "141600", "27-Maharashtra", 18, 120000, 0, 10800, 10800, 0, "Y"]
  ];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  XLSX.utils.book_append_sheet(wb, ws, "B2B");
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  const res = parseGstr2bExcel(buffer);
  assert.equal(res.valid, true);
  assert.equal(res.records.length, 2);
  assert.equal(res.records[0].supplierGstin, "27AAACR1234D1Z2");
  assert.equal(res.records[0].invoiceNumber, "PUR-OCT-039");
  assert.equal(res.records[0].taxableValue, 45000);
  assert.equal(res.records[0].cgst, 4050);
  assert.equal(res.records[0].sgst, 4050);
  assert.equal(res.records[0].totalTax, 8100);

  assert.equal(res.records[1].supplierGstin, "27AABCZ1122D1Z1");
  assert.equal(res.records[1].taxableValue, 120000);
  assert.equal(res.records[1].totalTax, 21600);
});

test("GSTR-2B Parser: Parses standard CSV content", () => {
  const csv = `GSTIN of Supplier,Trade/Legal Name,Invoice number,Invoice Date,Taxable Value (₹),Integrated Tax (₹),Central Tax (₹),State/UT Tax (₹),Cess (₹),ITC Availability
27AABCO5544K1Z8,Apex Office Supplies,AOS-4412,22-10-2026,28000,0,2520,2520,0,Y
`;
  const res = parseGstr2bCsv(csv);
  assert.equal(res.valid, true);
  assert.equal(res.records.length, 1);
  assert.equal(res.records[0].invoiceNumber, "AOS-4412");
  assert.equal(res.records[0].taxableValue, 28000);
  assert.equal(res.records[0].totalTax, 5040);
});

test("GSTR-2B Parser: Rejects corrupted or empty files gracefully", () => {
  const resEmpty = parseGstr2bFile({ filename: "bad.json", text: "INVALID JSON {[[" });
  assert.equal(resEmpty.valid, false);
  assert.ok(resEmpty.error.includes("Invalid JSON"));

  const resEmptyCsv = parseGstr2bCsv("");
  assert.equal(resEmptyCsv.valid, false);
});

test("Reconciliation Engine: Correctly classifies Exact Match, Partial Mismatch, Missing in 2B, Missing in Books & Blocked 17(5)", () => {
  const purchases = [
    // 1. Exact Match
    {
      id: "p-match",
      supplier_gstin: "27AABCC1234F1Z1",
      supplier_name: "Cloudflare India",
      invoice_number: "INV-2026-089",
      invoice_date: "2026-10-12",
      taxable_amount: 78888,
      igst: 14200,
      cgst: 0,
      sgst: 0,
      total_tax: 14200,
      itc_eligibility: "ELIGIBLE"
    },
    // 2. Partial Match (Value variance)
    {
      id: "p-mismatch",
      supplier_gstin: "27AABCZ1122D1Z1",
      supplier_name: "Zenith Logistics",
      invoice_number: "ZEN/24/991",
      invoice_date: "2026-10-18",
      taxable_amount: 124000,
      igst: 0,
      cgst: 11160,
      sgst: 11160,
      total_tax: 22320,
      itc_eligibility: "ELIGIBLE"
    },
    // 3. Missing in GSTR-2B (At risk)
    {
      id: "p-missing-2b",
      supplier_gstin: "27AABCO5544K1Z8",
      supplier_name: "Apex Office Supplies",
      invoice_number: "AOS-4412",
      invoice_date: "2026-10-22",
      taxable_amount: 28000,
      igst: 0,
      cgst: 2520,
      sgst: 2520,
      total_tax: 5040,
      itc_eligibility: "ELIGIBLE"
    },
    // 4. Ineligible Blocked u/s 17(5)
    {
      id: "p-blocked",
      supplier_gstin: "27AAACR1234D1Z2",
      supplier_name: "Reliance Retail Digital",
      invoice_number: "PUR-OCT-039",
      invoice_date: "2026-10-15",
      taxable_amount: 45000,
      igst: 0,
      cgst: 4050,
      sgst: 4050,
      total_tax: 8100,
      itc_eligibility: "INELIGIBLE_17_5",
      blocked_reason: "Motor Vehicle insurance"
    }
  ];

  const gstr2b = [
    // 1. Matches p-match
    {
      id: "g-match",
      supplier_gstin: "27AABCC1234F1Z1",
      supplier_name: "Cloudflare India",
      invoice_number: "INV-2026-089",
      invoice_date: "2026-10-12",
      taxable_value: 78888,
      igst: 14200,
      cgst: 0,
      sgst: 0,
      total_tax: 14200
    },
    // 2. Matches p-mismatch with variance
    {
      id: "g-mismatch",
      supplier_gstin: "27AABCZ1122D1Z1",
      supplier_name: "Zenith Logistics",
      invoice_number: "ZEN/24/991",
      invoice_date: "2026-10-18",
      taxable_value: 120000,
      igst: 0,
      cgst: 10800,
      sgst: 10800,
      total_tax: 21600
    },
    // 3. Present in 2B only (Missing in Books)
    {
      id: "g-unclaimed",
      supplier_gstin: "27AABCA4411C1ZX",
      supplier_name: "Amazon Seller Services",
      invoice_number: "AMZ-IN-8891",
      invoice_date: "2026-10-25",
      taxable_value: 11666,
      igst: 2100,
      cgst: 0,
      sgst: 0,
      total_tax: 2100
    }
  ];

  const result = runReconciliation({
    gstinId: "gstin-test-01",
    period: "102026",
    purchases,
    gstr2bEntries: gstr2b
  });

  const s = result.summary;
  assert.equal(s.totalBooksPurchases, 4);
  assert.equal(s.total2bInvoices, 3);

  // Exact Match verification
  assert.equal(s.matched.count, 1);
  assert.equal(s.matched.tax, 14200);

  // Mismatch verification (Variance = 22320 - 21600 = 720)
  assert.equal(s.mismatch.count, 1);
  assert.equal(s.mismatch.varianceAmount, 720);

  // Missing in 2B verification
  assert.equal(s.missingIn2b.count, 1);
  assert.equal(s.missingIn2b.tax, 5040);

  // Blocked 17(5) verification
  assert.equal(s.blockedSec17_5.count, 1);
  assert.equal(s.blockedSec17_5.tax, 8100);

  // Missing in Books verification
  assert.equal(s.missingInBooks.count, 1);
  assert.equal(s.missingInBooks.tax, 2100);

  // Eligible Net ITC (only exact matched is clean)
  assert.equal(s.eligibleNetItc, 14200);
  // At-Risk ITC = 5040 (unfiled) + 720 (variance) = 5760
  assert.equal(s.atRiskItc, 5760);
  // Unclaimed ITC
  assert.equal(s.unclaimedItc, 2100);

  // Items length = 5
  assert.equal(result.items.length, 5);

  // Verify Side-by-Side Diffs JSON
  const mismatchItem = result.items.find(i => i.match_status === "PARTIAL_MATCH");
  assert.ok(mismatchItem);
  const diffs = JSON.parse(mismatchItem.field_diffs_json);
  assert.equal(diffs.taxableAmount.diff, 4000);
  assert.equal(diffs.totalTax.diff, 720);

  // Verify Advisory Banner
  assert.ok(result.advisory);
  assert.equal(result.advisory.level, "RISK");
  assert.ok(result.advisory.message.includes("Section 16(2)(aa)"));
});

test("Reconciliation Backend APIs: End-to-end import, matching run, action update & CSV export", async () => {
  const session = db.prepare("SELECT * FROM sessions WHERE token = ?").get(testSessionToken);
  const gstinId = session.active_gstin_id;
  const orgId = session.active_org_id;
  const period = "102026";

  // Clean test tables
  db.prepare("DELETE FROM reconciliation_results WHERE gstin_id = ? AND period = ?").run(gstinId, period);
  db.prepare("DELETE FROM purchase_invoices WHERE gstin_id = ? AND period = ?").run(gstinId, period);
  db.prepare("DELETE FROM gstr2b_entries WHERE gstin_id = ? AND period = ?").run(gstinId, period);

  // 1. Create Purchase Invoices in Books
  const pur1 = purchaseRepo.create({
    orgId,
    gstinId,
    period,
    invoiceNumber: "PUR-E2E-001",
    invoiceDate: "2026-10-10",
    supplierName: "Tata Telecommunications Ltd",
    supplierGstin: "27AAACT1234F1Z9",
    pos: "27",
    isInterstate: false,
    taxableAmount: 50000,
    gstRate: 18,
    cgst: 4500,
    sgst: 4500,
    igst: 0,
    totalTax: 9000,
    totalAmount: 59000,
    itcEligibility: "ELIGIBLE"
  });

  const pur2 = purchaseRepo.create({
    orgId,
    gstinId,
    period,
    invoiceNumber: "PUR-E2E-002",
    invoiceDate: "2026-10-14",
    supplierName: "Wipro Tech Supplies",
    supplierGstin: "27AAACW5566G1Z4",
    pos: "27",
    isInterstate: false,
    taxableAmount: 20000,
    gstRate: 18,
    cgst: 1800,
    sgst: 1800,
    igst: 0,
    totalTax: 3600,
    totalAmount: 23600,
    itcEligibility: "ELIGIBLE"
  });

  // 2. Test POST /api/reconciliation/import-2b with JSON data
  const importRes = createMockRes();
  const sampleGstr2bJson = {
    data: {
      docdata: {
        b2b: [
          {
            ctin: "27AAACT1234F1Z9",
            trdNm: "Tata Telecommunications Ltd",
            inv: [
              {
                inum: "PUR-E2E-001",
                dt: "10-10-2026",
                val: 59000,
                itcavl: "Y",
                items: [
                  { itmdet: { txval: 50000, cgst: 4500, sgst: 4500, igst: 0, csamt: 0 } }
                ]
              }
            ]
          }
        ]
      }
    }
  };

  await handleFunctionalApi(getAuthReq(), importRes, "/api/reconciliation/import-2b", "POST", {}, {
    period,
    filename: "tata_telecom_2b.json",
    rawJson: JSON.stringify(sampleGstr2bJson)
  });

  assert.equal(importRes.statusCode, 201);
  const importData = JSON.parse(importRes.body);
  assert.equal(importData.success, true);
  assert.equal(importData.importedCount, 1);
  assert.equal(importData.summary.matched.count, 1);
  assert.equal(importData.summary.missingIn2b.count, 1); // PUR-E2E-002 is not in 2B

  // 3. Test GET /api/reconciliation/summary
  const summaryRes = createMockRes();
  await handleFunctionalApi(getAuthReq(), summaryRes, "/api/reconciliation/summary", "GET", { period }, {});
  assert.equal(summaryRes.statusCode, 200);
  const sumData = JSON.parse(summaryRes.body);
  assert.equal(sumData.summary.totalBooksPurchases, 2);
  assert.equal(sumData.summary.total2bInvoices, 1);
  assert.equal(sumData.summary.matched.count, 1);
  assert.equal(sumData.summary.missingIn2b.count, 1);

  // 4. Test GET /api/reconciliation/items
  const itemsRes = createMockRes();
  await handleFunctionalApi(getAuthReq(), itemsRes, "/api/reconciliation/items", "GET", { period, filter: "ALL" }, {});
  assert.equal(itemsRes.statusCode, 200);
  const itemsData = JSON.parse(itemsRes.body);
  assert.equal(itemsData.items.length, 2);

  const missingItem = itemsData.items.find(i => i.match_status === "MISSING_IN_2B");
  assert.ok(missingItem);
  assert.equal(missingItem.invoice_number, "PUR-E2E-002");
  assert.equal(missingItem.action, "HOLD");

  // 5. Test POST /api/reconciliation/action to investigate and update status
  const actionRes = createMockRes();
  await handleFunctionalApi(getAuthReq(), actionRes, "/api/reconciliation/action", "POST", {}, {
    id: missingItem.id,
    action: "CORRECT",
    investigationNotes: "Vendor notified via WhatsApp. Promised GSTR-1 amendment in Nov 2026."
  });

  assert.equal(actionRes.statusCode, 200);
  const actionData = JSON.parse(actionRes.body);
  assert.equal(actionData.success, true);
  assert.equal(actionData.item.action, "CORRECT");
  assert.ok(actionData.item.investigation_notes.includes("Vendor notified"));

  // 6. Test GET /api/reports/reconciliation/csv
  const csvRes = createMockRes();
  await handleFunctionalApi(getAuthReq(), csvRes, "/api/reports/reconciliation/csv", "GET", { period }, {});
  assert.equal(csvRes.statusCode, 200);
  assert.ok(csvRes.headers["Content-Type"].includes("text/csv"));
  assert.ok(csvRes.body.includes("Match Status,Supplier GSTIN,Supplier Name,Invoice Number"));
  assert.ok(csvRes.body.includes("PUR-E2E-001"));
  assert.ok(csvRes.body.includes("PUR-E2E-002"));
  assert.ok(csvRes.body.includes("Vendor notified via WhatsApp"));

  // 7. Multi-GSTIN Data Isolation Check
  const otherGstin = db.prepare("SELECT * FROM gst_registrations WHERE id != ? LIMIT 1").get(gstinId);
  const dbUser = db.prepare("SELECT * FROM users LIMIT 1").get();
  if (otherGstin && dbUser) {
    const otherSess = sessionRepo.create({
      userId: dbUser.id,
      activeOrgId: orgId,
      activeGstinId: otherGstin.id,
      activePeriod: period,
      token: `tok-other-gstin-${Date.now()}`
    });

    const otherItemsRes = createMockRes();
    await handleFunctionalApi(getAuthReq(otherSess.token), otherItemsRes, "/api/reconciliation/items", "GET", { period }, {});
    assert.equal(otherItemsRes.statusCode, 200);
    const otherItems = JSON.parse(otherItemsRes.body);
    // Must NOT contain items from gstinId
    const leakedItem = otherItems.items.find(i => i.invoice_number === "PUR-E2E-001");
    assert.strictEqual(leakedItem, undefined, "Multi-GSTIN isolation failed: invoice leaked across GSTINs");
  }

  // Cleanup
  db.prepare("DELETE FROM reconciliation_results WHERE gstin_id = ? AND period = ?").run(gstinId, period);
  purchaseRepo.delete(pur1.id);
  purchaseRepo.delete(pur2.id);
  db.prepare("DELETE FROM gstr2b_entries WHERE gstin_id = ? AND period = ?").run(gstinId, period);
});
