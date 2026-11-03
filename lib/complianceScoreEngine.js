/**
 * Business Compliance Score Engine
 * Computes a weighted statutory compliance score (0–100 scale)
 * with Green / Amber / Red (RAG) traffic-light indicators.
 */

export function calculateComplianceScore({
  gstinStatus = "ACTIVE",
  gstr1Filed = true,
  gstr3bFiled = true,
  itcMismatchesCount = 0,
  delinquentVendorsCount = 0,
  taxPaidOnTime = true,
  panAadhaarLinked = true
} = {}) {
  let score = 0;
  const breakdown = [];

  // 1. GST Registration Status (Max: 20 pts)
  if (gstinStatus === "ACTIVE") {
    score += 20;
    breakdown.push({
      item: "GST Registration Status",
      category: "REGISTRATION",
      status: "PASS",
      points: 20,
      maxPoints: 20,
      badge: "GREEN",
      message: "GSTIN is Active and verified on statutory portal."
    });
  } else if (gstinStatus === "SUSPENDED") {
    score += 5;
    breakdown.push({
      item: "GST Registration Status",
      category: "REGISTRATION",
      status: "WARNING",
      points: 5,
      maxPoints: 20,
      badge: "AMBER",
      message: "GSTIN is under statutory suspension. Immediate verification needed."
    });
  } else {
    breakdown.push({
      item: "GST Registration Status",
      category: "REGISTRATION",
      status: "FAIL",
      points: 0,
      maxPoints: 20,
      badge: "RED",
      message: "GSTIN is cancelled or inactive."
    });
  }

  // 2. GSTR-1 Punctuality (Max: 20 pts)
  if (gstr1Filed) {
    score += 20;
    breakdown.push({
      item: "GSTR-1 Outward Supplies Filing",
      category: "RETURNS",
      status: "PASS",
      points: 20,
      maxPoints: 20,
      badge: "GREEN",
      message: "GSTR-1 return filed within statutory due date."
    });
  } else {
    breakdown.push({
      item: "GSTR-1 Outward Supplies Filing",
      category: "RETURNS",
      status: "FAIL",
      points: 0,
      maxPoints: 20,
      badge: "RED",
      message: "GSTR-1 is overdue. Buyers cannot claim ITC."
    });
  }

  // 3. GSTR-3B Summary & Tax Payment (Max: 25 pts)
  if (gstr3bFiled && taxPaidOnTime) {
    score += 25;
    breakdown.push({
      item: "GSTR-3B Tax Offset & Settlement",
      category: "RETURNS",
      status: "PASS",
      points: 25,
      maxPoints: 25,
      badge: "GREEN",
      message: "GSTR-3B filed and output liability settled in full."
    });
  } else if (gstr3bFiled && !taxPaidOnTime) {
    score += 15;
    breakdown.push({
      item: "GSTR-3B Tax Offset & Settlement",
      category: "RETURNS",
      status: "WARNING",
      points: 15,
      maxPoints: 25,
      badge: "AMBER",
      message: "GSTR-3B filed late. Interest liability under Sec 50 applicable."
    });
  } else {
    breakdown.push({
      item: "GSTR-3B Tax Offset & Settlement",
      category: "RETURNS",
      status: "FAIL",
      points: 0,
      maxPoints: 25,
      badge: "RED",
      message: "GSTR-3B return pending. High risk of statutory penalty."
    });
  }

  // 4. GSTR-2B ITC Reconciliation (Max: 15 pts)
  if (itcMismatchesCount === 0) {
    score += 15;
    breakdown.push({
      item: "ITC Reconciliation (Books vs 2B)",
      category: "RECONCILIATION",
      status: "PASS",
      points: 15,
      maxPoints: 15,
      badge: "GREEN",
      message: "100% ITC match. No missing or divergent invoices in 2B."
    });
  } else if (itcMismatchesCount <= 3) {
    score += 10;
    breakdown.push({
      item: "ITC Reconciliation (Books vs 2B)",
      category: "RECONCILIATION",
      status: "WARNING",
      points: 10,
      maxPoints: 15,
      badge: "AMBER",
      message: `${itcMismatchesCount} invoice discrepancies flagged. Review before filing.`
    });
  } else {
    score += 3;
    breakdown.push({
      item: "ITC Reconciliation (Books vs 2B)",
      category: "RECONCILIATION",
      status: "FAIL",
      points: 3,
      maxPoints: 15,
      badge: "RED",
      message: `${itcMismatchesCount} major ITC discrepancies. High risk under Sec 16(2)(aa).`
    });
  }

  // 5. Vendor Compliance Risk (Max: 10 pts)
  if (delinquentVendorsCount === 0) {
    score += 10;
    breakdown.push({
      item: "Supply Chain & Vendor Health",
      category: "VENDOR_RISK",
      status: "PASS",
      points: 10,
      maxPoints: 10,
      badge: "GREEN",
      message: "All counter-party suppliers have active status and timely filings."
    });
  } else {
    score += 4;
    breakdown.push({
      item: "Supply Chain & Vendor Health",
      category: "VENDOR_RISK",
      status: "WARNING",
      points: 4,
      maxPoints: 10,
      badge: "AMBER",
      message: `${delinquentVendorsCount} suppliers have delayed filings or suspended status.`
    });
  }

  // 6. PAN-Aadhaar & Statutory KYC (Max: 10 pts)
  if (panAadhaarLinked) {
    score += 10;
    breakdown.push({
      item: "PAN-Aadhaar & Statutory KYC",
      category: "KYC",
      status: "PASS",
      points: 10,
      maxPoints: 10,
      badge: "GREEN",
      message: "CBDT PAN-Aadhaar linkage active and verified."
    });
  } else {
    breakdown.push({
      item: "PAN-Aadhaar & Statutory KYC",
      category: "KYC",
      status: "FAIL",
      points: 0,
      maxPoints: 10,
      badge: "RED",
      message: "PAN-Aadhaar linkage inoperative. Higher TDS/TCS rates may apply."
    });
  }

  // Overall Rating & Traffic-Light Badge
  let rating = "CRITICAL";
  let badgeColor = "RED";
  if (score >= 85) {
    rating = "EXCELLENT";
    badgeColor = "GREEN";
  } else if (score >= 65) {
    rating = "GOOD";
    badgeColor = "AMBER";
  } else if (score >= 45) {
    rating = "NEEDS_ATTENTION";
    badgeColor = "AMBER";
  }

  const recommendations = [];
  if (itcMismatchesCount > 0) {
    recommendations.push("Resolve pending ITC mismatches in the Reconciliation tab to gain up to +12 points.");
  }
  if (!gstr1Filed) {
    recommendations.push("File GSTR-1 to prevent your customers from losing input tax credit (+20 points).");
  }
  if (!gstr3bFiled) {
    recommendations.push("Settle and file GSTR-3B to avoid statutory interest and penalties (+25 points).");
  }
  if (delinquentVendorsCount > 0) {
    recommendations.push("Send automated withholding notice to delinquent vendors in Vendor Risk Center (+6 points).");
  }
  if (recommendations.length === 0) {
    recommendations.push("All statutory parameters are compliant. Keep maintaining timely filings.");
  }

  return {
    score,
    maxScore: 100,
    rating,
    badgeColor,
    breakdown,
    recommendations,
    generatedAt: new Date().toISOString()
  };
}
