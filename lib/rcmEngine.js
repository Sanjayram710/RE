/**
 * Reverse Charge Mechanism (RCM) Statutory Engine
 * 
 * Statutory References:
 * - CGST Act Section 9(3): Notified categories of supplies subject to reverse charge
 * - CGST Act Section 9(4): Supplies from unregistered persons to specified registered classes
 * - CGST Act Section 49(4) read with Section 2(82): Output tax specifically EXCLUDES RCM tax.
 *   Therefore, RCM liability CANNOT be paid using ITC. Must be paid 100% in CASH via ECL.
 * - CGST Act Section 31(3)(f): Mandatory self-invoicing for unregistered RCM inward supplies
 * - CGST Act Section 31(3)(g): Mandatory payment voucher to be issued at the time of payment
 * - Form GSTR-3B Table 3.1(d): Inward supplies liable to reverse charge (Liability)
 * - Form GSTR-3B Table 4(A)(3): Eligible ITC on RCM (Availed AFTER cash payment)
 * - CBIC Circular No. 170/02/2022-GST: Clarification on RCM reporting and subsequent ITC
 */

import { round2 } from './rule88aEngine.js';

export const NOTIFIED_RCM_CATEGORIES = [
  { code: 'GTA_5', name: 'Goods Transport Agency (GTA) @ 5% (without ITC to GTA)', defaultRate: 5, section: '9(3)' },
  { code: 'GTA_12', name: 'Goods Transport Agency (GTA) @ 12% (with ITC option)', defaultRate: 12, section: '9(3)' },
  { code: 'LEGAL', name: 'Services supplied by an Individual Advocate or Senior Advocate or firm of Advocates', defaultRate: 18, section: '9(3)' },
  { code: 'ARBITRAL', name: 'Services by an Arbitral Tribunal', defaultRate: 18, section: '9(3)' },
  { code: 'SPONSORSHIP', name: 'Sponsorship services to body corporate or partnership firm', defaultRate: 18, section: '9(3)' },
  { code: 'DIRECTOR', name: 'Services supplied by a director to the company', defaultRate: 18, section: '9(3)' },
  { code: 'INSURANCE_AGENT', name: 'Services supplied by an insurance agent to insurance company', defaultRate: 18, section: '9(3)' },
  { code: 'RECOVERY_AGENT', name: 'Services by recovery agent to banking company/FI/NBFC', defaultRate: 18, section: '9(3)' },
  { code: 'COPYRIGHT', name: 'Transfer or permitting the use of copyright (author, composer, artist)', defaultRate: 18, section: '9(3)' },
  { code: 'SECURITY', name: 'Security services (supply of security personnel) provided by non-body corporate to registered person', defaultRate: 18, section: '9(3)' },
  { code: 'RENTING_VEHICLE', name: 'Renting of motor vehicle designed to carry passengers provided to body corporate', defaultRate: 5, section: '9(3)' },
  { code: 'RESIDENTIAL_RENT', name: 'Renting of residential dwelling for commercial/business use to registered person', defaultRate: 18, section: '9(3)' }
];

/**
 * Validates non-negative amounts.
 */
function validatePositiveAmount(name, val) {
  const num = Number(val);
  if (isNaN(num)) throw new TypeError(`RCM Error: Amount '${name}' must be numeric.`);
  if (num < 0) throw new RangeError(`RCM Error: Amount '${name}' cannot be negative (got ${num}).`);
  return round2(num);
}

/**
 * Evaluates an inward supply for RCM applicability, cash liability and subsequent ITC eligibility.
 * @param {Object} supply Inward supply invoice / voucher
 * @returns {Object} Statutory RCM evaluation
 */
export function processRcmInwardSupply(supply = {}) {
  const isRcm = Boolean(supply.isRcm || supply.reverseCharge);
  const taxableValue = validatePositiveAmount('taxableValue', supply.taxableValue || supply.amount || 0);
  const rate = Number(supply.gstRate || supply.rate || 18);
  if (rate < 0 || isNaN(rate)) throw new RangeError(`Invalid GST rate: ${rate}`);

  const isInterstate = Boolean(
    supply.isInterstate ||
    (supply.pos && supply.supplierState && supply.pos !== supply.supplierState) ||
    (supply.pos && supply.recipientState && supply.pos !== supply.recipientState)
  );

  let igst = 0;
  let cgst = 0;
  let sgst = 0;

  if (isRcm && taxableValue > 0) {
    if (isInterstate) {
      igst = round2((taxableValue * rate) / 100);
    } else {
      cgst = round2((taxableValue * (rate / 2)) / 100);
      sgst = round2((taxableValue * (rate / 2)) / 100);
    }
  }

  const totalRcmTax = round2(igst + cgst + sgst);

  // Self-invoicing u/s 31(3)(f) check for supplies from unregistered persons
  const isUnregisteredSupplier = !supply.supplierGstin || supply.supplierGstin === 'URP' || supply.supplierGstin.trim().toUpperCase() === 'UNREGISTERED';
  const requiresSelfInvoice = isRcm && isUnregisteredSupplier;
  const selfInvoiceNumber = requiresSelfInvoice
    ? (supply.selfInvoiceNumber || `SLF-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`)
    : null;

  // Payment voucher u/s 31(3)(g)
  const paymentVoucherNumber = isRcm
    ? (supply.paymentVoucherNumber || `PV-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`)
    : null;

  // ITC Eligibility check under Section 16 & Section 17(5)
  // Even if paid in cash, if it is blocked under 17(5) (e.g. food, personal, motor vehicle hire for personal use), ITC is blocked
  const isBlockedCredit = Boolean(supply.isBlocked || supply.section17_5 || supply.blockedClause || (supply.itcEligibility && supply.itcEligibility.startsWith('BLOCKED')));
  const blockedClause = isBlockedCredit ? (supply.blockedClause || supply.itcEligibility || '17(5)(a)') : null;
  const itcEligible = isRcm && !isBlockedCredit;

  return {
    invoiceNumber: supply.invoiceNumber || supply.invNo || `RCM-INV-${Date.now()}`,
    invoiceDate: supply.invoiceDate || supply.date || new Date().toISOString().split('T')[0],
    supplierGstin: isUnregisteredSupplier ? 'UNREGISTERED' : (supply.supplierGstin || '').trim().toUpperCase(),
    category: supply.rcmCategory || 'GENERAL_RCM',
    isRcm,
    taxableValue,
    taxRate: rate,
    isInterstate,
    rcmTaxPayable: {
      igst,
      cgst,
      sgst,
      total: totalRcmTax
    },
    paymentConstraint: {
      mustPayInCashOnly: true,
      legalAuthority: 'CGST Act Section 49(4) read with Section 2(82) — Output tax excludes RCM liability. Electronic Credit Ledger CANNOT be debited for RCM.',
      reportingTableLiability: 'Form GSTR-3B Table 3.1(d)'
    },
    selfInvoicing: {
      required: requiresSelfInvoice,
      statutorySection: 'CGST Act Section 31(3)(f)',
      selfInvoiceNumber
    },
    paymentVoucher: {
      statutorySection: 'CGST Act Section 31(3)(g)',
      paymentVoucherNumber
    },
    subsequentItc: {
      eligible: itcEligible,
      blockedClause,
      reportingTableItc: 'Form GSTR-3B Table 4(A)(3)',
      condition: 'ITC can only be credited to Electronic Credit Ledger AFTER cash discharge in Table 3.1(d)',
      blockedReason: isBlockedCredit ? (supply.blockedReason || `Blocked under Section ${blockedClause}`) : null,
      eligibleAmount: itcEligible ? { igst, cgst, sgst, total: totalRcmTax } : { igst: 0, cgst: 0, sgst: 0, total: 0 }
    }
  };
}

/**
 * Batches and aggregates inward supplies for GSTR-3B Table 3.1(d) & Table 4(A)(3),
 * detecting duplicates and separating blocked credits.
 * @param {Array} inwardSupplies 
 * @returns {Object}
 */
export function aggregateRcmBatch(inwardSupplies = []) {
  let totalTaxable = 0;
  let totalIgst = 0;
  let totalCgst = 0;
  let totalSgst = 0;
  let totalEligibleItc = 0;
  let totalBlockedItc = 0;
  
  const processedItems = [];
  const duplicatesFound = [];
  const seenInvoices = new Set();

  for (const s of inwardSupplies) {
    const item = processRcmInwardSupply(s);
    if (!item.isRcm) continue;

    // Duplicate detection key: Supplier GSTIN + Invoice Number
    const dedupKey = `${item.supplierGstin}_${item.invoiceNumber}`;
    if (seenInvoices.has(dedupKey)) {
      duplicatesFound.push({
        supplierGstin: item.supplierGstin,
        invoiceNumber: item.invoiceNumber,
        warning: 'Duplicate inward invoice detected in same tax period.'
      });
      continue;
    }
    seenInvoices.add(dedupKey);

    processedItems.push(item);
    totalTaxable = round2(totalTaxable + item.taxableValue);
    totalIgst = round2(totalIgst + item.rcmTaxPayable.igst);
    totalCgst = round2(totalCgst + item.rcmTaxPayable.cgst);
    totalSgst = round2(totalSgst + item.rcmTaxPayable.sgst);

    if (item.subsequentItc.eligible) {
      totalEligibleItc = round2(totalEligibleItc + item.subsequentItc.eligibleAmount.total);
    } else {
      totalBlockedItc = round2(totalBlockedItc + item.rcmTaxPayable.total);
    }
  }

  const totalRcmCashRequired = round2(totalIgst + totalCgst + totalSgst);

  return {
    count: processedItems.length,
    duplicatesCount: duplicatesFound.length,
    duplicates: duplicatesFound,
    items: processedItems,
    gstr3bTable3_1_d: {
      description: 'Inward supplies (liable to reverse charge)',
      taxableValue: totalTaxable,
      igst: totalIgst,
      cgst: totalCgst,
      sgst: totalSgst,
      totalTax: totalRcmCashRequired,
      paymentMode: '100% ELECTRONIC CASH LEDGER ONLY'
    },
    gstr3bTable4_A_3: {
      description: 'ITC Available: Inward supplies liable to reverse charge',
      eligibleTotal: totalEligibleItc,
      blockedTotal: totalBlockedItc,
      precondition: 'Available for setoff ONLY after cash discharge of Table 3.1(d) liability'
    },
    statutoryWarning: totalRcmCashRequired > 0 
      ? `Mandatory: ₹${totalRcmCashRequired} RCM liability must be paid in cash via Challan PMT-06. Credit ledger balance cannot be used.`
      : 'No RCM cash liability for current period.'
  };
}
