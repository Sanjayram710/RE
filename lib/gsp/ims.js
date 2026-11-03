import { isApiWorking, getGspMode, logGspRequest } from "./client.js";

/**
 * GSP Invoice Management System (IMS) Adapter
 */
export async function getInvoices(gstin, period = "102026") {
  const readiness = isApiWorking(83); // API #83: IMS - Get Invoices (Status: partial)
  if (!readiness.allowed) {
    return {
      success: false,
      status: readiness.status,
      message: readiness.message,
      apiId: 83,
      apiName: "IMS - Get Invoices"
    };
  }

  const { mode, isLive, baseUrl } = getGspMode();
  logGspRequest("IMS_GET_INVOICES", { gstin, period, mode });

  if (isLive) {
    try {
      const resp = await fetch(`${baseUrl}/ims/invoices?gstin=${gstin}&period=${period}`, {
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
    records: []
  };
}

export async function saveAction(gstin, period = "102026", actions = []) {
  const readiness = isApiWorking(86); // API #86: IMS - Save IMS Action (Status: working)
  if (!readiness.allowed) {
    return {
      success: false,
      status: readiness.status,
      message: readiness.message,
      apiId: 86,
      apiName: "IMS - Save IMS Action"
    };
  }

  const { mode, isLive, baseUrl } = getGspMode();
  logGspRequest("IMS_SAVE_ACTION", { gstin, period, mode, actionCount: actions.length });

  if (isLive) {
    try {
      const resp = await fetch(`${baseUrl}/ims/action`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "client-id": process.env.GSP_CLIENT_ID
        },
        body: JSON.stringify({ gstin, period, actions })
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
    message: `IMS action applied to ${actions.length} invoices successfully.`,
    updated_count: actions.length
  };
}

