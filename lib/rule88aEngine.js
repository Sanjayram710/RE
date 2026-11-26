/**
 * Rule 88A & Section 49/49A/49B Deterministic ITC Utilization Engine
 *
 * All monetary arithmetic is executed in integer paise via lib/moneyPaise.js
 * to eliminate IEEE-754 floating-point drift at every step.
 */
import { toPaise, fromPaise, ratioSharePaise } from "./moneyPaise.js";

export function round2(val) {
  if (val === undefined || val === null || isNaN(val)) return 0;
  return fromPaise(toPaise(val));
}

function validateFinancialInputPaise(name, val) {
  const num = Number(val);
  if (isNaN(num)) {
    throw new TypeError(`Statutory Calculation Error: Value for '${name}' must be a valid numeric amount.`);
  }
  if (num < 0) {
    throw new RangeError(`Statutory Rule Violation: '${name}' cannot be negative (got ${num}). Negative liabilities or credits are not permitted in GSTR-3B Table 6.1.`);
  }
  return toPaise(num);
}

/**
 * Computes deterministic Rule 88A ITC set-off in integer paise.
 * @param {Object} liabilities { igst, cgst, sgst, cess }
 * @param {Object} itcAvailable { igst, cgst, sgst, cess }
 * @param {Object} [options] Optional custom IGST allocation ratio { cgstRatio, sgstRatio }
 * @returns {Object} Comprehensive setoff statement, utilization table, and cash payable.
 */
export function computeRule88aSetoff(liabilities = {}, itcAvailable = {}, options = {}) {
  const lIgst = validateFinancialInputPaise('liabilities.igst', liabilities.igst || 0);
  const lCgst = validateFinancialInputPaise('liabilities.cgst', liabilities.cgst || 0);
  const lSgst = validateFinancialInputPaise('liabilities.sgst', liabilities.sgst || 0);
  const lCess = validateFinancialInputPaise('liabilities.cess', liabilities.cess || 0);

  let availIgst = validateFinancialInputPaise('itcAvailable.igst', itcAvailable.igst || 0);
  let availCgst = validateFinancialInputPaise('itcAvailable.cgst', itcAvailable.cgst || 0);
  let availSgst = validateFinancialInputPaise('itcAvailable.sgst', itcAvailable.sgst || 0);
  let availCess = validateFinancialInputPaise('itcAvailable.cess', itcAvailable.cess || 0);

  const origItcIgst = availIgst;
  const origItcCgst = availCgst;
  const origItcSgst = availSgst;
  const origItcCess = availCess;

  let remLIgst = lIgst;
  let remLCgst = lCgst;
  let remLSgst = lSgst;
  let remLCess = lCess;

  // STEP 1: Exhaust IGST Credit against IGST Liability (Mandatory First Step)
  const igstToIgst = Math.min(availIgst, remLIgst);
  remLIgst -= igstToIgst;
  availIgst -= igstToIgst;

  // STEP 2: Remaining IGST Credit -> CGST and SGST Liabilities (Rule 88A)
  let igstToCgst = 0;
  let igstToSgst = 0;

  if (availIgst > 0 && (remLCgst > 0 || remLSgst > 0)) {
    if (options.cgstRatio !== undefined && options.sgstRatio !== undefined) {
      const rCgst = Math.max(0, Math.round(Number(options.cgstRatio) * 100) || 0);
      const rSgst = Math.max(0, Math.round(Number(options.sgstRatio) * 100) || 0);
      const totalRatio = rCgst + rSgst;

      if (totalRatio > 0) {
        const desiredCgst = ratioSharePaise(availIgst, rCgst, totalRatio);
        igstToCgst = Math.min(desiredCgst, remLCgst, availIgst);
        availIgst -= igstToCgst;
        remLCgst -= igstToCgst;

        igstToSgst = Math.min(availIgst, remLSgst);
        availIgst -= igstToSgst;
        remLSgst -= igstToSgst;
      }
    } else {
      const cgstDeficit = Math.max(0, remLCgst - availCgst);
      const sgstDeficit = Math.max(0, remLSgst - availSgst);

      if (cgstDeficit > 0 || sgstDeficit > 0) {
        const totalDeficit = cgstDeficit + sgstDeficit;
        if (availIgst <= totalDeficit) {
          if (totalDeficit > 0) {
            const propCgst = ratioSharePaise(availIgst, cgstDeficit, totalDeficit);
            igstToCgst = Math.min(propCgst, remLCgst, availIgst);
            availIgst -= igstToCgst;
            remLCgst -= igstToCgst;

            igstToSgst = Math.min(availIgst, remLSgst);
            availIgst -= igstToSgst;
            remLSgst -= igstToSgst;
          }
        } else {
          igstToCgst = Math.min(cgstDeficit, remLCgst);
          remLCgst -= igstToCgst;
          availIgst -= igstToCgst;

          igstToSgst = Math.min(sgstDeficit, remLSgst);
          remLSgst -= igstToSgst;
          availIgst -= igstToSgst;

          if (availIgst > 0 && (remLCgst > 0 || remLSgst > 0)) {
            const split = Math.floor(availIgst / 2);
            const extraCgst = Math.min(split, remLCgst);
            igstToCgst += extraCgst;
            remLCgst -= extraCgst;
            availIgst -= extraCgst;

            const extraSgst = Math.min(availIgst, remLSgst);
            igstToSgst += extraSgst;
            remLSgst -= extraSgst;
            availIgst -= extraSgst;
          }
        }
      } else {
        const half = Math.floor(availIgst / 2);
        igstToCgst = Math.min(half, remLCgst);
        remLCgst -= igstToCgst;
        availIgst -= igstToCgst;

        igstToSgst = Math.min(availIgst, remLSgst);
        remLSgst -= igstToSgst;
        availIgst -= igstToSgst;
      }
    }

    // SECTION 49A HARDENING: exhaust remaining IGST credit before CGST/SGST
    if (availIgst > 0 && remLCgst > 0) {
      const extraC = Math.min(availIgst, remLCgst);
      igstToCgst += extraC;
      remLCgst -= extraC;
      availIgst -= extraC;
    }
    if (availIgst > 0 && remLSgst > 0) {
      const extraS = Math.min(availIgst, remLSgst);
      igstToSgst += extraS;
      remLSgst -= extraS;
      availIgst -= extraS;
    }
  }

  // STEP 3: Utilize CGST Credit -> CGST liability first, then IGST liability
  let cgstToCgst = 0;
  let cgstToIgst = 0;
  if (availCgst > 0) {
    cgstToCgst = Math.min(availCgst, remLCgst);
    remLCgst -= cgstToCgst;
    availCgst -= cgstToCgst;

    if (availCgst > 0 && remLIgst > 0) {
      cgstToIgst = Math.min(availCgst, remLIgst);
      remLIgst -= cgstToIgst;
      availCgst -= cgstToIgst;
    }
  }

  // STEP 4: Utilize SGST Credit -> SGST liability first, then IGST liability
  let sgstToSgst = 0;
  let sgstToIgst = 0;
  if (availSgst > 0) {
    sgstToSgst = Math.min(availSgst, remLSgst);
    remLSgst -= sgstToSgst;
    availSgst -= sgstToSgst;

    if (availSgst > 0 && remLIgst > 0) {
      sgstToIgst = Math.min(availSgst, remLIgst);
      remLIgst -= sgstToIgst;
      availSgst -= sgstToIgst;
    }
  }

  // STEP 5: Compensation Cess Credit -> Cess Liability
  const cessToCess = Math.min(availCess, remLCess);
  remLCess -= cessToCess;
  availCess -= cessToCess;

  const netCashPayablePaise = remLIgst + remLCgst + remLSgst + remLCess;
  const itcCarryForwardPaise = availIgst + availCgst + availSgst + availCess;

  const netCashPayable = {
    igst: fromPaise(remLIgst),
    cgst: fromPaise(remLCgst),
    sgst: fromPaise(remLSgst),
    cess: fromPaise(remLCess),
    total: fromPaise(netCashPayablePaise)
  };

  const itcCarryForward = {
    igst: fromPaise(availIgst),
    cgst: fromPaise(availCgst),
    sgst: fromPaise(availSgst),
    cess: fromPaise(availCess),
    total: fromPaise(itcCarryForwardPaise)
  };

  const isIgstExhaustedOrUnneeded = availIgst === 0 || (remLCgst === 0 && remLSgst === 0);
  const isCgstUsedBeforeIgstExhausted = (cgstToCgst > 0 || cgstToIgst > 0) && (availIgst > 0 && (lCgst > 0 || lSgst > 0));
  const isSgstUsedBeforeIgstExhausted = (sgstToSgst > 0 || sgstToIgst > 0) && (availIgst > 0 && (lCgst > 0 || lSgst > 0));

  const validation = {
    rule88ACompliant: true,
    section49ACompliant: isIgstExhaustedOrUnneeded && !isCgstUsedBeforeIgstExhausted && !isSgstUsedBeforeIgstExhausted,
    cgstSgstFirewallMaintained: true,
    cessIsolated: true,
    needsCaReview: true,
    statutoryNotes: [
      'IGST credit utilized against IGST, then distributed across CGST & SGST (Rule 88A).',
      'IGST credit completely exhausted before CGST/SGST credit utilization (Section 49A).',
      'CGST and SGST credit firewalled against each other per Section 49(5)(e) and (f).',
      'Compensation Cess isolated per Section 11 of Goods and Services Tax (Compensation to States) Act, 2017.',
      'Net cash payable must be discharged via Form GST PMT-05 Electronic Cash Ledger.'
    ]
  };

  return {
    liabilitiesOriginal: {
      igst: fromPaise(lIgst),
      cgst: fromPaise(lCgst),
      sgst: fromPaise(lSgst),
      cess: fromPaise(lCess),
      total: fromPaise(lIgst + lCgst + lSgst + lCess)
    },
    itcOriginal: {
      igst: fromPaise(origItcIgst),
      cgst: fromPaise(origItcCgst),
      sgst: fromPaise(origItcSgst),
      cess: fromPaise(origItcCess),
      total: fromPaise(origItcIgst + origItcCgst + origItcSgst + origItcCess)
    },
    utilizationMatrix: {
      igstCreditUtilized: {
        towardsIgst: fromPaise(igstToIgst),
        towardsCgst: fromPaise(igstToCgst),
        towardsSgst: fromPaise(igstToSgst),
        towardsCess: 0,
        total: fromPaise(igstToIgst + igstToCgst + igstToSgst)
      },
      cgstCreditUtilized: {
        towardsCgst: fromPaise(cgstToCgst),
        towardsIgst: fromPaise(cgstToIgst),
        towardsSgst: 0,
        towardsCess: 0,
        total: fromPaise(cgstToCgst + cgstToIgst)
      },
      sgstCreditUtilized: {
        towardsSgst: fromPaise(sgstToSgst),
        towardsIgst: fromPaise(sgstToIgst),
        towardsCgst: 0,
        towardsCess: 0,
        total: fromPaise(sgstToSgst + sgstToIgst)
      },
      cessCreditUtilized: {
        towardsCess: fromPaise(cessToCess),
        towardsIgst: 0,
        towardsCgst: 0,
        towardsSgst: 0,
        total: fromPaise(cessToCess)
      }
    },
    netCashPayable,
    itcCarryForward,
    paise: {
      netCashPayable: netCashPayablePaise,
      itcCarryForward: itcCarryForwardPaise,
      totalItcUtilized: igstToIgst + igstToCgst + igstToSgst + cgstToCgst + cgstToIgst + sgstToSgst + sgstToIgst + cessToCess
    },
    validation
  };
}
