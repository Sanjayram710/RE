import { test } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import {
  initDatabase,
  startupRepo,
  orgRepo,
  userRepo,
  sessionRepo
} from "../lib/db.js";
import { handleFunctionalApi } from "../lib/functionalApi.js";

initDatabase();

function createMockReqRes({ method = "GET", headers = {}, body = {}, query = {} } = {}) {
  const req = {
    method,
    headers: { ...headers },
    body,
    query
  };

  let statusCode = 200;
  let responseHeaders = {};
  let responseData = null;

  const res = new EventEmitter();
  res.writeHead = function(code, headersObj) {
    statusCode = code;
    if (headersObj) Object.assign(responseHeaders, headersObj);
  };
  res.setHeader = function(name, value) {
    responseHeaders[name.toLowerCase()] = value;
  };
  res.write = function(chunk) {
    return true;
  };
  res.end = function(data) {
    if (data) {
      try {
        responseData = JSON.parse(data);
      } catch {
        responseData = data;
      }
    }
    this.emit("finish");
  };

  return { req, res, getStatus: () => statusCode, getData: () => responseData, getHeaders: () => responseHeaders };
}

test("Startup Express: Dynamic Progress Calculation", () => {
  assert.strictEqual(startupRepo.calculateProgress([]), 0);
  assert.strictEqual(startupRepo.calculateProgress([1]), 14);
  assert.strictEqual(startupRepo.calculateProgress([1, 2]), 29);
  assert.strictEqual(startupRepo.calculateProgress([1, 2, 3]), 43);
  assert.strictEqual(startupRepo.calculateProgress([1, 2, 3, 4]), 57);
  assert.strictEqual(startupRepo.calculateProgress([1, 2, 3, 4, 5]), 71);
  assert.strictEqual(startupRepo.calculateProgress([1, 2, 3, 4, 5, 6]), 86);
  assert.strictEqual(startupRepo.calculateProgress([1, 2, 3, 4, 5, 6, 7]), 100);
});

test("Startup Express: Database Persistence & Tenant Isolation", () => {
  const o1 = orgRepo.create({ name: "Sanjay Retail Org", pan: "ABCDE1234F" });
  const o2 = orgRepo.create({ name: "Competitor Org", pan: "XYZAB5678G" });
  const u1 = userRepo.create({
    email: `founder.${Date.now()}@example.com`,
    passwordHash: "secret123",
    fullName: "Sanjay Founder"
  });

  const org1 = o1.id;
  const org2 = o2.id;
  const user1 = u1.id;

  // Upsert profile for org 1
  const p1 = startupRepo.upsert({
    org_id: org1,
    user_id: user1,
    business_structure: "PROPRIETORSHIP",
    proposed_business_name: "Sanjay Retail Stores",
    business_activity: "Trade (Retail / Wholesale)",
    business_state: "Maharashtra"
  });

  assert.ok(p1, "Should create profile for org 1");
  assert.strictEqual(p1.org_id, org1);
  assert.strictEqual(p1.business_structure, "PROPRIETORSHIP");
  assert.strictEqual(p1.proposed_business_name, "Sanjay Retail Stores");

  // Verify org 2 cannot see org 1's profile
  const p2 = startupRepo.findByOrg(org2);
  assert.strictEqual(p2, null, "Org 2 should have no profile initially");

  // Save stage 1 for org 1
  const savedStage1 = startupRepo.saveStage(org1, 1, {
    proposed_business_name: "Sanjay Supermart",
    business_structure: "PROPRIETORSHIP",
    business_state: "Karnataka"
  });
  assert.strictEqual(savedStage1.proposed_business_name, "Sanjay Supermart");
  assert.strictEqual(savedStage1.business_state, "Karnataka");
  assert.ok(savedStage1.completed_stages.includes(1));
  assert.strictEqual(savedStage1.overall_progress, 14);

  // Update checklist for org 1
  const updatedChecklist = startupRepo.updateChecklist(org1, "doc_identity", true);
  assert.strictEqual(updatedChecklist.checklist.doc_identity, true);

  // Reset profile for org 1
  const resetProfile = startupRepo.reset(org1, user1);
  assert.strictEqual(resetProfile.overall_progress, 0);
  assert.deepStrictEqual(resetProfile.completed_stages, []);
  assert.strictEqual(resetProfile.current_stage, 1);
});

test("Startup Express: Stage Validation & Masking via Functional API", async () => {
  const testEmail = `startup.${Date.now()}@example.com`;
  const user = userRepo.create({
    email: testEmail,
    passwordHash: "mock_hash_secret_123",
    fullName: "Startup Founder",
    role: "OWNER"
  });
  const org = orgRepo.create({
    name: "Express Enterprise",
    pan: "ABCDE1234F"
  });
  orgRepo.addMember(org.id, user.id, "OWNER");

  const sessionToken = crypto.randomBytes(32).toString("hex");
  const csrfToken = crypto.randomBytes(24).toString("hex");
  sessionRepo.create({
    userId: user.id,
    token: sessionToken,
    csrfToken: csrfToken,
    activeOrgId: org.id
  });

  const authHeaders = {
    authorization: `Bearer ${sessionToken}`
  };

  // 1. GET Profile (Initial)
  {
    const { req, res, getStatus, getData } = createMockReqRes({
      method: "GET",
      headers: authHeaders
    });
    await handleFunctionalApi(req, res, "/api/startup-express/profile", "GET", {}, {});
    assert.strictEqual(getStatus(), 200);
    assert.ok(getData().success);
    assert.strictEqual(getData().profile.org_id, org.id);
  }

  // 2. Stage 1: Validation - missing business name
  {
    const { req, res, getStatus, getData } = createMockReqRes({
      method: "POST",
      headers: authHeaders,
      body: {
        stage: 1,
        proposed_business_name: "",
        business_state: "Maharashtra"
      }
    });
    await handleFunctionalApi(req, res, "/api/startup-express/save-stage", "POST", {}, req.body);
    assert.strictEqual(getStatus(), 400);
    assert.ok(getData().error.includes("Proposed business name is required"));
  }

  // 3. Stage 1: Success
  {
    const { req, res, getStatus, getData } = createMockReqRes({
      method: "POST",
      headers: authHeaders,
      body: {
        stage: 1,
        proposed_business_name: "Apex Global Supplies",
        business_structure: "LLP",
        business_activity: "Services / Consulting",
        business_state: "Maharashtra",
        business_pincode: "400001",
        business_address: "101 Business Hub, BKC"
      }
    });
    await handleFunctionalApi(req, res, "/api/startup-express/save-stage", "POST", {}, req.body);
    assert.strictEqual(getStatus(), 200);
    assert.strictEqual(getData().profile.proposed_business_name, "Apex Global Supplies");
    assert.strictEqual(getData().profile.business_structure, "LLP");
    assert.ok(getData().profile.completed_stages.includes(1));
  }

  // 4. Stage 2: Validation - invalid PAN format
  {
    const { req, res, getStatus, getData } = createMockReqRes({
      method: "POST",
      headers: authHeaders,
      body: {
        stage: 2,
        founder_name: "Sanjay Ram",
        founder_pan: "INVALID123"
      }
    });
    await handleFunctionalApi(req, res, "/api/startup-express/save-stage", "POST", {}, req.body);
    assert.strictEqual(getStatus(), 400);
    assert.ok(getData().error.includes("Invalid founder PAN format"));
  }

  // 5. Stage 2: Success with valid PAN
  {
    const { req, res, getStatus, getData } = createMockReqRes({
      method: "POST",
      headers: authHeaders,
      body: {
        stage: 2,
        founder_name: "Sanjay Ram",
        founder_pan: "ABCDE1234F",
        entity_pan: "AAACL1234F"
      }
    });
    await handleFunctionalApi(req, res, "/api/startup-express/save-stage", "POST", {}, req.body);
    assert.strictEqual(getStatus(), 200);
    assert.strictEqual(getData().profile.founder_pan, "ABCDE1234F");
    assert.strictEqual(getData().profile.entity_pan, "AAACL1234F");
    assert.ok(getData().profile.completed_stages.includes(2));
  }

  // 5b. Stage 3: Business Registration Reference & Status
  {
    const { req, res, getStatus, getData } = createMockReqRes({
      method: "POST",
      headers: authHeaders,
      body: {
        stage: 3,
        registration_reference_number: "UDYAM-MH-01-0098765",
        registration_status: "APPROVED"
      }
    });
    await handleFunctionalApi(req, res, "/api/startup-express/save-stage", "POST", {}, req.body);
    assert.strictEqual(getStatus(), 200);
    assert.strictEqual(getData().profile.registration_reference_number, "UDYAM-MH-01-0098765");
    assert.strictEqual(getData().profile.registration_status, "APPROVED");
    assert.ok(getData().profile.completed_stages.includes(3));
  }

  // 6. Stage 4: Validation - invalid GSTIN
  {
    const { req, res, getStatus, getData } = createMockReqRes({
      method: "POST",
      headers: authHeaders,
      body: {
        stage: 4,
        gstin: "12345"
      }
    });
    await handleFunctionalApi(req, res, "/api/startup-express/save-stage", "POST", {}, req.body);
    assert.strictEqual(getStatus(), 400);
    assert.ok(getData().error.includes("Invalid GSTIN format"));
  }

  // 7. Stage 4: Success with valid ARN and GSTIN
  {
    const { req, res, getStatus, getData } = createMockReqRes({
      method: "POST",
      headers: authHeaders,
      body: {
        stage: 4,
        gst_eligibility_type: "COMPULSORY_INTERSTATE",
        gst_arn: "AA271126001234Z",
        gst_status: "APPROVED_ACTIVE",
        gstin: "27ABCDE1234F1Z5"
      }
    });
    await handleFunctionalApi(req, res, "/api/startup-express/save-stage", "POST", {}, req.body);
    assert.strictEqual(getStatus(), 200);
    assert.strictEqual(getData().profile.gstin, "27ABCDE1234F1Z5");
    assert.strictEqual(getData().profile.gst_status, "APPROVED_ACTIVE");
  }

  // 8. Stage 5: Bank account masking (only last 4 stored)
  {
    const { req, res, getStatus, getData } = createMockReqRes({
      method: "POST",
      headers: authHeaders,
      body: {
        stage: 5,
        bank_name: "HDFC Bank",
        bank_ifsc: "HDFC0001234",
        bank_holder_name: "Apex Global Supplies",
        bank_account_number: "98765432109988",
        accounting_scheme: "ACCRUAL",
        opening_balance: 50000
      }
    });
    await handleFunctionalApi(req, res, "/api/startup-express/save-stage", "POST", {}, req.body);
    assert.strictEqual(getStatus(), 200);
    assert.strictEqual(getData().profile.bank_account_last4, "9988");
    assert.strictEqual(getData().profile.bank_account_number, undefined);
  }

  // 9. Stage 6: Invoicing Configuration
  {
    const { req, res, getStatus, getData } = createMockReqRes({
      method: "POST",
      headers: authHeaders,
      body: {
        stage: 6,
        invoice_prefix: "APX",
        invoice_starting_number: 1,
        default_hsn: "998311",
        default_gst_rate: 18
      }
    });
    await handleFunctionalApi(req, res, "/api/startup-express/save-stage", "POST", {}, req.body);
    assert.strictEqual(getStatus(), 200);
    assert.strictEqual(getData().profile.invoice_prefix, "APX");
    assert.strictEqual(getData().profile.invoice_starting_number, 1);
  }

  // 10. Stage 7: GST Compliance Activation
  {
    const { req, res, getStatus, getData } = createMockReqRes({
      method: "POST",
      headers: authHeaders,
      body: {
        stage: 7
      }
    });
    await handleFunctionalApi(req, res, "/api/startup-express/save-stage", "POST", {}, req.body);
    assert.strictEqual(getStatus(), 200);
    assert.strictEqual(getData().profile.overall_progress, 100);
    assert.strictEqual(getData().profile.completed_stages.length, 7);
  }

  // 11. Assistant Guidance endpoint
  {
    const { req, res, getStatus, getData } = createMockReqRes({
      method: "GET",
      headers: authHeaders,
      query: { stage: "4", structure: "PRIVATE_LIMITED" }
    });
    await handleFunctionalApi(req, res, "/api/startup-express/assistant", "GET", req.query, {});
    assert.strictEqual(getStatus(), 200);
    assert.ok(getData().guidance);
    assert.ok(getData().guidance.what.includes("GST"));
    assert.ok(getData().guidance.why);
    assert.ok(Array.isArray(getData().guidance.documents));
    assert.ok(getData().guidance.portal_url.includes("gst.gov.in"));
    assert.ok(getData().guidance.disclaimer);
  }

  // 12. Checklist Toggle endpoint
  {
    const { req, res, getStatus, getData } = createMockReqRes({
      method: "POST",
      headers: authHeaders,
      body: {
        item_key: "doc_identity",
        completed: true
      }
    });
    await handleFunctionalApi(req, res, "/api/startup-express/checklist", "POST", {}, req.body);
    assert.strictEqual(getStatus(), 200);
    assert.strictEqual(getData().profile.checklist.doc_identity, true);
  }

  // 13. Reset Profile endpoint
  {
    const { req, res, getStatus, getData } = createMockReqRes({
      method: "POST",
      headers: authHeaders
    });
    await handleFunctionalApi(req, res, "/api/startup-express/reset", "POST", {}, {});
    assert.strictEqual(getStatus(), 200);
    assert.strictEqual(getData().profile.overall_progress, 0);
    assert.strictEqual(getData().profile.current_stage, 1);
  }
});

test("Startup Express: Navigation & UI Template Integrity", async () => {
  const fs = await import("node:fs");
  const html = fs.readFileSync("index.html", "utf8");

  // 1. Navigation items
  assert.ok(html.includes('id="nav-link-startup-express"'), "Must include nav-link-startup-express");
  assert.ok(html.includes("rocket_launch"), "Must include rocket_launch icon");
  assert.ok(html.includes('href="/startup-express"'), "Must include /startup-express route");
  assert.ok(html.includes("NEW"), "Must include NEW badge");
  assert.ok(html.includes('id="bottom-nav-startup"'), "Must include bottom navigation for mobile");

  // 2. Removal of Tax Calc and Reports from mainSidebarNav
  const sidebarStart = html.indexOf('id="mainSidebarNav"');
  const sidebarEnd = html.indexOf('</nav>', sidebarStart);
  const sidebarNavHtml = html.slice(sidebarStart, sidebarEnd);

  assert.ok(!sidebarNavHtml.includes('id="nav-link-taxcalc"'), "Tax Calculation must be removed from main sidebar navigation");
  assert.ok(!sidebarNavHtml.includes('id="nav-link-reports"'), "Ledgers & Reports must be removed from main sidebar navigation");

  // 3. Preservation of backend containers and views
  assert.ok(html.includes('id="viewTaxCalcSuite"'), "Tax Calc suite container must be preserved");
  assert.ok(html.includes('id="viewGstSuite"'), "Reports/GST suite container must be preserved");

  // 4. Startup Express Landing Page elements
  assert.ok(html.includes("Start your business with confidence."), "Must include main heading");
  assert.ok(html.includes("From starting your business to filing your GST"), "Must include product positioning description");
  assert.ok(html.includes("START MY BUSINESS"), "Must include primary CTA button");
  assert.ok(html.includes("PROPRIETORSHIP"), "Must include Proprietorship structure option");
  assert.ok(html.includes("PARTNERSHIP"), "Must include Partnership structure option");
  assert.ok(html.includes("LLP"), "Must include LLP structure option");
  assert.ok(html.includes("PRIVATE_LIMITED"), "Must include Private Limited Company structure option");
  assert.ok(html.includes("OTHER"), "Must include Other structure option");

  // 5. 7-Stage Wizard & Progress Dashboard elements
  assert.ok(html.includes('id="startupStage1Form"'), "Must include Stage 1 form");
  assert.ok(html.includes('id="startupStage2Form"'), "Must include Stage 2 form");
  assert.ok(html.includes('id="startupStage3Form"'), "Must include Stage 3 form");
  assert.ok(html.includes('id="startupStage4Form"'), "Must include Stage 4 form");
  assert.ok(html.includes('id="startupStage5Form"'), "Must include Stage 5 form");
  assert.ok(html.includes('id="startupStage6Form"'), "Must include Stage 6 form");
  assert.ok(html.includes('id="startupStage7Form"'), "Must include Stage 7 form");
  assert.ok(html.includes('id="startupProgressGauge"'), "Must include progress gauge");
  assert.ok(html.includes('id="startupDashboardCard"'), "Must include dashboard card");
  assert.ok(html.includes('id="assistantContent"'), "Must include setup assistant card");

  // 6. Server.js route check
  const serverCode = fs.readFileSync("server.js", "utf8");
  assert.ok(serverCode.includes('pathname === "/startup-express"'), "Server must map /startup-express to index.html");
});

test("Startup Express: Structure Selection, Document Lifecycle & Workspace Activation", async () => {
  const testEmail = `founder.e2e.${Date.now()}@example.com`;
  const user = userRepo.create({
    email: testEmail,
    passwordHash: "hash_test_123",
    fullName: "E2E Startup Founder",
    role: "OWNER"
  });
  const org = orgRepo.create({
    name: "Initial Startup Hub",
    pan: "ABCDE1234F"
  });
  orgRepo.addMember(org.id, user.id, "OWNER");

  const sessionToken = crypto.randomBytes(32).toString("hex");
  const csrfToken = crypto.randomBytes(24).toString("hex");
  sessionRepo.create({
    userId: user.id,
    token: sessionToken,
    csrfToken: csrfToken,
    activeOrgId: org.id
  });

  const authHeaders = {
    authorization: `Bearer ${sessionToken}`
  };

  // 1. Structure Selection: Proprietorship
  {
    const { req, res, getStatus, getData } = createMockReqRes({
      method: "POST",
      headers: authHeaders,
      body: { structure: "PROPRIETORSHIP" }
    });
    await handleFunctionalApi(req, res, "/api/startup-express/select-structure", "POST", {}, req.body);
    assert.strictEqual(getStatus(), 200);
    assert.ok(getData().success);
    assert.strictEqual(getData().profile.business_structure, "PROPRIETORSHIP");
  }

  // 2. Stage 1: Save full business trade details
  {
    const { req, res, getStatus, getData } = createMockReqRes({
      method: "POST",
      headers: authHeaders,
      body: {
        stage: 1,
        proposed_business_name: "Apex Retail Solutions",
        legal_name: "Apex Retail Solutions",
        business_activity: "Trade (Retail / Wholesale)",
        business_category: "GOODS",
        business_description: "Wholesale distribution of commercial electronics",
        business_state: "Maharashtra",
        district: "Mumbai",
        business_pincode: "400001",
        business_address: "Shop 12, Nariman Point",
        nature_of_operations: "RETAIL",
        commencement_date: "2026-11-01"
      }
    });
    await handleFunctionalApi(req, res, "/api/startup-express/save-stage", "POST", {}, req.body);
    assert.strictEqual(getStatus(), 200);
    assert.strictEqual(getData().profile.proposed_business_name, "Apex Retail Solutions");
    assert.strictEqual(getData().profile.district, "Mumbai");
    assert.strictEqual(getData().profile.business_category, "GOODS");
    assert.ok(getData().profile.completed_stages.includes(1));
  }

  // 3. Stage 2: Structure-specific PAN check (Proprietorship requires 4th letter 'P')
  {
    const { req, res, getStatus, getData } = createMockReqRes({
      method: "POST",
      headers: authHeaders,
      body: {
        stage: 2,
        founder_name: "Rajesh Sharma",
        founder_pan: "ABCDC1234F" // 4th letter C -> should fail for Proprietorship (requires 'P')
      }
    });
    await handleFunctionalApi(req, res, "/api/startup-express/save-stage", "POST", {}, req.body);
    assert.strictEqual(getStatus(), 400);
    assert.ok(getData().error.includes("4th letter 'P'"));
  }

  // 4. Stage 2: Valid Proprietor PAN
  {
    const { req, res, getStatus, getData } = createMockReqRes({
      method: "POST",
      headers: authHeaders,
      body: {
        stage: 2,
        founder_name: "Rajesh Sharma",
        founder_pan: "ABCDE1234F" // 4th letter D? wait: ABCDE1234F has 4th char D.
      }
    });
    // In "ABCDE", char at index 3 is 'D'. For Proprietorship 4th char is index 3 = 'P'. Let's use "ABCPD1234F"
    req.body.founder_pan = "ABCPD1234F";
    await handleFunctionalApi(req, res, "/api/startup-express/save-stage", "POST", {}, req.body);
    assert.strictEqual(getStatus(), 200);
    assert.strictEqual(getData().profile.founder_pan, "ABCPD1234F");
  }

  // 5. Document Upload: Real base64 upload
  let uploadedDocId = null;
  {
    const samplePdfBase64 = Buffer.from("%PDF-1.4 sample identity test document").toString("base64");
    const { req, res, getStatus, getData } = createMockReqRes({
      method: "POST",
      headers: authHeaders,
      body: {
        filename: "founder_pan_card.pdf",
        category: "FOUNDER_PAN",
        stage: 2,
        fileData: `data:application/pdf;base64,${samplePdfBase64}`
      }
    });
    await handleFunctionalApi(req, res, "/api/startup-express/documents/upload", "POST", {}, req.body);
    assert.strictEqual(getStatus(), 201);
    assert.ok(getData().success);
    assert.strictEqual(getData().document.original_filename, "founder_pan_card.pdf");
    uploadedDocId = getData().document.id;
  }

  // 6. Document Retrieval via streaming endpoint
  {
    const { req, res, getStatus } = createMockReqRes({
      method: "GET",
      headers: authHeaders
    });
    const streamDone = new Promise((resolve) => {
      res.on("finish", resolve);
      res.on("close", resolve);
      res.on("error", resolve);
    });
    await handleFunctionalApi(req, res, `/api/startup-express/documents/${uploadedDocId}`, "GET", {}, {});
    await streamDone;
    assert.strictEqual(getStatus(), 200);
  }

  // 7. Structure Switching Warning when later stages already contain data
  {
    const { req, res, getStatus, getData } = createMockReqRes({
      method: "POST",
      headers: authHeaders,
      body: { structure: "PRIVATE_LIMITED" }
    });
    await handleFunctionalApi(req, res, "/api/startup-express/select-structure", "POST", {}, req.body);
    assert.strictEqual(getStatus(), 200);
    assert.strictEqual(getData().warning, true);
    assert.strictEqual(getData().requiresConfirmation, true);
  }

  // 8. Stage 3: Dynamic registrations checklist
  {
    const { req, res, getStatus, getData } = createMockReqRes({
      method: "POST",
      headers: authHeaders,
      body: {
        stage: 3,
        registration_reference_number: "UDYAM-MH-01-0099887",
        registration_status: "APPROVED",
        checklist_items: [
          { itemKey: "udyam", status: "APPROVED", refNumber: "UDYAM-MH-01-0099887" },
          { itemKey: "fssai", status: "NOT_APPLICABLE", notApplicableReason: "No food handling involved" }
        ]
      }
    });
    await handleFunctionalApi(req, res, "/api/startup-express/save-stage", "POST", {}, req.body);
    assert.strictEqual(getStatus(), 200);
    assert.strictEqual(getData().profile.registration_reference_number, "UDYAM-MH-01-0099887");
    assert.strictEqual(getData().profile.registration_status, "APPROVED");
  }

  // 9. Stage 4: Non-GST Statutory Exemption Path
  {
    const { req, res, getStatus, getData } = createMockReqRes({
      method: "POST",
      headers: authHeaders,
      body: {
        stage: 4,
        gst_eligibility_type: "EXEMPT_BELOW_THRESHOLD",
        gst_status: "NOT_REQUIRED_EXEMPT",
        gst_exemption_reason: "[THRESHOLD] Annual turnover under ₹40L statutory limit"
      }
    });
    await handleFunctionalApi(req, res, "/api/startup-express/save-stage", "POST", {}, req.body);
    assert.strictEqual(getStatus(), 200);
    assert.strictEqual(getData().profile.gst_status, "NOT_REQUIRED_EXEMPT");
    assert.strictEqual(getData().profile.gst_eligibility_type, "EXEMPT_BELOW_THRESHOLD");
  }

  // 10. Stage 5: Bank account confirmation mismatch validation
  {
    const { req, res, getStatus, getData } = createMockReqRes({
      method: "POST",
      headers: authHeaders,
      body: {
        stage: 5,
        account_status: "DETAILS_ADDED",
        bank_name: "State Bank of India",
        bank_ifsc: "SBIN0001234",
        bank_account_number: "123456789012",
        confirm_account_number: "123456789099" // mismatch
      }
    });
    await handleFunctionalApi(req, res, "/api/startup-express/save-stage", "POST", {}, req.body);
    assert.strictEqual(getStatus(), 400);
    assert.ok(getData().error.includes("do not match"));
  }

  // 11. Stage 5: Graceful NOT_OPENED bank account handling
  {
    const { req, res, getStatus, getData } = createMockReqRes({
      method: "POST",
      headers: authHeaders,
      body: {
        stage: 5,
        account_status: "NOT_OPENED",
        accounting_scheme: "REGULAR",
        opening_balance: 0
      }
    });
    await handleFunctionalApi(req, res, "/api/startup-express/save-stage", "POST", {}, req.body);
    assert.strictEqual(getStatus(), 200);
    assert.ok(getData().profile.completed_stages.includes(5));
  }

  // 12. Stage 6: Sequential Invoicing Rule 46 Configuration
  {
    const { req, res, getStatus, getData } = createMockReqRes({
      method: "POST",
      headers: authHeaders,
      body: {
        stage: 6,
        invoice_prefix: "SE-MUM/",
        invoice_starting_number: 101,
        default_hsn: "998311",
        default_gst_rate: 18
      }
    });
    await handleFunctionalApi(req, res, "/api/startup-express/save-stage", "POST", {}, req.body);
    assert.strictEqual(getStatus(), 200);
    assert.strictEqual(getData().profile.invoice_prefix, "SE-MUM/");
    assert.strictEqual(getData().profile.invoice_starting_number, 101);
  }

  // 13. Pre-Activation & Activation via /api/startup-express/activate
  {
    const { req, res, getStatus, getData } = createMockReqRes({
      method: "POST",
      headers: authHeaders
    });
    await handleFunctionalApi(req, res, "/api/startup-express/activate", "POST", {}, {});
    assert.strictEqual(getStatus(), 200);
    assert.ok(getData().success);
    assert.strictEqual(getData().activationStatus, "ACTIVATED_NON_GST");
    assert.strictEqual(getData().profile.overall_progress, 100);
    assert.ok(getData().profile.completed_stages.includes(7));

    // Verify Organization table was updated
    const orgCheck = orgRepo.findById(org.id);
    assert.strictEqual(orgCheck.name, "Apex Retail Solutions");
    assert.strictEqual(orgCheck.pan, "ABCPD1234F");
  }

  // 14. Document Deletion
  {
    const { req, res, getStatus, getData } = createMockReqRes({
      method: "DELETE",
      headers: authHeaders
    });
    await handleFunctionalApi(req, res, `/api/startup-express/documents/${uploadedDocId}`, "DELETE", {}, {});
    assert.strictEqual(getStatus(), 200);
    assert.ok(getData().success);
  }

  // 15. Tenant Isolation: Org 2 cannot access Org 1 profile or documents
  {
    const u2 = userRepo.create({
      email: `other.${Date.now()}@example.com`,
      passwordHash: "secret_other",
      fullName: "Other Founder"
    });
    const o2 = orgRepo.create({ name: "Other Org", pan: "ZZZZZ9999Z" });
    orgRepo.addMember(o2.id, u2.id, "OWNER");
    const token2 = crypto.randomBytes(32).toString("hex");
    sessionRepo.create({
      userId: u2.id,
      token: token2,
      csrfToken: "csrf2",
      activeOrgId: o2.id
    });

    const { req, res, getStatus, getData } = createMockReqRes({
      method: "GET",
      headers: { authorization: `Bearer ${token2}` }
    });
    await handleFunctionalApi(req, res, "/api/startup-express/profile", "GET", {}, {});
    assert.strictEqual(getStatus(), 200);
    // Org 2 gets its own clean profile, not Org 1's profile
    assert.strictEqual(getData().profile.org_id, o2.id);
    assert.strictEqual(getData().profile.proposed_business_name, "");
  }
});
