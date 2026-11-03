import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load API status dictionary
const apiStatusPath = path.join(__dirname, "..", "..", "data", "api-status.json");
let apiStatusList = [];
try {
  if (fs.existsSync(apiStatusPath)) {
    apiStatusList = JSON.parse(fs.readFileSync(apiStatusPath, "utf8"));
  }
} catch (e) {
  console.warn("[GSP] Warning: could not load data/api-status.json", e.message);
}

export function getApiStatusById(id) {
  return apiStatusList.find(x => x.id === id);
}

export function getApiStatusByName(apiName) {
  return apiStatusList.find(x => x.api.toLowerCase() === apiName.toLowerCase());
}

export function isApiWorking(apiIdentifier) {
  const item = typeof apiIdentifier === "number" 
    ? getApiStatusById(apiIdentifier) 
    : getApiStatusByName(apiIdentifier);
  
  if (!item) return { allowed: true, status: "unknown" }; // default allowed if unlisted
  const status = item.status;
  const isWorking = status === "working";
  return {
    allowed: isWorking,
    status,
    id: item.id,
    api: item.api,
    group: item.group,
    message: isWorking ? "Operational" : `Not available yet (Status: ${status})`
  };
}

export function getGspMode() {
  const baseUrl = process.env.GSP_BASE_URL;
  const clientId = process.env.GSP_CLIENT_ID;
  const clientSecret = process.env.GSP_CLIENT_SECRET;

  const isLive = Boolean(baseUrl && clientId && clientSecret);
  return {
    mode: isLive ? "live-sandbox" : "demo",
    isLive,
    baseUrl: baseUrl || "https://sandbox.mock.gst.internal/v1"
  };
}

/**
 * Sanitizes headers and body to log requests without secrets
 */
export function sanitizeForLogging(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const copy = Array.isArray(obj) ? [...obj] : { ...obj };
  const sensitiveKeys = ["secret", "client_secret", "clientsecret", "password", "token", "auth_token", "otp"];
  
  for (const k of Object.keys(copy)) {
    const lower = k.toLowerCase();
    if (sensitiveKeys.some(s => lower.includes(s))) {
      copy[k] = "[REDACTED]";
    } else if (typeof copy[k] === "object" && copy[k] !== null) {
      copy[k] = sanitizeForLogging(copy[k]);
    }
  }
  return copy;
}

export function logGspRequest(action, payload) {
  const sanitized = sanitizeForLogging(payload);
  console.log(`[GSP Request] [${new Date().toISOString()}] Action: ${action}`, JSON.stringify(sanitized));
}

