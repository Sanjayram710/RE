/**
 * SimpleGST - Production PDF & Document Invoice Extraction Engine
 * Zero external npm dependencies. Native Node.js zlib decompression.
 * 
 * Extracts:
 * - Invoice Info: Number, Date, Due Date, Payment Terms, POS, RCM, Financial Period
 * - Seller Details: Name, GSTIN, Address, State
 * - Buyer Details: Name, GSTIN, Address, State
 * - Multi-Line Items: Description, HSN/SAC, Qty, Unit, Rate, Discount, Taxable, GST %, CGST, SGST, IGST, Total
 * - Totals: Taxable, CGST, SGST, IGST, Cess, Round-off, Grand Total
 * - Bidirectional Sales vs Purchase Classification (Active GSTIN comparison & direction warnings)
 * - Validation Warnings (Statutory check, Total mismatch, GSTIN validation)
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
 * Decodes ASCII85 (Adobe variant) data stream
 */
function decodeAscii85(buf) {
  let str = Buffer.isBuffer(buf) ? buf.toString("binary") : String(buf);
  let clean = str.replace(/\s+/g, "");
  if (clean.startsWith("<~")) clean = clean.slice(2);
  const endIdx = clean.indexOf("~>");
  if (endIdx !== -1) clean = clean.slice(0, endIdx);

  const out = [];
  let tuple = 0;
  let count = 0;

  for (let i = 0; i < clean.length; i++) {
    const c = clean.charCodeAt(i);
    if (c === 122 && count === 0) { // 'z' represents 4 zero bytes
      out.push(0, 0, 0, 0);
      continue;
    }
    if (c < 33 || c > 117) continue;
    tuple = tuple * 85 + (c - 33);
    count++;
    if (count === 5) {
      out.push((tuple >> 24) & 0xff);
      out.push((tuple >> 16) & 0xff);
      out.push((tuple >> 8) & 0xff);
      out.push(tuple & 0xff);
      tuple = 0;
      count = 0;
    }
  }

  if (count > 1) {
    for (let i = 0; i < 5 - count; i++) {
      tuple = tuple * 85 + 84;
    }
    for (let i = 0; i < count - 1; i++) {
      out.push((tuple >> (24 - i * 8)) & 0xff);
    }
  }

  return Buffer.from(out);
}

/**
 * Decodes ASCIIHex data stream
 */
function decodeAsciiHex(buf) {
  let str = Buffer.isBuffer(buf) ? buf.toString("binary") : String(buf);
  const clean = str.replace(/[^0-9a-fA-F]/g, "");
  return Buffer.from(clean, "hex");
}

/**
 * Robust multi-filter PDF stream decoder (ASCII85, ASCIIHex, Flate/Deflate)
 */
function decodePdfStream(streamData, preHeader) {
  let data = streamData;
  const filterMatch = preHeader.match(/\/Filter\s*(?:\[\s*([\s\S]*?)\s*\]|\/([a-zA-Z0-9]+))/);
  const filters = [];
  if (filterMatch) {
    if (filterMatch[1]) {
      const names = filterMatch[1].match(/\/([a-zA-Z0-9]+)/g) || [];
      names.forEach(n => filters.push(n.replace("/", "")));
    } else if (filterMatch[2]) {
      filters.push(filterMatch[2]);
    }
  } else if (preHeader.includes("FlateDecode") || preHeader.includes("/Fl")) {
    filters.push("FlateDecode");
  }

  for (const filter of filters) {
    if (/ASCII85Decode|A85/i.test(filter)) {
      try { data = decodeAscii85(data); } catch (_) {}
    } else if (/ASCIIHexDecode|AHx/i.test(filter)) {
      try { data = decodeAsciiHex(data); } catch (_) {}
    } else if (/FlateDecode|Fl/i.test(filter)) {
      try {
        data = zlib.inflateSync(data);
      } catch (_) {
        try { data = zlib.inflateRawSync(data); } catch (__) {}
      }
    }
  }

  if (filters.length === 0 || (!data.toString("utf8").includes("BT") && !data.toString("utf8").includes("ET"))) {
    try {
      const inf = zlib.inflateSync(data);
      if (inf.length > 0) data = inf;
    } catch (_) {
      try {
        const infRaw = zlib.inflateRawSync(data);
        if (infRaw.length > 0) data = infRaw;
      } catch (__) {}
    }
  }

  return data.toString("utf8");
}

function multiplyMatrix(m1, m2) {
  return [
    m1[0] * m2[0] + m1[1] * m2[2],
    m1[0] * m2[1] + m1[1] * m2[3],
    m1[2] * m2[0] + m1[3] * m2[2],
    m1[2] * m2[1] + m1[3] * m2[3],
    m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
    m1[4] * m2[1] + m1[5] * m2[3] + m2[5]
  ];
}

function parseStreamContent(decoded) {
  const tokens = [];
  let matrixStack = [];
  let currentCtm = [1, 0, 0, 1, 0, 0];
  let currentTm = [1, 0, 0, 1, 0, 0];
  let leading = 12;

  const opRegex = /(?:([0-9.-]+)\s+([0-9.-]+)\s+([0-9.-]+)\s+([0-9.-]+)\s+([0-9.-]+)\s+([0-9.-]+)\s+(cm|Tm))|(?:([0-9.-]+)\s+([0-9.-]+)\s+(Td|TD))|([0-9.-]+\s+TL)|(\bT\*)|(\bq\b)|(\bQ\b)|(?:\(([\s\S]*?)\)\s*(Tj|['"]))|(?:\[([\s\S]*?)\]\s*TJ)/g;

  let m;
  let hasPositioning = false;
  let sequentialText = "";

  while ((m = opRegex.exec(decoded)) !== null) {
    if (m[7] === "cm") {
      hasPositioning = true;
      currentCtm = multiplyMatrix(currentCtm, [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]), parseFloat(m[4]), parseFloat(m[5]), parseFloat(m[6])]);
    } else if (m[7] === "Tm") {
      hasPositioning = true;
      currentTm = [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]), parseFloat(m[4]), parseFloat(m[5]), parseFloat(m[6])];
    } else if (m[10] === "Td" || m[10] === "TD") {
      hasPositioning = true;
      currentTm[4] += parseFloat(m[8]);
      currentTm[5] += parseFloat(m[9]);
    } else if (m[11]) {
      leading = parseFloat(m[11]);
    } else if (m[12]) {
      currentTm[5] -= leading;
      sequentialText += "\n";
    } else if (m[13] === "q") {
      matrixStack.push({ ctm: [...currentCtm], tm: [...currentTm], leading });
    } else if (m[14] === "Q") {
      if (matrixStack.length > 0) {
        const popped = matrixStack.pop();
        currentCtm = popped.ctm;
        currentTm = popped.tm;
        leading = popped.leading;
      }
    } else if (m[16] === "Tj" || m[16] === "'" || m[16] === '"') {
      const text = unescapePdfString(m[15]);
      sequentialText += text + (m[16] === "Tj" ? " " : "\n");
      const eff = multiplyMatrix(currentCtm, currentTm);
      tokens.push({ text, x: Math.round(eff[4] * 10) / 10, y: Math.round(eff[5] * 10) / 10 });
    } else if (m[17] !== undefined) {
      const innerStrRegex = /\(([\s\S]*?)\)/g;
      let sm;
      let piece = "";
      while ((sm = innerStrRegex.exec(m[17])) !== null) {
        piece += unescapePdfString(sm[1]);
      }
      sequentialText += piece + " ";
      const eff = multiplyMatrix(currentCtm, currentTm);
      tokens.push({ text: piece, x: Math.round(eff[4] * 10) / 10, y: Math.round(eff[5] * 10) / 10 });
    }
  }

  // If document didn't use coordinate transforms, return sequential text
  if (!hasPositioning || tokens.length < 5) {
    return sequentialText;
  }

  // Two-column party block detection (SELLER and BUYER side-by-side)
  const sellerHeader = tokens.find(t => /^SELLER$/i.test(t.text.trim()));
  const buyerHeader = tokens.find(t => /^BUYER$/i.test(t.text.trim()));

  let twoColumnBlocks = "";
  if (sellerHeader && buyerHeader && sellerHeader.x < buyerHeader.x) {
    const splitX = (sellerHeader.x + buyerHeader.x) / 2;
    const partyTokens = tokens.filter(t => t.y < sellerHeader.y + 10 && t.y > (sellerHeader.y - 150));
    const sellerTokens = partyTokens.filter(t => t.x < splitX);
    const buyerTokens = partyTokens.filter(t => t.x >= splitX);

    sellerTokens.sort((a, b) => b.y - a.y);
    buyerTokens.sort((a, b) => b.y - a.y);

    twoColumnBlocks = [
      "SELLER DETAILS:",
      ...sellerTokens.map(t => t.text),
      "\nBUYER DETAILS:",
      ...buyerTokens.map(t => t.text)
    ].join("\n");
  }

  // Group tokens into lines by Y coordinate
  tokens.sort((a, b) => {
    const diffY = b.y - a.y;
    if (Math.abs(diffY) > 3) return diffY;
    return a.x - b.x;
  });

  const lines = [];
  let currentLine = [];
  let lastY = null;

  for (const tok of tokens) {
    if (lastY === null || Math.abs(tok.y - lastY) > 3) {
      if (currentLine.length > 0) {
        currentLine.sort((a, b) => a.x - b.x);
        lines.push(currentLine.map(t => t.text).join(" ").trim());
      }
      currentLine = [tok];
      lastY = tok.y;
    } else {
      currentLine.push(tok);
    }
  }
  if (currentLine.length > 0) {
    currentLine.sort((a, b) => a.x - b.x);
    lines.push(currentLine.map(t => t.text).join(" ").trim());
  }

  let result = lines.join("\n");
  if (twoColumnBlocks) {
    result = twoColumnBlocks + "\n\n" + result;
  }
  return result;
}

/**
 * Extracts raw textual content from any PDF Buffer (compressed with FlateDecode, ASCII85Decode, ASCIIHex, or uncompressed)
 * @param {Buffer} buffer 
 * @returns {{ text: string, isPdf: boolean, isImage: boolean, isScanned: boolean, streamsCount: number }}
 */
export function extractTextFromPdf(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    buffer = Buffer.from(buffer);
  }

  // Check if buffer is PDF
  const isPdf = buffer.subarray(0, 10).toString("binary").includes("%PDF");
  if (!isPdf) {
    const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
    const isJpg = buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;
    if (isPng || isJpg) {
      const imgText = extractStringsFromBuffer(buffer);
      return {
        text: imgText,
        isPdf: false,
        isImage: true,
        isScanned: true,
        streamsCount: 0
      };
    }

    // If text/csv/txt, return UTF-8 text
    const text = buffer.toString("utf8");
    return {
      text: text.trim(),
      isPdf: false,
      isImage: false,
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
    const decoded = decodePdfStream(streamData, preHeader);
    const streamText = parseStreamContent(decoded);
    if (streamText) fullText += streamText + "\n";
  }

  // Normalize extracted text and clean PDF artifact symbols (e.g. ZapfDingbats 'n' for Rupee)
  const cleanText = fullText
    .replace(/(^|[\s:])n\s+([0-9])/gm, "$1₹$2")
    .replace(/\\[0-7]{3}/g, "-")
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

function extractStringsFromBuffer(buffer) {
  let result = "";
  let current = "";
  for (let i = 0; i < buffer.length; i++) {
    const byte = buffer[i];
    if ((byte >= 32 && byte <= 126) || byte === 10 || byte === 13) {
      current += String.fromCharCode(byte);
    } else {
      if (current.length >= 4) {
        const wordChars = (current.match(/[A-Za-z0-9]/g) || []).length;
        if (wordChars >= 3) {
          result += current.trim() + "\n";
        }
      }
      current = "";
    }
  }
  if (current.length >= 4) result += current.trim();
  return result.trim();
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

  // 1. GSTIN Extraction (15-character statutory GSTINs in document)
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

  // 2. Party Name & Address Extraction
  let sellerName = "";
  let buyerName = "";
  let sellerAddress = "";
  let buyerAddress = "";

  const sellerNameMatch = text.match(/(?:seller\s*(?:name)?|supplier\s*(?:name)?|sold\s*by|issued\s*by|from)[:\s]*([A-Za-z0-9\s&.,'-]+?)(?=\r?\n|GSTIN|State|Address|Buyer|Invoice|$)/i);
  if (sellerNameMatch) sellerName = cleanPartyName(sellerNameMatch[1]);

  const buyerNameMatch = text.match(/(?:buyer\s*(?:name)?|customer\s*(?:name)?|billed\s*to|consignee|client|shipped\s*to|to)[:\s]*([A-Za-z0-9\s&.,'-]+?)(?=\r?\n|GSTIN|State|Address|Seller|Place|$)/i);
  if (buyerNameMatch) buyerName = cleanPartyName(buyerNameMatch[1]);

  // Check structured two-column party blocks if present
  const sellerBlockMatch = text.match(/SELLER\s+DETAILS:[\r\n]+(?:SELLER[\r\n]+)?([A-Za-z0-9\s&.,'-]+?)(?:[\r\n]+([A-Za-z0-9\s,.-]{5,100}))?[\r\n]+GSTIN/i);
  if (sellerBlockMatch) {
    if (!sellerName) sellerName = cleanPartyName(sellerBlockMatch[1]);
    if (!sellerAddress && sellerBlockMatch[2]) sellerAddress = sellerBlockMatch[2].trim();
  }

  const buyerBlockMatch = text.match(/BUYER\s+DETAILS:[\r\n]+(?:BUYER[\r\n]+)?([A-Za-z0-9\s&.,'-]+?)(?:[\r\n]+([A-Za-z0-9\s,.-]{5,100}))?[\r\n]+GSTIN/i);
  if (buyerBlockMatch) {
    if (!buyerName) buyerName = cleanPartyName(buyerBlockMatch[1]);
    if (!buyerAddress && buyerBlockMatch[2]) buyerAddress = buyerBlockMatch[2].trim();
  }

  // Check Authorized Signatory for Seller
  if (!sellerName) {
    const signatoryMatch = text.match(/(?:for|from)\s+([A-Za-z0-9\s&.,'-]+?)\s+(?:authorized|authorised)\s+signatory/i);
    if (signatoryMatch) sellerName = cleanPartyName(signatoryMatch[1]);
  }

  // Extract Addresses
  const sellerAddrMatch = text.match(/(?:seller\s*(?:address|addr)?|supplier\s*address)[:\s]*([A-Za-z0-9\s,.-]{5,80})(?=\r?\n\s*(?:GSTIN|State|Phone|Email|Buyer)|$)/i);
  if (sellerAddrMatch) {
    sellerAddress = sellerAddrMatch[1].trim();
  }

  const buyerAddrMatch = text.match(/(?:buyer\s*(?:address|addr)?|customer\s*address|delivery\s*address|shipped\s*to\s*address)[:\s]*([A-Za-z0-9\s,.-]{5,80})(?=\r?\n\s*(?:GSTIN|State|Phone|Email|Place)|$)/i);
  if (buyerAddrMatch) {
    buyerAddress = buyerAddrMatch[1].trim();
  }

  // Fallback: If generic "Address:" exists in document
  if (!sellerAddress || !buyerAddress) {
    const allAddrMatches = Array.from(text.matchAll(/(?:address|addr)[:\s]*([A-Za-z0-9\s,.-]{5,80})(?=\r?\n|$)/gi));
    if (allAddrMatches.length >= 1 && !sellerAddress) {
      sellerAddress = allAddrMatches[0][1].trim();
    }
    if (allAddrMatches.length >= 2 && !buyerAddress) {
      buyerAddress = allAddrMatches[1][1].trim();
    }
  }

  // 3. Seller vs Buyer GSTIN determination
  let sellerGstin = "";
  let buyerGstin = "";
  const activeGstinStr = activeGstin?.gstin?.toUpperCase() || "";

  // Check labeled GSTINs first
  const sellerGstinMatch = text.match(/(?:seller|supplier|vendor|from)\s*(?:gstin|gst|gst\s*no|gstin\/uin)?[:\s]*([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1})/i);
  if (sellerGstinMatch) sellerGstin = sellerGstinMatch[1].toUpperCase();

  const buyerGstinMatch = text.match(/(?:buyer|customer|consignee|client|to|billed\s*to)\s*(?:gstin|gst|gst\s*no|gstin\/uin)?[:\s]*([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1})/i);
  if (buyerGstinMatch) buyerGstin = buyerGstinMatch[1].toUpperCase();

  if (!sellerGstin || !buyerGstin) {
    if (foundGstins.length === 1) {
      if (sellerGstin) {
        // already determined seller
      } else if (buyerGstin) {
        // already determined buyer
      } else if (activeGstinStr && foundGstins[0] === activeGstinStr) {
        sellerGstin = foundGstins[0];
      } else if (categoryHint === "sales_invoice") {
        sellerGstin = foundGstins[0];
      } else {
        sellerGstin = foundGstins[0];
      }
    } else if (foundGstins.length >= 2) {
      if (!sellerGstin) sellerGstin = foundGstins[0];
      if (!buyerGstin) buyerGstin = foundGstins[1] !== sellerGstin ? foundGstins[1] : (foundGstins[2] || "");
    }
  }

  // 4. Document Type Detection & Bidirectional Classification Validation
  let detectedType = categoryHint || "sales_invoice";
  let classificationConfirmed = true;

  if (activeGstinStr) {
    const isSellerActiveUser = sellerGstin === activeGstinStr;
    const isBuyerActiveUser = buyerGstin === activeGstinStr;

    if (categoryHint === "sales_invoice") {
      if (isSellerActiveUser) {
        detectedType = "sales_invoice";
      } else if (isBuyerActiveUser) {
        classificationConfirmed = false;
        warnings.push({
          field: "classification",
          code: "DIRECTION_MISMATCH",
          message: `Uploaded document buyer GSTIN (${buyerGstin}) matches your active GSTIN (${activeGstinStr}). This document appears to be an inward purchase bill.`
        });
      } else {
        classificationConfirmed = false;
        warnings.push({
          field: "classification",
          code: "GSTIN_MISMATCH",
          message: `Neither seller GSTIN (${sellerGstin || "Not detected"}) nor buyer GSTIN (${buyerGstin || "Not detected"}) matches your active organization GSTIN (${activeGstinStr}). Please verify ownership.`
        });
      }
    } else { // purchase_bill
      if (isBuyerActiveUser) {
        detectedType = "purchase_bill";
      } else if (isSellerActiveUser) {
        classificationConfirmed = false;
        warnings.push({
          field: "classification",
          code: "DIRECTION_MISMATCH",
          message: `Uploaded document seller GSTIN (${sellerGstin}) matches your active GSTIN (${activeGstinStr}). This document appears to be an outward sales invoice.`
        });
      } else {
        classificationConfirmed = false;
        warnings.push({
          field: "classification",
          code: "GSTIN_MISMATCH",
          message: `Neither buyer GSTIN (${buyerGstin || "Not detected"}) nor seller GSTIN (${sellerGstin || "Not detected"}) matches your active organization GSTIN (${activeGstinStr}). Please verify ownership.`
        });
      }
    }
  }

  // 5. Invoice Number Extraction
  let invoiceNumber = "";
  const invPatterns = [
    /(?:invoice|inv|bill|doc|voucher)\s*(?:no\.?|number|#|id)\s*[:\s-]*([A-Z0-9\/-]{3,30})/i,
    /\b(INV[-_/][A-Z0-9\/-]{3,25})\b/i,
    /\b(BILL[-_/][A-Z0-9\/-]{3,25})\b/i,
    /\b(CSP[-_/][0-9]{3,20})\b/i,
    /(?:invoice|inv|bill)\s*#\s*([A-Z0-9\/-]{3,25})/i,
    /(?:tax\s+invoice)\s*(?:no\.?|number|#|id)?\s*[:\s-]*([A-Z0-9\/-]{3,25})/i
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

  // 6. Duplicate Invoice Check
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

  // 7. Invoice Date Extraction
  let invoiceDate = "";
  const datePatterns = [
    /(?:inv(?:oice)?\s*date|dated?|bill\s*date|date\s*of\s*issue)[:\s]*([0-9]{1,2}[\/\-\.\s]+[A-Za-z]{3,9}[\/\-\.\s]+[0-9]{4}|[0-9]{1,2}[\/\-\.][0-9]{1,2}[\/\-\.][0-9]{2,4}|[0-9]{4}[\/\-\.][0-9]{1,2}[\/\-\.][0-9]{1,2})/i,
    /(?:date)[:\s]*([0-9]{1,2}[\/\-\.\s]+[A-Za-z]{3,9}[\/\-\.\s]+[0-9]{4}|[0-9]{1,2}[\/\-\.][0-9]{1,2}[\/\-\.][0-9]{2,4}|[0-9]{4}[\/\-\.][0-9]{1,2}[\/\-\.][0-9]{1,2})/i,
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
    warnings.push({
      field: "invoiceDate",
      code: "MISSING_INVOICE_DATE",
      message: "Invoice date was not found in document. Please enter date before saving."
    });
  }

  // 8. Due Date & Payment Terms Extraction
  let dueDate = "";
  const duePattern = /(?:due\s*date|payment\s*due|due\s*by|pay\s*by)[:\s]*([0-9]{1,2}[\/\-\.\s]+[A-Za-z]{3,9}[\/\-\.\s]+[0-9]{4}|[0-9]{1,2}[\/\-\.][0-9]{1,2}[\/\-\.][0-9]{2,4}|[0-9]{4}[\/\-\.][0-9]{1,2}[\/\-\.][0-9]{1,2})/i;
  const dueMatch = text.match(duePattern);
  if (dueMatch && dueMatch[1]) {
    dueDate = normalizeDate(dueMatch[1].trim());
  }

  let paymentTerms = "";
  const ptPattern = /(?:payment\s*terms|terms\s*of\s*payment|terms)[:\s]*([A-Za-z0-9\s,.-]{2,40})(?=\r?\n|Due|Invoice|Seller|Buyer|$)/i;
  const ptMatch = text.match(ptPattern);
  if (ptMatch && ptMatch[1]) {
    paymentTerms = ptMatch[1].trim();
  }

  // 9. Place of Supply (POS) Extraction
  let pos = "";
  let posStateName = "";
  const posPattern = /(?:place\s*of\s*supply|pos|state\s*of\s*supply|destination)[:\s-]*([0-9]{2}(?:\s*-[A-Za-z\s]+)?|[A-Za-z\s]+(?:\s*\([0-9]{2}\))?)/i;
  const posMatch = text.match(posPattern);
  if (posMatch && posMatch[1]) {
    const rawPos = posMatch[1].trim();
    const parenCode = rawPos.match(/\(([0-9]{2})\)/);
    const leadingCode = rawPos.match(/^([0-9]{2})/);
    const foundCode = (parenCode && parenCode[1]) || (leadingCode && leadingCode[1]);
    if (foundCode && GST_STATE_MAP[foundCode]) {
      pos = foundCode;
      posStateName = GST_STATE_MAP[pos];
    } else {
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
      message: "Place of Supply was not explicitly found. Defaulted to registered state."
    });
  }

  // 10. Reverse Charge Status
  let isRcm = false;
  const rcmMatch = text.match(/(?:reverse\s*charge|rcm)[:\s]*(yes|y|true|no|n|false)/i);
  if (rcmMatch && ["yes", "y", "true"].includes(rcmMatch[1].toLowerCase())) {
    isRcm = true;
  }

  // 11. State determination & Inter-state flag
  const sellerState = (sellerGstin && sellerGstin.length >= 2) ? sellerGstin.substring(0, 2) : (activeGstin?.state_code || "27");
  const isInterstate = pos !== sellerState;

  // 12. Financial Totals Extraction
  let taxableValue = 0;
  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  let cess = 0;
  let roundOff = 0;
  let totalAmount = 0;
  let gstRate = 18;

  // Taxable Value
  let taxableMatch = text.match(/(?:total\s*taxable\s*(?:value|amount)?|taxable\s*(?:value|amount))[:\s₹Rs.nINR]*([0-9,]+(?:\.[0-9]{2})|\b[0-9]+\b)/i);
  if (!taxableMatch) {
    taxableMatch = text.match(/(?:subtotal|sub-total|net\s*amount|taxable)[:\s₹Rs.nINR]*([0-9,]+(?:\.[0-9]{2})|\b[0-9]+\b)/i);
  }
  if (taxableMatch) {
    taxableValue = parseAmount(taxableMatch[1]);
  }

  // Taxes
  const cgstMatch = text.match(/(?:total\s*cgst|cgst)[:\s₹Rs.nINR@0-9%]*?([0-9,]+(?:\.[0-9]{2})|\b[0-9]+\b)/i);
  if (cgstMatch) cgst = parseAmount(cgstMatch[1]);

  const sgstMatch = text.match(/(?:total\s*(?:sgst|utgst)|sgst|utgst)[:\s₹Rs.nINR@0-9%]*?([0-9,]+(?:\.[0-9]{2})|\b[0-9]+\b)/i);
  if (sgstMatch) sgst = parseAmount(sgstMatch[1]);

  const igstMatch = text.match(/(?:total\s*igst|igst)[:\s₹Rs.nINR@0-9%]*?([0-9,]+(?:\.[0-9]{2})|\b[0-9]+\b)/i);
  if (igstMatch) igst = parseAmount(igstMatch[1]);

  const cessMatch = text.match(/(?:total\s*cess|cess)[:\s₹Rs.nINR@0-9%]*?([0-9,]+(?:\.[0-9]{2})|\b[0-9]+\b)/i);
  if (cessMatch) cess = parseAmount(cessMatch[1]);

  const roundOffMatch = text.match(/(?:round\s*off)[:\s₹Rs.nINR]*([+-]?[0-9,]+(?:\.[0-9]{2})|\b[+-]?[0-9]+\b)/i);
  if (roundOffMatch) roundOff = parseAmount(roundOffMatch[1]);

  // Grand Total
  let totalMatch = text.match(/(?:grand\s*total|net\s*payable|invoice\s*total|total\s*amount)[:\s₹Rs.nINR]*([0-9,]+(?:\.[0-9]{2})|\b[0-9]+\b)/i);
  if (!totalMatch) {
    const allTotals = Array.from(text.matchAll(/(?:total\s*(?:amount|value)?|total)[:\s₹Rs.nINR]*([0-9,]+(?:\.[0-9]{2})|\b[0-9]+\b)/gi));
    if (allTotals.length > 0) {
      totalMatch = allTotals[allTotals.length - 1];
    }
  }
  if (totalMatch) {
    totalAmount = parseAmount(totalMatch[1]);
  }

  // Rate detection if specified in text
  const rateMatch = text.match(/(?:gst\s*rate|tax\s*rate|rate)[:\s]*([0-9]{1,2}(?:\.[0-9]+)?)\s*%/i);
  if (rateMatch) {
    const parsedRate = parseFloat(rateMatch[1]);
    if ([0, 5, 12, 18, 28].includes(parsedRate)) {
      gstRate = parsedRate;
    }
  }

  // 13. Line Items Extraction (Multi-Rate & Multi-Item Support)
  const lineItems = extractLineItems(text, {
    defaultTaxable: taxableValue,
    defaultGstRate: gstRate,
    isInterstate
  });

  // If line items were successfully extracted, reconcile with totals
  if (lineItems.length > 0) {
    const sumTaxable = Math.round(lineItems.reduce((acc, item) => acc + (item.taxableValue || 0), 0) * 100) / 100;
    const sumCgst = Math.round(lineItems.reduce((acc, item) => acc + (item.cgst || 0), 0) * 100) / 100;
    const sumSgst = Math.round(lineItems.reduce((acc, item) => acc + (item.sgst || 0), 0) * 100) / 100;
    const sumIgst = Math.round(lineItems.reduce((acc, item) => acc + (item.igst || 0), 0) * 100) / 100;
    const sumTotal = Math.round(lineItems.reduce((acc, item) => acc + (item.totalAmount || 0), 0) * 100) / 100;

    if (taxableValue <= 0 && sumTaxable > 0) taxableValue = sumTaxable;
    if (cgst === 0 && sumCgst > 0) cgst = sumCgst;
    if (sgst === 0 && sumSgst > 0) sgst = sumSgst;
    if (igst === 0 && sumIgst > 0) igst = sumIgst;
    if (totalAmount <= 0 && sumTotal > 0) totalAmount = sumTotal;
  } else {
    // If no line items extracted, do NOT synthesize fake row; raise explicit warning
    warnings.push({
      field: "lineItems",
      code: "LINE_ITEMS_UNPARSED",
      message: "Individual invoice line items could not be parsed automatically. Please add line items manually or verify the document."
    });
  }

  // If tax amounts still 0 and taxableValue exists, infer statutory taxes
  const totalExtractedTax = cgst + sgst + igst + cess;
  if (taxableValue > 0 && totalExtractedTax === 0) {
    if (isInterstate) {
      igst = Math.round(taxableValue * (gstRate / 100) * 100) / 100;
    } else {
      cgst = Math.round(taxableValue * (gstRate / 200) * 100) / 100;
      sgst = Math.round(taxableValue * (gstRate / 200) * 100) / 100;
    }
  }

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

  // Total Verification / Discrepancy Check
  const expectedTotal = Math.round((taxableValue + cgst + sgst + igst + cess + roundOff) * 100) / 100;
  if (taxableValue > 0 && totalAmount > 0 && Math.abs(expectedTotal - totalAmount) > 2.0) {
    warnings.push({
      field: "totalAmount",
      code: "TOTAL_MISMATCH",
      message: `Total amount mismatch: Calculated statutory total (₹${expectedTotal.toFixed(2)}) differs from extracted document total (₹${totalAmount.toFixed(2)}). Please verify.`
    });
  }

  // Confidence Calculation
  let confidence = 0.96;
  if (isScanned) confidence -= 0.20;
  if (!invoiceNumber) confidence -= 0.15;
  if (!invoiceDate) confidence -= 0.10;
  if (taxableValue <= 0) confidence -= 0.20;
  if (warnings.some(w => w.code === "TOTAL_MISMATCH")) confidence -= 0.10;
  if (warnings.some(w => w.code === "INVALID_GSTIN_FORMAT")) confidence -= 0.10;
  if (warnings.some(w => w.code === "DIRECTION_MISMATCH" || w.code === "GSTIN_MISMATCH")) confidence -= 0.05;
  if (lineItems.length === 0) confidence -= 0.10;
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
    classificationConfirmed,
    warnings,
    invoiceNumber,
    invoiceDate,
    dueDate,
    paymentTerms,
    pos,
    sellerGstin,
    buyerGstin,
    invoiceInfo: {
      invoiceNumber,
      invoiceDate,
      dueDate,
      paymentTerms,
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
      taxableAmount: taxableValue,
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
 * Extracts line item rows from text with support for multi-rate and varied column tables
 */
function extractLineItems(text, { defaultTaxable = 0, defaultGstRate = 18, isInterstate = false } = {}) {
  const items = [];
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  
  // Pattern 1: Labeled row: (Description) HSN: (code) Qty: (num) Rate: (num) Taxable: (num)
  const labeledRegex = /^(?:(?:\d+[\.\)]\s*)|(?:Item\s*\d*[:\.\s]*))?([A-Za-z0-9\s&.,'()/-]+?)\s*(?:HSN|SAC)[:\s]*(\d{4,8})[\s\S]*?(?:Qty|Quantity)[:\s]*(\d+(?:\.\d+)?)[\s\S]*?(?:Rate|Price)[:\s]*([0-9,]+(?:\.[0-9]{2})|\b[0-9]+\b)[\s\S]*?(?:Taxable|Amount)[:\s]*([0-9,]+(?:\.[0-9]{2})|\b[0-9]+\b)/i;

  // Pattern 2: Tabular row: S.No (opt) Description HSN Qty (Unit opt) Rate Taxable (GST% opt) (Tax opt) (Total opt)
  const tabRegex = /^(?:(\d+)[\.\)]?\s+)?([A-Za-z0-9\s&.,'()/-]+?)\s+(\d{4,8})\s+(\d+(?:\.\d+)?)\s*(PCS|NOS|KGS|BOX|UNIT|SET|BAG|MTR|DOZ|PAIR|MTRS|SQM|LTR)?\s+[₹Rs.n\s]*([0-9,]+(?:\.[0-9]{2})|\b[0-9]+\b)\s+[₹Rs.n\s]*([0-9,]+(?:\.[0-9]{2})|\b[0-9]+\b)(?:\s+([0-9]{1,2}(?:\.[0-9]+)?)\s*%)?(?:\s+[₹Rs.n\s]*([0-9,]+(?:\.[0-9]{2})|\b[0-9]+\b))?(?:\s+[₹Rs.n\s]*([0-9,]+(?:\.[0-9]{2})|\b[0-9]+\b))?$/i;

  let idx = 1;
  for (const line of lines) {
    // Skip obvious header or total lines
    if (/^(s\.?no|sl\.?no|#|item|description|hsn|qty|rate|taxable|gst%|cgst|sgst|igst|total|grand|subtotal)/i.test(line) &&
        /(hsn|qty|rate|taxable|amount|total)/i.test(line)) {
      continue;
    }

    let description = "";
    let hsnCode = "";
    let quantity = 1;
    let unit = "NOS";
    let rate = 0;
    let taxableValue = 0;
    let taxRate = defaultGstRate;
    let explicitTax = null;
    let explicitTotal = null;

    // Try labeled match
    const mLab = line.match(labeledRegex);
    if (mLab) {
      description = mLab[1].replace(/^(?:\d+[\.\)]\s*)/, "").trim();
      hsnCode = mLab[2];
      quantity = parseFloat(mLab[3]) || 1;
      rate = parseAmount(mLab[4]);
      taxableValue = parseAmount(mLab[5]) || (quantity * rate);

      // Check if line specifies custom GST rate
      const rateMatch = line.match(/(?:GST|Tax)[:\s]*([0-9]{1,2}(?:\.[0-9]+)?)\s*%/i);
      if (rateMatch) {
        const r = parseFloat(rateMatch[1]);
        if ([0, 5, 12, 18, 28].includes(r)) taxRate = r;
      }
    } else {
      // Try tabular match
      const mTab = line.match(tabRegex);
      if (mTab) {
        description = mTab[2].trim();
        hsnCode = mTab[3];
        quantity = parseFloat(mTab[4]) || 1;
        if (mTab[5]) unit = mTab[5].toUpperCase();
        rate = parseAmount(mTab[6]);
        taxableValue = parseAmount(mTab[7]) || (quantity * rate);

        if (mTab[8]) {
          const r = parseFloat(mTab[8]);
          if ([0, 5, 12, 18, 28].includes(r)) taxRate = r;
        } else {
          // Check for % in line
          const rateMatch = line.match(/([0-9]{1,2}(?:\.[0-9]+)?)\s*%/);
          if (rateMatch) {
            const r = parseFloat(rateMatch[1]);
            if ([0, 5, 12, 18, 28].includes(r)) taxRate = r;
          }
        }

        if (mTab[9]) explicitTax = parseAmount(mTab[9]);
        if (mTab[10]) explicitTotal = parseAmount(mTab[10]);
      }
    }

    if (description && hsnCode && taxableValue > 0) {
      const lineTax = explicitTax !== null ? explicitTax : Math.round(taxableValue * (taxRate / 100) * 100) / 100;
      const lineTotal = explicitTotal !== null ? explicitTotal : Math.round((taxableValue + lineTax) * 100) / 100;

      items.push({
        id: `item-${idx++}`,
        description,
        hsn: hsnCode,
        hsnCode,
        quantity,
        unit,
        rate,
        discount: 0,
        taxableAmount: taxableValue,
        taxableValue,
        gstRate: taxRate,
        cgst: isInterstate ? 0 : Math.round(lineTax / 2 * 100) / 100,
        sgst: isInterstate ? 0 : Math.round(lineTax / 2 * 100) / 100,
        igst: isInterstate ? lineTax : 0,
        taxAmount: lineTax,
        totalAmount: lineTotal
      });
    }
  }

  return items;
}

export function parseAmount(val) {
  if (typeof val === "number") return val;
  if (!val) return 0;
  const num = parseFloat(String(val).replace(/,/g, "").trim());
  return isNaN(num) ? 0 : num;
}

export function normalizeDate(str) {
  if (!str) return "";
  const s = String(str).trim();
  // Check YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // Check DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  const m1 = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if (m1) {
    const day = m1[1].padStart(2, "0");
    const month = m1[2].padStart(2, "0");
    let year = m1[3];
    if (year.length === 2) year = "20" + year;
    return `${year}-${month}-${day}`;
  }

  // Check DD-MMM-YYYY or DD/MMM/YYYY or DD MMM YYYY (e.g. 06-Nov-2026, 06 Nov 2026, 21-Nov-2026)
  const months = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
    january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
    july: "07", august: "08", september: "09", october: "10", november: "11", december: "12"
  };

  const m2 = s.match(/^(\d{1,2})[\/\-\.\s]+([A-Za-z]{3,9})[\/\-\.\s]+(\d{4})$/);
  if (m2) {
    const day = m2[1].padStart(2, "0");
    const month = months[m2[2].toLowerCase()] || "01";
    return `${m2[3]}-${month}-${day}`;
  }

  // Check MMM DD, YYYY (e.g. Nov 06, 2026)
  const m3 = s.match(/^([A-Za-z]{3,9})[\/\-\.\s]+(\d{1,2}),?[\/\-\.\s]+(\d{4})$/);
  if (m3) {
    const day = m3[2].padStart(2, "0");
    const month = months[m3[1].toLowerCase()] || "01";
    return `${m3[3]}-${month}-${day}`;
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
