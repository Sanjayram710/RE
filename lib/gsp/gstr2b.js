import { isApiWorking, getGspMode, logGspRequest } from "./client.js";

/**
 * GSP GSTR-2B Adapter
 */
export async function generate2B(gstin, period = "102026") {
  const readiness = isApiWorking(88); // API #88: GSTR2B - Generate 2B On Demand API
  if (!readiness.allowed) {
    return { success: false, status: readiness.status, message: readiness.message };
  }

  const { mode, isLive, baseUrl } = getGspMode();
  logGspRequest("GSTR2B_GENERATE_ON_DEMAND", { gstin, period, mode });

  if (isLive) {
    try {
      const resp = await fetch(`${baseUrl}/returns/gstr2b/generate?gstin=${gstin}&ret_period=${period}`, {
        method: "POST",
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
    status_cd: "1",
    ref_id: `G2B_REQ_${Date.now()}`,
    status: "IN_PROGRESS",
    message: "GSTR-2B generation initiated on GSTN server."
  };
}

export async function getGenStatus(gstin, period = "102026") {
  const readiness = isApiWorking(89); // API #89: GSTR2B - Get 2B Gen Status API
  if (!readiness.allowed) {
    return { success: false, status: readiness.status, message: readiness.message };
  }

  const { mode, isLive, baseUrl } = getGspMode();
  logGspRequest("GSTR2B_GET_STATUS", { gstin, period, mode });

  if (isLive) {
    try {
      const resp = await fetch(`${baseUrl}/returns/gstr2b/status?gstin=${gstin}&ret_period=${period}`, {
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
    status_cd: "1",
    status: "COMPLETED",
    gen_date: new Date().toISOString().split("T")[0]
  };
}

export async function getDetails(gstin, period = "102026") {
  const readiness = isApiWorking(90); // API #90: GSTR2B - Get All Details
  if (!readiness.allowed) {
    return { success: false, status: readiness.status, message: readiness.message };
  }

  const { mode, isLive, baseUrl } = getGspMode();
  logGspRequest("GSTR2B_GET_DETAILS", { gstin, period, mode });

  if (isLive) {
    try {
      const resp = await fetch(`${baseUrl}/returns/gstr2b/details?gstin=${gstin}&ret_period=${period}`, {
        headers: { "client-id": process.env.GSP_CLIENT_ID }
      });
      return await resp.json();
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // Realistic MOCK 2B items
  return {
    success: true,
    mode: "demo",
    gstin,
    period,
    summary: {
      itc_avail: {
        nonrev_sup: { txval: 785000, iamt: 48000, camt: 35200, samt: 35200, csamt: 0, ttl_tax: 118400 }
      },
      itc_nonavail: {
        nonrev_sup: { txval: 45000, iamt: 8100, camt: 0, samt: 0, csamt: 0, ttl_tax: 8100 }
      }
    },
    invoices: [
      {
        ctin: "32KERALA9988A1Z1",
        partyName: "Malabar Spice Wholesalers",
        inum: "MSW-9912",
        idt: "05-10-2026",
        val: 354000,
        txval: 300000,
        rate: 18,
        igst: 0,
        cgst: 27000,
        sgst: 27000,
        itc_eligible: "Y"
      },
      {
        ctin: "29KARNAT7766B1Z4",
        partyName: "Deccan Packaging Containers Ltd",
        inum: "DPC-402",
        idt: "15-10-2026",
        val: 295000,
        txval: 250000,
        rate: 18,
        igst: 45000,
        cgst: 0,
        sgst: 0,
        itc_eligible: "Y"
      },
      {
        ctin: "32CALICU3344C1Z9",
        partyName: "Calicut Printing & Stationery Co",
        inum: "CPS-108",
        idt: "22-10-2026",
        val: 94400,
        txval: 80000,
        rate: 18,
        igst: 0,
        cgst: 7200,
        sgst: 7200,
        itc_eligible: "Y"
      }
    ]
  };
}

