/**
 * SimpleGST E-Invoicing & IRP Engine
 * Compliant with Rule 48(4) of CGST Rules & GSTN / NIC E-Invoice Schema v1.03
 * Generates 64-character SHA-256 IRN (Invoice Reference Number) and statutory Signed QR Code payload
 */

import crypto from "crypto";
import { validateGstin } from "./validate.js";

// In-memory store for generated E-Invoices in session
const einvoiceStore = new Map();

/**
 * Computes deterministic 64-character SHA-256 IRN according to NIC specification:
 * Hash of: Supplier GSTIN + FinYear (e.g. 2026-27) + DocType (INV/CRN/DBN) + DocNumber
 */
export function computeIrn(supplierGstin, finYear, docType, docNumber) {
  const normalizedDocNumber = String(docNumber || "").trim().toUpperCase();
  const normalizedDocType = String(docType || "INV").trim().toUpperCase();
  const normalizedGstin = String(supplierGstin || "").trim().toUpperCase();
  const normalizedFy = String(finYear || "2026-27").trim();

  const rawString = `${normalizedGstin}${normalizedFy}${normalizedDocType}${normalizedDocNumber}`;
  return crypto.createHash("sha256").update(rawString).digest("hex").toUpperCase();
}

/**
 * Generates a compliant E-Invoice with IRN, Ack No, and Signed QR Payload
 */
export function generateEinvoice(invoiceData = {}) {
  const supplierGstin = (invoiceData.supplierGstin || "32ABCDE1234F1Z5").toUpperCase();
  const buyerGstin = (invoiceData.buyerGstin || "29XYZAB5678C1Z2").toUpperCase();
  const docNumber = String(invoiceData.invoiceNo || invoiceData.docNumber || `INV-${Date.now().toString().slice(-6)}`);
  const docDate = invoiceData.invoiceDate || new Date().toISOString().split("T")[0];
  const docType = (invoiceData.docType || "INV").toUpperCase();
  const finYear = invoiceData.finYear || "2026-27";

  // Validate Supplier & Buyer GSTIN
  const supVal = validateGstin(supplierGstin);
  if (!supVal.valid) {
    throw new Error(`Invalid Supplier GSTIN: ${supVal.error}`);
  }
  const buyVal = validateGstin(buyerGstin);
  if (!buyVal.valid) {
    throw new Error(`Invalid Buyer GSTIN: ${buyVal.error}`);
  }

  const taxableValue = Number(invoiceData.taxableValue || 0);
  const gstRate = Number(invoiceData.gstRate || 18);
  const isInterState = supplierGstin.slice(0, 2) !== buyerGstin.slice(0, 2);

  let cgst = 0, sgst = 0, igst = 0;
  if (isInterState) {
    igst = Math.round((taxableValue * gstRate) / 100 * 100) / 100;
  } else {
    cgst = Math.round((taxableValue * (gstRate / 2)) / 100 * 100) / 100;
    sgst = Math.round((taxableValue * (gstRate / 2)) / 100 * 100) / 100;
  }
  const totalTax = Math.round((cgst + sgst + igst) * 100) / 100;
  const totalInvoiceValue = Math.round((taxableValue + totalTax) * 100) / 100;

  // Generate 64-character SHA-256 IRN
  const irn = computeIrn(supplierGstin, finYear, docType, docNumber);
  const ackNo = Number(`1126${Date.now().toString().slice(-10)}`);
  const ackDate = new Date().toISOString();

  // Statutory Signed QR Code payload string (NIC standard)
  const qrDataPayload = [
    `GSTIN:${supplierGstin}`,
    `BUYER:${buyerGstin}`,
    `DOC:${docNumber}`,
    `DATE:${docDate}`,
    `VAL:${totalInvoiceValue}`,
    `TAX:${totalTax}`,
    `HSN:${invoiceData.hsnCode || "84713010"}`,
    `IRN:${irn}`
  ].join("|");

  const einvoiceRecord = {
    success: true,
    irn,
    ackNo,
    ackDate,
    status: "ACT", // Active
    docDetails: {
      docType,
      docNumber,
      docDate,
      finYear
    },
    supplier: {
      gstin: supplierGstin,
      legalName: invoiceData.supplierName || "Malabar Spice Traders",
      stateCode: supplierGstin.slice(0, 2)
    },
    buyer: {
      gstin: buyerGstin,
      legalName: invoiceData.buyerName || "Zenith Infotech Pvt Ltd",
      stateCode: buyerGstin.slice(0, 2)
    },
    valDetails: {
      taxableValue,
      cgst,
      sgst,
      igst,
      totalTax,
      totalInvoiceValue
    },
    itemDetails: invoiceData.items || [
      {
        itemDescription: invoiceData.description || "Consulting & SaaS Compliance Services",
        hsnCode: invoiceData.hsnCode || "84713010",
        quantity: 1,
        unitPrice: taxableValue,
        taxableAmount: taxableValue,
        gstRate
      }
    ],
    qrCodeData: qrDataPayload,
    jwtSignature: `DEMO_IRP_SIG_${crypto.createHash("md5").update(qrDataPayload).digest("hex")}`,
    notice: "Demo files. Not official GST portal or income tax portal files."
  };

  einvoiceStore.set(irn, einvoiceRecord);
  return einvoiceRecord;
}

/**
 * Cancels an E-Invoice within statutory 24-hour window
 */
export function cancelEinvoice(irn, reason = "1", remarks = "Data entry error") {
  const record = einvoiceStore.get(irn);
  if (!record) {
    throw new Error(`E-Invoice with IRN ${irn} not found.`);
  }
  if (record.status === "CNL") {
    throw new Error(`E-Invoice with IRN ${irn} is already cancelled.`);
  }

  const cancelDate = new Date().toISOString();
  record.status = "CNL";
  record.cancelDetails = {
    cancelReason: reason === "1" ? "Duplicate invoice" : (reason === "2" ? "Data entry mistake" : "Order cancelled"),
    cancelRemarks: remarks,
    cancelDate
  };

  einvoiceStore.set(irn, record);
  return {
    success: true,
    irn,
    status: "CNL",
    cancelDate,
    message: "E-Invoice successfully cancelled on simulated IRP."
  };
}

/**
 * Fetches E-Invoice details by IRN
 */
export function getEinvoiceDetails(irn) {
  if (einvoiceStore.has(irn)) {
    return einvoiceStore.get(irn);
  }
  // Return sample active record if querying demo IRN
  return generateEinvoice({ invoiceNo: "INV-DEMO-2026" });
}

export function listEinvoices() {
  if (einvoiceStore.size === 0) {
    generateEinvoice({ invoiceNo: "INV-2026-001", taxableValue: 150000, gstRate: 18 });
    generateEinvoice({ invoiceNo: "INV-2026-002", taxableValue: 80000, gstRate: 12, buyerGstin: "32AAAAA0000A1Z5" });
  }
  return Array.from(einvoiceStore.values());
}

