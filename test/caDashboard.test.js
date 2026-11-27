import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import * as XLSX from "xlsx";

import { handleRequest } from "../server.js";
import { handleFunctionalApi } from "../lib/functionalApi.js";
import { userRepo, sessionRepo, salesRepo } from "../lib/db.js";

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

async function callApi(pathname, method, { token, body = {}, query = {} } = {}) {
  const res = createMockRes();
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  await handleFunctionalApi({ url: pathname, method, headers, body }, res, pathname, method, query, body);
  let parsed = {};
  try { parsed = res.body ? JSON.parse(res.body) : {}; } catch {}
  return { status: res.statusCode, body: parsed, raw: res.body, headers: res.headers };
}

function makeAdminSession() {
  const sfx = crypto.randomBytes(4).toString("hex");
  const admin = userRepo.create({
    email: `caadm-${sfx}@example.test`,
    passwordHash: userRepo.hashPassword("Admin@1234"),
    fullName: "Platform Admin",
    role: "OWNER"
  });
  const sess = sessionRepo.create({ userId: admin.id });
  return { token: sess.token };
}

function randMobile() {
  return "9" + String(Math.floor(100000000 + Math.random() * 899999999));
}

test("CA 1: Registration validation, pending access block, Admin approval & /ca CSP", async () => {
  const sfx = crypto.randomBytes(4).toString("hex");
  const email = `ca1-${sfx}@example.test`;

  const badPan = await callApi("/api/ca/register", "POST", {
    body: {
      fullName: "CA One", firmName: "CA One & Co", email, mobile: randMobile(), password: "Password@123",
      category: "Chartered Accountant", pan: "BADPAN", officeAddress: "Fort", state: "Maharashtra", district: "Mumbai", pincode: "400001"
    }
  });
  assert.equal(badPan.status, 400);

  const okReg = await callApi("/api/ca/register", "POST", {
    body: {
      fullName: "CA One", firmName: "CA One & Co", email, mobile: randMobile(), password: "Password@123",
      category: "Chartered Accountant", membershipNumber: "123456", pan: "AAACA1234D",
      officeAddress: "Fort", state: "Maharashtra", district: "Mumbai", pincode: "400001"
    }
  });
  assert.equal(okReg.status, 201);
  assert.equal(okReg.body.profile.status, "SUBMITTED");

  const dupReg = await callApi("/api/ca/register", "POST", {
    body: {
      fullName: "CA Dup", firmName: "Dup & Co", email, mobile: randMobile(), password: "Password@123",
      category: "Chartered Accountant", pan: "AAACA1234D", officeAddress: "Fort", state: "Maharashtra", district: "Mumbai", pincode: "400001"
    }
  });
  assert.equal(dupReg.status, 409);

  const caTok = (await callApi("/api/auth/login", "POST", { body: { email, password: "Password@123" } })).body.sessionToken;
  assert.equal((await callApi("/api/ca/overview", "GET", { token: caTok })).status, 403);
  assert.equal((await callApi("/api/admin/cas", "GET", { token: caTok })).status, 403);

  const { token: admTok } = makeAdminSession();
  const appRes = await callApi(`/api/admin/cas/${okReg.body.profile.id}/status`, "POST", {
    token: admTok, body: { status: "APPROVED" }
  });
  assert.equal(appRes.status, 200);
  assert.equal((await callApi("/api/ca/overview", "GET", { token: caTok })).status, 200);

  const pageRes = createMockRes();
  await handleRequest({ url: "/ca", method: "GET", headers: { host: "localhost:3000" } }, pageRes);
  assert.equal(pageRes.statusCode, 200);
  assert.match(pageRes.headers["Content-Security-Policy"], /script-src 'self'/);
});

test("CA 2: Customer consent, Bulk CSV & XLSX import, Return Prep, Approval Gate, Staff RBAC & Billing", async () => {
  const sfx = crypto.randomBytes(4).toString("hex");
  const { token: admTok } = makeAdminSession();

  const regA = await callApi("/api/ca/register", "POST", {
    body: {
      fullName: "CA Alpha", firmName: "Alpha Associates", email: `ca-a-${sfx}@example.test`, mobile: randMobile(),
      password: "Password@123", category: "Chartered Accountant", pan: "AAACA1234E", officeAddress: "Pune", state: "Maharashtra", district: "Pune", pincode: "411001"
    }
  });
  const regB = await callApi("/api/ca/register", "POST", {
    body: {
      fullName: "CA Beta", firmName: "Beta Associates", email: `ca-b-${sfx}@example.test`, mobile: randMobile(),
      password: "Password@123", category: "GST Practitioner", pan: "AAACB1234F", officeAddress: "Pune", state: "Maharashtra", district: "Pune", pincode: "411002"
    }
  });
  await callApi(`/api/admin/cas/${regA.body.profile.id}/status`, "POST", { token: admTok, body: { status: "APPROVED" } });
  await callApi(`/api/admin/cas/${regB.body.profile.id}/status`, "POST", { token: admTok, body: { status: "APPROVED" } });

  const tokA = (await callApi("/api/auth/login", "POST", { body: { email: `ca-a-${sfx}@example.test`, password: "Password@123" } })).body.sessionToken;
  const tokB = (await callApi("/api/auth/login", "POST", { body: { email: `ca-b-${sfx}@example.test`, password: "Password@123" } })).body.sessionToken;

  // Bulk CSV import: 1 valid, 1 invalid PAN, 1 duplicate email
  const csvEmail = `bulkcsv-${sfx}@example.test`;
  const csvText = [
    "customerName,businessName,email,mobile,businessType,pan,gstin,state,district,address,pincode",
    `Valid User,Valid Mart,${csvEmail},${randMobile()},Proprietorship,AAACV1234G,,Maharashtra,Pune,MG Road,411001`,
    `Bad User,Bad Mart,bad-${sfx}@example.test,${randMobile()},Proprietorship,BADPAN,,Maharashtra,Pune,MG Road,411001`,
    `Dup User,Dup Mart,${csvEmail},${randMobile()},Proprietorship,AAACV1234G,,Maharashtra,Pune,MG Road,411001`
  ].join("\n");

  const prevCsv = await callApi("/api/ca/bulk-import/preview", "POST", {
    token: tokA,
    body: { files: [{ filename: "clients.csv", data: Buffer.from(csvText, "utf8") }] }
  });
  assert.equal(prevCsv.status, 201);
  assert.equal(prevCsv.body.job.valid_records, 1);
  assert.equal(prevCsv.body.job.invalid_records, 1);
  assert.equal(prevCsv.body.job.duplicate_records, 1);

  const confCsv = await callApi(`/api/ca/bulk-import/${prevCsv.body.job.id}/confirm`, "POST", { token: tokA });
  assert.equal(confCsv.status, 200);
  assert.equal(confCsv.body.imported, 1);

  // Bulk XLSX import
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet([{
    customerName: "Xlsx Owner", businessName: "Xlsx Retail", email: `xlsx-${sfx}@example.test`,
    mobile: randMobile(), businessType: "LLP", pan: "AAACX1234H", gstin: "", state: "Maharashtra",
    district: "Pune", address: "JM Road", pincode: "411004"
  }]);
  XLSX.utils.book_append_sheet(wb, ws, "Clients");
  const xlsxBuf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const prevXlsx = await callApi("/api/ca/bulk-import/preview", "POST", {
    token: tokA,
    body: { files: [{ filename: "clients.xlsx", data: xlsxBuf }] }
  });
  assert.equal(prevXlsx.status, 201);
  assert.equal(prevXlsx.body.job.valid_records, 1);
  const confXlsx = await callApi(`/api/ca/bulk-import/${prevXlsx.body.job.id}/confirm`, "POST", { token: tokA });
  assert.equal(confXlsx.body.imported, 1);

  // Add Customer + Consent Gate + Multi-GSTIN
  const custRes = await callApi("/api/ca/customers", "POST", {
    token: tokA,
    body: {
      customerName: "Sita Traders", businessName: "Sita Enterprises", email: `sita-${sfx}@example.test`,
      mobile: randMobile(), pan: "AAACS1234J", state: "Maharashtra", district: "Pune", address: "Camp", pincode: "411001"
    }
  });
  assert.equal(custRes.status, 201);
  const custId = custRes.body.customer.id;
  const custUserId = custRes.body.customer.customer_user_id;
  const custSess = sessionRepo.create({ userId: custUserId });

  const uniqGstin = `27AAACS${String(1000 + Math.floor(Math.random() * 8999))}J1Z5`;
  assert.equal((await callApi(`/api/ca/customers/${custId}/gstins`, "POST", { token: tokA, body: { gstin: uniqGstin } })).status, 403);

  await callApi(`/api/customer/ca-consents/${custId}/respond`, "POST", { token: custSess.token, body: { action: "APPROVE" } });
  const addGst = await callApi(`/api/ca/customers/${custId}/gstins`, "POST", { token: tokA, body: { gstin: uniqGstin } });
  assert.equal(addGst.status, 201);

  // CA B isolation
  assert.equal((await callApi(`/api/ca/customers/${custId}`, "GET", { token: tokB })).status, 404);

  // Prepare GSTR-3B & Filing Approval Workflow
  salesRepo.create({
    orgId: custRes.body.customer.org_id, gstinId: addGst.body.gstin.id, period: "112026",
    invoiceNumber: `CAINV-${sfx}`, invoiceDate: "2026-11-10", customerName: "Buyer", pos: "27",
    isInterstate: false, supplyType: "B2CS", taxableAmount: 1000, gstRate: 18, cgst: 90, sgst: 90, igst: 0, totalTax: 180, totalAmount: 1180
  });

  const prep = await callApi("/api/ca/returns/prepare", "POST", {
    token: tokA, body: { customerId: custId, gstinId: addGst.body.gstin.id, returnType: "GSTR3B", period: "112026" }
  });
  assert.equal(prep.status, 201);
  const appId = prep.body.approval.id;

  // Filing before customer approval -> 403
  assert.equal((await callApi(`/api/ca/approvals/${appId}/file`, "POST", { token: tokA })).status, 403);

  // Submit to customer -> customer approves -> filing hits GSP integration-pending 503 (never fake ARN)
  await callApi(`/api/ca/approvals/${appId}/submit`, "POST", { token: tokA });
  const custApp = await callApi(`/api/customer/ca-approvals/${appId}/respond`, "POST", {
    token: custSess.token, body: { action: "APPROVE" }
  });
  assert.equal(custApp.status, 200);
  assert.equal(custApp.body.approval.status, "APPROVED");

  const fileRes = await callApi(`/api/ca/approvals/${appId}/file`, "POST", { token: tokA });
  assert.equal(fileRes.status, 503);
  assert.equal(fileRes.body.integrationPending, true);

  // Staff least-privilege: staff cannot access unassigned customer or invite staff
  const stfEmail = `staff-${sfx}@example.test`;
  await callApi("/api/ca/team/invite", "POST", {
    token: tokA, body: { fullName: "Junior Staff", email: stfEmail, role: "Accountant", password: "Password@123" }
  });
  const stfTok = (await callApi("/api/auth/login", "POST", { body: { email: stfEmail, password: "Password@123" } })).body.sessionToken;
  assert.equal((await callApi(`/api/ca/customers/${custId}`, "GET", { token: stfTok })).status, 403);
  assert.equal((await callApi("/api/ca/team/invite", "POST", { token: stfTok, body: { fullName: "X", email: "x@x.in" } })).status, 403);

  // Service billing
  const billRes = await callApi("/api/ca/billing", "POST", {
    token: tokA, body: { customerId: custId, serviceDescription: "November GSTR-3B Prep", amount: 1000 }
  });
  assert.equal(billRes.status, 201);
  assert.equal(billRes.body.invoice.total_paise, 118000);

  // Revoke consent -> CA A loses access (403)
  await callApi(`/api/customer/ca-consents/${custId}/respond`, "POST", { token: custSess.token, body: { action: "REVOKE" } });
  assert.equal((await callApi(`/api/ca/customers/${custId}`, "GET", { token: tokA })).status, 403);
});
