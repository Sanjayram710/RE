/**
 * MCA (Ministry of Corporate Affairs) Engine
 * Validates 21-character Corporate Identification Numbers (CIN)
 * and resolves statutory corporate registry records.
 */

// CIN format regex: 
// 1 char: Listing status (L = Listed, U = Unlisted)
// 5 digits: Industry / Economic activity code
// 2 chars: State code (e.g. KA, MH, DL, KL)
// 4 digits: Year of incorporation
// 3 chars: Company type (PTC = Private, PLC = Public, LLP, SGC, GOI, FTC, etc.)
// 6 digits: Registration number
export const CIN_REGEX = /^[UL]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/;

// Known statutory demo entities for instant lookup & mock registry
const MCA_REGISTRY = new Map([
  [
    "U72900KA2020PTC123456",
    {
      cin: "U72900KA2020PTC123456",
      companyName: "MALABAR TECH SOLUTIONS PRIVATE LIMITED",
      roc: "RoC-Bangalore",
      registrationNumber: "123456",
      incorporationDate: "15/06/2020",
      companyCategory: "Company limited by Shares",
      companySubCategory: "Non-govt company",
      classOfCompany: "Private",
      authorizedCapital: 10000000,
      paidUpCapital: 2500000,
      listingStatus: "Unlisted",
      registeredAddress: "42, Residency Road, MG Road Corridor, Bengaluru, Karnataka 560025",
      directors: [
        { din: "08765432", name: "Anil Kumar Menon", designation: "Director", appointmentDate: "15/06/2020" },
        { din: "08765433", name: "Sunita Ramachandran", designation: "Managing Director", appointmentDate: "15/06/2020" }
      ],
      complianceStatus: "ACTIVE",
      lastAgmDate: "30/09/2026",
      lastBalanceSheetDate: "31/03/2026"
    }
  ],
  [
    "U51909KL2018PTC054321",
    {
      cin: "U51909KL2018PTC054321",
      companyName: "MALABAR SPICE TRADERS PRIVATE LIMITED",
      roc: "RoC-Ernakulam",
      registrationNumber: "054321",
      incorporationDate: "12/03/2018",
      companyCategory: "Company limited by Shares",
      companySubCategory: "Non-govt company",
      classOfCompany: "Private",
      authorizedCapital: 5000000,
      paidUpCapital: 1500000,
      listingStatus: "Unlisted",
      registeredAddress: "Door No. 14/220, Spice Market, Mattancherry, Kochi, Kerala 682002",
      directors: [
        { din: "07123456", name: "Anil Varma", designation: "Director", appointmentDate: "12/03/2018" },
        { din: "07123457", name: "Priya Varma", designation: "Director", appointmentDate: "12/03/2018" }
      ],
      complianceStatus: "ACTIVE",
      lastAgmDate: "28/09/2026",
      lastBalanceSheetDate: "31/03/2026"
    }
  ],
  [
    "L72200MH1995PLC085600",
    {
      cin: "L72200MH1995PLC085600",
      companyName: "HORIZON ENTERPRISE SYSTEMS LIMITED",
      roc: "RoC-Mumbai",
      registrationNumber: "085600",
      incorporationDate: "04/08/1995",
      companyCategory: "Company limited by Shares",
      companySubCategory: "Indian Non-Government Company",
      classOfCompany: "Public",
      authorizedCapital: 500000000,
      paidUpCapital: 200000000,
      listingStatus: "Listed",
      registeredAddress: "Express Towers, 14th Floor, Nariman Point, Mumbai, Maharashtra 400021",
      directors: [
        { din: "00112233", name: "Rajesh S. Mehta", designation: "Chairman & Director", appointmentDate: "04/08/1995" },
        { din: "00223344", name: "Kavita R. Mehta", designation: "Whole-time Director", appointmentDate: "10/01/2002" }
      ],
      complianceStatus: "ACTIVE",
      lastAgmDate: "15/09/2026",
      lastBalanceSheetDate: "31/03/2026"
    }
  ]
]);

export function validateCin(cin) {
  if (!cin || typeof cin !== "string") {
    return { valid: false, error: "CIN is required and must be a string." };
  }
  const cleanCin = cin.trim().toUpperCase();
  if (cleanCin.length !== 21) {
    return { valid: false, error: `CIN must be exactly 21 characters (got ${cleanCin.length}).` };
  }
  if (!CIN_REGEX.test(cleanCin)) {
    return {
      valid: false,
      error: "Invalid CIN structure. Format must match: [U/L][5-digit industry][2-char state][4-digit year][PTC/PLC/LLP][6-digit reg number]."
    };
  }

  // Decode structural elements
  const isListed = cleanCin[0] === "L";
  const industryCode = cleanCin.substring(1, 6);
  const stateCode = cleanCin.substring(6, 8);
  const incorporationYear = parseInt(cleanCin.substring(8, 12), 10);
  const companyType = cleanCin.substring(12, 15);
  const registrationNumber = cleanCin.substring(15, 21);

  return {
    valid: true,
    cin: cleanCin,
    metadata: {
      listingStatus: isListed ? "Listed" : "Unlisted",
      industryCode,
      stateCode,
      incorporationYear,
      companyType,
      registrationNumber
    }
  };
}

export function lookupMcaCompany(cin) {
  const validation = validateCin(cin);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  const cleanCin = validation.cin;
  const existing = MCA_REGISTRY.get(cleanCin);

  if (existing) {
    return {
      success: true,
      found: true,
      source: "MCA_REGISTRY_CACHE",
      company: existing
    };
  }

  // Deterministic mock generation for any valid structural CIN
  const { listingStatus, stateCode, incorporationYear, companyType, registrationNumber } = validation.metadata;
  const isPrivate = companyType === "PTC";
  const companyName = `ENTERPRISE ${registrationNumber} ${isPrivate ? "PRIVATE LIMITED" : "LIMITED"}`;

  const generated = {
    cin: cleanCin,
    companyName,
    roc: `RoC-${stateCode}`,
    registrationNumber,
    incorporationDate: `01/01/${incorporationYear}`,
    companyCategory: "Company limited by Shares",
    companySubCategory: "Non-govt company",
    classOfCompany: isPrivate ? "Private" : "Public",
    authorizedCapital: 1000000,
    paidUpCapital: 100000,
    listingStatus,
    registeredAddress: `Statutory Registered Office, Sector ${registrationNumber.slice(-2)}, State Code ${stateCode}`,
    directors: [
      { din: `09${registrationNumber.slice(0, 6)}`, name: "Authorized Director 1", designation: "Director", appointmentDate: `01/01/${incorporationYear}` },
      { din: `09${registrationNumber.slice(0, 5)}9`, name: "Authorized Director 2", designation: "Director", appointmentDate: `01/01/${incorporationYear}` }
    ],
    complianceStatus: "ACTIVE",
    lastAgmDate: "30/09/2026",
    lastBalanceSheetDate: "31/03/2026"
  };

  return {
    success: true,
    found: true,
    source: "MCA_SIMULATED_REGISTRY",
    company: generated
  };
}

