import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Readable } from "node:stream";

import { handleFunctionalApi } from "../lib/functionalApi.js";
import { userRepo, orgRepo, gstinRepo, sessionRepo, db } from "../lib/db.js";
import { createInitialState } from "../public/v2/state.js";
import { renderFileView, renderInvoicesView } from "../public/v2/views.js";

function createMockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    writeHead(code, hdrs = {}) {
      this.statusCode = code;
      Object.assign(this.headers, hdrs);
    },
    setHeader(k, v) {
      this.headers[k] = v;
    },
    end(chunk = "") {
      this.body += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    }
  };
}

function makePdfBuffer(textLines) {
  const escaped = textLines
    .map((l, idx) => `BT /F1 12 Tf 40 ${740 - idx * 18} Td (${l.replace(/[()\\]/g, " ")}) Tj ET`)
    .join("\n");
  const stream = Buffer.from(escaped, "utf8");
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >> endobj\n",
    `4 0 obj << /Length ${stream.length} >> stream\n${stream.toString("utf8")}\nendstream endobj\n`
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += obj;
  }
  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "utf8");
}

function makeMultipartReq({ url, cookie, csrfToken, fileBuffer, filename, category }) {
  const boundary = "----SimpleGstTestBoundary" + crypto.randomBytes(6).toString("hex");
  const part1 = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="category"\r\n\r\n${category}\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/pdf\r\n\r\n`,
    "utf8"
  );
  const part2 = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  const fullBody = Buffer.concat([part1, fileBuffer, part2]);

  const req = Readable.from([fullBody]);
  req.url = url;
  req.method = "POST";
  req.headers = {
    cookie,
    "x-csrf-token": csrfToken,
    "content-type": `multipart/form-data; boundary=${boundary}`,
    "content-length": String(fullBody.length)
  };
  return req;
}

function setupPhase3Tenant() {
  const suffix = crypto.randomBytes(4).toString("hex");
  const org = orgRepo.create({ name: `Phase3 Retail ${suffix}`, pan: `P3PAN${suffix.slice(0, 4).toUpperCase()}Z` });
  const gstin = gstinRepo.create({
    orgId: org.id,
    gstin: `27P3TST${suffix.slice(0, 4).toUpperCase()}1Z5`,
    tradeName: `Phase3 Shop ${suffix}`,
    stateCode: "27",
    stateName: "Maharashtra"
  });
  const user = userRepo.create({
    orgId: org.id,
    email: `p3-${suffix}@example.com`,
    passwordHash: "unused",
    fullName: "Phase3 Owner",
    role: "OWNER"
  });
  const sess = sessionRepo.create({ userId: user.id, orgId: org.id, activeGstinId: gstin.id });
  const cookie = `simplegst_session=${sess.token}; simplegst_csrf=${sess.csrf_token}`;
  return { org, gstin, user, sess, cookie, csrfToken: sess.csrf_token };
}

test("Phase 3.1: Upload real sales & purchase PDFs, approve with integer-paise GST, verify dashboard, delete, and simulate filing", async () => {
  const { gstin, cookie, csrfToken } = setupPhase3Tenant();
  const period = "102026";

  const salesPdf = makePdfBuffer([
    "TAX INVOICE",
    "Invoice No: P3-SALE-101",
    "Date: 2026-10-12",
    "Customer: Bharat Traders",
    "GSTIN: 27AAACB1234C1Z9",
    "Taxable Value: 1000.55",
    "CGST 9%: 90.05",
    "SGST 9%: 90.05",
    "Total Amount: 1180.65"
  ]);

  const upSalesReq = makeMultipartReq({
    url: "/api/documents/upload",
    cookie,
    csrfToken,
    fileBuffer: salesPdf,
    filename: "p3-sale-101.pdf",
    category: "sales_invoice"
  });
  const upSalesRes = createMockRes();
  await handleFunctionalApi(
    upSalesReq,
    upSalesRes,
    "/api/documents/upload",
    "POST",
    {},
    {
      category: "sales_invoice",
      files: [{
        fieldName: "file",
        filename: "p3-sale-101.pdf",
        contentType: "application/pdf",
        data: salesPdf,
        size: salesPdf.length
      }]
    }
  );
  assert.equal(upSalesRes.statusCode, 201, `Sales upload failed: ${upSalesRes.body}`);
  const upSalesData = JSON.parse(upSalesRes.body);
  assert.ok(upSalesData.document?.id, "Document ID must be returned");
  assert.ok(upSalesData.extractedFields, "Extracted fields must be returned");

  const approveSalesBody = {
    documentId: upSalesData.document.id,
    invoiceType: "sales_invoice",
    fields: {
      invoiceNumber: "P3-SALE-101",
      invoiceDate: "2026-10-12",
      customerName: "Bharat Traders",
      customerGstin: "27AAACB1234C1Z9",
      pos: "27",
      taxableAmount: 1000.55,
      gstRate: 18,
      period
    }
  };
  const appSalesRes = createMockRes();
  await handleFunctionalApi(
    { url: "/api/ocr/approve", method: "POST", headers: { cookie, "x-csrf-token": csrfToken } },
    appSalesRes,
    "/api/ocr/approve",
    "POST",
    {},
    approveSalesBody
  );
  assert.equal(appSalesRes.statusCode, 200, `Sales approve failed: ${appSalesRes.body}`);
  const appSalesData = JSON.parse(appSalesRes.body);
  assert.equal(appSalesData.invoice.cgst, 90.05);
  assert.equal(appSalesData.invoice.sgst, 90.05);
  assert.equal(appSalesData.invoice.total_tax, 180.1);
  assert.equal(appSalesData.invoice.total_amount, 1180.65);

  const dupSalesRes = createMockRes();
  await handleFunctionalApi(
    { url: "/api/ocr/approve", method: "POST", headers: { cookie, "x-csrf-token": csrfToken } },
    dupSalesRes,
    "/api/ocr/approve",
    "POST",
    {},
    approveSalesBody
  );
  assert.equal(dupSalesRes.statusCode, 400, "Duplicate FY sales invoice must be rejected");

  const purPdf = makePdfBuffer([
    "SUPPLIER TAX INVOICE",
    "Bill No: P3-PUR-201",
    "Date: 2026-10-14",
    "Supplier: Mahalaxmi Wholesale",
    "GSTIN: 27AAACM9876D1Z1",
    "Taxable Value: 500.00",
    "Total Tax: 90.00",
    "Total Amount: 590.00"
  ]);
  const upPurReq = makeMultipartReq({
    url: "/api/documents/upload",
    cookie,
    csrfToken,
    fileBuffer: purPdf,
    filename: "p3-pur-201.pdf",
    category: "purchase_bill"
  });
  const upPurRes = createMockRes();
  await handleFunctionalApi(
    upPurReq,
    upPurRes,
    "/api/documents/upload",
    "POST",
    {},
    {
      category: "purchase_bill",
      files: [{
        fieldName: "file",
        filename: "p3-pur-201.pdf",
        contentType: "application/pdf",
        data: purPdf,
        size: purPdf.length
      }]
    }
  );
  assert.equal(upPurRes.statusCode, 201, `Purchase upload failed: ${upPurRes.body}`);
  const upPurData = JSON.parse(upPurRes.body);

  const appPurRes = createMockRes();
  await handleFunctionalApi(
    { url: "/api/ocr/approve", method: "POST", headers: { cookie, "x-csrf-token": csrfToken } },
    appPurRes,
    "/api/ocr/approve",
    "POST",
    {},
    {
      documentId: upPurData.document.id,
      invoiceType: "purchase_bill",
      fields: {
        invoiceNumber: "P3-PUR-201",
        invoiceDate: "2026-10-14",
        supplierName: "Mahalaxmi Wholesale",
        supplierGstin: "27AAACM9876D1Z1",
        pos: "27",
        taxableAmount: 500,
        gstRate: 18,
        itcEligibility: "ELIGIBLE",
        period
      }
    }
  );
  assert.equal(appPurRes.statusCode, 200, `Purchase approve failed: ${appPurRes.body}`);

  const dashRes = createMockRes();
  await handleFunctionalApi(
    { url: `/api/dashboard/summary?period=${period}`, method: "GET", headers: { cookie } },
    dashRes,
    "/api/dashboard/summary",
    "GET",
    { period },
    {}
  );
  assert.equal(dashRes.statusCode, 200);
  const dash = JSON.parse(dashRes.body);
  assert.equal(dash.metrics.paise.taxableSalesPaise, 100055);
  assert.equal(dash.metrics.paise.totalOutputLiabilityPaise, 18010);
  assert.equal(dash.metrics.paise.taxablePurchasesPaise, 50000);
  assert.equal(dash.metrics.paise.totalEligibleItcPaise, 9000);
  assert.equal(dash.metrics.paise.netCashPayablePaise, 9010);

  const delRes = createMockRes();
  await handleFunctionalApi(
    { url: `/api/sales/${appSalesData.invoice.id}`, method: "DELETE", headers: { cookie, "x-csrf-token": csrfToken } },
    delRes,
    `/api/sales/${appSalesData.invoice.id}`,
    "DELETE",
    {},
    {}
  );
  assert.equal(delRes.statusCode, 200);

  const fileRes = createMockRes();
  await handleFunctionalApi(
    { url: "/api/returns/gstr3b/file", method: "POST", headers: { cookie, "x-csrf-token": csrfToken } },
    fileRes,
    "/api/returns/gstr3b/file",
    "POST",
    {},
    { period, otp: "123456", paymentDone: true }
  );
  assert.equal(fileRes.statusCode, 200, `Simulation filing failed: ${fileRes.body}`);
  const fileData = JSON.parse(fileRes.body);
  assert.equal(fileData.simulationMode, true);
  assert.equal(fileData.displayStatus, "Filed (simulation)");
  assert.ok(String(fileData.arn || "").startsWith("SIM-"));

  const dupFileRes = createMockRes();
  await handleFunctionalApi(
    { url: "/api/returns/gstr3b/file", method: "POST", headers: { cookie, "x-csrf-token": csrfToken } },
    dupFileRes,
    "/api/returns/gstr3b/file",
    "POST",
    {},
    { period, otp: "123456", paymentDone: true }
  );
  assert.equal(dupFileRes.statusCode, 409, "Duplicate filing must return 409");

  db.prepare("DELETE FROM sales_invoices WHERE gstin_id = ?").run(gstin.id);
  db.prepare("DELETE FROM purchase_invoices WHERE gstin_id = ?").run(gstin.id);
  db.prepare("DELETE FROM documents WHERE gstin_id = ?").run(gstin.id);
});

test("Phase 3.2: Upload & OCR review UI requires confirmation on low confidence and renders Step 5 simulation receipt safely", () => {
  const s = createInitialState();
  s.authenticated = true;
  s.activeGstin = { gstin: "27P3TST12341Z5", state_code: "27" };
  s.loading.sales = "ready";
  s.ocrReview = {
    category: "sales_invoice",
    documentId: "doc-1",
    filename: "<script>bad.pdf</script>",
    confidenceScore: 0.55,
    isScanned: true,
    warnings: ["Could not detect party GSTIN"],
    confirmed: false,
    saving: false,
    error: "",
    fields: {
      invoiceNumber: "INV-99",
      invoiceDate: "2026-10-12",
      partyName: "Retail Buyer",
      gstin: "",
      pos: "27",
      taxableAmount: 2000,
      gstRate: 18
    }
  };
  s.invoiceTab = "sales";
  const html = renderInvoicesView(s);
  assert.ok(html.includes('id="ocr-confirm-check"'), "Low-confidence OCR must render confirmation checkbox");
  assert.ok(html.includes('disabled'), "Save button must start disabled until confirmed");
  assert.ok(!html.includes("<script>bad.pdf"), "Filename must be escaped");
  assert.ok(html.includes("CGST: <b>₹180"), "Live paise GST preview must show CGST ₹180");

  s.filingStep = 5;
  s.dashboard = { periodLabel: "October 2026", environment: { preparationOnly: false }, metrics: { paise: { netCashPayablePaise: 9010 } } };
  s.filingReceipt = { displayStatus: "Filed (simulation)", period: "102026", arn: "SIM-2026-9999" };
  const step5Html = renderFileView(s);
  assert.ok(step5Html.includes("Filed (simulation)"));
  assert.ok(step5Html.includes("SIM-2026-9999"));
});
