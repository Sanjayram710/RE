import test from "node:test";
import assert from "node:assert/strict";

import { fileNilGstReturn } from "../lib/gstCopilotEngine.js";
import { extractDocumentData, SAMPLE_DOCUMENTS } from "../lib/aiDocumentExtractorEngine.js";
import { getCadenceSchedule, calculateDelayEscalation, STATUTORY_SEQUENCE } from "../lib/statutoryCadenceEngine.js";

test("Layman Experience: 1-Click Nil GST Return Filing", () => {
  const res = fileNilGstReturn({
    gstin: "32ABCDE1234F1Z5",
    period: "102026",
    authorisedPerson: "Leo Das",
    verificationMode: "SMS_OTP"
  });

  assert.equal(res.success, true);
  assert.equal(res.isNil, true);
  assert.match(res.arn, /^NIL-AA32/);
  assert.equal(res.statutorySummary.outwardTaxableSales, 0);
  assert.equal(res.statutorySummary.netTaxPaidInCash, 0);
  assert.equal(res.statutorySummary.lateFeePaid, 0);
  assert.equal(res.status, "FILED_AND_CONFIRMED");
  assert.ok(res.downloadCertificate.certificateNumber.startsWith("CERT-NIL-"));
});

test("Layman Experience: AI Ingestion extracts Sales Invoices accurately", () => {
  const res = extractDocumentData({
    type: "sales_invoice",
    filename: "sample_bill.pdf"
  });

  assert.equal(res.success, true);
  assert.equal(res.documentType, "sales_invoice");
  assert.equal(res.data.partyName, "Calicut Kirana & General Store");
  assert.equal(res.data.gstinValid, true);
  assert.equal(res.data.taxableValue, 85000);
  assert.equal(res.data.totalGst, 15300);
  assert.ok(res.confidence.includes("%"));
});

test("Layman Experience: AI Ingestion extracts Purchase Bills & verifies Sec 16(2)(aa) 2B match", () => {
  const res = extractDocumentData({
    type: "purchase_bill",
    filename: "cochin_spices_bill.pdf"
  });

  assert.equal(res.success, true);
  assert.equal(res.documentType, "purchase_bill");
  assert.equal(res.data.partyName, "Cochin Spices & Agro Mart");
  assert.ok(res.data.statutoryMatch);
  assert.equal(res.data.statutoryMatch.isMatchedIn2B, true);
  assert.equal(res.data.statutoryMatch.safeToClaimItc, true);
});

test("Layman Experience: AI Ingestion handles Bank Statements", () => {
  const res = extractDocumentData({
    type: "bank_statement",
    filename: "hdfc_stmt.pdf"
  });

  assert.equal(res.success, true);
  assert.equal(res.documentType, "bank_statement");
  assert.equal(res.data.accountNumber, "50200084920192");
  assert.equal(res.data.totalCredits, 1240000);
});

test("Layman Experience: AI regex extraction from raw text", () => {
  const rawText = "TAX INVOICE INV-9988 Date: 2026-10-22 GSTIN: 32AAACB1234F1Z5 Subtotal: 10,000";
  const res = extractDocumentData({
    type: "sales_invoice",
    rawText
  });

  assert.equal(res.success, true);
  assert.equal(res.data.gstin, "32AAACB1234F1Z5");
  assert.equal(res.data.invoiceNumber, "INV-9988");
  assert.equal(res.data.taxableValue, 10000);
});

test("Layman Experience: Delay Escalation & Statutory Fine Calculator", () => {
  // Case 1: On-time filing (0 days)
  const onTime = calculateDelayEscalation({ delayDays: 0, isNil: false, netTaxLiability: 70200 });
  assert.equal(onTime.riskTier, "ON_TIME");
  assert.equal(onTime.statutoryLateFee, 0);
  assert.equal(onTime.statutoryInterest, 0);
  assert.equal(onTime.totalEscalationFine, 0);

  // Case 2: 5 days delay on active return (₹50/day = ₹250)
  const delayed5Days = calculateDelayEscalation({ delayDays: 5, isNil: false, netTaxLiability: 70200 });
  assert.equal(delayed5Days.statutoryLateFee, 250);
  assert.ok(delayed5Days.statutoryInterest > 0);
  assert.equal(delayed5Days.ewayBillBlocked, false);

  // Case 3: 5 days delay on Nil return (₹20/day = ₹100, ₹0 interest)
  const nilDelayed = calculateDelayEscalation({ delayDays: 5, isNil: true, netTaxLiability: 0 });
  assert.equal(nilDelayed.statutoryLateFee, 100);
  assert.equal(nilDelayed.statutoryInterest, 0);
  assert.equal(nilDelayed.totalEscalationFine, 100);

  // Case 4: Severe delay (>60 days) triggers Rule 138E E-Way Bill block
  const severeDelay = calculateDelayEscalation({ delayDays: 65, isNil: false, netTaxLiability: 70200 });
  assert.equal(severeDelay.ewayBillBlocked, true);
  assert.equal(severeDelay.riskTier, "SEVERE_ESCALATION");
});

test("Layman Experience: Statutory Cadence Schedule (1st, 3rd, 5th, 7th, 9th, 20th)", () => {
  const schedule = getCadenceSchedule(7);
  assert.equal(schedule.length, STATUTORY_SEQUENCE.length);

  const day1 = schedule.find(s => s.dayOfMonth === 1);
  const day7 = schedule.find(s => s.dayOfMonth === 7);
  const day9 = schedule.find(s => s.dayOfMonth === 9);
  const day20 = schedule.find(s => s.dayOfMonth === 20);

  assert.ok(day1.isPast);
  assert.ok(day7.isCurrent);
  assert.equal(day7.status, "ACTIVE_NOW");
  assert.equal(day9.urgency, "CRITICAL");
  assert.equal(day20.stage, "Statutory Deadline");
});
