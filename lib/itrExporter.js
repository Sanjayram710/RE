/**
 * ITR Export Engine - Mirrors ClearTax's ITR-1 / ITR-2 JSON Generation Workflow
 * Generates CBDT e-Filing Schema compliant JSON for offline upload to incometax.gov.in
 */

export function validatePan(pan) {
  const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
  return panRegex.test(pan);
}

export function computeTaxLiability(incomeData, regime = "NEW") {
  const salary = Number(incomeData.grossSalary || 0);
  const houseProperty = Number(incomeData.housePropertyIncome || 0);
  const otherIncome = Number(incomeData.otherIncome || 0);
  
  // Standard deduction
  const standardDeduction = regime === "NEW" ? 75000 : 50000;
  
  // Deductions (80C, 80D, etc.) only apply under Old Regime
  let totalDeductions = 0;
  if (regime === "OLD") {
    const sec80C = Math.min(Number(incomeData.deductions?.sec80C || 0), 150000);
    const sec80D = Math.min(Number(incomeData.deductions?.sec80D || 0), 50000);
    const otherDeductions = Number(incomeData.deductions?.other || 0);
    totalDeductions = sec80C + sec80D + otherDeductions;
  }

  const grossTotalIncome = Math.max(0, salary + houseProperty + otherIncome);
  const netTaxableIncome = Math.max(0, grossTotalIncome - standardDeduction - totalDeductions);

  // Tax Slab Calculation (AY 2025-26 slabs)
  let calculatedTax = 0;
  if (regime === "NEW") {
    // Slabs: 0-3L: Nil, 3-7L: 5%, 7-10L: 10%, 10-12L: 15%, 12-15L: 20%, Above 15L: 30%
    if (netTaxableIncome > 1500000) {
      calculatedTax += (netTaxableIncome - 1500000) * 0.30;
      calculatedTax += 300000 * 0.20;
      calculatedTax += 200000 * 0.15;
      calculatedTax += 300000 * 0.10;
      calculatedTax += 400000 * 0.05;
    } else if (netTaxableIncome > 1200000) {
      calculatedTax += (netTaxableIncome - 1200000) * 0.20;
      calculatedTax += 200000 * 0.15;
      calculatedTax += 300000 * 0.10;
      calculatedTax += 400000 * 0.05;
    } else if (netTaxableIncome > 1000000) {
      calculatedTax += (netTaxableIncome - 1000000) * 0.15;
      calculatedTax += 300000 * 0.10;
      calculatedTax += 400000 * 0.05;
    } else if (netTaxableIncome > 700000) {
      calculatedTax += (netTaxableIncome - 700000) * 0.10;
      calculatedTax += 400000 * 0.05;
    } else if (netTaxableIncome > 300000) {
      calculatedTax += (netTaxableIncome - 300000) * 0.05;
    }

    // Section 87A Rebate for New Regime up to 7L
    if (netTaxableIncome <= 700000) {
      calculatedTax = 0;
    }
  } else {
    // Old Regime: 0-2.5L: Nil, 2.5-5L: 5%, 5-10L: 20%, Above 10L: 30%
    if (netTaxableIncome > 1000000) {
      calculatedTax += (netTaxableIncome - 1000000) * 0.30;
      calculatedTax += 500000 * 0.20;
      calculatedTax += 250000 * 0.05;
    } else if (netTaxableIncome > 500000) {
      calculatedTax += (netTaxableIncome - 500000) * 0.20;
      calculatedTax += 250000 * 0.05;
    } else if (netTaxableIncome > 250000) {
      calculatedTax += (netTaxableIncome - 250000) * 0.05;
    }

    // Section 87A Rebate for Old Regime up to 5L
    if (netTaxableIncome <= 500000) {
      calculatedTax = 0;
    }
  }

  // 4% Health & Education Cess
  const cess = Math.round(calculatedTax * 0.04);
  const totalTaxWithCess = Math.round(calculatedTax + cess);

  // TDS / Advance Tax Paid
  const tdsDeducted = Number(incomeData.taxesPaid?.tds || 0);
  const advanceTax = Number(incomeData.taxesPaid?.advanceTax || 0);
  const totalTaxesPaid = tdsDeducted + advanceTax;

  const netTaxPayable = Math.max(0, totalTaxWithCess - totalTaxesPaid);
  const refundDue = Math.max(0, totalTaxesPaid - totalTaxWithCess);

  return {
    regime,
    grossTotalIncome,
    standardDeduction,
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

/**
 * Generate CBDT Official ITR-1 (Sahaj) e-Filing JSON structure
 */
export function generateITRJson(userData) {
  const pan = (userData.personalInfo?.pan || "").toUpperCase();
  if (!validatePan(pan)) {
    throw new Error(`Invalid PAN structure: ${pan}. Expected 5 letters, 4 digits, 1 letter.`);
  }

  const taxComp = computeTaxLiability(userData.income, userData.taxRegime || "NEW");
  const assessmentYear = userData.assessmentYear || "2025-26";
  const financialYear = userData.financialYear || "2024-25";

  const itrObject = {
    schemaVersion: "ITR-1_AY2025_V1.0",
    generatedAt: new Date().toISOString(),
    generator: "SimpleGST-Export-Engine",
    ITR: {
      ITR1: {
        CreationInfo: {
          SWVersionNo: "1.0.0",
          SWCreatedBy: "SimpleGST-Exporter",
          JSONCreatedBy: "TaxPayer",
          JSONCreationDate: new Date().toISOString().split("T")[0],
          IntermediaryCity: "Bangalore",
          Digest: "a8e9321fb4b62095cc1a88b"
        },
        Form_ITR1: {
          FormName: "ITR-1",
          Description: "Sahaj (For individuals being a resident other than not ordinarily resident)",
          AssessmentYear: assessmentYear
        },
        PersonalInfo: {
          AssesseeName: {
            FirstName: userData.personalInfo.firstName || "Rohan",
            MiddleName: userData.personalInfo.middleName || "",
            SurNameOrOrgName: userData.personalInfo.lastName || "Sharma"
          },
          PAN: pan,
          DOB: userData.personalInfo.dob || "1990-05-15",
          AadhaarCardNo: userData.personalInfo.aadhaar || "XXXXXXXX1234",
          MobileNo: userData.personalInfo.mobile || "9876543210",
          EmailAddress: userData.personalInfo.email || "user@example.com",
          Address: {
            ResidenceNo: userData.personalInfo.address?.flat || "402",
            RoadOrStreet: userData.personalInfo.address?.street || "Indiranagar 100ft Road",
            LocalityOrArea: userData.personalInfo.address?.locality || "Indiranagar",
            CityOrTownOrDistrict: userData.personalInfo.address?.city || "Bangalore",
            StateCode: userData.personalInfo.address?.stateCode || "KA",
            PinCode: userData.personalInfo.address?.pincode || "560038",
            CountryCode: "91"
          },
          EmployerCategory: userData.personalInfo.employerType || "OTH"
        },
        FilingStatus: {
          ReturnFileSec: 11, // Section 139(1) - On or before due date
          OptingNewRegime: userData.taxRegime === "NEW" ? "Y" : "N",
          ResidentialStatus: "RES"
        },
        IncomeDeductions: {
          GrossSalary: userData.income.grossSalary || 0,
          StandardDeductionUs16ia: taxComp.standardDeduction,
          IncomeFromSalaries: Math.max(0, (userData.income.grossSalary || 0) - taxComp.standardDeduction),
          IncomeFromOneHouseProperty: userData.income.housePropertyIncome || 0,
          IncomeOthSrc: userData.income.otherIncome || 0,
          GrossTotalIncome: taxComp.grossTotalIncome,
          UsrDeductUndChapVIA: {
            Section80C: userData.income.deductions?.sec80C || 0,
            Section80D: userData.income.deductions?.sec80D || 0,
            TotalChapVIADeductions: taxComp.totalDeductions
          },
          TotalIncome: taxComp.netTaxableIncome
        },
        TaxComputation: {
          TotalTaxPayable: taxComp.calculatedTax,
          EducationCess: taxComp.cess,
          GrossTaxLiability: taxComp.totalTaxWithCess,
          TotalTaxesPaid: taxComp.totalTaxesPaid,
          BalTaxPayable: taxComp.netTaxPayable,
          RefundDue: taxComp.refundDue
        },
        TaxesPaid: {
          TDSOnSalaries: userData.income.taxesPaid?.tds || 0,
          AdvanceTax: userData.income.taxesPaid?.advanceTax || 0,
          SelfAssessmentTax: 0,
          TotalTaxesPaid: taxComp.totalTaxesPaid
        },
        Verification: {
          Declaration: "I solemnly declare that to the best of my knowledge and belief, the information given in the return is correct and complete.",
          Capacity: "S",
          Place: userData.personalInfo.address?.city || "Bangalore",
          Date: new Date().toISOString().split("T")[0]
        }
      }
    }
  };

  return {
    rawObject: itrObject,
    jsonString: JSON.stringify(itrObject, null, 2),
    summary: taxComp
  };
}

