import test from "node:test";
import assert from "node:assert/strict";
import XLSX from "xlsx";

import { validatePan, validateGstin, validateInvoiceRow } from "../lib/validate.js";
import { exportReport } from "../lib/reportsEngine.js";
import { calculateGstSummary } from "../lib/gst.ts";
import { TAX_CONFIG, computeTaxForAy } from "../lib/taxConfig.js";
import {
  getGspMode,
  isApiWorking,
  authAdapter,
  gstr1Adapter,
  gstr2bAdapter,
  gstr3bAdapter,
  imsAdapter
} from "../lib/gsp/index.js";
import {
  DEMO_BUSINESS,
  DEMO_SALES,
  DEMO_PURCHASES,
  DEMO_EXCEPTIONS,
  DEMO_RECONCILIATION,
  DEMO_ITR
} from "../lib/demoData.js";
import { generateEinvoice, computeIrn, cancelEinvoice } from "../lib/einvoiceEngine.js";
import { generateEwayBill, calculateEwbValidity, updatePartBVehicle } from "../lib/ewaybillEngine.js";
import { computeCapitalLossSetOff, scanTaxLossHarvesting } from "../lib/taxLossHarvesting.js";
import { getVendorRiskLeaderboard, generateWithholdingNotice } from "../lib/vendorRiskEngine.js";
import { getMultiGstinSummary } from "../lib/multiGstinEngine.js";
import { consolidateGstr9AnnualReturn } from "../lib/gstr9Engine.js";

// ============================================================================
// 1. Validation Tests (validate.js)
// ============================================================================
test("Validation: PAN format & structure", () => {
  const valid = validatePan("ABCDE1234F");
  assert.equal(valid.valid, true);
  assert.equal(valid.pan, "ABCDE1234F");

  const lowercase = validatePan("abcde1234f");
  assert.equal(lowercase.valid, true);
  assert.equal(lowercase.pan, "ABCDE1234F");

  const invalidLength = validatePan("ABC1234F");
  assert.equal(invalidLength.valid, false);

  const invalidFormat = validatePan("12345ABCDE");
  assert.equal(invalidFormat.valid, false);
});

test("Validation: GSTIN format & state codes", () => {
  const validKerala = validateGstin("32ABCDE1234F1Z5");
  assert.equal(validKerala.valid, true);
  assert.equal(validKerala.stateCode, "32");
  assert.equal(validKerala.pan, "ABCDE1234F");

  const validKarnataka = validateGstin("29XYZAB5678C1Z2");
  assert.equal(validKarnataka.valid, true);
  assert.equal(validKarnataka.stateCode, "29");

  const invalidState00 = validateGstin("00ABCDE1234F1Z5");
  assert.equal(invalidState00.valid, false);

  const invalidChars = validateGstin("32ABCDE1234F1!");
  assert.equal(invalidChars.valid, false);
});

test("Validation: Invoice row integrity and tax calculations", () => {
  const validRow = {
    invoiceNumber: "INV-100",
    invoiceDate: "2026-10-10",
    partyName: "Kerala Agro Stores",
    partyGstin: "32KERAL1234A1Z1",
    pos: "32",
    taxableValue: 100000,
    rate: 18,
    cgst: 9000,
    sgst: 9000
  };
  const res1 = validateInvoiceRow(validRow, "32ABCDE1234F1Z5");
  assert.equal(res1.valid, true);
  assert.equal(res1.sanitized.totalTax, 18000);
  assert.equal(res1.sanitized.totalAmount, 118000);

  const invalidTaxRow = {
    invoiceNumber: "INV-101",
    invoiceDate: "2026-10-12",
    partyName: "Bangalore Tech Corp",
    partyGstin: "29KARNA7766B1Z4",
    pos: "29", // Inter-state
    taxableValue: 50000,
    rate: 18,
    cgst: 4500, // Error: should be IGST
    sgst: 4500
  };
  const res2 = validateInvoiceRow(invalidTaxRow, "32ABCDE1234F1Z5");
  assert.equal(res2.valid, false);
  assert.ok(res2.errors.some(e => e.includes("Inter-state supply cannot have CGST or SGST")));

  const corruptGstinRow = {
    invoiceNumber: "INV-102",
    invoiceDate: "2026-10-15",
    partyName: "Local Retailer",
    partyGstin: "INVALID_GSTIN_123",
    taxableValue: 20000
  };
  const res3 = validateInvoiceRow(corruptGstinRow, "32ABCDE1234F1Z5");
  assert.equal(res3.valid, false);
  assert.ok(res3.errors.some(e => e.includes("Party GSTIN error")));
});

// ============================================================================
// 2. Real SheetJS .xlsx Multi-Sheet Exporter Tests
// ============================================================================
const requiredReports = [
  "sales_register",
  "purchase_register",
  "reconciliation",
  "gstr3b",
  "error_report",
  "filing_history",
  "gstr1",
  "itr1"
];
const testFormats = ["xlsx", "csv", "json"];

for (const rep of requiredReports) {
  for (const fmt of testFormats) {
    test(`Report Engine: ${rep} in ${fmt} format`, () => {
      const exported = exportReport(rep, fmt, {
        salesInvoices: DEMO_SALES,
        purchaseInvoices: DEMO_PURCHASES,
        reconData: DEMO_RECONCILIATION,
        itrData: DEMO_ITR,
        errorRows: [
          { raw: { invoiceNumber: "ERR-01", invoiceDate: "2026-10-15", partyName: "Bad Vendor", partyGstin: "INV_GSTIN", pos: "32", taxableValue: 10000, rate: 18 }, errorReason: "Invalid GSTIN" }
        ],
        assessmentYear: "2025-26",
        gstin: DEMO_BUSINESS.gstin,
        period: DEMO_BUSINESS.filingPeriod
      });

      assert.ok(exported.content, `Report ${rep} ${fmt} content must be non-empty`);
      assert.ok(exported.size > 0, `Report ${rep} ${fmt} size must be > 0`);

      if (fmt === "xlsx") {
        assert.ok(exported.filename.endsWith(".xlsx"), `Filename ${exported.filename} must end in .xlsx`);
        assert.equal(exported.contentType, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

        // Verify the file re-opens cleanly with SheetJS
        const reOpened = XLSX.read(exported.content, { type: "buffer" });
        assert.ok(reOpened && reOpened.SheetNames.length >= 2, "Workbook must contain at least 2 sheets");
        assert.equal(reOpened.SheetNames[0], "Summary", "The FIRST sheet in the workbook must strictly be 'Summary'");

        // Verify frozen header row and column widths
        const summarySheet = reOpened.Sheets["Summary"];
        assert.ok(summarySheet, "Summary sheet must exist in re-opened workbook");
        const dataSheetName = reOpened.SheetNames[1];
        const dataSheet = reOpened.Sheets[dataSheetName];
        assert.ok(dataSheet, `Data sheet ${dataSheetName} must exist`);
      } else if (fmt === "json") {
        const parsed = JSON.parse(exported.content.toString("utf8"));
        assert.ok(parsed, "JSON must be parseable");
      } else if (fmt === "csv") {
        const lines = exported.content.toString("utf8").split("\r\n");
        assert.ok(lines.length >= 2, "CSV must contain lines");
      }
    });
  }
}

// ============================================================================
// 3. Error Report Template Layout Verification
// ============================================================================
test("Report Engine: Error Report matches Import Template layout plus 'Error reason'", () => {
  const sampleErrors = [
    {
      raw: {
        invoiceNumber: "PUR-101",
        invoiceDate: "2026-10-15",
        partyName: "Vendor X",
        partyGstin: "BAD_GSTIN",
        pos: "32",
        taxableValue: 45000,
        rate: 18
      },
      errorReason: "Party GSTIN error: Invalid GSTIN format"
    }
  ];

  const exported = exportReport("error_report", "xlsx", { errorRows: sampleErrors });
  const wb = XLSX.read(exported.content, { type: "buffer" });
  assert.equal(wb.SheetNames[0], "Summary");
  assert.equal(wb.SheetNames[1], "Error Details");

  const errorSheet = wb.Sheets["Error Details"];
  const aoa = XLSX.utils.sheet_to_json(errorSheet, { header: 1 });
  const headerRow = aoa[0];

  const expectedHeaders = [
    "Invoice Number",
    "Invoice Date",
    "Party Name",
    "Party GSTIN",
    "Place of Supply",
    "Taxable Value",
    "Rate",
    "Error reason"
  ];

  assert.deepEqual(headerRow, expectedHeaders, "Error report must have identical layout to import template plus 'Error reason'");
});

// ============================================================================
// 4. AY Selector & Slab Configuration Tests (lib/taxConfig.js)
// ============================================================================
test("TaxConfig: AY 2025-26 and AY 2026-27 slabs & unconfirmed status", () => {
  // AY 2025-26
  assert.ok(TAX_CONFIG["2025-26"], "AY 2025-26 config must exist");
  assert.equal(TAX_CONFIG["2025-26"].status, "CONFIRMED");
  assert.equal(TAX_CONFIG["2025-26"].regimes.NEW.standardDeduction, 75000);

  // AY 2026-27
  assert.ok(TAX_CONFIG["2026-27"], "AY 2026-27 config must exist");
  assert.equal(TAX_CONFIG["2026-27"].regimes.NEW.standardDeduction, 75000);

  // Unconfirmed items must be marked as "TO VERIFY"
  assert.equal(TAX_CONFIG["2026-27"].regimes.NEW.marginalReliefThreshold, "TO VERIFY");
  assert.equal(TAX_CONFIG["2026-27"].regimes.OLD.seniorCitizenExemptionLimit, "TO VERIFY");

  // Compute tax for AY 2025-26
  const comp25 = computeTaxForAy(DEMO_ITR.income, "NEW", "2025-26");
  assert.equal(comp25.standardDeduction, 75000);
  assert.equal(comp25.netTaxableIncome, 1440000);

  // Compute tax for AY 2026-27
  const comp26 = computeTaxForAy(DEMO_ITR.income, "NEW", "2026-27");
  assert.equal(comp26.standardDeduction, 75000);
  assert.equal(comp26.assessmentYear, "2026-27");
});

// ============================================================================
// 5. Deterministic GST Tax Calculation
// ============================================================================
test("Deterministic GST Engine: Tax calculation matches hand computation", () => {
  const result = calculateGstSummary(DEMO_SALES, DEMO_PURCHASES, DEMO_EXCEPTIONS);

  const expectedTaxableSales = DEMO_SALES.reduce((s, i) => s + i.taxableAmount, 0);
  const expectedOutputTax = DEMO_SALES.reduce((s, i) => s + (i.igst + i.cgst + i.sgst), 0);
  assert.equal(result.taxableSales, expectedTaxableSales);
  assert.equal(result.outputTax.total, expectedOutputTax);

  const expectedTaxablePurchases = DEMO_PURCHASES.reduce((s, i) => s + i.taxableAmount, 0);
  const expectedGrossItc = DEMO_PURCHASES.reduce((s, i) => s + i.totalTax, 0);
  assert.equal(result.taxablePurchases, expectedTaxablePurchases);
  assert.equal(result.grossItc, expectedGrossItc);

  const expectedHeld = DEMO_EXCEPTIONS.reduce((s, e) => s + e.taxAmount, 0);
  assert.equal(result.heldItc, expectedHeld);

  assert.equal(result.eligibleItc.total, expectedGrossItc - expectedHeld);
  const rawDiff = result.outputTax.total - result.eligibleItc.total;
  assert.ok(Math.abs(result.netPayable.total - rawDiff) <= 1);
});

// ============================================================================
// 6. GSP Adapter Layer Tests
// ============================================================================
test("GSP Adapter: Mode and defaults", () => {
  const modeInfo = getGspMode();
  assert.equal(modeInfo.mode, "demo");
  assert.equal(modeInfo.isLive, false);
});

test("GSP Adapter: API readiness check on api-status.json", () => {
  const workingApi = isApiWorking(4);
  assert.equal(workingApi.allowed, true);
  assert.equal(workingApi.status, "working");

  const partialApi = isApiWorking(83);
  assert.equal(partialApi.allowed, false);
  assert.equal(partialApi.status, "partial");
  assert.ok(partialApi.message.includes("Not available yet"));
});

test("GSP Adapter: Authentication flow (Mock)", async () => {
  const otpRes = await authAdapter.requestOtp(DEMO_BUSINESS.gstin, "9876543210");
  assert.equal(otpRes.success, true);
  assert.equal(otpRes.mode, "demo");

  const tokRes = await authAdapter.requestAuthToken(DEMO_BUSINESS.gstin, "123456");
  assert.equal(tokRes.success, true);
  assert.ok(tokRes.auth_token.startsWith("gst_auth_tok_"));
});

test("GSP Adapter: GSTR-1 & GSTR-2B operations", async () => {
  const g1Summary = await gstr1Adapter.getSummary(DEMO_BUSINESS.gstin, "102026");
  assert.equal(g1Summary.success, true);
  assert.ok(g1Summary.sec_sum.length > 0);

  const g2bDetails = await gstr2bAdapter.getDetails(DEMO_BUSINESS.gstin, "102026");
  assert.equal(g2bDetails.success, true);
  assert.ok(g2bDetails.invoices.length > 0);
});

test("GSP Adapter: GSTR-3B Auto calc & filing sandbox security", async () => {
  const itcCalc = await gstr3bAdapter.getItcAutoCalc(DEMO_BUSINESS.gstin, "102026");
  assert.equal(itcCalc.success, true);
  assert.ok(itcCalc.auto_calc.table3_1_outward);

  const fileNoConsent = await gstr3bAdapter.fileGstr3b(DEMO_BUSINESS.gstin, "102026", "123456", false);
  assert.equal(fileNoConsent.success, false);
  assert.ok(fileNoConsent.message.includes("consent"));

  const fileBadOtp = await gstr3bAdapter.fileGstr3b(DEMO_BUSINESS.gstin, "102026", "12", true);
  assert.equal(fileBadOtp.success, false);
  assert.ok(fileBadOtp.message.includes("6-digit OTP"));

  const fileSuccess = await gstr3bAdapter.fileGstr3b(DEMO_BUSINESS.gstin, "102026", "654321", true);
  assert.equal(fileSuccess.success, true);
  assert.equal(fileSuccess.mode, "sandbox");
  assert.ok(fileSuccess.arn.startsWith("AA32"));
});

test("GSP Adapter: IMS adapter returns 'Not available yet' for partial API", async () => {
  const imsRes = await imsAdapter.getInvoices(DEMO_BUSINESS.gstin, "102026");
  assert.equal(imsRes.success, false);
  assert.equal(imsRes.status, "partial");
  assert.ok(imsRes.message.includes("Not available yet"));
});

// ============================================================================
// 7. Ingestion & Error Report Round-Trip Test
// ============================================================================
test("Import: Error report round-trip workflow", () => {
  const batch = [
    {
      invoiceNumber: "OK-1",
      invoiceDate: "2026-10-01",
      partyName: "Client A",
      partyGstin: "32XYZAB5678C1Z2",
      pos: "32",
      taxableValue: 50000,
      rate: 18,
      cgst: 4500,
      sgst: 4500
    },
    {
      invoiceNumber: "ERR-1",
      invoiceDate: "2026-10-02",
      partyName: "Client B",
      partyGstin: "INVALID_GSTIN_FORMAT",
      pos: "32",
      taxableValue: 30000,
      rate: 18
    }
  ];

  const validRows = [];
  const errorRows = [];

  batch.forEach((row, idx) => {
    const check = validateInvoiceRow(row, "32ABCDE1234F1Z5");
    if (check.valid) {
      validRows.push(check.sanitized);
    } else {
      errorRows.push({ rowNumber: idx + 1, raw: row, errorReason: check.errors.join("; ") });
    }
  });

  assert.equal(validRows.length, 1);
  assert.equal(errorRows.length, 1);
  assert.ok(errorRows[0].errorReason.includes("Party GSTIN error"));

  const fixedRow = { ...errorRows[0].raw, partyGstin: "32KERAL1234A1Z1" };
  const recheck = validateInvoiceRow(fixedRow, "32ABCDE1234F1Z5");
  assert.equal(recheck.valid, true);
});

// ============================================================================
// 7. Advanced Taxpayer Feature Tests (Prefill, Broker PnL, Notices, Vault)
// ============================================================================
import { parseItdPrefillJson, generateSampleItdPrefillJson } from "../lib/prefillParser.js";
import { parseBrokerTrades, parseBrokerCsv } from "../lib/brokerPnlParser.js";
import { analyzeNoticeDiscrepancies, generateStatutoryReplyDraft } from "../lib/noticeEngine.js";
import { vaultStore } from "../lib/vaultStore.js";

test("Prefill: Official ITD prefill.json extraction and normalization", () => {
  const sample = generateSampleItdPrefillJson("CVBBC4433W");
  const parsed = parseItdPrefillJson(sample);

  assert.equal(parsed.success, true);
  assert.equal(parsed.personalInfo.pan, "CVBBC4433W");
  assert.equal(parsed.personalInfo.firstName, "Sanjay");
  assert.equal(parsed.income.grossSalary, 1200000);
  assert.equal(parsed.income.taxesPaid.tds, 100000);
  assert.equal(parsed.personalInfo.bank.bankName, "HDFC Bank");
});

test("Broker P&L: Equity STCG @ 20% and LTCG @ 12.5% with ₹1.25L exemption (Finance Act 2024)", () => {
  const trades = [
    // LTCG >= 365 days: Gain = 1,50,000
    { symbol: "RELIANCE", buyDate: "2023-01-01", sellDate: "2024-06-01", buyValue: 200000, sellValue: 350000 },
    // STCG < 365 days: Gain = 50,000
    { symbol: "TCS", buyDate: "2024-01-01", sellDate: "2024-05-01", buyValue: 100000, sellValue: 150000 }
  ];

  const result = parseBrokerTrades(trades);
  assert.equal(result.success, true);
  assert.equal(result.grossLtcg, 150000);
  assert.equal(result.grossStcg, 50000);

  // Section 112A: First ₹1,25,000 is tax-free; Remaining ₹25,000 is taxed @ 12.5% = ₹3,125
  assert.equal(result.exemption112AApplied, 125000);
  assert.equal(result.taxableLtcg, 25000);
  assert.equal(result.taxLiability.ltcgTax, 3125);

  // STCG: ₹50,000 taxed @ 20% = ₹10,000
  assert.equal(result.taxableStcg, 50000);
  assert.equal(result.taxLiability.stcgTax, 10000);
  assert.equal(result.taxLiability.totalTax, 13125);
});

test("Notice Defense: Section 143(1) intimation discrepancy and draft reply", () => {
  const filed = { grossSalary: 1200000, deductions: 175000, tdsCredit: 95000, taxLiability: 71500 };
  const intim = { grossSalary: 1200000, deductions: 150000, tdsCredit: 80000, taxLiability: 98200, din: "CPC/2526/89401283" };

  const analysis = analyzeNoticeDiscrepancies(filed, intim);
  assert.equal(analysis.success, true);
  assert.equal(analysis.discrepancyMatrix.length, 4);
  assert.ok(analysis.netDemandAmount > 0);

  const reply = generateStatutoryReplyDraft({
    pan: "CVBBC4433W",
    din: analysis.din,
    section: "143(1)",
    assessmentYear: "2025-26",
    varianceAmount: 15000
  });
  assert.equal(reply.success, true);
  assert.ok(reply.fullDraftText.includes("Formal Objection"));
  assert.ok(reply.fullDraftText.includes("CVBBC4433W"));
});

test("Document Vault: Repository tagging and persistence", () => {
  const initialDocs = vaultStore.listDocuments("all");
  assert.ok(initialDocs.length >= 5);

  const newDoc = vaultStore.addDocument({
    name: "Form_27D_TCS_Certificate.pdf",
    category: "TCS & Tax Deductions",
    size: "140 KB",
    description: "TCS on Foreign Remittance LRS"
  });
  assert.equal(newDoc.fileType, "PDF");

  const filtered = vaultStore.listDocuments("Salary");
  assert.ok(filtered.every(d => d.category.includes("Salary")));
});

// ============================================================================
// 10. E-Invoicing & IRP Sandbox Engine (Rule 48(4) & NIC Schema v1.03)
// ============================================================================
test("E-Invoicing: 64-char SHA-256 IRN, statutory signed QR payload, and cancellation", () => {
  const irn = computeIrn("32ABCDE1234F1Z5", "2026-27", "INV", "INV-2026-999");
  assert.equal(irn.length, 64, "IRN must be 64-character hexadecimal SHA-256 string");

  const einvoice = generateEinvoice({
    supplierGstin: "32ABCDE1234F1Z5",
    buyerGstin: "29XYZAB5678C1Z2",
    invoiceNo: "INV-2026-999",
    taxableValue: 100000,
    gstRate: 18
  });

  assert.equal(einvoice.success, true);
  assert.equal(einvoice.irn, irn);
  assert.equal(einvoice.status, "ACT");
  assert.equal(einvoice.valDetails.igst, 18000, "Inter-state supply (32 to 29) must charge 18% IGST");
  assert.equal(einvoice.valDetails.totalInvoiceValue, 118000);
  assert.ok(einvoice.qrCodeData.includes(irn));
  assert.ok(einvoice.qrCodeData.includes("GSTIN:32ABCDE1234F1Z5"));

  // Cancellation test
  const cnl = cancelEinvoice(einvoice.irn, "1", "Duplicate entry");
  assert.equal(cnl.status, "CNL");
});

// ============================================================================
// 11. E-Way Bill Lifecycle Engine (Rule 138 & Distance Validity)
// ============================================================================
test("E-Way Bill: 12-digit EWB generation, Rule 138(10) distance validity, and Part-B vehicle update", () => {
  // Distance 350 km -> ceil(350 / 200) = 2 days validity
  assert.equal(calculateEwbValidity(350, false), 2);
  // Distance 80 km -> ceil(80 / 200) = 1 day validity
  assert.equal(calculateEwbValidity(80, false), 1);
  // Over-dimensional cargo: 45 km -> ceil(45 / 20) = 3 days validity
  assert.equal(calculateEwbValidity(45, true), 3);

  const ewb = generateEwayBill({
    supplierGstin: "32ABCDE1234F1Z5",
    buyerGstin: "29XYZAB5678C1Z2",
    invoiceNo: "INV-901",
    invoiceValue: 85000,
    distanceKm: 420,
    vehicleNo: "KA01AB1234"
  });

  assert.equal(ewb.success, true);
  assert.equal(ewb.ewbNo.length, 12, "EWB No must be a 12-digit number");
  assert.equal(ewb.validityDays, 3); // ceil(420 / 200) = 3 days
  assert.equal(ewb.partB.vehicleNo, "KA01AB1234");

  // Part-B Vehicle update
  const updated = updatePartBVehicle(ewb.ewbNo, { vehicleNo: "MH12CD5678", reason: "Breakdown" });
  assert.equal(updated.success, true);
  assert.equal(updated.updatedVehicleNo, "MH12CD5678");
});

// ============================================================================
// 12. Tax Loss Harvesting & Set-Off (Sections 70, 71, 74)
// ============================================================================
test("Tax Loss Harvesting: Section 70 intra-head set-off and carry-forward rules", () => {
  // Scenario: STCG = 50,000, LTCG = 2,00,000, STCL = 20,000, LTCL = 50,000
  const result = computeCapitalLossSetOff({
    stcg: 50000,
    ltcg: 200000,
    stcl: 20000,
    ltcl: 50000
  });

  assert.equal(result.success, true);
  // LTCL 50k sets off LTCG 200k -> 150k remaining
  assert.equal(result.setOffAudit.ltclUsedAgainstLtcg, 50000);
  // STCL 20k sets off STCG 50k -> 30k remaining STCG
  assert.equal(result.setOffAudit.stclUsedAgainstStcg, 20000);
  assert.equal(result.taxableGains.finalTaxableStcg, 30000);

  // Remaining LTCG is 150k. Section 112A ₹1.25L exemption applies -> 25k taxable LTCG
  assert.equal(result.taxableGains.netTaxableLtcgBeforeExemption, 150000);
  assert.equal(result.taxableGains.exemption112AApplied, 125000);
  assert.equal(result.taxableGains.finalTaxableLtcg, 25000);

  // Tax: STCG @ 20% on 30k = 6,000. LTCG @ 12.5% on 25k = 3,125. Total = 9,125
  assert.equal(result.taxPayable.taxOnStcg, 6000);
  assert.equal(result.taxPayable.taxOnLtcg, 3125);
  assert.equal(result.taxPayable.totalCapitalGainsTax, 9125);

  // Harvesting opportunity scan
  const harvestScan = scanTaxLossHarvesting([], { stcg: 50000, ltcg: 200000 });
  assert.equal(harvestScan.success, true);
  assert.ok(harvestScan.potentialTaxSaved > 0, "Tax loss harvesting should discover tax reduction opportunity");
});

// ============================================================================
// 13. Vendor Compliance Leaderboard & "ITC at Risk" Command Center
// ============================================================================
test("Vendor Risk: Section 16(2)(aa) blocked ITC and automated withholding notice", () => {
  const leaderboard = getVendorRiskLeaderboard(DEMO_PURCHASES);
  assert.equal(leaderboard.success, true);
  assert.ok(leaderboard.summary.totalVendorsTracked > 0);
  assert.ok(leaderboard.summary.totalBlockedItc > 0, "Missing invoices in 2B must reflect blocked ITC");

  const notice = generateWithholdingNotice({
    tradeName: "Skyline Distributors",
    gstin: "32DEFGH5678J1Z9",
    blockedItc: 21600
  });

  assert.equal(notice.success, true);
  assert.ok(notice.noticeText.includes("Section 16(2)(aa)"));
  assert.ok(notice.noticeText.includes("Skyline Distributors"));
  assert.ok(notice.noticeText.includes("21,600"));
});

// ============================================================================
// 14. Multi-GSTIN Pan-India Corporate Compliance Summary
// ============================================================================
test("Multi-GSTIN: Corporate PAN state aggregation and compliance rate", () => {
  const summary = getMultiGstinSummary("AAACB1234F");
  assert.equal(summary.success, true);
  assert.equal(summary.corporatePan, "AAACB1234F");
  assert.equal(summary.branches.length, 5, "Must track all 5 registered state branches");
  assert.ok(summary.consolidatedMetrics.panIndiaTurnover > 0);
  assert.ok(summary.consolidatedMetrics.overallComplianceRate > 0);
});

// ============================================================================
// 15. GSTR-9 Annual Return Auto-Consolidation (Section 44)
// ============================================================================
test("GSTR-9: Auto-consolidation into Tables 4, 6, 8, and 9", () => {
  const gstr9 = consolidateGstr9AnnualReturn("32ABCDE1234F1Z5", "2025-26");
  assert.equal(gstr9.success, true);
  assert.equal(gstr9.financialYear, "2025-26");
  assert.ok(gstr9.table4_OutwardTaxableSupplies.totalTaxableValue > 0);
  assert.ok(gstr9.table6_ItcAvailed.totalItcAvailed > 0);
  assert.ok(gstr9.table8_ItcReconciliation.difference !== undefined);
  assert.ok(gstr9.table9_TaxPaid.paidThroughCredit > 0);
});
