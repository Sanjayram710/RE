/**
 * Integer-Paise Monetary Arithmetic Module
 * Eliminates IEEE-754 floating-point drift in GST tax, ITC, and Rule 88A calculations.
 * 1 INR = 100 Paise (strict integer).
 */

export function toPaise(rupees) {
  if (rupees === undefined || rupees === null || rupees === "") return 0;
  const num = Number(rupees);
  if (!Number.isFinite(num)) {
    throw new TypeError(`Invalid monetary amount: ${rupees}`);
  }
  return Math.round((num + Number.EPSILON) * 100);
}

export function fromPaise(paise) {
  if (paise === undefined || paise === null) return 0;
  const intVal = Math.trunc(Number(paise));
  if (!Number.isFinite(intVal)) {
    throw new TypeError(`Invalid paise amount: ${paise}`);
  }
  return intVal / 100;
}

export function addPaise(...values) {
  let sum = 0;
  for (const v of values) {
    sum += Math.trunc(Number(v) || 0);
  }
  return sum;
}

export function subPaise(a, b) {
  return Math.trunc(Number(a) || 0) - Math.trunc(Number(b) || 0);
}

export function sumRupeesAsPaise(items, selector) {
  let total = 0;
  for (const item of items) {
    total += toPaise(selector ? selector(item) : item);
  }
  return total;
}

export function percentOfPaise(paise, percent) {
  const p = Math.trunc(Number(paise) || 0);
  const rateBps = Math.round((Number(percent) || 0) * 100);
  return Math.round((p * rateBps) / 10000);
}

export function ratioSharePaise(totalPaise, numeratorPaise, denominatorPaise) {
  const den = Math.trunc(Number(denominatorPaise) || 0);
  if (den <= 0) return 0;
  const tot = Math.trunc(Number(totalPaise) || 0);
  const num = Math.trunc(Number(numeratorPaise) || 0);
  return Math.round((tot * num) / den);
}
