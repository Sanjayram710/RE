/**
 * In-Process End-to-End Test (Zero-Network Sandboxed)
 * Tests the entire business pipeline from ingestion through reports and filing.
 */

import { validateGstin, validatePan, validateInvoiceRow } from "./lib/validate.js";
import { calculateGstSummary } from "./lib/gst.ts";
import { exportReport } from "./lib/reportsEngine.js";
import { gstr3bAdapter } from "./lib/gsp/index.js";

async function runInProcessE2E() {
  console.log("==========================================================");
  console.log("SimpleGST In-Process E2E Verification & Hand-Calc Audit");
  console.log("==========================================================");

  // 1. Setup 2 Sales Invoices
  console.log("\n[1] Adding 2 Sales Invoices...");
  const sales = [
    {
      invoiceNumber: "MST-S1",
      date: "2026-10-10",
      partyName: "Kerala Spices Ltd",
      partyGstin: "32XYZAB5678C1Z2",
      pos: "32",
      taxableAmount: 100000,
      gstRate: 18,
      isInterState: false,
      igst: 0,
      cgst: 9000,
      sgst: 9000,
      totalTax: 18000,
      totalAmount: 118000
    },
    {
      invoiceNumber: "MST-S2",
      date: "2026-10-12",
      partyName: "Mumbai Trades Corp",
      partyGstin: "27MNOPE9012D1Z9",
      pos: "27",
      taxableAmount: 200000,
      gstRate: 18,
      isInterState: true,
      igst: 36000,
      cgst: 0,
      sgst: 0,
      totalTax: 36000,
      totalAmount: 236000
    }
  ];

  // Validate sales rows
  sales.forEach(s => {
    const val = validateInvoiceRow(s, "32ABCDE1234F1Z5");
    if (!val.valid) throw new Error(`Sale validation failed: ${val.errors.join(", ")}`);
  });
  console.log(`✓ 2 Sales Invoices validated: Total Taxable ₹3,00,000, Output Tax ₹54,000 (IGST: 36,000, CGST: 9,000, SGST: 9,000).`);

  // 2. Add 2 Purchases (1 with deliberately invalid GSTIN)
  console.log("\n[2] Ingesting 2 Purchases (1 Valid, 1 with Corrupt GSTIN)...");
  const rawPurchases = [
    {
      invoiceNumber: "PUR-P1",
      invoiceDate: "2026-10-14",
      partyName: "Kochi Packing Ltd",
      partyGstin: "32KERAL1234A1Z1",
      pos: "32",
      taxableValue: 80000,
      rate: 18,
      cgst: 7200,
      sgst: 7200
    },
    {
      invoiceNumber: "PUR-P2",
      invoiceDate: "2026-10-16",
      partyName: "Faulty Vendor",
      partyGstin: "INVALID_GSTIN_123",
      pos: "29",
      taxableValue: 50000,
      rate: 18
    }
  ];

  const validPurchases = [];
  const errorPurchases = [];

  rawPurchases.forEach((p, idx) => {
    const val = validateInvoiceRow(p, "32ABCDE1234F1Z5");
    if (val.valid) {
      validPurchases.push(val.sanitized);
    } else {
      errorPurchases.push({ rowNumber: idx + 1, raw: p, errors: val.errors });
    }
  });

  if (validPurchases.length !== 1 || errorPurchases.length !== 1) {
    throw new Error(`Expected 1 valid and 1 error purchase, got ${validPurchases.length} & ${errorPurchases.length}`);
  }
  console.log(`✓ Ingestion successfully detected error: "${errorPurchases[0].errors.join("; ")}"`);

  // Error Report Round-trip: fix the error row and re-ingest
  console.log("\n[3] Simulating Error Report Round-Trip & Correction...");
  const fixedP2 = { ...errorPurchases[0].raw, partyGstin: "29KARNA7766B1Z4", pos: "29", rate: 18 };
  const fixedVal = validateInvoiceRow(fixedP2, "32ABCDE1234F1Z5");
  if (!fixedVal.valid) throw new Error("Correction re-validation failed");
  validPurchases.push(fixedVal.sanitized);
  console.log("✓ Fixed purchase accepted. Total valid purchases: 2.");

  const purchases = validPurchases.map(p => ({
    invoiceNumber: p.invoiceNumber,
    date: p.invoiceDate,
    partyName: p.partyName,
    partyGstin: p.partyGstin,
    taxableAmount: p.taxableValue,
    gstRate: p.rate,
    isInterState: p.isInterState,
    igst: p.igst,
    cgst: p.cgst,
    sgst: p.sgst,
    totalTax: p.totalTax,
    totalAmount: p.totalAmount
  }));

  // 3. Run GSTR-3B Tax Rules Engine
  console.log("\n[4] Running GSTR-3B Tax Rules Engine...");
  const taxSummary = calculateGstSummary(sales, purchases, []);

  // Hand calculations:
  // Sales Taxable = 100000 + 200000 = 300000
  // Output Tax: IGST = 36000, CGST = 9000, SGST = 9000, Total = 54000
  // Purchases Taxable = 80000 + 50000 = 130000
  // Purchase ITC: IGST = 9000, CGST = 7200, SGST = 7200, Total = 23400
  // Net Payable:
  // IGST = 36000 - 9000 = 27000
  // CGST = 9000 - 7200 = 1800
  // SGST = 9000 - 7200 = 1800
  // Total Net Payable = 27000 + 1800 + 1800 = 30600!
  console.log("Calculated Output Tax:", taxSummary.outputTax);
  console.log("Calculated Eligible ITC:", taxSummary.eligibleItc);
  console.log("Calculated Net Payable:", taxSummary.netPayable);

  if (taxSummary.outputTax.total !== 54000) throw new Error(`Output tax mismatch: ${taxSummary.outputTax.total} vs 54000`);
  if (taxSummary.eligibleItc.total !== 23400) throw new Error(`ITC mismatch: ${taxSummary.eligibleItc.total} vs 23400`);
  if (taxSummary.netPayable.total !== 30600) throw new Error(`Net payable mismatch: ${taxSummary.netPayable.total} vs 30600`);
  console.log("✓ Hand Calculation Exact Match: Output (₹54,000) - ITC (₹23,400) = Net Payable (₹30,600).");

  // 4. Generate Every Report across Excel, CSV, JSON
  console.log("\n[5] Generating and Verifying All 6 Reports in Excel, CSV, and JSON...");
  const reportsList = ["gstr1", "gstr3b", "sales_register", "purchase_register", "reconciliation", "itr1"];
  const formatsList = ["excel", "csv", "json"];

  for (const rep of reportsList) {
    for (const fmt of formatsList) {
      const generated = exportReport(rep, fmt, {
        salesInvoices: sales,
        purchaseInvoices: purchases,
        taxCalc: taxSummary,
        gstin: "32ABCDE1234F1Z5",
        period: "102026"
      });

      if (!generated.content || generated.size < 50) {
        throw new Error(`Report ${rep} in ${fmt} produced empty content`);
      }
      if (fmt === "excel" && !generated.content.includes("<?xml")) {
        throw new Error(`Excel report ${rep} is missing XML SpreadsheetML header`);
      }
      if (fmt === "csv" && !generated.content.includes(",")) {
        throw new Error(`CSV report ${rep} has invalid format`);
      }
      if (fmt === "json") {
        JSON.parse(generated.content);
      }
    }
    console.log(`✓ Report [${rep}] verified across Excel (.xls), CSV, and JSON.`);
  }

  // 5. Test Sandbox Return Filing
  console.log("\n[6] Testing Sandbox Filing Security & ARN Issuance...");
  const filingRes = await gstr3bAdapter.fileGstr3b("32ABCDE1234F1Z5", "102026", "123456", true);
  if (!filingRes.success || !filingRes.arn.startsWith("AA32")) {
    throw new Error(`Filing test failed: ${JSON.stringify(filingRes)}`);
  }
  console.log(`✓ Sandbox Filing Succeeded! Generated ARN: ${filingRes.arn}`);

  console.log("\n==========================================================");
  console.log("ALL E2E & HAND CALCULATION TESTS PASSED CLEANLY!");
  console.log("==========================================================");
}

runInProcessE2E().catch(err => {
  console.error("Test Error:", err);
  process.exit(1);
});

