/**
 * SimpleGST Deterministic GST Reconciliation Engine
 * Strictly compares inward purchase invoices (Books) with auto-drafted GSTR-2B entries.
 * Enforces Section 16(2)(aa), Section 17(5), and Rule 36(4) of the CGST Rules.
 */

import crypto from "node:crypto";

/**
 * Standardize numeric amounts with 2 decimals
 */
export function round2(num) {
  if (num === undefined || num === null || isNaN(num)) return 0;
  return Math.round((Number(num) + Number.EPSILON) * 100) / 100;
}

/**
 * Normalize invoice numbers for robust matching (e.g. "INV/2026/01" -> "INV202601")
 */
export function normalizeInvoiceNumber(num) {
  if (!num) return "";
  return String(num).trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Normalize GSTIN string
 */
export function normalizeGstin(gstin) {
  if (!gstin) return "";
  return String(gstin).trim().toUpperCase();
}

/**
 * Perform end-to-end reconciliation between Purchase Books and GSTR-2B
 * 
 * @param {Object} params
 * @param {string} params.gstinId
 * @param {string} params.period
 * @param {Array} params.purchases Inward purchase invoices from database
 * @param {Array} params.gstr2bEntries Auto-drafted GSTR-2B entries from database
 * @returns {Object} Reconciliation results, side-by-side diffs, and statutory metrics
 */
export function runReconciliation({ gstinId, period, purchases = [], gstr2bEntries = [] }) {
  const reconItems = [];

  const matched2bIds = new Set();
  const seenSupplierInvBooks = new Map();
  const seenSupplierInv2B = new Map();

  // Pre-index GSTR-2B entries by exact and normalized keys
  const gstr2bByExactKey = new Map();
  const gstr2bByNormKey = new Map();

  for (const g of gstr2bEntries) {
    const sGstin = normalizeGstin(g.supplier_gstin);
    const rawInv = String(g.invoice_number || "").trim().toUpperCase();
    const normInv = normalizeInvoiceNumber(rawInv);

    const exactKey = `${sGstin}::${rawInv}`;
    const normKey = `${sGstin}::${normInv}`;

    if (!gstr2bByExactKey.has(exactKey)) gstr2bByExactKey.set(exactKey, []);
    gstr2bByExactKey.get(exactKey).push(g);

    if (!gstr2bByNormKey.has(normKey)) gstr2bByNormKey.set(normKey, []);
    gstr2bByNormKey.get(normKey).push(g);

    // Track duplicates in 2B
    seenSupplierInv2B.set(normKey, (seenSupplierInv2B.get(normKey) || 0) + 1);
  }

  // Pre-count duplicates in books
  for (const p of purchases) {
    const sGstin = normalizeGstin(p.supplier_gstin);
    const normInv = normalizeInvoiceNumber(p.invoice_number);
    const key = `${sGstin}::${normInv}`;
    seenSupplierInvBooks.set(key, (seenSupplierInvBooks.get(key) || 0) + 1);
  }

  let matchedTax = 0, matchedTaxable = 0, matchedCount = 0;
  let mismatchTax = 0, mismatchTaxable = 0, mismatchCount = 0, totalVariance = 0;
  let missingIn2bTax = 0, missingIn2bTaxable = 0, missingIn2bCount = 0;
  let blockedTax = 0, blockedTaxable = 0, blockedCount = 0;

  // STEP 1: Process Purchase Invoices in Books
  for (const p of purchases) {
    const sGstin = normalizeGstin(p.supplier_gstin);
    const rawInv = String(p.invoice_number || "").trim().toUpperCase();
    const normInv = normalizeInvoiceNumber(rawInv);
    const normKey = `${sGstin}::${normInv}`;

    const pTaxable = round2(p.taxable_amount || 0);
    const pIgst = round2(p.igst || 0);
    const pCgst = round2(p.cgst || 0);
    const pSgst = round2(p.sgst || 0);
    const pCess = round2(p.cess || 0);
    const pTotalTax = round2(p.total_tax || (pIgst + pCgst + pSgst + pCess));
    const pDate = p.invoice_date ? String(p.invoice_date).split("T")[0] : "";

    // Check Duplicate in Books
    const isDuplicateInBooks = (seenSupplierInvBooks.get(normKey) || 0) > 1;

    // Check Ineligible / Blocked u/s 17(5)
    if (p.itc_eligibility !== "ELIGIBLE") {
      blockedCount++;
      blockedTax = round2(blockedTax + pTotalTax);
      blockedTaxable = round2(blockedTaxable + pTaxable);

      reconItems.push({
        id: `recon-${crypto.randomUUID()}`,
        gstin_id: gstinId,
        period,
        purchase_invoice_id: p.id,
        gstr2b_id: null,
        match_status: "BLOCKED_17_5",
        variance_amount: 0,
        supplier_name: p.supplier_name,
        supplier_gstin: p.supplier_gstin,
        invoice_number: p.invoice_number,
        invoice_date: pDate,
        books_taxable: pTaxable,
        books_tax: pTotalTax,
        books_igst: pIgst,
        books_cgst: pCgst,
        books_sgst: pSgst,
        gstr2b_taxable: 0,
        gstr2b_tax: 0,
        gstr2b_igst: 0,
        gstr2b_cgst: 0,
        gstr2b_sgst: 0,
        action: "AUTO_REVERSED",
        investigation_notes: p.blocked_reason || "Ineligible ITC blocked under Section 17(5) of the CGST Act.",
        field_diffs_json: JSON.stringify({ blockedUnderSection17_5: true, reason: p.blocked_reason || "Restricted ITC Category" }),
        notes: "Auto-routed to Table 4(B) Ineligible ITC"
      });
      continue;
    }

    // Try finding matching GSTR-2B entry
    const exactKey = `${sGstin}::${rawInv}`;
    let candidate2B = null;

    // Exact Match Search
    if (gstr2bByExactKey.has(exactKey)) {
      const candidates = gstr2bByExactKey.get(exactKey);
      candidate2B = candidates.find(c => !matched2bIds.has(c.id)) || candidates[0];
    }

    // Fuzzy / Normalized Search if not found
    if (!candidate2B && gstr2bByNormKey.has(normKey)) {
      const candidates = gstr2bByNormKey.get(normKey);
      candidate2B = candidates.find(c => !matched2bIds.has(c.id)) || candidates[0];
    }

    if (candidate2B) {
      matched2bIds.add(candidate2B.id);

      const gTaxable = round2(candidate2B.taxable_value !== undefined && candidate2B.taxable_value !== null ? candidate2B.taxable_value : (candidate2B.taxable_amount || 0));
      const gIgst = round2(candidate2B.igst || 0);
      const gCgst = round2(candidate2B.cgst || 0);
      const gSgst = round2(candidate2B.sgst || 0);
      const gCess = round2(candidate2B.cess || 0);
      const compTax = round2(gIgst + gCgst + gSgst + gCess);
      const gTotalTax = candidate2B.total_tax ? round2(candidate2B.total_tax) : compTax;
      const gDate = candidate2B.invoice_date ? String(candidate2B.invoice_date).split("T")[0] : "";

      const taxableDiff = round2(Math.abs(pTaxable - gTaxable));
      const taxDiff = round2(Math.abs(pTotalTax - gTotalTax));
      const dateDiff = pDate !== gDate;

      const fieldDiffs = {};
      if (taxableDiff > 1.0) fieldDiffs.taxableAmount = { books: pTaxable, gstr2b: gTaxable, diff: taxableDiff };
      if (taxDiff > 1.0) fieldDiffs.totalTax = { books: pTotalTax, gstr2b: gTotalTax, diff: taxDiff };
      if (Math.abs(pIgst - gIgst) > 1.0) fieldDiffs.igst = { books: pIgst, gstr2b: gIgst, diff: round2(Math.abs(pIgst - gIgst)) };
      if (Math.abs(pCgst - gCgst) > 1.0) fieldDiffs.cgst = { books: pCgst, gstr2b: gCgst, diff: round2(Math.abs(pCgst - gCgst)) };
      if (Math.abs(pSgst - gSgst) > 1.0) fieldDiffs.sgst = { books: pSgst, gstr2b: gSgst, diff: round2(Math.abs(pSgst - gSgst)) };
      if (dateDiff) fieldDiffs.invoiceDate = { books: pDate, gstr2b: gDate };

      // Classification: EXACT_MATCH vs PARTIAL_MATCH
      if (taxableDiff <= 1.0 && taxDiff <= 1.0) {
        matchedCount++;
        matchedTax = round2(matchedTax + pTotalTax);
        matchedTaxable = round2(matchedTaxable + pTaxable);

        reconItems.push({
          id: `recon-${crypto.randomUUID()}`,
          gstin_id: gstinId,
          period,
          purchase_invoice_id: p.id,
          gstr2b_id: candidate2B.id,
          match_status: "EXACT_MATCH",
          variance_amount: 0,
          supplier_name: candidate2B.supplier_name || p.supplier_name,
          supplier_gstin: p.supplier_gstin,
          invoice_number: p.invoice_number,
          invoice_date: pDate,
          books_taxable: pTaxable,
          books_tax: pTotalTax,
          books_igst: pIgst,
          books_cgst: pCgst,
          books_sgst: pSgst,
          gstr2b_taxable: gTaxable,
          gstr2b_tax: gTotalTax,
          gstr2b_igst: gIgst,
          gstr2b_cgst: gCgst,
          gstr2b_sgst: gSgst,
          action: "ACCEPT_2B",
          investigation_notes: "100% matched with supplier GSTR-2B filing. Safe for Table 4(A)(5) credit claim.",
          field_diffs_json: JSON.stringify(fieldDiffs),
          notes: "Fully verified vs auto-drafted GSTR-2B"
        });
      } else {
        mismatchCount++;
        mismatchTax = round2(mismatchTax + pTotalTax);
        mismatchTaxable = round2(mismatchTaxable + pTaxable);
        totalVariance = round2(totalVariance + taxDiff);

        reconItems.push({
          id: `recon-${crypto.randomUUID()}`,
          gstin_id: gstinId,
          period,
          purchase_invoice_id: p.id,
          gstr2b_id: candidate2B.id,
          match_status: "PARTIAL_MATCH",
          variance_amount: taxDiff,
          supplier_name: candidate2B.supplier_name || p.supplier_name,
          supplier_gstin: p.supplier_gstin,
          invoice_number: p.invoice_number,
          invoice_date: pDate,
          books_taxable: pTaxable,
          books_tax: pTotalTax,
          books_igst: pIgst,
          books_cgst: pCgst,
          books_sgst: pSgst,
          gstr2b_taxable: gTaxable,
          gstr2b_tax: gTotalTax,
          gstr2b_igst: gIgst,
          gstr2b_cgst: gCgst,
          gstr2b_sgst: gSgst,
          action: "PENDING",
          investigation_notes: `Value mismatch detected: Tax difference of ₹${taxDiff.toFixed(2)}. Review books vs supplier declared value.`,
          field_diffs_json: JSON.stringify(fieldDiffs),
          notes: "Tax / Taxable variance requires review"
        });
      }
    } else {
      // MISSING IN GSTR-2B (Supplier unfiled or omitted)
      missingIn2bCount++;
      missingIn2bTax = round2(missingIn2bTax + pTotalTax);
      missingIn2bTaxable = round2(missingIn2bTaxable + pTaxable);

      reconItems.push({
        id: `recon-${crypto.randomUUID()}`,
        gstin_id: gstinId,
        period,
        purchase_invoice_id: p.id,
        gstr2b_id: null,
        match_status: "MISSING_IN_2B",
        variance_amount: pTotalTax,
        supplier_name: p.supplier_name,
        supplier_gstin: p.supplier_gstin,
        invoice_number: p.invoice_number,
        invoice_date: pDate,
        books_taxable: pTaxable,
        books_tax: pTotalTax,
        books_igst: pIgst,
        books_cgst: pCgst,
        books_sgst: pSgst,
        gstr2b_taxable: 0,
        gstr2b_tax: 0,
        gstr2b_igst: 0,
        gstr2b_cgst: 0,
        gstr2b_sgst: 0,
        action: "HOLD",
        investigation_notes: "Invoice not found in GSTR-2B. Under Section 16(2)(aa), ITC is at risk until supplier files GSTR-1.",
        field_diffs_json: JSON.stringify({ missingInGstr2b: true, statutoryRisk: "Section 16(2)(aa)" }),
        notes: "At-Risk ITC: Supplier filing pending"
      });
    }
  }

  // STEP 2: Process GSTR-2B Entries that have NO matching purchase in Books (MISSING IN BOOKS)
  let missingInBooksTax = 0, missingInBooksTaxable = 0, missingInBooksCount = 0;

  for (const g of gstr2bEntries) {
    if (matched2bIds.has(g.id)) continue;

    const gTaxable = round2(g.taxable_value !== undefined && g.taxable_value !== null ? g.taxable_value : (g.taxable_amount || 0));
    const gIgst = round2(g.igst || 0);
    const gCgst = round2(g.cgst || 0);
    const gSgst = round2(g.sgst || 0);
    const gCess = round2(g.cess || 0);
    const compTax = round2(gIgst + gCgst + gSgst + gCess);
    const gTotalTax = g.total_tax ? round2(g.total_tax) : compTax;
    const gDate = g.invoice_date ? String(g.invoice_date).split("T")[0] : "";

    missingInBooksCount++;
    missingInBooksTax = round2(missingInBooksTax + gTotalTax);
    missingInBooksTaxable = round2(missingInBooksTaxable + gTaxable);

    reconItems.push({
      id: `recon-${crypto.randomUUID()}`,
      gstin_id: gstinId,
      period,
      purchase_invoice_id: null,
      gstr2b_id: g.id,
      match_status: "MISSING_IN_BOOKS",
      variance_amount: gTotalTax,
      supplier_name: g.supplier_name,
      supplier_gstin: g.supplier_gstin,
      invoice_number: g.invoice_number,
      invoice_date: gDate,
      books_taxable: 0,
      books_tax: 0,
      books_igst: 0,
      books_cgst: 0,
      books_sgst: 0,
      gstr2b_taxable: gTaxable,
      gstr2b_tax: gTotalTax,
      gstr2b_igst: gIgst,
      gstr2b_cgst: gCgst,
      gstr2b_sgst: gSgst,
      action: "PENDING",
      investigation_notes: "Reported in GSTR-2B by supplier but missing in purchase register. Import to claim unclaimed ITC.",
      field_diffs_json: JSON.stringify({ missingInBooks: true, unclaimedItc: true }),
      notes: "Unclaimed ITC: In 2B but not in ERP"
    });
  }

  // STEP 3: Compute Overall Financials
  const totalBooksTaxable = round2(purchases.reduce((acc, p) => acc + (p.taxable_amount || 0), 0));
  const totalBooksTax = round2(purchases.reduce((acc, p) => acc + (p.total_tax || 0), 0));

  const total2bTaxable = round2(gstr2bEntries.reduce((acc, g) => acc + (g.taxable_value !== undefined ? g.taxable_value : (g.taxable_amount || 0)), 0));
  const total2bTax = round2(gstr2bEntries.reduce((acc, g) => {
    const comp = round2((g.igst || 0) + (g.cgst || 0) + (g.sgst || 0) + (g.cess || 0));
    return acc + (g.total_tax ? round2(g.total_tax) : comp);
  }, 0));

  const eligibleNetItc = matchedTax;
  const atRiskItc = round2(missingIn2bTax + totalVariance);
  const unclaimedItc = missingInBooksTax;

  const totalEvaluated = purchases.length;
  const matchRatePercent = totalEvaluated > 0 ? Math.round((matchedCount / totalEvaluated) * 100) : 100;

  // AI Copilot Statutory Advisory
  let advisory = null;
  if (missingIn2bCount > 0) {
    advisory = {
      level: "RISK",
      title: "Section 16(2)(aa) Statutory Compliance Notice",
      message: `${missingIn2bCount} purchase invoice${missingIn2bCount > 1 ? "s" : ""} worth ₹${missingIn2bTax.toLocaleString("en-IN", { minimumFractionDigits: 2 })} ITC are missing from GSTR-2B. Under Finance Act 2021 amendments to Section 16(2)(aa), Input Tax Credit cannot be availed unless communicated in GSTR-2B. Holding these claims avoids audit disallowance and 18% interest under Section 50.`,
      recommendedAction: "HOLD_UNFILED_ITC"
    };
  } else if (mismatchCount > 0) {
    advisory = {
      level: "WARNING",
      title: "Value Variance Detected",
      message: `${mismatchCount} invoice${mismatchCount > 1 ? "s have" : " has"} taxable/tax variances totaling ₹${totalVariance.toLocaleString("en-IN", { minimumFractionDigits: 2 })}. Review supplier filings and accept GSTR-2B values before filing Form GSTR-3B.`,
      recommendedAction: "REVIEW_MISMATCHES"
    };
  } else if (missingInBooksCount > 0) {
    advisory = {
      level: "OPPORTUNITY",
      title: "Unclaimed ITC Opportunity",
      message: `${missingInBooksCount} invoice${missingInBooksCount > 1 ? "s" : ""} worth ₹${unclaimedItc.toLocaleString("en-IN", { minimumFractionDigits: 2 })} are available in GSTR-2B but missing from purchase records. Import them to reduce cash tax liability.`,
      recommendedAction: "IMPORT_TO_BOOKS"
    };
  } else if (purchases.length > 0 && matchedCount === purchases.length) {
    advisory = {
      level: "SUCCESS",
      title: "100% GSTR-2B Reconciled",
      message: `All ${purchases.length} purchase invoices perfectly match supplier filings on GSTN portal. ₹${eligibleNetItc.toLocaleString("en-IN", { minimumFractionDigits: 2 })} is 100% safe to claim in Table 4 of Form GSTR-3B.`,
      recommendedAction: "PROCEED_TO_TAX_CALC"
    };
  }

  return {
    period,
    items: reconItems,
    summary: {
      totalBooksPurchases: purchases.length,
      totalBooksTaxable,
      totalBooksTax,
      total2bInvoices: gstr2bEntries.length,
      total2bTaxable,
      total2bTax,
      matched: {
        count: matchedCount,
        taxable: matchedTaxable,
        tax: matchedTax,
        itcAmount: matchedTax
      },
      mismatch: {
        count: mismatchCount,
        taxable: mismatchTaxable,
        tax: mismatchTax,
        varianceAmount: totalVariance
      },
      missingIn2b: {
        count: missingIn2bCount,
        taxable: missingIn2bTaxable,
        tax: missingIn2bTax,
        atRiskItc: missingIn2bTax
      },
      missingInBooks: {
        count: missingInBooksCount,
        taxable: missingInBooksTaxable,
        tax: missingInBooksTax,
        unclaimedItc: missingInBooksTax
      },
      blockedSec17_5: {
        count: blockedCount,
        taxable: blockedTaxable,
        tax: blockedTax,
        blockedItc: blockedTax
      },
      eligibleNetItc,
      atRiskItc,
      unclaimedItc,
      matchRatePercent
    },
    advisory
  };
}
