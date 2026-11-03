/**
 * Startup Express Engine
 * Guided "START MY BUSINESS" onboarding workflow for new entrepreneurs.
 * Handles entity constitution selection, PAN validation, MCA check,
 * GST registration application, and first compliant invoice generation.
 */

import { validatePan } from "./validate.js";
import { lookupMcaCompany } from "./mcaEngine.js";

export const BUSINESS_TYPES = [
  {
    id: "proprietorship",
    title: "Sole Proprietorship",
    description: "Ideal for individual traders, single freelancers, small retail shops.",
    requiredPanType: "Individual (P)",
    panFourthLetter: "P",
    mcaRequired: false,
    documentsNeeded: ["Owner PAN Card", "Aadhaar Card", "Electricity Bill / Rent Agreement", "Bank Cancelled Cheque"],
    turnoverThreshold: "₹40 Lakhs (Goods) / ₹20 Lakhs (Services)"
  },
  {
    id: "partnership",
    title: "Partnership Firm / LLP",
    description: "2 or more partners sharing profits and responsibilities.",
    requiredPanType: "Firm / LLP (F)",
    panFourthLetter: "F",
    mcaRequired: true,
    documentsNeeded: ["Partnership Deed / LLP Agreement", "Firm PAN Card", "Partners PAN & Aadhaar", "Registered Office Address Proof"],
    turnoverThreshold: "₹40 Lakhs (Goods) / ₹20 Lakhs (Services)"
  },
  {
    id: "pvt_ltd",
    title: "Private Limited Company",
    description: "Independent legal entity, limited liability, investor & venture ready.",
    requiredPanType: "Company (C)",
    panFourthLetter: "C",
    mcaRequired: true,
    documentsNeeded: ["Certificate of Incorporation (CIN)", "MOA & AOA", "Company PAN Card", "Director DIN & Identity Proofs"],
    turnoverThreshold: "Mandatory GST if interstate supply or > ₹20/40 Lakhs"
  },
  {
    id: "opc",
    title: "One Person Company (OPC)",
    description: "Corporate structure with single founder and corporate protection.",
    requiredPanType: "Company (C)",
    panFourthLetter: "C",
    mcaRequired: true,
    documentsNeeded: ["CIN Certificate", "Nominee Consent Form", "Owner PAN & Aadhaar", "Office Address Proof"],
    turnoverThreshold: "Standard corporate threshold"
  }
];

export function validateStartupApplication({
  businessType = "proprietorship",
  businessName = "",
  ownerName = "",
  pan = "",
  cin = "",
  state = "Kerala",
  stateCode = "32",
  pincode = "682002",
  gstScheme = "regular", // "regular" | "composition"
  bankAccountNumber = "",
  ifscCode = ""
} = {}) {
  const errors = [];
  const selectedType = BUSINESS_TYPES.find(t => t.id === businessType);

  if (!selectedType) {
    errors.push("Invalid business constitution type selected.");
  }

  if (!businessName || businessName.trim().length < 3) {
    errors.push("Trade/Business name must be at least 3 characters.");
  }

  if (!ownerName || ownerName.trim().length < 3) {
    errors.push("Owner/Director name is required.");
  }

  // PAN Check
  const panValidation = validatePan(pan);
  if (!panValidation.valid) {
    errors.push(`Invalid PAN: ${panValidation.error}`);
  } else if (selectedType) {
    const fourthChar = pan.trim().toUpperCase()[3];
    if (selectedType.panFourthLetter && fourthChar !== selectedType.panFourthLetter) {
      errors.push(
        `PAN entity type mismatch: 4th character '${fourthChar}' does not match expected '${selectedType.panFourthLetter}' for ${selectedType.title}.`
      );
    }
  }

  // MCA check for corporate entities
  let mcaDetails = null;
  if (selectedType && selectedType.mcaRequired) {
    if (!cin) {
      errors.push(`CIN number is required for ${selectedType.title}.`);
    } else {
      const mcaRes = lookupMcaCompany(cin);
      if (!mcaRes.success) {
        errors.push(`MCA Corporate lookup failed: ${mcaRes.error}`);
      } else {
        mcaDetails = mcaRes.company;
      }
    }
  }

  if (!pincode || !/^\d{6}$/.test(pincode.trim())) {
    errors.push("Pincode must be exactly 6 digits.");
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  // Generate simulated statutory Application Reference Number (ARN)
  const cleanPan = pan.trim().toUpperCase();
  const randomSuffix = Math.floor(100000 + Math.random() * 900000);
  const provisionalArn = `AA${stateCode}1126${randomSuffix}Z`;
  const provisionalGstin = `${stateCode}${cleanPan}1Z${(randomSuffix % 9) + 1}`;

  // Generate first compliant tax invoice
  const firstInvoice = {
    invoiceNumber: "INV-001",
    invoiceDate: new Date().toISOString().slice(0, 10),
    sellerGstin: provisionalGstin,
    sellerName: businessName,
    buyerName: "First Customer / Walk-in Buyer",
    items: [
      { description: "Professional Services / Goods Delivery", hsn: "998311", qty: 1, rate: 5000, taxableAmount: 5000, gstRate: 18, taxAmount: 900 }
    ],
    totalTaxable: 5000,
    totalTax: 900,
    grandTotal: 5900,
    irnStatus: "READY_FOR_IRN"
  };

  return {
    success: true,
    application: {
      businessType,
      businessTitle: selectedType.title,
      businessName,
      ownerName,
      pan: cleanPan,
      cin: cin ? cin.trim().toUpperCase() : null,
      mcaDetails,
      state,
      stateCode,
      pincode,
      gstScheme,
      bankAccountNumber: bankAccountNumber ? `XXXXXX${bankAccountNumber.slice(-4)}` : "Verified via Penny Drop",
      ifscCode: ifscCode || "HDFC0001234",
      provisionalArn,
      provisionalGstin,
      registrationStatus: "APPROVED_PROVISIONAL",
      effectiveDate: new Date().toISOString().slice(0, 10),
      firstInvoice,
      certificateUrl: `/api/vault/sample-gst-reg-${provisionalArn}.pdf`
    }
  };
}

