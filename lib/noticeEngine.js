/**
 * SimpleGST Notice Defense, Intimation Diff & Scrutiny Engine
 * Handles Section 143(1) Intimations, Section 139(9) Defective Notices, and Section 148
 */

export const NOTICE_SECTIONS = {
  "143(1)": {
    name: "Section 143(1) Summary Intimation",
    description: "Intimation issued by CPC Bengaluru reflecting mathematical variances, mismatch in TDS credit, or disallowed Chapter VI-A deductions.",
    typicalRemedy: "File rectification request u/s 154 or agree/disagree on e-Filing portal."
  },
  "139(9)": {
    name: "Section 139(9) Defective Return Notice",
    description: "Notice issued when return is incomplete, gross turnover doesn't reconcile, or mandatory balance sheet schedules are omitted.",
    typicalRemedy: "Submit corrected rectification JSON within 15 days."
  },
  "148": {
    name: "Section 148 Income Escaping Assessment",
    description: "Notice proposing reassessment when assessing officer has reason to believe taxable income escaped assessment.",
    typicalRemedy: "Demand reasons recorded and furnish return in response."
  }
};

/**
 * Computes side-by-side diff between filed return and 143(1) CPC computation
 */
export function analyzeNoticeDiscrepancies(filedData = {}, intimationData = {}) {
  const filedSalary = Number(filedData.grossSalary ?? 1200000);
  const intimSalary = Number(intimationData.grossSalary ?? 1200000);

  const filedDeductions = Number(filedData.deductions ?? 175000);
  const intimDeductions = Number(intimationData.deductions ?? 150000); // e.g. 25k 80D disallowed

  const filedTds = Number(filedData.tdsCredit ?? 95000);
  const intimTds = Number(intimationData.tdsCredit ?? 80000); // 15k TDS variance

  const filedTaxLiability = Number(filedData.taxLiability ?? 71500);
  const intimTaxLiability = Number(intimationData.taxLiability ?? 98200);

  const diffItems = [
    {
      head: "Gross Salary (17(1))",
      filed: filedSalary,
      assessed: intimSalary,
      variance: intimSalary - filedSalary,
      reason: intimSalary === filedSalary ? "Matched with Form 16 Part A" : "Difference in employer Form 24Q reporting"
    },
    {
      head: "Chapter VI-A Deductions",
      filed: filedDeductions,
      assessed: intimDeductions,
      variance: intimDeductions - filedDeductions,
      reason: intimDeductions < filedDeductions ? "Section 80D health insurance evidence unverified in AIS" : "Allowed in full"
    },
    {
      head: "TDS Credit Claimed (26AS)",
      filed: filedTds,
      assessed: intimTds,
      variance: intimTds - filedTds,
      reason: intimTds < filedTds ? "PAN mistype or deductor filed revised Form 24Q late" : "Matched with 26AS ledger"
    },
    {
      head: "Net Tax Liability / Demand",
      filed: filedTaxLiability,
      assessed: intimTaxLiability,
      variance: intimTaxLiability - filedTaxLiability,
      reason: intimTaxLiability > filedTaxLiability ? "Net Demand raised by CPC with Section 234B interest" : "Zero net demand"
    }
  ];

  const netDemand = Math.max(0, intimTaxLiability - intimTds - (filedTaxLiability - filedTds));

  return {
    success: true,
    din: intimationData.din || `CPC/2526/${Date.now().toString().slice(-8)}`,
    section: intimationData.section || "143(1)",
    assessmentYear: intimationData.assessmentYear || "2025-26",
    status: netDemand > 0 ? "Outstanding Demand Raised" : "Refund Adjustment",
    netDemandAmount: Math.round(netDemand),
    discrepancyMatrix: diffItems,
    recommendedRemedy: netDemand > 0 ? "Submit Rectification Request u/s 154 with employer TDS reconciliation" : "No adverse action required"
  };
}

/**
 * Generates a formal statutory legal draft response to an ITD notice
 */
export function generateStatutoryReplyDraft(noticeDetails = {}) {
  const pan = (noticeDetails.pan || "CVBBC4433W").toUpperCase();
  const din = noticeDetails.din || "CPC/2526/89401283";
  const section = noticeDetails.section || "143(1)";
  const ay = noticeDetails.assessmentYear || "2025-26";
  const assesseeName = noticeDetails.clientName || "Sanjay Harshi";

  const legalGrounds = [
    `1. That the Assessee, ${assesseeName} (PAN: ${pan}), has duly e-filed the return of income for AY ${ay} on or before the statutory due date specified u/s 139(1).`,
    `2. That in the Intimation/Notice bearing DIN ${din} issued u/s ${section}, a variance of ₹${Number(noticeDetails.varianceAmount || 15000).toLocaleString("en-IN")} has been computed in TDS credit / deductions.`,
    `3. That the deduction claimed under Chapter VI-A is supported by bonafide receipts and certificates in compliance with the provisions of the Income-tax Act, 1961.`,
    `4. That the deductor has deposited the TDS to the credit of the Central Government, and the discrepancy arises solely on account of timing differences in deductor's quarterly quarterly statement processing.`,
    `5. It is therefore respectfully prayed that the said demand be rectified u/s 154 and the refund due to the assessee be processed without any adverse interest charge.`
  ];

  return {
    success: true,
    din,
    section,
    date: new Date().toISOString().split("T")[0],
    pan,
    assesseeName,
    subject: `Response to Notice/Intimation u/s ${section} for AY ${ay} bearing DIN: ${din}`,
    legalGrounds,
    fullDraftText: [
      `To,`,
      `The Assessing Officer / Centralized Processing Centre,`,
      `Income Tax Department, Bengaluru - 560500.\n`,
      `Sub: Formal Objection & Written Submission in response to Notice u/s ${section} for AY ${ay} - DIN: ${din}\n`,
      `Respected Sir/Madam,`,
      `I, ${assesseeName}, holding PAN ${pan}, submit the following factual and statutory clarifications:\n`,
      legalGrounds.join("\n\n"),
      `\nYours faithfully,`,
      `${assesseeName}`,
      `Date: ${new Date().toISOString().split("T")[0]}`
    ].join("\n")
  };
}

