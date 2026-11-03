import test from "node:test";
import assert from "node:assert/strict";
import { handleRequest } from "../server.js";
import { EventEmitter } from "events";

class MockReq extends EventEmitter {
  constructor(url, method = "GET", body = null) {
    super();
    this.url = url;
    this.method = method;
    this.headers = { host: "localhost:3000" };
    this.body = body;
  }
}

class MockRes extends EventEmitter {
  constructor() {
    super();
    this.statusCode = 200;
    this.headers = {};
    this.body = "";
  }
  setHeader(k, v) { this.headers[k] = v; }
  writeHead(code, headers = {}) {
    this.statusCode = code;
    Object.assign(this.headers, headers);
  }
  end(chunk) {
    if (chunk) this.body += chunk;
    this.emit("finish");
  }
}

async function invoke(url, method = "GET", body = null) {
  const req = new MockReq(url, method, body);
  const res = new MockRes();
  await handleRequest(req, res);
  return {
    statusCode: res.statusCode,
    headers: res.headers,
    data: res.body ? JSON.parse(res.body) : {}
  };
}

test("ClearTax Expert: GET /api/expert/plans includes 1-Month Free Trial Plan", async () => {
  const res = await invoke("/api/expert/plans", "GET");
  assert.equal(res.statusCode, 200);
  assert.equal(res.data.success, true);
  const freeTrial = res.data.plans.find(p => p.id === "plan-free-trial");
  assert.ok(freeTrial, "1-Month Free Trial plan must exist in catalog");
  assert.equal(freeTrial.price, 0);
  assert.equal(freeTrial.badge, "Free for 1 Month");
});

test("ClearTax Expert: POST /api/expert/claim-free-trial activates 30-day trial", async () => {
  const res = await invoke("/api/expert/claim-free-trial", "POST", {
    pan: "CVBBC4433W",
    clientName: "Sanjay Harshi",
    phone: "9876543210"
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.data.success, true);
  assert.equal(res.data.booking.finalPrice, 0);
  assert.equal(res.data.booking.isFreeTrial, true);
  assert.equal(res.data.booking.daysRemaining, 30);
  assert.equal(res.data.booking.assignedExpert.name, "CA Anwin Ramachandran");
});

test("ClearTax Expert: POST /api/expert/book with FREE30DAYS gives 100% discount", async () => {
  const res = await invoke("/api/expert/book", "POST", {
    planId: "plan-salaried",
    clientName: "Sanjay Harshi",
    pan: "CVBBC4433W",
    couponCode: "FREE30DAYS"
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.data.discountPercent, 100);
  assert.equal(res.data.finalPrice, 0);
  assert.equal(res.data.isFreeTrial, true);
});

test("ClearTax Expert: GET /api/expert/status/:pan returns draft computation and assigned CA", async () => {
  const res = await invoke("/api/expert/status/CVBBC4433W", "GET");
  assert.equal(res.statusCode, 200);
  assert.equal(res.data.booking.assignedExpert.name, "CA Anwin Ramachandran");
  assert.ok(res.data.booking.computationDraft.taxSavedByCA > 0);
});

test("ClearTax Expert: POST /api/expert/chat returns statutory tax reply from CA", async () => {
  const res = await invoke("/api/expert/chat", "POST", {
    pan: "CVBBC4433W",
    message: "Should I choose Old vs New Regime?"
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.data.success, true);
  assert.ok(res.data.reply.text.includes("115BAC"));
});

test("ClearTax Expert: POST /api/expert/approve-draft files return and generates official ARN", async () => {
  const res = await invoke("/api/expert/approve-draft", "POST", {
    pan: "CVBBC4433W"
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.data.success, true);
  assert.ok(res.data.ackNumber.startsWith("ITR2026"));
});

