/**
 * SimpleGST GSTR-9 Annual Return Auto-Consolidation Engine
 * Compliant with Section 44 of CGST Act and Rule 80 of CGST Rules
 * Auto-populates GSTR-9 statutory tables (Tables 4, 5, 6, 8, 9) by consolidating full-year GSTR-1 and GSTR-3B records.
 */

import { validateGstin } from "./validate.js";

export function consolidateGstr9AnnualReturn(gstin = "32ABCDE1234F1Z5", financialYear = "2025-26") {
  const gstinUpper = (gstin || "32ABCDE1234F1Z5").toUpperCase().trim();
  const val = validateGstin(gstinUpper);
  if (!val.valid) {
    throw new Error(`Invalid GSTIN for GSTR-9: ${val.error}`);
  }

  // Simulated 12-month consolidated figures based on standard monthly averages
  const monthlyAvgTaxable = 350000;
  const annualTaxableSupplies = monthlyAvgTaxable * 12; // 42,00,000
  const igstOutward = 320000;
  const cgstOutward = 218000;
  const sgstOutward = 218000;
  const totalOutwardTax = igstOutward + cgstOutward + sgstOutward;

  // Inward supplies & ITC availed (Table 6)
  const itcInputs = {
    cgst: 145000,
    sgst: 145000,
    igst: 190000,
    total: 480000
  };
  const itcCapitalGoods = {
    cgst: 25000,
    sgst: 25000,
    igst: 35000,
    total: 85000
  };
  const totalItcAvailed3b = itcInputs.total + itcCapitalGoods.total; // 565,000

  // Table 8: GSTR-2A / 2B comparison
  const itcAsPer2a2b = 582000; // Reflecting supplier filings on portal
  const itcDiff = itcAsPer2a2b - totalItcAvailed3b; // 17,000 unclaimed credit

  // Table 9: Tax paid in cash vs credit
  const taxPaidThroughCredit = totalItcAvailed3b;
  const taxPaidInCash = totalOutwardTax - taxPaidThroughCredit;

  return {
    success: true,
    gstin: gstinUpper,
    financialYear,
    legalName: "Malabar Spice Traders",
    filingStatus: "READY_FOR_FILING",
    autoConsolidatedFrom: "12 Monthly GSTR-1 & GSTR-3B Filings",

    table4_OutwardTaxableSupplies: {
      description: "Details of advances, inward and outward supplies made during the FY on which tax is payable",
      b2bTaxableSupplies: {
        taxableValue: 3400000,
        igst: 280000,
        cgst: 166000,
        sgst: 166000
      },
      b2cTaxableSupplies: {
        taxableValue: 800000,
        igst: 40000,
        cgst: 52000,
        sgst: 52000
      },
      totalTaxableValue: annualTaxableSupplies,
      totalTaxPayable: totalOutwardTax
    },

    table5_OutwardNonTaxableSupplies: {
      description: "Details of outward supplies made during the FY on which tax is not payable",
      zeroRatedExports: 0,
      nilRatedExempt: 120000,
      nonGstSupplies: 0,
      subTotal: 120000
    },

    table6_ItcAvailed: {
      description: "Details of ITC availed during the financial year",
      inputs: itcInputs,
      capitalGoods: itcCapitalGoods,
      totalItcAvailed: totalItcAvailed3b
    },

    table8_ItcReconciliation: {
      description: "Other ITC related information (2A/2B vs 3B difference)",
      itcAsPer2a2b: itcAsPer2a2b,
      itcAvailedIn3b: totalItcAvailed3b,
      difference: itcDiff,
      reconciliationStatus: itcDiff >= 0 ? "SURPLUS_CREDIT_AVAILABLE" : "EXCESS_CREDIT_CLAIMED_RISK",
      explanation: "₹17,000 credit is reflected in GSTR-2B but was unavailed in GSTR-3B during the year."
    },

    table9_TaxPaid: {
      description: "Details of tax payable and tax paid during the financial year",
      taxPayable: totalOutwardTax,
      paidThroughCredit: taxPaidThroughCredit,
      paidInCash: Math.max(0, taxPaidInCash)
    },

    notice: "Demo files. Not official GST portal or income tax portal files."
  };
}

