import type { StoredBillingPlanItem } from "../utils/learnerBillingPlanStore";
import {
  normaliseAmount,
  type BillingInvoiceChargeLine,
} from "../utils/billingLedgerStore";

const MONEY_TOLERANCE = 0.01;

export function roundInvoiceMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function invoiceMoneyEqual(a: number, b: number): boolean {
  return Math.abs(roundInvoiceMoney(a) - roundInvoiceMoney(b)) <= MONEY_TOLERANCE;
}

function normalizeFeeDescription(value: unknown): string {
  return String(value || "").trim();
}

function amountCentsKey(amount: number): string {
  return roundInvoiceMoney(amount).toFixed(2);
}

function deterministicPlanLineKey(
  index: number,
  description: string,
  amount: number
): string {
  return `plan:${index}:${description}:${amountCentsKey(amount)}`;
}

function deterministicExtraLineKey(
  index: number,
  description: string,
  amount: number
): string {
  return `extra:${index}:${description}:${amountCentsKey(amount)}`;
}

/**
 * Build immutable charge-line snapshots from billing-plan fees + invoice-run extra fees.
 * Prefer persistent plan line id as lineKey when present.
 */
export function buildInvoiceChargeLines(
  planItems: StoredBillingPlanItem[] | undefined | null,
  extraFees?: StoredBillingPlanItem[] | undefined | null
): { ok: true; lines: BillingInvoiceChargeLine[]; total: number } | { ok: false; error: string } {
  const lines: BillingInvoiceChargeLine[] = [];

  const plan = Array.isArray(planItems) ? planItems : [];
  for (let index = 0; index < plan.length; index += 1) {
    const item = plan[index];
    const description = normalizeFeeDescription(item?.feeDescription);
    const amount = roundInvoiceMoney(normaliseAmount(item?.amount));
    if (!description || amount <= 0) continue;
    const persistentId = String(item?.id || "").trim();
    lines.push({
      lineKey: persistentId || deterministicPlanLineKey(index, description, amount),
      description,
      amount,
    });
  }

  const extras = Array.isArray(extraFees) ? extraFees : [];
  for (let index = 0; index < extras.length; index += 1) {
    const item = extras[index];
    const description = normalizeFeeDescription(item?.feeDescription);
    const amount = roundInvoiceMoney(normaliseAmount(item?.amount));
    if (!description || amount <= 0) continue;
    const persistentId = String(item?.id || "").trim();
    lines.push({
      lineKey: persistentId || deterministicExtraLineKey(index, description, amount),
      description,
      amount,
    });
  }

  if (!lines.length) {
    return { ok: false, error: "No charge lines could be built from billing plan / extra fees" };
  }

  const total = roundInvoiceMoney(lines.reduce((sum, line) => sum + line.amount, 0));
  return { ok: true, lines, total };
}

/** Concise human-readable description from snapshotted charge lines. */
export function formatInvoiceChargeDescription(lines: BillingInvoiceChargeLine[]): string {
  return lines
    .map((line) => String(line.description || "").trim())
    .filter(Boolean)
    .join("; ");
}

/** Multi-line breakdown for statement PDF / detail surfaces. */
export function formatInvoiceChargeLinesBreakdown(
  lines: BillingInvoiceChargeLine[],
  formatMoney: (amount: number) => string
): string {
  return lines
    .map((line) => `${line.description} — ${formatMoney(line.amount)}`)
    .join("\n");
}

export function normalizeInvoiceChargeLines(
  raw: unknown
): BillingInvoiceChargeLine[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) return undefined;
  const lines: BillingInvoiceChargeLine[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const description = normalizeFeeDescription(record.description ?? record.feeDescription);
    const amount = roundInvoiceMoney(normaliseAmount(record.amount));
    const lineKey = String(record.lineKey || "").trim();
    if (!description || amount <= 0 || !lineKey) continue;
    lines.push({ lineKey, description, amount });
  }
  return lines.length ? lines : undefined;
}

export function validateChargeLinesMatchAmount(
  lines: BillingInvoiceChargeLine[],
  invoiceAmount: number
): { ok: true } | { ok: false; error: string; chargeLineTotal: number; invoiceAmount: number } {
  const chargeLineTotal = roundInvoiceMoney(lines.reduce((sum, line) => sum + line.amount, 0));
  const amount = roundInvoiceMoney(normaliseAmount(invoiceAmount));
  if (!invoiceMoneyEqual(chargeLineTotal, amount)) {
    return {
      ok: false,
      error: `Charge line total (${chargeLineTotal}) does not match invoice amount (${amount})`,
      chargeLineTotal,
      invoiceAmount: amount,
    };
  }
  return { ok: true };
}
