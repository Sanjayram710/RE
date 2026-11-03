/**
 * SimpleGST Vendor Compliance & "ITC at Risk" Command Center
 * Modeled after enterprise MaxITC vendor compliance tracking under Section 16(2)(aa) of CGST Act.
 * Identifies non-compliant vendors, computes blocked ITC in rupees, and generates statutory payment withholding notices.
 */

import { DEMO_PURCHASES, DEMO_RECONCILIATION } from "./demoData.js";

/**
 * Computes vendor risk ranking and blocked ITC across purchase register vs GSTR-2B
 */
export function getVendorRiskLeaderboard(purchases = DEMO_PURCHASES, gstr2b = null) {
  let gstr2bInvSet;
  if (Array.isArray(gstr2b)) {
    gstr2bInvSet = new Set(gstr2b.map(inv => String(inv.invoiceNo || inv.invoiceNumber).toUpperCase()));
  } else {
    // Derive from DEMO_RECONCILIATION
    gstr2bInvSet = new Set(
      DEMO_RECONCILIATION.items
        .filter(item => item.status !== "Missing in 2B")
        .map(item => String(item.invoiceNo).toUpperCase())
    );
  }

  const vendorMap = new Map();

  purchases.forEach(inv => {
    const gstin = (inv.gstin || "UNKNOWN").toUpperCase();
    const tradeName = inv.party || inv.supplierName || "Supplier Trade";
    const invNo = String(inv.invoiceNo || inv.invoiceNumber);
    const tax = Number(inv.igst || 0) + Number(inv.cgst || 0) + Number(inv.sgst || 0) || (Number(inv.taxableValue || 0) * 0.18);
    const taxableVal = Number(inv.taxableValue || 0);

    const isMissingIn2b = !gstr2bInvSet.has(invNo.toUpperCase());

    if (!vendorMap.has(gstin)) {
      vendorMap.set(gstin, {
        gstin,
        tradeName,
        totalInvoices: 0,
        missingInvoices: [],
        compliantInvoices: 0,
        totalPurchases: 0,
        blockedItc: 0,
        filingFrequency: "Monthly",
        lastFilingDate: "2026-09-11"
      });
    }

    const v = vendorMap.get(gstin);
    v.totalInvoices += 1;
    v.totalPurchases += taxableVal;

    if (isMissingIn2b) {
      v.missingInvoices.push({
        invoiceNo: invNo,
        invoiceDate: inv.invoiceDate || "2026-10-15",
        taxableValue: taxableVal,
        taxAmount: Math.round(tax)
      });
      v.blockedItc += Math.round(tax);
    } else {
      v.compliantInvoices += 1;
    }
  });

  const vendors = Array.from(vendorMap.values()).map(v => {
    const complianceRate = v.totalInvoices > 0 ? Math.round((v.compliantInvoices / v.totalInvoices) * 100) : 100;
    let riskRating = "LOW";
    if (complianceRate < 50 || v.blockedItc > 20000) riskRating = "HIGH";
    else if (complianceRate < 80 || v.blockedItc > 5000) riskRating = "MEDIUM";

    return {
      ...v,
      complianceRate,
      riskRating,
      recommendedAction: riskRating === "HIGH" 
        ? "Hold next invoice payment; send formal Section 16(2)(aa) legal notice" 
        : (riskRating === "MEDIUM" ? "Nudge via WhatsApp / Email reminder" : "Eligible for on-time payment release")
    };
  });

  // Sort by highest blocked ITC first
  vendors.sort((a, b) => b.blockedItc - a.blockedItc);

  const totalBlockedItc = vendors.reduce((acc, v) => acc + v.blockedItc, 0);
  const highRiskVendorsCount = vendors.filter(v => v.riskRating === "HIGH").length;

  return {
    success: true,
    summary: {
      totalVendorsTracked: vendors.length,
      totalBlockedItc,
      highRiskVendorsCount,
      complianceHealthScore: vendors.length > 0 ? Math.round(vendors.reduce((a, b) => a + b.complianceRate, 0) / vendors.length) : 100
    },
    vendors,
    notice: "Demo files. Not official GST portal or income tax portal files."
  };
}

/**
 * Generates an automated formal Payment Withholding Notice to be sent to a non-compliant supplier
 */
export function generateWithholdingNotice(vendorDetails = {}) {
  const gstin = vendorDetails.gstin || "32DEFGH5678J1Z9";
  const name = vendorDetails.tradeName || "Skyline Distributors";
  const blockedItc = vendorDetails.blockedItc || 21600;
  const invoices = vendorDetails.missingInvoices || [{ invoiceNo: "PUR-102", invoiceDate: "2026-10-12", taxAmount: 21600 }];

  const invListText = invoices.map(i => `  • Invoice No: ${i.invoiceNo} dated ${i.invoiceDate} (Tax: ₹${Number(i.taxAmount).toLocaleString("en-IN")})`).join("\n");

  const noticeText = `
URGENT: STATUTORY ITC RECONCILIATION & PAYMENT WITHHOLDING NOTICE
Ref: Section 16(2)(aa) of Central Goods and Services Tax (CGST) Act, 2017

To:
The Accounts & Compliance Department,
${name} (GSTIN: ${gstin})

Dear Sir / Madam,

During our monthly GST return reconciliation for October 2026, we observed that the following tax invoice(s) issued by you do not appear in our auto-drafted GSTR-2B statement on the GST Portal:

${invListText}

Total Input Tax Credit (ITC) Blocked: ₹ ${Number(blockedItc).toLocaleString("en-IN")}

STATUTORY REQUIREMENT:
Under Section 16(2)(aa) read with Section 41 of the CGST Act, 2017, no registered buyer is entitled to claim Input Tax Credit unless the details of such invoice have been furnished by the supplier in Form GSTR-1 / IFF and reflected in GSTR-2B.

ACTION REQUIRED:
Please ensure that Form GSTR-1 for the corresponding tax period is furnished immediately. In accordance with standard financial control policies, payment corresponding to the GST portion (₹${Number(blockedItc).toLocaleString("en-IN")}) is temporarily put on hold and will be released immediately upon credit reflection in our GSTR-2B.

Sincerely,
Finance & Accounts Department,
Malabar Spice Traders (GSTIN: 32ABCDE1234F1Z5)
`.trim();

  return {
    success: true,
    vendorGstin: gstin,
    vendorName: name,
    blockedItc,
    noticeText,
    whatsappShareUrl: `https://wa.me/?text=${encodeURIComponent(`Dear ${name}, kindly note that ITC of Rs. ${blockedItc} is not reflecting in our GSTR-2B for invoice(s). Please file GSTR-1 to prevent payment delay.`)}`
  };
}
