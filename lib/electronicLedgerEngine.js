/**
 * Electronic Ledgers & PMT-06 Challan Engine
 * 
 * Statutory References:
 * - CGST Act Section 49: Payment of tax, interest, penalty and other amounts
 * - CGST Rule 85: Form GST PMT-01 — Electronic Liability Register (Part I & II)
 * - CGST Rule 86: Form GST PMT-02 — Electronic Credit Ledger
 * - CGST Rule 87: Form GST PMT-05 — Electronic Cash Ledger (Major/Minor 20 sub-heads)
 * - CGST Rule 87(2) & 87(3): Form GST PMT-06 — Challan generation (14-digit CPIN, 15-day validity)
 * - CGST Rule 87(13): Form GST PMT-09 — Transfer of cash ledger amounts
 */

import crypto from 'node:crypto';

function round2(val) {
  return Math.round((Number(val) || 0) * 100) / 100;
}

export const MAJOR_HEADS = ['IGST', 'CGST', 'SGST', 'CESS'];
export const MINOR_HEADS = ['tax', 'interest', 'penalty', 'fee', 'other'];

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
 */
export function generatePmt06Challan(gstin, amounts, mode = 'NET_BANKING', isSimulation = true) {
  const prefix = new Date().toISOString().slice(2, 4) + ('0' + (new Date().getMonth() + 1)).slice(-2);
  const randomSuffix = Math.floor(1000000000 + Math.random() * 9000000000).toString();
  const cpin = `${prefix}${randomSuffix}`.slice(0, 14);

  const creationDate = new Date();
  const expiryDate = new Date(creationDate.getTime() + (15 * 24 * 60 * 60 * 1000));

  const majorBreakdown = {
    IGST: { tax: round2(amounts.igstTax || 0), interest: round2(amounts.igstInterest || 0), fee: round2(amounts.igstFee || 0) },
    CGST: { tax: round2(amounts.cgstTax || 0), interest: round2(amounts.cgstInterest || 0), fee: round2(amounts.cgstFee || 0) },
    SGST: { tax: round2(amounts.sgstTax || 0), interest: round2(amounts.sgstInterest || 0), fee: round2(amounts.sgstFee || 0) },
    CESS: { tax: round2(amounts.cessTax || 0), interest: 0, fee: 0 }
  };

  let totalChallanAmount = 0;
  for (const m of Object.keys(majorBreakdown)) {
    const sum = majorBreakdown[m].tax + majorBreakdown[m].interest + majorBreakdown[m].fee;
    totalChallanAmount = round2(totalChallanAmount + sum);
  }

  return {
    form: 'GST PMT-06',
    cpin,
    gstin,
    generationDate: creationDate.toISOString(),
    expiryDate: expiryDate.toISOString(),
    validityDays: 15,
    paymentMode: mode,
    status: 'GENERATED_PENDING_PAYMENT',
    isSimulation,
    watermark: isSimulation ? '[SIMULATION MODE — NOT SUBMITTED TO BANK/GSTN]' : '[LIVE GSTN CHALLAN]',
    amounts: majorBreakdown,
    totalChallanAmount,
    statutoryRule: 'CGST Rule 87(2) & 87(3)'
  };
}

/**
 * Simulates Form GST PMT-09: Transfer of cash amount between major/minor heads.
 */
export function executePmt09Transfer(cashLedger, transferRequest) {
  const { fromMajor, fromMinor, toMajor, toMinor, amount } = transferRequest;
  const transferAmt = round2(amount);

  if (!MAJOR_HEADS.includes(fromMajor) || !MAJOR_HEADS.includes(toMajor)) {
    throw new Error(`Invalid major head. Allowed: ${MAJOR_HEADS.join(', ')}`);
  }
  if (!MINOR_HEADS.includes(fromMinor) || !MINOR_HEADS.includes(toMinor)) {
    throw new Error(`Invalid minor head. Allowed: ${MINOR_HEADS.join(', ')}`);
  }

  const currentAvailable = cashLedger.majorHeads[fromMajor][fromMinor] || 0;
  if (currentAvailable < transferAmt) {
    throw new Error(`Insufficient balance in ${fromMajor}-${fromMinor}. Available: ₹${currentAvailable}, Requested: ₹${transferAmt}`);
  }

  cashLedger.majorHeads[fromMajor][fromMinor] = round2(currentAvailable - transferAmt);
  cashLedger.majorHeads[fromMajor].total = round2(cashLedger.majorHeads[fromMajor].total - transferAmt);

  const targetCurrent = cashLedger.majorHeads[toMajor][toMinor] || 0;
  cashLedger.majorHeads[toMajor][toMinor] = round2(targetCurrent + transferAmt);
  cashLedger.majorHeads[toMajor].total = round2(cashLedger.majorHeads[toMajor].total + transferAmt);

  return {
    form: 'GST PMT-09',
    arn: `PMT09-SIM-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
    transferDetails: { fromMajor, fromMinor, toMajor, toMinor, amount: transferAmt },
    updatedCashLedger: cashLedger,
    timestamp: new Date().toISOString()
  };
}
