import { isApiWorking, getGspMode, logGspRequest } from "./client.js";

/**
 * GSP GSTR-3B Adapter
 */
export async function getDetails(gstin, period = "102026") {
  const readiness = isApiWorking(92); // API #92: GSTR3B - Get GSTR3B Details
  if (!readiness.allowed) {
    return { success: false, status: readiness.status, message: readiness.message };
  }

  const { mode, isLive, baseUrl } = getGspMode();
  logGspRequest("GSTR3B_GET_DETAILS", { gstin, period, mode });

  if (isLive) {
    try {
      const resp = await fetch(`${baseUrl}/returns/gstr3b?gstin=${gstin}&ret_period=${period}`, {
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
    status: "NOT_FILED",
    due_date: "20-11-2026"
  };
}

export async function getItcAutoCalc(gstin, period = "102026") {
  const readiness = isApiWorking(93); // API #93: GSTR3B - Get ITC Liability Auto Calc Details
  if (!readiness.allowed) {
    return { success: false, status: readiness.status, message: readiness.message };
  }

  const { mode, isLive, baseUrl } = getGspMode();
  logGspRequest("GSTR3B_GET_ITC_AUTOCALC", { gstin, period, mode });

  if (isLive) {
    try {
      const resp = await fetch(`${baseUrl}/returns/gstr3b/autocalc?gstin=${gstin}&ret_period=${period}`, {
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
    period,
    auto_calc: {
      table3_1_outward: { txval: 1240000, iamt: 122400, camt: 50400, samt: 50400, total_tax: 223200 },
      table4_itc_eligible: { iamt: 48000, camt: 35200, samt: 35200, total_tax: 118400 }
    }
  };
}

export async function getSystemInterest(gstin, period = "102026") {
  const readiness = isApiWorking(98); // API #98: GSTR3B - Get system calculated interest
  if (!readiness.allowed) {
    return { success: false, status: readiness.status, message: readiness.message };
  }

  const { mode, isLive, baseUrl } = getGspMode();
  logGspRequest("GSTR3B_GET_SYSTEM_INTEREST", { gstin, period, mode });

  if (isLive) {
    try {
      const resp = await fetch(`${baseUrl}/returns/gstr3b/interest?gstin=${gstin}&ret_period=${period}`, {
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
    interest: { iamt: 0, camt: 0, samt: 0, total: 0 },
    late_fee: { camt: 0, samt: 0, total: 0 }
  };
}

export async function offsetLiability(gstin, period = "102026", offsetData = {}) {
  const readiness = isApiWorking(99); // API #99: GSTR3B - Offset Liability GSTR3B data
  if (!readiness.allowed) {
    return { success: false, status: readiness.status, message: readiness.message };
  }

  const { mode, isLive, baseUrl } = getGspMode();
  logGspRequest("GSTR3B_OFFSET_LIABILITY", { gstin, period, mode, offsetData });

  if (isLive) {
    try {
      const resp = await fetch(`${baseUrl}/returns/gstr3b/offset`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "client-id": process.env.GSP_CLIENT_ID
        },
        body: JSON.stringify({ gstin, period, ...offsetData })
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
    message: "Tax liability offset against available ITC and cash ledger successfully.",
    offset_status: "SUCCESS",
    details: {
      itc_utilized: { iamt: 48000, camt: 35200, samt: 35200, total: 118400 },
      cash_paid: { iamt: 74400, camt: 15200, samt: 15200, total: 104800 }
    }
  };
}

/**
 * File GSTR-3B: Sandbox-only, requires explicit user confirmation & OTP
 */
export async function fileGstr3b(gstin, period, otp, consent) {
  if (!consent) {
    return { success: false, message: "Explicit confirmation and consent checkbox required before filing" };
  }
  if (!otp || String(otp).trim().length !== 6) {
    return { success: false, message: "Valid 6-digit OTP is required for digital verification (EVC)" };
  }

  const readiness = isApiWorking(91); // API #91: GSTR3B - File GSTR3B data
  if (!readiness.allowed) {
    return { success: false, status: readiness.status, message: readiness.message };
  }

  const { mode } = getGspMode();
  logGspRequest("GSTR3B_FILE_SANDBOX", { gstin, period, mode, consentGiven: true });

  const fakeArn = `AA${gstin.substring(0, 2)}${period.slice(-4)}${Math.floor(2000000 + Math.random() * 7000000)}`;

  return {
    success: true,
    mode: "sandbox",
    environment: "GSTN Sandbox Test Environment (Simulated)",
    arn: fakeArn,
    filingDate: new Date().toISOString(),
    status: "FILED",
    message: "GSTR-3B filed successfully in sandbox mode. Acknowledgement Reference Number (ARN) issued."
  };
}

