/**
 * CA Review Registry
 * Generates a single exportable list of every statutory rule reference and
 * plain-English explanation triggered for an active GSTIN + period so a shop
 * owner can hand it directly to a Chartered Accountant.
 *
 * NOTE: Automated checks verify software logic against configured rules; they do
 * not constitute legal advice or guarantee statutory compliance without CA review.
 */
import { analyzeInvoice180Days } from "./supplier180DayTracker.js";

export const CA_DISCLAIMER =
  "Automated software check only — passing system checks prove the software matches its configured rules, not current GST law. Please have a Chartered Accountant review flagged items before filing.";

export function buildCaReviewItems({
  gstin,
  period,
  sales = [],
  purchases = [],
  setoffResult = null,
  reconciliationItems = []
}) {
  const items = [];
  const addItem = (item) => {
    items.push({
      id: `ca-${items.length + 1}`,
      needsCaReview: true,
      gstin: gstin?.gstin || "",
      period,
      ...item,
      disclaimer: CA_DISCLAIMER
    });
  };

  // 1. Rule 88A & Section 49A ITC Cross-Utilization
  if (setoffResult) {
    const u = setoffResult.utilizationMatrix || {};
    const igstCross = (u.igstCreditUtilized?.towardsCgst || 0) + (u.igstCreditUtilized?.towardsSgst || 0);
    const cgstToIgst = u.cgstCreditUtilized?.towardsIgst || 0;
    const sgstToIgst = u.sgstCreditUtilized?.towardsIgst || 0;
    addItem({
      category: "TAX_SETOFF",
      ruleReference: "Section 49(5), Section 49A & Rule 88A CGST Rules",
      title: "Order of Input Tax Credit Utilization",
      plainEnglishExplanation:
        igstCross > 0 || cgstToIgst > 0 || sgstToIgst > 0
          ? `IGST credit was exhausted first, with ₹${igstCross.toLocaleString("en-IN")} cross-utilized toward CGST/SGST and ₹${(cgstToIgst + sgstToIgst).toLocaleString("en-IN")} CGST/SGST credit used toward IGST. CGST and SGST were kept strictly separate.`
          : "Tax credits were matched against their own tax heads (IGST->IGST, CGST->CGST, SGST->SGST) in compliance with Rule 88A.",
      amountInvolved: setoffResult.netCashPayable?.total || 0,
      severity: "INFO"
    });
  }

  // 2. RCM Cash-Only Liability (Section 9(3) / 9(4))
  const rcmBills = purchases.filter(p => Number(p.is_rcm) === 1);
  if (rcmBills.length > 0) {
    const rcmTax = rcmBills.reduce((s, p) => s + Number(p.total_tax || 0), 0);
    addItem({
      category: "RCM_CASH_ONLY",
      ruleReference: "Section 9(3) / 9(4) & Section 49(4) CGST Act",
      title: `${rcmBills.length} Reverse Charge (RCM) Purchase Bill(s)`,
      plainEnglishExplanation:
        `Tax of ₹${rcmTax.toLocaleString("en-IN")} on Reverse Charge bills must be paid 100% in cash — you cannot use existing ITC to pay RCM tax. Self-invoices must also be issued for unregistered suppliers.`,
      amountInvolved: rcmTax,
      affectedInvoices: rcmBills.map(b => b.invoice_number),
      severity: "HIGH"
    });
  }

  // 3. Section 17(5) Blocked Credits
  const blockedBills = purchases.filter(p => p.itc_eligibility && p.itc_eligibility !== "ELIGIBLE");
  if (blockedBills.length > 0) {
    const blockedTax = blockedBills.reduce((s, p) => s + Number(p.total_tax || 0), 0);
    addItem({
      category: "BLOCKED_ITC",
      ruleReference: "Section 17(5) CGST Act",
      title: `${blockedBills.length} Blocked Credit Bill(s)`,
      plainEnglishExplanation:
        `₹${blockedTax.toLocaleString("en-IN")} of GST on these bills is blocked from being claimed as tax credit (for example food, motor vehicles, personal expenses, or ineligible supplies).`,
      amountInvolved: blockedTax,
      affectedInvoices: blockedBills.map(b => b.invoice_number),
      severity: "MEDIUM"
    });
  }

  // 4. Rule 37 180-Day Unpaid Supplier Rule
  const unpaidOver180 = purchases.filter(p => {
    if (p.payment_status === "FULLY_PAID") return false;
    try {
      const a = analyzeInvoice180Days({
        invoiceNumber: p.invoice_number,
        invoiceDate: p.invoice_date,
        totalAmount: p.total_amount,
        totalTax: p.total_tax,
        amountPaid: p.amount_paid || 0,
        paymentStatus: p.payment_status
      });
      return a.isOver180Days || a.daysElapsed >= 180;
    } catch {
      return Number(p.days_aging || 0) >= 180;
    }
  });
  if (unpaidOver180.length > 0) {
    const atRisk = unpaidOver180.reduce((s, p) => s + Number(p.total_tax || 0), 0);
    addItem({
      category: "RULE_37_180_DAY",
      ruleReference: "Second Proviso to Section 16(2) & Rule 37 CGST Rules",
      title: `${unpaidOver180.length} Supplier Bill(s) Unpaid >= 180 Days`,
      plainEnglishExplanation:
        `You have not paid these suppliers within 180 days of the bill date. GST rules require temporarily reversing ₹${atRisk.toLocaleString("en-IN")} of tax credit (with Section 50 interest) until you pay the supplier.`,
      amountInvolved: atRisk,
      affectedInvoices: unpaidOver180.map(b => b.invoice_number),
      severity: "HIGH"
    });
  }

  // 5. GSTR-2B Reconciliation Mismatches / Missing
  const reconIssues = reconciliationItems.filter(r => r.match_status && r.match_status !== "EXACT_MATCH");
  if (reconIssues.length > 0) {
    addItem({
      category: "GSTR2B_RECONCILIATION",
      ruleReference: "Section 16(2)(aa) & Rule 36(4) CGST Rules",
      title: `${reconIssues.length} GSTR-2B Reconciliation Discrepancy Item(s)`,
      plainEnglishExplanation:
        "Under Section 16(2)(aa), you can only claim tax credit for bills that appear in your government GSTR-2B statement. Follow up with suppliers whose bills are missing or show different amounts.",
      amountInvolved: reconIssues.reduce((s, r) => s + Math.abs(Number(r.tax_variance || 0)), 0),
      affectedInvoices: reconIssues.map(r => r.invoice_number).filter(Boolean),
      severity: "HIGH"
    });
  }

  // 6. Inter-state B2C Large (CBIC Notif 12/2024-CT)
  const b2cl = sales.filter(s => s.supply_type === "B2CL");
  if (b2cl.length > 0) {
    addItem({
      category: "GSTR1_B2CL",
      ruleReference: "CBIC Notification No. 12/2024-Central Tax (B2C Large > ₹1,00,000)",
      title: `${b2cl.length} Inter-State B2C Large Invoice(s)`,
      plainEnglishExplanation:
        "Inter-state sales to unregistered customers exceeding ₹1,00,000 must be reported invoice-wise in GSTR-1 Table 5.",
      amountInvolved: b2cl.reduce((s, inv) => s + Number(inv.total_amount || 0), 0),
      affectedInvoices: b2cl.map(inv => inv.invoice_number),
      severity: "INFO"
    });
  }

  return {
    disclaimer: CA_DISCLAIMER,
    generatedAt: new Date().toISOString(),
    gstin: gstin?.gstin || "",
    tradeName: gstin?.trade_name || "",
    period,
    totalItems: items.length,
    items
  };
}
