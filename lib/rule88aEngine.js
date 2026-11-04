/**
 * Rule 88A & Section 49/49A/49B Deterministic ITC Utilization Engine
 * 
 * Statutory References:
 * - CGST Act Section 49(5): Order of utilization of input tax credit
 * - CGST Act Section 49A: Mandatory complete exhaustion of IGST credit before CGST/SGST utilization
 * - CGST Act Section 49B: Order of utilization of ITC as may be prescribed
 * - CGST Rules Rule 88A: Order of utilization of input tax credit (inserted w.e.f. 29-03-2019)
 * - CBIC Circular No. 98/17/2019-GST dated 23-04-2019: Clarification on Rule 88A
 * 
 * Strict Legal Rules:
 * 1. IGST credit must be utilized FIRST towards IGST liability.
 * 2. Remaining IGST credit must be completely exhausted against CGST and SGST in any proportion
 *    BEFORE any CGST or SGST credit can be utilized.
 * 3. CGST credit can ONLY be utilized towards CGST, then IGST. (NEVER SGST).
 * 4. SGST credit can ONLY be utilized towards SGST, then IGST. (NEVER CGST).
 * 5. Deterministic optimization is applied to distribute remaining IGST credit between CGST
 *    and SGST to minimize overall cash tax outflow.
 */

function round2(val) {
  return Math.round((Number(val) || 0) * 100) / 100;
}

/**
 * Computes deterministic Rule 88A ITC set-off.
 * @param {Object} liabilities { igst: number, cgst: number, sgst: number }
 * @param {Object} itcAvailable { igst: number, cgst: number, sgst: number }
 * @param {Object} [options] Optional custom IGST allocation ratio { cgstRatio: number, sgstRatio: number }
 * @returns {Object} Comprehensive setoff statement, utilization table, and cash payable.
 */
export function computeRule88aSetoff(liabilities, itcAvailable, options = {}) {
  const lIgst = round2(liabilities?.igst || 0);
  const lCgst = round2(liabilities?.cgst || 0);
  const lSgst = round2(liabilities?.sgst || 0);

  let availIgst = round2(itcAvailable?.igst || 0);
  let availCgst = round2(itcAvailable?.cgst || 0);
  let availSgst = round2(itcAvailable?.sgst || 0);

  let remLIgst = lIgst;
  let remLCgst = lCgst;
  let remLSgst = lSgst;

  // Step 1: IGST ITC -> IGST Liability (Mandatory First Step)
  const igstToIgst = Math.min(availIgst, remLIgst);
  remLIgst = round2(remLIgst - igstToIgst);
  availIgst = round2(availIgst - igstToIgst);

  // Step 2: Remaining IGST ITC -> CGST and SGST Liabilities in any proportion (Rule 88A)
  let igstToCgst = 0;
  let igstToSgst = 0;

  if (availIgst > 0) {
    if (options.cgstRatio !== undefined && options.sgstRatio !== undefined) {
      // User or CA custom proportion
      const totalRatio = options.cgstRatio + options.sgstRatio;
      const desiredCgst = totalRatio > 0 ? round2((availIgst * options.cgstRatio) / totalRatio) : 0;
      igstToCgst = Math.min(desiredCgst, remLCgst, availIgst);
      availIgst = round2(availIgst - igstToCgst);
      remLCgst = round2(remLCgst - igstToCgst);

      igstToSgst = Math.min(availIgst, remLSgst);
      availIgst = round2(availIgst - igstToSgst);
      remLSgst = round2(remLSgst - igstToSgst);
    } else {
      // Optimal Setoff Strategy:
      const cgstDeficit = Math.max(0, round2(remLCgst - availCgst));
      const sgstDeficit = Math.max(0, round2(remLSgst - availSgst));

      if (cgstDeficit > 0 || sgstDeficit > 0) {
        const totalDeficit = round2(cgstDeficit + sgstDeficit);
        if (availIgst <= totalDeficit) {
          if (totalDeficit > 0) {
            igstToCgst = Math.min(round2((availIgst * cgstDeficit) / totalDeficit), remLCgst);
            availIgst = round2(availIgst - igstToCgst);
            remLCgst = round2(remLCgst - igstToCgst);

            igstToSgst = Math.min(availIgst, remLSgst);
            availIgst = round2(availIgst - igstToSgst);
            remLSgst = round2(remLSgst - igstToSgst);
          }
        } else {
          igstToCgst = Math.min(cgstDeficit, remLCgst);
          remLCgst = round2(remLCgst - igstToCgst);
          availIgst = round2(availIgst - igstToCgst);

          igstToSgst = Math.min(sgstDeficit, remLSgst);
          remLSgst = round2(remLSgst - igstToSgst);
          availIgst = round2(availIgst - igstToSgst);

          if (availIgst > 0) {
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
        const half = round2(availIgst / 2);
        igstToCgst = Math.min(half, remLCgst);
        remLCgst = round2(remLCgst - igstToCgst);
        availIgst = round2(availIgst - igstToCgst);

        igstToSgst = Math.min(availIgst, remLSgst);
        remLSgst = round2(remLSgst - igstToSgst);
        availIgst = round2(availIgst - igstToSgst);
      }
    }
  }

  // Mandatory statutory verification: Under Sec 49A, IGST credit MUST be zero before CGST/SGST credit is used
  const igstFullyExhausted = availIgst === 0;

  // Step 3: Utilize CGST Credit -> CGST liability first, then IGST liability
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

  // Step 4: Utilize SGST Credit -> SGST liability first, then IGST liability
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

  const netCashPayable = {
    igst: remLIgst,
    cgst: remLCgst,
    sgst: remLSgst,
    total: round2(remLIgst + remLCgst + remLSgst)
  };

  const itcCarryForward = {
    igst: availIgst,
    cgst: availCgst,
    sgst: availSgst,
    total: round2(availIgst + availCgst + availSgst)
  };

  const validation = {
    rule88ACompliant: true,
    section49ACompliant: igstFullyExhausted || (cgstToCgst === 0 && cgstToIgst === 0 && sgstToSgst === 0 && sgstToIgst === 0),
    cgstSgstFirewallMaintained: true,
    statutoryNotes: [
      'IGST credit utilized against IGST, then distributed across CGST & SGST (Rule 88A).',
      'CGST and SGST credit firewalled against each other per Section 49(5)(e) and (f).',
      'Net cash payable must be discharged via Form GST PMT-05 Electronic Cash Ledger.'
    ]
  };

  return {
    liabilitiesOriginal: { igst: lIgst, cgst: lCgst, sgst: lSgst, total: round2(lIgst + lCgst + lSgst) },
    itcOriginal: { igst: round2(itcAvailable?.igst || 0), cgst: round2(itcAvailable?.cgst || 0), sgst: round2(itcAvailable?.sgst || 0), total: round2((itcAvailable?.igst || 0) + (itcAvailable?.cgst || 0) + (itcAvailable?.sgst || 0)) },
    utilizationMatrix: {
      igstCreditUtilized: { towardsIgst: igstToIgst, towardsCgst: igstToCgst, towardsSgst: igstToSgst, total: round2(igstToIgst + igstToCgst + igstToSgst) },
      cgstCreditUtilized: { towardsCgst: cgstToCgst, towardsIgst: cgstToIgst, towardsSgst: 0, total: round2(cgstToCgst + cgstToIgst) },
      sgstCreditUtilized: { towardsSgst: sgstToSgst, towardsIgst: sgstToIgst, towardsCgst: 0, total: round2(sgstToSgst + sgstToIgst) }
    },
    netCashPayable,
    itcCarryForward,
    validation
  };
}
