import test from "node:test";
import assert from "node:assert/strict";

import { computeRule88aSetoff } from "../lib/rule88aEngine.js";
import { aggregateRcmBatch, processRcmInwardSupply } from "../lib/rcmEngine.js";
import { auditPurchaseRegister180Days, analyzeInvoice180Days } from "../lib/supplier180DayTracker.js";
import { classifySalesRegisterForGstr1 } from "../lib/gstr1StatutoryClassifier.js";
import { simulateReturnFiling, resetFilingRegistry } from "../lib/gstrReturnLifecycleEngine.js";
import { createEmptyCashLedger, generatePmt06Challan, executePmt09Transfer } from "../lib/electronicLedgerEngine.js";
import { getTenantClients, getTenantClient, getPracticeDashboardSummary, getPracticeAuditLogs, logPracticeAction } from "../lib/caPracticeManager.js";

// ============================================================================
// 1. RULE 88A SET-OFF HARDENING & INPUT VALIDATION
// ============================================================================

test("Statutory Hardening: Rule 88A rejects negative financial values", () => {
  assert.throws(() => {
    computeRule88aSetoff(
      { igst: -100, cgst: 500, sgst: 500, cess: 0 },
      { igst: 1000, cgst: 200, sgst: 200, cess: 0 }
    );
  }, /cannot be negative/);

  assert.throws(() => {
    computeRule88aSetoff(
      { igst: 1000, cgst: 500, sgst: 500, cess: 0 },
      { igst: 1000, cgst: -200, sgst: 200, cess: 0 }
    );
  }, /cannot be negative/);
});

test("Statutory Hardening: Rule 88A handles multiple GST rates and multi-liability combinations", () => {
  // Scenario: IGST ITC of ₹15,000, CGST liability ₹10,000, SGST liability ₹10,000, IGST liability ₹0
  // Under Sec 49A, IGST ITC must be completely exhausted (split equally or as needed)
  const res = computeRule88aSetoff(
    { igst: 0, cgst: 10000, sgst: 10000, cess: 0 },
    { igst: 15000, cgst: 3000, sgst: 3000, cess: 0 }
  );

  assert.equal(res.itcCarryForward.igst, 0, "IGST ITC must be fully exhausted");
  const totalIgstUsedForCgstSgst = res.utilizationMatrix.igstCreditUtilized.towardsCgst + res.utilizationMatrix.igstCreditUtilized.towardsSgst;
  assert.equal(totalIgstUsedForCgstSgst, 15000);
  assert.equal(res.netCashPayable.igst, 0);
  // CGST cash: 10000 - 7500 (IGST) - 2500 (CGST ITC) = 0
  // SGST cash: 10000 - 7500 (IGST) - 2500 (SGST ITC) = 0
  assert.equal(res.netCashPayable.cgst, 0);
  assert.equal(res.netCashPayable.sgst, 0);
  assert.equal(res.itcCarryForward.cgst, 500);
  assert.equal(res.itcCarryForward.sgst, 500);
});

test("Statutory Hardening: Rule 88A maintains Compensation Cess isolation", () => {
  const res = computeRule88aSetoff(
    { igst: 5000, cgst: 2000, sgst: 2000, cess: 15000 },
    { igst: 10000, cgst: 0, sgst: 0, cess: 5000 }
  );

  // Cess liability can only be paid by Cess ITC
  assert.equal(res.utilizationMatrix.cessCreditUtilized.towardsCess, 5000);
  assert.equal(res.netCashPayable.cess, 10000, "Remaining cess must be paid in cash");
  assert.equal(res.itcCarryForward.cess, 0);
});

// ============================================================================
// 2. RCM CASH-ONLY SETTLEMENT & SECTION 17(5) BLOCKED CREDITS
// ============================================================================

test("Statutory Hardening: RCM rejects negative amounts and flags batch duplicates", () => {
  assert.throws(() => {
    processRcmInwardSupply({ invoiceNumber: "RCM-01", isRcm: true, supplierType: "UNREGISTERED", taxableValue: -500, gstRate: 18, natureOfSupply: "GOODS_TRANSPORT_AGENCY" });
  }, /cannot be negative/);

  // Batch duplicate check
  const res = aggregateRcmBatch([
    { invoiceNumber: "DUP-RCM-01", isRcm: true, supplierGstin: "URP", supplierType: "UNREGISTERED", taxableValue: 1000, gstRate: 5, natureOfSupply: "GOODS_TRANSPORT_AGENCY" },
    { invoiceNumber: "DUP-RCM-01", isRcm: true, supplierGstin: "URP", supplierType: "UNREGISTERED", taxableValue: 2000, gstRate: 18, natureOfSupply: "LEGAL_SERVICES" }
  ]);
  assert.equal(res.duplicatesCount, 1);
});

test("Statutory Hardening: RCM with Section 17(5) blocked credit enables cash tax but disables ITC", () => {
  const res = aggregateRcmBatch([
    {
      invoiceNumber: "RCM-GTA-01",
      isRcm: true,
      supplierName: "Kerala Roadlines",
      supplierGstin: "URP",
      natureOfSupply: "GOODS_TRANSPORT_AGENCY",
      taxableValue: 40000,
      gstRate: 5,
      isInterState: false,
      itcEligibility: "ELIGIBLE"
    },
    {
      invoiceNumber: "RCM-CAB-02",
      isRcm: true,
      supplierName: "Airport Cabs Unregistered",
      supplierGstin: "URP",
      natureOfSupply: "RENT_A_CAB",
      taxableValue: 10000,
      gstRate: 5,
      isInterState: false,
      itcEligibility: "BLOCKED_17_5_B" // Passenger motor vehicle rent blocked under 17(5)(b)
    }
  ]);

  // Total cash liability: 40000 * 5% (2000) + 10000 * 5% (500) = 2500
  assert.equal(res.gstr3bTable3_1_d.totalTax, 2500);
  assert.equal(res.gstr3bTable4_A_3.eligibleTotal, 2000);
  assert.equal(res.gstr3bTable4_A_3.blockedTotal, 500);
});

// ============================================================================
// 3. RULE 37 180-DAY TRACKER: PARTIAL PAYMENTS, OVERPAYMENTS & INVALID DATES
// ============================================================================

test("Statutory Hardening: 180-day aging handles partial and full payments accurately", () => {
  const invoices = [
    {
      invoiceNumber: "INV-PAID-01",
      invoiceDate: "2026-01-01",
      supplierName: "Supplier Alpha",
      taxableValue: 100000,
      itcClaimed: 18000,
      invoiceValue: 118000,
      paidAmount: 118000 // 100% paid
    },
    {
      invoiceNumber: "INV-PART-02",
      invoiceDate: "2026-01-01",
      supplierName: "Supplier Beta",
      taxableValue: 100000,
      itcClaimed: 18000,
      invoiceValue: 118000,
      paidAmount: 59000 // 50% paid
    },
    {
      invoiceNumber: "INV-UNPAID-03",
      invoiceDate: "2026-01-01",
      supplierName: "Supplier Gamma",
      taxableValue: 100000,
      itcClaimed: 18000,
      invoiceValue: 118000,
      paidAmount: 0 // 0% paid
    }
  ];

  const res = auditPurchaseRegister180Days(invoices, "2026-10-20"); // > 280 days elapsed

  // Fully paid invoice has 0 reversal and is in fullyPaid bucket
  assert.equal(res.summary.fullyPaidCount, 1);
  const inv1 = res.buckets.fullyPaid[0];
  assert.equal(inv1.financials.proportionateItcToReverse, 0);

  // 50% paid invoice reverses exactly 50% of ITC: ₹9,000 and is in overdue180Plus bucket
  const inv2 = res.buckets.overdue180Plus.find(i => i.invoiceNumber === "INV-PART-02");
  assert.ok(inv2, "Partial payment invoice must be in overdue180Plus");
  assert.equal(inv2.financials.proportionateItcToReverse, 9000);
  assert.ok(inv2.interest.interestPayable > 0, "Interest must accrue on unpaid ITC beyond 180 days");

  // 0% paid invoice reverses 100% of ITC: ₹18,000
  const inv3 = res.buckets.overdue180Plus.find(i => i.invoiceNumber === "INV-UNPAID-03");
  assert.ok(inv3, "Unpaid invoice must be in overdue180Plus");
  assert.equal(inv3.financials.proportionateItcToReverse, 18000);
  assert.ok(Math.abs(inv3.interest.interestPayable - inv2.interest.interestPayable * 2) <= 0.05);
});

test("Statutory Hardening: 180-day aging rejects invalid and future invoice dates", () => {
  const invBad = analyzeInvoice180Days({
    invoiceNumber: "BAD-DATE", invoiceDate: "not-a-date", totalInvoiceValue: 10000, itcClaimed: 1800
  }, "2026-10-20");
  assert.ok(invBad.dateError);
  assert.equal(invBad.daysElapsed, 0);

  const invFuture = analyzeInvoice180Days({
    invoiceNumber: "FUTURE-DATE", invoiceDate: "2026-12-31", totalInvoiceValue: 10000, itcClaimed: 1800
  }, "2026-10-20");
  assert.equal(invFuture.status.agingBucket, "FUTURE_DATED");
  assert.equal(invFuture.daysElapsed, 0);
});

// ============================================================================
// 4. GSTR-1 CLASSIFIER: EXPORTS (WPAY/WOPAY), SEZ, CREDIT/DEBIT NOTES
// ============================================================================

test("Statutory Hardening: GSTR-1 classifies Exports with vs without payment & SEZ supplies", () => {
  const supplies = [
    {
      invoiceNumber: "EXP-WPAY-001",
      invoiceType: "EXPORT",
      exportType: "WPAY", // Export with payment of IGST
      customerGstin: "URP",
      pos: "96-Foreign Country",
      taxableValue: 500000,
      igstRate: 18,
      igst: 90000
    },
    {
      invoiceNumber: "EXP-LUT-002",
      invoiceType: "EXPORT",
      exportType: "WOPAY", // Export without payment under LUT
      customerGstin: "URP",
      pos: "96-Foreign Country",
      taxableValue: 300000,
      igstRate: 0,
      igst: 0
    },
    {
      invoiceNumber: "SEZ-WPAY-003",
      invoiceType: "SEZ",
      sezType: "WPAY",
      customerGstin: "32AAACS1234E1Z1",
      pos: "32-Kerala",
      taxableValue: 200000,
      igstRate: 18,
      igst: 36000
    }
  ];

  const res = classifySalesRegisterForGstr1(supplies, "32ABCDE1234F1Z5");

  assert.equal(res.tables.table6_export_sez.length, 3);
  assert.equal(res.summary.totalTaxableValue, 1000000);
  assert.equal(res.summary.totalIgst, 126000);
});

test("Statutory Hardening: GSTR-1 handles Credit Notes (reducing tax) and Debit Notes (increasing tax)", () => {
  const supplies = [
    {
      invoiceNumber: "INV-B2B-01",
      invoiceType: "REGULAR",
      customerGstin: "32XYZAB1234C1Z9",
      pos: "32-Kerala",
      taxableValue: 100000,
      cgst: 9000,
      sgst: 9000
    },
    {
      invoiceNumber: "CRN-01",
      invoiceType: "CREDIT_NOTE",
      originalInvoiceNumber: "INV-B2B-01",
      customerGstin: "32XYZAB1234C1Z9",
      pos: "32-Kerala",
      taxableValue: 20000,
      cgst: 1800,
      sgst: 1800
    },
    {
      invoiceNumber: "DBN-01",
      invoiceType: "DEBIT_NOTE",
      originalInvoiceNumber: "INV-B2B-01",
      customerGstin: "32XYZAB1234C1Z9",
      pos: "32-Kerala",
      taxableValue: 10000,
      cgst: 900,
      sgst: 900
    }
  ];

  const res = classifySalesRegisterForGstr1(supplies, "32ABCDE1234F1Z5");

  assert.equal(res.tables.table4_b2b.length, 1);
  assert.equal(res.tables.table9_cdnr.length, 2);
  // Net Taxable: 100000 - 20000 + 10000 = 90000
  assert.equal(res.summary.totalTaxableValue, 90000);
  // Net CGST: 9000 - 1800 + 900 = 8100
  assert.equal(res.summary.totalCgst, 8100);
  assert.equal(res.summary.totalSgst, 8100);
});

// ============================================================================
// 5. RETURN LIFECYCLE: IDEMPOTENCY & PREREQUISITE BLOCKS
// ============================================================================

test("Statutory Hardening: Filing idempotency rejects duplicate return filings", () => {
  resetFilingRegistry();

  // First GSTR-1 filing succeeds
  const file1 = simulateReturnFiling("GSTR1", {
    gstin: "32TEST0001A1Z5",
    period: "102026"
  });
  assert.equal(file1.status, "SUCCESS");
  assert.equal(file1.mode, "SIMULATION");

  // Second filing for same GSTIN, period and return type must fail
  assert.throws(() => {
    simulateReturnFiling("GSTR1", {
      gstin: "32TEST0001A1Z5",
      period: "102026"
    });
  }, /Statutory Error: Return GSTR1 for period 102026 has already been filed/);
});

// ============================================================================
// 6. ELECTRONIC LEDGERS & PMT-06 OTC ₹10,000 LIMIT
// ============================================================================

test("Statutory Hardening: PMT-06 enforces Rule 87(4) Over-The-Counter ₹10,000 limit", () => {
  // OTC challan <= 10,000 allowed
  const validOtc = generatePmt06Challan(
    "32ABCDE1234F1Z5",
    { igstTax: 5000, cgstTax: 2500, sgstTax: 2500 },
    "OVER_THE_COUNTER"
  );
  assert.equal(validOtc.totalChallanAmount, 10000);

  // OTC challan > 10,000 strictly prohibited under Rule 87(4)
  assert.throws(() => {
    generatePmt06Challan(
      "32ABCDE1234F1Z5",
      { igstTax: 6000, cgstTax: 2500, sgstTax: 2500 },
      "OVER_THE_COUNTER"
    );
  }, /Statutory Restriction \(CGST Rule 87\(4\)\)/);

  // E-Payment (Net Banking / NEFT) has no ₹10,000 limit
  const ePay = generatePmt06Challan(
    "32ABCDE1234F1Z5",
    { igstTax: 500000, cgstTax: 250000, sgstTax: 250000 },
    "NET_BANKING"
  );
  assert.equal(ePay.totalChallanAmount, 1000000);
});

test("Statutory Hardening: PMT-09 rejects negative or insufficient ledger transfers", () => {
  const ledger = createEmptyCashLedger("32ABCDE1234F1Z5");
  ledger.majorHeads['IGST'].tax = 5000;
  ledger.majorHeads['IGST'].total = 5000;

  // Invalid: Transferring negative amount
  assert.throws(() => {
    executePmt09Transfer(ledger, {
      fromMajor: "IGST",
      fromMinor: "tax",
      toMajor: "CGST",
      toMinor: "tax",
      amount: -1000
    });
  }, /Transfer amount must be greater than zero/);

  // Invalid: Transferring more than available balance
  assert.throws(() => {
    executePmt09Transfer(ledger, {
      fromMajor: "IGST",
      fromMinor: "tax",
      toMajor: "CGST",
      toMinor: "tax",
      amount: 10000
    });
  }, /Insufficient balance in IGST-tax/);

  // Valid zero-sum transfer: ₹3,000 from IGST tax to CGST tax
  const res = executePmt09Transfer(ledger, {
    fromMajor: "IGST",
    fromMinor: "tax",
    toMajor: "CGST",
    toMinor: "tax",
    amount: 3000
  });

  assert.equal(res.form, 'GST PMT-09');
  assert.equal(res.updatedCashLedger.majorHeads['IGST'].tax, 2000);
  assert.equal(res.updatedCashLedger.majorHeads['CGST'].tax, 3000);
});

// ============================================================================
// 7. CA PRACTICE HUB: MULTI-TENANT ISOLATION & AUDIT LOGGING
// ============================================================================

test("Statutory Hardening: CA Practice enforces strict tenant isolation", () => {
  // CA_SANJAY can see Apex Hypermarkets (CLI-001) and Greenfield Agri (CLI-003)
  const sanjayClients = getTenantClients("CA_SANJAY");
  assert.equal(sanjayClients.length, 2);
  assert.ok(sanjayClients.some(c => c.clientId === "CLI-001"));
  assert.ok(sanjayClients.some(c => c.clientId === "CLI-003"));
  assert.equal(sanjayClients.some(c => c.clientId === "CLI-002"), false, "Sanjay cannot see Ramesh's clients");

  // CA_RAMESH can only see Zenith Logistics (CLI-002)
  const rameshClients = getTenantClients("CA_RAMESH");
  assert.equal(rameshClients.length, 1);
  assert.equal(rameshClients[0].clientId, "CLI-002");
  assert.equal(rameshClients.some(c => c.clientId === "CLI-001"), false, "Ramesh cannot see Sanjay's clients");

  // Attempting to access unknown tenant throws error
  assert.throws(() => {
    getTenantClients("CA_UNKNOWN_ATTACKER");
  }, /ERR_TENANT_NOT_FOUND/);

  // Attempting cross-tenant client access throws error
  assert.throws(() => {
    getTenantClient("CA_SANJAY", "CLI-002"); // CLI-002 belongs to CA_RAMESH
  }, /ERR_CLIENT_NOT_FOUND/);
});

test("Statutory Hardening: Practice logs immutable audit history", () => {
  const entry = logPracticeAction("CA_SANJAY", "sanjay", "SENIOR_CA", "UNIT_TEST_ACTION", "Testing audit trail persistence");
  assert.ok(entry);
  assert.ok(entry.id.startsWith("AUD-"));

  const logs = getPracticeAuditLogs("CA_SANJAY");
  assert.ok(logs.length > 0);
  assert.ok(logs.some(l => l.action === "UNIT_TEST_ACTION"));
});
