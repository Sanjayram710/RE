import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

import {
  db,
  userRepo,
  orgRepo,
  gstinRepo,
  sessionRepo,
  salesRepo,
  purchaseRepo,
  documentRepo,
  ocrRepo,
  seedDevelopmentData
} from "../lib/db.js";

import { handleFunctionalApi } from "../lib/functionalApi.js";
import { extractTextFromPdf, parseInvoiceFromText } from "../lib/pdfInvoiceExtractor.js";

function createMockRes() {
  return {
    statusCode: null,
    headers: {},
    body: "",
    writeHead(code, headers = {}) {
      this.statusCode = code;
      this.headers = headers;
    },
    end(data = "") {
      this.body = data;
    }
  };
}

let testSessionToken = null;
let activeGstinRecord = null;

function setupAuth() {
  seedDevelopmentData();
  const token = `tok-pdf-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const user = userRepo.findByEmail("rajesh.sharma@apexretail.com") || db.prepare("SELECT * FROM users LIMIT 1").get();
  const org = db.prepare("SELECT * FROM organizations LIMIT 1").get();
  const gstin = db.prepare("SELECT * FROM gst_registrations WHERE org_id = ? LIMIT 1").get(org.id);
  activeGstinRecord = gstin;

  const session = sessionRepo.create({
    userId: user.id,
    activeOrgId: org.id,
    activeGstinId: gstin.id,
    activePeriod: "102026",
    token
  });
  testSessionToken = session.token;
}

function getAuthReq(extraHeaders = {}) {
  if (!testSessionToken) {
    setupAuth();
  }
  return {
    headers: {
      authorization: `Bearer ${testSessionToken}`,
      ...extraHeaders
    }
  };
}

/**
 * Creates a minimal valid PDF Buffer with compressed text streams
 */
function createPdfBuffer(lines = [], { isScanned = false } = {}) {
  if (isScanned) {
    return Buffer.from(
      "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
      "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n" +
      "3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n" +
      "4 0 obj\n<< /Type /XObject /Subtype /Image /Width 100 /Height 100 /ColorSpace /DeviceRGB /BitsPerComponent 8 >>\nstream\n" +
      "\x00".repeat(100) +
      "\nendstream\nendobj\n" +
      "5 0 obj\n<< /Length 10 >>\nstream\n/Im1 Do\nendstream\nendobj\n" +
      "xref\n0 6\n0000000000 65535 f \ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n500\n%%EOF"
    );
  }

  const tjParts = lines.map(line => `(${line.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")}) Tj`).join(" T* ");
  const textStream = `BT /F1 12 Tf 50 750 Td ${tjParts} ET`;
  const streamData = zlib.deflateSync(Buffer.from(textStream, "utf8"));

  const header = `%PDF-1.4\n1 0 obj\n<< /Filter /FlateDecode /Length ${streamData.length} >>\nstream\n`;
  const footer = `\nendstream\nendobj\nxref\ntrailer\n<< >>\nstartxref\n0\n%%EOF`;
  return Buffer.concat([Buffer.from(header, "utf8"), streamData, Buffer.from(footer, "utf8")]);
}

// ============================================================================
// SCENARIO 1: Text-Based Sales PDF Extraction & Verification
// ============================================================================
test("Scenario 1: Text-based Sales PDF upload, extraction and persistence", async () => {
  setupAuth();
  const invNo = `INV-SALES-${Date.now().toString().slice(-5)}`;
  const lines = [
    "TAX INVOICE",
    `Invoice No: ${invNo}`,
    "Invoice Date: 12/10/2026",
    "Seller Name: Apex Retail Private Limited",
    `Seller GSTIN: ${activeGstinRecord.gstin}`,
    "Buyer Name: TechCorp Infotech Solutions",
    "Buyer GSTIN: 27AABCT1332L1ZV",
    "Place of Supply: 27-Maharashtra",
    "Item 1: Enterprise ERP Software License HSN: 997331 Qty: 1 Rate: 50000.00 Taxable: 50000.00 GST: 18% CGST: 4500.00 SGST: 4500.00 Total: 59000.00",
    "Total Taxable Amount: 50000.00",
    "CGST Amount: 4500.00",
    "SGST Amount: 4500.00",
    "Grand Total: 59000.00"
  ];

  const pdfBuf = createPdfBuffer(lines);
  const base64Content = `data:application/pdf;base64,${pdfBuf.toString("base64")}`;

  const res = createMockRes();
  await handleFunctionalApi(getAuthReq(), res, "/api/documents/upload", "POST", {}, {
    filename: `${invNo}.pdf`,
    category: "sales_invoice",
    content: base64Content
  });

  assert.equal(res.statusCode, 201, "Upload must succeed with 201 Created");
  const data = JSON.parse(res.body);
  assert.equal(data.success, true);
  assert.ok(data.document?.id, "Document record must be created");
  assert.equal(data.parsedInvoice.invoiceNumber, invNo);
  assert.equal(data.parsedInvoice.invoiceDate, "2026-10-12");
  assert.equal(data.parsedInvoice.documentType, "sales_invoice");
  assert.equal(data.parsedInvoice.buyer.gstin, "27AABCT1332L1ZV");
  assert.equal(data.parsedInvoice.totals.taxableAmount, 50000);
  assert.equal(data.parsedInvoice.totals.cgst, 4500);
  assert.equal(data.parsedInvoice.totals.sgst, 4500);
  assert.equal(data.parsedInvoice.totals.totalAmount, 59000);

  // Now Approve and Save through /api/ocr/approve
  const approveRes = createMockRes();
  await handleFunctionalApi(getAuthReq(), approveRes, "/api/ocr/approve", "POST", {}, {
    documentId: data.document.id,
    invoiceType: "sales_invoice",
    fields: {
      invoiceNumber: data.parsedInvoice.invoiceNumber,
      invoiceDate: data.parsedInvoice.invoiceDate,
      customerName: data.parsedInvoice.buyer.name,
      customerGstin: data.parsedInvoice.buyer.gstin,
      pos: data.parsedInvoice.invoiceInfo.pos,
      taxableAmount: data.parsedInvoice.totals.taxableAmount,
      gstRate: 18,
      cgst: data.parsedInvoice.totals.cgst,
      sgst: data.parsedInvoice.totals.sgst,
      igst: 0,
      totalTax: data.parsedInvoice.totals.totalTax,
      totalAmount: data.parsedInvoice.totals.totalAmount
    }
  });

  assert.equal(approveRes.statusCode, 200);
  const approveData = JSON.parse(approveRes.body);
  assert.equal(approveData.success, true);

  // Verify stored in SQLite sales_invoices
  const savedRow = db.prepare("SELECT * FROM sales_invoices WHERE invoice_number = ? AND gstin_id = ?").get(invNo, activeGstinRecord.id);
  assert.ok(savedRow, "Sales invoice must be stored in SQLite");
  assert.equal(savedRow.taxable_amount, 50000);
  assert.equal(savedRow.total_amount, 59000);
});

// ============================================================================
// SCENARIO 2: Text-Based Purchase PDF Extraction & Verification
// ============================================================================
test("Scenario 2: Text-based Purchase PDF upload, extraction and persistence", async () => {
  setupAuth();
  const billNo = `BILL-PUR-${Date.now().toString().slice(-5)}`;
  const lines = [
    "TAX INVOICE / VENDOR BILL",
    `Bill Number: ${billNo}`,
    "Date: 14/10/2026",
    "Supplier: Reliance Cloud Services Ltd",
    "Supplier GSTIN: 27AABCR8821M1ZY",
    "Buyer Name: Apex Retail Private Limited",
    `Buyer GSTIN: ${activeGstinRecord.gstin}`,
    "Place of Supply: 27-Maharashtra",
    "Item 1: Dedicated Server Hosting HSN: 998315 Qty: 1 Rate: 20000.00 Taxable: 20000.00 GST: 18% CGST: 1800.00 SGST: 1800.00 Total: 23600.00",
    "Subtotal: 20000.00",
    "CGST: 1800.00",
    "SGST: 1800.00",
    "Total: 23600.00"
  ];

  const pdfBuf = createPdfBuffer(lines);
  const base64Content = `data:application/pdf;base64,${pdfBuf.toString("base64")}`;

  const res = createMockRes();
  await handleFunctionalApi(getAuthReq(), res, "/api/documents/upload", "POST", {}, {
    filename: `${billNo}.pdf`,
    category: "purchase_bill",
    content: base64Content
  });

  assert.equal(res.statusCode, 201);
  const data = JSON.parse(res.body);
  assert.equal(data.parsedInvoice.invoiceNumber, billNo);
  assert.equal(data.parsedInvoice.documentType, "purchase_bill");
  assert.equal(data.parsedInvoice.seller.gstin, "27AABCR8821M1ZY");
  assert.equal(data.parsedInvoice.totals.taxableAmount, 20000);
  assert.equal(data.parsedInvoice.totals.totalAmount, 23600);

  // Approve & Save Purchase Bill
  const approveRes = createMockRes();
  await handleFunctionalApi(getAuthReq(), approveRes, "/api/ocr/approve", "POST", {}, {
    documentId: data.document.id,
    invoiceType: "purchase_bill",
    fields: {
      invoiceNumber: billNo,
      invoiceDate: data.parsedInvoice.invoiceDate,
      supplierName: data.parsedInvoice.seller.name,
      supplierGstin: data.parsedInvoice.seller.gstin,
      pos: data.parsedInvoice.invoiceInfo.pos,
      taxableAmount: data.parsedInvoice.totals.taxableAmount,
      gstRate: 18,
      cgst: 1800,
      sgst: 1800,
      igst: 0,
      totalTax: 3600,
      totalAmount: 23600,
      itcEligibility: "ELIGIBLE"
    }
  });

  assert.equal(approveRes.statusCode, 200);
  const savedRow = db.prepare("SELECT * FROM purchase_invoices WHERE invoice_number = ? AND gstin_id = ?").get(billNo, activeGstinRecord.id);
  assert.ok(savedRow, "Purchase bill must be persisted in SQLite");
  assert.equal(savedRow.supplier_gstin, "27AABCR8821M1ZY");
  assert.equal(savedRow.itc_eligibility, "ELIGIBLE");
});

// ============================================================================
// SCENARIO 3: Scanned Sales PDF Handling
// ============================================================================
test("Scenario 3: Scanned Sales PDF handling, confidence warning and statutory notice", async () => {
  setupAuth();
  const pdfBuf = createPdfBuffer([], { isScanned: true });
  const base64Content = `data:application/pdf;base64,${pdfBuf.toString("base64")}`;

  const res = createMockRes();
  await handleFunctionalApi(getAuthReq(), res, "/api/documents/upload", "POST", {}, {
    filename: "Scanned_Sales_Receipt.pdf",
    category: "sales_invoice",
    content: base64Content
  });

  assert.equal(res.statusCode, 201);
  const data = JSON.parse(res.body);
  assert.equal(data.parsedInvoice.isScanned, true, "Must flag isScanned: true");
  assert.ok(data.parsedInvoice.confidenceScore <= 76, "Confidence score must be penalized for scanned file");

  const scannedWarning = data.warnings.find(w => w.code === "SCANNED_DOCUMENT_NOTICE");
  assert.ok(scannedWarning, "Must generate statutory SCANNED_DOCUMENT_NOTICE warning");
  assert.match(scannedWarning.message, /scanned image-based document/i);
});

// ============================================================================
// SCENARIO 4: Scanned Purchase PDF Handling
// ============================================================================
test("Scenario 4: Scanned Purchase PDF handling and warning generation", async () => {
  setupAuth();
  const pdfBuf = createPdfBuffer([], { isScanned: true });
  const base64Content = `data:application/pdf;base64,${pdfBuf.toString("base64")}`;

  const res = createMockRes();
  await handleFunctionalApi(getAuthReq(), res, "/api/documents/upload", "POST", {}, {
    filename: "Vendor_Scanned_Bill.pdf",
    category: "purchase_bill",
    content: base64Content
  });

  assert.equal(res.statusCode, 201);
  const data = JSON.parse(res.body);
  assert.equal(data.parsedInvoice.isScanned, true);
  assert.ok(data.warnings.some(w => w.code === "SCANNED_DOCUMENT_NOTICE"));
});

// ============================================================================
// SCENARIO 5: PDF with Multiple Line Items
// ============================================================================
test("Scenario 5: Multi-item line items extracted with HSN, Qty, Rate, Taxable and Taxes", async () => {
  setupAuth();
  const invNo = `INV-MULTI-${Date.now().toString().slice(-5)}`;
  const lines = [
    "TAX INVOICE",
    `Invoice Number: ${invNo}`,
    "Invoice Date: 2026-10-18",
    `Seller GSTIN: ${activeGstinRecord.gstin}`,
    "Buyer Name: Metro Retails",
    "Buyer GSTIN: 27AAACM1234B1Z2",
    "Place of Supply: 27-Maharashtra",
    "1. Dell Optiplex Desktop HSN: 847130 Qty: 5 Rate: 40000.00 Taxable: 200000.00 GST: 18% CGST: 18000.00 SGST: 18000.00 Total: 236000.00",
    "2. HP LaserJet Pro Printer HSN: 844332 Qty: 2 Rate: 15000.00 Taxable: 30000.00 GST: 18% CGST: 2700.00 SGST: 2700.00 Total: 35400.00",
    "3. Cat6 Networking Cables HSN: 854442 Qty: 10 Rate: 1000.00 Taxable: 10000.00 GST: 18% CGST: 900.00 SGST: 900.00 Total: 11800.00",
    "Total Taxable Value: 240000.00",
    "Total CGST: 21600.00",
    "Total SGST: 21600.00",
    "Grand Total: 283200.00"
  ];

  const pdfBuf = createPdfBuffer(lines);
  const res = createMockRes();
  await handleFunctionalApi(getAuthReq(), res, "/api/documents/upload", "POST", {}, {
    filename: `${invNo}.pdf`,
    category: "sales_invoice",
    content: `data:application/pdf;base64,${pdfBuf.toString("base64")}`
  });

  assert.equal(res.statusCode, 201);
  const data = JSON.parse(res.body);
  const items = data.parsedInvoice.lineItems;
  assert.ok(items.length >= 3, `Expected at least 3 line items, got ${items.length}`);

  // Verify item 1
  assert.match(items[0].description, /Dell Optiplex Desktop/i);
  assert.equal(items[0].hsn, "847130");
  assert.equal(items[0].quantity, 5);
  assert.equal(items[0].rate, 40000);
  assert.equal(items[0].taxableAmount, 200000);

  // Verify item 2
  assert.match(items[1].description, /HP LaserJet Pro Printer/i);
  assert.equal(items[1].quantity, 2);
  assert.equal(items[1].taxableAmount, 30000);

  // Verify sum of line items taxable amount matches invoice total
  const lineSum = items.reduce((sum, it) => sum + (it.taxableAmount || 0), 0);
  assert.equal(lineSum, 240000, "Sum of line items must equal total taxable amount");
  assert.equal(data.parsedInvoice.totals.totalAmount, 283200);
});

// ============================================================================
// SCENARIO 6: PDF with Missing Fields (Missing Number, Date)
// ============================================================================
test("Scenario 6: PDF with missing fields generates appropriate validation warnings", async () => {
  setupAuth();
  // PDF with no invoice number or date
  const lines = [
    "TAX INVOICE",
    "Seller Name: ABC Services",
    `Seller GSTIN: ${activeGstinRecord.gstin}`,
    "Buyer Name: Customer Corp",
    "Subtotal: 15000.00",
    "GST 18%: 2700.00",
    "Total: 17700.00"
  ];

  const pdfBuf = createPdfBuffer(lines);
  const res = createMockRes();
  await handleFunctionalApi(getAuthReq(), res, "/api/documents/upload", "POST", {}, {
    filename: "Incomplete_Doc.pdf",
    category: "sales_invoice",
    content: `data:application/pdf;base64,${pdfBuf.toString("base64")}`
  });

  assert.equal(res.statusCode, 201);
  const data = JSON.parse(res.body);
  assert.ok(data.warnings.some(w => w.code === "MISSING_INVOICE_NUMBER"), "Must flag MISSING_INVOICE_NUMBER");
  assert.ok(data.warnings.some(w => w.code === "MISSING_INVOICE_DATE"), "Must flag MISSING_INVOICE_DATE");
});

// ============================================================================
// SCENARIO 7: PDF with Incorrect Totals (Taxable + Taxes != Total)
// ============================================================================
test("Scenario 7: PDF with mathematical total mismatch generates TOTAL_MISMATCH warning", async () => {
  setupAuth();
  const invNo = `INV-MISMATCH-${Date.now().toString().slice(-5)}`;
  const lines = [
    "TAX INVOICE",
    `Invoice No: ${invNo}`,
    "Date: 2026-10-19",
    `Seller GSTIN: ${activeGstinRecord.gstin}`,
    "Buyer Name: Client Ltd",
    "Buyer GSTIN: 27AABCT1332L1ZV",
    "Place of Supply: 27-Maharashtra",
    "Taxable Amount: 10000.00",
    "CGST: 900.00",
    "SGST: 900.00",
    "Grand Total: 99999.00" // Deliberate mismatch (10000 + 1800 != 99999)
  ];

  const pdfBuf = createPdfBuffer(lines);
  const res = createMockRes();
  await handleFunctionalApi(getAuthReq(), res, "/api/documents/upload", "POST", {}, {
    filename: `${invNo}.pdf`,
    category: "sales_invoice",
    content: `data:application/pdf;base64,${pdfBuf.toString("base64")}`
  });

  assert.equal(res.statusCode, 201);
  const data = JSON.parse(res.body);
  const mismatchWarning = data.warnings.find(w => w.code === "TOTAL_MISMATCH");
  assert.ok(mismatchWarning, "Must generate TOTAL_MISMATCH warning");
  assert.match(mismatchWarning.message, /mismatch/i);
});

// ============================================================================
// SCENARIO 8: Duplicate Invoice Handling
// ============================================================================
test("Scenario 8: Duplicate invoice generates warning on upload and 400 rejection on approve", async () => {
  setupAuth();
  const dupInvNo = `INV-DUP-${Date.now().toString().slice(-5)}`;

  // 1. First insert into SQLite
  salesRepo.create({
    orgId: activeGstinRecord.org_id,
    gstinId: activeGstinRecord.id,
    period: "102026",
    invoiceNumber: dupInvNo,
    invoiceDate: "2026-10-15",
    customerName: "Existing Client",
    customerGstin: "27AABCT1332L1ZV",
    pos: "27",
    taxableAmount: 10000,
    gstRate: 18,
    cgst: 900,
    sgst: 900,
    igst: 0,
    totalTax: 1800,
    totalAmount: 11800
  });

  // 2. Upload duplicate PDF
  const lines = [
    "TAX INVOICE",
    `Invoice No: ${dupInvNo}`,
    "Date: 2026-10-15",
    `Seller GSTIN: ${activeGstinRecord.gstin}`,
    "Buyer Name: Duplicate Buyer",
    "Buyer GSTIN: 27AABCT1332L1ZV",
    "Taxable Amount: 10000.00",
    "Grand Total: 11800.00"
  ];
  const pdfBuf = createPdfBuffer(lines);
  const uploadRes = createMockRes();
  await handleFunctionalApi(getAuthReq(), uploadRes, "/api/documents/upload", "POST", {}, {
    filename: `${dupInvNo}.pdf`,
    category: "sales_invoice",
    content: `data:application/pdf;base64,${pdfBuf.toString("base64")}`
  });

  assert.equal(uploadRes.statusCode, 201);
  const uploadData = JSON.parse(uploadRes.body);
  const dupWarning = uploadData.warnings.find(w => w.code === "DUPLICATE_INVOICE_NUMBER");
  assert.ok(dupWarning, "Must identify duplicate invoice number on upload");

  // 3. Attempt to approve duplicate invoice -> MUST return 400
  const approveRes = createMockRes();
  await handleFunctionalApi(getAuthReq(), approveRes, "/api/ocr/approve", "POST", {}, {
    invoiceType: "sales_invoice",
    fields: {
      invoiceNumber: dupInvNo,
      invoiceDate: "2026-10-15",
      customerName: "Duplicate Buyer",
      taxableAmount: 10000,
      totalAmount: 11800
    }
  });

  assert.equal(approveRes.statusCode, 400, "Must reject duplicate invoice approval with 400 Bad Request");
  const approveData = JSON.parse(approveRes.body);
  assert.match(approveData.error, /duplicate/i);
});

// ============================================================================
// SCENARIO 9: Invalid / Corrupt PDF Handling
// ============================================================================
test("Scenario 9: Corrupt binary upload is handled gracefully without crashing", async () => {
  setupAuth();
  const corruptBuf = Buffer.from("%PDF-1.4\nBROKEN_AND_CORRUPT_BYTE_STREAM_NON_STANDARD_DATA\x00\xFF\xFE%%EOF");
  const res = createMockRes();

  await handleFunctionalApi(getAuthReq(), res, "/api/documents/upload", "POST", {}, {
    filename: "Corrupted_File.pdf",
    category: "sales_invoice",
    content: `data:application/pdf;base64,${corruptBuf.toString("base64")}`
  });

  assert.equal(res.statusCode, 201);
  const data = JSON.parse(res.body);
  assert.ok(data.document?.id, "Document saved even if text is empty/corrupt");
  assert.ok(data.warnings.length > 0, "Warnings generated for missing fields");
});

// ============================================================================
// SCENARIO 10: Oversized PDF (>15MB) Rejection
// ============================================================================
test("Scenario 10: Oversized file exceeding 15MB is rejected with 400", async () => {
  setupAuth();
  // Create virtual 16MB buffer
  const largeBuffer = Buffer.alloc(16 * 1024 * 1024);
  const res = createMockRes();

  await handleFunctionalApi(getAuthReq(), res, "/api/documents/upload", "POST", {}, {
    filename: "Too_Large.pdf",
    category: "sales_invoice",
    content: largeBuffer
  });

  assert.equal(res.statusCode, 400, "Oversized file must be rejected with 400");
  const data = JSON.parse(res.body);
  assert.match(data.error, /15MB/i);
});

// ============================================================================
// SCENARIO 11: Different GST Rates (0%, 5%, 12%, 18%, 28%)
// ============================================================================
test("Scenario 11: Invoices with various GST rates (0%, 5%, 12%, 18%, 28%) are accurately parsed", () => {
  const rates = [
    { rate: 0, taxable: 10000, tax: 0, total: 10000 },
    { rate: 5, taxable: 10000, tax: 500, total: 10500 },
    { rate: 12, taxable: 10000, tax: 1200, total: 11200 },
    { rate: 18, taxable: 10000, tax: 1800, total: 11800 },
    { rate: 28, taxable: 10000, tax: 2800, total: 12800 }
  ];

  for (const item of rates) {
    const rawText = `TAX INVOICE\nInvoice No: INV-R-${item.rate}\nDate: 2026-10-20\nSeller GSTIN: 27AABCT1332L1ZV\nBuyer GSTIN: 27AABCU9603R1ZX\nRate: ${item.rate}%\nTaxable Amount: ${item.taxable.toFixed(2)}\nCGST: ${(item.tax / 2).toFixed(2)}\nSGST: ${(item.tax / 2).toFixed(2)}\nGrand Total: ${item.total.toFixed(2)}`;
    const parsed = parseInvoiceFromText(rawText);
    assert.equal(parsed.totals.taxableAmount, item.taxable);
    assert.equal(parsed.totals.totalAmount, item.total);
    assert.equal(parsed.totals.cgst, item.tax / 2);
    assert.equal(parsed.totals.sgst, item.tax / 2);
  }
});

// ============================================================================
// SCENARIO 12: Inter-State (IGST) vs Intra-State (CGST + SGST) Determination
// ============================================================================
test("Scenario 12: Inter-state vs Intra-state Place of Supply determination and persistence", async () => {
  setupAuth();
  
  // Case A: Intra-State (Maharashtra 27 -> Maharashtra 27)
  const intraInvNo = `INV-INTRA-${Date.now().toString().slice(-5)}`;
  const intraText = [
    "TAX INVOICE",
    `Invoice No: ${intraInvNo}`,
    "Date: 2026-10-22",
    `Seller GSTIN: ${activeGstinRecord.gstin}`, // Starts with 27
    "Buyer GSTIN: 27AABCT1332L1ZV", // Starts with 27
    "Place of Supply: 27-Maharashtra",
    "Taxable Amount: 100000.00",
    "CGST: 9000.00",
    "SGST: 9000.00",
    "Grand Total: 118000.00"
  ];

  const intraBuf = createPdfBuffer(intraText);
  const intraRes = createMockRes();
  await handleFunctionalApi(getAuthReq(), intraRes, "/api/documents/upload", "POST", {}, {
    filename: `${intraInvNo}.pdf`,
    category: "sales_invoice",
    content: `data:application/pdf;base64,${intraBuf.toString("base64")}`
  });

  const intraData = JSON.parse(intraRes.body);
  assert.equal(intraData.parsedInvoice.invoiceInfo.isInterstate, false, "Intra-state must have isInterstate: false");
  assert.equal(intraData.parsedInvoice.totals.cgst, 9000);
  assert.equal(intraData.parsedInvoice.totals.sgst, 9000);
  assert.equal(intraData.parsedInvoice.totals.igst, 0);

  // Case B: Inter-State (Maharashtra 27 -> Karnataka 29)
  const interInvNo = `INV-INTER-${Date.now().toString().slice(-5)}`;
  const interText = [
    "TAX INVOICE",
    `Invoice No: ${interInvNo}`,
    "Date: 2026-10-22",
    `Seller GSTIN: ${activeGstinRecord.gstin}`, // 27
    "Buyer GSTIN: 29AABCB1234L1Z1", // 29-Karnataka
    "Place of Supply: 29-Karnataka",
    "Taxable Amount: 100000.00",
    "IGST: 18000.00",
    "Grand Total: 118000.00"
  ];

  const interBuf = createPdfBuffer(interText);
  const interRes = createMockRes();
  await handleFunctionalApi(getAuthReq(), interRes, "/api/documents/upload", "POST", {}, {
    filename: `${interInvNo}.pdf`,
    category: "sales_invoice",
    content: `data:application/pdf;base64,${interBuf.toString("base64")}`
  });

  const interData = JSON.parse(interRes.body);
  assert.equal(interData.parsedInvoice.invoiceInfo.isInterstate, true, "Inter-state must have isInterstate: true");
  assert.equal(interData.parsedInvoice.totals.igst, 18000);
  assert.equal(interData.parsedInvoice.totals.cgst, 0);
  assert.equal(interData.parsedInvoice.totals.sgst, 0);

  // Save the Inter-state invoice to SQLite
  const saveInterRes = createMockRes();
  await handleFunctionalApi(getAuthReq(), saveInterRes, "/api/ocr/approve", "POST", {}, {
    invoiceType: "sales_invoice",
    fields: {
      invoiceNumber: interInvNo,
      invoiceDate: "2026-10-22",
      customerName: interData.parsedInvoice.buyer.name,
      customerGstin: interData.parsedInvoice.buyer.gstin,
      pos: "29",
      taxableAmount: 100000,
      gstRate: 18,
      igst: 18000,
      cgst: 0,
      sgst: 0,
      totalTax: 18000,
      totalAmount: 118000
    }
  });

  assert.equal(saveInterRes.statusCode, 200);
  const dbInter = db.prepare("SELECT * FROM sales_invoices WHERE invoice_number = ?").get(interInvNo);
  assert.ok(dbInter);
  assert.equal(dbInter.pos, "29");
  assert.equal(dbInter.is_interstate, 1);
  assert.equal(dbInter.igst, 18000);
  assert.equal(dbInter.cgst, 0);
  assert.equal(dbInter.sgst, 0);
});

