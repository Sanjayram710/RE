import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { escapeHtml, formatPaiseINR, rupeesToPaise } from "../public/v2/utils.js";
import { createInitialState, clearBusinessCache, state } from "../public/v2/state.js";
import { renderHomeView, renderInvoicesView } from "../public/v2/views.js";
import { apiRequest, abortAllRequests } from "../public/v2/api.js";
import { handleRequest } from "../server.js";
import { handleFunctionalApi } from "../lib/functionalApi.js";
import { userRepo, orgRepo, gstinRepo, sessionRepo } from "../lib/db.js";

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

test("Phase 2.1: XSS escaping prevents <script> and event handler injection in invoice & supplier names", () => {
  const s = createInitialState();
  s.authenticated = true;
  s.activeGstin = { gstin: "27AAACA1234A1Z5" };
  s.loading.sales = "ready";
  s.loading.purchases = "ready";
  s.sales = [{
    invoice_number: "INV-XSS-1",
    customer_name: '<script>alert("xss")</script>',
    invoice_date: "2026-10-15",
    taxable_amount: 1000,
    total_tax: 180,
    total_amount: 1180
  }];
  s.purchases = [{
    invoice_number: "PUR-XSS-1",
    supplier_name: '<img src=x onerror=alert(1)>',
    invoice_date: "2026-10-16",
    taxable_amount: 500,
    total_tax: 90,
    total_amount: 590
  }];

  s.invoiceTab = "sales";
  const salesHtml = renderInvoicesView(s);
  assert.ok(!salesHtml.includes("<script>"), "Sales HTML must never contain raw <script>");
  assert.ok(salesHtml.includes("&lt;script&gt;"), "Sales HTML must escape <script>");

  s.invoiceTab = "purchases";
  const purHtml = renderInvoicesView(s);
  assert.ok(!purHtml.includes("<img"), "Purchases HTML must never contain raw <img>");
  assert.ok(purHtml.includes("&lt;img"), "Purchases HTML must escape <img>");
  assert.equal(escapeHtml(`a&b<c>"d"`), "a&amp;b&lt;c&gt;&quot;d&quot;");
});

test("Phase 2.2: Integer-paise formatting with Indian grouping and zero float drift", () => {
  assert.equal(rupeesToPaise("123456.78"), 12345678);
  assert.equal(rupeesToPaise("0.1"), 10);
  assert.equal(formatPaiseINR(12345600), "₹1,23,456");
  assert.equal(formatPaiseINR(12345678, { showDecimals: true }), "₹1,23,456.78");
  assert.equal(formatPaiseINR(-50050), "-₹500.50");
});

test("Phase 2.3: Dashboard renders preparation-only banner and explicit empty state", () => {
  const s = createInitialState();
  s.authenticated = true;
  s.loading.dashboard = "ready";
  s.dashboard = {
    entity: { tradeName: "New Shop", gstin: "27AABCN0000A1Z5" },
    periodLabel: "October 2026",
    environment: {
      preparationOnly: true,
      bannerMessage: "Preparation only: filing is not connected yet"
    },
    metrics: {
      salesCount: 0,
      purchasesCount: 0,
      paise: {
        taxableSalesPaise: 0,
        taxablePurchasesPaise: 0,
        totalEligibleItcPaise: 0,
        netCashPayablePaise: 0
      }
    }
  };
  const html = renderHomeView(s);
  assert.match(html, /Preparation only:/);
  assert.match(html, /filing is not connected yet/);
  assert.match(html, /No bills added yet/);
});

test("Phase 2.4: GSTIN switch aborts in-flight requests and clears GSTIN A data before loading GSTIN B", async () => {
  const origFetch = globalThis.fetch;
  let abortedCount = 0;
  try {
    state.dashboard = { entity: { gstin: "27GSTINA" }, metrics: { salesCount: 9 } };
    state.sales = [{ invoice_number: "ONLY-IN-A" }];
    state.purchases = [{ invoice_number: "PUR-IN-A" }];

    globalThis.fetch = (_url, opts) => new Promise((_resolve, reject) => {
      opts.signal.addEventListener("abort", () => {
        abortedCount++;
        const err = new Error("Aborted");
        err.name = "AbortError";
        reject(err);
      });
    });

    const slowReq = apiRequest("/api/dashboard/summary");
    abortAllRequests();
    clearBusinessCache();

    await assert.rejects(slowReq, { name: "AbortError" });
    assert.equal(abortedCount, 1);
    assert.equal(state.dashboard, null);
    assert.deepEqual(state.sales, []);
    assert.deepEqual(state.purchases, []);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("Phase 2.5: Server blocks static /data/ access, enforces CSP on /app, and restricts CA review to Admin/Owner", async () => {
  const dataRes = createMockRes();
  await handleRequest({ url: "/data/simplegst.db", method: "GET", headers: { host: "localhost:3000" } }, dataRes);
  assert.equal(dataRes.statusCode, 403);

  const appRes = createMockRes();
  await handleRequest({ url: "/app", method: "GET", headers: { host: "localhost:3000" } }, appRes);
  assert.equal(appRes.statusCode, 200);
  assert.match(appRes.headers["Content-Security-Policy"], /script-src 'self'/);
  assert.ok(!appRes.headers["Content-Security-Policy"].includes("script-src 'self' 'unsafe-inline'"));

  const uid = crypto.randomUUID().slice(0, 6);
  const num = String(Math.floor(1000 + Math.random() * 8999));
  const accUser = userRepo.create({
    email: `acc-${uid}@example.test`,
    passwordHash: userRepo.hashPassword("Test@1234"),
    fullName: "Accountant User",
    role: "ACCOUNTANT"
  });
  const org = orgRepo.create({ name: `Org ${uid}`, pan: `AABCA${num}K`, state: "Maharashtra" });
  orgRepo.addMember(org.id, accUser.id, "ACCOUNTANT");
  const gst = gstinRepo.create({ orgId: org.id, gstin: `27AABCA${num}K1Z5`, tradeName: "Branch", stateCode: "27", stateName: "Maharashtra" });
  const sess = sessionRepo.create({ userId: accUser.id, activeOrgId: org.id, activeGstinId: gst.id, activePeriod: "102026" });

  const caRes = createMockRes();
  await handleFunctionalApi({ headers: { authorization: `Bearer ${sess.token}` }, body: {} }, caRes, "/api/ca-review/export", "GET", { period: "102026" }, {});
  assert.equal(caRes.statusCode, 403);
});
