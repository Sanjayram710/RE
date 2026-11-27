import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { handleRequest } from "../server.js";
import { handleFunctionalApi } from "../lib/functionalApi.js";
import { db, userRepo, sessionRepo } from "../lib/db.js";

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

async function callApi(pathname, method, { token, csrf, body = {}, query = {} } = {}) {
  const res = createMockRes();
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (csrf) headers["x-csrf-token"] = csrf;
  await handleFunctionalApi({ url: pathname, method, headers, body }, res, pathname, method, query, body);
  let parsed = {};
  try { parsed = res.body ? JSON.parse(res.body) : {}; } catch {}
  return { status: res.statusCode, body: parsed, headers: res.headers };
}

function makeAdminSession() {
  const sfx = crypto.randomBytes(4).toString("hex");
  const admin = userRepo.create({
    email: `adm-${sfx}@example.test`,
    passwordHash: userRepo.hashPassword("Admin@1234"),
    fullName: "Platform Admin",
    role: "OWNER"
  });
  const sess = sessionRepo.create({ userId: admin.id });
  return { admin, token: sess.token, csrf: sess.csrf_token };
}

function randMobile() {
  return "9" + String(Math.floor(100000000 + Math.random() * 899999999));
}

test("Partner 1: Registration validation, duplicate guards, pending access restriction & Admin approval", async () => {
  const sfx = crypto.randomBytes(4).toString("hex");
  const email = `prt1-${sfx}@example.test`;
  const mobile = randMobile();

  // Missing required fields -> 400
  const badRes = await callApi("/api/partner/register", "POST", { body: { fullName: "Only Name" } });
  assert.equal(badRes.status, 400);

  // Invalid GSTIN -> 400
  const badGst = await callApi("/api/partner/register", "POST", {
    body: {
      fullName: "Partner One", businessName: "One Tax LLP", email, mobile, password: "Password@123",
      businessType: "LLP", pan: "AAACB1234C", gstin: "INVALIDGST", address: "MG Road", state: "Maharashtra",
      district: "Mumbai", city: "Mumbai", pincode: "400001", category: "Tax Consultant"
    }
  });
  assert.equal(badGst.status, 400);

  // Valid registration -> 201 (SUBMITTED)
  const okReg = await callApi("/api/partner/register", "POST", {
    body: {
      fullName: "Partner One", businessName: "One Tax LLP", email, mobile, password: "Password@123",
      businessType: "LLP", pan: "AAACB1234C", address: "MG Road", state: "Maharashtra",
      district: "Mumbai", city: "Mumbai", pincode: "400001", category: "Tax Consultant"
    }
  });
  assert.equal(okReg.status, 201);
  assert.equal(okReg.body.partner.status, "SUBMITTED");

  // Duplicate email & duplicate mobile -> 409
  const dupEmail = await callApi("/api/partner/register", "POST", {
    body: {
      fullName: "Dup", businessName: "Dup Firm", email, mobile: randMobile(), password: "Password@123",
      businessType: "LLP", pan: "AAACB1234C", address: "Addr", state: "MH", district: "Mumbai", city: "Mumbai", pincode: "400001", category: "Other"
    }
  });
  assert.equal(dupEmail.status, 409);

  const dupMob = await callApi("/api/partner/register", "POST", {
    body: {
      fullName: "Dup", businessName: "Dup Firm", email: `other-${sfx}@example.test`, mobile, password: "Password@123",
      businessType: "LLP", pan: "AAACB1234C", address: "Addr", state: "MH", district: "Mumbai", city: "Mumbai", pincode: "400001", category: "Other"
    }
  });
  assert.equal(dupMob.status, 409);

  // Login as pending partner -> blocked (403) from overview & admin APIs
  const loginRes = await callApi("/api/auth/login", "POST", { body: { email, password: "Password@123" } });
  assert.equal(loginRes.status, 200);
  const pToken = loginRes.body.sessionToken;

  const pendingOv = await callApi("/api/partner/overview", "GET", { token: pToken });
  assert.equal(pendingOv.status, 403);

  const partnerCallsAdmin = await callApi("/api/admin/partners", "GET", { token: pToken });
  assert.equal(partnerCallsAdmin.status, 403);

  // Admin approves partner -> overview now 200
  const { token: aToken } = makeAdminSession();
  const appRes = await callApi(`/api/admin/partners/${okReg.body.partner.id}/status`, "POST", {
    token: aToken, body: { status: "APPROVED" }
  });
  assert.equal(appRes.status, 200);
  assert.equal(appRes.body.partner.status, "APPROVED");

  const okOv = await callApi("/api/partner/overview", "GET", { token: pToken });
  assert.equal(okOv.status, 200);
});

test("Partner 2: Territory conflict check, Customer consent & revocation, Leads, Commission & Security isolation", async () => {
  const sfx = crypto.randomBytes(4).toString("hex");
  const { token: aToken } = makeAdminSession();

  const regA = await callApi("/api/partner/register", "POST", {
    body: {
      fullName: "Partner A", businessName: "Alpha Tax", email: `pa-${sfx}@example.test`, mobile: randMobile(),
      password: "Password@123", businessType: "Firm", pan: "AAACA1234B", address: "Addr A", state: "Maharashtra",
      district: "Pune", city: "Pune", pincode: "411001", category: "Chartered Accountant"
    }
  });
  const regB = await callApi("/api/partner/register", "POST", {
    body: {
      fullName: "Partner B", businessName: "Beta Tax", email: `pb-${sfx}@example.test`, mobile: randMobile(),
      password: "Password@123", businessType: "Firm", pan: "AAACB1234D", address: "Addr B", state: "Maharashtra",
      district: "Pune", city: "Pune", pincode: "411002", category: "Tax Consultant"
    }
  });
  const pA = regA.body.partner.id;
  const pB = regB.body.partner.id;

  await callApi(`/api/admin/partners/${pA}/status`, "POST", { token: aToken, body: { status: "APPROVED" } });
  await callApi(`/api/admin/partners/${pB}/status`, "POST", { token: aToken, body: { status: "APPROVED" } });

  const tokA = (await callApi("/api/auth/login", "POST", { body: { email: `pa-${sfx}@example.test`, password: "Password@123" } })).body.sessionToken;
  const tokB = (await callApi("/api/auth/login", "POST", { body: { email: `pb-${sfx}@example.test`, password: "Password@123" } })).body.sessionToken;

  // Territory PIN conflict (409 unless allowOverlap)
  const testPin = String(400000 + Math.floor(Math.random() * 99999));
  const t1 = await callApi("/api/admin/partners/territories", "POST", {
    token: aToken, body: { partnerId: pA, state: "Maharashtra", district: "Pune", city: "Pune", pincodes: [testPin] }
  });
  assert.equal(t1.status, 201);
  const tConflict = await callApi("/api/admin/partners/territories", "POST", {
    token: aToken, body: { partnerId: pB, state: "Maharashtra", district: "Pune", city: "Pune", pincodes: [testPin] }
  });
  assert.equal(tConflict.status, 409);

  // Customer Onboarding + Consent Gate
  const custEmail = `cust-${sfx}@example.test`;
  const custMob = randMobile();
  const addCust = await callApi("/api/partner/customers", "POST", {
    token: tokA,
    body: {
      customerName: "Ramesh Shop", businessName: "Ramesh Retail", email: custEmail, mobile: custMob,
      businessType: "Proprietorship", pan: "AAACR1234E", state: "Maharashtra", district: "Pune", address: "FC Road", pincode: "411001"
    }
  });
  assert.equal(addCust.status, 201);
  const custId = addCust.body.customer.id;
  const custUserId = addCust.body.customer.customer_user_id;

  // Partner A cannot add GSTIN before customer consent (403)
  const uniqueGstin1 = `27AAACR${String(1000 + Math.floor(Math.random() * 8999))}E1Z5`;
  const uniqueGstin2 = `27AAACR${String(1000 + Math.floor(Math.random() * 8999))}E2Z4`;
  const preConsentGst = await callApi(`/api/partner/customers/${custId}/gstins`, "POST", {
    token: tokA, body: { gstin: uniqueGstin1 }
  });
  assert.equal(preConsentGst.status, 403);

  // Customer approves consent -> Partner A can add GSTIN; then Customer revokes -> 403 again
  const custSess = sessionRepo.create({ userId: custUserId });
  const appConsent = await callApi(`/api/customer/partner-consents/${custId}/respond`, "POST", {
    token: custSess.token, body: { action: "APPROVE" }
  });
  assert.equal(appConsent.status, 200);
  assert.equal(appConsent.body.customer.consent_granted, 1);

  const postConsentGst = await callApi(`/api/partner/customers/${custId}/gstins`, "POST", {
    token: tokA, body: { gstin: uniqueGstin1 }
  });
  assert.equal(postConsentGst.status, 201);

  // Partner B cannot access Partner A's customer list
  const bCusts = await callApi("/api/partner/customers", "GET", { token: tokB });
  assert.equal(bCusts.body.total, 0);

  await callApi(`/api/customer/partner-consents/${custId}/respond`, "POST", {
    token: custSess.token, body: { action: "REVOKE" }
  });
  const revokedGst = await callApi(`/api/partner/customers/${custId}/gstins`, "POST", {
    token: tokA, body: { gstin: uniqueGstin2 }
  });
  assert.equal(revokedGst.status, 403);

  // Lead assignment, Partner B isolation, conversion & duplicate conversion check
  const leadRes = await callApi("/api/admin/partners/leads", "POST", {
    token: aToken,
    body: {
      partnerId: pA, customerName: "Lead User", businessName: "Lead Traders",
      phone: randMobile(), email: `lead-${sfx}@example.test`, pincode: "411001"
    }
  });
  assert.equal(leadRes.status, 201);
  const leadId = leadRes.body.lead.id;

  const bReadLead = await callApi(`/api/partner/leads/${leadId}`, "GET", { token: tokB });
  assert.equal(bReadLead.status, 404);

  const conv1 = await callApi(`/api/partner/leads/${leadId}/convert`, "POST", {
    token: tokA, body: { pan: "AAACL1234F", subscriptionAmount: 1000 }
  });
  assert.equal(conv1.status, 200);
  assert.equal(conv1.body.lead.status, "CONVERTED");
  assert.equal(conv1.body.commission.commission_amount_paise, 20000); // 20% of ₹1000 = ₹200 (20000 paise)

  // Duplicate conversion -> 409
  const convDup = await callApi(`/api/partner/leads/${leadId}/convert`, "POST", { token: tokA, body: { pan: "AAACL1234F" } });
  assert.equal(convDup.status, 409);

  // Duplicate commission txn -> 409
  const dupComm = await callApi("/api/admin/partners/commissions", "POST", {
    token: aToken, body: { partnerId: pA, transactionRef: `CONV-${leadId}`, sourceType: "SUBSCRIPTION", transactionAmountPaise: 100000 }
  });
  assert.equal(dupComm.status, 409);

  // Payout exceeding balance -> 400; valid payout -> 201 -> Admin PAID -> 200
  const badPay = await callApi("/api/partner/payouts", "POST", {
    token: tokA, body: { amountPaise: 999999, bankAccountNumber: "1234567890", ifsc: "SBIN0001234" }
  });
  assert.equal(badPay.status, 400);

  const okPay = await callApi("/api/partner/payouts", "POST", {
    token: tokA, body: { amountPaise: 20000, bankAccountNumber: "1234567890", ifsc: "SBIN0001234" }
  });
  assert.equal(okPay.status, 201);

  const paid = await callApi(`/api/admin/partners/payouts/${okPay.body.payout.id}/process`, "POST", {
    token: aToken, body: { status: "PAID" }
  });
  assert.equal(paid.status, 200);
  assert.equal(paid.body.payout.status, "PAID");

  // Self-referral blocked (400)
  const selfRef = await callApi("/api/partner/referrals/track", "POST", {
    token: tokA, body: { referredEmail: `pa-${sfx}@example.test` }
  });
  assert.equal(selfRef.status, 400);

  // /partner route serves 200 with strict CSP
  const pageRes = createMockRes();
  await handleRequest({ url: "/partner", method: "GET", headers: { host: "localhost:3000" } }, pageRes);
  assert.equal(pageRes.statusCode, 200);
  assert.match(pageRes.headers["Content-Security-Policy"], /script-src 'self'/);
});
