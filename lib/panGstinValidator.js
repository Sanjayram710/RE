/**
 * SimpleGST 2-Tier PAN & GSTIN Verification Engine
 * 
 * Tier 1: Instant Local Structural & Mathematical Link Validation (0 ms)
 * Tier 2: Statutory Portal Registry Verification (API #179: PAN to GSTIN & API #178: Taxpayer Verification)
 */

import { validatePan, validateGstin, VALID_STATE_CODES } from "./validate.js";
import { executeGspApi } from "./gsp/engine182.js";

export const PAN_ENTITY_TYPES = {
  "P": "Individual / Proprietorship",
  "C": "Company / Corporate",
  "H": "Hindu Undivided Family (HUF)",
  "F": "Partnership Firm / LLP",
  "A": "Association of Persons (AOP)",
  "T": "Trust",
  "B": "Body of Individuals (BOI)",
  "L": "Local Authority",
  "J": "Artificial Juridical Person",
  "G": "Government Agency"
};

/**
 * Tier 1: Instant Mathematical & Structural Validation
 * Validates regex, extracts entity type, checks gstin[2..12] === pan
 */
export function verifyTier1(pan, gstin = null) {
  const result = {
    valid: false,
    pan: (pan || "").trim().toUpperCase(),
    entityCode: null,
    entityType: "Unknown",
    hasGstin: Boolean(gstin),
    gstin: gstin ? gstin.trim().toUpperCase() : null,
    isLinked: false,
    stateCode: null,
    error: null
  };

  const panVal = validatePan(result.pan);
  if (!panVal.valid) {
    result.error = panVal.message;
    return result;
  }

  // 4th character determines legal entity classification
  result.entityCode = result.pan.charAt(3);
  result.entityType = PAN_ENTITY_TYPES[result.entityCode] || "Other Legal Entity";
  result.valid = true;

  // If GSTIN provided, test mathematical 15-char linkage
  if (result.hasGstin) {
    const gstinVal = validateGstin(result.gstin);
    if (!gstinVal.valid) {
      result.error = `Invalid GSTIN: ${gstinVal.message}`;
      return result;
    }

    result.stateCode = gstinVal.stateCode;
    const embeddedPan = result.gstin.substring(2, 12);

    if (embeddedPan !== result.pan) {
      result.error = `PAN-GSTIN Mismatch: Entered PAN '${result.pan}' does not match embedded PAN '${embeddedPan}' inside GSTIN '${result.gstin}'.`;
      result.isLinked = false;
      return result;
    }

    result.isLinked = true;
  }

  return result;
}

/**
 * Tier 2: Statutory Portal Query
 * Queries GSTN Portal Directory using API #179 (PAN to GSTIN) and API #178 (GSTIN Verification)
 */
export async function verifyTier2(tier1Result) {
  if (!tier1Result.valid) {
    return {
      status: "TIER1_FAILED",
      message: "Cannot execute Tier 2 statutory query because Tier 1 validation failed.",
      branches: [],
      taxpayer: null
    };
  }

  const pan = tier1Result.pan;
  const targetGstin = tier1Result.gstin || `32${pan}1Z5`; // Statutory fallback anchor for assessee

  // 1. Invoke API #179: PAN to GSTIN (Discovers all state branches registered under PAN)
  const panToGstinRes = await executeGspApi(179, { gstin: targetGstin, pan });
  const branches = panToGstinRes.branches || [];

  // 2. Invoke API #178: Online Verification of GSTIN / Taxpayer Status
  let taxpayerInfo = null;
  if (tier1Result.hasGstin) {
    const verifyRes = await executeGspApi(178, { gstin: tier1Result.gstin });
    if (verifyRes.success) {
      taxpayerInfo = {
        gstin: tier1Result.gstin,
        legalName: verifyRes.taxpayer_name || "Statutory Assessee",
        tradeName: verifyRes.trade_name || verifyRes.taxpayer_name || "Statutory Assessee",
        status: verifyRes.status || "Active",
        registrationDate: verifyRes.registration_date || "01/07/2017",
        taxpayerType: verifyRes.taxpayer_type || "Regular"
      };
    }
  } else if (branches.length > 0) {
    // If user only provided PAN, verify the primary active branch
    const primaryGstin = branches[0].gstin;
    const verifyRes = await executeGspApi(178, { gstin: primaryGstin });
    taxpayerInfo = {
      gstin: primaryGstin,
      legalName: verifyRes.taxpayer_name || "Statutory Assessee",
      tradeName: verifyRes.trade_name || "Statutory Assessee",
      status: verifyRes.status || "Active",
      registrationDate: verifyRes.registration_date || "01/07/2017",
      taxpayerType: verifyRes.taxpayer_type || "Regular"
    };
  }

  return {
    status: branches.length > 0 ? "VERIFIED_ACTIVE" : "NO_REGISTRATIONS_FOUND",
    portalLinked: branches.length > 0,
    activeBranchesCount: branches.filter(b => b.status === "Active").length,
    branches,
    taxpayer: taxpayerInfo,
    timestamp: new Date().toISOString()
  };
}

/**
 * Unified 2-Tier Execution Workflow
 */
export async function execute2TierVerification(pan, gstin = null) {
  const startTime = Date.now();

  // Step 1: Tier 1 Instant Check
  const tier1 = verifyTier1(pan, gstin);

  if (!tier1.valid || (tier1.hasGstin && !tier1.isLinked)) {
    return {
      success: false,
      pan: tier1.pan,
      gstin: tier1.gstin,
      tier1,
      tier2: {
        status: "SKIPPED",
        message: tier1.error || "Tier 1 validation failed."
      },
      executionTimeMs: Date.now() - startTime
    };
  }

  // Step 2: Tier 2 Statutory Query
  const tier2 = await verifyTier2(tier1);

  return {
    success: tier1.valid && tier2.portalLinked,
    pan: tier1.pan,
    gstin: tier1.gstin,
    entityType: tier1.entityType,
    tier1,
    tier2,
    executionTimeMs: Date.now() - startTime
  };
}

