import { isApiWorking, getGspMode, logGspRequest } from "./client.js";

/**
 * GSP GSTR-1 Adapter
 */
export async function getInvoices(gstin, period = "102026", type = "B2B") {
  const apiId = type.toUpperCase() === "B2B" ? 9 : 11; // 9: Get B2B, 11: Get B2CL
  const readiness = isApiWorking(apiId);
  if (!readiness.allowed) {
    return { success: false, status: readiness.status, message: readiness.message };
  }

  const { mode, isLive, baseUrl } = getGspMode();
  logGspRequest("GSTR1_GET_INVOICES", { gstin, period, type, mode });

  if (isLive) {
    try {
      const resp = await fetch(`${baseUrl}/returns/gstr1/invoices?gstin=${gstin}&ret_period=${period}&action_required=${type}`, {
        headers: { "client-id": process.env.GSP_CLIENT_ID }
      });
      return await resp.json();
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // Realistic MOCK outward invoices
  return {
    success: true,
    mode: "demo",
    gstin,
    period,
    invoices: [
      {
        inum: "INV-2026-001",
        idt: "04-10-2026",
        val: 531000,
        pos: "32",
        rchrg: "N",
        ctin: "32XYZAB5678C1Z2",
        partyName: "Cochin Marine Exports Pvt Ltd",
        items: [{ rate: 18, txval: 450000, igst: 0, cgst: 40500, sgst: 40500 }]
      },
      {
        inum: "INV-2026-002",
        idt: "12-10-2026",
        val: 802400,
        pos: "27",
        rchrg: "N",
        ctin: "27MNOPE9012D1Z9",
        partyName: "Sahyadri Agro Processing LLP",
        items: [{ rate: 18, txval: 680000, igst: 122400, cgst: 0, sgst: 0 }]
      }
    ]
  };
}

export async function getSummary(gstin, period = "102026") {
  const readiness = isApiWorking(25); // API #25: GSTR1 - Get GSTR1 Summary
  if (!readiness.allowed) {
    return { success: false, status: readiness.status, message: readiness.message };
  }

  const { mode, isLive, baseUrl } = getGspMode();
  logGspRequest("GSTR1_GET_SUMMARY", { gstin, period, mode });

  if (isLive) {
    try {
      const resp = await fetch(`${baseUrl}/returns/gstr1/summary?gstin=${gstin}&ret_period=${period}`, {
        headers: { "client-id": process.env.GSP_CLIENT_ID }
      });
      return await resp.json();
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  return {
    success: true,
    mode: "demo",
    gstin,
    ret_period: period,
    sec_sum: [
      { sec_nm: "B2B", ttl_rec: 48, ttl_val: 1463200, ttl_tax: 223200, ttl_igst: 122400, ttl_cgst: 50400, ttl_sgst: 50400 },
      { sec_nm: "B2CS", ttl_rec: 12, ttl_val: 84000, ttl_tax: 12800, ttl_igst: 0, ttl_cgst: 6400, ttl_sgst: 6400 }
    ]
  };
}

/**
 * File GSTR-1: Sandbox-only, requires explicit user confirmation & OTP
 */
export async function fileGstr1(gstin, period, otp, consent) {
  if (!consent) {
    return { success: false, message: "Explicit confirmation and consent checkbox required before filing" };
  }
  if (!otp || String(otp).trim().length !== 6) {
    return { success: false, message: "Valid 6-digit OTP is required for digital verification (EVC)" };
  }

  const readiness = isApiWorking(6); // API #6: GSTR1 - File Gstr1
  if (!readiness.allowed) {
    return { success: false, status: readiness.status, message: readiness.message };
  }

  const { mode } = getGspMode();
  logGspRequest("GSTR1_FILE_SANDBOX", { gstin, period, mode, consentGiven: true });

  const fakeArn = `AA${gstin.substring(0, 2)}${period.slice(-4)}${Math.floor(1000000 + Math.random() * 9000000)}`;

  return {
    success: true,
    mode: "sandbox",
    environment: "GSTN Sandbox Test Environment (Simulated)",
    arn: fakeArn,
    filingDate: new Date().toISOString(),
    status: "FILED",
    message: "GSTR-1 return filed successfully in sandbox mode. ARN generated."
  };
}

