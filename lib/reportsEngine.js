/**
 * SimpleGST Unified Reports & Export Engine
 * Generates JSON, RFC 4180 CSV, and Real .xlsx via SheetJS (xlsx package)
 *
 * Required Reports:
 * 1. Sales Register
 * 2. Purchase Register
 * 3. ITC Reconciliation
 * 4. GSTR-3B Summary
 * 5. Error Report (same layout as import template + "Error reason")
 * 6. Filing History
 * 7. GSTR-1 (retained)
 * 8. ITR-1 (retained, supports AY 2025-26 and AY 2026-27)
 */

import { buildXlsxWorkbook } from "./excelSheetJs.js";
import { computeTaxForAy } from "./taxConfig.js";
import { generateITRJson } from "./itrExporter.js";

const NOTICE_TEXT = "Demo files. Not official GST portal or income tax portal files.";

function escapeCsvField(val) {
  if (val === null || val === undefined) return '""';
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return `"${str}"`;
}

function toCsv(rows) {
  return rows.map(r => r.map(escapeCsvField).join(",")).join("\r\n");
}

// -------------------------------------------------------------
// Report 1: Sales Register
// -------------------------------------------------------------
export function generateSalesRegisterReport(salesInvoices = [], gstin = "32ABCDE1234F1Z5", period = "102026") {
  let totalTaxable = 0, totalIgst = 0, totalCgst = 0, totalSgst = 0, totalAmount = 0;

  const dataRows = [];
  const items = salesInvoices.map(inv => {
    const tx = Number(inv.taxableAmount ?? inv.taxableValue ?? 0);
    const igst = Number(inv.igst || 0);
    const cgst = Number(inv.cgst || 0);
    const sgst = Number(inv.sgst || 0);
    const totalTax = igst + cgst + sgst;
    const tot = Number(inv.totalAmount ?? (tx + totalTax));

    totalTaxable += tx;
    totalIgst += igst;
    totalCgst += cgst;
    totalSgst += sgst;
    totalAmount += tot;

    dataRows.push([
      inv.invoiceNumber,
      inv.date || inv.invoiceDate,
      inv.partyName,
      inv.partyGstin || "N/A",
      inv.pos || (inv.isInterState ? "27" : gstin.substring(0, 2)),
      tx,
      inv.gstRate ?? inv.rate ?? 18,
      igst,
      cgst,
      sgst,
      tot
    ]);

    return {
      invoiceNumber: inv.invoiceNumber,
      date: inv.date || inv.invoiceDate,
      customerName: inv.partyName,
      customerGstin: inv.partyGstin,
      pos: inv.pos,
      taxableValue: tx,
      rate: inv.gstRate ?? inv.rate ?? 18,
      igst,
      cgst,
      sgst,
      totalAmount: tot
    };
  });

  const json = {
    report: "Sales Register",
    period,
    gstin,
    disclaimer: NOTICE_TEXT,
    totalRecords: items.length,
    totals: {
      taxableValue: totalTaxable,
      igst: totalIgst,
      cgst: totalCgst,
      sgst: totalSgst,
      totalTax: totalIgst + totalCgst + totalSgst,
      totalAmount
    },
    invoices: items
  };

  const csvRows = [
    ["Sales Register", `Period: ${period}`, `GSTIN: ${gstin}`, NOTICE_TEXT],
    [],
    ["Invoice Number", "Invoice Date", "Customer Name", "Customer GSTIN", "Place of Supply", "Taxable Value (INR)", "Rate (%)", "IGST (INR)", "CGST (INR)", "SGST (INR)", "Total Value (INR)"],
    ...dataRows,
    ["TOTALS", "", "", "", "", totalTaxable, "", totalIgst, totalCgst, totalSgst, totalAmount]
  ];

  const sheets = [
    {
      name: "Summary",
      data: [
        ["SimpleGST Sales Register Summary"],
        ["Notice", NOTICE_TEXT],
        ["Entity GSTIN", gstin],
        ["Return Period", period],
        ["Generated At", new Date().toISOString()],
        ["Total Invoices", items.length],
        ["Total Taxable Value", totalTaxable],
        ["Total IGST", totalIgst],
        ["Total CGST", totalCgst],
        ["Total SGST", totalSgst],
        ["Total Invoice Value", totalAmount]
      ],
      currencyCols: [1]
    },
    {
      name: "Sales Register",
      data: [
        ["Invoice Number", "Invoice Date", "Customer Name", "Customer GSTIN", "Place of Supply", "Taxable Value", "Rate (%)", "IGST", "CGST", "SGST", "Total Value"],
        ...dataRows,
        ["TOTALS", "", "", "", "", totalTaxable, "", totalIgst, totalCgst, totalSgst, totalAmount]
      ],
      currencyCols: [5, 7, 8, 9, 10]
    }
  ];

  const xlsxBuffer = buildXlsxWorkbook(sheets);
  return { json, csv: toCsv(csvRows), excel: xlsxBuffer };
}

// -------------------------------------------------------------
// Report 2: Purchase Register
// -------------------------------------------------------------
export function generatePurchaseRegisterReport(purchaseInvoices = [], gstin = "32ABCDE1234F1Z5", period = "102026") {
  let totalTaxable = 0, totalIgst = 0, totalCgst = 0, totalSgst = 0, totalItc = 0;

  const dataRows = [];
  const items = purchaseInvoices.map(inv => {
    const tx = Number(inv.taxableAmount ?? inv.taxableValue ?? 0);
    const igst = Number(inv.igst || 0);
    const cgst = Number(inv.cgst || 0);
    const sgst = Number(inv.sgst || 0);
    const itc = Number(inv.totalTax ?? (igst + cgst + sgst));

    totalTaxable += tx;
    totalIgst += igst;
    totalCgst += cgst;
    totalSgst += sgst;
    totalItc += itc;

    dataRows.push([
      inv.invoiceNumber,
      inv.date || inv.invoiceDate,
      inv.partyName,
      inv.partyGstin || "N/A",
      inv.pos || (inv.isInterState ? "29" : gstin.substring(0, 2)),
      tx,
      inv.gstRate ?? inv.rate ?? 18,
      igst,
      cgst,
      sgst,
      itc,
      inv.status || "eligible"
    ]);

    return {
      billNumber: inv.invoiceNumber,
      date: inv.date || inv.invoiceDate,
      supplierName: inv.partyName,
      supplierGstin: inv.partyGstin,
      taxableValue: tx,
      rate: inv.gstRate ?? inv.rate ?? 18,
      igst,
      cgst,
      sgst,
      totalItc: itc,
      status: inv.status || "eligible"
    };
  });

  const json = {
    report: "Purchase Register",
    period,
    gstin,
    disclaimer: NOTICE_TEXT,
    totalRecords: items.length,
    totals: { taxableValue: totalTaxable, igst: totalIgst, cgst: totalCgst, sgst: totalSgst, totalItc },
    purchases: items
  };

  const csvRows = [
    ["Purchase Register (Input Tax Credit)", `Period: ${period}`, `GSTIN: ${gstin}`, NOTICE_TEXT],
    [],
    ["Bill Number", "Date", "Supplier Name", "Supplier GSTIN", "POS", "Taxable Value (INR)", "Rate (%)", "IGST (INR)", "CGST (INR)", "SGST (INR)", "Total ITC (INR)", "Status"],
    ...dataRows,
    ["TOTALS", "", "", "", "", totalTaxable, "", totalIgst, totalCgst, totalSgst, totalItc, ""]
  ];

  const sheets = [
    {
      name: "Summary",
      data: [
        ["SimpleGST Purchase Register Summary"],
        ["Notice", NOTICE_TEXT],
        ["Entity GSTIN", gstin],
        ["Return Period", period],
        ["Total Purchase Bills", items.length],
        ["Total Taxable Value", totalTaxable],
        ["Total Input Tax Credit (ITC)", totalItc],
        ["Total IGST ITC", totalIgst],
        ["Total CGST ITC", totalCgst],
        ["Total SGST ITC", totalSgst]
      ],
      currencyCols: [1]
    },
    {
      name: "Purchase Register",
      data: [
        ["Bill Number", "Date", "Supplier Name", "Supplier GSTIN", "POS", "Taxable Value", "Rate (%)", "IGST", "CGST", "SGST", "Total ITC", "Status"],
        ...dataRows,
        ["TOTALS", "", "", "", "", totalTaxable, "", totalIgst, totalCgst, totalSgst, totalItc, ""]
      ],
      currencyCols: [5, 7, 8, 9, 10]
    }
  ];

  const xlsxBuffer = buildXlsxWorkbook(sheets);
  return { json, csv: toCsv(csvRows), excel: xlsxBuffer };
}

// -------------------------------------------------------------
// Report 3: ITC Reconciliation (2B vs Books)
// -------------------------------------------------------------
export function generateReconciliationReport(reconData = {}, gstin = "32ABCDE1234F1Z5", period = "102026") {
  const items = reconData.items || [
    { invoiceNo: "DPC-402", supplier: "Deccan Packaging Containers Ltd", gstin: "29KARNA7766B1Z4", date: "2026-10-15", booksTax: 45000, gstr2bTax: 45000, status: "Matched", action: "Accept", reason: "Exact match in GSTIN, invoice number and tax amount" },
    { invoiceNo: "KSP-882", supplier: "Kerala Spices & Pepper Hub", gstin: "32KSPHU1122D1Z3", date: "2026-10-28", booksTax: 27900, gstr2bTax: 27900, status: "Matched", action: "Accept", reason: "Exact match" },
    { invoiceNo: "MSW-9912", supplier: "Malabar Spice Wholesalers", gstin: "32KERAL1234A1Z1", date: "2026-10-05", booksTax: 5400, gstr2bTax: 0, status: "Missing in 2B", action: "Hold", reason: "Supplier has not uploaded invoice to GSTN yet" },
    { invoiceNo: "CPS-108", supplier: "Calicut Printing & Stationery Co", gstin: "32CALIC1234C1Z9", date: "2026-10-22", booksTax: 4200, gstr2bTax: 4200, status: "Mismatch", action: "Hold", reason: "Invoice date difference: books show 15-Aug, 2B shows 15-Sep" }
  ];

  const matched = items.filter(x => x.status === "Matched");
  const mismatch = items.filter(x => x.status === "Mismatch");
  const missing2b = items.filter(x => x.status === "Missing in 2B");

  const totalBooks = items.reduce((s, x) => s + (x.booksTax || 0), 0);
  const total2b = items.reduce((s, x) => s + (x.gstr2bTax || 0), 0);
  const eligibleClaimed = matched.reduce((s, x) => s + (x.booksTax || 0), 0);
  const heldItc = [...mismatch, ...missing2b].filter(x => x.action === "Hold").reduce((s, x) => s + (x.booksTax || 0), 0);

  const dataRows = items.map(it => [
    it.invoiceNo,
    it.supplier,
    it.gstin,
    it.date,
    it.booksTax,
    it.gstr2bTax,
    Math.abs(it.booksTax - it.gstr2bTax),
    it.status,
    it.action,
    it.reason
  ]);

  const json = {
    report: "ITC Reconciliation",
    period,
    gstin,
    disclaimer: NOTICE_TEXT,
    summary: {
      totalRecords: items.length,
      matchedCount: matched.length,
      mismatchCount: mismatch.length,
      missingIn2BCount: missing2b.length,
      eligibleItcClaimed: eligibleClaimed,
      heldItc: heldItc
    },
    items
  };

  const csvRows = [
    ["ITC Reconciliation (GSTR-2B vs Books)", `Period: ${period}`, `GSTIN: ${gstin}`, NOTICE_TEXT],
    [],
    ["Invoice Number", "Supplier Name", "Supplier GSTIN", "Date", "Books ITC (INR)", "2B ITC (INR)", "Difference (INR)", "Status", "Action", "Reason / Notes"],
    ...dataRows
  ];

  const sheets = [
    {
      name: "Summary",
      data: [
        ["SimpleGST ITC Reconciliation Summary"],
        ["Notice", NOTICE_TEXT],
        ["Entity GSTIN", gstin],
        ["Return Period", period],
        ["Total Invoices Audited", items.length],
        ["Fully Matched Invoices", matched.length],
        ["Value / Date Mismatch Invoices", mismatch.length],
        ["Missing in GSTR-2B (Unfiled)", missing2b.length],
        ["Total ITC in Books", totalBooks],
        ["Total ITC in GSTR-2B", total2b],
        ["Eligible ITC Accepted", eligibleClaimed],
        ["ITC Placed on Hold", heldItc]
      ],
      currencyCols: [1]
    },
    {
      name: "Reconciliation Details",
      data: [
        ["Invoice Number", "Supplier Name", "Supplier GSTIN", "Date", "Books ITC", "2B ITC", "Difference", "Status", "Action", "Reason / Notes"],
        ...dataRows
      ],
      currencyCols: [4, 5, 6]
    }
  ];

  const xlsxBuffer = buildXlsxWorkbook(sheets);
  return { json, csv: toCsv(csvRows), excel: xlsxBuffer };
}

// -------------------------------------------------------------
// Report 4: GSTR-3B Summary
// -------------------------------------------------------------
export function generateGSTR3BReport(taxCalc = {}, gstin = "32ABCDE1234F1Z5", period = "102026") {
  const calc = {
    taxableSales: taxCalc.taxableSales || 1240000,
    outputTax: taxCalc.outputTax || { igst: 122400, cgst: 50400, sgst: 50400, total: 223200 },
    taxablePurchases: taxCalc.taxablePurchases || 785000,
    grossItc: taxCalc.grossItc || 118400,
    heldItc: taxCalc.heldItc || 9600,
    eligibleItc: taxCalc.eligibleItc || { igst: 48000, cgst: 35200, sgst: 35200, total: 118400 },
    netPayable: taxCalc.netPayable || { igst: 74400, cgst: 15200, sgst: 15200, total: 104800 }
  };

  const json = {
    report: "GSTR-3B Summary",
    period,
    gstin,
    disclaimer: NOTICE_TEXT,
    table_3_1_outward: {
      taxableValue: calc.taxableSales,
      igst: calc.outputTax.igst,
      cgst: calc.outputTax.cgst,
      sgst: calc.outputTax.sgst,
      totalTax: calc.outputTax.total
    },
    table_4_itc: {
      grossItc: calc.grossItc,
      heldItc: calc.heldItc,
      eligibleItc: calc.eligibleItc
    },
    table_6_1_payment: {
      payableIgst: calc.netPayable.igst,
      payableCgst: calc.netPayable.cgst,
      payableSgst: calc.netPayable.sgst,
      totalPayable: calc.netPayable.total
    }
  };

  const csvRows = [
    ["GSTR-3B Summary & Tax Computation", `Period: ${period}`, `GSTIN: ${gstin}`, NOTICE_TEXT],
    [],
    ["Section", "Nature of Supply / Credit", "Taxable Value (INR)", "IGST (INR)", "CGST (INR)", "SGST (INR)", "Total Tax (INR)"],
    ["3.1(a)", "Outward taxable supplies (Output liability)", calc.taxableSales, calc.outputTax.igst, calc.outputTax.cgst, calc.outputTax.sgst, calc.outputTax.total],
    ["4(A)", "Input Tax Credit Available (GSTR-2B)", calc.taxablePurchases, calc.eligibleItc.igst, calc.eligibleItc.cgst, calc.eligibleItc.sgst, calc.grossItc],
    ["4(B)", "Less: ITC Held / Ineligible", 0, 0, 0, 0, calc.heldItc],
    ["4(C)", "Net Eligible ITC Offset", calc.taxablePurchases, calc.eligibleItc.igst, calc.eligibleItc.cgst, calc.eligibleItc.sgst, calc.eligibleItc.total],
    ["6.1", "Net Tax Payable via Electronic Cash Ledger", "-", calc.netPayable.igst, calc.netPayable.cgst, calc.netPayable.sgst, calc.netPayable.total]
  ];

  const sheets = [
    {
      name: "Summary",
      data: [
        ["SimpleGST GSTR-3B Summary"],
        ["Notice", NOTICE_TEXT],
        ["Entity GSTIN", gstin],
        ["Return Period", period],
        ["Gross Outward Output Tax", calc.outputTax.total],
        ["Gross Input Tax Credit (ITC)", calc.grossItc],
        ["ITC Placed on Hold", calc.heldItc],
        ["Net Eligible ITC Utilized", calc.eligibleItc.total],
        ["Net Tax Payable (Cash Ledger)", calc.netPayable.total]
      ],
      currencyCols: [1]
    },
    {
      name: "Tax Computation",
      data: [
        ["Section Code", "Description / Nature of Supply", "Taxable Value", "IGST", "CGST", "SGST", "Total Tax"],
        ["3.1(a)", "Outward Taxable Supplies (Output Liability)", calc.taxableSales, calc.outputTax.igst, calc.outputTax.cgst, calc.outputTax.sgst, calc.outputTax.total],
        ["4(A)", "Input Tax Credit Available", calc.taxablePurchases, calc.eligibleItc.igst, calc.eligibleItc.cgst, calc.eligibleItc.sgst, calc.grossItc],
        ["4(B)", "Less: Held / Ineligible Exceptions", 0, 0, 0, 0, calc.heldItc],
        ["4(C)", "Net Eligible ITC Offset", calc.taxablePurchases, calc.eligibleItc.igst, calc.eligibleItc.cgst, calc.eligibleItc.sgst, calc.eligibleItc.total],
        ["6.1", "Net Tax Payable (Cash Ledger)", "-", calc.netPayable.igst, calc.netPayable.cgst, calc.netPayable.sgst, calc.netPayable.total]
      ],
      currencyCols: [2, 3, 4, 5, 6]
    }
  ];

  const xlsxBuffer = buildXlsxWorkbook(sheets);
  return { json, csv: toCsv(csvRows), excel: xlsxBuffer };
}

// -------------------------------------------------------------
// Report 5: Error Report (Same layout as import template + "Error reason")
// -------------------------------------------------------------
export function generateErrorReport(errorRows = []) {
  // Import template layout:
  // Invoice Number, Invoice Date, Party Name, Party GSTIN, Place of Supply, Taxable Value, Rate
  // Plus: "Error reason"
  const dataRows = errorRows.map(err => {
    const r = err.raw || err;
    return [
      r.invoiceNumber || "",
      r.invoiceDate || r.date || "",
      r.partyName || "",
      r.partyGstin || "",
      r.pos || "",
      Number(r.taxableValue ?? r.taxableAmount ?? 0),
      Number(r.rate ?? r.gstRate ?? 18),
      err.errorReason || err.reason || "Validation failed"
    ];
  });

  const json = {
    report: "Error Report",
    disclaimer: NOTICE_TEXT,
    totalErrors: errorRows.length,
    timestamp: new Date().toISOString(),
    errors: dataRows.map(r => ({
      invoiceNumber: r[0],
      invoiceDate: r[1],
      partyName: r[2],
      partyGstin: r[3],
      pos: r[4],
      taxableValue: r[5],
      rate: r[6],
      errorReason: r[7]
    }))
  };

  const csvRows = [
    ["Invoice Number", "Invoice Date", "Party Name", "Party GSTIN", "Place of Supply", "Taxable Value", "Rate", "Error reason"],
    ...dataRows
  ];

  const sheets = [
    {
      name: "Summary",
      data: [
        ["SimpleGST Import Error Report Summary"],
        ["Notice", NOTICE_TEXT],
        ["Generated At", new Date().toISOString()],
        ["Total Erroneous Records", errorRows.length],
        ["Instructions", "Fix the discrepancies in the 'Error Details' sheet and re-upload the file."]
      ]
    },
    {
      name: "Error Details",
      data: [
        ["Invoice Number", "Invoice Date", "Party Name", "Party GSTIN", "Place of Supply", "Taxable Value", "Rate", "Error reason"],
        ...dataRows
      ],
      currencyCols: [5]
    }
  ];

  const xlsxBuffer = buildXlsxWorkbook(sheets);
  return { json, csv: toCsv(csvRows), excel: xlsxBuffer };
}

// -------------------------------------------------------------
// Report 6: Filing History
// -------------------------------------------------------------
export function generateFilingHistoryReport(historyRecords = [], gstin = "32ABCDE1234F1Z5") {
  const records = historyRecords.length > 0 ? historyRecords : [
    { form: "GSTR-1", period: "102026", fy: "2026-27", arn: "AA3210260019281", filingDate: "2026-10-11T14:32:00Z", mode: "Sandbox", status: "FILED" },
    { form: "GSTR-3B", period: "092026", fy: "2026-27", arn: "AA3209260081293", filingDate: "2026-10-20T16:15:00Z", mode: "Sandbox", status: "FILED" },
    { form: "GSTR-1", period: "092026", fy: "2026-27", arn: "AA3209260074120", filingDate: "2026-09-11T11:20:00Z", mode: "Sandbox", status: "FILED" },
    { form: "GSTR-3B", period: "082026", fy: "2026-27", arn: "AA3208260065412", filingDate: "2026-09-20T15:45:00Z", mode: "Sandbox", status: "FILED" }
  ];

  const dataRows = records.map(r => [
    r.form,
    r.period,
    r.fy,
    r.arn,
    r.filingDate,
    r.status,
    r.mode
  ]);

  const json = {
    report: "Filing History",
    gstin,
    disclaimer: NOTICE_TEXT,
    totalFilings: records.length,
    records
  };

  const csvRows = [
    ["Return Filing History", `GSTIN: ${gstin}`, NOTICE_TEXT],
    [],
    ["Return Form", "Return Period", "Financial Year", "ARN", "Filing Date", "Status", "Filing Mode"],
    ...dataRows
  ];

  const sheets = [
    {
      name: "Summary",
      data: [
        ["SimpleGST Filing History Summary"],
        ["Notice", NOTICE_TEXT],
        ["Entity GSTIN", gstin],
        ["Total Filings on Record", records.length],
        ["Latest Filed Period", records[0]?.period || "N/A"],
        ["Latest ARN", records[0]?.arn || "N/A"]
      ]
    },
    {
      name: "Filing Records",
      data: [
        ["Return Form", "Return Period", "Financial Year", "ARN", "Filing Date", "Status", "Filing Mode"],
        ...dataRows
      ]
    }
  ];

  const xlsxBuffer = buildXlsxWorkbook(sheets);
  return { json, csv: toCsv(csvRows), excel: xlsxBuffer };
}

// -------------------------------------------------------------
// Retained Report 7: GSTR-1
// -------------------------------------------------------------
export function generateGSTR1Report(salesInvoices = [], gstin = "32ABCDE1234F1Z5", period = "102026") {
  const b2b = [];
  let totalTaxable = 0, totalIgst = 0, totalCgst = 0, totalSgst = 0;

  for (const inv of salesInvoices) {
    const taxable = Number(inv.taxableAmount ?? inv.taxableValue ?? 0);
    const igst = Number(inv.igst || 0);
    const cgst = Number(inv.cgst || 0);
    const sgst = Number(inv.sgst || 0);
    totalTaxable += taxable;
    totalIgst += igst;
    totalCgst += cgst;
    totalSgst += sgst;

    b2b.push({
      inum: inv.invoiceNumber,
      idt: inv.date || inv.invoiceDate,
      val: taxable + igst + cgst + sgst,
      pos: inv.pos || (inv.isInterState ? "27" : gstin.substring(0, 2)),
      rchrg: "N",
      inv_typ: "R",
      partyName: inv.partyName,
      ctin: inv.partyGstin || inv.recipientGstin,
      itms: [{
        num: 1,
        itm_det: { rt: inv.gstRate ?? inv.rate ?? 18, txval: taxable, iamt: igst, camt: cgst, samt: sgst, csamt: 0 }
      }]
    });
  }

  const json = {
    gstin,
    fp: period,
    gt: totalTaxable + totalIgst + totalCgst + totalSgst,
    cur_gt: totalTaxable,
    version: "GSTR1_v3.0.4",
    disclaimer: NOTICE_TEXT,
    b2b,
    summary: {
      totalInvoices: b2b.length,
      totalTaxableValue: totalTaxable,
      totalIgst,
      totalCgst,
      totalSgst,
      totalTax: totalIgst + totalCgst + totalSgst,
      totalAmount: totalTaxable + totalIgst + totalCgst + totalSgst
    }
  };

  const csvRows = [
    ["GSTR-1 Outward Supplies Register", `Period: ${period}`, `GSTIN: ${gstin}`, NOTICE_TEXT],
    [],
    ["Invoice No", "Date", "Recipient GSTIN", "Recipient Name", "POS", "Taxable Value", "Rate (%)", "IGST", "CGST", "SGST", "Total Value"]
  ];
  const dataRows = [];
  for (const inv of b2b) {
    const itm = inv.itms[0].itm_det;
    const row = [inv.inum, inv.idt, inv.ctin, inv.partyName || "", inv.pos, itm.txval, itm.rt, itm.iamt, itm.camt, itm.samt, inv.val];
    csvRows.push(row);
    dataRows.push(row);
  }

  const sheets = [
    {
      name: "Summary",
      data: [
        ["SimpleGST GSTR-1 Summary"],
        ["Notice", NOTICE_TEXT],
        ["Entity GSTIN", gstin],
        ["Return Period", period],
        ["Total B2B Invoices", b2b.length],
        ["Total Taxable Value", totalTaxable],
        ["Total Output Tax", totalIgst + totalCgst + totalSgst],
        ["Total Invoice Value", totalTaxable + totalIgst + totalCgst + totalSgst]
      ],
      currencyCols: [1]
    },
    {
      name: "B2B Invoices",
      data: [
        ["Invoice No", "Date", "Recipient GSTIN", "Recipient Name", "POS", "Taxable Value", "Rate (%)", "IGST", "CGST", "SGST", "Total Value"],
        ...dataRows
      ],
      currencyCols: [5, 7, 8, 9, 10]
    }
  ];

  const xlsxBuffer = buildXlsxWorkbook(sheets);
  return { json, csv: toCsv(csvRows), excel: xlsxBuffer };
}

// -------------------------------------------------------------
// Retained Report 8: ITR-1 Sahaj (with AY selector support)
// -------------------------------------------------------------
export function generateITR1Report(userData = {}, assessmentYear = "2025-26") {
  const ay = userData.assessmentYear || assessmentYear || "2025-26";
  const regime = userData.taxRegime || "NEW";
  const safeData = {
    personalInfo: userData.personalInfo || { firstName: "Rohan", lastName: "Sharma", pan: "ABCDE1234F" },
    income: userData.income || { grossSalary: 1650000, housePropertyIncome: -180000, otherIncome: 45000, taxesPaid: { tds: 140000, advanceTax: 15000 } },
    taxRegime: regime,
    assessmentYear: ay
  };

  const taxComp = computeTaxForAy(safeData.income, safeData.taxRegime, ay);
  const jsonResult = generateITRJson(safeData);

  const csvRows = [
    ["Income Tax Return Computation Statement", `AY: ${ay}`, `Regime: ${regime}`, NOTICE_TEXT],
    [],
    ["Particulars", "Amount (INR)", "Regime", "Notes"],
    ["Gross Salary Income", taxComp.grossSalary, regime, "Form 16"],
    ["Standard Deduction u/s 16(ia)", taxComp.standardDeduction, regime, "Statutory deduction"],
    ["Gross Total Income (GTI)", taxComp.grossTotalIncome, regime, "Sum of income heads"],
    ["Chapter VI-A Deductions", taxComp.totalDeductions, regime, regime === "NEW" ? "Nil in New Regime" : "80C, 80D"],
    ["Net Taxable Total Income", taxComp.netTaxableIncome, regime, "Tax base"],
    ["Calculated Slab Tax", taxComp.calculatedTax, regime, `AY ${ay} slabs`],
    ["Health & Education Cess (4%)", taxComp.cess, regime, "4% cess"],
    ["Total Tax Liability", taxComp.totalTaxWithCess, regime, "Tax + Cess"],
    ["Taxes Paid (TDS & Advance)", taxComp.totalTaxesPaid, regime, "Form 26AS"],
    ["Net Tax Payable / (Refund)", taxComp.netTaxPayable > 0 ? taxComp.netTaxPayable : -taxComp.refundDue, regime, taxComp.netTaxPayable > 0 ? "Payable" : "Refund Due"]
  ];

  const sheets = [
    {
      name: "Summary",
      data: [
        ["SimpleGST ITR-1 Computation Summary"],
        ["Notice", NOTICE_TEXT],
        ["Assessment Year (AY)", ay],
        ["Filing Regime", regime],
        ["Assessee PAN", safeData.personalInfo.pan],
        ["Gross Total Income", taxComp.grossTotalIncome],
        ["Total Deductions", taxComp.totalDeductions],
        ["Net Taxable Total Income", taxComp.netTaxableIncome],
        ["Total Tax Liability", taxComp.totalTaxWithCess],
        ["Total Taxes Paid", taxComp.totalTaxesPaid],
        ["Net Tax Balance", taxComp.netTaxPayable > 0 ? taxComp.netTaxPayable : -taxComp.refundDue]
      ],
      currencyCols: [1]
    },
    {
      name: "Computation Details",
      data: [
        ["Particulars", "Amount", "Regime", "Notes"],
        ["Gross Salary Income", taxComp.grossSalary, regime, "Form 16"],
        ["Standard Deduction", taxComp.standardDeduction, regime, "Statutory"],
        ["Gross Total Income", taxComp.grossTotalIncome, regime, "Total"],
        ["Deductions (80C/80D)", taxComp.totalDeductions, regime, ""],
        ["Net Taxable Income", taxComp.netTaxableIncome, regime, ""],
        ["Base Slab Tax", taxComp.calculatedTax, regime, ""],
        ["Health & Education Cess", taxComp.cess, regime, "4%"],
        ["Total Tax Liability", taxComp.totalTaxWithCess, regime, ""],
        ["Taxes Paid", taxComp.totalTaxesPaid, regime, ""],
        ["Net Payable / (Refund)", taxComp.netTaxPayable > 0 ? taxComp.netTaxPayable : -taxComp.refundDue, regime, ""]
      ],
      currencyCols: [1]
    }
  ];

  const xlsxBuffer = buildXlsxWorkbook(sheets);
  return { json: { ...jsonResult.rawObject, taxComputation: taxComp, disclaimer: NOTICE_TEXT }, csv: toCsv(csvRows), excel: xlsxBuffer };
}

// -------------------------------------------------------------
// Unified Export Dispatcher
// -------------------------------------------------------------
export function exportReport(reportType, format = "xlsx", contextData = {}) {
  const normType = String(reportType || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const normFmt = String(format || "xlsx").toLowerCase();

  let generated;
  let filenamePrefix = "Report";

  switch (normType) {
    case "salesregister":
    case "sales":
      generated = generateSalesRegisterReport(
        contextData.salesInvoices || [],
        contextData.gstin || "32ABCDE1234F1Z5",
        contextData.period || "102026"
      );
      filenamePrefix = `Sales_Register_${contextData.period || "102026"}`;
      break;

    case "purchaseregister":
    case "purchase":
    case "purchases":
      generated = generatePurchaseRegisterReport(
        contextData.purchaseInvoices || [],
        contextData.gstin || "32ABCDE1234F1Z5",
        contextData.period || "102026"
      );
      filenamePrefix = `Purchase_Register_${contextData.period || "102026"}`;
      break;

    case "reconciliation":
    case "recon":
    case "itcreconciliation":
    case "gstr2b":
      generated = generateReconciliationReport(
        contextData.reconData || {},
        contextData.gstin || "32ABCDE1234F1Z5",
        contextData.period || "102026"
      );
      filenamePrefix = `ITC_Reconciliation_${contextData.period || "102026"}`;
      break;

    case "gstr3b":
    case "gstr3bsummary":
      generated = generateGSTR3BReport(
        contextData.taxCalc || {},
        contextData.gstin || "32ABCDE1234F1Z5",
        contextData.period || "102026"
      );
      filenamePrefix = `GSTR3B_Summary_${contextData.period || "102026"}`;
      break;

    case "errorreport":
    case "errors":
      generated = generateErrorReport(contextData.errorRows || []);
      filenamePrefix = `Import_Error_Report_${Date.now()}`;
      break;

    case "filinghistory":
    case "history":
      generated = generateFilingHistoryReport(
        contextData.historyRecords || [],
        contextData.gstin || "32ABCDE1234F1Z5"
      );
      filenamePrefix = `Filing_History_${contextData.gstin || "32ABCDE1234F1Z5"}`;
      break;

    case "gstr1":
      generated = generateGSTR1Report(
        contextData.salesInvoices || [],
        contextData.gstin || "32ABCDE1234F1Z5",
        contextData.period || "102026"
      );
      filenamePrefix = `GSTR1_${contextData.gstin || "32ABCDE1234F1Z5"}_${contextData.period || "102026"}`;
      break;

    case "itr1":
    case "itr":
    case "sahaj":
      generated = generateITR1Report(
        contextData.itrData || {},
        contextData.assessmentYear || "2025-26"
      );
      filenamePrefix = `ITR1_${contextData.itrData?.personalInfo?.pan || "PAN"}_AY${contextData.assessmentYear || "2025-26"}`;
      break;

    default:
      throw new Error(`Unknown report type: '${reportType}'. Supported: sales_register, purchase_register, reconciliation, gstr3b, error_report, filing_history, gstr1, itr1.`);
  }

  if (normFmt === "json") {
    const content = typeof generated.json === "string" ? generated.json : JSON.stringify(generated.json, null, 2);
    return {
      contentType: "application/json; charset=utf-8",
      filename: `${filenamePrefix}.json`,
      content: Buffer.from(content, "utf8"),
      size: Buffer.byteLength(content, "utf8"),
      rowCount: generated.json?.invoices?.length || generated.json?.purchases?.length || generated.json?.items?.length || 1
    };
  } else if (normFmt === "excel" || normFmt === "xlsx" || normFmt === "xls") {
    return {
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      filename: `${filenamePrefix}.xlsx`,
      content: generated.excel, // Real binary Buffer from SheetJS
      size: generated.excel.length,
      rowCount: generated.json?.totalRecords || generated.json?.totalErrors || 10
    };
  } else if (normFmt === "csv") {
    return {
      contentType: "text/csv; charset=utf-8",
      filename: `${filenamePrefix}.csv`,
      content: Buffer.from(generated.csv, "utf8"),
      size: Buffer.byteLength(generated.csv, "utf8"),
      rowCount: generated.csv.split("\r\n").length
    };
  } else {
    throw new Error(`Unsupported format: '${format}'. Allowed formats: xlsx/excel, csv, json.`);
  }
}
