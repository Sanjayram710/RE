import test from "node:test";
import assert from "node:assert/strict";

import {
  executeGspApi,
  getAllApis,
  getApiById,
  runAllApisHealthCheck
} from "../lib/gsp/index.js";
import { DEMO_BUSINESS } from "../lib/demoData.js";

test("182 GST APIs: Catalog integrity", () => {
  const apis = getAllApis();
  assert.equal(apis.length, 182, "Must contain all 182 statutory GST APIs");

  // Check unique IDs
  const idSet = new Set(apis.map(x => x.id));
  assert.equal(idSet.size, 182, "All 182 APIs must have unique sequential IDs");

  // Verify group coverage
  const groups = new Set(apis.map(x => x.group));
  assert.ok(groups.has("Auth"), "Must include Auth group");
  assert.ok(groups.has("GSTR1"), "Must include GSTR1 group");
  assert.ok(groups.has("GSTR1A"), "Must include GSTR1A group");
  assert.ok(groups.has("GSTR2A"), "Must include GSTR2A group");
  assert.ok(groups.has("IMS"), "Must include IMS group");
  assert.ok(groups.has("GSTR2B"), "Must include GSTR2B group");
  assert.ok(groups.has("GSTR3B"), "Must include GSTR3B group");
  assert.ok(groups.has("GSTR4"), "Must include GSTR4 group");
  assert.ok(groups.has("GSTR6"), "Must include GSTR6 group");
  assert.ok(groups.has("GSTR7"), "Must include GSTR7 group");
  assert.ok(groups.has("GSTR8"), "Must include GSTR8 group");
  assert.ok(groups.has("GSTR9"), "Must include GSTR9 group");
  assert.ok(groups.has("GSTR9C"), "Must include GSTR9C group");
  assert.ok(groups.has("ITC01"), "Must include ITC01 group");
  assert.ok(groups.has("ITC03"), "Must include ITC03 group");
  assert.ok(groups.has("ITC04"), "Must include ITC04 group");
  assert.ok(groups.has("CMP"), "Must include CMP group");
  assert.ok(groups.has("Public"), "Must include Public group");
});

test("182 GST APIs: Auth Group (IDs 1-5)", async () => {
  // #1: Initiate OTP for EVC
  const res1 = await executeGspApi(1);
  assert.equal(res1.success, true);
  assert.ok(res1.txn.startsWith("EVC_"));

  // #2: Logout
  const res2 = await executeGspApi(2);
  assert.equal(res2.success, true);

  // #3: Token extension
  const res3 = await executeGspApi(3);
  assert.equal(res3.success, true);
  assert.ok(res3.auth_token.startsWith("gst_ext_tok_"));

  // #4: Request OTP
  const res4 = await executeGspApi(4);
  assert.equal(res4.success, true);
  assert.equal(res4.status_cd, "1");

  // #5: Request Auth token
  const res5 = await executeGspApi(5);
  assert.equal(res5.success, true);
  assert.ok(res5.auth_token.startsWith("gst_auth_tok_"));
  assert.equal(res5.session_status, "ACTIVE");
});

test("182 GST APIs: GSTR-1, GSTR-2A & GSTR-2B Operations", async () => {
  // #9: GSTR1 - Get B2B Invoices
  const res9 = await executeGspApi(9);
  assert.equal(res9.success, true);
  assert.ok(res9.b2b.length > 0);
  assert.ok(res9.b2b[0].inv[0].val > 0);

  // #25: GSTR1 - Get Summary
  const res25 = await executeGspApi(25);
  assert.equal(res25.success, true);
  assert.ok(res25.sec_sum.length > 0);

  // #69: GSTR2A - Get B2B Invoices
  const res69 = await executeGspApi(69);
  assert.equal(res69.success, true);
  assert.ok(res69.b2b.length > 0);

  // #88: GSTR2B - Generate 2B On Demand
  const res88 = await executeGspApi(88);
  assert.equal(res88.success, true);
  assert.ok(res88.req_id.startsWith("REQ_2B_GEN_"));

  // #90: GSTR2B - Get All Details
  const res90 = await executeGspApi(90);
  assert.equal(res90.success, true);
  assert.ok(res90.data.itc_available);
});

test("182 GST APIs: GSTR-3B Operations & Liability Offset", async () => {
  // #92: Get GSTR-3B Details
  const res92 = await executeGspApi(92);
  assert.equal(res92.success, true);
  assert.equal(res92.table3_1.outward_taxable, 54000);

  // #93: Get ITC Liability Auto Calc
  const res93 = await executeGspApi(93);
  assert.equal(res93.success, true);
  assert.equal(res93.auto_calc.table3_1_outward.txval, 54000);

  // #99: Offset Liability GSTR-3B
  const res99 = await executeGspApi(99);
  assert.equal(res99.success, true);
  assert.equal(res99.offset_status, "COMPLETED");

  // #105: Validate GSTR3B against AutoCalculated data
  const res105 = await executeGspApi(105);
  assert.equal(res105.success, true);
  assert.equal(res105.is_variance_acceptable, true);
});

test("182 GST APIs: Documented Non-Working & Error Cases from CSV", async () => {
  // API #104: GSTR3B - Submit RCM Opening Balance (Remark: 404 - Not Found)
  const res104 = await executeGspApi(104);
  assert.equal(res104.httpStatusCode, 404);
  assert.equal(res104.error.error_cd, "HTTP_404");
  assert.equal(res104.remark, "404 - Not Found");

  // API #107: GSTR4 Annual - Get 4A-4B Autopop Details (Remark: XML parse error)
  const res107 = await executeGspApi(107);
  assert.equal(res107.isSuccess, false);
  assert.ok(res107.message.includes("Unexpected character encountered"));

  // API #110: GSTR4 Annual - Get TDSCMP Summary (Remark: GSTN-EXEC2003)
  const res110 = await executeGspApi(110);
  assert.equal(res110.data.httpStatusCode, 200);
  assert.equal(res110.data.error.error_cd, "GSTN-EXEC2003");

  // API #121: GSTR6 - Get CDNA Invoices (Remark: AUTH113 Invalid Return Period)
  const res121 = await executeGspApi(121);
  assert.equal(res121.data.httpStatusCode, 200);
  assert.equal(res121.data.error.error_cd, "AUTH113");

  // API #122: GSTR6 - Get GSTR6 Summary (Remark: RET12501 System Failure)
  const res122 = await executeGspApi(122);
  assert.equal(res122.data.httpStatusCode, 200);
  assert.equal(res122.data.error.error_cd, "RET12501");
});

test("182 GST APIs: Public Taxpayer & Returns Verification", async () => {
  // API #178: Online Verification of GSTIN
  const res178 = await executeGspApi(178);
  assert.equal(res178.success, true);
  assert.equal(res178.status, "Active");
  assert.equal(res178.taxpayer_type, "Regular");

  // API #179: PAN to GSTIN
  const res179 = await executeGspApi(179);
  assert.equal(res179.success, true);
  assert.ok(res179.branches.length >= 3);

  // API #180: Search Taxpayer
  const res180 = await executeGspApi(180);
  assert.equal(res180.success, true);
  assert.equal(res180.legal_name, DEMO_BUSINESS.legal_name);

  // API #182: View and Track Returns
  const res182 = await executeGspApi(182);
  assert.equal(res182.success, true);
  assert.ok(res182.filing_history.length >= 4);
});

test("182 GST APIs: Universal Batch Health Check across all 182 APIs", async () => {
  const report = await runAllApisHealthCheck(DEMO_BUSINESS.gstin);
  assert.equal(report.total, 182, "Must execute health check for all 182 APIs");
  assert.equal(report.results.length, 182);
  assert.ok(report.counts.working > 0, "Must count operational working APIs");
  assert.ok(report.counts.notWorking > 0, "Must count documented not working APIs");
});

