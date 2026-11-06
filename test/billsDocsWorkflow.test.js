/**
 * SimpleGST - Bills & Docs Central Document Management Integration Test Suite
 * Validates document ingestion, PDF/Image OCR extraction, editable review, drafts,
 * rejection, preview, relational register links, duplicates, and tenant isolation.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  db,
  userRepo,
  orgRepo,
  gstinRepo,
  sessionRepo,
  documentRepo,
  ocrRepo,
  salesRepo,
  purchaseRepo
} from "../lib/db.js";
import { handleFunctionalApi } from "../lib/functionalApi.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const uploadsDir = path.join(rootDir, "data", "uploads");

import zlib from "node:zlib";

import { Writable } from "node:stream";

// Helper: Mock HTTP Response
function createMockRes() {
  const res = new Writable({
    write(chunk, encoding, callback) {
      res.body += Buffer.isBuffer(chunk) ? chunk.toString("binary") : chunk;
      callback();
    }
  });
  res.statusCode = 200;
  res.headers = {};
  res.body = "";
  res.setHeader = function(k, v) {
    this.headers[k.toLowerCase()] = v;
  };
  res.status = function(code) {
    this.statusCode = code;
    return this;
  };
  res.writeHead = function(code, headers = {}) {
    this.statusCode = code;
    for (const [k, v] of Object.entries(headers)) {
      this.headers[k.toLowerCase()] = v;
    }
  };
  return res;
}

// Generate valid compressed PDF buffer
function createPdfBuffer(lines = ["INVOICE"]) {
  const tjParts = lines.map(line => `(${line.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")}) Tj`).join(" T* ");
  const textStream = `BT /F1 12 Tf 50 750 Td ${tjParts} ET`;
  const streamData = zlib.deflateSync(Buffer.from(textStream, "utf8"));

  const header = `%PDF-1.4\n1 0 obj\n<< /Filter /FlateDecode /Length ${streamData.length} >>\nstream\n`;
  const footer = `\nendstream\nendobj\nxref\ntrailer\n<< >>\nstartxref\n0\n%%EOF`;
  return Buffer.concat([Buffer.from(header, "utf8"), streamData, Buffer.from(footer, "utf8")]);
}

// Setup dedicated test organizations and users
const testUser = userRepo.findByEmail("rajesh.sharma@apexretail.com") || db.prepare("SELECT * FROM users LIMIT 1").get();
const primaryOrg = orgRepo.getUserOrgs(testUser.id)[0] || db.prepare("SELECT * FROM organizations LIMIT 1").get();
const activeGstin = gstinRepo.listByOrg(primaryOrg.id)[0] || db.prepare("SELECT * FROM gst_registrations WHERE org_id = ? LIMIT 1").get(primaryOrg.id);

// Create isolated second tenant organization & user
let tenantBUser = userRepo.findByEmail("tenantb@simplegst.test");
if (!tenantBUser) {
  tenantBUser = userRepo.create({
    email: "tenantb@simplegst.test",
    passwordHash: "dummyhash123",
    fullName: "Tenant B Admin",
    role: "OWNER"
  });
}
let tenantBOrg = orgRepo.getUserOrgs(tenantBUser.id)[0];
if (!tenantBOrg) {
  tenantBOrg = orgRepo.create({
    name: "Tenant B Global Pvt Ltd",
    pan: "AAACB9999F"
  });
  orgRepo.addMember(tenantBOrg.id, tenantBUser.id, "OWNER");
}
let tenantBGstin = gstinRepo.listByOrg(tenantBOrg.id)[0];
if (!tenantBGstin) {
  tenantBGstin = gstinRepo.create({
    orgId: tenantBOrg.id,
    gstin: "27AAACB9999F1Z9",
    stateCode: "27",
    stateName: "Maharashtra",
    tradeName: "Tenant B",
    isPrimary: 1
  });
}

const sessionTokenA = `tok-orgA-${Date.now()}`;
sessionRepo.create({
  userId: testUser.id,
  activeOrgId: primaryOrg.id,
  activeGstinId: activeGstin.id,
  activePeriod: "102026",
  token: sessionTokenA
});

const sessionTokenB = `tok-orgB-${Date.now()}`;
sessionRepo.create({
  userId: tenantBUser.id,
  activeOrgId: tenantBOrg.id,
  activeGstinId: tenantBGstin.id,
  activePeriod: "102026",
  token: sessionTokenB
});

function getOrgAReq(extraHeaders = {}) {
  return {
    headers: {
      host: "localhost:3000",
      authorization: `Bearer ${sessionTokenA}`,
      ...extraHeaders
    }
  };
}

function getOrgBReq(extraHeaders = {}) {
  return {
    headers: {
      host: "localhost:3000",
      authorization: `Bearer ${sessionTokenB}`,
      ...extraHeaders
    }
  };
}

// ============================================================================
// TESTS
// ============================================================================

test("Bills & Docs 1: Ingest text-based PDF invoice, verify metadata, extraction and stats", async () => {
  const invNumber = `DOC-TEST-${Date.now().toString().slice(-5)}`;
  const pdfLines = [
    "TAX INVOICE",
    `Invoice Number: ${invNumber}`,
    "Invoice Date: 2026-10-18",
    "Place of Supply: 27-Maharashtra",
    "Supplier: Supreme Hardware Supplies",
    "Supplier GSTIN: 27ABCDE5555F1Z5",
    "Recipient: My Business",
    `Recipient GSTIN: ${activeGstin.gstin}`,
    "Industrial Tools and Spares HSN 8466: Taxable 50000.00, GST 18%",
    "Taxable Value: 50000.00",
    "CGST: 4500.00",
    "SGST: 4500.00",
    "Total Invoice Amount: 59000.00"
  ];
  const pdfBuf = createPdfBuffer(pdfLines);

  const res = createMockRes();
  await handleFunctionalApi(getOrgAReq(), res, "/api/documents/upload", "POST", {}, {
    filename: `${invNumber}.pdf`,
    category: "purchase_bill",
    content: `data:application/pdf;base64,${pdfBuf.toString("base64")}`
  });

  assert.equal(res.statusCode, 201);
  const data = JSON.parse(res.body);
  assert.equal(data.success, true);
  assert.ok(data.document.id);
  assert.equal(data.document.original_filename, `${invNumber}.pdf`);
  assert.equal(data.parsedInvoice.invoiceInfo.invoiceNumber, invNumber);
  assert.equal(data.parsedInvoice.totals.taxableAmount, 50000);
  assert.equal(data.parsedInvoice.totals.totalAmount, 59000);

  // Check GET /api/documents returns this document and aggregated stats
  const listRes = createMockRes();
  await handleFunctionalApi(getOrgAReq(), listRes, "/api/documents", "GET", {}, {});
  assert.equal(listRes.statusCode, 200);
  const listData = JSON.parse(listRes.body);
  assert.equal(listData.success, true);
  assert.ok(listData.stats.total >= 1);
  assert.ok(listData.stats.purchases >= 1);
  const found = listData.documents.find(d => d.id === data.document.id);
  assert.ok(found);
  assert.equal(found.status, "PENDING_REVIEW");
  assert.equal(found.invoice_number, invNumber);
});

test("Bills & Docs 2: Ingest PNG image invoice and verify OCR scanned classification", async () => {
  // Construct minimal valid PNG buffer (8-byte PNG header + IHDR chunk)
  const pngHeader = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG Signature
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR header
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00,
    0x1f, 0x15, 0xc4, 0x89
  ]);
  const metaText = Buffer.from("INV-IMG-9912 Date: 2026-10-20 Amount: 12500 Tax: 2250 Total: 14750", "ascii");
  const fullPng = Buffer.concat([pngHeader, metaText]);

  const res = createMockRes();
  await handleFunctionalApi(getOrgAReq(), res, "/api/documents/upload", "POST", {}, {
    filename: "Scanned_Receipt.png",
    category: "expense_bill",
    content: `data:image/png;base64,${fullPng.toString("base64")}`
  });

  assert.equal(res.statusCode, 201);
  const data = JSON.parse(res.body);
  assert.equal(data.success, true);
  assert.ok(data.warnings.some(w => w.code === "SCANNED_INVOICE_WARNING" || w.code.includes("SCANNED")));
});

test("Bills & Docs 3: Multi-file batch upload (body.files)", async () => {
  const buf1 = createPdfBuffer(["TAX INVOICE 1", "Total: 1000"]);
  const buf2 = createPdfBuffer(["TAX INVOICE 2", "Total: 2000"]);

  const res = createMockRes();
  await handleFunctionalApi(getOrgAReq(), res, "/api/documents/upload", "POST", {}, {
    files: [
      { filename: "Batch_1.pdf", category: "purchase_bill", content: `data:application/pdf;base64,${buf1.toString("base64")}` },
      { filename: "Batch_2.pdf", category: "sales_invoice", content: `data:application/pdf;base64,${buf2.toString("base64")}` }
    ]
  });

  assert.equal(res.statusCode, 201);
  const data = JSON.parse(res.body);
  assert.equal(data.success, true);
  assert.equal(data.count, 2);
  assert.equal(data.uploaded.length, 2);
});

test("Bills & Docs 4: Enforce 15 MB file size limit with 400 rejection", async () => {
  const oversizedBuf = Buffer.alloc(16 * 1024 * 1024); // 16 MB

  const res = createMockRes();
  await handleFunctionalApi(getOrgAReq(), res, "/api/documents/upload", "POST", {}, {
    filename: "Huge_File.pdf",
    category: "purchase_bill",
    content: `data:application/pdf;base64,${oversizedBuf.toString("base64")}`
  });

  assert.equal(res.statusCode, 400);
  const data = JSON.parse(res.body);
  assert.ok(data.error.includes("exceeds maximum upload limit of 15MB"));
});

test("Bills & Docs 5: Reject unsupported file format with 400", async () => {
  const res = createMockRes();
  await handleFunctionalApi(getOrgAReq(), res, "/api/documents/upload", "POST", {}, {
    filename: "Malware.exe",
    category: "purchase_bill",
    content: "data:application/x-msdownload;base64,TVqQAAMAAAAEAAAA"
  });

  assert.equal(res.statusCode, 400);
  const data = JSON.parse(res.body);
  assert.ok(data.error.includes("Unsupported file format"));
});

test("Bills & Docs 6: Inline document preview and download endpoints", async () => {
  const pdfBuf = createPdfBuffer(["PREVIEW TEST INVOICE"]);
  const res = createMockRes();
  await handleFunctionalApi(getOrgAReq(), res, "/api/documents/upload", "POST", {}, {
    filename: "Preview_Test.pdf",
    category: "sales_invoice",
    content: `data:application/pdf;base64,${pdfBuf.toString("base64")}`
  });
  const data = JSON.parse(res.body);
  const docId = data.document.id;

  // Preview
  const prevRes = createMockRes();
  await handleFunctionalApi(getOrgAReq(), prevRes, `/api/documents/${docId}/preview`, "GET", {}, {});
  assert.equal(prevRes.statusCode, 200);
  assert.equal(prevRes.headers["content-type"], "application/pdf");
  assert.ok(prevRes.headers["content-disposition"].includes("inline"));

  // Download
  const dlRes = createMockRes();
  await handleFunctionalApi(getOrgAReq(), dlRes, `/api/documents/${docId}/download`, "GET", {}, {});
  assert.equal(dlRes.statusCode, 200);
  assert.ok(dlRes.headers["content-disposition"].includes("attachment"));
});

test("Bills & Docs 7: Save Draft and verify status becomes DRAFT without ledger pollution", async () => {
  const pdfBuf = createPdfBuffer(["INVOICE FOR DRAFT", "Invoice Number: DRAFT-100", "Total: 5000"]);
  const upRes = createMockRes();
  await handleFunctionalApi(getOrgAReq(), upRes, "/api/documents/upload", "POST", {}, {
    filename: "Draft_Doc.pdf",
    category: "purchase_bill",
    content: `data:application/pdf;base64,${pdfBuf.toString("base64")}`
  });
  const upData = JSON.parse(upRes.body);
  const docId = upData.document.id;

  // Save Draft
  const draftRes = createMockRes();
  await handleFunctionalApi(getOrgAReq(), draftRes, `/api/documents/${docId}/draft`, "POST", {}, {
    invoiceType: "purchase_bill",
    fields: {
      invoiceNumber: "DRAFT-100-EDITED",
      invoiceDate: "2026-10-25",
      taxableAmount: 4000,
      totalAmount: 4720
    }
  });

  assert.equal(draftRes.statusCode, 200);
  const draftData = JSON.parse(draftRes.body);
  assert.equal(draftData.success, true);

  // Check document status in listing
  const listRes = createMockRes();
  await handleFunctionalApi(getOrgAReq(), listRes, "/api/documents", "GET", {}, {});
  const listData = JSON.parse(listRes.body);
  const doc = listData.documents.find(d => d.id === docId);
  assert.ok(doc);
  assert.equal(doc.status, "DRAFT");
  assert.equal(doc.invoice_number, "DRAFT-100-EDITED");

  // Verify it did NOT pollute purchase register
  const purCheck = db.prepare("SELECT * FROM purchase_invoices WHERE invoice_number = 'DRAFT-100-EDITED'").get();
  assert.equal(purCheck, undefined);
});

test("Bills & Docs 8: Reject document and verify status becomes REJECTED with reason", async () => {
  const pdfBuf = createPdfBuffer(["REJECT INVOICE", "Total: 100"]);
  const upRes = createMockRes();
  await handleFunctionalApi(getOrgAReq(), upRes, "/api/documents/upload", "POST", {}, {
    filename: "Reject_Me.pdf",
    category: "purchase_bill",
    content: `data:application/pdf;base64,${pdfBuf.toString("base64")}`
  });
  const upData = JSON.parse(upRes.body);
  const docId = upData.document.id;

  const rejRes = createMockRes();
  await handleFunctionalApi(getOrgAReq(), rejRes, `/api/documents/${docId}/reject`, "POST", {}, {
    reason: "Vendor GSTIN cancelled u/s 29"
  });

  assert.equal(rejRes.statusCode, 200);
  const rejData = JSON.parse(rejRes.body);
  assert.equal(rejData.success, true);

  const listRes = createMockRes();
  await handleFunctionalApi(getOrgAReq(), listRes, "/api/documents", "GET", {}, {});
  const listData = JSON.parse(listRes.body);
  const doc = listData.documents.find(d => d.id === docId);
  assert.ok(doc);
  assert.equal(doc.status, "REJECTED");
});

test("Bills & Docs 9: Approve Sales Invoice, establish relational document_id link, and update register", async () => {
  const invNumber = `SALES-APP-${Date.now().toString().slice(-5)}`;
  const pdfBuf = createPdfBuffer([
    "TAX INVOICE",
    `Invoice: ${invNumber}`,
    "Date: 2026-10-15",
    "Customer: Global Exports Pvt Ltd",
    "Customer GSTIN: 27AABCG1234F1Z1",
    "Taxable: 75000",
    "CGST: 6750",
    "SGST: 6750",
    "Total: 88500"
  ]);

  const upRes = createMockRes();
  await handleFunctionalApi(getOrgAReq(), upRes, "/api/documents/upload", "POST", {}, {
    filename: `${invNumber}.pdf`,
    category: "sales_invoice",
    content: `data:application/pdf;base64,${pdfBuf.toString("base64")}`
  });
  const upData = JSON.parse(upRes.body);
  const docId = upData.document.id;

  // Approve Invoice
  const appRes = createMockRes();
  await handleFunctionalApi(getOrgAReq(), appRes, "/api/ocr/approve", "POST", {}, {
    documentId: docId,
    invoiceType: "sales_invoice",
    fields: {
      invoiceNumber: invNumber,
      invoiceDate: "2026-10-15",
      customerName: "Global Exports Pvt Ltd",
      customerGstin: "27AABCG1234F1Z1",
      partyName: "Global Exports Pvt Ltd",
      gstin: "27AABCG1234F1Z1",
      pos: "27",
      taxableValue: 75000,
      cgst: 6750,
      sgst: 6750,
      igst: 0,
      cess: 0,
      totalAmount: 88500
    }
  });

  assert.equal(appRes.statusCode, 200);
  const appData = JSON.parse(appRes.body);
  assert.equal(appData.success, true);
  assert.equal(appData.invoice.invoice_number, invNumber);
  assert.equal(appData.invoice.document_id, docId);

  // Verify in SQLite sales_invoices table that document_id is persisted
  const dbRecord = db.prepare("SELECT * FROM sales_invoices WHERE invoice_number = ?").get(invNumber);
  assert.ok(dbRecord);
  assert.equal(dbRecord.document_id, docId);

  // Check document status is now APPROVED
  const docCheck = documentRepo.findById(docId);
  assert.equal(docCheck.status, "APPROVED");

  // Re-extracting an approved invoice must be strictly blocked (400)
  const reExtRes = createMockRes();
  await handleFunctionalApi(getOrgAReq(), reExtRes, `/api/documents/${docId}/re-extract`, "POST", {}, {});
  assert.equal(reExtRes.statusCode, 400);

  // Deleting an approved invoice must be strictly blocked (400)
  const delRes = createMockRes();
  await handleFunctionalApi(getOrgAReq(), delRes, `/api/documents/${docId}`, "DELETE", {}, {});
  assert.equal(delRes.statusCode, 400);
});

test("Bills & Docs 10: Approve Purchase Bill, establish relational document_id link, and prevent duplicates", async () => {
  const invNumber = `PUR-APP-${Date.now().toString().slice(-5)}`;
  const pdfBuf = createPdfBuffer([
    "TAX INVOICE",
    `Invoice: ${invNumber}`,
    "Date: 2026-10-19",
    "Supplier: Delta Industrial Ltd",
    "Supplier GSTIN: 27AABCD9999F1Z2",
    "Taxable: 30000",
    "CGST: 2700",
    "SGST: 2700",
    "Total: 35400"
  ]);

  const upRes = createMockRes();
  await handleFunctionalApi(getOrgAReq(), upRes, "/api/documents/upload", "POST", {}, {
    filename: `${invNumber}.pdf`,
    category: "purchase_bill",
    content: `data:application/pdf;base64,${pdfBuf.toString("base64")}`
  });
  const upData = JSON.parse(upRes.body);
  const docId = upData.document.id;

  // Approve Purchase
  const appRes = createMockRes();
  await handleFunctionalApi(getOrgAReq(), appRes, "/api/ocr/approve", "POST", {}, {
    documentId: docId,
    invoiceType: "purchase_bill",
    fields: {
      invoiceNumber: invNumber,
      invoiceDate: "2026-10-19",
      supplierName: "Delta Industrial Ltd",
      supplierGstin: "27AABCD9999F1Z2",
      partyName: "Delta Industrial Ltd",
      gstin: "27AABCD9999F1Z2",
      pos: "27",
      taxableValue: 30000,
      cgst: 2700,
      sgst: 2700,
      igst: 0,
      cess: 0,
      totalAmount: 35400,
      itcEligibility: "ELIGIBLE"
    }
  });

  assert.equal(appRes.statusCode, 200);
  const appData = JSON.parse(appRes.body);
  assert.equal(appData.success, true);
  assert.equal(appData.invoice.invoice_number, invNumber);
  assert.equal(appData.invoice.document_id, docId);

  // Verify in purchase_invoices table
  const dbRecord = db.prepare("SELECT * FROM purchase_invoices WHERE invoice_number = ?").get(invNumber);
  assert.ok(dbRecord);
  assert.equal(dbRecord.document_id, docId);

  // Attempting to approve the exact duplicate invoice must fail with 400
  const dupRes = createMockRes();
  await handleFunctionalApi(getOrgAReq(), dupRes, "/api/ocr/approve", "POST", {}, {
    documentId: docId,
    invoiceType: "purchase_bill",
    fields: {
      invoiceNumber: invNumber,
      invoiceDate: "2026-10-19",
      supplierName: "Delta Industrial Ltd",
      supplierGstin: "27AABCD9999F1Z2",
      taxableValue: 30000,
      cgst: 2700,
      sgst: 2700,
      totalAmount: 35400
    }
  });
  assert.equal(dupRes.statusCode, 400);
  const dupData = JSON.parse(dupRes.body);
  assert.ok(dupData.error.includes("already exists"));
});

test("Bills & Docs 11: Multi-tenant cross-org access protection", async () => {
  // Upload document in Org A
  const pdfBuf = createPdfBuffer(["ORG A SECRET DOCUMENT"]);
  const upRes = createMockRes();
  await handleFunctionalApi(getOrgAReq(), upRes, "/api/documents/upload", "POST", {}, {
    filename: "OrgA_Secret.pdf",
    category: "sales_invoice",
    content: `data:application/pdf;base64,${pdfBuf.toString("base64")}`
  });
  const docId = JSON.parse(upRes.body).document.id;

  // Org B attempts to preview Org A document -> 404 / 403 Forbidden
  const crossPrevRes = createMockRes();
  await handleFunctionalApi(getOrgBReq(), crossPrevRes, `/api/documents/${docId}/preview`, "GET", {}, {});
  assert.ok([403, 404].includes(crossPrevRes.statusCode));

  // Org B attempts to download Org A document -> 404 / 403 Forbidden
  const crossDlRes = createMockRes();
  await handleFunctionalApi(getOrgBReq(), crossDlRes, `/api/documents/${docId}/download`, "GET", {}, {});
  assert.ok([403, 404].includes(crossDlRes.statusCode));

  // Org B attempts to draft Org A document -> 404 / 403 Forbidden
  const crossDraftRes = createMockRes();
  await handleFunctionalApi(getOrgBReq(), crossDraftRes, `/api/documents/${docId}/draft`, "POST", {}, {
    invoiceType: "sales_invoice",
    fields: { invoiceNumber: "HACK-01" }
  });
  assert.ok([403, 404].includes(crossDraftRes.statusCode));

  // Org B attempts to delete Org A document -> 404 / 403 Forbidden
  const crossDelRes = createMockRes();
  await handleFunctionalApi(getOrgBReq(), crossDelRes, `/api/documents/${docId}`, "DELETE", {}, {});
  assert.ok([403, 404].includes(crossDelRes.statusCode));
});

test("Bills & Docs 12: Multipart form-data upload with boundary and binary buffer extraction", async () => {
  const { parseMultipartBuffer } = await import("../lib/multipart.js");
  const pdfBuf = createPdfBuffer([
    "TAX INVOICE",
    "Invoice Number: MP-2026-999",
    "Date: 2026-10-24",
    "Seller GSTIN: 27AABCD1234F1Z5",
    "Buyer GSTIN: 27GHIJK5678L1Z9",
    "Taxable Value: 45000",
    "CGST: 4050",
    "SGST: 4050",
    "Total: 53100"
  ]);

  const boundary = "----WebKitFormBoundaryMultipartTest77";
  const crlf = "\r\n";
  const rawMultipart = Buffer.concat([
    Buffer.from(`--${boundary}${crlf}Content-Disposition: form-data; name="category"${crlf}${crlf}purchase_bill${crlf}`),
    Buffer.from(`--${boundary}${crlf}Content-Disposition: form-data; name="file"; filename="Multipart_Invoice.pdf"${crlf}Content-Type: application/pdf${crlf}${crlf}`),
    pdfBuf,
    Buffer.from(`${crlf}--${boundary}--${crlf}`)
  ]);

  const parsedBody = parseMultipartBuffer(rawMultipart, `multipart/form-data; boundary=${boundary}`);
  assert.strictEqual(parsedBody.category, "purchase_bill");
  assert.strictEqual(parsedBody.filename, "Multipart_Invoice.pdf");
  assert.ok(Buffer.isBuffer(parsedBody.fileBytes));

  const upRes = createMockRes();
  await handleFunctionalApi(getOrgAReq(), upRes, "/api/documents/upload", "POST", {}, parsedBody);

  assert.strictEqual(upRes.statusCode, 201);
  const upData = JSON.parse(upRes.body);
  assert.strictEqual(upData.success, true);
  assert.ok(upData.document.id);
  assert.strictEqual(upData.document.original_filename, "Multipart_Invoice.pdf");
  assert.strictEqual(upData.document.category, "purchase_bill");

  // Verify file written to disk
  assert.ok(fs.existsSync(upData.document.storage_path));
  const diskBytes = fs.readFileSync(upData.document.storage_path);
  assert.strictEqual(diskBytes.length, pdfBuf.length);
});
