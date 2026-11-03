import { test } from "node:test";
import assert from "node:assert/strict";

import { validateCin, lookupMcaCompany } from "../lib/mcaEngine.js";
import { calculateComplianceScore } from "../lib/complianceScoreEngine.js";
import { getStatutoryDueDates, generateNotificationPayload } from "../lib/dueDateEngine.js";
import { getOrCreateReferralCode, redeemReferralCredit } from "../lib/referralEngine.js";
import { validateStartupApplication, BUSINESS_TYPES } from "../lib/startupExpressEngine.js";
import { getCopilotPipelineData, answerCopilotQuestion } from "../lib/gstCopilotEngine.js";

test("MCA Engine: Validates 21-character CIN and handles registry lookup", () => {
  // Invalid CIN lengths and formats
  assert.equal(validateCin("").valid, false);
  assert.equal(validateCin("U72900KA2020PTC").valid, false);
  assert.equal(validateCin("123456789012345678901").valid, false);

  // Valid CIN
  const valid = validateCin("U72900KA2020PTC123456");
  assert.equal(valid.valid, true);
  assert.equal(valid.metadata.listingStatus, "Unlisted");
  assert.equal(valid.metadata.stateCode, "KA");
  assert.equal(valid.metadata.incorporationYear, 2020);
  assert.equal(valid.metadata.companyType, "PTC");

  // Registry lookup
  const lookup = lookupMcaCompany("U72900KA2020PTC123456");
  assert.equal(lookup.success, true);
  assert.equal(lookup.company.companyName, "MALABAR TECH SOLUTIONS PRIVATE LIMITED");
  assert.equal(lookup.company.directors.length, 2);
  assert.equal(lookup.company.complianceStatus, "ACTIVE");
});

test("Compliance Score Engine: Computes 0–100 weighted index with RAG traffic light", () => {
  // Perfect compliance
  const perfect = calculateComplianceScore({
    gstinStatus: "ACTIVE",
    gstr1Filed: true,
    gstr3bFiled: true,
    itcMismatchesCount: 0,
    delinquentVendorsCount: 0,
    taxPaidOnTime: true,
    panAadhaarLinked: true
  });
  assert.equal(perfect.score, 100);
  assert.equal(perfect.rating, "EXCELLENT");
  assert.equal(perfect.badgeColor, "GREEN");

  // Critical state with suspended GST and unfiled returns
  const critical = calculateComplianceScore({
    gstinStatus: "CANCELLED",
    gstr1Filed: false,
    gstr3bFiled: false,
    itcMismatchesCount: 5,
    delinquentVendorsCount: 3,
    taxPaidOnTime: false,
    panAadhaarLinked: false
  });
  assert.ok(critical.score < 20);
  assert.equal(critical.badgeColor, "RED");
  assert.ok(critical.recommendations.length > 0);
});

test("Due Date Engine: Computes statutory countdowns and multi-channel notification templates", () => {
  const deadlines = getStatutoryDueDates(new Date("2026-11-03T12:00:00Z"));
  assert.ok(deadlines.length >= 4);

  const gstr1 = deadlines.find(d => d.form === "GSTR-1");
  assert.ok(gstr1);
  assert.ok(gstr1.daysRemaining >= 8);

  // Notification payloads
  const wa = generateNotificationPayload({ channel: "whatsapp" });
  assert.equal(wa.channel, "WHATSAPP");
  assert.ok(wa.header.includes("SimpleGST"));
  assert.ok(wa.body.includes("GSTR-3B"));

  const sms = generateNotificationPayload({ channel: "sms" });
  assert.equal(sms.channel, "SMS");
  assert.ok(sms.message.includes("GSTR-3B"));

  const email = generateNotificationPayload({ channel: "email" });
  assert.equal(email.channel, "EMAIL");
  assert.ok(email.bodyHtml.includes("Statutory Due Date"));
});

test("Referral Engine: Generates referral code, tracks wallet credits and permits redemption", () => {
  const ref = getOrCreateReferralCode("32ABCDE1234F1Z5", "Malabar Spice Traders");
  assert.equal(ref.success, true);
  assert.ok(ref.shareUrl.includes("ABCDE500"));
  assert.ok(ref.walletBalance >= 500);

  // Redeem credit
  const redeem = redeemReferralCredit(ref.code, 200);
  assert.equal(redeem.success, true);
  assert.equal(redeem.redeemed, 200);
});

test("Startup Express: Validates entity constitution, PAN compatibility, and generates ARN", () => {
  assert.ok(BUSINESS_TYPES.length >= 4);

  // Invalid PAN entity match (Proprietorship requires 4th char 'P', but passing Company 'C')
  const mismatch = validateStartupApplication({
    businessType: "proprietorship",
    businessName: "Green Spice Retail",
    ownerName: "Sunil Kumar",
    pan: "AAPCS1234F", // 4th char is C
    pincode: "682001"
  });
  assert.equal(mismatch.success, false);
  assert.ok(mismatch.errors[0].includes("mismatch"));

  // Valid Proprietorship (4th char is 'P' for Person/Individual)
  const validProp = validateStartupApplication({
    businessType: "proprietorship",
    businessName: "Green Spice Retail",
    ownerName: "Sunil Kumar",
    pan: "ABCPS1234F", // 4th char is P
    pincode: "682001"
  });
  assert.equal(validProp.success, true);
  assert.ok(validProp.application.provisionalArn.startsWith("AA321126"));
  assert.equal(validProp.application.firstInvoice.invoiceNumber, "INV-001");
});

test("GST Copilot Engine: Generates 5-step plain-English pipeline and handles AI Q&A", () => {
  const pipeline = getCopilotPipelineData("102026");
  assert.equal(pipeline.steps.length, 5);
  assert.equal(pipeline.steps[0].step, 1);
  assert.ok(pipeline.steps[0].plainSentence.includes("sales"));
  assert.equal(pipeline.steps[4].step, 5);

  // Q&A
  const q1 = answerCopilotQuestion("Do I need to file this month?");
  assert.ok(q1.answer.includes("mandatory"));

  const q2 = answerCopilotQuestion("What is my next GST deadline?");
  assert.ok(q2.answer.includes("November 11th"));

  const q3 = answerCopilotQuestion("Why is my ITC different?");
  assert.ok(q3.answer.includes("GSTR-2B"));
});
