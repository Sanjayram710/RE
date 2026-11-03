/**
 * SimpleGST Capital Gains Tax-Loss Harvesting & Loss Set-Off Engine
 * Compliant with Sections 70, 71, and 74 of the Income Tax Act, 1961
 * Models intra-head set-off, 8-year loss carry-forward ledgers (Schedule CFL), and year-end loss harvesting suggestions.
 */

/**
 * Executes statutory Intra-Head Set-off under Section 70:
 * 1. STCL can be set off against both STCG and LTCG
 * 2. LTCL can ONLY be set off against LTCG
 * 3. Capital losses cannot be set off against Salary or other heads (Section 71)
 */
export function computeCapitalLossSetOff(gainsData = {}) {
  let grossStcg = Math.max(0, Number(gainsData.stcg || 0));
  let grossLtcg = Math.max(0, Number(gainsData.ltcg || 0));

  let currentStcl = Math.abs(Number(gainsData.stcl || 0));
  let currentLtcl = Math.abs(Number(gainsData.ltcl || 0));

  // Brought-forward losses from previous AYs (Schedule BFLA / CFL)
  let broughtForwardStcl = Math.abs(Number(gainsData.broughtForwardStcl || 0));
  let broughtForwardLtcl = Math.abs(Number(gainsData.broughtForwardLtcl || 0));

  let totalStclAvailable = currentStcl + broughtForwardStcl;
  let totalLtclAvailable = currentLtcl + broughtForwardLtcl;

  // Step 1: Set off LTCL against LTCG first (Section 70(3))
  const ltclUsedAgainstLtcg = Math.min(grossLtcg, totalLtclAvailable);
  const remainingLtcgAfterLtcl = grossLtcg - ltclUsedAgainstLtcg;
  const remainingLtclToCarryForward = totalLtclAvailable - ltclUsedAgainstLtcg;

  // Step 2: Set off STCL against STCG first (Section 70(2))
  const stclUsedAgainstStcg = Math.min(grossStcg, totalStclAvailable);
  const remainingStcgAfterStcl = grossStcg - stclUsedAgainstStcg;
  let remainingStcl = totalStclAvailable - stclUsedAgainstStcg;

  // Step 3: Set off remaining STCL against remaining LTCG (Section 70(2))
  const stclUsedAgainstLtcg = Math.min(remainingLtcgAfterLtcl, remainingStcl);
  const netTaxableLtcgBeforeExemption = remainingLtcgAfterLtcl - stclUsedAgainstLtcg;
  const remainingStclToCarryForward = remainingStcl - stclUsedAgainstLtcg;

  // Step 4: Apply Section 112A ₹1,25,000 exemption limit on net remaining LTCG
  const ltcgExemptionLimit = 125000;
  const exemptionApplied = Math.min(netTaxableLtcgBeforeExemption, ltcgExemptionLimit);
  const finalTaxableLtcg = Math.max(0, netTaxableLtcgBeforeExemption - exemptionApplied);
  const finalTaxableStcg = Math.max(0, remainingStcgAfterStcl);

  // Tax computation (Finance Act 2024: STCG @ 20%, LTCG @ 12.5%)
  const taxOnStcg = Math.round(finalTaxableStcg * 0.20);
  const taxOnLtcg = Math.round(finalTaxableLtcg * 0.125);
  const totalCapitalGainsTax = taxOnStcg + taxOnLtcg;

  return {
    success: true,
    originalGains: {
      grossStcg,
      grossLtcg,
      currentStcl,
      currentLtcl,
      broughtForwardStcl,
      broughtForwardLtcl
    },
    setOffAudit: {
      ltclUsedAgainstLtcg,
      stclUsedAgainstStcg,
      stclUsedAgainstLtcg,
      totalLossUtilized: ltclUsedAgainstLtcg + stclUsedAgainstStcg + stclUsedAgainstLtcg
    },
    taxableGains: {
      finalTaxableStcg,
      netTaxableLtcgBeforeExemption,
      exemption112AApplied: exemptionApplied,
      finalTaxableLtcg,
      totalNetTaxableGains: finalTaxableStcg + finalTaxableLtcg
    },
    taxPayable: {
      taxOnStcg,
      taxOnLtcg,
      totalCapitalGainsTax
    },
    carryForwardLosses: {
      unabsorbedStcl: remainingStclToCarryForward,
      unabsorbedLtcl: remainingLtclToCarryForward,
      totalCarryForward: remainingStclToCarryForward + remainingLtclToCarryForward,
      maxCarryForwardYears: 8,
      statutorySection: "Section 74 of Income Tax Act, 1961"
    }
  };
}

/**
 * Tax-Loss Harvesting Opportunity Scanner:
 * Analyzes open portfolio holdings with unrealized losses and recommends specific holdings to liquidate before March 31.
 */
export function scanTaxLossHarvesting(portfolioHoldings = [], realizedGains = { stcg: 50000, ltcg: 150000 }) {
  const currentSetOff = computeCapitalLossSetOff(realizedGains);
  const currentTaxLiability = currentSetOff.taxPayable.totalCapitalGainsTax;

  const holdings = portfolioHoldings.length > 0 ? portfolioHoldings : getSamplePortfolioHoldings();
  const lossHoldings = [];

  holdings.forEach(h => {
    const buyPrice = Number(h.buyPrice || 0);
    const cmp = Number(h.currentPrice || h.cmp || 0);
    const qty = Number(h.quantity || 1);
    const invested = buyPrice * qty;
    const currentVal = cmp * qty;
    const unrealizedPnl = currentVal - invested;

    if (unrealizedPnl < 0) {
      lossHoldings.push({
        symbol: h.symbol,
        quantity: qty,
        buyPrice,
        currentPrice: cmp,
        holdingPeriod: h.holdingPeriod || "SHORT_TERM",
        unrealizedLoss: Math.abs(unrealizedPnl)
      });
    }
  });

  // Sort by highest loss first
  lossHoldings.sort((a, b) => b.unrealizedLoss - a.unrealizedLoss);

  // Calculate potential tax savings if harvested
  let harvestedStcl = 0;
  let harvestedLtcl = 0;
  const harvestingPlan = [];

  lossHoldings.forEach(item => {
    if (item.holdingPeriod === "SHORT_TERM") harvestedStcl += item.unrealizedLoss;
    else harvestedLtcl += item.unrealizedLoss;

    harvestingPlan.push({
      action: "SELL_BEFORE_MARCH_31",
      symbol: item.symbol,
      quantity: item.quantity,
      estimatedLossToRealize: item.unrealizedLoss,
      classification: item.holdingPeriod === "SHORT_TERM" ? "STCL (Offsets STCG & LTCG @ 20%)" : "LTCL (Offsets LTCG @ 12.5%)"
    });
  });

  const optimizedSetOff = computeCapitalLossSetOff({
    stcg: realizedGains.stcg || 0,
    ltcg: realizedGains.ltcg || 0,
    stcl: (realizedGains.stcl || 0) + harvestedStcl,
    ltcl: (realizedGains.ltcl || 0) + harvestedLtcl
  });

  const optimizedTaxLiability = optimizedSetOff.taxPayable.totalCapitalGainsTax;
  const potentialTaxSaved = Math.max(0, currentTaxLiability - optimizedTaxLiability);

  return {
    success: true,
    currentTaxLiability,
    harvestableLossIdentified: {
      totalHarvestableLoss: harvestedStcl + harvestedLtcl,
      stclPotential: harvestedStcl,
      ltclPotential: harvestedLtcl
    },
    optimizedTaxLiability,
    potentialTaxSaved,
    harvestingPlan,
    disclaimer: "Tax-loss harvesting involves realizing losses before fiscal year-end (March 31). Consult your Chartered Accountant before execution."
  };
}

export function getSamplePortfolioHoldings() {
  return [
    { symbol: "PAYTM", quantity: 50, buyPrice: 920, currentPrice: 420, holdingPeriod: "SHORT_TERM" }, // Loss: 25k STCL
    { symbol: "TATASTEEL", quantity: 200, buyPrice: 165, currentPrice: 140, holdingPeriod: "LONG_TERM" }, // Loss: 5k LTCL
    { symbol: "WIPRO", quantity: 80, buyPrice: 520, currentPrice: 440, holdingPeriod: "SHORT_TERM" }, // Loss: 6.4k STCL
    { symbol: "RELIANCE", quantity: 20, buyPrice: 2400, currentPrice: 2850, holdingPeriod: "LONG_TERM" } // Profit: not harvestable
  ];
}

