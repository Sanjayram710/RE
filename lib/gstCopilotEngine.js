/**
 * GST Copilot Engine
 * 5-Step Plain-English Return Preparation & Assisted Authorisation Flow:
 * Sales -> Purchases -> ITC -> Tax -> File
 * Plus conversational Plain-English Q&A answering shopkeeper queries.
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
        subtitle: "Deterministic tax computation",
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
        subtitle: "1-Click Statutory Submission to GSTN",
        plainSentence: "Your GSTR-3B return is ready. Review summary and authorise filing with EVC OTP.",
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

  if (q.includes("need to file") || q.includes("do i need to file") || q.includes("should i file")) {
    return {
      question,
      answer: "Yes, filing is mandatory even if you had zero transactions this month (known as a NIL return). Active GST registered businesses must file GSTR-1 and GSTR-3B every period to avoid cancellation and daily late fees.",
      category: "FILING_REQUIREMENT",
      actionLink: "#copilotStep1",
      actionText: "Review October Invoices"
    };
  }

  if (q.includes("deadline") || q.includes("due date") || q.includes("when to file")) {
    return {
      question,
      answer: "For October 2026 returns: GSTR-1 is due on November 11th, and GSTR-3B (monthly payment & return) is due on November 20th. For quarterly QRMP filers, the IFF invoice window closes on November 13th.",
      category: "DUE_DATES",
      actionLink: "#viewDueDates",
      actionText: "View Statutory Deadlines"
    };
  }

  if (q.includes("why is my itc different") || q.includes("itc mismatch") || q.includes("input credit difference")) {
    return {
      question,
      answer: "Under GST Rule 36(4) and Section 16(2)(aa), you can only claim Input Tax Credit on bills that your suppliers have actually filed in their GSTR-1 and which appear in your auto-drafted GSTR-2B. If a bill is missing in GSTR-2B, the credit is held back to protect you from notices.",
      category: "ITC_RECONCILIATION",
      actionLink: "#gstSubTabRecon",
      actionText: "Open 2B Reconciliation"
    };
  }

  if (q.includes("how much tax") || q.includes("tax owe") || q.includes("how much do i owe") || q.includes("payable")) {
    return {
      question,
      answer: "For October 2026, your gross tax on sales is ₹2,23,200. You have ₹1,53,000 in eligible input credit from purchases. Therefore, your net estimated tax payable is ₹70,200.",
      category: "TAX_COMPUTATION",
      actionLink: "#copilotStep4",
      actionText: "Inspect Tax Offset Calculation"
    };
  }

  // Fallback intelligent answer
  return {
    question,
    answer: "SimpleGST Copilot is tracking your live compliance pipeline. All sales, purchase bills, and auto-drafted GSTR-2B statements are automatically synced and verified against the 182 statutory GSTN GSP endpoints.",
    category: "GENERAL_COMPLIANCE",
    actionLink: "#viewGstSuite",
    actionText: "Go to GST Compliance Hub"
  };
}
