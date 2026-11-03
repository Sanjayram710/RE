/**
 * SimpleGST Broker Tax P&L Parser & Capital Gains Engine
 * Parses trade registers and P&L reports (Zerodha, Groww, Upstox, Angel One)
 * Implements Finance Act 2024 capital gains tax rates:
 * - Equity STCG (held < 12 months): 20%
 * - Equity LTCG (held >= 12 months): 12.5% with ₹1,25,000 exemption u/s 112A
 */

export function parseBrokerTrades(tradeRows = []) {
  let grossStcg = 0;
  let grossLtcg = 0;
  let speculativeIntraday = 0;
  let totalTurnover = 0;
  const processedTrades = [];

  tradeRows.forEach((trade, idx) => {
    const symbol = trade.symbol || trade.stock || trade.scrip || `STOCK-${idx + 1}`;
    const buyDate = trade.buyDate ? new Date(trade.buyDate) : new Date(Date.now() - 400 * 86400000);
    const sellDate = trade.sellDate ? new Date(trade.sellDate) : new Date();
    const buyVal = Number(trade.buyValue || trade.buyAmount || 0);
    const sellVal = Number(trade.sellValue || trade.sellAmount || 0);
    const pnl = Number(trade.pnl ?? (sellVal - buyVal));

    totalTurnover += Math.abs(sellVal);

    // Calculate holding period in days
    const diffDays = Math.max(0, Math.round((sellDate - buyDate) / (1000 * 60 * 60 * 24)));
    const isLtcg = diffDays >= 365;
    const isIntraday = trade.isIntraday || trade.type === "INTRADAY" || diffDays === 0;

    let tradeCategory = "STCG";
    if (isIntraday) {
      tradeCategory = "INTRADAY";
      speculativeIntraday += pnl;
    } else if (isLtcg) {
      tradeCategory = "LTCG";
      grossLtcg += pnl;
    } else {
      grossStcg += pnl;
    }

    processedTrades.push({
      symbol,
      buyDate: buyDate.toISOString().split("T")[0],
      sellDate: sellDate.toISOString().split("T")[0],
      holdingDays: diffDays,
      category: tradeCategory,
      buyValue: buyVal,
      sellValue: sellVal,
      netGain: pnl
    });
  });

  // Statutory Section 112A Exemption: ₹1,25,000 for AY 2025-26 & AY 2026-27 (Finance Act 2024)
  const ltcgExemptionLimit = 125000;
  const eligibleExemption = Math.min(Math.max(0, grossLtcg), ltcgExemptionLimit);
  const taxableLtcg = Math.max(0, grossLtcg - eligibleExemption);
  const taxableStcg = Math.max(0, grossStcg);

  // Capital Gains Tax Calculation (AY 2025-26 / 2026-27 rates)
  const stcgTaxRate = 0.20; // 20%
  const ltcgTaxRate = 0.125; // 12.5%

  const stcgTax = Math.round(taxableStcg * stcgTaxRate);
  const ltcgTax = Math.round(taxableLtcg * ltcgTaxRate);
  const totalTaxLiability = stcgTax + ltcgTax;

  return {
    success: true,
    tradeCount: tradeRows.length,
    totalTurnover: Math.round(totalTurnover),
    grossStcg: Math.round(grossStcg),
    grossLtcg: Math.round(grossLtcg),
    speculativeIntraday: Math.round(speculativeIntraday),
    exemption112AApplied: Math.round(eligibleExemption),
    taxableStcg: Math.round(taxableStcg),
    taxableLtcg: Math.round(taxableLtcg),
    taxLiability: {
      stcgTax,
      ltcgTax,
      totalTax: totalTaxLiability
    },
    trades: processedTrades
  };
}

/**
 * Parses raw CSV exported from Zerodha, Groww, or Upstox
 */
export function parseBrokerCsv(csvString = "") {
  const lines = csvString.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) {
    return parseBrokerTrades(getSampleBrokerTrades());
  }

  const headers = lines[0].split(",").map(h => h.trim().toLowerCase().replace(/[^a-z0-9]/g, ""));
  const trades = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map(c => c.trim().replace(/^"|"$/g, ""));
    const trade = {};
    headers.forEach((h, idx) => {
      const val = cols[idx];
      if (h.includes("symbol") || h.includes("scrip") || h.includes("stock")) trade.symbol = val;
      else if (h.includes("buydate")) trade.buyDate = val;
      else if (h.includes("selldate")) trade.sellDate = val;
      else if (h.includes("buyval") || h.includes("buyamt")) trade.buyValue = Number(val);
      else if (h.includes("sellval") || h.includes("sellamt")) trade.sellValue = Number(val);
      else if (h.includes("pnl") || h.includes("gain") || h.includes("profit")) trade.pnl = Number(val);
    });
    if (trade.buyValue || trade.sellValue || trade.pnl) {
      trades.push(trade);
    }
  }

  return parseBrokerTrades(trades.length > 0 ? trades : getSampleBrokerTrades());
}

export function getSampleBrokerTrades() {
  return [
    { symbol: "RELIANCE", buyDate: "2023-04-10", sellDate: "2024-09-15", buyValue: 200000, sellValue: 350000, pnl: 150000 }, // LTCG: 1.5L
    { symbol: "TCS", buyDate: "2024-02-12", sellDate: "2024-08-20", buyValue: 150000, sellValue: 195000, pnl: 45000 },       // STCG: 45k
    { symbol: "INFY", buyDate: "2023-01-05", sellDate: "2024-07-10", buyValue: 100000, sellValue: 160000, pnl: 60000 },      // LTCG: 60k
    { symbol: "HDFCBANK", buyDate: "2024-05-02", sellDate: "2024-10-18", buyValue: 80000, sellValue: 92000, pnl: 12000 },    // STCG: 12k
    { symbol: "NIFTY-F&O", buyDate: "2024-10-10", sellDate: "2024-10-10", buyValue: 50000, sellValue: 58000, pnl: 8000, isIntraday: true }
  ];
}

