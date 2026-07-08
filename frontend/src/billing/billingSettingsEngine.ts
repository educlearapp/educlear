import type { BillingSettingsState } from "../billingSettings/types/billingSettings";
import { createDefaultBillingSettings } from "../billingSettings/components/billingSettingsConstants";
import { fetchBillingSettings } from "../billingSettings/billingSettingsApi";
import { normaliseIsoDate } from "./billingLedger";

const settingsCache = new Map<string, BillingSettingsState>();

export function clearBillingSettingsCache(schoolId?: string) {
  if (schoolId) settingsCache.delete(schoolId);
  else settingsCache.clear();
}

export async function loadBillingSettingsForSchool(
  schoolId: string
): Promise<BillingSettingsState> {
  const key = String(schoolId || "").trim();
  if (!key) return createDefaultBillingSettings();
  if (settingsCache.has(key)) return settingsCache.get(key)!;
  try {
    const settings = await fetchBillingSettings(key);
    settingsCache.set(key, settings);
    return settings;
  } catch {
    const fallback = createDefaultBillingSettings();
    settingsCache.set(key, fallback);
    return fallback;
  }
}

export function endOfMonthIso(invoiceDateIso: string): string {
  const invoiceDate = normaliseIsoDate(invoiceDateIso);
  if (!invoiceDate) return "";
  const [y, m] = invoiceDate.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
}

const MONTH_NAME_TO_MM: Record<string, string> = {
  january: "01",
  february: "02",
  march: "03",
  april: "04",
  may: "05",
  june: "06",
  july: "07",
  august: "08",
  september: "09",
  october: "10",
  november: "11",
  december: "12",
};

/** Normalize "August 2026" or YYYY-MM to YYYY-MM for invoice-run due dates. */
export function normalizeInvoicePeriodForDueDate(
  input: string,
  invoiceDateFallback?: string
): string {
  const raw = String(input || "").trim();
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;

  const fromDate = String(invoiceDateFallback || "").trim().slice(0, 7);

  const lower = raw.toLowerCase();
  for (const [name, mm] of Object.entries(MONTH_NAME_TO_MM)) {
    const monthPattern = new RegExp(`\\b${name}\\b`, "i");
    if (!monthPattern.test(lower)) continue;
    const yearMatch = raw.match(/\b(20\d{2})\b/);
    const year = yearMatch ? yearMatch[1] : String(invoiceDateFallback || "").slice(0, 4);
    if (year) return `${year}-${mm}`;
  }

  if (/^\d{4}-\d{2}$/.test(fromDate)) return fromDate;
  return fromDate || raw;
}

export function resolveRecurringMonthlyInvoiceDueDay(settings: BillingSettingsState): number {
  const day = Number(settings?.financePolicy?.monthlyFeeDueDay);
  if (!Number.isFinite(day)) return 3;
  return Math.min(31, Math.max(1, Math.round(day)));
}

export function computeRecurringMonthlyInvoiceDueDate(
  invoicePeriod: string,
  recurringDueDay: number,
  invoiceDateFallback?: string
): string {
  const period = normalizeInvoicePeriodForDueDate(invoicePeriod, invoiceDateFallback);
  if (!/^\d{4}-\d{2}$/.test(period)) {
    return normaliseIsoDate(invoiceDateFallback) || "";
  }
  const [year, month] = period.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  const day = Math.min(Math.max(1, Math.round(recurringDueDay) || 3), lastDay);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function computeInvoiceRunRecurringDueDate(
  invoicePeriod: string,
  settings: BillingSettingsState,
  invoiceDateFallback?: string
): string {
  const dueDay = resolveRecurringMonthlyInvoiceDueDay(settings);
  return computeRecurringMonthlyInvoiceDueDate(invoicePeriod, dueDay, invoiceDateFallback);
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

export function buildInvoiceRunDefaults(
  settings: BillingSettingsState,
  invoiceDate: string,
  invoicePeriod?: string
) {
  const message = resolveInvoiceMessage(settings);
  const period = String(invoicePeriod || "").trim() || invoiceDate.slice(0, 7);
  const dueDate = computeInvoiceRunRecurringDueDate(period, settings, invoiceDate);
  return {
    message:
      message ||
      "School fees are payable by the due date stated on this invoice.",
    dueDate,
    termsAndConditions: String(settings.invoice.termsAndConditions || "").trim(),
  };
}
