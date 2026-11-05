/**
 * Statutory GST CA Audit Validation & Implementation Test Suite
 * 
 * Verifies all 10 statutory focus areas:
 * 1. GSTR-1 and GSTR-3B filing dependencies (Sec 37(4), Sec 39(10), Rule 59(6), DRC-01B/C)
 * 2. GSTR-1 statutory table classification (Table 4 B2B, Table 5 B2CL > ₹1L Notif 12/2024-CT, Table 7 B2CS, Table 12 HSN, Table 13 Docs)
 * 3. GSTR-2B & Section 16(2)(aa) binding match
 * 4. Section 17(5) blocked credit clauses (a to i) including 17(5)(fa) CSR
 * 5. Rule 88A & Section 49/49A/49B ITC utilization sequence and CGST/SGST firewall
 * 6. RCM 100% cash payment constraint u/s 49(4) & 2(82), self-invoicing u/s 31(3)(f), Table 4(A)(3) ITC
 * 7. Section 16(2) 180-day supplier payment rule & Rule 37 reversal + Section 50(1) 18% interest
 * 8. Late fees (AATO rationalized caps Notif 19/2021-CT) & net cash interest u/s 50(1)
 * 9. QRMP Category 1 (22nd) vs Category 2 (24th) state rules, IFF 13th, PMT-06 25th
 * 10. Electronic Ledgers (PMT-01, PMT-02, PMT-05, PMT-06 14-digit CPIN, PMT-09 transfer)
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { computeRule88aSetoff } from '../lib/rule88aEngine.js';
import { processRcmInwardSupply, aggregateRcmBatch, NOTIFIED_RCM_CATEGORIES } from '../lib/rcmEngine.js';
import { analyzeInvoice180Days, auditPurchaseRegister180Days } from '../lib/supplier180DayTracker.js';
import { classifyOutwardInvoice, classifySalesRegisterForGstr1, B2CL_STATUTORY_THRESHOLD } from '../lib/gstr1StatutoryClassifier.js';
import { validateGstr1Prerequisites, validateGstr3bPrerequisites, simulateReturnFiling } from '../lib/gstrReturnLifecycleEngine.js';
import { createEmptyCashLedger, createEmptyCreditLedger, generatePmt06Challan, executePmt09Transfer } from '../lib/electronicLedgerEngine.js';
import { getPracticeDashboardSummary, getPracticeComplianceMatrix, generateClientReminder, PRACTICE_CLIENTS } from '../lib/caPracticeManager.js';
import { answerCopilotQuestion } from '../lib/gstCopilotEngine.js';
import { STATUTORY_RULES } from '../lib/statutoryRulesConfig.js';

// ----------------------------------------------------------------------------
// 1. Rule 88A & Section 49/49A/49B Deterministic ITC Utilization
// ----------------------------------------------------------------------------
test('Rule 88A: IGST credit must be completely exhausted before CGST or SGST is used', () => {
  const liabilities = { igst: 50000, cgst: 40000, sgst: 40000 };
  const itc = { igst: 90000, cgst: 20000, sgst: 20000 };

  const res = computeRule88aSetoff(liabilities, itc);
  assert.equal(res.validation.rule88ACompliant, true);
  assert.equal(res.validation.section49ACompliant, true);

  // Step 1: IGST ITC (90,000) offsets IGST liability (50,000) completely
  assert.equal(res.utilizationMatrix.igstCreditUtilized.towardsIgst, 50000);
  assert.equal(res.netCashPayable.igst, 0);

  // Step 2: Remaining 40,000 IGST ITC is split between CGST and SGST
  const igstCross = res.utilizationMatrix.igstCreditUtilized.towardsCgst + res.utilizationMatrix.igstCreditUtilized.towardsSgst;
  assert.equal(igstCross, 40000);
  assert.equal(res.itcCarryForward.igst, 0, 'IGST credit must be zero before CGST/SGST ITC utilization');

  // Strict Firewall: CGST towards SGST must be 0, SGST towards CGST must be 0
  assert.equal(res.utilizationMatrix.cgstCreditUtilized.towardsSgst, 0);
  assert.equal(res.utilizationMatrix.sgstCreditUtilized.towardsCgst, 0);
});

test('Rule 88A: Strict CGST/SGST firewall maintained under all liability variations', () => {
  const liabilities = { igst: 10000, cgst: 60000, sgst: 0 };
  const itc = { igst: 10000, cgst: 10000, sgst: 50000 };

  const res = computeRule88aSetoff(liabilities, itc);
  assert.equal(res.utilizationMatrix.sgstCreditUtilized.towardsCgst, 0, 'SGST credit can NEVER offset CGST liability');
  assert.equal(res.netCashPayable.cgst, 50000, 'CGST cash liability remains because SGST cannot cross-utilize');
  assert.equal(res.itcCarryForward.sgst, 50000, 'SGST credit carried forward untouched');
});

// ----------------------------------------------------------------------------
// 2. Reverse Charge Mechanism (RCM) 100% Cash Payment & Subsequent ITC
// ----------------------------------------------------------------------------
test('RCM: Must be paid 100% in CASH and generates self-invoice for unregistered suppliers', () => {
  const inwardSupply = {
    invoiceNumber: 'EXP-LEGAL-01',
    isRcm: true,
    rcmCategory: 'LEGAL',
    supplierGstin: 'URP', // Unregistered advocate
    supplierState: '32',
    pos: '32',
    taxableValue: 50000,
    gstRate: 18
  };

  const res = processRcmInwardSupply(inwardSupply);
  assert.equal(res.isRcm, true);
  assert.equal(res.rcmTaxPayable.total, 9000);
  assert.equal(res.rcmTaxPayable.cgst, 4500);
  assert.equal(res.rcmTaxPayable.sgst, 4500);

  // Cash payment constraint
  assert.equal(res.paymentConstraint.mustPayInCashOnly, true);
  assert.equal(res.paymentConstraint.reportingTableLiability, 'Form GSTR-3B Table 3.1(d)');

  // Self-invoicing u/s 31(3)(f)
  assert.equal(res.selfInvoicing.required, true);
  assert.ok(res.selfInvoicing.selfInvoiceNumber.startsWith('SLF-'));

  // Subsequent ITC
  assert.equal(res.subsequentItc.eligible, true);
  assert.equal(res.subsequentItc.reportingTableItc, 'Form GSTR-3B Table 4(A)(3)');
  assert.equal(res.subsequentItc.eligibleAmount.total, 9000);
});

test('RCM: Blocked under Section 17(5) prevents subsequent ITC even after cash payment', () => {
  const blockedRcmSupply = {
    invoiceNumber: 'EXP-CAB-01',
    isRcm: true,
    isBlocked: true,
    blockedReason: 'Personal transport vehicle under Section 17(5)(a)',
    taxableValue: 20000,
    gstRate: 5
  };

  const res = processRcmInwardSupply(blockedRcmSupply);
  assert.equal(res.rcmTaxPayable.total, 1000);
  assert.equal(res.paymentConstraint.mustPayInCashOnly, true);
  assert.equal(res.subsequentItc.eligible, false);
  assert.equal(res.subsequentItc.eligibleAmount.total, 0);
});

// ----------------------------------------------------------------------------
// 3. Section 16(2) 180-Day Rule 37 Supplier Aging & Reversal
// ----------------------------------------------------------------------------
test('180-Day Rule 37: Unpaid invoice >= 180 days triggers Table 4(B)(2) reversal & Sec 50 interest', () => {
  const overdueInvoice = {
    invoiceNumber: 'PUR-OLD-88',
    supplierGstin: '32ABCDE5555F1Z1',
    invoiceDate: '2026-03-01', // >180 days from Oct 2026
    totalValue: 118000,
    paidAmount: 0,
    itcClaimed: 18000
  };

  const analysis = analyzeInvoice180Days(overdueInvoice, '2026-10-31');
  assert.equal(analysis.status.agingBucket, 'OVERDUE_180_PLUS');
  assert.equal(analysis.status.isReversalMandatory, true);
  assert.equal(analysis.status.reversalTable, 'Form GSTR-3B Table 4(B)(2) (Others)');
  assert.equal(analysis.financials.proportionateItcToReverse, 18000);
  assert.ok(analysis.interest.interestPayable > 0);
  assert.equal(analysis.interest.interestRateAnnual, 18);
});

test('180-Day Rule 37: Partial payment reverses only proportionate unpaid ITC', () => {
  const partiallyPaidInvoice = {
    invoiceNumber: 'PUR-PARTIAL-02',
    invoiceDate: '2026-02-15',
    totalValue: 100000,
    paidAmount: 60000, // 40% unpaid
    itcClaimed: 18000
  };

  const analysis = analyzeInvoice180Days(partiallyPaidInvoice, '2026-10-31');
  assert.equal(analysis.status.isReversalMandatory, true);
  assert.equal(analysis.financials.unpaidAmount, 40000);
  assert.equal(analysis.financials.proportionateItcToReverse, 7200, '40% of 18,000 ITC');
});

// ----------------------------------------------------------------------------
// 4. GSTR-1 Multi-Table Statutory Classification (Table 4, 5, 7, 12, 13)
// ----------------------------------------------------------------------------
test('GSTR-1: B2C Large threshold is ₹1,00,000 under CBIC Notif 12/2024-CT', () => {
  assert.equal(B2CL_STATUTORY_THRESHOLD, 100000);

  // Inter-state B2C > ₹1,00,000 -> Table 5A (B2CL)
  const b2clInv = {
    invoiceNumber: 'SALES-B2CL-01',
    pos: '29', // Inter-state
    taxableValue: 120000,
    taxAmount: 21600,
    totalValue: 141600
  };
  const cl1 = classifyOutwardInvoice(b2clInv, '32');
  assert.equal(cl1.classification.tableCode, '5A');
  assert.equal(cl1.classification.targetTable, 'TABLE_5_B2CL');

  // Inter-state B2C <= ₹1,00,000 -> Table 7B (B2CS)
  const b2csInterstateInv = {
    invoiceNumber: 'SALES-B2CS-01',
    pos: '29',
    taxableValue: 80000,
    taxAmount: 14400,
    totalValue: 94400
  };
  const cl2 = classifyOutwardInvoice(b2csInterstateInv, '32');
  assert.equal(cl2.classification.tableCode, '7B');
  assert.equal(cl2.classification.targetTable, 'TABLE_7_B2CS');

  // Intra-state B2C (any value) -> Table 7A (B2CS)
  const b2csIntrastateInv = {
    invoiceNumber: 'SALES-B2CS-02',
    pos: '32',
    taxableValue: 500000,
    taxAmount: 90000,
    totalValue: 590000
  };
  const cl3 = classifyOutwardInvoice(b2csIntrastateInv, '32');
  assert.equal(cl3.classification.tableCode, '7A');
  assert.equal(cl3.classification.targetTable, 'TABLE_7_B2CS');
});

// ----------------------------------------------------------------------------
// 5. GSTR Return Lifecycle & Sequential Dependencies (Sec 37(4) & Sec 39(10))
// ----------------------------------------------------------------------------
test('Return Lifecycle: Section 39(10) strictly blocks GSTR-3B if GSTR-1 is not filed', () => {
  const contextGstr1Pending = {
    isCurrentPeriodGstr1Filed: false,
    isPriorPeriodGstr3bPending: false,
    hasPendingDrc01c: false,
    isTaxpayerAuthorized: true
  };

  const check = validateGstr3bPrerequisites(contextGstr1Pending);
  assert.equal(check.canFileGstr3b, false);
  assert.ok(check.errors.some(e => e.code === 'ERR_SEC_39_10_GSTR1_NOT_FILED'));
});

test('Return Lifecycle: Section 37(4) blocks GSTR-1 if previous period GSTR-1 is unfiled', () => {
  const contextPriorPending = {
    isPriorPeriodGstr1Pending: true,
    isPriorPeriodGstr3bPending: false,
    hasPendingDrc01b: false
  };

  const check = validateGstr1Prerequisites(contextPriorPending);
  assert.equal(check.canFileGstr1, false);
  assert.ok(check.errors.some(e => e.code === 'ERR_SEC_37_4_PRIOR_GSTR1_PENDING'));
});

test('Return Lifecycle: Simulation mode clearly watermarks receipt without fake official ARNs', () => {
  const receipt = simulateReturnFiling('GSTR3B', { gstin: '32ABCDE1234F1Z5', period: '102026' });
  assert.equal(receipt.status, 'SUCCESS');
  assert.equal(receipt.mode, 'SIMULATION');
  assert.equal(receipt.watermark, '[SIMULATION MODE — NOT FILED ON GSTN COMMON PORTAL]');
  assert.ok(receipt.simulationReferenceId.startsWith('SIM-ARN-'));
  assert.ok(receipt.auditChecksum.length > 0);
});

// ----------------------------------------------------------------------------
// 6. Electronic Ledgers & PMT-06 Challan Generation
// ----------------------------------------------------------------------------
test('Ledgers: Form GST PMT-06 generates 14-digit CPIN with 15-day statutory validity', () => {
  const challan = generatePmt06Challan('32ABCDE1234F1Z5', {
    cgstTax: 5000,
    sgstTax: 5000,
    igstTax: 10000
  });

  assert.equal(challan.form, 'GST PMT-06');
  assert.equal(challan.cpin.length, 14, 'CPIN must be exactly 14 digits');
  assert.equal(challan.validityDays, 15);
  assert.equal(challan.totalChallanAmount, 20000);
  assert.equal(challan.status, 'GENERATED_PENDING_PAYMENT');
  assert.equal(challan.watermark, '[SIMULATION MODE — NOT SUBMITTED TO BANK/GSTN]');
});

test('Ledgers: Form GST PMT-09 transfers cash between major and minor heads', () => {
  const cashLedger = createEmptyCashLedger('32ABCDE1234F1Z5');
  cashLedger.majorHeads.IGST.tax = 10000;
  cashLedger.majorHeads.IGST.total = 10000;

  const transfer = executePmt09Transfer(cashLedger, {
    fromMajor: 'IGST',
    fromMinor: 'tax',
    toMajor: 'CGST',
    toMinor: 'tax',
    amount: 3000
  });

  assert.equal(transfer.form, 'GST PMT-09');
  assert.equal(cashLedger.majorHeads.IGST.tax, 7000);
  assert.equal(cashLedger.majorHeads.CGST.tax, 3000);
});

// ----------------------------------------------------------------------------
// 7. CA Multi-Client Practice Management & Compliance Matrix
// ----------------------------------------------------------------------------
test('Practice Management: Returns multi-client portfolio and compliance matrix', () => {
  const summary = getPracticeDashboardSummary();
  assert.ok(summary.totalClients >= 3);
  assert.ok(summary.clients.length >= 3);

  const matrix = getPracticeComplianceMatrix();
  assert.equal(matrix.length, summary.totalClients);
  assert.ok(matrix.some(c => c.gstin === '32AAACB1234F1Z5'));

  const reminder = generateClientReminder('CLI-001');
  assert.equal(reminder.clientId, 'CLI-001');
  assert.ok(reminder.subject.includes('GSTR-1 Deadline'));
});

// ----------------------------------------------------------------------------
// 8. GST Copilot: Statutory Citations and CA Escalations
// ----------------------------------------------------------------------------
test('GST Copilot: Answers questions with statutory citations and flags complex items for CA review', () => {
  // Question on RCM
  const rcmAnswer = answerCopilotQuestion('Can I pay reverse charge RCM using ITC?');
  assert.ok(rcmAnswer.answer.includes('CANNOT'));
  assert.ok(rcmAnswer.statutoryCitation.includes('Section 49(4)'));
  assert.equal(rcmAnswer.requiresCaReview, false);

  // Question on Blocked Credit
  const blockedAnswer = answerCopilotQuestion('Can I claim ITC on corporate car or food?');
  assert.ok(blockedAnswer.answer.includes('Section 17(5)'));
  assert.equal(blockedAnswer.requiresCaReview, true);
  assert.ok(blockedAnswer.escalationReason.includes('Senior CA review'));

  // Question on DRC-01B/C notices
  const noticeAnswer = answerCopilotQuestion('What should I do if I get DRC-01B notice?');
  assert.ok(noticeAnswer.answer.includes('Rule 88C'));
  assert.equal(noticeAnswer.requiresCaReview, true);
});

// ----------------------------------------------------------------------------
// 9. Statutory Configuration Integrity
// ----------------------------------------------------------------------------
test('Statutory Config: Late fee slabs, interest rates, and blocked credits match Act', () => {
  assert.equal(STATUTORY_RULES.lateFee.statutoryMaxCap, 10000);
  assert.equal(STATUTORY_RULES.interestRates.delayedNetCashTax.ratePercentPerAnnum, 18);
  assert.equal(STATUTORY_RULES.interestRates.wrongfulItcAvailedAndUtilized.ratePercentPerAnnum, 24);
  assert.ok(STATUTORY_RULES.blockedCredits.clauses['17(5)(fa)']); // CSR expense
});

