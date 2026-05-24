import type { BillingSettingsState } from "../routes/billingSettings";

function isValidCalendarYmd(y: number, m: number, d: number): boolean {
  if (!Number.isFinite(y) || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function toIsoYmd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Normalise to YYYY-MM-DD. */
export function normaliseIsoDate(value: unknown): string {
  if (value === null || value === undefined) return "";
  const raw = String(value).trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split("-").map((p) => Number(p));
    return isValidCalendarYmd(y, m, d) ? raw : "";
  }
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return "";
}

export function endOfMonthIso(invoiceDateIso: string): string {
  const invoiceDate = normaliseIsoDate(invoiceDateIso);
  if (!invoiceDate) return "";
  const [y, m] = invoiceDate.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return toIsoYmd(y, m, lastDay);
}

export function computeInvoiceDueDate(
  invoiceDateIso: string,
  settings: BillingSettingsState,
  explicitDueDate?: string
): string {
  const invoiceDate = normaliseIsoDate(invoiceDateIso) || new Date().toISOString().slice(0, 10);
  const rule = String(settings.invoice.dueDate || "Invoice Date").trim();
  const autoDue = settings.invoice.invoiceFeatures?.autoDueDates === true;

  const explicit = normaliseIsoDate(explicitDueDate);
  if (!autoDue && explicit) return explicit;
  if (rule === "Custom" && explicit) return explicit;
  if (rule === "End of Month") return endOfMonthIso(invoiceDate) || invoiceDate;
  if (rule === "Custom" && !explicit) return invoiceDate;
  return invoiceDate;
}

export function normaliseLatePenaltyAmount(value: unknown): number {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.round(amount * 100) / 100;
}

export function resolvePenaltyConfig(settings: BillingSettingsState) {
  const amount = normaliseLatePenaltyAmount(settings.invoice.latePenaltyAmount);
  const featureEnabled = settings.invoice.invoiceFeatures?.latePaymentFine === true;
  return {
    enabled: featureEnabled && amount > 0,
    amount,
    description: "Late payment penalty",
  };
}

export function resolveConfiguredPenaltyAmount(settings: BillingSettingsState): number {
  return normaliseLatePenaltyAmount(settings.invoice.latePenaltyAmount);
}

export function buildInvoiceReference(
  settings: BillingSettingsState,
  invoiceDateIso: string,
  sequence: number,
  fallback: string
): string {
  const prefix = String(settings.invoice.invoicePrefix || "").trim();
  const autoNum = settings.invoice.invoiceFeatures?.monthlyAutoNumbering === true;
  const date = normaliseIsoDate(invoiceDateIso) || new Date().toISOString().slice(0, 10);
  const [y, m] = date.split("-");
  const monthKey = `${y}${m}`;
  if (autoNum) {
    const seq = String(Math.max(1, sequence)).padStart(4, "0");
    return `${prefix}${monthKey}-${seq}`;
  }
  if (prefix) return `${prefix}${fallback}`;
  return fallback;
}

export function resolveInvoiceMessage(settings: BillingSettingsState): string {
  return (
    String(settings.invoice.standardMessage || "").trim() ||
    String(settings.invoice.termsAndConditions || "").trim()
  );
}

export function resolveStatementMessage(settings: BillingSettingsState): string {
  return String(settings.statement.standardMessage || "").trim();
}

export type BillingEmailTemplate = {
  subject: string;
  message: string;
  sms: string;
};

export function resolveEmailTemplate(
  settings: BillingSettingsState,
  doc: "invoice" | "statement" | "receipt"
): BillingEmailTemplate {
  const section = settings[doc];
  return {
    subject: String(section.standardEmailSubject || "").trim(),
    message: String(section.standardEmailMessage || "").trim(),
    sms: String(section.standardSmsMessage || "").trim(),
  };
}

export function mapStatementHistoryToDefaultPeriod(statementHistory: string): string {
  switch (String(statementHistory || "").trim()) {
    case "Full History":
      return "All Time";
    case "Recent Only":
    case "Summary Only":
      return "Last 3 Months";
    default:
      return "Last 3 Months";
  }
}

export function substituteBillingTokens(
  template: string,
  tokens: Record<string, string>
): string {
  let out = String(template || "");
  for (const [key, value] of Object.entries(tokens)) {
    out = out.replace(new RegExp(`\\[${key}\\]`, "gi"), value);
  }
  return out;
}
