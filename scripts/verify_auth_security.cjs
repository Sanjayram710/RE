/**
 * SimpleGST Security & Authentication Lifecycle End-to-End Verification
 */

const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 3942;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function makeRequest(urlPath, method = 'GET', body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE_URL);
    const reqHeaders = { ...headers };
    let reqBody = null;

    if (body) {
      if (typeof body === 'object') {
        reqBody = JSON.stringify(body);
        if (!reqHeaders['Content-Type']) reqHeaders['Content-Type'] = 'application/json';
      } else {
        reqBody = body;
      }
      reqHeaders['Content-Length'] = Buffer.byteLength(reqBody);
    }

    const req = http.request(url, {
      method,
      headers: reqHeaders
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (_) {}
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: data,
          json
        });
      });
    });

    req.on('error', reject);
    if (reqBody) req.write(reqBody);
    req.end();
  });
}

async function runSecurityAudit() {
  console.log("===============================================================================");
  console.log("SimpleGST Security & Auth Lifecycle Verification");
  console.log("===============================================================================");

  // 1. Static Frontend Audit: Verify zero hardcoded demo credentials in frontend assets
  console.log("\n[Test 1] Verifying frontend assets contain zero hardcoded demo credentials...");
  const appJs = fs.readFileSync('app.js', 'utf8');
  const indexHtml = fs.readFileSync('index.html', 'utf8');

  // Must not have ApexAdmin@2026 or auto-login in app.js
  assert.ok(!appJs.includes("ApexAdmin@2026"), "app.js must not contain hardcoded password 'ApexAdmin@2026'");
  assert.ok(!appJs.includes("email: \"rajesh.sharma@apexretail.com\""), "app.js must not contain hardcoded login email for Rajesh Sharma");
  assert.ok(!indexHtml.includes("ApexAdmin@2026"), "index.html must not contain password 'ApexAdmin@2026'");
  assert.ok(!indexHtml.includes("value=\"demo1234\""), "index.html must not contain default password values");
  assert.ok(!indexHtml.includes("Good morning, Rajesh"), "index.html must not contain hardcoded 'Good morning, Rajesh'");
  console.log("✔ Static frontend audit: Zero hardcoded demo credentials or auto-login found!");

  // Start server on isolated port
  console.log(`\n[Server] Starting SimpleGST server on port ${PORT}...`);
  const serverModule = await import('../server.js');
  const createServer = serverModule.default.createServer;
  const server = createServer();

  await new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(PORT, '127.0.0.1', () => {
      console.log(`✔ Server online at ${BASE_URL}`);
      resolve();
    });
  });

  try {

    // 2. Test Initial Unauthenticated Session State
    console.log("\n[Test 2] Testing unauthenticated session on page load (GET /api/auth/session)...");
    const sessionRes = await makeRequest('/api/auth/session');
    assert.strictEqual(sessionRes.status, 200);
    assert.strictEqual(sessionRes.json.authenticated, false, "Session must be unauthenticated on initial visit");
    assert.strictEqual(sessionRes.json.user, null, "User must be null when unauthenticated");
    console.log("✔ Initial state: Correctly unauthenticated with null user.");

    // 3. Test Protected Endpoints Reject Unauthenticated Access
    console.log("\n[Test 3] Testing protected endpoints reject unauthenticated access...");
    const salesRes = await makeRequest('/api/sales');
    assert.strictEqual(salesRes.status, 401, "Sales invoices endpoint must reject unauthenticated request with 401");
    const purchaseRes = await makeRequest('/api/purchases');
    assert.strictEqual(purchaseRes.status, 401, "Purchase invoices endpoint must reject unauthenticated request with 401");
    const dashRes = await makeRequest('/api/dashboard/summary?period=102026');
    assert.strictEqual(dashRes.status, 401, "Dashboard summary endpoint must reject unauthenticated request with 401");
    console.log("✔ Access control: Protected endpoints return 401 Unauthorized when unauthenticated.");

    // 4. Test Invalid Credentials
    console.log("\n[Test 4] Testing login with invalid credentials...");
    const invalidLogin = await makeRequest('/api/auth/login', 'POST', {
      email: "rajesh.sharma@apexretail.com",
      password: "WrongPassword!2026"
    });
    assert.strictEqual(invalidLogin.status, 401, "Invalid password must return 401");
    assert.strictEqual(invalidLogin.json.error, "Invalid email or password");
    console.log("✔ Authentication rejection: Invalid password rejected with 401.");

    // 5. Test Valid Explicit Sign In
    console.log("\n[Test 5] Testing explicit sign in with valid user credentials...");
    const validLogin = await makeRequest('/api/auth/login', 'POST', {
      email: "rajesh.sharma@apexretail.com",
      password: "ApexAdmin@2026"
    });
    assert.strictEqual(validLogin.status, 200, "Valid credentials must return 200");
    assert.ok(validLogin.json.success, "Login must succeed");
    assert.ok(validLogin.json.sessionToken, "Must return session token");
    assert.ok(validLogin.json.csrfToken, "Must return CSRF token");
    assert.strictEqual(validLogin.json.user.name, "Rajesh Sharma");
    assert.strictEqual(validLogin.json.organization.name, "Apex Retailers Pvt Ltd");
    assert.strictEqual(validLogin.json.activeGstin.gstin, "27AAACA1234A1Z5");

    // Extract cookies
    const cookieHeaders = validLogin.headers['set-cookie'];
    assert.ok(cookieHeaders && cookieHeaders.length >= 2, "Must set session and CSRF cookies");
    const cookies = cookieHeaders.map(c => c.split(';')[0]).join('; ');
    const csrfToken = validLogin.json.csrfToken;
    const sessionToken = validLogin.json.sessionToken;
    console.log("✔ Explicit sign in successful. Session cookies & CSRF token received.");

    // 6. Test Authenticated Session Restoration
    console.log("\n[Test 6] Restoring authenticated session via cookie (GET /api/auth/session)...");
    const authSessionRes = await makeRequest('/api/auth/session', 'GET', null, {
      'Cookie': cookies
    });
    assert.strictEqual(authSessionRes.status, 200);
    assert.strictEqual(authSessionRes.json.authenticated, true);
    assert.strictEqual(authSessionRes.json.user.name, "Rajesh Sharma");
    assert.strictEqual(authSessionRes.json.organization.name, "Apex Retailers Pvt Ltd");
    assert.strictEqual(authSessionRes.json.activeGstin.gstin, "27AAACA1234A1Z5");
    console.log("✔ Session restored: Real tenant organization, GSTIN, and user context populated.");

    // 7. Test Protected Endpoints with Authenticated Session & CSRF
    console.log("\n[Test 7] Accessing protected endpoints with authenticated session...");
    const authSales = await makeRequest('/api/sales', 'GET', null, { 'Cookie': cookies });
    assert.strictEqual(authSales.status, 200, "Authenticated sales request must succeed with 200");
    assert.ok(Array.isArray(authSales.json.invoices), "Must return invoice array");

    // Create Sales Invoice with CSRF Token
    const testSalesNumber = `SEC-SALE-${Date.now().toString().slice(-5)}`;
    const createSaleRes = await makeRequest('/api/sales', 'POST', {
      invoiceNumber: testSalesNumber,
      invoiceDate: "2026-10-18",
      customerName: "Tata Consultancy Services",
      customerGstin: "27AAACT2727Q1ZW",
      pos: "27",
      isInterstate: false,
      supplyType: "B2B",
      taxableAmount: 120000,
      gstRate: 18,
      cgst: 10800,
      sgst: 10800,
      igst: 0,
      totalTax: 21600,
      totalAmount: 141600
    }, {
      'Cookie': cookies,
      'X-CSRF-Token': csrfToken
    });
    assert.ok(createSaleRes.status === 200 || createSaleRes.status === 201, "Sale invoice creation must succeed");
    assert.ok(createSaleRes.json.success, "Invoice created successfully in DB");
    console.log(`✔ Authenticated Sales Invoice creation verified: ${testSalesNumber}`);

    // Create Purchase Bill with CSRF Token
    const testBillNumber = `SEC-PUR-${Date.now().toString().slice(-5)}`;
    const createPurchaseRes = await makeRequest('/api/purchases', 'POST', {
      invoiceNumber: testBillNumber,
      invoiceDate: "2026-10-20",
      supplierName: "Office Depot India",
      supplierGstin: "27AAACD9988H1Z4",
      pos: "27",
      taxableAmount: 50000,
      gstRate: 18,
      itcEligibility: "ELIGIBLE"
    }, {
      'Cookie': cookies,
      'X-CSRF-Token': csrfToken
    });
    if (!createPurchaseRes.json || !createPurchaseRes.json.success) {
      console.error("Purchase creation error:", createPurchaseRes.status, createPurchaseRes.body);
    }
    assert.ok(createPurchaseRes.status === 200 || createPurchaseRes.status === 201, "Purchase bill creation must succeed");
    assert.ok(createPurchaseRes.json.success, "Bill created successfully in DB");
    console.log(`✔ Authenticated Purchase Bill creation verified: ${testBillNumber}`);

    // Upload Document in Bills & Docs with Authenticated Session
    const boundary = "----WebKitFormBoundary" + Math.random().toString(36).substring(2);
    const pdfContent = "%PDF-1.4\n1 0 obj\n<< /Title (SimpleGST Sec Audit) >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF";
    const postData = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="file"; filename="Audit_Invoice_${Date.now().toString().slice(-4)}.pdf"`,
      `Content-Type: application/pdf`,
      '',
      pdfContent,
      `--${boundary}--`
    ].join('\r\n');

    const uploadRes = await makeRequest('/api/documents/upload', 'POST', Buffer.from(postData), {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Cookie': cookies,
      'X-CSRF-Token': csrfToken
    });
    assert.ok(uploadRes.status === 200 || uploadRes.status === 201, "Authenticated document upload must succeed");
    assert.ok(uploadRes.json.success, "Document uploaded and indexed in SQLite");
    console.log(`✔ Authenticated Bills & Docs upload verified: ${uploadRes.json.document.original_filename}`);

    // 8. Test Logout Action
    console.log("\n[Test 8] Testing logout (POST /api/auth/logout)...");
    const logoutRes = await makeRequest('/api/auth/logout', 'POST', {}, {
      'Cookie': cookies,
      'X-CSRF-Token': csrfToken
    });
    assert.strictEqual(logoutRes.status, 200, "Logout must return 200");
    assert.ok(logoutRes.json.success, "Logout must succeed");

    // Cookies must be cleared
    const clearCookies = logoutRes.headers['set-cookie'];
    assert.ok(clearCookies && clearCookies.some(c => c.includes('1970') || c.includes('Max-Age=0')), "Logout must clear session cookies");
    console.log("✔ Logout succeeded: Server revoked session and issued clearing cookies.");

    // 9. Test Invalidation: Revoked Session Cookie is Rejected
    console.log("\n[Test 9] Verifying revoked session cannot access protected endpoints...");
    const postLogoutSession = await makeRequest('/api/auth/session', 'GET', null, {
      'Cookie': cookies
    });
    assert.strictEqual(postLogoutSession.status, 200);
    assert.strictEqual(postLogoutSession.json.authenticated, false, "Revoked session must be unauthenticated");

    const postLogoutProtected = await makeRequest('/api/sales', 'GET', null, {
      'Cookie': cookies
    });
    assert.strictEqual(postLogoutProtected.status, 401, "Revoked session must be rejected with 401");
    console.log("✔ Session invalidation verified: Revoked session receives 401 Unauthorized.");

    console.log("\n===============================================================================");
    console.log("ALL AUTHENTICATION SECURITY AUDIT TESTS PASSED (9/9) ✓");
    console.log("===============================================================================");

  } finally {
    server.close();
  }
}

runSecurityAudit().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error("SECURITY AUDIT FAILED:", err);
  process.exit(1);
});
