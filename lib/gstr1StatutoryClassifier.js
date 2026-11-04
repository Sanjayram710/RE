/**
 * GSTR-1 Statutory Multi-Table Invoice Classifier & Validator
 * 
 * Statutory References:
 * - CGST Act Section 37: Furnishing details of outward supplies
 * - CGST Rules Form GSTR-1: Statutory table layout
 * - CBIC Notification No. 12/2024-Central Tax (10-07-2024): Reduced B2CL threshold from ₹2,50,000 to ₹1,00,000
 * - CBIC Notification No. 78/2020-Central Tax: Mandatory 4/6-digit HSN reporting in Table 12
 * - CGST Rule 59: Form and manner of furnishing details of outward supplies
 */

export const B2CL_STATUTORY_THRESHOLD = 100000; // ₹1,00,000 w.e.f. 10-07-2024

function round2(val) {
  return Math.round((Number(val) || 0) * 100) / 100;
}

export function isValidGstin(gstin) {
  if (!gstin || typeof gstin !== 'string') return false;
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(gstin.trim().toUpperCase());
}

/**
 * Classifies an outward supply invoice into its exact statutory GSTR-1 table.
 * @param {Object} invoice 
 * @param {string} supplierStateCode 2-digit state code of supplier
 * @returns {Object} Classified record with statutory table identifier and metadata
 */
export function classifyOutwardInvoice(invoice, supplierStateCode = '32') {
  const recipientGstin = (invoice.recipientGstin || invoice.customerGstin || invoice.gstin || '').trim().toUpperCase();
  const isRegisteredRecipient = isValidGstin(recipientGstin);
  const pos = (invoice.pos || invoice.placeOfSupply || (isRegisteredRecipient ? recipientGstin.slice(0, 2) : supplierStateCode)).trim();
  const isInterstate = pos !== supplierStateCode;
  const invType = (invoice.invoiceType || invoice.type || 'REGULAR').toUpperCase();
  const invoiceValue = round2(invoice.totalValue || invoice.invoiceValue || ((invoice.taxableValue || 0) + (invoice.taxAmount || 0)));
  const taxableValue = round2(invoice.taxableValue || 0);
  const igst = round2(invoice.igst || (isInterstate ? invoice.taxAmount : 0) || 0);
  const cgst = round2(invoice.cgst || (!isInterstate ? (invoice.taxAmount || 0) / 2 : 0) || 0);
  const sgst = round2(invoice.sgst || (!isInterstate ? (invoice.taxAmount || 0) / 2 : 0) || 0);
  const cess = round2(invoice.cess || 0);

  let targetTable = 'TABLE_4_B2B';
  let tableCode = '4A';
  let tableDescription = 'B2B Supplies to registered persons (other than reverse charge)';

  if (invType === 'CREDIT_NOTE' || invType === 'DEBIT_NOTE' || invoice.documentType === 'CR' || invoice.documentType === 'DR') {
    if (isRegisteredRecipient) {
      targetTable = 'TABLE_9B_CDNR';
      tableCode = '9B';
      tableDescription = 'Credit / Debit Notes issued to registered persons';
    } else {
      targetTable = 'TABLE_9B_CDNUR';
      tableCode = '9B_UR';
      tableDescription = 'Credit / Debit Notes issued to unregistered persons (Large)';
    }
  } else if (invType === 'EXPORT' || invoice.isExport) {
    targetTable = 'TABLE_6A_EXPORT';
    tableCode = '6A';
    tableDescription = 'Export Invoices (with/without payment of tax)';
  } else if (invType === 'SEZ' || invoice.isSez) {
    targetTable = 'TABLE_6B_SEZ';
    tableCode = '6B';
    tableDescription = 'Supplies to SEZ Unit / Developer';
  } else if (invoice.isNilRated || invoice.isExempt || invoice.isNonGst) {
    targetTable = 'TABLE_8_NIL_EXEMPT';
    tableCode = '8';
    tableDescription = 'Nil rated, exempted and non-GST outward supplies';
  } else if (isRegisteredRecipient) {
    if (invoice.isRcm || invoice.reverseCharge) {
      targetTable = 'TABLE_4B_B2B_RCM';
      tableCode = '4B';
      tableDescription = 'B2B Supplies attracting Reverse Charge u/s 9(3)';
    } else if (invoice.isEco || invoice.ecommerce) {
      targetTable = 'TABLE_4C_B2B_ECO';
      tableCode = '4C';
      tableDescription = 'B2B Supplies through E-Commerce Operator';
    } else {
      targetTable = 'TABLE_4A_B2B_REGULAR';
      tableCode = '4A';
      tableDescription = 'B2B Supplies to registered persons';
    }
  } else {
    // Unregistered Recipient (B2C)
    if (isInterstate && invoiceValue > B2CL_STATUTORY_THRESHOLD) {
      targetTable = 'TABLE_5_B2CL';
      tableCode = '5A';
      tableDescription = `B2C (Large) Inter-state supplies with invoice value > ₹1,00,000 (Notif 12/2024-CT)`;
    } else {
      targetTable = 'TABLE_7_B2CS';
      tableCode = isInterstate ? '7B' : '7A';
      tableDescription = isInterstate 
        ? 'B2C (Small) Inter-state supplies <= ₹1,00,000' 
        : 'B2C (Small) Intra-state supplies (any value)';
    }
  }

  return {
    invoiceNumber: invoice.invoiceNumber || invoice.invNo || invoice.id,
    invoiceDate: invoice.invoiceDate || invoice.date,
    recipientGstin: isRegisteredRecipient ? recipientGstin : 'UNREGISTERED',
    pos,
    isInterstate,
    hsnCode: invoice.hsnCode || invoice.hsn || '998311',
    financials: {
      taxableValue,
      igst,
      cgst,
      sgst,
      cess,
      invoiceValue
    },
    classification: {
      targetTable,
      tableCode,
      tableDescription,
      statutoryAuthority: tableCode === '5A' 
        ? 'Notification No. 12/2024-Central Tax (Threshold ₹1,00,000)' 
        : 'CGST Rules Form GSTR-1'
    }
  };
}

/**
 * Classifies an entire sales register into complete statutory GSTR-1 tables.
 * @param {Array} invoices 
 * @param {string} supplierGstin 
 * @returns {Object} Statutory GSTR-1 payload structured for verification and filing
 */
export function classifySalesRegisterForGstr1(invoices = [], supplierGstin = '32ABCDE1234F1Z5') {
  const supplierStateCode = supplierGstin ? supplierGstin.slice(0, 2) : '32';
  
  const tables = {
    table4_b2b: [],
    table5_b2cl: [],
    table6_export_sez: [],
    table7_b2cs: [],
    table8_nil_exempt: [],
    table9_cdnr: [],
    table12_hsn: {},
    table13_docs: {
      totalCount: 0,
      cancelledCount: 0,
      netIssued: 0
    }
  };

  const summary = {
    totalInvoices: invoices.length,
    totalTaxableValue: 0,
    totalIgst: 0,
    totalCgst: 0,
    totalSgst: 0,
    totalCess: 0,
    totalInvoiceValue: 0
  };

  for (const inv of invoices) {
    const classified = classifyOutwardInvoice(inv, supplierStateCode);
    const fin = classified.financials;

    summary.totalTaxableValue = round2(summary.totalTaxableValue + fin.taxableValue);
    summary.totalIgst = round2(summary.totalIgst + fin.igst);
    summary.totalCgst = round2(summary.totalCgst + fin.cgst);
    summary.totalSgst = round2(summary.totalSgst + fin.sgst);
    summary.totalCess = round2(summary.totalCess + fin.cess);
    summary.totalInvoiceValue = round2(summary.totalInvoiceValue + fin.invoiceValue);

    tables.table13_docs.totalCount++;
    tables.table13_docs.netIssued++;

    const hsn = classified.hsnCode;
    if (!tables.table12_hsn[hsn]) {
      tables.table12_hsn[hsn] = { hsn, taxableValue: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, totalValue: 0 };
    }
    tables.table12_hsn[hsn].taxableValue = round2(tables.table12_hsn[hsn].taxableValue + fin.taxableValue);
    tables.table12_hsn[hsn].igst = round2(tables.table12_hsn[hsn].igst + fin.igst);
    tables.table12_hsn[hsn].cgst = round2(tables.table12_hsn[hsn].cgst + fin.cgst);
    tables.table12_hsn[hsn].sgst = round2(tables.table12_hsn[hsn].sgst + fin.sgst);
    tables.table12_hsn[hsn].cess = round2(tables.table12_hsn[hsn].cess + fin.cess);
    tables.table12_hsn[hsn].totalValue = round2(tables.table12_hsn[hsn].totalValue + fin.invoiceValue);

    const tt = classified.classification.targetTable;
    if (tt.startsWith('TABLE_4')) {
      tables.table4_b2b.push(classified);
    } else if (tt.startsWith('TABLE_5')) {
      tables.table5_b2cl.push(classified);
    } else if (tt.startsWith('TABLE_6')) {
      tables.table6_export_sez.push(classified);
    } else if (tt.startsWith('TABLE_7')) {
      tables.table7_b2cs.push(classified);
    } else if (tt.startsWith('TABLE_8')) {
      tables.table8_nil_exempt.push(classified);
    } else if (tt.startsWith('TABLE_9')) {
      tables.table9_cdnr.push(classified);
    } else {
      tables.table4_b2b.push(classified);
    }
  }

  return {
    supplierGstin,
    supplierStateCode,
    summary,
    tables: {
      ...tables,
      table12_hsn: Object.values(tables.table12_hsn)
    },
    statutoryCompliance: {
      b2clThresholdApplied: B2CL_STATUTORY_THRESHOLD,
      hsnSummaryIncluded: true,
      documentRegistryMaintained: true
    }
  };
}
