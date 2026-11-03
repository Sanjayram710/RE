/**
 * Income Tax Slab Configuration & Computation Engine
 * Slabs for Assessment Year (AY) 2025-26 and AY 2026-27
 * Values confirmed from the official Income Tax Department (incometax.gov.in) provisions.
 * Unconfirmed / prospective values marked explicitly as "TO VERIFY".
 */

export const TAX_CONFIG = {
  "2025-26": {
    assessmentYear: "2025-26",
    financialYear: "2024-25",
    source: "Finance (No. 2) Act, 2024 / incometax.gov.in",
    status: "CONFIRMED",
    regimes: {
      NEW: {
        name: "New Tax Regime (Section 115BAC)",
        standardDeduction: 75000, // Confirmed: Raised from 50,000 to 75,000 in Finance Act 2024
        rebate87ALimit: 700000,   // Confirmed: Full tax rebate if taxable income <= 7,00,000
        maxRebate87A: 25000,
        cessRate: 0.04,           // 4% Health & Education Cess
        slabs: [
          { min: 0, max: 300000, rate: 0 },
          { min: 300000, max: 700000, rate: 0.05 },
          { min: 700000, max: 1000000, rate: 0.10 },
          { min: 1000000, max: 1200000, rate: 0.15 },
          { min: 1200000, max: 1500000, rate: 0.20 },
          { min: 1500000, max: Infinity, rate: 0.30 }
        ]
      },
      OLD: {
        name: "Old Tax Regime (With Chapter VI-A Exemptions)",
        standardDeduction: 50000,
        rebate87ALimit: 500000,
        maxRebate87A: 12500,
        cessRate: 0.04,
        slabs: [
          { min: 0, max: 250000, rate: 0 },
          { min: 250000, max: 500000, rate: 0.05 },
          { min: 500000, max: 1000000, rate: 0.20 },
          { min: 1000000, max: Infinity, rate: 0.30 }
        ]
      }
    }
  },
  "2026-27": {
    assessmentYear: "2026-27",
    financialYear: "2025-26",
    source: "Income Tax Department / Finance Act baseline",
    status: "CONFIRMED_BASELINE",
    notes: "Baseline slabs under Section 115BAC; subsequent statutory notifications marked TO VERIFY",
    regimes: {
      NEW: {
        name: "New Tax Regime (Section 115BAC Default)",
        standardDeduction: 75000, // Confirmed baseline
        rebate87ALimit: 700000,   // Confirmed baseline
        maxRebate87A: 25000,
        cessRate: 0.04,
        slabs: [
          { min: 0, max: 300000, rate: 0 },
          { min: 300000, max: 700000, rate: 0.05 },
          { min: 700000, max: 1000000, rate: 0.10 },
          { min: 1000000, max: 1200000, rate: 0.15 },
          { min: 1200000, max: 1500000, rate: 0.20 },
          { min: 1500000, max: Infinity, rate: 0.30 }
        ],
        marginalReliefThreshold: "TO VERIFY", // Marginal relief above 7,00,000 pending upcoming notification
        familyPensionDeductionLimit: 25000    // Confirmed in 2024
      },
      OLD: {
        name: "Old Tax Regime (Optional)",
        standardDeduction: 50000,
        rebate87ALimit: 500000,
        maxRebate87A: 12500,
        cessRate: 0.04,
        slabs: [
          { min: 0, max: 250000, rate: 0 },
          { min: 250000, max: 500000, rate: 0.05 },
          { min: 500000, max: 1000000, rate: 0.20 },
          { min: 1000000, max: Infinity, rate: 0.30 }
        ],
        seniorCitizenExemptionLimit: "TO VERIFY" // Pending AY 2026-27 revision
      }
    }
  }
};

/**
 * Calculates tax liability for a given assessment year and regime
 */
export function computeTaxForAy(income = {}, regime = "NEW", assessmentYear = "2025-26") {
  const ayConfig = TAX_CONFIG[assessmentYear] || TAX_CONFIG["2025-26"];
  const regConfig = ayConfig.regimes[regime] || ayConfig.regimes.NEW;

  const grossSalary = Number(income.grossSalary || 0);
  const houseProperty = Number(income.housePropertyIncome || 0);
  const otherIncome = Number(income.otherIncome || 0);

  const stdDeduction = Math.min(grossSalary, regConfig.standardDeduction);
  const incomeFromSalary = Math.max(0, grossSalary - stdDeduction);
  const grossTotalIncome = incomeFromSalary + houseProperty + otherIncome;

  let totalDeductions = 0;
  if (regime === "OLD") {
    const sec80C = Math.min(150000, Number(income.deductions?.sec80C || 0));
    const sec80D = Math.min(25000, Number(income.deductions?.sec80D || 0));
    const otherDed = Number(income.deductions?.other || 0);
    totalDeductions = sec80C + sec80D + otherDed;
  }

  const netTaxableIncome = Math.max(0, grossTotalIncome - totalDeductions);

  let calculatedTax = 0;
  for (const slab of regConfig.slabs) {
    if (netTaxableIncome > slab.min) {
      const taxableInSlab = Math.min(netTaxableIncome, slab.max) - slab.min;
      calculatedTax += taxableInSlab * slab.rate;
    }
  }

  // Section 87A Rebate
  if (netTaxableIncome <= regConfig.rebate87ALimit) {
    calculatedTax = 0;
  }

  const cess = Math.round(calculatedTax * regConfig.cessRate);
  const totalTaxWithCess = calculatedTax + cess;

  const totalTaxesPaid = Number(income.taxesPaid?.tds || 0) + Number(income.taxesPaid?.advanceTax || 0);
  const netTaxPayable = Math.max(0, totalTaxWithCess - totalTaxesPaid);
  const refundDue = Math.max(0, totalTaxesPaid - totalTaxWithCess);

  return {
    assessmentYear: ayConfig.assessmentYear,
    regime,
    grossSalary,
    standardDeduction: stdDeduction,
    grossTotalIncome,
    totalDeductions,
    netTaxableIncome,
    calculatedTax: Math.round(calculatedTax),
    cess,
    totalTaxWithCess,
    totalTaxesPaid,
    netTaxPayable,
    refundDue
  };
}

