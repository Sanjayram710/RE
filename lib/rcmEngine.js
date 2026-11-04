/**
 * Reverse Charge Mechanism (RCM) Statutory Engine
 * 
 * Statutory References:
 * - CGST Act Section 9(3): Notified categories of supplies subject to reverse charge
 * - CGST Act Section 9(4): Supplies from unregistered persons to registered class
 * - CGST Act Section 49(4) read with Section 2(82): RCM tax CANNOT be paid using ITC.
 *   Must be paid 100% in cash via Electronic Cash Ledger.
 * - CGST Act Section 31(3)(f): Mandatory self-invoicing for unregistered RCM inward supplies
 * - CGST Act Section 31(3)(g): Mandatory payment voucher
 * - Form GSTR-3B Table 3.1(d): Inward supplies liable to reverse charge (Liability)
 * - Form GSTR-3B Table 4(A)(3): Eligible ITC on RCM (Availed AFTER cash payment)
 * - CBIC Circular No. 170/02/2022-GST: Clarification on RCM reporting in GSTR-3B
 */

export const NOTIFIED_RCM_CATEGORIES = [
  { code: 'GTA', name: 'Goods Transport Agency (GTA) services', defaultRate: 5, section: '9(3)' },
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

function round2(val) {
  return Math.round((Number(val) || 0) * 100) / 100;
}

/**
 * Evaluates an inward supply for RCM applicability, cash liability and subsequent ITC eligibility.
 * @param {Object} supply Inward supply invoice / voucher
 * @returns {Object} Statutory RCM evaluation
 */
export function processRcmInwardSupply(supply) {
  const isRcm = Boolean(supply.isRcm || supply.reverseCharge);
  const taxableValue = round2(supply.taxableValue || supply.amount || 0);
  const rate = Number(supply.gstRate || supply.rate || 18);
  const isInterstate = Boolean(supply.isInterstate || (supply.pos && supply.supplierState && supply.pos !== supply.supplierState));

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

  const requiresSelfInvoice = isRcm && (!supply.supplierGstin || supply.supplierGstin === 'URP');
  const selfInvoiceNumber = requiresSelfInvoice
    ? (supply.selfInvoiceNumber || `SLF-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`)
    : null;

  const isBlockedCredit = Boolean(supply.isBlocked || supply.section17_5);
  const itcEligible = isRcm && !isBlockedCredit;

  return {
    invoiceNumber: supply.invoiceNumber || supply.invNo,
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
    subsequentItc: {
      eligible: itcEligible,
      reportingTableItc: 'Form GSTR-3B Table 4(A)(3)',
      condition: 'ITC can only be credited to Electronic Credit Ledger AFTER cash discharge in Table 3.1(d)',
      blockedReason: isBlockedCredit ? (supply.blockedReason || 'Blocked under Section 17(5)') : null,
      eligibleAmount: itcEligible ? { igst, cgst, sgst, total: totalRcmTax } : { igst: 0, cgst: 0, sgst: 0, total: 0 }
    }
  };
}

/**
 * Aggregates all RCM inward supplies for GSTR-3B Table 3.1(d) & Table 4(A)(3).
 * @param {Array} inwardSupplies 
 * @returns {Object}
 */
export function aggregateRcmBatch(inwardSupplies = []) {
  let totalTaxable = 0;
  let totalIgst = 0;
  let totalCgst = 0;
  let totalSgst = 0;
  let totalEligibleItc = 0;
  const processedItems = [];

  for (const s of inwardSupplies) {
    const item = processRcmInwardSupply(s);
    if (item.isRcm) {
      processedItems.push(item);
      totalTaxable = round2(totalTaxable + item.taxableValue);
      totalIgst = round2(totalIgst + item.rcmTaxPayable.igst);
      totalCgst = round2(totalCgst + item.rcmTaxPayable.cgst);
      totalSgst = round2(totalSgst + item.rcmTaxPayable.sgst);
      totalEligibleItc = round2(totalEligibleItc + item.subsequentItc.eligibleAmount.total);
    }
  }

  const totalRcmCashRequired = round2(totalIgst + totalCgst + totalSgst);

  return {
    count: processedItems.length,
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
      precondition: 'Available for setoff ONLY after cash discharge of Table 3.1(d) liability'
    },
    statutoryWarning: totalRcmCashRequired > 0 
      ? `Mandatory: ₹${totalRcmCashRequired} RCM liability must be paid in cash via Challan PMT-06. Credit ledger balance cannot be used.`
      : 'No RCM cash liability for current period.'
  };
}
