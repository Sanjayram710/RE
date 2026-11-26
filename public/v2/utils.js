/**
 * Pure utility helpers for SimpleGST v2
 * - Strict HTML escaping (XSS prevention)
 * - Integer-paise formatting with Indian grouping (zero float math in browser)
 */

const ESC_MAP = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
  "/": "&#x2F;"
};

export function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[&<>"'/]/g, (ch) => ESC_MAP[ch]);
}

/**
 * Formats integer paise (e.g. 123456 -> "₹1,234.56" or "₹1,235" when whole)
 * using integer division/modulo only (no IEEE-754 float arithmetic).
 */
export function formatPaiseINR(paiseValue, { showDecimals = false } = {}) {
  const n = Math.trunc(Number(paiseValue) || 0);
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const rupees = Math.floor(abs / 100);
  const remPaise = abs % 100;
  const grouped = new Intl.NumberFormat("en-IN").format(rupees);
  if (!showDecimals && remPaise === 0) {
    return `${sign}₹${grouped}`;
  }
  return `${sign}₹${grouped}.${String(remPaise).padStart(2, "0")}`;
}

/**
 * Converts a rupee string or number (from backend JSON) into integer paise
 * via decimal string parsing (zero float multiplication).
 */
export function rupeesToPaise(val) {
  if (val === null || val === undefined || val === "") return 0;
  const str = String(val).trim();
  if (!/^-?\d+(\.\d+)?$/.test(str)) return 0;
  const neg = str.startsWith("-");
  const clean = neg ? str.slice(1) : str;
  const [wholePart, fracPart = ""] = clean.split(".");
  const paddedFrac = (fracPart + "00").slice(0, 2);
  const paise = Number.parseInt(wholePart, 10) * 100 + Number.parseInt(paddedFrac, 10);
  return neg ? -paise : paise;
}

export function formatDateIN(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return escapeHtml(dateStr);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function getCurrentPeriodMMYYYY(date = new Date()) {
  return `${String(date.getMonth() + 1).padStart(2, "0")}${date.getFullYear()}`;
}

export function getNextPeriodMMYYYY(period) {
  const str = String(period || "").trim();
  if (!/^\d{6}$/.test(str)) return getCurrentPeriodMMYYYY();
  let mm = Number.parseInt(str.slice(0, 2), 10) + 1;
  let yyyy = Number.parseInt(str.slice(2, 6), 10);
  if (mm > 12) {
    mm = 1;
    yyyy += 1;
  }
  return `${String(mm).padStart(2, "0")}${yyyy}`;
}

export function formatPeriodLabel(period) {
  const str = String(period || "").trim();
  if (!/^\d{6}$/.test(str)) return str || "—";
  const mm = Number.parseInt(str.slice(0, 2), 10);
  const yyyy = Number.parseInt(str.slice(2, 6), 10);
  if (mm < 1 || mm > 12) return str;
  return new Date(yyyy, mm - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

export function getTimeGreeting(date = new Date()) {
  const hr = date.getHours();
  if (hr < 12) return "Good morning";
  if (hr < 17) return "Good afternoon";
  return "Good evening";
}

