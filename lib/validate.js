/**
 * Validation Engine for Indian Tax Identifiers and Invoices
 * Strict format rules, state code verification, and invoice integrity.
 */

export const VALID_STATE_CODES = new Set([
  "01", "02", "03", "04", "05", "06", "07", "08", "09", "10",
  "11", "12", "13", "14", "15", "16", "17", "18", "19", "20",
  "21", "22", "23", "24", "25", "26", "27", "28", "29", "30",
  "31", "32", "33", "34", "35", "36", "37", "38", "97", "99"
]);

/**
 * Validates a 10-character Permanent Account Number (PAN)
 * Format: 5 uppercase letters, 4 digits, 1 uppercase letter (e.g. ABCDE1234F)
 */
export function validatePan(pan) {
  if (!pan || typeof pan !== "string") {
    return { valid: false, message: "PAN cannot be empty" };
  }
  const cleanPan = pan.trim().toUpperCase();
  if (cleanPan.length !== 10) {
    return { valid: false, message: `PAN must be exactly 10 characters (found ${cleanPan.length})` };
  }
  const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
  if (!panRegex.test(cleanPan)) {
    return { valid: false, message: "Invalid PAN format. Must be 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F)" };
  }
  return { valid: true, pan: cleanPan };
}

/**
 * Validates a 15-character Goods and Services Tax Identification Number (GSTIN)
 * Format: 2-digit state code + 10-char PAN + 1 entity code + 'Z' + 1 checksum char
 */
export function validateGstin(gstin) {
  if (!gstin || typeof gstin !== "string") {
    return { valid: false, message: "GSTIN cannot be empty" };
  }
  const cleanGstin = gstin.trim().toUpperCase();
  if (cleanGstin.length !== 15) {
    return { valid: false, message: `GSTIN must be exactly 15 characters (found ${cleanGstin.length})` };
  }

  const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
  if (!gstinRegex.test(cleanGstin)) {
    return { valid: false, message: "Invalid GSTIN format (e.g. 32ABCDE1234F1Z5)" };
  }

  const stateCode = cleanGstin.substring(0, 2);
  if (!VALID_STATE_CODES.has(stateCode)) {
    return { valid: false, message: `Invalid GST state code '${stateCode}'. Must be a valid Indian state/UT code (01-38, 97, 99)` };
  }

  const panPart = cleanGstin.substring(2, 12);
  const panValidation = validatePan(panPart);
  if (!panValidation.valid) {
    return { valid: false, message: `Invalid embedded PAN '${panPart}' in GSTIN` };
  }

  return { valid: true, gstin: cleanGstin, stateCode, pan: panPart };
}

/**
 * Validates an invoice row for sales/purchase ingestion
 */
export function validateInvoiceRow(row, ownGstin = "32ABCDE1234F1Z5") {
  const errors = [];
  const ownState = ownGstin.substring(0, 2);

  // 1. Invoice Number
  const invoiceNumber = String(row.invoiceNumber || row.billNumber || row.inum || row["Invoice Number"] || "").trim();
  if (!invoiceNumber) {
    errors.push("Invoice number is mandatory");
  } else if (!/^[a-zA-Z0-9\/-]{1,16}$/.test(invoiceNumber)) {
    errors.push("Invoice number must be 1-16 characters and contain only alphanumeric, slash (/), or dash (-)");
  }

  // 2. Invoice Date
  const invoiceDate = String(row.invoiceDate || row.date || row.idt || row["Invoice Date"] || "").trim();
  if (!invoiceDate) {
    errors.push("Invoice date is mandatory");
  } else {
    const dateObj = new Date(invoiceDate);
    if (isNaN(dateObj.getTime()) && !/^\d{2}[-\/]\d{2}[-\/]\d{4}$/.test(invoiceDate)) {
      errors.push("Invalid invoice date format. Use YYYY-MM-DD or DD-MM-YYYY");
    }
  }

  // 3. Party Name
  const partyName = String(row.partyName || row["Party Name"] || row["Recipient Trade Name"] || row["Supplier Name"] || "").trim();
  if (!partyName) {
    errors.push("Party/Business name is mandatory");
  }

  // 4. Party GSTIN
  const partyGstin = String(row.partyGstin || row["Party GSTIN"] || row["Recipient GSTIN"] || row["Supplier GSTIN"] || "").trim().toUpperCase();
  let partyState = ownState;
  if (partyGstin) {
    const gstinRes = validateGstin(partyGstin);
    if (!gstinRes.valid) {
      errors.push(`Party GSTIN error: ${gstinRes.message}`);
    } else {
      partyState = gstinRes.stateCode;
    }
  } else if (row.type !== "B2C") {
    errors.push("Party GSTIN is mandatory for B2B invoices");
  }

  // 5. Place of Supply (POS)
  const pos = String(row.pos || row["Place of Supply"] || partyState).padStart(2, "0");
  if (!VALID_STATE_CODES.has(pos)) {
    errors.push(`Invalid Place of Supply code '${pos}'`);
  }

  // 6. Taxable Value
  const taxableValue = Number(row.taxableValue ?? row.taxableAmount ?? row["Taxable Value"] ?? row["Taxable Amount"]);
  if (isNaN(taxableValue) || taxableValue < 0) {
    errors.push("Taxable value must be a non-negative number");
  }

  // 7. GST Rate
  const rate = Number(row.rate ?? row.gstRate ?? row["GST Rate"] ?? row["Rate (%)"] ?? 18);
  const validRates = [0, 5, 12, 18, 28];
  if (!validRates.includes(rate)) {
    errors.push(`Invalid GST rate '${rate}%'. Allowed rates: 0%, 5%, 12%, 18%, 28%`);
  }

  // 8. Tax Amounts consistency
  const isInterState = pos !== ownState;
  const expectedIgst = isInterState ? Math.round(taxableValue * (rate / 100)) : 0;
  const expectedCgst = !isInterState ? Math.round(taxableValue * (rate / 200)) : 0;
  const expectedSgst = !isInterState ? Math.round(taxableValue * (rate / 200)) : 0;

  const igst = Number(row.igst ?? (isInterState ? expectedIgst : 0));
  const cgst = Number(row.cgst ?? (!isInterState ? expectedCgst : 0));
  const sgst = Number(row.sgst ?? (!isInterState ? expectedSgst : 0));

  if (isInterState && (cgst > 0 || sgst > 0)) {
    errors.push("Inter-state supply cannot have CGST or SGST; only IGST applies");
  }
  if (!isInterState && igst > 0) {
    errors.push("Intra-state supply cannot have IGST; CGST and SGST must apply");
  }

  return {
    valid: errors.length === 0,
    errors,
    sanitized: {
      invoiceNumber,
      invoiceDate,
      partyName,
      partyGstin,
      pos,
      taxableValue: Math.round(taxableValue || 0),
      rate,
      isInterState,
      igst,
      cgst,
      sgst,
      totalTax: igst + cgst + sgst,
      totalAmount: Math.round(taxableValue || 0) + igst + cgst + sgst
    }
  };
}
