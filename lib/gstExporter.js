/**
 * GST Export Engine - Mirrors ClearTax GST's GSTR-1 & Invoicing Export System
 * Generates GSTN offline-utility compliant JSON files and reconciliation reports
 */

export function validateGstin(gstin) {
  const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
  return gstinRegex.test(gstin);
}

/**
 * Generate GSTN Offline Tool Compliant GSTR-1 JSON
 */
export function generateGSTR1Json(gstData) {
  const gstin = (gstData.gstin || "").toUpperCase();
  if (!validateGstin(gstin)) {
    throw new Error(`Invalid GSTIN: ${gstin}. Expected format 22AAAAA0000A1Z5`);
  }

  const period = gstData.filingPeriod || "032025"; // MMYYYY format
  const grossTurnover = Number(gstData.grossTurnover || 0);

  // Group B2B invoices by recipient GSTIN
  const b2bInvoices = gstData.b2bInvoices || [];
  const b2bMap = new Map();

  let totalTaxableValue = 0;
  let totalIgst = 0;
  let totalCgst = 0;
  let totalSgst = 0;

  for (const inv of b2bInvoices) {
    const ctin = (inv.recipientGstin || "").toUpperCase();
    if (!b2bMap.has(ctin)) {
      b2bMap.set(ctin, []);
    }

    const taxableVal = Number(inv.taxableValue || 0);
    const rate = Number(inv.rate || 18);
    const isInterState = inv.pos !== gstin.substring(0, 2);

    const igst = isInterState ? Math.round(taxableVal * (rate / 100)) : 0;
    const cgst = !isInterState ? Math.round(taxableVal * (rate / 200)) : 0;
    const sgst = !isInterState ? Math.round(taxableVal * (rate / 200)) : 0;

    totalTaxableValue += taxableVal;
    totalIgst += igst;
    totalCgst += cgst;
    totalSgst += sgst;

    b2bMap.get(ctin).push({
      inum: inv.invoiceNumber,
      idt: inv.invoiceDate, // DD-MM-YYYY
      val: taxableVal + igst + cgst + sgst,
      pos: inv.pos || "29",
      rchrg: inv.reverseCharge ? "Y" : "N",
      inv_typ: "R", // Regular
      itms: [
        {
          num: 1,
          itm_det: {
            rt: rate,
            txval: taxableVal,
            iamt: igst,
            camt: cgst,
            samt: sgst,
            csamt: 0
          }
        }
      ]
    });
  }

  const b2bSection = [];
  for (const [ctin, invList] of b2bMap.entries()) {
    b2bSection.push({
      ctin,
      cfs: "Y",
      inv: invList
    });
  }

  // HSN Summary
  const hsnItems = gstData.hsnSummary || [
    {
      hsn_sc: "998314",
      desc: "Information technology and tax software services",
      uqc: "OTH",
      qty: 1,
      val: totalTaxableValue + totalIgst + totalCgst + totalSgst,
      txval: totalTaxableValue,
      iamt: totalIgst,
      camt: totalCgst,
      samt: totalSgst,
      csamt: 0
    }
  ];

  const gstr1Payload = {
    gstin,
    fp: period,
    gt: grossTurnover,
    cur_gt: totalTaxableValue + totalIgst + totalCgst + totalSgst,
    version: "GSTR1_V3.0.4",
    generated_by: "SimpleGST-GSTR1-Engine",
    timestamp: new Date().toISOString(),
    b2b: b2bSection,
    b2cl: [],
    b2cs: [],
    hsn: {
      data: hsnItems
    },
    doc_issue: {
      doc_det: [
        {
          doc_num: 1,
          doc_typ: "Invoices for outward supply",
          from: b2bInvoices[0]?.invoiceNumber || "INV-001",
          to: b2bInvoices[b2bInvoices.length - 1]?.invoiceNumber || "INV-001",
          totnum: b2bInvoices.length,
          canc: 0,
          net_issue: b2bInvoices.length
        }
      ]
    }
  };

  return {
    rawObject: gstr1Payload,
    jsonString: JSON.stringify(gstr1Payload, null, 2),
    summary: {
      totalInvoices: b2bInvoices.length,
      totalTaxableValue,
      totalIgst,
      totalCgst,
      totalSgst,
      totalTaxAmount: totalIgst + totalCgst + totalSgst,
      totalInvoiceValue: totalTaxableValue + totalIgst + totalCgst + totalSgst
    }
  };
}

