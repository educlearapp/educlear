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
    case "Recent Only":
      return "Last 10 Transactions";
    case "Summary Only":
      return "Last 3 Months";
    default:
      return "All Time";
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

export function buildInvoiceRunDefaults(settings: BillingSettingsState, invoiceDate: string) {
  const message = resolveInvoiceMessage(settings);
  const dueDate = computeInvoiceDueDate(invoiceDate, settings);
  return {
    message:
      message ||
      "School fees are payable by the due date stated on this invoice.",
    dueDate,
    termsAndConditions: String(settings.invoice.termsAndConditions || "").trim(),
  };
}
