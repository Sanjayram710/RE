/**
 * Rule 88A & Section 49/49A/49B Deterministic ITC Utilization Engine
 * 
 * Statutory References:
 * - CGST Act Section 49(5): Mandatory order of utilization of input tax credit
 * - CGST Act Section 49A: Mandatory complete exhaustion of IGST credit before CGST/SGST utilization
 * - CGST Act Section 49B: Government power to prescribe order of utilization
 * - CGST Rules Rule 88A: Order of utilization of input tax credit (inserted w.e.f. 29-03-2019)
 * - CBIC Circular No. 98/17/2019-GST: Statutory clarification on Rule 88A
 * - GST (Compensation to States) Act Section 11: Compensation Cess utilization restrictions
 * 
 * Strict Legal Rules:
 * 1. Inputs must be non-negative; negative liabilities or credits are rejected.
 * 2. IGST credit must be utilized FIRST towards IGST liability.
 * 3. Remaining IGST credit must be completely exhausted against CGST and SGST in any proportion
 *    BEFORE any CGST or SGST credit can be utilized (Section 49A).
 * 4. CGST credit can ONLY be utilized towards CGST, then IGST. (FIREWALL: NEVER SGST).
 * 5. SGST credit can ONLY be utilized towards SGST, then IGST. (FIREWALL: NEVER CGST).
 * 6. Compensation Cess credit can ONLY be utilized towards Compensation Cess liability.
 * 7. All calculations are pure, deterministic, and rounded to 2 decimal places.
 */

export function round2(val) {
  if (val === undefined || val === null || isNaN(val)) return 0;
  return Math.round((Number(val) + Number.EPSILON) * 100) / 100;
}

/**
 * Validates non-negative numeric inputs.
 */
function validateFinancialInput(name, val) {
  const num = Number(val);
  if (isNaN(num)) {
    throw new TypeError(`Statutory Calculation Error: Value for '${name}' must be a valid numeric amount.`);
  }
  if (num < 0) {
    throw new RangeError(`Statutory Rule Violation: '${name}' cannot be negative (got ${num}). Negative liabilities or credits are not permitted in GSTR-3B Table 6.1.`);
  }
  return round2(num);
}

/**
 * Computes deterministic Rule 88A ITC set-off.
 * @param {Object} liabilities { igst, cgst, sgst, cess }
 * @param {Object} itcAvailable { igst, cgst, sgst, cess }
 * @param {Object} [options] Optional custom IGST allocation ratio { cgstRatio, sgstRatio }
 * @returns {Object} Comprehensive setoff statement, utilization table, and cash payable.
 */
export function computeRule88aSetoff(liabilities = {}, itcAvailable = {}, options = {}) {
  // Validate all inputs strictly
  const lIgst = validateFinancialInput('liabilities.igst', liabilities.igst || 0);
  const lCgst = validateFinancialInput('liabilities.cgst', liabilities.cgst || 0);
  const lSgst = validateFinancialInput('liabilities.sgst', liabilities.sgst || 0);
  const lCess = validateFinancialInput('liabilities.cess', liabilities.cess || 0);

  let availIgst = validateFinancialInput('itcAvailable.igst', itcAvailable.igst || 0);
  let availCgst = validateFinancialInput('itcAvailable.cgst', itcAvailable.cgst || 0);
  let availSgst = validateFinancialInput('itcAvailable.sgst', itcAvailable.sgst || 0);
  let availCess = validateFinancialInput('itcAvailable.cess', itcAvailable.cess || 0);

  let remLIgst = lIgst;
  let remLCgst = lCgst;
  let remLSgst = lSgst;
  let remLCess = lCess;

  // -------------------------------------------------------------------------
  // STEP 1: Exhaust IGST Credit against IGST Liability (Mandatory First Step)
  // -------------------------------------------------------------------------
  const igstToIgst = Math.min(availIgst, remLIgst);
  remLIgst = round2(remLIgst - igstToIgst);
  availIgst = round2(availIgst - igstToIgst);

  // -------------------------------------------------------------------------
  // STEP 2: Remaining IGST Credit -> CGST and SGST Liabilities (Rule 88A)
  // -------------------------------------------------------------------------
  let igstToCgst = 0;
  let igstToSgst = 0;

  if (availIgst > 0 && (remLCgst > 0 || remLSgst > 0)) {
    if (options.cgstRatio !== undefined && options.sgstRatio !== undefined) {
      // User or CA custom proportion
      const rCgst = Math.max(0, Number(options.cgstRatio) || 0);
      const rSgst = Math.max(0, Number(options.sgstRatio) || 0);
      const totalRatio = rCgst + rSgst;

      if (totalRatio > 0) {
        const desiredCgst = round2((availIgst * rCgst) / totalRatio);
        igstToCgst = Math.min(desiredCgst, remLCgst, availIgst);
        availIgst = round2(availIgst - igstToCgst);
        remLCgst = round2(remLCgst - igstToCgst);

        igstToSgst = Math.min(availIgst, remLSgst);
        availIgst = round2(availIgst - igstToSgst);
        remLSgst = round2(remLSgst - igstToSgst);
      }
    } else {
      // Optimal Linear Set-off Strategy:
      // Compute cash deficits that would occur if only own CGST/SGST credits were used:
      const cgstDeficit = Math.max(0, round2(remLCgst - availCgst));
      const sgstDeficit = Math.max(0, round2(remLSgst - availSgst));

      if (cgstDeficit > 0 || sgstDeficit > 0) {
        const totalDeficit = round2(cgstDeficit + sgstDeficit);
        if (availIgst <= totalDeficit) {
          // Allocate remaining IGST credit in proportion to deficit
          if (totalDeficit > 0) {
            const propCgst = round2((availIgst * cgstDeficit) / totalDeficit);
            igstToCgst = Math.min(propCgst, remLCgst, availIgst);
            availIgst = round2(availIgst - igstToCgst);
            remLCgst = round2(remLCgst - igstToCgst);

            igstToSgst = Math.min(availIgst, remLSgst);
            availIgst = round2(availIgst - igstToSgst);
            remLSgst = round2(remLSgst - igstToSgst);
          }
        } else {
          // Deficits can be fully covered
          igstToCgst = Math.min(cgstDeficit, remLCgst);
          remLCgst = round2(remLCgst - igstToCgst);
          availIgst = round2(availIgst - igstToCgst);

          igstToSgst = Math.min(sgstDeficit, remLSgst);
          remLSgst = round2(remLSgst - igstToSgst);
          availIgst = round2(availIgst - igstToSgst);

          // Split any surplus IGST credit evenly across remaining liabilities
          if (availIgst > 0 && (remLCgst > 0 || remLSgst > 0)) {
            const split = round2(availIgst / 2);
            const extraCgst = Math.min(split, remLCgst);
            igstToCgst = round2(igstToCgst + extraCgst);
            remLCgst = round2(remLCgst - extraCgst);
            availIgst = round2(availIgst - extraCgst);

            const extraSgst = Math.min(availIgst, remLSgst);
            igstToSgst = round2(igstToSgst + extraSgst);
            remLSgst = round2(remLSgst - extraSgst);
            availIgst = round2(availIgst - extraSgst);
          }
        }
      } else {
        // Neither CGST nor SGST has a deficit against its own credit.
        // Balance IGST credit equally across liabilities to preserve maximum credit flexibility.
        const half = round2(availIgst / 2);
        igstToCgst = Math.min(half, remLCgst);
        remLCgst = round2(remLCgst - igstToCgst);
        availIgst = round2(availIgst - igstToCgst);

        igstToSgst = Math.min(availIgst, remLSgst);
        remLSgst = round2(remLSgst - igstToSgst);
        availIgst = round2(availIgst - igstToSgst);
      }
    }

    // SECTION 49A HARDENING:
    // If availIgst is still > 0, but either remLCgst > 0 or remLSgst > 0,
    // IGST credit MUST be completely exhausted against any remaining liability
    // before any CGST or SGST credit can be utilized.
    if (availIgst > 0 && remLCgst > 0) {
      const extraC = Math.min(availIgst, remLCgst);
      igstToCgst = round2(igstToCgst + extraC);
      remLCgst = round2(remLCgst - extraC);
      availIgst = round2(availIgst - extraC);
    }
    if (availIgst > 0 && remLSgst > 0) {
      const extraS = Math.min(availIgst, remLSgst);
      igstToSgst = round2(igstToSgst + extraS);
      remLSgst = round2(remLSgst - extraS);
      availIgst = round2(availIgst - extraS);
    }
  }

  // -------------------------------------------------------------------------
  // STEP 3: Utilize CGST Credit -> CGST liability first, then IGST liability
  // -------------------------------------------------------------------------
  let cgstToCgst = 0;
  let cgstToIgst = 0;
  if (availCgst > 0) {
    cgstToCgst = Math.min(availCgst, remLCgst);
    remLCgst = round2(remLCgst - cgstToCgst);
    availCgst = round2(availCgst - cgstToCgst);

    if (availCgst > 0 && remLIgst > 0) {
      cgstToIgst = Math.min(availCgst, remLIgst);
      remLIgst = round2(remLIgst - cgstToIgst);
      availCgst = round2(availCgst - cgstToIgst);
    }
  }

  // -------------------------------------------------------------------------
  // STEP 4: Utilize SGST Credit -> SGST liability first, then IGST liability
  // -------------------------------------------------------------------------
  let sgstToSgst = 0;
  let sgstToIgst = 0;
  if (availSgst > 0) {
    sgstToSgst = Math.min(availSgst, remLSgst);
    remLSgst = round2(remLSgst - sgstToSgst);
    availSgst = round2(availSgst - sgstToSgst);

    if (availSgst > 0 && remLIgst > 0) {
      sgstToIgst = Math.min(availSgst, remLIgst);
      remLIgst = round2(remLIgst - sgstToIgst);
      availSgst = round2(availSgst - sgstToIgst);
    }
  }

  // -------------------------------------------------------------------------
  // STEP 5: Compensation Cess Credit -> Cess Liability (No cross-utilization)
  // -------------------------------------------------------------------------
  const cessToCess = Math.min(availCess, remLCess);
  remLCess = round2(remLCess - cessToCess);
  availCess = round2(availCess - cessToCess);

  // -------------------------------------------------------------------------
  // Final Net Cash Payable & ITC Carry-Forward
  // -------------------------------------------------------------------------
  const netCashPayable = {
    igst: remLIgst,
    cgst: remLCgst,
    sgst: remLSgst,
    cess: remLCess,
    total: round2(remLIgst + remLCgst + remLSgst + remLCess)
  };

  const itcCarryForward = {
    igst: availIgst,
    cgst: availCgst,
    sgst: availSgst,
    cess: availCess,
    total: round2(availIgst + availCgst + availSgst + availCess)
  };

  // -------------------------------------------------------------------------
  // Statutory Integrity Audit Validations
  // -------------------------------------------------------------------------
  const isIgstExhaustedOrUnneeded = availIgst === 0 || (remLCgst === 0 && remLSgst === 0);
  const isCgstUsedBeforeIgstExhausted = (cgstToCgst > 0 || cgstToIgst > 0) && (availIgst > 0 && (lCgst > 0 || lSgst > 0));
  const isSgstUsedBeforeIgstExhausted = (sgstToSgst > 0 || sgstToIgst > 0) && (availIgst > 0 && (lCgst > 0 || lSgst > 0));

  const validation = {
    rule88ACompliant: true,
    section49ACompliant: isIgstExhaustedOrUnneeded && !isCgstUsedBeforeIgstExhausted && !isSgstUsedBeforeIgstExhausted,
    cgstSgstFirewallMaintained: true, // Mathematically guaranteed 0 cross between CGST and SGST
    cessIsolated: true, // Cess credit can never offset GST liability and vice versa
    statutoryNotes: [
      'IGST credit utilized against IGST, then distributed across CGST & SGST (Rule 88A).',
      'IGST credit completely exhausted before CGST/SGST credit utilization (Section 49A).',
      'CGST and SGST credit firewalled against each other per Section 49(5)(e) and (f).',
      'Compensation Cess isolated per Section 11 of Goods and Services Tax (Compensation to States) Act, 2017.',
      'Net cash payable must be discharged via Form GST PMT-05 Electronic Cash Ledger.'
    ]
  };

  return {
    liabilitiesOriginal: { igst: lIgst, cgst: lCgst, sgst: lSgst, cess: lCess, total: round2(lIgst + lCgst + lSgst + lCess) },
    itcOriginal: {
      igst: round2(itcAvailable?.igst || 0),
      cgst: round2(itcAvailable?.cgst || 0),
      sgst: round2(itcAvailable?.sgst || 0),
      cess: round2(itcAvailable?.cess || 0),
      total: round2((itcAvailable?.igst || 0) + (itcAvailable?.cgst || 0) + (itcAvailable?.sgst || 0) + (itcAvailable?.cess || 0))
    },
    utilizationMatrix: {
      igstCreditUtilized: { towardsIgst: igstToIgst, towardsCgst: igstToCgst, towardsSgst: igstToSgst, towardsCess: 0, total: round2(igstToIgst + igstToCgst + igstToSgst) },
      cgstCreditUtilized: { towardsCgst: cgstToCgst, towardsIgst: cgstToIgst, towardsSgst: 0, towardsCess: 0, total: round2(cgstToCgst + cgstToIgst) },
      sgstCreditUtilized: { towardsSgst: sgstToSgst, towardsIgst: sgstToIgst, towardsCgst: 0, towardsCess: 0, total: round2(sgstToSgst + sgstToIgst) },
      cessCreditUtilized: { towardsCess: cessToCess, towardsIgst: 0, towardsCgst: 0, towardsSgst: 0, total: cessToCess }
    },
    netCashPayable,
    itcCarryForward,
    validation
  };
}
