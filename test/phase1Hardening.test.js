import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";

import { toPaise, fromPaise, percentOfPaise } from "../lib/moneyPaise.js";
import { computeRule88aSetoff } from "../lib/rule88aEngine.js";
import { assertProductionSafety } from "../scripts/check_prod_env.js";
import { handleFunctionalApi } from "../lib/functionalApi.js";
import { userRepo, orgRepo, gstinRepo, sessionRepo, purchaseRepo, documentRepo } from "../lib/db.js";

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

function createTenant(tag) {
  const uid = crypto.randomUUID().slice(0, 6).toUpperCase();
  const num = String(Math.floor(1000 + Math.random() * 8999));
  const user = userRepo.create({
    email: `p1-${tag}-${uid}@example.test`,
    passwordHash: userRepo.hashPassword("Test@1234"),
    fullName: `Phase1 User ${tag}`,
    role: "OWNER"
  });
  const org = orgRepo.create({
    name: `Phase1 Org ${tag} ${uid}`,
    pan: `AABCP${num}K`,
    state: "Maharashtra"
  });
  orgRepo.addMember(org.id, user.id, "OWNER");
  const gstin1 = gstinRepo.create({
    orgId: org.id,
    gstin: `27AABCP${num}K1Z5`,
    tradeName: `Branch MH ${tag}`,
    stateCode: "27",
    stateName: "Maharashtra",
    isPrimary: 1
  });
  const gstin2 = gstinRepo.create({
    orgId: org.id,
    gstin: `29AABCP${num}K1Z1`,
    tradeName: `Branch KA ${tag}`,
    stateCode: "29",
    stateName: "Karnataka",
    isPrimary: 0
  });
  const session = sessionRepo.create({
    userId: user.id,
    activeOrgId: org.id,
    activeGstinId: gstin1.id,
    activePeriod: "102026"
  });
  return { user, org, gstin1, gstin2, session };
}

function authReq(token, body = {}) {
  return {
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body
  };
}

test("Phase 1.1: Integer-paise calculation eliminates float drift", () => {
  assert.equal(toPaise(0.1) + toPaise(0.2), 30);
  assert.equal(fromPaise(toPaise(0.1) + toPaise(0.2)), 0.3);
  assert.equal(percentOfPaise(toPaise(100.55), 18), 1810);

  const setoff = computeRule88aSetoff(
    { igst: 100.1, cgst: 50.2, sgst: 50.2, cess: 0 },
    { igst: 120.05, cgst: 40.15, sgst: 40.15, cess: 0 }
  );
  assert.equal(setoff.paise.netCashPayable, 15);
  assert.equal(setoff.netCashPayable.total, 0.15);
  assert.equal(setoff.validation.needsCaReview, true);
});

test("Phase 1.2: Production safety guard and /api/auth/dev-session env gating", async () => {
  const prevEnv = process.env.NODE_ENV;
  const prevDevAuth = process.env.ENABLE_DEV_AUTH;
  try {
    process.env.NODE_ENV = "production";
    process.env.ENABLE_DEV_AUTH = "true";
    assert.throws(() => assertProductionSafety(), /FATAL PRODUCTION SAFETY ERROR/);

    process.env.NODE_ENV = "test";
    delete process.env.ENABLE_DEV_AUTH;
    const res = createMockRes();
    await handleFunctionalApi({ headers: {}, body: {} }, res, "/api/auth/dev-session", "POST", {}, {});
    assert.equal(res.statusCode, 403);
  } finally {
    process.env.NODE_ENV = prevEnv;
    if (prevDevAuth !== undefined) process.env.ENABLE_DEV_AUTH = prevDevAuth;
    else delete process.env.ENABLE_DEV_AUTH;
  }
});

test("Phase 1.3: filing_drafts persists per org+gstin+period with strict Multi-GSTIN isolation", async () => {
  const t1 = createTenant("D1");
  const t2 = createTenant("D2");

  // Save draft step 3 on t1.gstin1
  const putRes = createMockRes();
  await handleFunctionalApi(authReq(t1.session.token), putRes, "/api/filing/draft", "PUT", {}, {
    period: "102026",
    currentStep: 3,
    draft: { note: "Checking GSTR-2B" }
  });
  assert.equal(putRes.statusCode, 200);
  assert.equal(JSON.parse(putRes.body).currentStep, 3);

  // Switch to t1.gstin2 -> must be isolated (step 1)
  const swRes = createMockRes();
  await handleFunctionalApi(authReq(t1.session.token), swRes, `/api/gstins/${t1.gstin2.id}/activate`, "POST", {}, {});
  assert.equal(swRes.statusCode, 200);

  const g2Res = createMockRes();
  await handleFunctionalApi(authReq(t1.session.token), g2Res, "/api/filing/draft", "GET", { period: "102026" }, {});
  assert.equal(g2Res.statusCode, 200);
  assert.equal(JSON.parse(g2Res.body).currentStep, 1);

  // Switch back to t1.gstin1 -> step 3 restored
  await handleFunctionalApi(authReq(t1.session.token), createMockRes(), `/api/gstins/${t1.gstin1.id}/activate`, "POST", {}, {});
  const g1Res = createMockRes();
  await handleFunctionalApi(authReq(t1.session.token), g1Res, "/api/filing/draft", "GET", { period: "102026" }, {});
  assert.equal(JSON.parse(g1Res.body).currentStep, 3);
  assert.equal(JSON.parse(g1Res.body).draft.note, "Checking GSTR-2B");

  // Tenant t2 sees its own clean draft, never t1's
  const t2Res = createMockRes();
  await handleFunctionalApi(authReq(t2.session.token), t2Res, "/api/filing/draft", "GET", { period: "102026" }, {});
  assert.equal(JSON.parse(t2Res.body).currentStep, 1);
  assert.deepEqual(JSON.parse(t2Res.body).draft, {});
});

test("Phase 1.4: Upload hardening (magic bytes, PDF page limit, PNG dims, random path outside public/)", async () => {
  const t = createTenant("UP");

  // 1. Spoofed PDF (no %PDF- magic bytes)
  const badPdf = createMockRes();
  await handleFunctionalApi(authReq(t.session.token), badPdf, "/api/documents/upload", "POST", {}, {
    filename: "spoof.pdf",
    content: "data:application/pdf;base64," + Buffer.from("NOT_A_PDF_MZ_EXE").toString("base64")
  });
  assert.equal(badPdf.statusCode, 400);
  assert.match(JSON.parse(badPdf.body).error, /magic bytes/i);

  // 2. Spoofed PNG
  const badPng = createMockRes();
  await handleFunctionalApi(authReq(t.session.token), badPng, "/api/documents/upload", "POST", {}, {
    filename: "spoof.png",
    content: "data:image/png;base64," + Buffer.from("GIF89a").toString("base64")
  });
  assert.equal(badPng.statusCode, 400);
  assert.match(JSON.parse(badPng.body).error, /PNG magic/i);

  // 3. PDF exceeding 25-page OCR limit
  const manyPages = "%PDF-1.4\n" + Array.from({ length: 27 }, () => "/Type /Page ").join("\n");
  const bigPdf = createMockRes();
  await handleFunctionalApi(authReq(t.session.token), bigPdf, "/api/documents/upload", "POST", {}, {
    filename: "huge.pdf",
    content: "data:application/pdf;base64," + Buffer.from(manyPages).toString("base64")
  });
  assert.equal(bigPdf.statusCode, 400);
  assert.match(JSON.parse(bigPdf.body).error, /page OCR limit/i);

  // 4. PNG exceeding 10,000px dimension limit
  const pngHdr = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(pngHdr, 0);
  pngHdr.writeUInt32BE(13, 8);
  pngHdr.write("IHDR", 12);
  pngHdr.writeUInt32BE(12000, 16);
  pngHdr.writeUInt32BE(800, 20);
  const bigPng = createMockRes();
  await handleFunctionalApi(authReq(t.session.token), bigPng, "/api/documents/upload", "POST", {}, {
    filename: "giant.png",
    content: "data:image/png;base64," + pngHdr.toString("base64")
  });
  assert.equal(bigPng.statusCode, 400);
  assert.match(JSON.parse(bigPng.body).error, /OCR limit/i);

  // 5. Valid PDF stores with random UUID filename outside public/
  const validPdf = createMockRes();
  await handleFunctionalApi(authReq(t.session.token), validPdf, "/api/documents/upload", "POST", {}, {
    filename: "../../evil.pdf",
    content: "data:application/pdf;base64," + Buffer.from("%PDF-1.4\nTAX INVOICE INV-SAFE-1 Taxable: 1000\n%%EOF").toString("base64")
  });
  assert.equal(validPdf.statusCode, 201);
  const doc = JSON.parse(validPdf.body).document;
  assert.ok(!doc.storage_path.includes(`${path.sep}public${path.sep}`));
  assert.match(path.basename(doc.storage_path), /^[0-9a-f-]{36}\.pdf$/i);
  documentRepo.delete(doc.id);
  if (fs.existsSync(doc.storage_path)) fs.unlinkSync(doc.storage_path);
});

test("Phase 1.5: Duplicate FY check, idempotent simulation filing, production OTP block, and CA review export", async () => {
  const t = createTenant("FL");

  // 1. Purchase FY duplicate check
  const p1 = createMockRes();
  await handleFunctionalApi(authReq(t.session.token), p1, "/api/purchases", "POST", { period: "102026" }, {
    invoiceNumber: "SUP-9001",
    invoiceDate: "2026-10-10",
    supplierName: "RCM Transporters",
    supplierGstin: "27AAACS1111A1Z9",
    pos: "27",
    taxableAmount: 10000,
    gstRate: 5,
    isRcm: true
  });
  assert.equal(p1.statusCode, 201);

  const pDup = createMockRes();
  await handleFunctionalApi(authReq(t.session.token), pDup, "/api/purchases", "POST", { period: "102026" }, {
    invoiceNumber: "SUP-9001",
    invoiceDate: "2026-11-05", // Same FY 2026-27
    supplierName: "RCM Transporters",
    supplierGstin: "27AAACS1111A1Z9",
    pos: "27",
    taxableAmount: 10000,
    gstRate: 5
  });
  assert.equal(pDup.statusCode, 400);
  assert.match(JSON.parse(pDup.body).error, /Duplicate purchase bill/i);

  // 2. CA Review JSON & CSV Export
  const caJson = createMockRes();
  await handleFunctionalApi(authReq(t.session.token), caJson, "/api/ca-review", "GET", { period: "102026" }, {});
  assert.equal(caJson.statusCode, 200);
  const caData = JSON.parse(caJson.body);
  assert.ok(caData.items.length >= 2);
  assert.ok(caData.items.every(i => i.needsCaReview === true));
  assert.ok(caData.items.some(i => i.category === "RCM_CASH_ONLY"));

  const caCsv = createMockRes();
  await handleFunctionalApi(authReq(t.session.token), caCsv, "/api/ca-review/export", "GET", { period: "102026", format: "csv" }, {});
  assert.equal(caCsv.statusCode, 200);
  assert.match(caCsv.headers["Content-Type"], /text\/csv/);
  assert.match(caCsv.body, /RCM_CASH_ONLY/);

  // 3. Simulation OTP blocked in NODE_ENV=production
  const prevEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "production";
    const prodFile = createMockRes();
    await handleFunctionalApi(authReq(t.session.token), prodFile, "/api/returns/gstr3b/file", "POST", {}, {
      period: "102026",
      otp: "123456"
    });
    assert.equal(prodFile.statusCode, 503);
  } finally {
    process.env.NODE_ENV = prevEnv;
  }

  // 4. Simulation filing + Idempotency (409 on second submit)
  const f1 = createMockRes();
  await handleFunctionalApi(authReq(t.session.token), f1, "/api/returns/gstr3b/file", "POST", {}, {
    period: "102026",
    otp: "123456",
    paymentDone: true
  });
  assert.equal(f1.statusCode, 200);
  const f1Data = JSON.parse(f1.body);
  assert.equal(f1Data.simulationMode, true);
  assert.equal(f1Data.displayStatus, "Filed (simulation)");
  assert.match(f1Data.arn, /^SIM-/);

  const f2 = createMockRes();
  await handleFunctionalApi(authReq(t.session.token), f2, "/api/returns/gstr3b/file", "POST", {}, {
    period: "102026",
    otp: "123456",
    paymentDone: true
  });
  assert.equal(f2.statusCode, 409);
  assert.match(JSON.parse(f2.body).error, /Duplicate submission rejected/i);

  // History displays "Filed (simulation)"
  const hist = createMockRes();
  await handleFunctionalApi(authReq(t.session.token), hist, "/api/returns/history", "GET", {}, {});
  assert.equal(hist.statusCode, 200);
  assert.equal(JSON.parse(hist.body).filings[0].displayStatus, "Filed (simulation)");

  // Clean up test purchase
  purchaseRepo.delete(JSON.parse(p1.body).id);
});
