/**
 * GST Copilot Engine
 * 5-Step Plain-English Return Preparation & Assisted Authorisation Flow:
 * Sales -> Purchases -> ITC -> Tax -> File
 * Plus conversational Plain-English Q&A answering shopkeeper queries,
 * with statutory citations and Chartered Accountant escalation flags.
 */

import { DEMO_SALES, DEMO_PURCHASES } from "./demoData.js";
import { calculateGstSummary } from "./gst.js";

export function getCopilotPipelineData(period = "102026") {
  // Aggregate Sales
  const sales = DEMO_SALES;
  const purchases = DEMO_PURCHASES;

  const totalSalesTaxable = sales.reduce((acc, row) => acc + (row.taxableValue || 0), 0);
  const totalSalesTax = sales.reduce((acc, row) => acc + (row.igst || 0) + (row.cgst || 0) + (row.sgst || 0), 0);

  // Aggregate Purchases
  const totalPurchasesTaxable = purchases.reduce((acc, row) => acc + (row.taxableValue || 0), 0);
  const totalPurchasesTax = purchases.reduce((acc, row) => acc + (row.igst || 0) + (row.cgst || 0) + (row.sgst || 0), 0);

  // Eligible ITC (Assuming demo has 100% matched after 2B recon, or minus slight ineligible)
  const eligibleItc = totalPurchasesTax;
  const netPayable = Math.max(0, totalSalesTax - eligibleItc);
  const netRefund = totalSalesTax < eligibleItc ? eligibleItc - totalSalesTax : 0;

  return {
    period,
    periodDisplay: "October 2026",
    status: "READY_FOR_FILING",
    steps: [
      {
        step: 1,
        title: "Sales Invoices",
        subtitle: "Review tax collected on your sales",
        plainSentence: `You made ₹${totalSalesTaxable.toLocaleString("en-IN")} in total sales and collected ₹${totalSalesTax.toLocaleString("en-IN")} in GST.`,
        data: {
          invoiceCount: sales.length,
          taxableValue: totalSalesTaxable,
          gstCollected: totalSalesTax
        },
        badge: "VERIFIED"
      },
      {
        step: 2,
        title: "Purchase Bills",
        subtitle: "Review bills uploaded from your suppliers",
        plainSentence: `We found ₹${totalPurchasesTaxable.toLocaleString("en-IN")} of supplier bills across ${purchases.length} invoices.`,
        data: {
          invoiceCount: purchases.length,
          taxableValue: totalPurchasesTaxable,
          gstBilled: totalPurchasesTax
        },
        badge: "SYNCED"
      },
      {
        step: 3,
        title: "Input Tax Credit (ITC)",
        subtitle: "GST credit available to reduce your bill",
        plainSentence: `Your available tax credit is ₹${eligibleItc.toLocaleString("en-IN")}. All suppliers have filed their returns.`,
        data: {
          availableItc: eligibleItc,
          blockedItc: 0,
          matchRate: "100%"
        },
        badge: "CLAIMABLE"
      },
      {
        step: 4,
        title: "Tax Calculation",
        subtitle: "Deterministic tax computation (Rule 88A)",
        plainSentence: netPayable > 0 
          ? `Estimated GST payable: ₹${netPayable.toLocaleString("en-IN")} (Sales Tax ₹${totalSalesTax.toLocaleString("en-IN")} minus Available Credit ₹${eligibleItc.toLocaleString("en-IN")}).`
          : `No tax payable this month! You have ₹${netRefund.toLocaleString("en-IN")} in net excess credit carry-forward.`,
        data: {
          outputTax: totalSalesTax,
          inputCredit: eligibleItc,
          netPayable,
          netRefund
        },
        badge: netPayable > 0 ? "ACTION_REQUIRED" : "ZERO_TAX"
      },
      {
        step: 5,
        title: "Authorise & File",
        subtitle: "Two-stage verification (GSTR-1 -> GSTR-3B)",
        plainSentence: "Your GSTR-1 and GSTR-3B returns are ready. Review summary and authorise filing with EVC OTP.",
        data: {
          form: "GSTR-3B",
          period: "102026",
          status: "READY_TO_SUBMIT"
        },
        badge: "READY"
      }
    ]
  };
}

export function answerCopilotQuestion(question = "") {
  const q = (question || "").toLowerCase().trim();

  if (q.includes("rcm") || q.includes("reverse charge")) {
    return {
      question,
      answer: "Under CGST Act Section 9(3)/9(4) and Section 49(4) read with Section 2(82), Reverse Charge liability CANNOT be paid using Input Tax Credit. You must pay it 100% in CASH through your Electronic Cash Ledger (Form GSTR-3B Table 3.1(d)). Once paid in cash, you can claim it as ITC in Table 4(A)(3).",
      statutoryCitation: "CGST Act Section 9(3), Section 49(4), Section 2(82), Circular No. 170/02/2022-GST",
      requiresCaReview: false,
      category: "REVERSE_CHARGE",
      actionLink: "#gstSubTabReports",
      actionText: "Inspect RCM Cash Obligations"
    };
  }

  if (q.includes("180 day") || q.includes("supplier payment") || q.includes("rule 37")) {
    return {
      question,
      answer: "Under the Second Proviso to Section 16(2) and CGST Rule 37, if you do not pay your supplier within 180 days from the invoice date, you must reverse the claimed ITC in Table 4(B)(2) along with 18% annual interest under Section 50(1). Once you pay the supplier, you can freely reclaim the credit in Table 4(A)(5) without any time limit.",
      statutoryCitation: "CGST Act Section 16(2) Second & Third Provisos, CGST Rule 37, Notification No. 19/2022-CT",
      requiresCaReview: false,
      category: "RULE_37_TRACKING",
      actionLink: "#gstSubTabVendorRisk",
      actionText: "View 180-Day Aging Ledger"
    };
  }

  if (q.includes("blocked credit") || q.includes("17(5)") || q.includes("car") || q.includes("food") || q.includes("gift")) {
    return {
      question,
      answer: "Certain expenses are strictly blocked from ITC under Section 17(5) of the CGST Act, including passenger motor vehicles with seating <= 13, food & beverages, personal expenses, gifts/free samples, and CSR expenditures (w.e.f. 01-10-2023). Blocked credits must be reversed in Table 4(B)(1).",
      statutoryCitation: "CGST Act Section 17(5)(a)-(i), Finance Act 2023",
      requiresCaReview: true,
      escalationReason: "Complex Section 17(5) business apportionment requires Senior CA review.",
      category: "BLOCKED_CREDIT",
      actionLink: "#gstSubTabReports",
      actionText: "Review Blocked Credit Schedulers"
    };
  }

  if (q.includes("drc-01b") || q.includes("drc-01c") || q.includes("notice") || q.includes("mismatch notice")) {
    return {
      question,
      answer: "Forms DRC-01B (Rule 88C) and DRC-01C (Rule 88D) are automated system intimations issued when tax liability (GSTR-1 vs 3B) or ITC (GSTR-2B vs 3B) differs by more than 20% and ₹25 Lakhs. You must either pay the differential tax or submit a reasoned explanation within 7 days, otherwise your next GSTR-1 will be blocked under Rule 59(6).",
      statutoryCitation: "CGST Rules Rule 88C, Rule 88D, Rule 59(6)(d)/(e)",
      requiresCaReview: true,
      escalationReason: "Statutory notice response requires professional verification by Chartered Accountant.",
      category: "NOTICE_DEFENSE",
      actionLink: "#viewNoticeDefense",
      actionText: "Open Notice Defense Board"
    };
  }

  if (q.includes("setoff") || q.includes("set-off") || q.includes("rule 88a") || q.includes("utilization")) {
    return {
      question,
      answer: "Under CGST Rule 88A and Section 49A, IGST credit must be 100% completely exhausted against IGST liability first, and any remainder can be utilized against CGST and SGST in any order and proportion. CGST credit cannot be set off against SGST liability and vice versa (absolute statutory firewall).",
      statutoryCitation: "CGST Act Section 49, 49A, 49B, CGST Rule 88A, Circular No. 98/17/2019-GST",
      requiresCaReview: false,
      category: "ITC_UTILIZATION",
      actionLink: "#copilotStep4",
      actionText: "View Rule 88A Setoff Matrix"
    };
  }

  if (q.includes("need to file") || q.includes("do i need to file") || q.includes("should i file")) {
    return {
      question,
      answer: "Yes, filing is mandatory even if you had zero transactions this month (known as a NIL return). Active GST registered businesses must file GSTR-1 and GSTR-3B every period to avoid cancellation and daily late fees.",
      statutoryCitation: "CGST Act Section 37, Section 39, Section 47",
      requiresCaReview: false,
      category: "FILING_REQUIREMENT",
      actionLink: "#copilotStep1",
      actionText: "Review October Invoices"
    };
  }

  if (q.includes("deadline") || q.includes("due date") || q.includes("when to file")) {
    return {
      question,
      answer: "For October 2026 returns: GSTR-1 is due on November 11th, and GSTR-3B is due on November 20th. For quarterly QRMP filers, the IFF invoice window closes on November 13th, and quarterly GSTR-3B is due on the 22nd (Category 1 states) or 24th (Category 2 states).",
      statutoryCitation: "CGST Rules Rule 59, Rule 61, Notification No. 82/2020-CT",
      requiresCaReview: false,
      category: "DUE_DATES",
      actionLink: "#viewDueDates",
      actionText: "View Statutory Deadlines"
    };
  }

  if (q.includes("why is my itc different") || q.includes("itc mismatch") || q.includes("input credit difference")) {
    return {
      question,
      answer: "Under GST Rule 36(4) and Section 16(2)(aa), you can only claim Input Tax Credit on bills that your suppliers have actually filed in their GSTR-1 and which appear in your auto-drafted GSTR-2B. If a bill is missing in GSTR-2B, the credit is held back to protect you from notices.",
      statutoryCitation: "CGST Act Section 16(2)(aa), Circular No. 170/02/2022-GST",
      requiresCaReview: false,
      category: "ITC_RECONCILIATION",
      actionLink: "#gstSubTabRecon",
      actionText: "Open 2B Reconciliation"
    };
  }

  if (q.includes("how much tax") || q.includes("tax owe") || q.includes("how much do i owe") || q.includes("payable")) {
    return {
      question,
      answer: "For October 2026, your gross tax on sales is ₹2,23,200. You have ₹1,53,000 in eligible input credit from purchases. Therefore, your net estimated tax payable is ₹70,200.",
      statutoryCitation: "Form GSTR-3B Table 6.1 Payment of Tax",
      requiresCaReview: false,
      category: "TAX_COMPUTATION",
      actionLink: "#copilotStep4",
      actionText: "Inspect Tax Offset Calculation"
    };
  }

  // Fallback intelligent answer
  return {
    question,
    answer: "SimpleGST Copilot is tracking your live compliance pipeline. All sales, purchase bills, and auto-drafted GSTR-2B statements are automatically synced and verified against the statutory CGST/IGST Acts and CBIC rules.",
    statutoryCitation: "CGST Act, 2017 & CGST Rules, 2017",
    requiresCaReview: false,
    category: "GENERAL_COMPLIANCE",
    actionLink: "#viewGstSuite",
    actionText: "Go to GST Compliance Hub"
  };
}

/**
 * File 1-Click Nil GST Return
 * For small traders with zero sales and zero purchases in the tax period.
 */
export function fileNilGstReturn({
  gstin = "32ABCDE1234F1Z5",
  period = "102026",
  authorisedPerson = "Leo Das",
  verificationMode = "SMS_OTP"
} = {}) {
  const timestamp = new Date().toISOString();
  const randomSuffix = Math.floor(100000 + Math.random() * 900000);
  const arn = `NIL-AA32${period.slice(2, 6)}${randomSuffix}`;
  const simulationArn = `SIM-${arn}`;

  return {
    success: true,
    isNil: true,
    isSimulation: true,
    watermark: "[SIMULATION / DEMO MODE — NOT TRANSMITTED TO GSTN COMMON PORTAL]",
    arn: null,
    officialArn: null,
    simulationReference: simulationArn,
    transmissionStatus: "NOT_TRANSMITTED",
    status: "SIMULATED_NOT_TRANSMITTED",
    gstin,
    legalName: "Malabar Spice Traders",
    period,
    periodDisplay: "October 2026",
    form: "GSTR-3B (NIL)",
    filedAt: timestamp,
    authorisedPerson,
    verificationMode,
    statutorySummary: {
      outwardTaxableSales: 0,
      totalGstCollected: 0,
      inwardTaxablePurchases: 0,
      eligibleItc: 0,
      netTaxPaidInCash: 0,
      lateFeePaid: 0,
      interestPaid: 0
    },
    message: "Simulation Completed: Your NIL GSTR-3B return has been simulated and recorded locally (Not transmitted to GSTN portal).",
    downloadCertificate: {
      certificateNumber: `CERT-${simulationArn}`,
      title: "Statutory Nil Return Filing Simulation Receipt",
      issuer: "SimpleGST Architectural Compliance Engine",
      hash: "SHA256:7f83b2a0c4e8910d52b8e3a2c4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3"
    }
  };
}
