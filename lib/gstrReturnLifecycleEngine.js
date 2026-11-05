/**
 * GSTR Return Lifecycle & Statutory Dependency Engine
 * 
 * Statutory References:
 * - CGST Act Section 37(4): Prohibition on filing GSTR-1 if prior period GSTR-1 is unfiled
 * - CGST Act Section 39(10): Strict sequential prerequisite — GSTR-3B CANNOT be filed
 *   if GSTR-1 for the SAME tax period has not been furnished.
 * - CGST Rule 59(6): Restrictions on furnishing details in GSTR-1 (prior GSTR-3B pendency)
 * - CGST Rule 88C & Form DRC-01B: Outward liability difference check (GSTR-1 vs 3B)
 * - CGST Rule 88D & Form DRC-01C: Inward ITC difference check (GSTR-2B vs 3B)
 * - Production Safety: Explicit SIMULATION MODE watermark; no fabricated ARNs.
 * - Idempotency: Duplicate filing requests for an already-filed return are rejected.
 */

import crypto from 'node:crypto';

// In-memory persistent filing registry for idempotency & filing state verification
const FILED_RETURNS_REGISTRY = new Map();

/**
 * Validates whether GSTR-1 is eligible to be furnished.
 */
export function validateGstr1Prerequisites(context = {}) {
  const errors = [];
  const warnings = [];

  // Check if already filed (Idempotency check)
  const filingKey = `${context.gstin || '32ABCDE1234F1Z5'}_${context.period || '102026'}_GSTR1`;
  if (FILED_RETURNS_REGISTRY.has(filingKey)) {
    const existing = FILED_RETURNS_REGISTRY.get(filingKey);
    errors.push({
      code: 'ERR_ALREADY_FILED',
      message: `GSTR-1 for period ${context.period || '102026'} is ALREADY filed under ARN: ${existing.simulationReferenceId || existing.arn}. Duplicate submission blocked.`
    });
  }

  // 1. Previous period GSTR-1 check u/s 37(4)
  if (context.isPriorPeriodGstr1Pending) {
    errors.push({
      code: 'ERR_SEC_37_4_PRIOR_GSTR1_PENDING',
      section: 'CGST Act Section 37(4)',
      message: 'Cannot file GSTR-1: GSTR-1 for previous tax period is unfiled.'
    });
  }

  // 2. Previous period GSTR-3B check under Rule 59(6)
  if (context.isPriorPeriodGstr3bPending) {
    errors.push({
      code: 'ERR_RULE_59_6_PRIOR_GSTR3B_PENDING',
      rule: 'CGST Rule 59(6)(a)/(b)',
      message: 'GSTR-1 is blocked because GSTR-3B for preceding tax period has not been furnished.'
    });
  }

  // 3. DRC-01B Rule 88C check
  if (context.hasPendingDrc01b) {
    errors.push({
      code: 'ERR_RULE_88C_DRC01B_PENDING',
      rule: 'CGST Rule 88C read with Rule 59(6)(d)',
      message: 'GSTR-1 filing blocked: Pending Form DRC-01B intimation regarding tax discrepancy exceeding 20% / ₹25 Lakhs.'
    });
  }

  // 4. Data validation
  if (!context.invoices || context.invoices.length === 0) {
    if (!context.isNilReturn) {
      warnings.push({
        code: 'WARN_NO_INVOICES',
        message: 'No outward invoices found. If no supplies were made, file as Nil GSTR-1.'
      });
    }
  }

  return {
    canFileGstr1: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Validates whether GSTR-3B is eligible to be furnished.
 * STRICT ENFORCEMENT OF SECTION 39(10).
 */
export function validateGstr3bPrerequisites(context = {}) {
  const errors = [];
  const warnings = [];

  // Check if already filed (Idempotency check)
  const filingKey = `${context.gstin || '32ABCDE1234F1Z5'}_${context.period || '102026'}_GSTR3B`;
  if (FILED_RETURNS_REGISTRY.has(filingKey)) {
    const existing = FILED_RETURNS_REGISTRY.get(filingKey);
    errors.push({
      code: 'ERR_ALREADY_FILED',
      message: `GSTR-3B for period ${context.period || '102026'} is ALREADY filed under ARN: ${existing.simulationReferenceId || existing.arn}. Duplicate submission blocked.`
    });
  }

  // Statutory blocker 1: Section 39(10) - GSTR-1 for SAME period must be FILED
  if (!context.isCurrentPeriodGstr1Filed) {
    errors.push({
      code: 'ERR_SEC_39_10_GSTR1_NOT_FILED',
      section: 'CGST Act Section 39(10)',
      message: 'Statutory Blocker: GSTR-3B cannot be filed until GSTR-1 for the same tax period has been successfully furnished and ARN is generated.'
    });
  }

  // Statutory blocker 2: Prior period GSTR-3B must be filed
  if (context.isPriorPeriodGstr3bPending) {
    errors.push({
      code: 'ERR_SEC_39_10_PRIOR_GSTR3B_PENDING',
      section: 'CGST Act Section 39(10)',
      message: 'Statutory Blocker: GSTR-3B for previous tax period is unfiled.'
    });
  }

  // Statutory blocker 3: DRC-01C Rule 88D ITC mismatch
  if (context.hasPendingDrc01c) {
    errors.push({
      code: 'ERR_RULE_88D_DRC01C_PENDING',
      rule: 'CGST Rule 88D read with Rule 59(6)(e)',
      message: 'Filing blocked: Unresolved DRC-01C notice regarding ITC excess claim over GSTR-2B exceeding 20%.'
    });
  }

  // Taxpayer authorization requirement
  if (!context.isTaxpayerAuthorized) {
    errors.push({
      code: 'ERR_TAXPAYER_AUTHORIZATION_REQUIRED',
      message: 'Statutory Declaration: Taxpayer or Authorized Signatory must review and digitally authorize return filing.'
    });
  }

  return {
    canFileGstr3b: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Executes a simulated return filing with strict environmental truthfulness.
 * Never fabricates real GSTN ARNs; generates cryptographic simulation audit receipt.
 */
export function simulateReturnFiling(returnType, payload = {}, isLiveMode = false) {
  const gstin = payload.gstin || '32ABCDE1234F1Z5';
  const period = payload.period || '102026';
  const retType = (returnType || 'GSTR3B').toUpperCase();

  if (isLiveMode) {
    throw new Error('Live GSTN Filing requires active production GSP credentials & Digital Signature Certificate (DSC / EVC).');
  }

  // Check idempotency in simulation registry
  const filingKey = `${gstin}_${period}_${retType}`;
  if (FILED_RETURNS_REGISTRY.has(filingKey)) {
    throw new Error(`Statutory Error: Return ${retType} for period ${period} has already been filed. Duplicate filing is prohibited.`);
  }

  const timestamp = new Date().toISOString();
  const rawData = JSON.stringify(payload) + timestamp;
  const auditDigest = crypto.createHash('sha256').update(rawData).digest('hex').slice(0, 16).toUpperCase();

  const record = {
    status: 'SUCCESS',
    mode: 'SIMULATION',
    watermark: '[SIMULATION MODE — NOT FILED ON GSTN COMMON PORTAL]',
    returnType: retType,
    period,
    gstin,
    filingTimestamp: timestamp,
    simulationReferenceId: `SIM-ARN-${retType}-${auditDigest}`,
    auditChecksum: auditDigest,
    disclaimer: 'This is an internal architectural simulation and validation run. No data has been submitted to the government GSTN servers. Live filing requires authorized GSP/ASP connectivity.',
    statutoryDeclarationAcknowledged: true
  };

  FILED_RETURNS_REGISTRY.set(filingKey, record);
  return record;
}

/**
 * Reset filing registry (for testing)
 */
export function resetFilingRegistry() {
  FILED_RETURNS_REGISTRY.clear();
}
