import { test } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import {
  db,
  userRepo,
  orgRepo,
  gstinRepo,
  sessionRepo,
  salesRepo,
  purchaseRepo,
  returnRepo,
  ledgerRepo
} from "../lib/db.js";
import { handleFunctionalApi } from "../lib/functionalApi.js";

function createMockReqRes({ method = "GET", headers = {}, body = {}, query = {} }) {
  const req = {
    method,
    headers: { ...headers },
    body,
    query
  };

  let statusCode = 200;
  let responseHeaders = {};
  let responseData = null;

  const res = {
    writeHead(code, headersObj) {
      statusCode = code;
      if (headersObj) Object.assign(responseHeaders, headersObj);
    },
    setHeader(name, value) {
      responseHeaders[name.toLowerCase()] = value;
    },
    end(data) {
      if (data) {
        try {
          responseData = JSON.parse(data);
        } catch {
          responseData = data;
        }
      }
    }
  };

  return { req, res, getStatus: () => statusCode, getData: () => responseData, getHeaders: () => responseHeaders };
}

test("GSTR-3B Return Filing: Rejects invalid or missing EVC OTP", async () => {
  const testEmail = `filer.otp.test.${Date.now()}@example.com`;
  const user = userRepo.create({
    email: testEmail,
    passwordHash: userRepo.hashPassword("Password123@"),
    fullName: "Filing Test User"
  });
  const org = orgRepo.create({
    name: "Filing Test Org",
    pan: "ABCDE1234F"
  });
  orgRepo.addMember(org.id, user.id, "OWNER");
  const randomDigits1 = Math.floor(1000 + Math.random() * 9000);
  const gstin = gstinRepo.create({
    orgId: org.id,
    gstin: `27ABCDE${randomDigits1}F1Z5`,
    tradeName: "Filing Branch MH",
    stateCode: "27",
    stateName: "Maharashtra"
  });
  const session = sessionRepo.create({
    userId: user.id,
    activeOrgId: org.id,
    activeGstinId: gstin.id,
    activePeriod: "102026"
  });

  const { req, res, getStatus, getData } = createMockReqRes({
    method: "POST",
    headers: {
      authorization: `Bearer ${session.token}`,
      "content-type": "application/json"
    },
    body: {
      period: "102026",
      otp: "123" // Invalid length
    }
  });

  await handleFunctionalApi(req, res, "/api/returns/gstr3b/file", "POST", {}, req.body);
  assert.strictEqual(getStatus(), 400);
  assert.match(getData().error, /6-digit/);
});

test("GSTR-3B Return Filing: Files successfully with live calculated values and persists to database", async () => {
  const testEmail = `filer.live.test.${Date.now()}@example.com`;
  const user = userRepo.create({
    email: testEmail,
    passwordHash: userRepo.hashPassword("Password123@"),
    fullName: "Live Filing User"
  });
  const org = orgRepo.create({
    name: "Apex Precision Tools Ltd",
    pan: "AABCP9999K"
  });
  orgRepo.addMember(org.id, user.id, "OWNER");
  const randomDigits2 = Math.floor(1000 + Math.random() * 9000);
  const gstin = gstinRepo.create({
    orgId: org.id,
    gstin: `27AABCP${randomDigits2}K1Z2`,
    tradeName: "Apex Precision Tools",
    stateCode: "27",
    stateName: "Maharashtra"
  });
  const session = sessionRepo.create({
    userId: user.id,
    activeOrgId: org.id,
    activeGstinId: gstin.id,
    activePeriod: "102026"
  });

  // Create real sales invoice: Taxable 5000 @ 18% = 900 total tax (450 CGST + 450 SGST)
  salesRepo.create({
    orgId: org.id,
    gstinId: gstin.id,
    period: "102026",
    invoiceNumber: `INV-TEST-${Date.now()}`,
    invoiceDate: "2026-10-15",
    customerName: "Real Customer Corp",
    pos: "27 - Maharashtra",
    taxableAmount: 5000,
    gstRate: 18,
    cgst: 450,
    sgst: 450,
    igst: 0,
    totalTax: 900,
    totalAmount: 5900,
    supplyType: "B2B",
    status: "VALIDATED"
  });

  // Create real purchase bill: Taxable 2000 @ 18% = 360 total tax (180 CGST + 180 SGST)
  purchaseRepo.create({
    orgId: org.id,
    gstinId: gstin.id,
    period: "102026",
    invoiceNumber: `PUR-TEST-${Date.now()}`,
    invoiceDate: "2026-10-10",
    supplierName: "Real Supplier Corp",
    supplierGstin: "27AAACS1111A1Z9",
    pos: "27 - Maharashtra",
    taxableAmount: 2000,
    gstRate: 18,
    cgst: 180,
    sgst: 180,
    igst: 0,
    totalTax: 360,
    totalAmount: 2360,
    itcEligibility: "ELIGIBLE",
    paymentStatus: "UNPAID"
  });

  // 1. Check /api/dashboard/summary for real numbers
  const dashReqRes = createMockReqRes({
    method: "GET",
    headers: { authorization: `Bearer ${session.token}` },
    query: { period: "102026" }
  });
  await handleFunctionalApi(dashReqRes.req, dashReqRes.res, "/api/dashboard/summary", "GET", dashReqRes.req.query, {});
  const dashData = dashReqRes.getData();
  assert.strictEqual(dashReqRes.getStatus(), 200);
  assert.strictEqual(dashData.metrics.taxableSales, 5000);
  assert.strictEqual(dashData.metrics.totalOutputLiability, 900);
  assert.strictEqual(dashData.metrics.totalEligibleItc, 360);
  assert.strictEqual(dashData.metrics.netCashPayable, 540); // 900 - 360 = 540

  // 2. Submit GSTR-3B filing with OTP and payment confirmed
  const fileReqRes = createMockReqRes({
    method: "POST",
    headers: {
      authorization: `Bearer ${session.token}`,
      "content-type": "application/json"
    },
    body: {
      period: "102026",
      otp: "123456",
      paymentDone: true
    }
  });
  await handleFunctionalApi(fileReqRes.req, fileReqRes.res, "/api/returns/gstr3b/file", "POST", {}, fileReqRes.req.body);
  const fileData = fileReqRes.getData();
  assert.strictEqual(fileReqRes.getStatus(), 200);
  assert.strictEqual(fileData.success, true);
  assert.ok(fileData.arn.startsWith("SIM-AA27"));
  assert.strictEqual(fileData.liabilitySummary.taxableSales, 5000);
  assert.strictEqual(fileData.liabilitySummary.totalGrossLiability, 900);
  assert.strictEqual(fileData.itcSummary.totalEligibleItc, 360);
  assert.strictEqual(fileData.offsetMatrix.netCashPayable, 540);

  // 3. Verify return is permanently recorded in SQLite tax_returns table
  const saved = returnRepo.get(gstin.id, "GSTR3B", "102026");
  assert.ok(saved, "Return record must exist in SQLite database");
  assert.strictEqual(saved.arn, fileData.arn);
  assert.strictEqual(saved.status, "SIMULATED_NOT_TRANSMITTED");
});

test("Session & Data Persistence: User account, invoices, and profile persist across logins without data loss", async () => {
  const userEmail = `persistent.taxpayer.${Date.now()}@domain.com`;
  const userPassword = "StrongPassword@2026";

  // 1. User signs up via Step 1
  const step1ReqRes = createMockReqRes({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: {
      fullName: "Persistent Taxpayer",
      mobile: "9876543210",
      email: userEmail,
      password: userPassword,
      confirmPassword: userPassword
    }
  });
  await handleFunctionalApi(step1ReqRes.req, step1ReqRes.res, "/api/onboarding/step1", "POST", {}, step1ReqRes.req.body);
  assert.strictEqual(step1ReqRes.getStatus(), 201);
  const step1Data = step1ReqRes.getData();
  const token1 = step1Data.sessionToken;
  assert.ok(token1, "Step 1 must return valid sessionToken");

  // 2. Complete Step 2
  const randNum = Math.floor(1000 + Math.random() * 9000);
  const pan = `ABCDE${randNum}F`;
  const gstin = `27${pan}1Z5`;
  const step2ReqRes = createMockReqRes({
    method: "POST",
    headers: {
      authorization: `Bearer ${token1}`,
      "content-type": "application/json"
    },
    body: { pan, gstin, aadhaar: "123456789012" }
  });
  await handleFunctionalApi(step2ReqRes.req, step2ReqRes.res, "/api/onboarding/step2", "POST", {}, step2ReqRes.req.body);
  assert.strictEqual(step2ReqRes.getStatus(), 200);

  // 3. Complete Step 3
  const step3ReqRes = createMockReqRes({
    method: "POST",
    headers: {
      authorization: `Bearer ${token1}`,
      "content-type": "application/json"
    },
    body: {
      accountHolderName: "Persistent Taxpayer",
      accountNumber: "123456789012",
      confirmAccountNumber: "123456789012",
      ifsc: "HDFC0001234",
      bankName: "HDFC Bank",
      branchName: "Kothrud Pune"
    }
  });
  await handleFunctionalApi(step3ReqRes.req, step3ReqRes.res, "/api/onboarding/step3", "POST", {}, step3ReqRes.req.body);
  assert.strictEqual(step3ReqRes.getStatus(), 200);

  // 4. Complete Step 4
  const step4ReqRes = createMockReqRes({
    method: "POST",
    headers: {
      authorization: `Bearer ${token1}`,
      "content-type": "application/json"
    },
    body: {
      legalName: "Persistent Enterprises LLP",
      tradeName: "Persistent Goods",
      businessType: "Limited Liability Partnership (LLP)",
      businessCategory: "Retail",
      businessEmail: userEmail,
      businessMobile: "9876543210",
      businessAddress: "Plot 44, Industrial Estate, Pune",
      state: "Maharashtra",
      city: "Pune",
      pincode: "411038",
      businessActivity: "Manufacturing"
    }
  });
  await handleFunctionalApi(step4ReqRes.req, step4ReqRes.res, "/api/onboarding/step4", "POST", {}, step4ReqRes.req.body);
  assert.strictEqual(step4ReqRes.getStatus(), 200);
  assert.strictEqual(step4ReqRes.getData().onboardingStatus, "COMPLETED");

  // 5. Add a sales invoice for this user
  const addSaleRes = createMockReqRes({
    method: "POST",
    headers: {
      authorization: `Bearer ${token1}`,
      "content-type": "application/json"
    },
    body: {
      invoiceNumber: `INV-PERSIST-${Date.now()}`,
      invoiceDate: "2026-10-18",
      customerName: "Buyer Enterprises Ltd",
      pos: "27 - Maharashtra",
      taxableAmount: 12500,
      gstRate: 18,
      supplyType: "B2B"
    }
  });
  await handleFunctionalApi(addSaleRes.req, addSaleRes.res, "/api/sales", "POST", {}, addSaleRes.req.body);
  assert.strictEqual(addSaleRes.getStatus(), 201);

  // 6. User logs in anew with email & password (simulating session restore after browser close / restart)
  const loginReqRes = createMockReqRes({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: { email: userEmail, password: userPassword }
  });
  await handleFunctionalApi(loginReqRes.req, loginReqRes.res, "/api/auth/login", "POST", {}, loginReqRes.req.body);
  assert.strictEqual(loginReqRes.getStatus(), 200);
  const loginData = loginReqRes.getData();
  assert.strictEqual(loginData.success, true);
  assert.strictEqual(loginData.onboardingRequired, false, "Onboarding must remain COMPLETED");
  assert.ok(loginData.sessionToken, "Login must return fresh session token");
  const token2 = loginData.sessionToken;

  // 7. Verify that the user's previously added invoice is immediately loaded from SQLite
  const listSalesRes = createMockReqRes({
    method: "GET",
    headers: { authorization: `Bearer ${token2}` },
    query: { period: "102026" }
  });
  await handleFunctionalApi(listSalesRes.req, listSalesRes.res, "/api/sales", "GET", listSalesRes.req.query, {});
  assert.strictEqual(listSalesRes.getStatus(), 200);
  const salesList = listSalesRes.getData().invoices;
  assert.strictEqual(salesList.length, 1);
  assert.strictEqual(salesList[0].taxable_amount, 12500);

  // 8. Verify /api/auth/session returns full onboarding profile and organization
  const sessReqRes = createMockReqRes({
    method: "GET",
    headers: { authorization: `Bearer ${token2}` }
  });
  await handleFunctionalApi(sessReqRes.req, sessReqRes.res, "/api/auth/session", "GET", {}, {});
  assert.strictEqual(sessReqRes.getStatus(), 200);
  const sessionData = sessReqRes.getData();
  assert.strictEqual(sessionData.authenticated, true);
  assert.strictEqual(sessionData.user.email, userEmail.toLowerCase());
  assert.strictEqual(sessionData.onboardingProfile.business.legalName, "Persistent Enterprises LLP");
  assert.strictEqual(sessionData.onboardingProfile.bank.bankName, "HDFC Bank");
});
