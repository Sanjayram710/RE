/**
 * CSV Export Engine - High Performance RFC 4180 Escaped Exporter
 * Generates comma-separated records for bulk upload / ingestion into ERPs & Excel
 */

function escapeCsvField(val) {
  if (val === null || val === undefined) return '""';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return `"${str}"`;
}

export function generateITRCsv(userData, taxComp) {
  const rows = [
    ["SimpleGST Income Tax Return Computation Report - Demo files. Not official GST portal or income tax portal files."],
    ["Generated At", new Date().toISOString()],
    ["Assessee Name", `${userData.personalInfo?.firstName || ""} ${userData.personalInfo?.lastName || ""}`.trim()],
    ["PAN", userData.personalInfo?.pan || ""],
    ["Assessment Year", userData.assessmentYear || "2025-26"],
    ["Filing Regime", userData.taxRegime || "NEW"],
    [],
    ["Head of Income / Calculation", "Amount (INR)", "Regime", "Notes"],
    ["Gross Salary Income", userData.income?.grossSalary || 0, userData.taxRegime, "Form 16"],
    ["Standard Deduction u/s 16(ia)", taxComp.standardDeduction, userData.taxRegime, "Statutory deduction"],
    ["Income from House Property", userData.income?.housePropertyIncome || 0, userData.taxRegime, "Rental / Loan interest"],
    ["Income from Other Sources", userData.income?.otherIncome || 0, userData.taxRegime, "Savings / FD Interest"],
    ["Gross Total Income (GTI)", taxComp.grossTotalIncome, userData.taxRegime, "Total income before 80C"],
    ["Chapter VI-A Deductions", taxComp.totalDeductions, userData.taxRegime, "80C, 80D (Old Regime only)"],
    ["Net Taxable Total Income", taxComp.netTaxableIncome, userData.taxRegime, "Income subject to slab rates"],
    ["Calculated Slab Tax", taxComp.calculatedTax, userData.taxRegime, "AY 2025-26 rates"],
    ["Health & Education Cess (4%)", taxComp.cess, userData.taxRegime, "4% cess"],
    ["Total Tax Liability", taxComp.totalTaxWithCess, userData.taxRegime, "Tax + Cess"],
    ["Taxes Paid (TDS & Advance)", taxComp.totalTaxesPaid, userData.taxRegime, "Form 26AS"],
    ["Net Tax Payable / (Refund)", taxComp.netTaxPayable > 0 ? taxComp.netTaxPayable : -taxComp.refundDue, userData.taxRegime, taxComp.netTaxPayable > 0 ? "Payable" : "Refund Due"]
  ];

  return rows.map(r => r.map(escapeCsvField).join(",")).join("\r\n");
}

export function generateGSTCsv(gstData) {
  const gstin = gstData.gstin || "";
  const invoices = gstData.b2bInvoices || [];

  const headers = [
    "Invoice Number",
    "Invoice Date",
    "Recipient GSTIN",
    "Recipient Trade Name",
    "Place of Supply",
    "Taxable Value (INR)",
    "Rate (%)",
    "IGST (INR)",
    "CGST (INR)",
    "SGST (INR)",
    "Total Invoice Value (INR)"
  ];

  const rows = [headers];

  for (const inv of invoices) {
    const taxable = Number(inv.taxableValue || 0);
    const rate = Number(inv.rate || 18);
    const isInterState = inv.pos !== gstin.substring(0, 2);
    const igst = isInterState ? Math.round(taxable * (rate / 100)) : 0;
    const cgst = !isInterState ? Math.round(taxable * (rate / 200)) : 0;
    const sgst = !isInterState ? Math.round(taxable * (rate / 200)) : 0;
    const total = taxable + igst + cgst + sgst;

    rows.push([
      inv.invoiceNumber,
      inv.invoiceDate,
      inv.recipientGstin,
      inv.recipientName || "Customer Enterprise",
      inv.pos || "29",
      taxable,
      rate,
      igst,
      cgst,
      sgst,
      total
    ]);
  }

  return rows.map(r => r.map(escapeCsvField).join(",")).join("\r\n");
}

