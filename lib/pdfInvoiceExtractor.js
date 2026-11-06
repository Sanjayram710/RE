/**
 * SimpleGST - Production PDF & Document Invoice Extraction Engine
 * Zero external npm dependencies. Native Node.js zlib decompression.
 * 
 * Extracts:
 * - Invoice Info: Number, Date, Due Date, POS, RCM, Financial Period
 * - Seller Details: Name, GSTIN, Address, State
 * - Buyer Details: Name, GSTIN, Address, State
 * - Line Items: Description, HSN/SAC, Qty, Unit, Rate, Discount, Taxable, GST %, CGST, SGST, IGST, Total
 * - Totals: Taxable, CGST, SGST, IGST, Cess, Round-off, Grand Total
 * - Confidence & Validation Warnings (Duplicate check, Total mismatch, GSTIN validation)
 */

import zlib from "node:zlib";
import { validateGstin } from "./validate.js";

// State code mapping for POS normalization
export const GST_STATE_MAP = {
  "01": "Jammu & Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh",
  "05": "Uttarakhand", "06": "Haryana", "07": "Delhi", "08": "Rajasthan",
  "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh",
  "13": "Nagaland", "14": "Manipur", "15": "Mizoram", "16": "Tripura",
  "17": "Meghalaya", "18": "Assam", "19": "West Bengal", "20": "Jharkhand",
  "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat",
  "26": "Dadra & Nagar Haveli and Daman & Diu", "27": "Maharashtra", "28": "Andhra Pradesh (Old)",
  "29": "Karnataka", "30": "Goa", "31": "Lakshadweep", "32": "Kerala",
  "33": "Tamil Nadu", "34": "Puducherry", "35": "Andaman & Nicobar Islands",
  "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh", "97": "Other Territory"
};

/**
 * Extracts raw textual content from any PDF Buffer (compressed with FlateDecode or uncompressed)
 * @param {Buffer} buffer 
 * @returns {{ text: string, isPdf: boolean, isScanned: boolean, streamsCount: number }}
 */
export function extractTextFromPdf(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    buffer = Buffer.from(buffer);
  }

  // Check if buffer is PDF
  const isPdf = buffer.subarray(0, 10).toString("binary").includes("%PDF");
  if (!isPdf) {
    // If text/csv/txt, return UTF-8 text
    const text = buffer.toString("utf8");
    return {
      text: text.trim(),
      isPdf: false,
      isScanned: false,
      streamsCount: 0
    };
  }

  const content = buffer.toString("binary");
  const streamRegex = /stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g;
  let fullText = "";
  let streamsCount = 0;
  let hasImageXObject = content.includes("/Subtype /Image") || content.includes("/Subtype/Image");
  let match;

  while ((match = streamRegex.exec(content)) !== null) {
    streamsCount++;
    const streamData = Buffer.from(match[1], "binary");
    const preHeader = content.substring(Math.max(0, match.index - 350), match.index);
    let decoded = "";

    if (preHeader.includes("FlateDecode")) {
      try {
        decoded = zlib.inflateSync(streamData).toString("utf8");
      } catch (e1) {
        try {
          decoded = zlib.inflateRawSync(streamData).toString("utf8");
        } catch (e2) {
          decoded = streamData.toString("utf8");
        }
      }
    } else {
      decoded = streamData.toString("utf8");
    }

    // 1. Sequentially extract text tokens and line breaks
    const tokenRegex = /\(([\s\S]*?)\)\s*(Tj|['"])|\[([\s\S]*?)\]\s*TJ|<([0-9a-fA-F]+)>\s*Tj|(T\*|\bTd\b|\bTD\b)/g;
    let tm;
    while ((tm = tokenRegex.exec(decoded)) !== null) {
      if (tm[1] !== undefined) {
        const clean = unescapePdfString(tm[1]);
        if (clean) fullText += clean + (tm[2] === "Tj" ? " " : "\n");
      } else if (tm[3] !== undefined) {
        const innerStrRegex = /\(([\s\S]*?)\)/g;
        let sm;
        let piece = "";
        while ((sm = innerStrRegex.exec(tm[3])) !== null) {
          piece += unescapePdfString(sm[1]);
        }
        if (piece) fullText += piece + " ";
      } else if (tm[4] !== undefined) {
        try {
          const hexDecoded = Buffer.from(tm[4], "hex").toString("utf8");
          if (hexDecoded) fullText += hexDecoded + " ";
        } catch (e) {}
      } else if (tm[5] !== undefined) {
        fullText += "\n";
      }
    }
  }

  // Normalize extracted text
  const cleanText = fullText
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // If text is extremely short and document contains image XObjects, classify as scanned
  const isScanned = cleanText.length < 25 && hasImageXObject;

  return {
    text: cleanText,
    isPdf: true,
    isScanned,
    streamsCount
  };
}

function unescapePdfString(str) {
  return str
    .replace(/\\([0-7]{1,3})/g, (match, octal) => String.fromCharCode(parseInt(octal, 8)))
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\b/g, "\b")
    .replace(/\\f/g, "\f")
    .replace(/\\\)/g, ")")
    .replace(/\\\(/g, "(")
    .replace(/\\\\/g, "\\");
}

/**
 * Parses and extracts all statutory GST invoice fields from raw document text
 * @param {string} rawText 
 * @param {Object} options
 * @param {string} [options.filename]
 * @param {string} [options.categoryHint] - "sales_invoice" | "purchase_bill"
 * @param {Object} [options.activeGstin] - { gstin: string, state_code: string, legal_name: string }
 * @param {Function} [options.checkDuplicateInvoice] - (invNumber, type) => boolean
 * @param {boolean} [options.isScanned]
 */
export function parseInvoiceFromText(rawText, {
  filename = "Invoice.pdf",
  categoryHint = "sales_invoice",
  activeGstin = null,
  checkDuplicateInvoice = null,
  isScanned = false
} = {}) {
  const warnings = [];
  const text = (rawText || "").trim();

  // 1. GSTIN Extraction (All 15-character statutory GSTINs in document)
  const gstinRegex = /[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}/gi;
  const foundGstins = Array.from(new Set((text.match(gstinRegex) || []).map(g => g.toUpperCase())));

  // Check GSTIN structural validity
  const validGstins = foundGstins.filter(g => validateGstin(g).valid);
  if (foundGstins.length > 0 && validGstins.length === 0) {
    warnings.push({
      field: "gstin",
      code: "INVALID_GSTIN_FORMAT",
      message: `Found GSTIN '${foundGstins[0]}' does not match standard 15-character GST statutory format.`
    });
  }

  // Determine Seller and Buyer GSTINs
  let sellerGstin = "";
  let buyerGstin = "";
  const activeGstinStr = activeGstin?.gstin?.toUpperCase() || "";

  if (foundGstins.length === 1) {
    if (activeGstinStr && foundGstins[0] === activeGstinStr) {
      sellerGstin = foundGstins[0]; // Seller is user
    } else if (categoryHint === "sales_invoice") {
      sellerGstin = activeGstinStr || foundGstins[0];
      buyerGstin = foundGstins[0] !== activeGstinStr ? foundGstins[0] : "";
    } else {
      sellerGstin = foundGstins[0];
      buyerGstin = activeGstinStr;
    }
  } else if (foundGstins.length >= 2) {
    if (activeGstinStr && foundGstins[1] === activeGstinStr) {
      sellerGstin = foundGstins[0];
      buyerGstin = foundGstins[1];
    } else if (activeGstinStr && foundGstins[0] === activeGstinStr) {
      sellerGstin = foundGstins[0];
      buyerGstin = foundGstins[1];
    } else {
      sellerGstin = foundGstins[0];
      buyerGstin = foundGstins[1];
    }
  }

  // 2. Document Type Detection (Sales vs Purchase)
  let detectedType = categoryHint || "sales_invoice";
  if (activeGstinStr && sellerGstin === activeGstinStr) {
    detectedType = "sales_invoice";
  } else if (activeGstinStr && buyerGstin === activeGstinStr) {
    detectedType = "purchase_bill";
  } else {
    // Keyword heuristics
    const lower = text.toLowerCase();
    if (lower.includes("purchase order") || lower.includes("vendor bill") || lower.includes("supplier bill") || lower.includes("inward supply")) {
      detectedType = "purchase_bill";
    } else if (lower.includes("sales invoice") || lower.includes("tax invoice") || lower.includes("outward supply")) {
      detectedType = "sales_invoice";
    }
  }

  // 3. Invoice Number Extraction
  let invoiceNumber = "";
  const invPatterns = [
    /(?:invoice|inv|bill|doc|voucher)\s*(?:no\.?|number|#|id)\s*[:\s-]*([A-Z0-9\/-]{3,30})/i,
    /\b(INV[-_/][A-Z0-9\/-]{3,25})\b/i,
    /\b(BILL[-_/][A-Z0-9\/-]{3,25})\b/i,
    /\b(CSP[-_/][0-9]{3,20})\b/i,
    /(?:invoice|inv|bill)\s*#\s*([A-Z0-9\/-]{3,25})/i,
    /(?:tax\s+invoice)\s*(?:no\.?|number|#|id)\s*[:\s-]*([A-Z0-9\/-]{3,25})/i
  ];

  for (const pat of invPatterns) {
    const m = text.match(pat);
    if (m && m[1] && m[1].trim().length >= 3 && !/^(date|no|gstin|total|tax|amount|invoice|seller|buyer|party|place|supply|item|rate|subtotal)$/i.test(m[1].trim())) {
      invoiceNumber = m[1].trim().replace(/[:#]/g, "");
      break;
    }
  }

  if (!invoiceNumber) {
    warnings.push({
      field: "invoiceNumber",
      code: "MISSING_INVOICE_NUMBER",
      message: "Invoice number could not be reliably extracted from document."
    });
  }

  // 4. Duplicate Invoice Check
  let isDuplicate = false;
  if (invoiceNumber && typeof checkDuplicateInvoice === "function") {
    isDuplicate = Boolean(checkDuplicateInvoice(invoiceNumber, detectedType));
    if (isDuplicate) {
      warnings.push({
        field: "invoiceNumber",
        code: "DUPLICATE_INVOICE_NUMBER",
        message: `Invoice number '${invoiceNumber}' already exists in your active ${detectedType === "sales_invoice" ? "Sales" : "Purchase"} Register.`
      });
    }
  }

  // 5. Invoice Date Extraction
  let invoiceDate = "";
  const datePatterns = [
    /(?:inv(?:oice)?\s*date|dated?|bill\s*date|date\s*of\s*issue)[:\s]*([0-9]{1,2}[\/\-\.][0-9]{1,2}[\/\-\.][0-9]{2,4}|[0-9]{4}[\/\-\.][0-9]{1,2}[\/\-\.][0-9]{1,2}|[0-9]{1,2}\s+[A-Za-z]{3,9}\s+[0-9]{4})/i,
    /(?:date)[:\s]*([0-9]{1,2}[\/\-\.][0-9]{1,2}[\/\-\.][0-9]{2,4}|[0-9]{4}[\/\-\.][0-9]{1,2}[\/\-\.][0-9]{1,2})/i,
    /\b([0-9]{4}-[0-9]{2}-[0-9]{2})\b/
  ];

  for (const pat of datePatterns) {
    const m = text.match(pat);
    if (m && m[1]) {
      invoiceDate = normalizeDate(m[1].trim());
      if (invoiceDate) break;
    }
  }

  if (!invoiceDate) {
    invoiceDate = new Date().toISOString().split("T")[0];
    warnings.push({
      field: "invoiceDate",
      code: "MISSING_INVOICE_DATE",
      message: "Invoice date was not found. Defaulted to today's date."
    });
  }

  // Due date extraction if available
  let dueDate = "";
  const duePattern = /(?:due\s*date|payment\s*due)[:\s]*([0-9]{1,2}[\/\-\.][0-9]{1,2}[\/\-\.][0-9]{2,4}|[0-9]{4}[\/\-\.][0-9]{1,2}[\/\-\.][0-9]{1,2})/i;
  const dueMatch = text.match(duePattern);
  if (dueMatch && dueMatch[1]) {
    dueDate = normalizeDate(dueMatch[1].trim());
  }

  // 6. Place of Supply (POS) Extraction
  let pos = "";
  let posStateName = "";
  const posPattern = /(?:place\s*of\s*supply|pos|state\s*of\s*supply|destination)[:\s-]*([0-9]{2}(?:\s*-[A-Za-z\s]+)?|[A-Za-z\s]+)/i;
  const posMatch = text.match(posPattern);
  if (posMatch && posMatch[1]) {
    const rawPos = posMatch[1].trim();
    const codeMatch = rawPos.match(/^([0-9]{2})/);
    if (codeMatch && GST_STATE_MAP[codeMatch[1]]) {
      pos = codeMatch[1];
      posStateName = GST_STATE_MAP[pos];
    } else {
      // Search state names
      for (const [code, name] of Object.entries(GST_STATE_MAP)) {
        if (rawPos.toLowerCase().includes(name.toLowerCase())) {
          pos = code;
          posStateName = name;
          break;
        }
      }
    }
  }

  if (!pos) {
    // Derive from buyer GSTIN or active GSTIN state
    if (buyerGstin && buyerGstin.length >= 2) {
      pos = buyerGstin.substring(0, 2);
      posStateName = GST_STATE_MAP[pos] || "";
    } else if (activeGstin?.state_code) {
      pos = activeGstin.state_code;
      posStateName = GST_STATE_MAP[pos] || "";
    } else if (sellerGstin && sellerGstin.length >= 2) {
      pos = sellerGstin.substring(0, 2);
      posStateName = GST_STATE_MAP[pos] || "";
    }
  }

  if (!pos) {
    pos = "27";
    posStateName = "Maharashtra";
    warnings.push({
      field: "pos",
      code: "MISSING_PLACE_OF_SUPPLY",
      message: "Place of Supply was not explicitly found. Defaulted to seller registered state."
    });
  }

  // 7. Reverse Charge Status
  let isRcm = false;
  const rcmMatch = text.match(/(?:reverse\s*charge|rcm)[:\s]*(yes|y|true|no|n|false)/i);
  if (rcmMatch && ["yes", "y", "true"].includes(rcmMatch[1].toLowerCase())) {
    isRcm = true;
  }

  // 8. Party Names & Addresses
  let sellerName = "";
  let buyerName = "";
  let sellerAddress = "";
  let buyerAddress = "";

  const sellerNameMatch = text.match(/(?:seller|supplier|from|vendor|issued\s*by)[:\s]*([A-Za-z0-9\s&.,'-]+?)(?=\r?\n|GSTIN|State|Address|Buyer|Invoice|$)/i);
  if (sellerNameMatch) sellerName = cleanPartyName(sellerNameMatch[1]);

  const buyerNameMatch = text.match(/(?:buyer|customer|billed\s*to|consignee|client|to)[:\s]*([A-Za-z0-9\s&.,'-]+?)(?=\r?\n|GSTIN|State|Address|Seller|Place|$)/i);
  if (buyerNameMatch) buyerName = cleanPartyName(buyerNameMatch[1]);

  if (!sellerName) {
    if (detectedType === "sales_invoice" && activeGstin?.trade_name) {
      sellerName = activeGstin.trade_name;
    } else if (detectedType === "sales_invoice" && activeGstin?.legal_name) {
      sellerName = activeGstin.legal_name;
    } else {
      sellerName = "Supplier Enterprise";
    }
  }

  if (!buyerName) {
    if (detectedType === "purchase_bill" && activeGstin?.trade_name) {
      buyerName = activeGstin.trade_name;
    } else if (detectedType === "purchase_bill" && activeGstin?.legal_name) {
      buyerName = activeGstin.legal_name;
    } else {
      buyerName = "Customer Business";
    }
  }

  // Address lines
  const addrMatch = text.match(/(?:address|addr)[:\s]*([A-Za-z0-9\s,.-]{5,80})/i);
  if (addrMatch) {
    sellerAddress = addrMatch[1].trim();
  }

  // 9. Financial Figures: Taxable Value, Tax Rates, Taxes, Grand Total
  let taxableAmount = 0;
  let taxableValue = 0;
  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  let cess = 0;
  let roundOff = 0;
  let totalAmount = 0;
  let gstRate = 18;

  // Taxable Value
  let taxableMatch = text.match(/(?:total\s*taxable\s*(?:value|amount)?|taxable\s*(?:value|amount))[:\s₹Rs.]*([0-9,]+(?:\.[0-9]{2})?)/i);
  if (!taxableMatch) {
    taxableMatch = text.match(/(?:subtotal|sub-total|net\s*amount|taxable)[:\s₹Rs.]*([0-9,]+(?:\.[0-9]{2})?)/i);
  }
  if (taxableMatch) {
    taxableValue = parseAmount(taxableMatch[1]);
    taxableAmount = taxableValue;
  }

  // Specific Tax Amounts
  const cgstMatch = text.match(/(?:total\s*cgst|cgst)[:\s₹Rs.@0-9%]*[:\s₹Rs.]+([0-9,]+(?:\.[0-9]{2})?)/i);
  if (cgstMatch) cgst = parseAmount(cgstMatch[1]);

  const sgstMatch = text.match(/(?:total\s*sgst|sgst|utgst)[:\s₹Rs.@0-9%]*[:\s₹Rs.]+([0-9,]+(?:\.[0-9]{2})?)/i);
  if (sgstMatch) sgst = parseAmount(sgstMatch[1]);

  const igstMatch = text.match(/(?:total\s*igst|igst)[:\s₹Rs.@0-9%]*[:\s₹Rs.]+([0-9,]+(?:\.[0-9]{2})?)/i);
  if (igstMatch) igst = parseAmount(igstMatch[1]);

  const cessMatch = text.match(/(?:total\s*cess|cess)[:\s₹Rs.@0-9%]*[:\s₹Rs.]+([0-9,]+(?:\.[0-9]{2})?)/i);
  if (cessMatch) cess = parseAmount(cessMatch[1]);

  const roundOffMatch = text.match(/(?:round\s*off)[:\s₹Rs.]*([+-]?[0-9,]+(?:\.[0-9]{2})?)/i);
  if (roundOffMatch) roundOff = parseAmount(roundOffMatch[1]);

  // Grand Total: prioritize Grand Total or Net Payable over individual line totals
  let totalMatch = text.match(/(?:grand\s*total|net\s*payable|invoice\s*total)[:\s₹Rs.]*([0-9,]+(?:\.[0-9]{2})?)/i);
  if (!totalMatch) {
    const allTotals = Array.from(text.matchAll(/(?:total\s*(?:amount|value)?|total)[:\s₹Rs.]*([0-9,]+(?:\.[0-9]{2})?)/gi));
    if (allTotals.length > 0) {
      totalMatch = allTotals[allTotals.length - 1];
    }
  }
  if (totalMatch) {
    totalAmount = parseAmount(totalMatch[1]);
  }

  // GST Rate detection
  const rateMatch = text.match(/(?:gst\s*rate|tax\s*rate|rate)[:\s]*([0-9]{1,2}(?:\.[0-9]+)?)\s*%/i);
  if (rateMatch) {
    const parsedRate = parseFloat(rateMatch[1]);
    if ([0, 5, 12, 18, 28].includes(parsedRate)) {
      gstRate = parsedRate;
    }
  }

  // Inter-State Determination
  const sellerState = (sellerGstin && sellerGstin.length >= 2) ? sellerGstin.substring(0, 2) : (activeGstin?.state_code || "27");
  const isInterstate = pos !== sellerState;

  // Infer missing taxes based on statutory rules
  if (taxableValue > 0 && cgst === 0 && sgst === 0 && igst === 0) {
    if (isInterstate) {
      igst = Math.round(taxableValue * (gstRate / 100) * 100) / 100;
    } else {
      cgst = Math.round(taxableValue * (gstRate / 200) * 100) / 100;
      sgst = Math.round(taxableValue * (gstRate / 200) * 100) / 100;
    }
  }

  // If grand total was missing, compute it
  if (totalAmount === 0 && taxableValue > 0) {
    totalAmount = Math.round((taxableValue + cgst + sgst + igst + cess + roundOff) * 100) / 100;
  }

  if (taxableValue <= 0) {
    warnings.push({
      field: "taxableValue",
      code: "MISSING_TAXABLE_VALUE",
      message: "Taxable invoice amount could not be detected."
    });
  }

  // Total Verification / Mismatch Warning
  const expectedTotal = Math.round((taxableValue + cgst + sgst + igst + cess + roundOff) * 100) / 100;
  if (taxableValue > 0 && totalAmount > 0 && Math.abs(expectedTotal - totalAmount) > 2.0) {
    warnings.push({
      field: "totalAmount",
      code: "TOTAL_MISMATCH",
      message: `Total amount mismatch: Calculated total (₹${expectedTotal.toFixed(2)}) differs from extracted document total (₹${totalAmount.toFixed(2)}). Please verify.`
    });
  }

  // 10. Extract Multi-Item Line Items
  const lineItems = extractLineItems(text, {
    defaultTaxable: taxableValue,
    defaultGstRate: gstRate,
    isInterstate
  });

  // Calculate Overall Confidence
  let confidence = 0.96;
  if (isScanned) confidence -= 0.20;
  if (!invoiceNumber) confidence -= 0.15;
  if (taxableValue <= 0) confidence -= 0.20;
  if (warnings.some(w => w.code === "TOTAL_MISMATCH")) confidence -= 0.10;
  if (warnings.some(w => w.code === "INVALID_GSTIN_FORMAT")) confidence -= 0.10;
  confidence = Math.max(0.35, Math.min(0.99, confidence));

  if (isScanned) {
    warnings.push({
      field: "document",
      code: "SCANNED_DOCUMENT_NOTICE",
      message: "This appears to be a scanned image-based document or low-text PDF. OCR text extraction may be incomplete. Please verify and manually complete invoice fields before saving."
    });
  }

  return {
    success: true,
    documentType: detectedType,
    filename,
    confidence: `${Math.round(confidence * 100)}%`,
    confidenceScore: confidence,
    isScanned,
    warnings,
    invoiceNumber,
    invoiceDate,
    dueDate,
    pos,
    sellerGstin,
    buyerGstin,
    invoiceInfo: {
      invoiceNumber,
      invoiceDate,
      dueDate,
      pos,
      posStateName,
      isInterstate,
      isRcm,
      period: invoiceDate ? `${invoiceDate.slice(5, 7)}${invoiceDate.slice(0, 4)}` : "102026",
      supplyType: isInterstate ? "INTER_STATE" : "INTRA_STATE"
    },
    seller: {
      name: sellerName,
      gstin: sellerGstin,
      address: sellerAddress,
      state: sellerState,
      stateName: GST_STATE_MAP[sellerState] || ""
    },
    buyer: {
      name: buyerName,
      gstin: buyerGstin,
      address: buyerAddress,
      state: pos,
      stateName: posStateName
    },
    lineItems,
    totals: {
      taxableAmount,
      gstRate,
      cgst,
      sgst,
      igst,
      cess,
      roundOff,
      totalTax: Math.round((cgst + sgst + igst + cess) * 100) / 100,
      totalAmount
    }
  };
}

/**
 * Extracts line item rows from text
 */
function extractLineItems(text, { defaultTaxable = 0, defaultGstRate = 18, isInterstate = false } = {}) {
  const items = [];
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  
  // Pattern 1: Labeled row: (Description) HSN: (code) Qty: (num) Rate: (num) Taxable: (num)
  const labeledRegex = /^(?:(?:\d+\.?\s+)|(?:Item\s*\d*[:\.\s]*))?([A-Za-z0-9\s&.,'-]+?)\s*(?:HSN|SAC)[:\s]*(\d{4,8})[\s\S]*?(?:Qty|Quantity)[:\s]*(\d+(?:\.\d+)?)[\s\S]*?(?:Rate|Price)[:\s]*([0-9,]+(?:\.[0-9]{2})?)[\s\S]*?(?:Taxable|Amount)[:\s]*([0-9,]+(?:\.[0-9]{2})?)/i;

  // Pattern 2: Tabular row: (Description) (HSN) (Qty) (Rate) (Taxable)
  const tableRegex = /^([A-Za-z0-9\s&.,'-]{3,40})\s+(\d{4,8})\s+(\d+(?:\.\d+)?)\s*(?:PCS|NOS|KGS|BOX|UNIT|SET|BAG|MTR)?\s+([0-9,]+(?:\.[0-9]{2})?)\s+([0-9,]+(?:\.[0-9]{2})?)/i;

  let idx = 1;
  for (const line of lines) {
    let m = line.match(labeledRegex);
    if (!m) m = line.match(tableRegex);

    if (m) {
      const description = m[1].replace(/^(?:\d+[\.\)]\s*)/, "").trim();
      const hsnCode = m[2];
      const quantity = parseFloat(m[3]) || 1;
      const rate = parseAmount(m[4]);
      const taxableValue = parseAmount(m[5]) || (quantity * rate);

      // Check if line specifies custom GST rate e.g. "GST: 18%"
      let taxRate = defaultGstRate;
      const rateMatch = line.match(/(?:GST|Tax)[:\s]*([0-9]{1,2}(?:\.[0-9]+)?)\s*%/i);
      if (rateMatch) {
        const r = parseFloat(rateMatch[1]);
        if ([0, 5, 12, 18, 28].includes(r)) taxRate = r;
      }

      const tax = Math.round(taxableValue * (taxRate / 100) * 100) / 100;
      
      items.push({
        id: `item-${idx++}`,
        description,
        hsn: hsnCode,
        hsnCode,
        quantity,
        unit: "NOS",
        rate,
        discount: 0,
        taxableAmount: taxableValue,
        taxableValue,
        gstRate: taxRate,
        cgst: isInterstate ? 0 : tax / 2,
        sgst: isInterstate ? 0 : tax / 2,
        igst: isInterstate ? tax : 0,
        taxAmount: tax,
        totalAmount: Math.round((taxableValue + tax) * 100) / 100
      });
    }
  }

  // Fallback: If no tabular items parsed, create default item from invoice totals
  if (items.length === 0 && defaultTaxable > 0) {
    const tax = Math.round(defaultTaxable * (defaultGstRate / 100) * 100) / 100;
    items.push({
      id: "item-1",
      description: "General Commercial Goods / Services",
      hsn: "9983",
      hsnCode: "9983",
      quantity: 1,
      unit: "NOS",
      rate: defaultTaxable,
      discount: 0,
      taxableAmount: defaultTaxable,
      taxableValue: defaultTaxable,
      gstRate: defaultGstRate,
      cgst: isInterstate ? 0 : tax / 2,
      sgst: isInterstate ? 0 : tax / 2,
      igst: isInterstate ? tax : 0,
      taxAmount: tax,
      totalAmount: Math.round((defaultTaxable + tax) * 100) / 100
    });
  }

  return items;
}

function parseAmount(val) {
  if (typeof val === "number") return val;
  if (!val) return 0;
  const num = parseFloat(String(val).replace(/,/g, "").trim());
  return isNaN(num) ? 0 : num;
}

function normalizeDate(str) {
  if (!str) return "";
  // Check YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  // Check DD/MM/YYYY or DD-MM-YYYY
  const m1 = str.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if (m1) {
    const day = m1[1].padStart(2, "0");
    const month = m1[2].padStart(2, "0");
    let year = m1[3];
    if (year.length === 2) year = "20" + year;
    return `${year}-${month}-${day}`;
  }

  // Check Month name: 15 Oct 2026
  const m2 = str.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/);
  if (m2) {
    const months = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
    const month = months[m2[2].slice(0, 3).toLowerCase()] || "10";
    return `${m2[3]}-${month}-${m2[1].padStart(2, "0")}`;
  }

  return "";
}

function cleanPartyName(str) {
  return str
    .replace(/(?:buyer|seller|supplier|customer|to|from|consignee|attn)[:\s]*/gi, "")
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, 60);
}
