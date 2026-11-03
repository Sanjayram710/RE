import { isApiWorking, getGspMode, logGspRequest } from "./client.js";

/**
 * GSP Authentication Adapter
 */
export async function requestOtp(gstin, mobile = "9876543210") {
  const readiness = isApiWorking(4); // API #4: Request for OTP
  if (!readiness.allowed) {
    return { success: false, status: readiness.status, message: readiness.message };
  }

  const { mode, isLive, baseUrl } = getGspMode();
  logGspRequest("AUTH_REQUEST_OTP", { gstin, mobile, mode });

  if (isLive) {
    try {
      const resp = await fetch(`${baseUrl}/authenticate/otp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "client-id": process.env.GSP_CLIENT_ID
        },
        body: JSON.stringify({ gstin, mobile })
      });
      return await resp.json();
    } catch (err) {
      return { success: false, error: "Live GSP connection error: " + err.message };
    }
  }

  // Realistic MOCK response
  return {
    success: true,
    mode: "demo",
    status_cd: "1",
    message: "OTP sent successfully to registered mobile ending with " + mobile.slice(-4),
    txn: `TXN_${Date.now()}`
  };
}

export async function requestAuthToken(gstin, otp) {
  const readiness = isApiWorking(5); // API #5: Request forAuthorization token
  if (!readiness.allowed) {
    return { success: false, status: readiness.status, message: readiness.message };
  }

  const { mode, isLive, baseUrl } = getGspMode();
  logGspRequest("AUTH_REQUEST_TOKEN", { gstin, otp, mode });

  if (isLive) {
    try {
      const resp = await fetch(`${baseUrl}/authenticate/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "client-id": process.env.GSP_CLIENT_ID,
          "client-secret": process.env.GSP_CLIENT_SECRET
        },
        body: JSON.stringify({ gstin, otp })
      });
      return await resp.json();
    } catch (err) {
      return { success: false, error: "Live GSP connection error: " + err.message };
    }
  }

  // Realistic MOCK token
  return {
    success: true,
    mode: "demo",
    status_cd: "1",
    auth_token: `gst_auth_tok_${Buffer.from(gstin + ":" + Date.now()).toString("base64")}`,
    expiry: Date.now() + 3600 * 6 * 1000,
    session_status: "ACTIVE"
  };
}

