/**
 * Canonical In-Memory and Default Demo Datasets
 * Malabar Spice Traders, Kochi, Kerala (32ABCDE1234F1Z5)
 */

export const DEMO_BUSINESS = {
  tradeName: "Malabar Spice Traders",
  legalName: "Malabar Spice Traders LLP",
  gstin: "32ABCDE1234F1Z5",
  pan: "ABCDE1234F",
  state: "Kerala (32)",
  stateCode: "32",
  city: "Kochi",
  address: "Building 4, Spices Market Yard, Mattancherry, Kochi 682002",
  filingPeriod: "102026",
  periodLabel: "October 2026",
  owner: "Anil Kumar",
  complianceScore: 92
};

export const DEMO_SALES = [
  {
    id: "sale-1",
    invoiceNumber: "MST-2026-101",
    partyName: "Cochin Marine Exports Pvt Ltd",
    partyGstin: "32XYZAB5678C1Z2",
    date: "2026-10-04",
    taxableAmount: 450000,
    gstRate: 18,
    isInterState: false,
    pos: "32",
    igst: 0,
    cgst: 40500,
    sgst: 40500,
    totalTax: 81000,
    totalAmount: 531000,
    type: "B2B",
    status: "matched"
  },
  {
    id: "sale-2",
    invoiceNumber: "MST-2026-102",
    partyName: "Sahyadri Agro Processing LLP",
    partyGstin: "27MNOPE9012D1Z9",
    date: "2026-10-12",
    taxableAmount: 680000,
    gstRate: 18,
    isInterState: true,
    pos: "27",
    igst: 122400,
    cgst: 0,
    sgst: 0,
    totalTax: 122400,
    totalAmount: 802400,
    type: "B2B",
    status: "matched"
  },
  {
    id: "sale-3",
    invoiceNumber: "MST-2026-103",
    partyName: "Travancore Organic Retailers",
    partyGstin: "32TRVAN4433E1Z7",
    date: "2026-10-22",
    taxableAmount: 110000,
    gstRate: 18,
    isInterState: false,
    pos: "32",
    igst: 0,
    cgst: 9900,
    sgst: 9900,
    totalTax: 19800,
    totalAmount: 129800,
    type: "B2B",
    status: "matched"
  }
];

export const DEMO_PURCHASES = [
  {
    id: "pur-1",
    invoiceNumber: "MSW-9912",
    partyName: "Malabar Spice Wholesalers",
    partyGstin: "32KERAL1234A1Z1",
    date: "2026-10-05",
    taxableAmount: 300000,
    gstRate: 18,
    isInterState: false,
    pos: "32",
    igst: 0,
    cgst: 27000,
    sgst: 27000,
    totalTax: 54000,
    totalAmount: 354000,
    type: "B2B",
    status: "hold"
  },
  {
    id: "pur-2",
    invoiceNumber: "DPC-402",
    partyName: "Deccan Packaging Containers Ltd",
    partyGstin: "29KARNA7766B1Z4",
    date: "2026-10-15",
    taxableAmount: 250000,
    gstRate: 18,
    isInterState: true,
    pos: "29",
    igst: 45000,
    cgst: 0,
    sgst: 0,
    totalTax: 45000,
    totalAmount: 295000,
    type: "B2B",
    status: "matched"
  },
  {
    id: "pur-3",
    invoiceNumber: "CPS-108",
    partyName: "Calicut Printing & Stationery Co",
    partyGstin: "32CALIC1234C1Z9",
    date: "2026-10-22",
    taxableAmount: 80000,
    gstRate: 18,
    isInterState: false,
    pos: "32",
    igst: 0,
    cgst: 7200,
    sgst: 7200,
    totalTax: 14400,
    totalAmount: 94400,
    type: "B2B",
    status: "hold"
  },
  {
    id: "pur-4",
    invoiceNumber: "KSP-882",
    partyName: "Kerala Spices & Pepper Hub",
    partyGstin: "32KSPHU1122D1Z3",
    date: "2026-10-28",
    taxableAmount: 155000,
    gstRate: 18,
    isInterState: false,
    pos: "32",
    igst: 0,
    cgst: 13950,
    sgst: 13950,
    totalTax: 27900,
    totalAmount: 182900,
    type: "B2B",
    status: "matched"
  }
];

export const DEMO_EXCEPTIONS = [
  {
    id: "exc-1",
    invoiceNumber: "MSW-9912",
    supplierName: "Malabar Spice Wholesalers",
    supplierGstin: "32KERAL1234A1Z1",
    taxAmount: 5400,
    reason: "Supplier has not filed GSTR-1 for October 2026 (Missing in 2B)",
    status: "hold"
  },
  {
    id: "exc-2",
    invoiceNumber: "CPS-108",
    supplierName: "Calicut Printing & Stationery Co",
    supplierGstin: "32CALIC1234C1Z9",
    taxAmount: 4200,
    reason: "Invoice date discrepancy: recorded as 15-Aug in books but reported as 15-Sep in 2B",
    status: "hold"
  }
];

export const DEMO_RECONCILIATION = {
  period: "102026",
  gstin: "32ABCDE1234F1Z5",
  items: [
    {
      invoiceNo: "DPC-402",
      supplier: "Deccan Packaging Containers Ltd",
      gstin: "29KARNA7766B1Z4",
      date: "2026-10-15",
      booksTax: 45000,
      gstr2bTax: 45000,
      status: "Matched",
      action: "Accept",
      reason: "Exact match in GSTIN, invoice number and tax amount"
    },
    {
      invoiceNo: "KSP-882",
      supplier: "Kerala Spices & Pepper Hub",
      gstin: "32KSPHU1122D1Z3",
      date: "2026-10-28",
      booksTax: 27900,
      gstr2bTax: 27900,
      status: "Matched",
      action: "Accept",
      reason: "Exact match"
    },
    {
      invoiceNo: "MSW-9912",
      supplier: "Malabar Spice Wholesalers",
      gstin: "32KERAL1234A1Z1",
      date: "2026-10-05",
      booksTax: 5400,
      gstr2bTax: 0,
      status: "Missing in 2B",
      action: "Hold",
      reason: "Supplier has not uploaded invoice to GSTN yet"
    },
    {
      invoiceNo: "CPS-108",
      supplier: "Calicut Printing & Stationery Co",
      gstin: "32CALIC1234C1Z9",
      date: "2026-10-22",
      booksTax: 4200,
      gstr2bTax: 4200,
      status: "Mismatch",
      action: "Hold",
      reason: "Invoice date difference: books show 15-Aug, 2B shows 15-Sep"
    }
  ]
};

export const DEMO_ITR = {
  assessmentYear: "2025-26",
  financialYear: "2024-25",
  taxRegime: "NEW",
  personalInfo: {
    firstName: "Rohan",
    lastName: "Sharma",
    pan: "ABCDE1234F",
    dob: "1992-08-24",
    aadhaar: "XXXXXXXX8899",
    mobile: "9845012345",
    email: "rohan.sharma@example.com",
    address: { locality: "Bellandur", stateCode: "KA" }
  },
  income: {
    grossSalary: 1650000,
    housePropertyIncome: -180000,
    otherIncome: 45000,
    deductions: { sec80C: 150000, sec80D: 25000, other: 10000 },
    taxesPaid: { tds: 140000, advanceTax: 15000 }
  }
};
