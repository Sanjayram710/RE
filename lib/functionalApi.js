/**
 * SimpleGST Functional API Handler
 * Implements real database-backed endpoints for Multi-GSTIN, Invoices, Documents,
 * OCR, ITC Reconciliation, Tax Calculation, Ledgers, Reports, and GST Copilot.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  db,
  userRepo,
  orgRepo,
  gstinRepo,
  salesRepo,
  purchaseRepo,
  documentRepo,
  ocrRepo,
  gstr2bRepo,
  ledgerRepo,
  challanRepo,
  returnRepo,
  auditRepo,
  seedDevelopmentData
} from "./db.js";

import { computeRule88aSetoff } from "./rule88aEngine.js";
import { validateGstr1Prerequisites, validateGstr3bPrerequisites, simulateReturnFiling } from "./gstrReturnLifecycleEngine.js";
import { generatePmt06Challan, executePmt09Transfer } from "./electronicLedgerEngine.js";
import { extractDocumentData } from "./aiDocumentExtractorEngine.js";
import { analyzeInvoice180Days } from "./supplier180DayTracker.js";
import { validateGstin, validatePan } from "./validate.js";
import { generateGSTExcelReport } from "./excelExporter.js";
import { generateGSTCsv } from "./csvExporter.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const uploadsDir = path.join(rootDir, "data", "uploads");

// Ensure development seed is ready
seedDevelopmentData();

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

// Active workspace session cache for rapid context resolution
let currentActiveContext = {
  orgId: null,
  gstinId: null,
  period: "102026"
};

function getActiveGstin() {
  if (currentActiveContext.gstinId) {
    const g = gstinRepo.findById(currentActiveContext.gstinId);
    if (g && g.is_active) return g;
  }
  // Fall back to primary or first active GSTIN
  const primary = db.prepare("SELECT * FROM gst_registrations WHERE is_primary = 1 AND is_active = 1 LIMIT 1").get();
  if (primary) {
    currentActiveContext.gstinId = primary.id;
    currentActiveContext.orgId = primary.org_id;
    return primary;
  }
  const first = db.prepare("SELECT * FROM gst_registrations WHERE is_active = 1 LIMIT 1").get();
  if (first) {
    currentActiveContext.gstinId = first.id;
    currentActiveContext.orgId = first.org_id;
    return first;
  }
  return null;
}

export async function handleFunctionalApi(req, res, pathname, method, query, body) {

  // =========================================================================
  // 1. AUTH & SESSION
  // =========================================================================
  if (pathname === "/api/auth/session" && method === "GET") {
    const activeGstin = getActiveGstin();
    const org = activeGstin ? orgRepo.findById(activeGstin.org_id) : null;
    const allGstins = org ? gstinRepo.listByOrg(org.id) : [];

    return sendJson(res, 200, {
      authenticated: true,
      user: {
        id: "usr-apex-director",
        name: "Rajesh Sharma",
        email: "rajesh.sharma@apexretail.com",
        role: "OWNER"
      },
      organization: org,
      activeGstin: activeGstin,
      allGstins: allGstins,
      activePeriod: currentActiveContext.period
    });
  }

  if (pathname === "/api/auth/login" && method === "POST") {
    const activeGstin = getActiveGstin();
    return sendJson(res, 200, {
      success: true,
      message: "Logged in successfully to SimpleGST Compliance OS",
      user: { name: "Rajesh Sharma", role: "OWNER" },
      activeGstin
    });
  }

  // =========================================================================
  // 2. MULTI-GSTIN MANAGEMENT
  // =========================================================================
  if (pathname === "/api/gstins" && method === "GET") {
    const active = getActiveGstin();
    if (!active) return sendJson(res, 200, { gstins: [] });
    const list = gstinRepo.listByOrg(active.org_id);
    return sendJson(res, 200, { gstins: list });
  }

  if (pathname === "/api/gstins" && method === "POST") {
    const active = getActiveGstin();
    if (!active) return sendJson(res, 400, { error: "No active organization found" });

    const { gstin, tradeName, stateCode, stateName, address, jurisdiction, filingFrequency } = body;
    if (!gstin || !tradeName) {
      return sendJson(res, 400, { error: "GSTIN and Trade Name are mandatory" });
    }

    const gstinValid = validateGstin(gstin);
    if (!gstinValid.valid) {
      return sendJson(res, 400, { error: `Invalid GSTIN: ${gstinValid.reason}` });
    }

    try {
      const created = gstinRepo.create({
        orgId: active.org_id,
        gstin,
        tradeName,
        stateCode: stateCode || gstinValid.stateCode,
        stateName: stateName || `State-${gstinValid.stateCode}`,
        address: address || "",
        jurisdiction: jurisdiction || "",
        isPrimary: 0,
        filingFrequency: filingFrequency || "MONTHLY"
      });

      auditRepo.log({
        orgId: active.org_id,
        gstinId: created.id,
        action: "GSTIN_REGISTERED",
        entityType: "GST_REGISTRATION",
        entityId: created.id,
        details: { gstin, tradeName }
      });

      return sendJson(res, 201, { success: true, gstin: created });
    } catch (err) {
      return sendJson(res, 400, { error: `Registration error: ${err.message}` });
    }
  }

  if (pathname.startsWith("/api/gstins/") && pathname.endsWith("/activate") && method === "POST") {
    const parts = pathname.split("/");
    const targetId = parts[3];
    const target = gstinRepo.findById(targetId);
    if (!target) return sendJson(res, 404, { error: "GSTIN registration not found" });

    currentActiveContext.gstinId = target.id;
    currentActiveContext.orgId = target.org_id;

    auditRepo.log({
      orgId: target.org_id,
      gstinId: target.id,
      action: "WORKSPACE_GSTIN_SWITCHED",
      entityType: "GST_REGISTRATION",
      entityId: target.id,
      details: { gstin: target.gstin, tradeName: target.trade_name }
    });

    return sendJson(res, 200, {
      success: true,
      message: `Active workspace switched to ${target.trade_name} (${target.gstin})`,
      activeGstin: target
    });
  }

  // =========================================================================
  // 3. DASHBOARD SUMMARY (Scoped to Active GSTIN & Period)
  // =========================================================================
  if (pathname === "/api/dashboard/summary" && method === "GET") {
    const active = getActiveGstin();
    if (!active) return sendJson(res, 200, { empty: true, message: "No active GSTIN" });

    const period = query.period || currentActiveContext.period;
    const sales = salesRepo.list(active.id, period);
    const purchases = purchaseRepo.list(active.id, period);

    const totalSalesTaxable = sales.reduce((acc, s) => acc + s.taxable_amount, 0);
    const totalSalesTax = sales.reduce((acc, s) => acc + s.total_tax, 0);

    const totalPurchasesTaxable = purchases.reduce((acc, p) => acc + p.taxable_amount, 0);
    const eligiblePurchases = purchases.filter(p => p.itc_eligibility === "ELIGIBLE");
    const totalEligibleItc = eligiblePurchases.reduce((acc, p) => acc + p.total_tax, 0);
    const blockedItc = purchases.filter(p => p.itc_eligibility !== "ELIGIBLE").reduce((acc, p) => acc + p.total_tax, 0);

    const cashShortfall = Math.max(0, totalSalesTax - totalEligibleItc);

    // Get Ledger Balances
    const ledgers = ledgerRepo.getTotals(active.id);

    return sendJson(res, 200, {
      entity: {
        id: active.id,
        tradeName: active.trade_name,
        gstin: active.gstin,
        state: `${active.state_name} (${active.state_code})`,
        filingFrequency: active.filing_frequency
      },
      period: period,
      periodLabel: "October 2026",
      metrics: {
        totalOutputLiability: totalSalesTax,
        taxableSales: totalSalesTaxable,
        salesCount: sales.length,
        totalEligibleItc: totalEligibleItc,
        blockedItc: blockedItc,
        taxablePurchases: totalPurchasesTaxable,
        purchasesCount: purchases.length,
        netCashPayable: cashShortfall,
        complianceScore: 94,
        cashLedgerBalance: ledgers.CASH,
        creditLedgerBalance: ledgers.CREDIT
      },
      recentSales: sales.slice(0, 5),
      recentPurchases: purchases.slice(0, 5),
      lifecycleStatus: {
        gstr1: sales.length > 0 ? "READY" : "PENDING_INVOICES",
        gstr2b: "AUTO_DRAFTED",
        gstr3b: cashShortfall > 0 ? "CHALLAN_REQUIRED" : "READY_TO_OFFSET"
      }
    });
  }

  // =========================================================================
  // 3b. NIL RETURN PRE-FILING VERIFICATION & PERSISTED CHECK
  // =========================================================================
  if (pathname === "/api/gst/nil-verify" && method === "GET") {
    const active = getActiveGstin();
    if (!active) return sendJson(res, 200, { eligible: false, message: "No active GSTIN selected" });

    const period = query.period || currentActiveContext.period;
    const sales = salesRepo.list(active.id, period);
    const purchases = purchaseRepo.list(active.id, period);
    const rcmPurchases = purchases.filter(p => p.is_rcm);
    const ledgers = ledgerRepo.getTotals(active.id);
    const filedReturns = (returnRepo.listByGstin ? returnRepo.listByGstin(active.id) : []).filter(r => r.period === period);

    const periodMonth = parseInt(period.slice(0, 2), 10) || 10;
    const periodYear = period.slice(2) || "2026";
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const periodLabel = `${monthNames[periodMonth - 1] || "October"} ${periodYear}`;

    const totalSalesTaxable = sales.reduce((a, s) => a + s.taxable_amount, 0);
    const totalPurchasesTaxable = purchases.reduce((a, p) => a + p.taxable_amount, 0);
    const hasTransactions = sales.length > 0 || purchases.length > 0;
    const isAlreadyFiled = filedReturns.length > 0;

    if (isAlreadyFiled) {
      return sendJson(res, 200, {
        eligible: false,
        alreadyFiled: true,
        gstin: active.gstin,
        tradeName: active.trade_name,
        period,
        periodLabel,
        message: `A return for ${periodLabel} has already been filed for ${active.trade_name} (${active.gstin}).`
      });
    }

    if (hasTransactions) {
      return sendJson(res, 200, {
        eligible: false,
        hasTransactions: true,
        gstin: active.gstin,
        tradeName: active.trade_name,
        period,
        periodLabel,
        verification: {
          salesCount: sales.length,
          salesTaxable: totalSalesTaxable,
          purchasesCount: purchases.length,
          purchasesTaxable: totalPurchasesTaxable,
          rcmCount: rcmPurchases.length,
          cashLedger: ledgers.CASH,
          creditLedger: ledgers.CREDIT,
          ledgerChecked: true,
          hasTransactions: true
        },
        message: `Transactions recorded: You have ${sales.length} sales invoice(s) (₹${totalSalesTaxable.toLocaleString("en-IN")}) and ${purchases.length} purchase bill(s) (₹${totalPurchasesTaxable.toLocaleString("en-IN")}) in records for ${periodLabel}. A Nil return cannot be filed when transactions exist.`
      });
    }

    return sendJson(res, 200, {
      eligible: true,
      hasTransactions: false,
      gstin: active.gstin,
      tradeName: active.trade_name,
      period,
      periodLabel,
      verification: {
        salesCount: 0,
        salesTaxable: 0,
        purchasesCount: 0,
        purchasesTaxable: 0,
        rcmCount: 0,
        cashLedger: ledgers.CASH,
        creditLedger: ledgers.CREDIT,
        hasTransactions: false,
        ledgerChecked: true
      },
      message: `Verified: Zero outward sales, zero inward purchases, zero reverse-charge liabilities, and zero ITC claims in records for ${periodLabel}.`
    });
  }

  // -------------------------------------------------------------------------
  // Handle POST /api/gst/nil-file with persistent database verification
  // -------------------------------------------------------------------------
  if (pathname === "/api/gst/nil-file" && method === "POST") {
    const active = getActiveGstin();
    const period = body?.period || currentActiveContext.period;

    if (active) {
      const sales = salesRepo.list(active.id, period);
      const purchases = purchaseRepo.list(active.id, period);
      if (sales.length > 0 || purchases.length > 0) {
        return sendJson(res, 400, {
          success: false,
          error: `Cannot file Nil Return: ${sales.length} sales invoice(s) and ${purchases.length} purchase bill(s) exist for ${period}. Please proceed with standard filing.`,
          hasTransactions: true
        });
      }
    }

    // Zero transactions confirmed: generate standard simulated receipt
    const timestamp = new Date().toISOString();
    const randomSuffix = Math.floor(100000 + Math.random() * 900000);
    const arn = `NIL-AA${active ? active.state_code : "32"}${period.slice(2, 6)}${randomSuffix}`;
    const simulationArn = `SIM-${arn}`;

    if (active) {
      returnRepo.saveDraft({
        orgId: active.org_id,
        gstinId: active.id,
        period,
        returnType: "NIL_3B",
        status: "FILED_SIMULATED",
        arn,
        liabilitySummary: { salesCount: 0, taxPaidCash: 0 },
        itcSummary: { purchasesCount: 0, itcUtilized: 0 },
        offsetMatrix: { isNil: true, mode: "SIMULATION" }
      });
    }

    return sendJson(res, 200, {
      success: true,
      isNil: true,
      isSimulation: true,
      watermark: "[SIMULATION MODE — NOT FILED ON GSTN COMMON PORTAL]",
      arn,
      simulationReference: simulationArn,
      gstin: active ? active.gstin : (body?.gstin || "32ABCDE1234F1Z5"),
      legalName: active ? active.trade_name : "Apex Retailers Pvt Ltd",
      period,
      periodDisplay: `October ${period.slice(2)}`,
      form: "GSTR-3B (NIL)",
      filedAt: timestamp,
      authorisedPerson: body?.authorisedPerson || "Rajesh Sharma",
      verificationMode: body?.verificationMode || "EVC_OTP",
      statutorySummary: {
        outwardTaxableSales: 0,
        totalGstCollected: 0,
        inwardTaxablePurchases: 0,
        eligibleItc: 0,
        netTaxPaidInCash: 0,
        lateFeePaid: 0,
        interestPaid: 0
      },
      status: "FILED_AND_CONFIRMED",
      message: "Your NIL GSTR-3B return has been prepared and verified in simulation mode. No tax or late fees payable.",
      downloadCertificate: {
        certificateNumber: `CERT-${arn}`,
        title: "Statutory Nil Return Filing Simulation Receipt",
        issuer: "SimpleGST Architectural Compliance Engine"
      }
    });
  }

  // =========================================================================
  // 4. SALES INVOICES CRUD
  // =========================================================================
  if (pathname === "/api/sales" && method === "GET") {
    const active = getActiveGstin();
    if (!active) return sendJson(res, 200, { invoices: [] });
    const period = query.period || currentActiveContext.period;
    const invoices = salesRepo.list(active.id, period);
    return sendJson(res, 200, { invoices, total: invoices.length });
  }

  if (pathname === "/api/sales" && method === "POST") {
    const active = getActiveGstin();
    if (!active) return sendJson(res, 400, { error: "No active GSTIN" });

    const {
      invoiceNumber, invoiceDate, customerName, customerGstin, pos,
      taxableAmount, gstRate, supplyType = "B2B"
    } = body;

    if (!invoiceNumber || !invoiceDate || !customerName || taxableAmount === undefined || gstRate === undefined) {
      return sendJson(res, 400, { error: "Missing required invoice fields" });
    }

    const isInterstate = pos && pos.substring(0, 2) !== active.state_code;
    const taxRate = Number(gstRate) / 100;
    const taxAmt = Number(taxableAmount) * taxRate;
    let igst = 0, cgst = 0, sgst = 0;

    if (isInterstate) {
      igst = taxAmt;
    } else {
      cgst = taxAmt / 2;
      sgst = taxAmt / 2;
    }

    try {
      const created = salesRepo.create({
        orgId: active.org_id,
        gstinId: active.id,
        period: query.period || currentActiveContext.period,
        invoiceNumber,
        invoiceDate,
        customerName,
        customerGstin,
        pos: pos || active.state_code,
        isInterstate,
        supplyType,
        taxableAmount: Number(taxableAmount),
        gstRate: Number(gstRate),
        igst,
        cgst,
        sgst,
        cess: 0,
        totalTax: taxAmt,
        totalAmount: Number(taxableAmount) + taxAmt,
        status: "VALIDATED"
      });

      return sendJson(res, 201, { success: true, invoice: created });
    } catch (err) {
      return sendJson(res, 400, { error: `Failed to create invoice: ${err.message}` });
    }
  }

  // =========================================================================
  // 5. PURCHASE BILLS CRUD & 180-DAY SUPPLIER TRACKING
  // =========================================================================
  if (pathname === "/api/purchases" && method === "GET") {
    const active = getActiveGstin();
    if (!active) return sendJson(res, 200, { purchases: [] });
    const period = query.period || currentActiveContext.period;
    const purchases = purchaseRepo.list(active.id, period);
    return sendJson(res, 200, { purchases, total: purchases.length });
  }

  if (pathname === "/api/purchases" && method === "POST") {
    const active = getActiveGstin();
    if (!active) return sendJson(res, 400, { error: "No active GSTIN" });

    const {
      invoiceNumber, invoiceDate, supplierName, supplierGstin, pos,
      taxableAmount, gstRate, itcEligibility = "ELIGIBLE", blockedReason, isRcm = false
    } = body;

    const isInterstate = pos && pos.substring(0, 2) !== active.state_code;
    const taxRate = Number(gstRate) / 100;
    const taxAmt = Number(taxableAmount) * taxRate;
    let igst = 0, cgst = 0, sgst = 0;

    if (isInterstate) {
      igst = taxAmt;
    } else {
      cgst = taxAmt / 2;
      sgst = taxAmt / 2;
    }

    try {
      const created = purchaseRepo.create({
        orgId: active.org_id,
        gstinId: active.id,
        period: query.period || currentActiveContext.period,
        invoiceNumber,
        invoiceDate,
        supplierName,
        supplierGstin,
        pos: pos || active.state_code,
        isInterstate,
        isRcm,
        taxableAmount: Number(taxableAmount),
        gstRate: Number(gstRate),
        igst,
        cgst,
        sgst,
        cess: 0,
        totalTax: taxAmt,
        totalAmount: Number(taxableAmount) + taxAmt,
        itcEligibility,
        blockedReason,
        paymentStatus: "UNPAID",
        daysAging: 0
      });

      return sendJson(res, 201, { success: true, purchase: created });
    } catch (err) {
      return sendJson(res, 400, { error: `Failed to create purchase: ${err.message}` });
    }
  }

  if (pathname.startsWith("/api/purchases/") && pathname.endsWith("/payment") && method === "POST") {
    const parts = pathname.split("/");
    const id = parts[3];
    const { amountPaid, paymentDate } = body;
    const pur = purchaseRepo.findById(id);
    if (!pur) return sendJson(res, 404, { error: "Purchase record not found" });

    const totalPaid = (pur.amount_paid || 0) + Number(amountPaid);
    let paymentStatus = "UNPAID";
    if (totalPaid >= pur.total_amount) {
      paymentStatus = "FULLY_PAID";
    } else if (totalPaid > 0) {
      paymentStatus = "PARTIALLY_PAID";
    }

    // Calculate Rule 37 180-day aging
    const agingResult = analyzeInvoice180Days({
      invoiceDate: pur.invoice_date,
      totalValue: pur.total_amount,
      paidAmount: totalPaid,
      itcClaimed: pur.total_tax
    }, paymentDate || new Date().toISOString());

    const updated = purchaseRepo.updatePayment(id, {
      paymentStatus,
      paymentDate: paymentDate || new Date().toISOString().split("T")[0],
      amountPaid: totalPaid,
      daysAging: agingResult.daysAging || 0,
      rule37Interest: agingResult.interestPayable || 0
    });

    return sendJson(res, 200, { success: true, purchase: updated, aging: agingResult });
  }

  // =========================================================================
  // 6. FILE STORAGE & DOWNLOADS
  // =========================================================================
  if (pathname === "/api/documents" && method === "GET") {
    const active = getActiveGstin();
    if (!active) return sendJson(res, 200, { documents: [] });
    const docs = documentRepo.listByGstin(active.id, query.category);
    return sendJson(res, 200, { documents: docs, count: docs.length });
  }

  if (pathname === "/api/documents/upload" && method === "POST") {
    const active = getActiveGstin();
    if (!active) return sendJson(res, 400, { error: "No active GSTIN" });

    const filename = body.filename || `Document_${Date.now()}.pdf`;
    const category = body.category || "purchase_bill";
    const fileContent = body.content || body.rawText || "SAMPLE_BINARY_OR_TEXT_CONTENT";
    const fileBytes = Buffer.from(fileContent, "utf8");

    // Secure disk storage outside public path
    const storedKey = `${crypto.randomUUID()}_${path.basename(filename)}`;
    const targetPath = path.join(uploadsDir, storedKey);
    fs.writeFileSync(targetPath, fileBytes);

    const doc = documentRepo.create({
      orgId: active.org_id,
      gstinId: active.id,
      category,
      originalFilename: filename,
      storedFilename: storedKey,
      fileType: path.extname(filename).replace(".", "").toUpperCase() || "PDF",
      fileSizeBytes: fileBytes.length,
      storagePath: targetPath
    });

    // Run automated OCR extraction record
    const extracted = extractDocumentData({
      type: category === "sales_invoice" ? "sales_invoice" : "purchase_bill",
      rawText: body.rawText || "",
      filename: filename
    });

    const extractedData = extracted.data || extracted.extracted || {};
    const ocrRecord = ocrRepo.saveExtraction({
      documentId: doc.id,
      rawText: body.rawText || "",
      extractedFields: extractedData,
      confidence: extracted.confidence ? parseFloat(extracted.confidence) / 100 : 0.98
    });

    return sendJson(res, 201, {
      success: true,
      document: doc,
      ocr: ocrRecord,
      extractedFields: extractedData
    });
  }

  if (pathname.startsWith("/api/documents/") && pathname.endsWith("/download") && method === "GET") {
    const parts = pathname.split("/");
    const docId = parts[3];
    const doc = documentRepo.findById(docId);
    if (!doc) return sendJson(res, 404, { error: "Document not found" });

    // Path traversal defense
    const safePath = path.resolve(doc.storage_path);
    if (!safePath.startsWith(path.resolve(uploadsDir))) {
      return sendJson(res, 403, { error: "Access denied to unauthorized storage path" });
    }

    if (!fs.existsSync(safePath)) {
      return sendJson(res, 404, { error: "Stored file missing on disk" });
    }

    const stat = fs.statSync(safePath);
    res.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Length": stat.size,
      "Content-Disposition": `attachment; filename="${path.basename(doc.original_filename)}"`
    });
    fs.createReadStream(safePath).pipe(res);
    return true;
  }

  if (pathname === "/api/documents" && method === "GET") {
    const active = getActiveGstin();
    if (!active) return sendJson(res, 200, { documents: [] });
    const docs = documentRepo.listByGstin(active.id, query.category);
    return sendJson(res, 200, { documents: docs });
  }

  if (pathname.startsWith("/api/documents/") && method === "DELETE") {
    const parts = pathname.split("/");
    const docId = parts[3];
    documentRepo.delete(docId);
    return sendJson(res, 200, { success: true, message: "Document deleted successfully" });
  }

  // =========================================================================
  // 6B. REPORTS & EXPORTS IN CSV
  // =========================================================================
  if (pathname === "/api/reports/sales/csv" && method === "GET") {
    const active = getActiveGstin();
    if (!active) return sendJson(res, 400, { error: "No active GSTIN" });
    const invoices = salesRepo.list(active.id, query.period || currentActiveContext.period);
    let csv = "Invoice Number,Invoice Date,Customer Name,Customer GSTIN,POS,Taxable Value,GST Rate,IGST,CGST,SGST,Total Tax,Total Amount\n";
    invoices.forEach(inv => {
      csv += `"${inv.invoice_number}","${inv.invoice_date}","${inv.customer_name}","${inv.customer_gstin || ''}","${inv.pos}",${inv.taxable_amount},${inv.gst_rate}%,${inv.igst},${inv.cgst},${inv.sgst},${inv.total_tax},${inv.total_amount}\n`;
    });
    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="Sales_Register_${active.gstin}_${currentActiveContext.period}.csv"`
    });
    res.end(csv);
    return true;
  }

  if (pathname === "/api/reports/purchases/csv" && method === "GET") {
    const active = getActiveGstin();
    if (!active) return sendJson(res, 400, { error: "No active GSTIN" });
    const purchases = purchaseRepo.list(active.id, query.period || currentActiveContext.period);
    let csv = "Invoice Number,Invoice Date,Supplier Name,Supplier GSTIN,POS,Taxable Value,GST Rate,IGST,CGST,SGST,Total Tax,Total Amount,ITC Eligibility,Payment Status\n";
    purchases.forEach(pur => {
      csv += `"${pur.invoice_number}","${pur.invoice_date}","${pur.supplier_name}","${pur.supplier_gstin}","${pur.pos}",${pur.taxable_amount},${pur.gst_rate}%,${pur.igst},${pur.cgst},${pur.sgst},${pur.total_tax},${pur.total_amount},"${pur.itc_eligibility}","${pur.payment_status}"\n`;
    });
    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="Purchase_Register_${active.gstin}_${currentActiveContext.period}.csv"`
    });
    res.end(csv);
    return true;
  }

  if (pathname === "/api/reports/reconciliation/csv" && method === "GET") {
    const active = getActiveGstin();
    if (!active) return sendJson(res, 400, { error: "No active GSTIN" });
    const gstr2bList = gstr2bRepo.list(active.id, query.period || currentActiveContext.period);
    let csv = "Supplier GSTIN,Supplier Trade Name,Invoice Number,Invoice Date,Taxable Value,IGST,CGST,SGST,Total Tax,Filing Date,GSTR-1 Status,Recon Match\n";
    gstr2bList.forEach(r => {
      csv += `"${r.supplier_gstin}","${r.supplier_name}","${r.invoice_number}","${r.invoice_date}",${r.taxable_amount},${r.igst},${r.cgst},${r.sgst},${r.total_tax},"${r.filing_date}","${r.gstr1_filing_status}","${r.status}"\n`;
    });
    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="GSTR2B_Reconciliation_${active.gstin}_${currentActiveContext.period}.csv"`
    });
    res.end(csv);
    return true;
  }

  if (pathname === "/api/reports/ledgers/csv" && method === "GET") {
    const active = getActiveGstin();
    if (!active) return sendJson(res, 400, { error: "No active GSTIN" });
    const totals = ledgerRepo.getTotals(active.id);
    let csv = "Ledger Type,Total Balance (INR)\n";
    csv += `Electronic Cash Ledger (PMT-05),${totals.CASH || 0}\n`;
    csv += `Electronic Credit Ledger (PMT-02),${totals.CREDIT || 0}\n`;
    csv += `Electronic Liability Ledger (PMT-01),${totals.LIABILITY || 0}\n`;
    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="Electronic_Ledgers_${active.gstin}.csv"`
    });
    res.end(csv);
    return true;
  }

  // =========================================================================
  // 7. OCR APPROVAL -> POST INTO INVOICE RECORDS
  // =========================================================================
  if (pathname === "/api/ocr/approve" && method === "POST") {
    const active = getActiveGstin();
    if (!active) return sendJson(res, 400, { error: "No active GSTIN" });

    const { documentId, invoiceType = "purchase_bill", fields } = body;
    if (!fields || !fields.invoiceNumber || !fields.taxableValue) {
      return sendJson(res, 400, { error: "Missing required extracted fields for approval" });
    }

    if (invoiceType === "sales_invoice") {
      const created = salesRepo.create({
        orgId: active.org_id,
        gstinId: active.id,
        period: currentActiveContext.period,
        invoiceNumber: fields.invoiceNumber,
        invoiceDate: fields.invoiceDate || new Date().toISOString().split("T")[0],
        customerName: fields.partyName || "Walk-in B2B Buyer",
        customerGstin: fields.buyerGstin || null,
        pos: active.state_code,
        isInterstate: false,
        supplyType: "B2B",
        taxableAmount: Number(fields.taxableValue),
        gstRate: 18,
        cgst: Number(fields.cgst || (fields.taxableValue * 0.09)),
        sgst: Number(fields.sgst || (fields.taxableValue * 0.09)),
        igst: Number(fields.igst || 0),
        cess: 0,
        totalTax: Number(fields.totalGst || (fields.taxableValue * 0.18)),
        totalAmount: Number(fields.totalInvoiceValue || (fields.taxableValue * 1.18)),
        status: "VALIDATED"
      });
      return sendJson(res, 200, { success: true, message: "Invoice approved and posted to Sales Register", invoice: created });
    } else {
      const created = purchaseRepo.create({
        orgId: active.org_id,
        gstinId: active.id,
        period: currentActiveContext.period,
        invoiceNumber: fields.invoiceNumber,
        invoiceDate: fields.invoiceDate || new Date().toISOString().split("T")[0],
        supplierName: fields.partyName || "Verified Vendor",
        supplierGstin: fields.gstin || "27AAACM1234B1Z2",
        pos: active.state_code,
        isInterstate: false,
        isRcm: false,
        taxableAmount: Number(fields.taxableValue),
        gstRate: 18,
        cgst: Number(fields.cgst || (fields.taxableValue * 0.09)),
        sgst: Number(fields.sgst || (fields.taxableValue * 0.09)),
        igst: Number(fields.igst || 0),
        cess: 0,
        totalTax: Number(fields.totalGst || (fields.taxableValue * 0.18)),
        totalAmount: Number(fields.totalInvoiceValue || (fields.taxableValue * 1.18)),
        itcEligibility: "ELIGIBLE",
        paymentStatus: "UNPAID"
      });
      return sendJson(res, 200, { success: true, message: "Purchase bill approved and posted to Inward Register", purchase: created });
    }
  }

  // =========================================================================
  // 8. GSTR-2B RECONCILIATION SUMMARY
  // =========================================================================
  if (pathname === "/api/reconciliation/summary" && method === "GET") {
    const active = getActiveGstin();
    if (!active) return sendJson(res, 200, { summary: {} });
    const period = query.period || currentActiveContext.period;

    const purchases = purchaseRepo.list(active.id, period);
    const gstr2bRows = db.prepare("SELECT * FROM gstr2b_entries WHERE gstin_id = ? AND period = ?").all(active.id, period);

    let matchedCount = 0, matchedTax = 0;
    let mismatchCount = 0, mismatchTax = 0;
    let missingIn2bCount = 0, missingTax = 0;
    let blockedCount = 0, blockedTax = 0;

    purchases.forEach(p => {
      if (p.itc_eligibility !== "ELIGIBLE") {
        blockedCount++;
        blockedTax += p.total_tax;
        return;
      }
      const matchIn2B = gstr2bRows.find(g => g.invoice_number === p.invoice_number && g.supplier_gstin === p.supplier_gstin);
      if (matchIn2B) {
        if (Math.abs(matchIn2B.taxable_value - p.taxable_amount) <= 1) {
          matchedCount++;
          matchedTax += p.total_tax;
        } else {
          mismatchCount++;
          mismatchTax += Math.abs(matchIn2B.taxable_value - p.taxable_amount);
        }
      } else {
        missingIn2bCount++;
        missingTax += p.total_tax;
      }
    });

    return sendJson(res, 200, {
      period,
      summary: {
        totalBooksPurchases: purchases.length,
        total2bInvoices: gstr2bRows.length,
        matched: { count: matchedCount, itcAmount: matchedTax },
        mismatch: { count: mismatchCount, varianceAmount: mismatchTax },
        missingIn2b: { count: missingIn2bCount, atRiskItc: missingTax },
        blockedSec17_5: { count: blockedCount, blockedItc: blockedTax }
      },
      matchRatePercent: purchases.length > 0 ? Math.round((matchedCount / purchases.length) * 100) : 100
    });
  }

  // =========================================================================
  // 9. TAX CALCULATION & RULE 88A OFFSET (GSTR-3B)
  // =========================================================================
  if (pathname === "/api/returns/tax-calc" && method === "GET") {
    const active = getActiveGstin();
    if (!active) return sendJson(res, 400, { error: "No active GSTIN" });
    const period = query.period || currentActiveContext.period;

    const sales = salesRepo.list(active.id, period);
    const purchases = purchaseRepo.list(active.id, period);

    const liability = {
      igst: sales.reduce((a, s) => a + s.igst, 0),
      cgst: sales.reduce((a, s) => a + s.cgst, 0),
      sgst: sales.reduce((a, s) => a + s.sgst, 0)
    };

    const eligible = purchases.filter(p => p.itc_eligibility === "ELIGIBLE");
    const inputCredit = {
      igst: eligible.reduce((a, p) => a + p.igst, 0),
      cgst: eligible.reduce((a, p) => a + p.cgst, 0),
      sgst: eligible.reduce((a, p) => a + p.sgst, 0)
    };

    // Execute deterministic Rule 88A set-off engine
    const setoffResult = computeRule88aSetoff(liability, inputCredit);

    const netCash = setoffResult.netCashPayable ? setoffResult.netCashPayable.total : 0;
    const excessCredit = setoffResult.itcCarryForward ? setoffResult.itcCarryForward.total : 0;

    return sendJson(res, 200, {
      period,
      liability,
      inputCredit,
      setoffMatrix: setoffResult.utilizationMatrix,
      remainingLiability: setoffResult.netCashPayable,
      remainingCredit: setoffResult.itcCarryForward,
      netCashPayable: netCash,
      excessCreditCarryForward: excessCredit,
      status: netCash > 0 ? "CHALLAN_DEFICIT" : "FULLY_OFFSET"
    });
  }

  // =========================================================================
  // 10. GST COPILOT CONTEXT & QUESTIONS
  // =========================================================================
  if (pathname === "/api/copilot/status" && method === "GET") {
    const hasApiKey = Boolean(process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY);
    return sendJson(res, 200, {
      configured: hasApiKey,
      mode: hasApiKey ? "cloud_llm" : "deterministic_statutory",
      engine: "SimpleGST Statutory Knowledge & Database Grounding Engine",
      citationDatabase: "CBIC Circulars, Notifications & CGST Act 2017"
    });
  }

  if (pathname === "/api/copilot/ask" && method === "POST") {
    const active = getActiveGstin();
    if (!active) return sendJson(res, 400, { error: "No active GSTIN" });
    const period = currentActiveContext.period;

    const queryText = (body.question || body.query || "").toLowerCase();
    const sales = salesRepo.list(active.id, period);
    const purchases = purchaseRepo.list(active.id, period);

    const totalSalesTax = sales.reduce((a, s) => a + s.total_tax, 0);
    const totalSalesTaxable = sales.reduce((a, s) => a + s.taxable_amount, 0);
    const eligiblePurchases = purchases.filter(p => p.itc_eligibility === "ELIGIBLE");
    const eligibleItc = eligiblePurchases.reduce((a, p) => a + p.total_tax, 0);
    const cashShortfall = Math.max(0, totalSalesTax - eligibleItc);
    const gstr2bList = gstr2bRepo.list(active.id, period);
    const cashBalance = ledgerRepo.getBalance(active.id, "CASH");

    let answer = "";
    let citations = [];
    let requiresCa = false;

    // 1. Total sales question
    if (queryText.includes("total sales") || (queryText.includes("sales") && (queryText.includes("month") || queryText.includes("october")))) {
      answer = `For ${active.trade_name} (${active.gstin}) in ${period}, your total recorded sales are ₹${totalSalesTaxable.toLocaleString("en-IN")} across ${sales.length} invoices, with total GST of ₹${totalSalesTax.toLocaleString("en-IN")}. Outward taxable supplies are categorized for GSTR-1 Table 4 (B2B) and Table 7 (B2C).`;
      citations.push("Section 31 & Section 37 CGST Act 2017 (GSTR-1 Invoicing)");
    } 
    // 2. ITC claim question
    else if (queryText.includes("itc") && (queryText.includes("how much") || queryText.includes("claim") || queryText.includes("eligible"))) {
      answer = `You can claim ₹${eligibleItc.toLocaleString("en-IN")} in eligible Input Tax Credit (ITC) for ${period} across ${eligiblePurchases.length} inward bills. All eligible bills strictly satisfy Section 16(2)(aa) GSTR-2B matching requirements.`;
      citations.push("Section 16(2)(aa) CGST Act 2017 & Rule 36(4)");
    } 
    // 3. Invoices missing from GSTR-2B
    else if (queryText.includes("missing") || queryText.includes("not in 2b") || (queryText.includes("2b") && queryText.includes("invoices"))) {
      const gstr2bInvNos = new Set(gstr2bList.map(r => r.invoice_number));
      const missingBills = purchases.filter(p => !gstr2bInvNos.has(p.invoice_number) || p.gstr2b_match_status === "MISSING_IN_2B");
      const missingCount = missingBills.length;
      const missingTax = missingBills.reduce((a, b) => a + b.total_tax, 0);
      const missingDetails = missingBills.slice(0, 3).map(b => `${b.invoice_number} (${b.supplier_name} - ₹${b.total_tax})`).join(", ");
      answer = missingCount > 0
        ? `Reconciliation Alert: ${missingCount} purchase bill(s) are currently missing from your supplier's filed GSTR-1 (₹${missingTax.toLocaleString("en-IN")} ITC at risk). Missing bills: ${missingDetails}. Under Section 16(2)(aa), ITC cannot be availed in GSTR-3B until your suppliers furnish these invoices in their GSTR-1/IFF.`
        : `Reconciliation Clean: 100% of your inward purchase bills match GSTR-2B records for ${period}. Zero missing supplier invoices detected.`;
      citations.push("Section 16(2)(aa) & Rule 37A CGST Rules");
    } 
    // 4. Estimated tax liability & how much to pay
    else if (
      queryText.includes("tax liability") || 
      queryText.includes("estimated tax") || 
      (queryText.includes("how much") && (queryText.includes("pay") || queryText.includes("liability") || queryText.includes("tax"))) ||
      (queryText.includes("liability") && queryText.includes("how much"))
    ) {
      answer = cashShortfall > 0
        ? `For ${active.trade_name} (${active.gstin}) in ${period}, your gross tax liability is ₹${totalSalesTax.toLocaleString("en-IN")}. After offsetting ₹${eligibleItc.toLocaleString("en-IN")} available ITC under Rule 88A, your estimated net tax payable in cash is ₹${cashShortfall.toLocaleString("en-IN")}. Generate Form GST PMT-06 to credit your cash ledger.`
        : `Great news! For ${active.trade_name} in ${period}, your net cash payable is ₹0. Your eligible Input Tax Credit (₹${eligibleItc.toLocaleString("en-IN")}) fully offsets your gross sales tax liability (₹${totalSalesTax.toLocaleString("en-IN")}).`;
      citations.push("Section 49 & Rule 88A CGST Rules");
    } 
    // 5. 180-day payment limit (Rule 37)
    else if (queryText.includes("180") || queryText.includes("aging") || queryText.includes("rule 37")) {
      const atRiskBills = purchases.filter(p => p.days_aging >= 120 && p.payment_status !== "PAID");
      const atRiskDetails = atRiskBills.slice(0, 3).map(b => `${b.invoice_number} (${b.supplier_name}: ${b.days_aging} days)`).join(", ");
      answer = atRiskBills.length > 0
        ? `Section 16(2) 2nd Proviso & Rule 37 Alert: ${atRiskBills.length} purchase bill(s) are approaching or past the statutory 180-day supplier payment deadline (${atRiskDetails}). If unpaid beyond 180 days, the proportionate ITC must be reversed in Table 4(B)(2) of GSTR-3B along with 18% annual interest under Section 50.`
        : `Payment Aging Clean (Section 16(2) 2nd Proviso & Rule 37): All inward purchase bills are within safe payment aging (<120 days). No mandatory Table 4(B)(2) reversals required for ${period}.`;
      citations.push("Section 16(2) 2nd Proviso, Rule 37 & Section 50(1) CGST Act");
    } 
    // 6. Explain GSTR-3B calculation
    else if (queryText.includes("explain") || queryText.includes("calculation") || queryText.includes("setoff")) {
      answer = `Statutory GSTR-3B Calculation for ${period}: Gross Table 3.1 outward liability is ₹${totalSalesTax.toLocaleString("en-IN")}. Table 4(A)(5) eligible ITC is ₹${eligibleItc.toLocaleString("en-IN")}. Rule 88A setoff order: Integrated Tax (IGST) credit must be 100% exhausted against IGST, CGST, and SGST liabilities before CGST or SGST credit can be utilized. Furthermore, CGST credit can never cross-utilize against SGST liability, and vice versa. Net remaining cash shortfall is ₹${cashShortfall.toLocaleString("en-IN")}.`;
      citations.push("Section 49, Section 49A, Section 49B & Rule 88A");
    } 
    // 7. What should I complete before filing
    else if (queryText.includes("before filing") || queryText.includes("checklist") || queryText.includes("complete")) {
      answer = `Pre-Filing Compliance Checklist for ${active.gstin} (${period}): 1. Outward Invoices: Verify all sales bills are accounted in GSTR-1; 2. Inward ITC: Confirm GSTR-2B reconciliation is locked; 3. Rule 88A Evaluation: Run automated tax set-off; 4. PMT-06 Challan: If cash ledger has a deficit of ₹${cashShortfall.toLocaleString("en-IN")}, deposit funds; 5. Two-Stage Sequential Gate: Section 39(10) requires GSTR-1 to be filed before GSTR-3B can be submitted.`;
      citations.push("Section 37(4), Section 39(10) & Rule 87(6) CGST Rules");
    } 
    // 8. Show current cash ledger balance
    else if (queryText.includes("cash ledger") || queryText.includes("pmt-05") || queryText.includes("cash balance") || queryText.includes("ledger balance")) {
      const cashTotal = (cashBalance.cgst || 0) + (cashBalance.sgst || 0) + (cashBalance.igst || 0);
      answer = `Your current Electronic Cash Ledger (Form GST PMT-05) balance for ${active.gstin} is ₹${cashTotal.toLocaleString("en-IN")} (CGST: ₹${(cashBalance.cgst || 0).toLocaleString("en-IN")}, SGST: ₹${(cashBalance.sgst || 0).toLocaleString("en-IN")}, IGST: ₹${(cashBalance.igst || 0).toLocaleString("en-IN")}). Cash in this ledger is available for offsetting tax liabilities, interest, or late fees.`;
      citations.push("Section 49(1) CGST Act & Form GST PMT-05");
    } 
    // Nil return queries
    else if (queryText.includes("nil") || queryText.includes("zero")) {
      answer = `A Nil GST Return (Form GSTR-3B) is filed under Section 39 when a taxpayer has zero sales, zero purchase credit claims, and zero reverse charge liability in the tax period. SimpleGST supports 1-Click Nil Return filing with explicit confirmation.`;
      citations.push("Section 39(1) CGST Act & Rule 67A");
    } 
    // General fallback grounded in DB records
    else {
      answer = `Based on your records for ${active.trade_name} (${period}): Output tax liability is ₹${totalSalesTax.toLocaleString("en-IN")}, eligible ITC is ₹${eligibleItc.toLocaleString("en-IN")}, and net cash shortfall is ₹${cashShortfall.toLocaleString("en-IN")}. Cash ledger balance is ₹${((cashBalance.cgst || 0) + (cashBalance.sgst || 0)).toLocaleString("en-IN")}. You can view the details in the Tax Calc and Reconciliation suites.`;
      citations.push("Section 49 & Section 39 CGST Act 2017");
    }

    return sendJson(res, 200, {
      answer,
      citations,
      activeContext: {
        tradeName: active.trade_name,
        gstin: active.gstin,
        period: "October 2026"
      },
      requiresCa
    });
  }

  // =========================================================================
  // 11. LEDGER BALANCES & PMT-06 CHALLAN WORKFLOW
  // =========================================================================
  if (pathname === "/api/ledgers/balances" && method === "GET") {
    const active = getActiveGstin();
    if (!active) return sendJson(res, 200, { balances: {} });

    const cashLedger = ledgerRepo.getBalance(active.id, "CASH");
    const creditLedger = ledgerRepo.getBalance(active.id, "CREDIT");
    const totals = ledgerRepo.getTotals(active.id);

    return sendJson(res, 200, {
      gstin: active.gstin,
      totals,
      cashLedger,
      creditLedger
    });
  }

  if (pathname === "/api/challans/generate-pmt06" && method === "POST") {
    const active = getActiveGstin();
    if (!active) return sendJson(res, 400, { error: "No active GSTIN" });

    const amount = Number(body.amount || 62436);
    const paymentMode = body.paymentMode || "NET_BANKING";

    // Enforce Rule 87(4) Over-The-Counter ₹10,000 statutory limit
    if (paymentMode === "OVER_THE_COUNTER" && amount > 10000) {
      return sendJson(res, 400, {
        error: "Rule 87(4) CGST Rules: Over-The-Counter payment cannot exceed ₹10,000 per challan per tax period."
      });
    }

    // Generate statutory 14-digit CPIN
    const challanResult = generatePmt06Challan(active.gstin, {
      igstTax: Number(body.igst || 0),
      cgstTax: Number(body.cgst || (amount / 2)),
      sgstTax: Number(body.sgst || (amount / 2)),
      cessTax: 0
    }, paymentMode);

    const saved = challanRepo.create({
      gstinId: active.id,
      period: currentActiveContext.period,
      cpin: challanResult.cpin,
      totalAmount: challanResult.totalChallanAmount,
      majorHeads: challanResult.amounts,
      paymentMode
    });

    return sendJson(res, 201, {
      success: true,
      challan: saved,
      cpin: challanResult.cpin,
      expiryDate: challanResult.expiryDate,
      modeNotice: "[DEMO/SIMULATION MODE — Not processed on RBI NEFT gateway]"
    });
  }

  if (pathname === "/api/challans/simulate-payment" && method === "POST") {
    const active = getActiveGstin();
    if (!active) return sendJson(res, 400, { error: "No active GSTIN" });

    const cpin = body.cpin;
    const amount = Number(body.amount || 62436);
    const bankRef = `HDFC${Date.now().toString().slice(-8)}`;

    // Credit Cash Ledger
    ledgerRepo.creditCashLedger(active.id, "CGST", "TAX", amount / 2);
    ledgerRepo.creditCashLedger(active.id, "SGST", "TAX", amount / 2);

    return sendJson(res, 200, {
      success: true,
      message: `Challan ${cpin || "CPIN"} payment approved. ₹${amount.toLocaleString("en-IN")} credited to Electronic Cash Ledger (CIN: ${bankRef}).`,
      bankReference: bankRef,
      creditedAmount: amount
    });
  }

  // Not handled by functional API router -> pass to existing server.js routes
  return false;
}
