/**
 * Authenticated API Client for SimpleGST v2
 * - Tracks in-flight AbortControllers so GSTIN switch aborts stale requests
 * - Enforces X-CSRF-Token on all state-changing calls
 * - Handles 401 session expiry cleanly
 */

let csrfToken = "";
const inflightControllers = new Set();

export function setCsrfToken(token) {
  csrfToken = token || "";
}

function readCookie(name) {
  if (typeof document === "undefined") return "";
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

export function abortAllRequests() {
  for (const ctrl of inflightControllers) {
    try {
      ctrl.abort();
    } catch { }
  }
  inflightControllers.clear();
}

export async function apiRequest(url, options = {}, { onUnauthorized } = {}) {
  const method = (options.method || "GET").toUpperCase();
  const isStateChanging = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
  const controller = new AbortController();
  inflightControllers.add(controller);

  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData) && !headers["Content-Type"] && options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (isStateChanging) {
    const token = csrfToken || readCookie("simplegst_csrf");
    if (token) headers["X-CSRF-Token"] = token;
  }

  try {
    const res = await fetch(url, {
      ...options,
      method,
      headers,
      credentials: "same-origin",
      signal: controller.signal
    });

    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { rawText: text };
    }

    if (res.status === 401) {
      if (typeof onUnauthorized === "function") onUnauthorized(data.error || "Session expired");
      const err = new Error(data.error || "Your session expired. Please sign in again.");
      err.status = 401;
      throw err;
    }

    if (!res.ok) {
      const err = new Error(data.error || `Request failed (${res.status})`);
      err.status = res.status;
      err.data = data;
      throw err;
    }

    if (data.csrfToken) setCsrfToken(data.csrfToken);
    return data;
  } finally {
    inflightControllers.delete(controller);
  }
}

