/**
 * Capture Payment amount ingest — independent of ledger `normaliseAmount`
 * (which treats negatives as valid for invoices/credits).
 *
 * Money is stored as JSON IEEE float today. Round to cents on ingest so
 * 0.1 + 0.2 style drift cannot enter a new manual payment.
 */

export const CAPTURE_PAYMENT_MAX_AMOUNT = 99_999_999.99;

export type CapturePaymentAmountOk = { ok: true; amount: number };
export type CapturePaymentAmountErr = { ok: false; error: string; code: string };
export type CapturePaymentAmountResult = CapturePaymentAmountOk | CapturePaymentAmountErr;

export function roundMoneyCents(value: number): number {
  return Math.round(value * 100) / 100;
}

function coerceRawAmount(value: unknown): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.replace(/,/g, "").trim();
    if (!trimmed) return null;
    if (!/^[+-]?(?:\d+)(?:\.\d+)?$/.test(trimmed)) return null;
    const n = Number(trimmed);
    if (!Number.isFinite(n)) return null;
    return n;
  }
  return null;
}

export function parseCapturePaymentAmount(value: unknown): CapturePaymentAmountResult {
  if (value === null || value === undefined || value === "") {
    return { ok: false, error: "Missing payment amount", code: "AMOUNT_MISSING" };
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    if (Number.isNaN(value)) {
      return { ok: false, error: "Payment amount is not a number", code: "AMOUNT_NAN" };
    }
    return { ok: false, error: "Payment amount is not a finite number", code: "AMOUNT_INFINITE" };
  }
  const n = coerceRawAmount(value);
  if (n === null) {
    return { ok: false, error: "Payment amount is malformed", code: "AMOUNT_MALFORMED" };
  }
  if (n === 0) {
    return { ok: false, error: "Payment amount must be greater than zero", code: "AMOUNT_ZERO" };
  }
  if (n < 0) {
    return { ok: false, error: "Payment amount cannot be negative", code: "AMOUNT_NEGATIVE" };
  }
  if (n > CAPTURE_PAYMENT_MAX_AMOUNT) {
    return {
      ok: false,
      error: "Payment amount exceeds the supported maximum",
      code: "AMOUNT_TOO_LARGE",
    };
  }
  const cents = roundMoneyCents(n);
  if (cents <= 0) {
    return { ok: false, error: "Payment amount must be greater than zero", code: "AMOUNT_ZERO" };
  }
  return { ok: true, amount: cents };
}
