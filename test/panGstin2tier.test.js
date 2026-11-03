import test from "node:test";
import assert from "node:assert/strict";

import {
  verifyTier1,
  verifyTier2,
  execute2TierVerification,
  PAN_ENTITY_TYPES
} from "../lib/panGstinValidator.js";

test("2-Tier Verification: Tier 1 structural validation & entity decoding", () => {
  // Test Company PAN
  const comp = verifyTier1("AAACB1234F");
  assert.equal(comp.valid, true);
  assert.equal(comp.entityCode, "C");
  assert.equal(comp.entityType, "Company / Corporate");

  // Test Individual PAN
  const indiv = verifyTier1("ABCDE1234F");
  assert.equal(indiv.valid, true);
  assert.equal(indiv.entityCode, "D"); // Wait, 4th char is D? Let's check 4th char index: index 3 is 'D'. If "ABCDE", index 0=A, 1=B, 2=C, 3=D.
});

test("2-Tier Verification: Tier 1 PAN entity classification checks", () => {
  // Test 4th character entity type
  const indivPan = verifyTier1("ABCPD1234F"); // 4th char is P
  assert.equal(indivPan.entityCode, "P");
  assert.equal(indivPan.entityType, "Individual / Proprietorship");

  const firmPan = verifyTier1("AAAFA1234F"); // 4th char is F
  assert.equal(firmPan.entityCode, "F");
  assert.equal(firmPan.entityType, "Partnership Firm / LLP");
});

test("2-Tier Verification: Tier 1 PAN and GSTIN mathematical link matching", () => {
  const pan = "AAACB1234F";
  const matchingGstin = "29AAACB1234F1Z5";
  const mismatchGstin = "29XYZAB1234F1Z5";

  // Matching
  const matchRes = verifyTier1(pan, matchingGstin);
  assert.equal(matchRes.valid, true);
  assert.equal(matchRes.isLinked, true);
  assert.equal(matchRes.error, null);

  // Mismatch
  const mismatchRes = verifyTier1(pan, mismatchGstin);
  assert.equal(mismatchRes.isLinked, false);
  assert.match(mismatchRes.error, /Mismatch/);
});

test("2-Tier Verification: Tier 2 statutory API execution and branch discovery", async () => {
  const pan = "AAACB1234F";
  const gstin = "29AAACB1234F1Z5";

  const fullReport = await execute2TierVerification(pan, gstin);
  assert.equal(fullReport.success, true);
  assert.equal(fullReport.tier1.valid, true);
  assert.equal(fullReport.tier1.isLinked, true);
  assert.equal(fullReport.tier2.portalLinked, true);
  assert.ok(fullReport.tier2.branches.length > 0);
  assert.equal(fullReport.tier2.taxpayer.status, "Active");
});

test("2-Tier Verification: Standalone PAN auto-discovers registered state branches", async () => {
  const pan = "AAACB1234F";
  const report = await execute2TierVerification(pan);

  assert.equal(report.success, true);
  assert.equal(report.tier1.valid, true);
  assert.equal(report.tier2.portalLinked, true);
  assert.ok(report.tier2.branches.some(b => b.gstin.includes(pan)));
});

test("2-Tier Verification: Invalid PAN rejects at Tier 1 without calling Tier 2", async () => {
  const invalidPan = "INVALID12";
  const report = await execute2TierVerification(invalidPan);

  assert.equal(report.success, false);
  assert.equal(report.tier1.valid, false);
  assert.equal(report.tier2.status, "SKIPPED");
});

