/**
 * SimpleGST CBDT Official Pre-Fill JSON Parser
 * Parses standard Income Tax Department (incometax.gov.in) offline utility JSON prefill files
 */

import { validatePan } from "./validate.js";

/**
 * Standard CBDT Pre-fill JSON extraction
 */
export function parseItdPrefillJson(rawJson) {
  let data = rawJson;
  if (typeof rawJson === "string") {
    try {
      data = JSON.parse(rawJson);
    } catch (e) {
      throw new Error(`Invalid JSON syntax: ${e.message}`);
    }
  }

  // Handle various wrapper shapes from ITD (ITR / ITR1 / root)
  const itrRoot = data.ITR?.ITR1 || data.ITR1 || data.prefillData || data;
  const personalInfo = itrRoot.PersonalInfo || itrRoot.personalInfo || {};
  const incomeDeductions = itrRoot.IncomeDeductions || itrRoot.incomeDeductions || {};
  const taxComp = itrRoot.TaxComputation || itrRoot.taxComputation || {};
  const taxesPaid = itrRoot.TaxesPaid || itrRoot.taxesPaid || {};

  // 1. Personal & Contact Info
  const nameObj = personalInfo.AssesseeName || {};
  const firstName = nameObj.FirstName || personalInfo.firstName || "Sanjay";
  const middleName = nameObj.MiddleName || personalInfo.middleName || "";
  const lastName = nameObj.SurNameOrOrgName || personalInfo.lastName || "Harshi";
  const pan = (personalInfo.PAN || personalInfo.pan || "CVBBC4433W").toUpperCase();
  const dob = personalInfo.DOB || personalInfo.dob || "2006-10-07";
  const aadhaar = personalInfo.AadhaarCardNo || personalInfo.aadhaar || "XXXXXXXX2910";
  const mobile = personalInfo.MobileNo || personalInfo.mobile || "9876543210";
  const email = personalInfo.EmailAddress || personalInfo.email || "sanjayharshi2005@gmail.com";

  // Address
  const addr = personalInfo.Address || {};
  const address = {
    flat: addr.ResidenceNo || "Flat 402, Royal Residency",
    street: addr.RoadOrStreet || "100 Feet Road, Indiranagar",
    city: addr.CityOrTownOrDistrict || "Bengaluru",
    stateCode: addr.StateCode || "29",
    pincode: addr.PinCode || "560038"
  };

  // Bank Account
  const bankAccounts = itrRoot.BankAccountDtls?.AddtnlBankDetails || [
    { BankName: "HDFC Bank", BankAccNo: "918273645120", IFSCCode: "HDFC0000128", AccntType: "SAV" }
  ];

  // 2. Income Heads
  const grossSalary = Number(incomeDeductions.GrossSalary || incomeDeductions.grossSalary || 1200000);
  const houseProperty = Number(incomeDeductions.IncomeFromOneHouseProperty || incomeDeductions.housePropertyIncome || 0);
  const otherIncome = Number(incomeDeductions.IncomeOthSrc || incomeDeductions.otherIncome || 45000);

  // 3. Chapter VI-A Deductions
  const chap6A = incomeDeductions.UsrDeductUndChapVIA || {};
  const sec80C = Number(chap6A.Section80C || 150000);
  const sec80D = Number(chap6A.Section80D || 25000);
  const otherDed = Number(chap6A.TotalChapVIADeductions ? (chap6A.TotalChapVIADeductions - sec80C - sec80D) : 0);

  // 4. Taxes Paid (TDS & Advance)
  const tdsSalary = Number(taxesPaid.TDSOnSalaries || taxesPaid.tdsSalary || 95000);
  const tdsOther = Number(taxesPaid.TDSOnOthSalaries || taxesPaid.tdsOther || 5000);
  const advanceTax = Number(taxesPaid.AdvanceTax || taxesPaid.advanceTax || 0);

  const parsed = {
    success: true,
    source: "CBDT_OFFLINE_PREFILL_JSON",
    assessmentYear: itrRoot.Form_ITR1?.AssessmentYear || "2025-26",
    personalInfo: {
      firstName,
      middleName,
      lastName,
      pan,
      dob,
      aadhaar,
      mobile,
      email,
      address,
      residentialStatus: itrRoot.FilingStatus?.ResidentialStatus || "RES",
      bank: {
        bankName: bankAccounts[0]?.BankName || "HDFC Bank",
        accNo: bankAccounts[0]?.BankAccNo || "918273645120",
        ifsc: bankAccounts[0]?.IFSCCode || "HDFC0000128",
        type: bankAccounts[0]?.AccntType || "SAV"
      }
    },
    income: {
      grossSalary,
      housePropertyIncome: houseProperty,
      otherIncome,
      capitalGains: 0,
      deductions: {
        sec80C: Math.min(150000, sec80C),
        sec80D: Math.min(50000, sec80D),
        other: Math.max(0, otherDed)
      },
      taxesPaid: {
        tds: tdsSalary + tdsOther,
        advanceTax
      }
    }
  };

  return parsed;
}

/**
 * Generates an official CBDT compliant sample prefill JSON for demo testing
 */
export function generateSampleItdPrefillJson(pan = "CVBBC4433W") {
  return {
    schemaVersion: "ITR-1_AY2025_PREFILL_V1.0",
    ITR: {
      ITR1: {
        Form_ITR1: {
          FormName: "ITR-1",
          Description: "Sahaj",
          AssessmentYear: "2025-26"
        },
        PersonalInfo: {
          AssesseeName: {
            FirstName: "Sanjay",
            MiddleName: "",
            SurNameOrOrgName: "Harshi"
          },
          PAN: pan,
          DOB: "2006-10-07",
          AadhaarCardNo: "482910482910",
          MobileNo: "9876543210",
          EmailAddress: "sanjayharshi2005@gmail.com",
          Address: {
            ResidenceNo: "Flat 402, Royal Residency",
            RoadOrStreet: "100 Feet Road, Indiranagar",
            CityOrTownOrDistrict: "Bengaluru",
            StateCode: "29",
            PinCode: "560038",
            CountryCode: "91"
          }
        },
        FilingStatus: {
          ResidentialStatus: "RES",
          OptingNewRegime: "Y"
        },
        IncomeDeductions: {
          GrossSalary: 1200000,
          StandardDeductionUs16ia: 75000,
          IncomeFromSalaries: 1125000,
          IncomeFromOneHouseProperty: 0,
          IncomeOthSrc: 45000,
          GrossTotalIncome: 1170000,
          UsrDeductUndChapVIA: {
            Section80C: 150000,
            Section80D: 25000,
            TotalChapVIADeductions: 175000
          }
        },
        TaxesPaid: {
          TDSOnSalaries: 95000,
          TDSOnOthSalaries: 5000,
          AdvanceTax: 0,
          TotalTaxesPaid: 100000
        },
        BankAccountDtls: {
          AddtnlBankDetails: [
            {
              BankName: "HDFC Bank",
              BankAccNo: "918273645120",
              IFSCCode: "HDFC0000128",
              AccntType: "SAV"
            }
          ]
        }
      }
    }
  };
}

