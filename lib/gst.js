/**
 * Pure deterministic calculation function for GST Copilot.
 * Ensures tax numbers are ALWAYS calculated by the rules engine, never an LLM.
 */
export function calculateGstSummary(sales = [], purchases = [], exceptions = []) {
  const taxableSales = sales.reduce((sum, inv) => sum + (inv.taxableAmount || 0), 0);
  const salesIgst = sales.reduce((sum, inv) => sum + (inv.igst || 0), 0);
  const salesCgst = sales.reduce((sum, inv) => sum + (inv.cgst || 0), 0);
  const salesSgst = sales.reduce((sum, inv) => sum + (inv.sgst || 0), 0);
  const totalOutputTax = salesIgst + salesCgst + salesSgst;

  const taxablePurchases = purchases.reduce((sum, inv) => sum + (inv.taxableAmount || 0), 0);
  const grossItc = purchases.reduce((sum, inv) => sum + (inv.totalTax || 0), 0);

  // Sum exceptions that are currently 'hold' or 'rejected'
  const heldItc = exceptions
    .filter((exc) => exc.status === 'hold' || exc.status === 'rejected')
    .reduce((sum, exc) => sum + (exc.taxAmount || 0), 0);

  const totalEligibleItc = Math.max(0, grossItc - heldItc);

  // ITC offset allocation rules:
  const itcRatio = grossItc > 0 ? totalEligibleItc / grossItc : 1;
  const purchasesIgst = purchases.reduce((sum, inv) => sum + (inv.igst || 0), 0) * itcRatio;
  const purchasesCgst = purchases.reduce((sum, inv) => sum + (inv.cgst || 0), 0) * itcRatio;
  const purchasesSgst = purchases.reduce((sum, inv) => sum + (inv.sgst || 0), 0) * itcRatio;

  const payableIgst = Math.max(0, Math.round(salesIgst - purchasesIgst));
  const payableCgst = Math.max(0, Math.round(salesCgst - purchasesCgst));
  const payableSgst = Math.max(0, Math.round(salesSgst - purchasesSgst));
  const totalPayable = payableIgst + payableCgst + payableSgst;

  return {
    taxableSales,
    outputTax: {
      igst: Math.round(salesIgst),
      cgst: Math.round(salesCgst),
      sgst: Math.round(salesSgst),
      total: Math.round(totalOutputTax),
    },
    taxablePurchases,
    grossItc: Math.round(grossItc),
    heldItc: Math.round(heldItc),
    eligibleItc: {
      igst: Math.round(purchasesIgst),
      cgst: Math.round(purchasesCgst),
      sgst: Math.round(purchasesSgst),
      total: Math.round(totalEligibleItc),
    },
    netPayable: {
      igst: payableIgst,
      cgst: payableCgst,
      sgst: payableSgst,
      total: totalPayable,
    },
  };
}

/**
 * Calculates days remaining to a given ISO date
 */
export function getDaysRemaining(targetDateIso) {
  const target = new Date(targetDateIso).getTime();
  const now = new Date('2026-10-31T00:00:00+05:30').getTime(); // pinned demo date: 31 Oct 2026
  const diffMs = target - now;
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Validates 15-character Indian GSTIN format
 * e.g., 32ABCDE1234F1Z5
 */
export function validateGstin(gstin) {
  const trimmed = (gstin || '').trim().toUpperCase();
  if (!trimmed) {
    return { valid: false, message: 'GSTIN cannot be empty.' };
  }
  if (trimmed.length !== 15) {
    return { valid: false, message: `GSTIN must be exactly 15 characters (currently ${trimmed.length}).` };
  }
  const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
  if (!gstinRegex.test(trimmed)) {
    return { valid: false, message: 'Invalid GSTIN format (e.g. 32ABCDE1234F1Z5).' };
  }
  return { valid: true };
}

/**
 * Deterministic compliance score (0 - 100)
 */
export function computeComplianceScore(
  exceptionsCount,
  isFiled,
  daysRemaining = 20
) {
  let score = 100;
  score -= Math.min(24, exceptionsCount * 4);
  if (!isFiled && daysRemaining <= 5) {
    score -= 8;
  }
  return Math.max(50, Math.min(100, score));
}

