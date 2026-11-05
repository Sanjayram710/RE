/**
 * Electronic Ledgers & PMT-06 Challan Engine
 * 
 * Statutory References:
 * - CGST Act Section 49: Payment of tax, interest, penalty and other amounts
 * - CGST Rule 85: Form GST PMT-01 — Electronic Liability Register (Part I & II)
 * - CGST Rule 86: Form GST PMT-02 — Electronic Credit Ledger
 * - CGST Rule 87: Form GST PMT-05 — Electronic Cash Ledger (Major/Minor 20 sub-heads)
 * - CGST Rule 87(2) & 87(3): Form GST PMT-06 — Challan generation (14-digit CPIN, 15-day validity)
 * - CGST Rule 87(4) Proviso: Over The Counter (OTC) cash deposit capped at ₹10,000 per challan per tax period
 * - CGST Rule 87(13): Form GST PMT-09 — Transfer of cash ledger amounts
 */

import crypto from 'node:crypto';
import { round2 } from './rule88aEngine.js';

export const MAJOR_HEADS = ['IGST', 'CGST', 'SGST', 'CESS'];
export const MINOR_HEADS = ['tax', 'interest', 'penalty', 'fee', 'other'];
export const STATUTORY_OTC_LIMIT = 10000; // ₹10,000 per challan per tax period under Rule 87(4)

/**
 * Creates a clean Form GST PMT-05 Cash Ledger structure.
 */
export function createEmptyCashLedger(gstin = '32ABCDE1234F1Z5') {
  const heads = {};
  for (const maj of MAJOR_HEADS) {
    heads[maj] = { tax: 0, interest: 0, penalty: 0, fee: 0, other: 0, total: 0 };
  }
  return {
    form: 'GST PMT-05',
    name: 'Electronic Cash Ledger',
    gstin,
    asOf: new Date().toISOString(),
    isSimulation: true,
    watermark: '[SIMULATION MODE — NOT LIVE GSTN LEDGER]',
    majorHeads: heads,
    grandTotal: 0
  };
}

/**
 * Creates a clean Form GST PMT-02 Credit Ledger structure.
 */
export function createEmptyCreditLedger(gstin = '32ABCDE1234F1Z5') {
  return {
    form: 'GST PMT-02',
    name: 'Electronic Credit Ledger',
    gstin,
    asOf: new Date().toISOString(),
    isSimulation: true,
    watermark: '[SIMULATION MODE — NOT LIVE GSTN LEDGER]',
    balances: {
      IGST: 0,
      CGST: 0,
      SGST: 0,
      CESS: 0,
      total: 0
    },
    restriction: 'Available strictly for discharge of OUTPUT TAX liability per Section 49(4)'
  };
}

/**
 * Generates a statutory Form GST PMT-06 Challan.
 * Produces a unique 14-digit CPIN with 15-day statutory validity.
 * Enforces Rule 87(4) OTC cash limit of ₹10,000.
 */
export function generatePmt06Challan(gstin, amounts = {}, mode = 'NET_BANKING', isSimulation = true) {
  // Mode validation
  const validModes = ['NET_BANKING', 'NEFT_RTGS', 'OVER_THE_COUNTER', 'UPI'];
  const paymentMode = validModes.includes(mode.toUpperCase()) ? mode.toUpperCase() : 'NET_BANKING';

  const majorBreakdown = {
    IGST: {
      tax: round2(amounts.igstTax || 0),
      interest: round2(amounts.igstInterest || 0),
      penalty: round2(amounts.igstPenalty || 0),
      fee: round2(amounts.igstFee || 0),
      other: round2(amounts.igstOther || 0)
    },
    CGST: {
      tax: round2(amounts.cgstTax || 0),
      interest: round2(amounts.cgstInterest || 0),
      penalty: round2(amounts.cgstPenalty || 0),
      fee: round2(amounts.cgstFee || 0),
      other: round2(amounts.cgstOther || 0)
    },
    SGST: {
      tax: round2(amounts.sgstTax || 0),
      interest: round2(amounts.sgstInterest || 0),
      penalty: round2(amounts.sgstPenalty || 0),
      fee: round2(amounts.sgstFee || 0),
      other: round2(amounts.sgstOther || 0)
    },
    CESS: {
      tax: round2(amounts.cessTax || 0),
      interest: round2(amounts.cessInterest || 0),
      penalty: 0,
      fee: 0,
      other: 0
    }
  };

  let totalChallanAmount = 0;
  for (const m of Object.keys(majorBreakdown)) {
    let subSum = 0;
    for (const min of MINOR_HEADS) {
      const val = majorBreakdown[m][min] || 0;
      if (val < 0) throw new RangeError(`Challan amount for ${m}-${min} cannot be negative.`);
      subSum = round2(subSum + val);
    }
    majorBreakdown[m].total = subSum;
    totalChallanAmount = round2(totalChallanAmount + subSum);
  }

  // Statutory Rule 87(4) Proviso Check: Over-the-counter payments cannot exceed ₹10,000
  if (paymentMode === 'OVER_THE_COUNTER' && totalChallanAmount > STATUTORY_OTC_LIMIT) {
    throw new Error(`Statutory Restriction (CGST Rule 87(4)): Over The Counter (cash/cheque) deposit is restricted to a maximum of ₹${STATUTORY_OTC_LIMIT.toLocaleString('en-IN')} per challan per tax period. Please select NEFT/RTGS or Net Banking for ₹${totalChallanAmount.toLocaleString('en-IN')}.`);
  }

  // Generate 14-digit CPIN: YYMM + 10 random digits
  const now = new Date();
  const prefix = now.toISOString().slice(2, 4) + ('0' + (now.getMonth() + 1)).slice(-2);
  const randomSuffix = Math.floor(1000000000 + Math.random() * 9000000000).toString();
  const cpin = `${prefix}${randomSuffix}`.slice(0, 14);

  const expiryDate = new Date(now.getTime() + (15 * 24 * 60 * 60 * 1000)); // 15 days statutory validity

  return {
    form: 'GST PMT-06',
    cpin,
    gstin: (gstin || '32ABCDE1234F1Z5').trim().toUpperCase(),
    generationDate: now.toISOString(),
    expiryDate: expiryDate.toISOString(),
    validityDays: 15,
    paymentMode,
    status: 'GENERATED_PENDING_PAYMENT',
    isSimulation,
    watermark: isSimulation ? '[SIMULATION MODE — NOT SUBMITTED TO BANK/GSTN]' : '[LIVE GSTN CHALLAN]',
    amounts: majorBreakdown,
    totalChallanAmount,
    statutoryRule: 'CGST Rule 87(2), 87(3) & 87(4)'
  };
}

/**
 * Simulates Form GST PMT-09: Transfer of cash amount between major/minor heads.
 * Strictly maintains zero-sum conservation of funds.
 */
export function executePmt09Transfer(cashLedger, transferRequest = {}) {
  const { fromMajor, fromMinor, toMajor, toMinor, amount } = transferRequest;
  const transferAmt = round2(amount);

  if (isNaN(transferAmt) || transferAmt <= 0) {
    throw new RangeError('PMT-09 Transfer Error: Transfer amount must be greater than zero.');
  }

  const fMaj = (fromMajor || '').toUpperCase();
  const tMaj = (toMajor || '').toUpperCase();
  const fMin = (fromMinor || '').toLowerCase();
  const tMin = (toMinor || '').toLowerCase();

  if (!MAJOR_HEADS.includes(fMaj) || !MAJOR_HEADS.includes(tMaj)) {
    throw new Error(`Invalid major head. Allowed: ${MAJOR_HEADS.join(', ')}`);
  }
  if (!MINOR_HEADS.includes(fMin) || !MINOR_HEADS.includes(tMin)) {
    throw new Error(`Invalid minor head. Allowed: ${MINOR_HEADS.join(', ')}`);
  }

  const currentAvailable = cashLedger.majorHeads[fMaj][fMin] || 0;
  if (currentAvailable < transferAmt) {
    throw new Error(`Insufficient balance in ${fMaj}-${fMin}. Available: ₹${currentAvailable}, Requested: ₹${transferAmt}`);
  }

  // Debit source head
  cashLedger.majorHeads[fMaj][fMin] = round2(currentAvailable - transferAmt);
  cashLedger.majorHeads[fMaj].total = round2((cashLedger.majorHeads[fMaj].total || currentAvailable) - transferAmt);

  // Credit target head
  const targetCurrent = cashLedger.majorHeads[tMaj][tMin] || 0;
  cashLedger.majorHeads[tMaj][tMin] = round2(targetCurrent + transferAmt);
  cashLedger.majorHeads[tMaj].total = round2((cashLedger.majorHeads[tMaj].total || targetCurrent) + transferAmt);

  return {
    form: 'GST PMT-09',
    arn: `PMT09-SIM-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
    isSimulation: true,
    watermark: '[SIMULATION MODE — NOT FILED ON GSTN COMMON PORTAL]',
    transferDetails: { fromMajor: fMaj, fromMinor: fMin, toMajor: tMaj, toMinor: tMin, amount: transferAmt },
    updatedCashLedger: cashLedger,
    timestamp: new Date().toISOString()
  };
}
