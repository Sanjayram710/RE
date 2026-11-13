/**
 * SimpleGST GSTR-2B Parser
 * Supports official GSTN JSON format, GSTN Excel format (.xlsx / .xls), and standard CSV.
 * Normalizes supplier records and extracts statutory ITC fields.
 */

import * as XLSX from "xlsx";

/**
 * Clean and normalize string
 */
function cleanStr(val) {
  if (val === undefined || val === null) return "";
  return String(val).trim();
}

/**
 * Parse numeric currency values safely
 */
function parseNum(val) {
  if (val === undefined || val === null || val === "") return 0;
  if (typeof val === "number") return isNaN(val) ? 0 : Math.round(val * 100) / 100;
  const cleaned = String(val).replace(/[^0-9.-]+/g, "");
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : Math.round(parsed * 100) / 100;
}

/**
 * Standardize dates to YYYY-MM-DD
 */
function parseDate(val) {
  if (!val) return new Date().toISOString().split("T")[0];
  if (val instanceof Date) {
    if (!isNaN(val.getTime())) return val.toISOString().split("T")[0];
  }
  const str = cleanStr(val);
  // DD-MM-YYYY or DD/MM/YYYY
  const ddmmyyyy = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (ddmmyyyy) {
    const day = ddmmyyyy[1].padStart(2, "0");
    const month = ddmmyyyy[2].padStart(2, "0");
    const year = ddmmyyyy[3];
    return `${year}-${month}-${day}`;
  }
  // YYYY-MM-DD
  const yyyymmdd = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (yyyymmdd) {
    const year = yyyymmdd[1];
    const month = yyyymmdd[2].padStart(2, "0");
    const day = yyyymmdd[3].padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  // Fallback to Date parser
  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    return d.toISOString().split("T")[0];
  }
  return new Date().toISOString().split("T")[0];
}

/**
 * Parse GSTR-2B from raw JSON string or parsed object
 */
export function parseGstr2bJson(input) {
  let data = input;
  if (typeof input === "string") {
    try {
      data = JSON.parse(input);
    } catch (err) {
      return { valid: false, error: "Invalid JSON format: " + err.message, records: [] };
    }
  }

  const records = [];

  // Case 1: Standard GSTN portal download structure
  // { data: { docdata: { b2b: [ { ctin: "...", trdNm: "...", inv: [ ... ] } ] } } }
  const docdata = data?.data?.docdata || data?.docdata || data;
  const b2bList = docdata?.b2b || (Array.isArray(docdata) ? docdata : null);

  if (Array.isArray(b2bList)) {
    for (const supplier of b2bList) {
      const supplierGstin = cleanStr(supplier.ctin || supplier.supplierGstin || supplier.supplier_gstin).toUpperCase();
      const supplierName = cleanStr(supplier.trdNm || supplier.lglNm || supplier.supplierName || supplier.supplier_name || "Supplier");
      const invoices = Array.isArray(supplier.inv) ? supplier.inv : (Array.isArray(supplier.invoices) ? supplier.invoices : [supplier]);

      for (const inv of invoices) {
        const invNum = cleanStr(inv.inum || inv.invoiceNumber || inv.invoice_number);
        if (!invNum) continue;

        const invDate = parseDate(inv.dt || inv.invoiceDate || inv.invoice_date);
        const itcAvailable = cleanStr(inv.itcavl || inv.itcAvailable || inv.itc_available || "Y").toUpperCase() === "N" ? "N" : "Y";
        const filingDate = parseDate(inv.filingDate || inv.filing_date || inv.dt);

        let taxableValue = 0;
        let igst = 0;
        let cgst = 0;
        let sgst = 0;
        let cess = 0;

        if (Array.isArray(inv.items) && inv.items.length > 0) {
          for (const it of inv.items) {
            const itDet = it.itmdet || it;
            taxableValue += parseNum(itDet.txval || itDet.taxable_value || itDet.taxableValue);
            igst += parseNum(itDet.iamt || itDet.igst);
            cgst += parseNum(itDet.camt || itDet.cgst);
            sgst += parseNum(itDet.samt || itDet.sgst);
            cess += parseNum(itDet.csamt || itDet.cess);
          }
        } else {
          taxableValue = parseNum(inv.val || inv.taxableValue || inv.taxable_value || inv.taxableAmount || inv.taxable_amount);
          igst = parseNum(inv.igst || inv.iamt);
          cgst = parseNum(inv.cgst || inv.camt);
          sgst = parseNum(inv.sgst || inv.samt);
          cess = parseNum(inv.cess || inv.csamt);

          // If only total value and tax rates are present
          if (taxableValue > 0 && igst === 0 && cgst === 0 && sgst === 0) {
            const totTax = parseNum(inv.totalTax || inv.total_tax);
            if (totTax > 0) {
              cgst = Math.round((totTax / 2) * 100) / 100;
              sgst = Math.round((totTax - cgst) * 100) / 100;
            }
          }
        }

        taxableValue = Math.round(taxableValue * 100) / 100;
        igst = Math.round(igst * 100) / 100;
        cgst = Math.round(cgst * 100) / 100;
        sgst = Math.round(sgst * 100) / 100;
        cess = Math.round(cess * 100) / 100;
        const totalTax = Math.round((igst + cgst + sgst + cess) * 100) / 100;

        records.push({
          supplierGstin,
          supplierName,
          invoiceNumber: invNum,
          invoiceDate: invDate,
          taxableValue,
          igst,
          cgst,
          sgst,
          cess,
          totalTax,
          filingDate,
          itcAvailable,
          sourceType: "JSON"
        });
      }
    }
  }

  // Case 2: Flat JSON Array
  if (records.length === 0 && Array.isArray(data)) {
    for (const row of data) {
      const supplierGstin = cleanStr(row.supplierGstin || row.supplier_gstin || row.ctin || row["GSTIN of Supplier"]).toUpperCase();
      const supplierName = cleanStr(row.supplierName || row.supplier_name || row.trdNm || row["Trade/Legal Name"] || "Supplier");
      const invNum = cleanStr(row.invoiceNumber || row.invoice_number || row.inum || row["Invoice number"]);
      if (!supplierGstin || !invNum) continue;

      const taxableValue = parseNum(row.taxableValue || row.taxable_value || row.taxableAmount || row.taxable_amount || row["Taxable Value (₹)"] || row["Taxable Value"]);
      const igst = parseNum(row.igst || row.iamt || row["Integrated Tax (₹)"] || row["IGST"]);
      const cgst = parseNum(row.cgst || row.camt || row["Central Tax (₹)"] || row["CGST"]);
      const sgst = parseNum(row.sgst || row.samt || row["State/UT Tax (₹)"] || row["SGST"]);
      const cess = parseNum(row.cess || row.csamt || row["Cess (₹)"] || row["CESS"]);
      const totalTax = parseNum(row.totalTax || row.total_tax) || (Math.round((igst + cgst + sgst + cess) * 100) / 100);

      records.push({
        supplierGstin,
        supplierName,
        invoiceNumber: invNum,
        invoiceDate: parseDate(row.invoiceDate || row.invoice_date || row.dt || row["Invoice Date"]),
        taxableValue,
        igst,
        cgst,
        sgst,
        cess,
        totalTax,
        filingDate: parseDate(row.filingDate || row.filing_date || row["Filing Date"]),
        itcAvailable: cleanStr(row.itcAvailable || row.itc_available || row["ITC Availability"] || "Y").toUpperCase() === "N" ? "N" : "Y",
        sourceType: "FLAT_JSON"
      });
    }
  }

  return {
    valid: records.length > 0,
    records,
    count: records.length,
    error: records.length === 0 ? "No valid B2B invoice records identified in JSON payload." : null
  };
}

/**
 * Parse GSTR-2B from Excel Workbook Buffer
 */
export function parseGstr2bExcel(buffer) {
  try {
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
    // Look for B2B sheet or use first sheet
    let targetSheetName = workbook.SheetNames.find(s => /^b2b$/i.test(s.trim())) ||
                          workbook.SheetNames.find(s => /b2b/i.test(s.trim())) ||
                          workbook.SheetNames[0];

    if (!targetSheetName) {
      return { valid: false, error: "Empty workbook or no sheets found.", records: [] };
    }

    const sheet = workbook.Sheets[targetSheetName];
    const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: "", header: 1 });

    if (!rawRows || rawRows.length < 2) {
      return { valid: false, error: "The Excel sheet contains no tabular invoice data.", records: [] };
    }

    // Find header row (row containing GSTIN or Invoice)
    let headerRowIdx = -1;
    for (let i = 0; i < Math.min(rawRows.length, 10); i++) {
      const rowStr = (rawRows[i] || []).join(" ").toLowerCase();
      if ((rowStr.includes("gstin") || rowStr.includes("supplier")) &&
          (rowStr.includes("invoice") || rowStr.includes("bill") || rowStr.includes("inv"))) {
        headerRowIdx = i;
        break;
      }
    }

    if (headerRowIdx === -1) headerRowIdx = 0; // Fallback to first row

    const headers = rawRows[headerRowIdx].map(h => cleanStr(h).toLowerCase());
    const findCol = (patterns) => {
      return headers.findIndex(h => patterns.some(p => h.includes(p.toLowerCase())));
    };

    const gstinCol = findCol(["gstin of supplier", "supplier gstin", "ctin", "gstin"]);
    const nameCol = findCol(["trade/legal name", "legal name", "trade name", "supplier name", "supplier"]);
    const invCol = findCol(["invoice number", "invoice no", "inv no", "inum", "invoice"]);
    const dateCol = findCol(["invoice date", "inv date", "date", "dt"]);
    const taxValCol = findCol(["taxable value", "taxable amount", "taxable val", "txval", "taxable"]);
    const igstCol = findCol(["integrated tax", "igst", "iamt"]);
    const cgstCol = findCol(["central tax", "cgst", "camt"]);
    const sgstCol = findCol(["state/ut tax", "state tax", "sgst", "samt"]);
    const cessCol = findCol(["cess", "csamt"]);
    const itcCol = findCol(["itc availability", "itc available", "itcavl", "itc"]);
    const filingDateCol = findCol(["filing date", "gstr-1 filing date", "gstr1 filing date"]);

    const records = [];

    for (let r = headerRowIdx + 1; r < rawRows.length; r++) {
      const row = rawRows[r];
      if (!row || row.length === 0) continue;

      const supplierGstin = cleanStr(gstinCol >= 0 ? row[gstinCol] : "").toUpperCase();
      const invoiceNumber = cleanStr(invCol >= 0 ? row[invCol] : "");

      // Skip invalid header/summary rows
      if (!supplierGstin || !invoiceNumber || supplierGstin.toLowerCase().includes("total") || invoiceNumber.toLowerCase().includes("total")) {
        continue;
      }

      const supplierName = cleanStr(nameCol >= 0 ? row[nameCol] : "") || "Supplier " + supplierGstin.slice(0, 10);
      const invoiceDate = parseDate(dateCol >= 0 ? row[dateCol] : "");
      const taxableValue = parseNum(taxValCol >= 0 ? row[taxValCol] : 0);
      const igst = parseNum(igstCol >= 0 ? row[igstCol] : 0);
      const cgst = parseNum(cgstCol >= 0 ? row[cgstCol] : 0);
      const sgst = parseNum(sgstCol >= 0 ? row[sgstCol] : 0);
      const cess = parseNum(cessCol >= 0 ? row[cessCol] : 0);
      const totalTax = Math.round((igst + cgst + sgst + cess) * 100) / 100;
      const itcAvailable = cleanStr(itcCol >= 0 ? row[itcCol] : "Y").toUpperCase() === "N" ? "N" : "Y";
      const filingDate = parseDate(filingDateCol >= 0 ? row[filingDateCol] : invoiceDate);

      records.push({
        supplierGstin,
        supplierName,
        invoiceNumber,
        invoiceDate,
        taxableValue,
        igst,
        cgst,
        sgst,
        cess,
        totalTax,
        filingDate,
        itcAvailable,
        sourceType: "EXCEL"
      });
    }

    return {
      valid: records.length > 0,
      records,
      count: records.length,
      error: records.length === 0 ? "No valid B2B invoice rows could be extracted from Excel sheet." : null
    };
  } catch (err) {
    return { valid: false, error: "Failed to parse Excel workbook: " + err.message, records: [] };
  }
}

/**
 * Parse GSTR-2B from CSV text
 */
export function parseGstr2bCsv(csvContent) {
  if (!csvContent || typeof csvContent !== "string") {
    return { valid: false, error: "Empty or invalid CSV text provided.", records: [] };
  }

  try {
    const workbook = XLSX.read(csvContent, { type: "string" });
    const firstSheet = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheet];
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    return parseGstr2bExcel(buffer);
  } catch (err) {
    return { valid: false, error: "Failed to parse CSV: " + err.message, records: [] };
  }
}

/**
 * Universal GSTR-2B Parser
 * Determines format automatically based on filename and content
 */
export function parseGstr2bFile({ filename = "", buffer = null, text = null }) {
  const ext = (filename.split(".").pop() || "").toLowerCase();

  if (ext === "json" || (text && (text.trim().startsWith("{") || text.trim().startsWith("[")))) {
    return parseGstr2bJson(text || (buffer ? buffer.toString("utf8") : ""));
  }

  if (ext === "csv") {
    return parseGstr2bCsv(text || (buffer ? buffer.toString("utf8") : ""));
  }

  if (ext === "xlsx" || ext === "xls" || buffer) {
    return parseGstr2bExcel(buffer || Buffer.from(text || ""));
  }

  return { valid: false, error: "Unsupported file extension or format. Please upload JSON, XLSX, or CSV.", records: [] };
}
