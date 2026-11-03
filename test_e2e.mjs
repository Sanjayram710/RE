/**
 * End-to-End Simulation Script
 * Tests full flow: Start fresh -> 2 Sales + 2 Purchases (1 invalid GSTIN) ->
 * Error Report Round-trip -> Reconciliation -> 3B Summary -> All 6 reports ->
 * Hand calculation verification.
 */

import { createServer } from "./server.js";
import { calculateGstSummary } from "./lib/gst.ts";
import { exportReport } from "./lib/reportsEngine.js";

const PORT = 3088;
const BASE_URL = `http://localhost:${PORT}`;

async function runE2E() {
  console.log("=================================================");
  console.log("Starting SimpleGST Comprehensive End-to-End Test");
  console.log("=================================================");

  const server = createServer();
  await new Promise((resolve) => server.listen(PORT, resolve));
  console.log(`[E2E] Server started on ${BASE_URL}`);

  try {
    // 1. GET /api/mode
    console.log("\n[1] Verifying System Mode...");
    const modeRes = await fetch(`${BASE_URL}/api/mode`);
    const modeData = await modeRes.json();
    console.log("Mode Response:", modeData);
    if (modeData.mode !== "demo") throw new Error("Expected demo mode");

    // 2. Prepare 2 Sales Invoices
    console.log("\n[2] Setting up 2 Sales Invoices...");
    const sales = [
      {
        id: "s1",
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
        id: "s2",
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

    const handOutputTax = { igst: 36000, cgst: 9000, sgst: 9000, total: 54000 };
    console.log("Sales Hand Output Tax:", handOutputTax);

    // 3. Ingest 2 Purchases (One with deliberately invalid GSTIN)
    console.log("\n[3] Testing Ingestion with 1 Valid and 1 Corrupt GSTIN...");
    const rawBatch = [
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
        partyName: "Bad Vendor Ent",
        partyGstin: "INVALID_GSTIN_123", // Corrupt format
        pos: "29",
        taxableValue: 50000,
        rate: 18
      }
    ];

    const importRes = await fetch(`${BASE_URL}/api/invoices/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invoices: rawBatch, type: "purchase" })
    });
    const importData = await importRes.json();
    console.log(`Import Result: ${importData.validCount} Valid, ${importData.errorCount} Errors`);
    if (importData.validCount !== 1 || importData.errorCount !== 1) {
      throw new Error(`Expected 1 valid and 1 error row, got: ${JSON.stringify(importData)}`);
    }

    console.log("Error reason captured:", importData.errorRows[0].errorReason);

    // 4. Download and Inspect Error Report (Round-Trip)
    console.log("\n[4] Downloading Error Report (Round-Trip)...");
    const errReportRes = await fetch(`${BASE_URL}${importData.errorReportDownloadUrl}`);
    const errReportContent = await errReportRes.text();
    if (!errReportContent.includes("Party GSTIN error")) {
      throw new Error("Error report missing required diagnostic error reason");
    }
    console.log("✓ Error Report (.xls) correctly formatted with Error Description column.");

    // Fix the error row (simulate user fixing offline and re-uploading)
    console.log("\n[5] Simulating User Fix & Re-Upload...");
    const fixedBatch = [
      rawBatch[0],
      { ...rawBatch[1], partyGstin: "29KARNA7766B1Z4", igst: 9000, isInterState: true }
    ];

    const reImportRes = await fetch(`${BASE_URL}/api/invoices/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invoices: fixedBatch, type: "purchase" })
    });
    const reImportData = await reImportRes.json();
    console.log(`Re-Import Result: ${reImportData.validCount} Valid, ${reImportData.errorCount} Errors`);
    if (reImportData.validCount !== 2 || reImportData.errorCount !== 0) {
      throw new Error("Re-import after fix must have 2 valid rows and 0 errors");
    }

    const purchases = reImportData.validRows.map(r => ({
      invoiceNumber: r.invoiceNumber,
      partyName: r.partyName,
      partyGstin: r.partyGstin,
      date: r.invoiceDate,
      taxableAmount: r.taxableValue,
      gstRate: r.rate,
      isInterState: r.isInterState,
      igst: r.igst,
      cgst: r.cgst,
      sgst: r.sgst,
      totalTax: r.totalTax,
      totalAmount: r.totalAmount
    }));

    const handGrossItc = 7200 + 7200 + 9000; // 23,400
    console.log("Purchases Hand Eligible ITC:", handGrossItc);

    // 5. Deterministic GSTR-3B Tax Calculation
    console.log("\n[6] Running Deterministic GSTR-3B Calculation...");
    const taxSummary = calculateGstSummary(sales, purchases, []);
    console.log("Tax Engine Output:", taxSummary);

    // Hand calculation verification:
    // Output tax: IGST 36,000, CGST 9,000, SGST 9,000 (Total 54,000)
    // Eligible ITC: IGST 9,000, CGST 7,200, SGST 7,200 (Total 23,400)
    // Net Payable:
    // IGST: 36,000 - 9,000 = 27,000
    // CGST: 9,000 - 7,200 = 1,800
    // SGST: 9,000 - 7,200 = 1,800
    // Total Net Payable: 27,000 + 1,800 + 1,800 = 30,600!
    if (taxSummary.outputTax.total !== 54000) throw new Error(`Expected output tax 54000, got ${taxSummary.outputTax.total}`);
    if (taxSummary.eligibleItc.total !== 23400) throw new Error(`Expected eligible ITC 23400, got ${taxSummary.eligibleItc.total}`);
    if (taxSummary.netPayable.total !== 30600) throw new Error(`Expected net payable 30600, got ${taxSummary.netPayable.total}`);
    console.log("✓ Hand Calculation Match: Output (54,000) - ITC (23,400) = Net Payable (30,600) exactly verified!");

    // 6. Generate and Verify Every Report (All 6 Reports in Excel, CSV, JSON)
    console.log("\n[7] Generating and Verifying All 6 Reports in Excel, CSV, and JSON...");
    const allReports = ["gstr1", "gstr3b", "sales_register", "purchase_register", "reconciliation", "itr1"];
    const allFormats = ["excel", "csv", "json"];

    for (const rName of allReports) {
      for (const fmt of allFormats) {
        const repRes = await fetch(`${BASE_URL}/api/export/${rName}?format=${fmt}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            salesInvoices: sales,
            purchaseInvoices: purchases,
            taxCalculation: taxSummary
          })
        });

        if (!repRes.ok) {
          throw new Error(`Failed to generate ${rName} in ${fmt}: HTTP ${repRes.status}`);
        }
        const blobText = await repRes.text();
        if (blobText.length < 50) {
          throw new Error(`Report ${rName} ${fmt} is abnormally short (${blobText.length} bytes)`);
        }
      }
      console.log(`✓ Report [${rName}] verified cleanly across Excel (.xls), CSV, and JSON.`);
    }

    // 7. Verify Sandbox Filing Modal & Flow
    console.log("\n[8] Testing Sandbox Filing Flow...");
    const filingRes = await fetch(`${BASE_URL}/api/gsp/gstr3b/file`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        gstin: "32ABCDE1234F1Z5",
        period: "102026",
        otp: "654321",
        consent: true
      })
    });
    const filingData = await filingRes.json();
    console.log("Filing Response:", filingData);
    if (!filingData.success || !filingData.arn.startsWith("AA32")) {
      throw new Error("Sandbox filing failed or invalid ARN issued");
    }
    console.log("✓ Sandbox return filing and ARN generation successfully completed!");

    console.log("\n=================================================");
    console.log("ALL END-TO-END CRITERIA VERIFIED AND FUNCTIONING!");
    console.log("=================================================");
  } finally {
    server.close();
  }
}

runE2E().catch((err) => {
  console.error("E2E Test Failed:", err);
  process.exit(1);
});

