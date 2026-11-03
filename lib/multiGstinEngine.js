/**
 * SimpleGST Multi-GSTIN Pan-India Corporate Compliance Dashboard
 * Aggregates all state GST registrations under the same 10-digit PAN (Section 25 of CGST Act).
 * Computes consolidated turnover, state-wise filing statuses, and pan-India cash vs credit liability.
 */

import { validatePan } from "./validate.js";

export function getMultiGstinSummary(pan = "AAACB1234F") {
  const panUpper = (pan || "AAACB1234F").toUpperCase().trim();
  const panVal = validatePan(panUpper);
  if (!panVal.valid) {
    throw new Error(`Invalid Corporate PAN: ${panVal.error}`);
  }

  // Multi-state branch entities registered under this corporate PAN
  const branchList = [
    {
      stateName: "Karnataka",
      stateCode: "29",
      gstin: `29${panUpper}1Z5`,
      tradeName: "Malabar Tech & Spice - Bengaluru HO",
      filingPeriod: "102026",
      gstr1Status: "FILED",
      gstr3bStatus: "FILED",
      gstr9Status: "READY",
      turnover: 4500000,
      outputTax: 810000,
      eligibleItc: 420000,
      netCashPayable: 390000
    },
    {
      stateName: "Maharashtra",
      stateCode: "27",
      gstin: `27${panUpper}1Z8`,
      tradeName: "Malabar Logistics - Mumbai Hub",
      filingPeriod: "102026",
      gstr1Status: "FILED",
      gstr3bStatus: "PENDING",
      gstr9Status: "IN_PROGRESS",
      turnover: 3200000,
      outputTax: 576000,
      eligibleItc: 310000,
      netCashPayable: 266000
    },
    {
      stateName: "Kerala",
      stateCode: "32",
      gstin: `32${panUpper}1Z2`,
      tradeName: "Malabar Spice Traders - Kochi Depot",
      filingPeriod: "102026",
      gstr1Status: "FILED",
      gstr3bStatus: "FILED",
      gstr9Status: "FILED",
      turnover: 1800000,
      outputTax: 324000,
      eligibleItc: 195000,
      netCashPayable: 129000
    },
    {
      stateName: "Delhi",
      stateCode: "07",
      gstin: `07${panUpper}1Z1`,
      tradeName: "Malabar Trading - Delhi NCR Branch",
      filingPeriod: "102026",
      gstr1Status: "PENDING",
      gstr3bStatus: "PENDING",
      gstr9Status: "NOT_STARTED",
      turnover: 1200000,
      outputTax: 216000,
      eligibleItc: 110000,
      netCashPayable: 106000
    },
    {
      stateName: "Tamil Nadu",
      stateCode: "33",
      gstin: `33${panUpper}1Z4`,
      tradeName: "Malabar Distribution - Chennai Office",
      filingPeriod: "102026",
      gstr1Status: "FILED",
      gstr3bStatus: "FILED",
      gstr9Status: "READY",
      turnover: 2100000,
      outputTax: 378000,
      eligibleItc: 240000,
      netCashPayable: 138000
    }
  ];

  const totalTurnover = branchList.reduce((acc, b) => acc + b.turnover, 0);
  const totalOutputTax = branchList.reduce((acc, b) => acc + b.outputTax, 0);
  const totalEligibleItc = branchList.reduce((acc, b) => acc + b.eligibleItc, 0);
  const totalCashPayable = branchList.reduce((acc, b) => acc + b.netCashPayable, 0);

  const filed3bCount = branchList.filter(b => b.gstr3bStatus === "FILED").length;
  const overallComplianceRate = Math.round((filed3bCount / branchList.length) * 100);

  return {
    success: true,
    corporatePan: panUpper,
    consolidatedMetrics: {
      totalGstinsRegistered: branchList.length,
      overallComplianceRate,
      panIndiaTurnover: totalTurnover,
      totalOutputTaxLiability: totalOutputTax,
      totalEligibleCredit: totalEligibleItc,
      netCashOutflow: totalCashPayable
    },
    branches: branchList,
    notice: "Demo files. Not official GST portal or income tax portal files."
  };
}

