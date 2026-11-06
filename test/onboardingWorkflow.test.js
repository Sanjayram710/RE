import { test } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import {
  initDatabase,
  userRepo,
  orgRepo,
  gstinRepo,
  sessionRepo,
  onboardingRepo,
  encryptSensitive,
  decryptSensitive
} from "../lib/db.js";
import { handleFunctionalApi } from "../lib/functionalApi.js";

initDatabase();

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

test("Onboarding Suite: Sensitive Data Encryption & Decryption", () => {
  const original = "123456789012";
  const encrypted = encryptSensitive(original);
  assert.ok(encrypted, "Encrypted string should be non-empty");
  assert.notStrictEqual(encrypted, original, "Encrypted string must not match plaintext");
  assert.ok(encrypted.includes(":"), "Encrypted string must contain IV, tag, and ciphertext");

  const decrypted = decryptSensitive(encrypted);
  assert.strictEqual(decrypted, original, "Decrypted text must match original plaintext");
});

test("Onboarding Suite: Step 1 - Account Registration & Validation", async () => {
  const testEmail = `test.user.${Date.now()}@example.com`;

  // 1. Validation: weak password
  {
    const { req, res, getStatus, getData } = createMockReqRes({
      method: "POST",
      body: {
        fullName: "Test User",
        mobile: "9876543210",
        email: testEmail,
        password: "weak",
        confirmPassword: "weak"
      }
    });
    await handleFunctionalApi(req, res, "/api/onboarding/step1", "POST", {}, req.body);
    assert.strictEqual(getStatus(), 400);
    assert.ok(getData().error.includes("Password must be at least 8 characters"));
  }

  // 2. Validation: password mismatch
  {
    const { req, res, getStatus, getData } = createMockReqRes({
      method: "POST",
      body: {
        fullName: "Test User",
        mobile: "9876543210",
        email: testEmail,
        password: "Valid@2026Password",
        confirmPassword: "Mismatched@2026Password"
      }
    });
    await handleFunctionalApi(req, res, "/api/onboarding/step1", "POST", {}, req.body);
    assert.strictEqual(getStatus(), 400);
    assert.ok(getData().error.includes("do not match"));
  }

  // 3. Success: valid Step 1 registration
  let sessionToken = null;
  let csrfToken = null;
  let userId = null;
  {
    const { req, res, getStatus, getData } = createMockReqRes({
      method: "POST",
      body: {
        fullName: "Ramesh Patel",
        mobile: "9876543210",
        email: testEmail,
        password: "Valid@2026Password!",
        confirmPassword: "Valid@2026Password!"
      }
    });
    await handleFunctionalApi(req, res, "/api/onboarding/step1", "POST", {}, req.body);
    assert.strictEqual(getStatus(), 201);
    const data = getData();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.nextStep, 2);
    assert.ok(data.sessionToken);
    assert.ok(data.csrfToken);
    sessionToken = data.sessionToken;
    csrfToken = data.csrfToken;
    userId = data.user.id;
  }

  // 4. Validation: duplicate email rejection
  {
    const { req, res, getStatus, getData } = createMockReqRes({
      method: "POST",
      body: {
        fullName: "Duplicate User",
        mobile: "9876543211",
        email: testEmail,
        password: "Valid@2026Password!",
        confirmPassword: "Valid@2026Password!"
      }
    });
    await handleFunctionalApi(req, res, "/api/onboarding/step1", "POST", {}, req.body);
    assert.strictEqual(getStatus(), 400);
    assert.ok(getData().error.includes("already exists"));
  }

  // 5. Progress check: should be at Step 2
  {
    const { req, res, getStatus, getData } = createMockReqRes({
      method: "GET",
      headers: { authorization: `Bearer ${sessionToken}` }
    });
    await handleFunctionalApi(req, res, "/api/onboarding/progress", "GET", {}, {});
    assert.strictEqual(getStatus(), 200);
    assert.strictEqual(getData().currentStep, 2);
    assert.strictEqual(getData().user.fullName, "Ramesh Patel");
  }

  // 6. Step 2 Validation: embedded PAN mismatch
  {
    const { req, res, getStatus, getData } = createMockReqRes({
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "x-csrf-token": csrfToken },
      body: {
        pan: "ABCDE1234F",
        gstin: "27ZZZZZ9999F1Z5"
      }
    });
    await handleFunctionalApi(req, res, "/api/onboarding/step2", "POST", {}, req.body);
    assert.strictEqual(getStatus(), 400);
    assert.ok(getData().error.includes("does not match"));
  }

  // 7. Step 2 Success: valid PAN, GSTIN, Aadhaar
  {
    const { req, res, getStatus, getData } = createMockReqRes({
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "x-csrf-token": csrfToken },
      body: {
        pan: "ABCDE1234F",
        gstin: "27ABCDE1234F1Z5",
        aadhaar: "9876 5432 1098"
      }
    });
    await handleFunctionalApi(req, res, "/api/onboarding/step2", "POST", {}, req.body);
    assert.strictEqual(getStatus(), 200);
    assert.strictEqual(getData().nextStep, 3);
    assert.strictEqual(getData().stateName, "Maharashtra");
  }

  // 8. Step 3 Validation: mismatched account number
  {
    const { req, res, getStatus, getData } = createMockReqRes({
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "x-csrf-token": csrfToken },
      body: {
        accountHolderName: "Patel Enterprises",
        accountNumber: "123456789012",
        confirmAccountNumber: "999999999999",
        ifsc: "SBIN0001234",
        bankName: "State Bank of India",
        branchName: "Nariman Point"
      }
    });
    await handleFunctionalApi(req, res, "/api/onboarding/step3", "POST", {}, req.body);
    assert.strictEqual(getStatus(), 400);
    assert.ok(getData().error.includes("do not match"));
  }

  // 9. Step 3 Success: valid banking details
  {
    const { req, res, getStatus, getData } = createMockReqRes({
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "x-csrf-token": csrfToken },
      body: {
        accountHolderName: "Patel Enterprises",
        accountNumber: "123456789012",
        confirmAccountNumber: "123456789012",
        ifsc: "SBIN0001234",
        bankName: "State Bank of India",
        branchName: "Nariman Point"
      }
    });
    await handleFunctionalApi(req, res, "/api/onboarding/step3", "POST", {}, req.body);
    assert.strictEqual(getStatus(), 200);
    assert.strictEqual(getData().nextStep, 4);
    assert.strictEqual(getData().bank.accountMasked, "••••••••9012");
  }

  // 10. Step 4 Validation: invalid business type
  {
    const { req, res, getStatus, getData } = createMockReqRes({
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "x-csrf-token": csrfToken },
      body: {
        legalName: "Patel Trading Pvt Ltd",
        tradeName: "Patel Mart",
        businessType: "INVALID_TYPE",
        businessCategory: "Retail",
        businessEmail: "patel@example.com",
        businessMobile: "9876543210",
        businessAddress: "101 MG Road, Fort, Mumbai",
        state: "Maharashtra",
        city: "Mumbai",
        pincode: "400001",
        businessActivity: "Retail Trading"
      }
    });
    await handleFunctionalApi(req, res, "/api/onboarding/step4", "POST", {}, req.body);
    assert.strictEqual(getStatus(), 400);
    assert.ok(getData().error.includes("business type"));
  }

  // 11. Step 4 Success: Complete Onboarding
  let createdOrgId = null;
  let createdGstinId = null;
  {
    const { req, res, getStatus, getData } = createMockReqRes({
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "x-csrf-token": csrfToken },
      body: {
        legalName: "Patel Trading Private Limited",
        tradeName: "Patel Mart",
        businessType: "Private Limited Company",
        businessCategory: "Retail",
        businessEmail: "patel@example.com",
        businessMobile: "9876543210",
        businessAddress: "101 MG Road, Fort, Mumbai",
        state: "Maharashtra",
        city: "Mumbai",
        pincode: "400001",
        businessActivity: "Retail Trading of Consumer Electronics"
      }
    });
    await handleFunctionalApi(req, res, "/api/onboarding/step4", "POST", {}, req.body);
    assert.strictEqual(getStatus(), 200);
    const data = getData();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.onboardingStatus, "COMPLETED");
    assert.ok(data.organization);
    assert.strictEqual(data.organization.name, "Patel Trading Private Limited");
    assert.strictEqual(data.organization.pan, "ABCDE1234F");
    assert.ok(data.activeGstin);
    assert.strictEqual(data.activeGstin.gstin, "27ABCDE1234F1Z5");
    createdOrgId = data.organization.id;
    createdGstinId = data.activeGstin.id;
  }

  // 12. Check SQLite persistence: Organization and GSTIN must exist in SQLite
  const savedOrg = orgRepo.findById(createdOrgId);
  assert.ok(savedOrg, "Organization must be persistently saved in SQLite");
  assert.strictEqual(savedOrg.name, "Patel Trading Private Limited");

  const savedGstin = gstinRepo.findById(createdGstinId);
  assert.ok(savedGstin, "GST Registration must be persistently saved in SQLite");
  assert.strictEqual(savedGstin.gstin, "27ABCDE1234F1Z5");

  // 13. Re-login test: completed user reaches dashboard directly
  {
    const { req, res, getStatus, getData } = createMockReqRes({
      method: "POST",
      body: {
        email: testEmail,
        password: "Valid@2026Password!"
      }
    });
    await handleFunctionalApi(req, res, "/api/auth/login", "POST", {}, req.body);
    assert.strictEqual(getStatus(), 200);
    const data = getData();
    assert.strictEqual(data.onboardingRequired, false);
    assert.strictEqual(data.user.onboardingStatus, "COMPLETED");
    assert.strictEqual(data.organization.name, "Patel Trading Private Limited");
  }
});

test("Onboarding Suite: Resuming Incomplete Onboarding on Login", async () => {
  const incompleteEmail = `incomplete.${Date.now()}@example.com`;

  // Register Step 1
  let token = null;
  {
    const { req, res, getStatus, getData } = createMockReqRes({
      method: "POST",
      body: {
        fullName: "Incomplete User",
        mobile: "9123456789",
        email: incompleteEmail,
        password: "Password@123!",
        confirmPassword: "Password@123!"
      }
    });
    await handleFunctionalApi(req, res, "/api/onboarding/step1", "POST", {}, req.body);
    assert.strictEqual(getStatus(), 201);
    token = getData().sessionToken;
  }

  // Re-login: must indicate onboardingRequired: true and currentStep: 2
  {
    const { req, res, getStatus, getData } = createMockReqRes({
      method: "POST",
      body: {
        email: incompleteEmail,
        password: "Password@123!"
      }
    });
    await handleFunctionalApi(req, res, "/api/auth/login", "POST", {}, req.body);
    assert.strictEqual(getStatus(), 200);
    const data = getData();
    assert.strictEqual(data.onboardingRequired, true);
    assert.strictEqual(data.onboardingStep, 2);
  }
});

test("Onboarding Suite: Mobile Number Parsing and Formatting Variations", async () => {
  const { req, res, getStatus, getData } = createMockReqRes({
    method: "POST",
    body: {
      fullName: "Sanjay Ram S",
      mobile: "9043286377",
      email: "sanjay." + Date.now() + "@example.com",
      password: "Lee071006@@",
      confirmPassword: "Lee071006@@"
    }
  });
  await handleFunctionalApi(req, res, "/api/onboarding/step1", "POST", {}, req.body);
  assert.strictEqual(getStatus(), 201);
  assert.strictEqual(getData().success, true);
  assert.strictEqual(getData().user.mobile, "9043286377");
});
