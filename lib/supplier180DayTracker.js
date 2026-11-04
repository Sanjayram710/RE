/**
 * Section 16(2) 180-Day Supplier Payment & Rule 37 Tracking Engine
 * 
 * Statutory References:
 * - Second Proviso to CGST Act Section 16(2): Mandatory reversal of ITC if consideration + tax
 *   is not paid to supplier within 180 days from invoice date.
 * - Third Proviso to CGST Act Section 16(2): Entitlement to re-avail ITC upon subsequent payment.
 * - CGST Rule 37 (amended w.e.f. 01-10-2022 via Notif 19/2022-CT): Proportionate reversal of ITC
 *   in Form GSTR-3B Table 4(B)(2) along with interest u/s 50(1) @ 18% p.a.
 * - Form GSTR-3B Table 4(D)(1): Re-claimed ITC (exempt from Section 16(4) time limit).
 */

function round2(val) {
  return Math.round((Number(val) || 0) * 100) / 100;
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Computes exact days elapsed between invoice date and as-of audit date.
 */
export function getDaysElapsed(invoiceDateStr, asOfDateStr) {
  const invDate = new Date(invoiceDateStr);
  const asOf = asOfDateStr ? new Date(asOfDateStr) : new Date();
  if (isNaN(invDate.getTime())) return 0;
  const diffTime = asOf.getTime() - invDate.getTime();
  return Math.max(0, Math.floor(diffTime / MS_PER_DAY));
}

/**
 * Analyzes an individual purchase invoice under Rule 37.
 * @param {Object} invoice 
 * @param {string} [asOfDate] Optional comparison date (default current date)
 * @returns {Object} Aging classification, reversal obligation, and interest.
 */
export function analyzeInvoice180Days(invoice, asOfDate) {
  const invDate = invoice.invoiceDate || invoice.date;
  const daysElapsed = getDaysElapsed(invDate, asOfDate);
  const invoiceValue = round2(invoice.totalValue || invoice.invoiceValue || ((invoice.taxableValue || 0) + (invoice.taxAmount || 0)));
  const paidAmount = round2(invoice.paidAmount || (invoice.isPaid ? invoiceValue : 0));
  const unpaidAmount = round2(Math.max(0, invoiceValue - paidAmount));
  const totalItc = round2(invoice.itcClaimed || invoice.taxAmount || 0);

  const unpaidRatio = invoiceValue > 0 ? unpaidAmount / invoiceValue : 0;
  const proportionateItcToReverse = round2(totalItc * unpaidRatio);

  let agingBucket = 'CURRENT_0_90';
  let isReversalMandatory = false;
  let interestDays = 0;
  let interestPayable = 0;

  if (unpaidAmount > 0) {
    if (daysElapsed >= 180) {
      agingBucket = 'OVERDUE_180_PLUS';
      isReversalMandatory = true;
      interestDays = daysElapsed - 180;
      const ratePerDay = (18 / 100) / 365;
      interestPayable = round2(proportionateItcToReverse * ratePerDay * Math.max(1, interestDays));
    } else if (daysElapsed >= 151) {
      agingBucket = 'CRITICAL_151_179';
    } else if (daysElapsed >= 91) {
      agingBucket = 'WATCHLIST_91_150';
    } else {
      agingBucket = 'CURRENT_0_90';
    }
  } else {
    agingBucket = 'FULLY_PAID';
  }

  return {
    invoiceNumber: invoice.invoiceNumber || invoice.invNo,
    supplierGstin: invoice.supplierGstin || invoice.gstin,
    supplierName: invoice.supplierName || 'Supplier',
    invoiceDate: invDate,
    asOfDate: asOfDate || new Date().toISOString().split('T')[0],
    daysElapsed,
    daysRemaining: Math.max(0, 180 - daysElapsed),
    financials: {
      totalInvoiceValue: invoiceValue,
      paidAmount,
      unpaidAmount,
      totalItcClaimed: totalItc,
      proportionateItcToReverse: isReversalMandatory ? proportionateItcToReverse : 0
    },
    status: {
      agingBucket,
      isReversalMandatory,
      reversalTable: isReversalMandatory ? 'Form GSTR-3B Table 4(B)(2) (Others)' : null,
      reclaimTableUponPayment: 'Form GSTR-3B Table 4(A)(5) & Table 4(D)(1)',
      reclaimExemptFromSec16_4: true
    },
    interest: {
      interestDays,
      interestRateAnnual: 18,
      statutorySection: 'CGST Act Section 50(1) read with Rule 37(1)',
      interestPayable
    }
  };
}

/**
 * Batches and aggregates multiple purchase invoices for 180-day Rule 37 compliance dashboard.
 * @param {Array} invoices 
 * @param {string} [asOfDate]
 * @returns {Object}
 */
export function auditPurchaseRegister180Days(invoices = [], asOfDate) {
  const results = {
    summary: {
      totalInvoicesChecked: invoices.length,
      current0To90Count: 0,
      watchlist91To150Count: 0,
      critical151To179Count: 0,
      overdue180PlusCount: 0,
      fullyPaidCount: 0,
      totalItcAtRisk: 0,
      totalMandatoryItcReversal: 0,
      totalSection50Interest: 0
    },
    buckets: {
      current0To90: [],
      watchlist91To150: [],
      critical151To179: [],
      overdue180Plus: [],
      fullyPaid: []
    }
  };

  for (const inv of invoices) {
    const analysis = analyzeInvoice180Days(inv, asOfDate);
    switch (analysis.status.agingBucket) {
      case 'OVERDUE_180_PLUS':
        results.summary.overdue180PlusCount++;
        results.summary.totalMandatoryItcReversal = round2(results.summary.totalMandatoryItcReversal + analysis.financials.proportionateItcToReverse);
        results.summary.totalSection50Interest = round2(results.summary.totalSection50Interest + analysis.interest.interestPayable);
        results.buckets.overdue180Plus.push(analysis);
        break;
      case 'CRITICAL_151_179':
        results.summary.critical151To179Count++;
        results.summary.totalItcAtRisk = round2(results.summary.totalItcAtRisk + (analysis.financials.totalItcClaimed));
        results.buckets.critical151To179.push(analysis);
        break;
      case 'WATCHLIST_91_150':
        results.summary.watchlist91To150Count++;
        results.buckets.watchlist91To150.push(analysis);
        break;
      case 'CURRENT_0_90':
        results.summary.current0To90Count++;
        results.buckets.current0To90.push(analysis);
        break;
      case 'FULLY_PAID':
        results.summary.fullyPaidCount++;
        results.buckets.fullyPaid.push(analysis);
        break;
    }
  }

  return results;
}
