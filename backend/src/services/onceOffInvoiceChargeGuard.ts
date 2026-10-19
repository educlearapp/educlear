import { prisma } from "../prisma";
import { isDaSilvaSchoolId, refreshDaSilvaSchoolIdCache } from "./daSilvaSchoolResolve";
import { resolveFeeStructureType } from "./billingPlanRecurringGuard";
import type { StoredBillingPlanItem } from "../utils/learnerBillingPlanStore";
import {
  normalizeInvoicePeriod,
  type BillingLedgerEntry,
} from "../utils/billingLedgerStore";
import {
  isEduClearUndoCorrectionEntry,
  isUndoneLedgerEntry,
} from "../utils/billingDisplayRules";

export type OnceOffCatalogueFee = {
  id: string;
  name: string;
  amount: number;
  type: string;
};

export type OnceOffPlanCleanupLine = {
  learnerId: string;
  lineId: string;
  feeStructureId: string;
  description: string;
  amount: number;
};

const MONEY_TOLERANCE = 0.01;

export function isOnceOffCatalogueType(type: unknown): boolean {
  const key = String(type ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  return key === "ONCE_OFF" || key === "ONCEOFF";
}

function normaliseName(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function moneyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= MONEY_TOLERANCE;
}

function periodKey(entry: BillingLedgerEntry): string {
  return normalizeInvoicePeriod(entry.invoicePeriod || "", entry.date);
}

function isActiveInvoice(entry: BillingLedgerEntry): boolean {
  return (
    entry.type === "invoice" &&
    !isUndoneLedgerEntry(entry) &&
    !isEduClearUndoCorrectionEntry(entry)
  );
}

/** Catalogue once-off fee for this plan or extra line. Ambiguous names are left unmatched. */
export function matchOnceOffCatalogueFee(
  item: StoredBillingPlanItem,
  catalogue: OnceOffCatalogueFee[]
): OnceOffCatalogueFee | null {
  const explicitId = String(item.feeStructureId || "").trim();
  if (explicitId) {
    const byId = catalogue.find(
      (fee) => fee.id === explicitId && isOnceOffCatalogueType(fee.type)
    );
    return byId || null;
  }
  const name = normaliseName(item.feeDescription);
  if (!name) return null;
  const named = catalogue.filter(
    (fee) => isOnceOffCatalogueType(fee.type) && normaliseName(fee.name) === name
  );
  if (named.length === 1) return named[0];
  const amount = Number(item.amount) || 0;
  const sameAmount = named.filter((fee) => moneyEqual(Number(fee.amount) || 0, amount));
  return sameAmount.length === 1 ? sameAmount[0] : null;
}

function descriptionNamesFee(description: unknown, feeName: string): boolean {
  const target = normaliseName(feeName);
  if (!target) return false;
  return String(description || "")
    .split(/[;\n|]/)
    .some((part) => normaliseName(part) === target);
}

function chargeLineMatchesFee(
  line: { lineKey?: string; description?: string; amount?: number; feeStructureId?: string },
  fee: OnceOffCatalogueFee,
  planLineId: string,
  nameIsUnique: boolean
): boolean {
  if (planLineId && String(line.lineKey || "").trim() === planLineId) return true;
  if (String(line.feeStructureId || "").trim() === fee.id) return true;
  if (normaliseName(line.description) !== normaliseName(fee.name)) return false;
  if (nameIsUnique) return true;
  return moneyEqual(Number(line.amount) || 0, Number(fee.amount) || 0);
}

function invoiceAlreadyContainsFee(
  entry: BillingLedgerEntry,
  fee: OnceOffCatalogueFee,
  planLineId: string,
  nameIsUnique: boolean
): boolean {
  const lines = Array.isArray(entry.chargeLines) ? entry.chargeLines : [];
  if (lines.length) {
    return lines.some((line) => chargeLineMatchesFee(line, fee, planLineId, nameIsUnique));
  }
  return descriptionNamesFee(entry.description, fee.name);
}

function priorInvoicesForLearner(
  ledger: BillingLedgerEntry[],
  learnerId: string,
  invoicePeriod: string
): BillingLedgerEntry[] {
  const learner = String(learnerId || "").trim();
  const period = normalizeInvoicePeriod(invoicePeriod);
  if (!learner || !period) return [];
  return ledger.filter((entry) => {
    if (!isActiveInvoice(entry)) return false;
    const onLearner =
      String(entry.learnerId || "").trim() === learner ||
      String(entry.billedLearnerId || "").trim() === learner;
    if (!onLearner) return false;
    const entryPeriod = periodKey(entry);
    return Boolean(entryPeriod) && entryPeriod < period;
  });
}

function nameIsUniqueOnceOff(fee: OnceOffCatalogueFee, catalogue: OnceOffCatalogueFee[]): boolean {
  const name = normaliseName(fee.name);
  return (
    catalogue.filter(
      (candidate) =>
        isOnceOffCatalogueType(candidate.type) && normaliseName(candidate.name) === name
    ).length === 1
  );
}

function keepItem(
  item: StoredBillingPlanItem,
  catalogue: OnceOffCatalogueFee[],
  prior: BillingLedgerEntry[]
): StoredBillingPlanItem | null {
  const fee = matchOnceOffCatalogueFee(item, catalogue);
  if (!fee) return item;
  const planLineId = String(item.id || "").trim();
  const unique = nameIsUniqueOnceOff(fee, catalogue);
  const already = prior.some((entry) => invoiceAlreadyContainsFee(entry, fee, planLineId, unique));
  if (already) return null;
  return { ...item, feeStructureId: fee.id };
}

/**
 * Drop once-off catalogue lines that already appear on an earlier invoice for this learner.
 * Monthly lines, and once-off lines with no reliable prior evidence, stay.
 * A lump-sum invoice is evidence only when its description names the fee. Amount changes are not evidence.
 */
export function applyOnceOffRecurrenceGuard(input: {
  planItems: StoredBillingPlanItem[];
  extraFees?: StoredBillingPlanItem[] | null;
  catalogue: OnceOffCatalogueFee[];
  ledger: BillingLedgerEntry[];
  learnerId: string;
  invoicePeriod: string;
}): { planItems: StoredBillingPlanItem[]; extraFees: StoredBillingPlanItem[] } {
  const catalogue = input.catalogue || [];
  if (!catalogue.length) {
    return {
      planItems: input.planItems || [],
      extraFees: input.extraFees || [],
    };
  }
  const prior = priorInvoicesForLearner(input.ledger, input.learnerId, input.invoicePeriod);
  return {
    planItems: (input.planItems || [])
      .map((item) => keepItem(item, catalogue, prior))
      .filter((item): item is StoredBillingPlanItem => Boolean(item)),
    extraFees: (input.extraFees || [])
      .map((item) => keepItem(item, catalogue, prior))
      .filter((item): item is StoredBillingPlanItem => Boolean(item)),
  };
}

/** Once-off plan lines that already have an itemised or named charge, safe to remove from the plan. */
export function onceOffPlanLinesToRetire(input: {
  plansByLearnerId: Record<string, StoredBillingPlanItem[]>;
  catalogue: OnceOffCatalogueFee[];
  ledger: BillingLedgerEntry[];
}): OnceOffPlanCleanupLine[] {
  const retired: OnceOffPlanCleanupLine[] = [];
  for (const [learnerId, items] of Object.entries(input.plansByLearnerId || {})) {
    for (const item of items || []) {
      const lineId = String(item.id || "").trim();
      const fee = matchOnceOffCatalogueFee(item, input.catalogue);
      if (!lineId || !fee) continue;
      const kept = keepItem(item, input.catalogue, priorInvoicesForLearner(input.ledger, learnerId, "9999-12"));
      if (kept) continue;
      retired.push({
        learnerId,
        lineId,
        feeStructureId: fee.id,
        description: String(item.feeDescription || "").trim(),
        amount: Number(item.amount) || 0,
      });
    }
  }
  return retired;
}

export async function loadOnceOffCatalogue(schoolId: string): Promise<OnceOffCatalogueFee[]> {
  const key = String(schoolId || "").trim();
  if (!key) return [];
  const schoolIds = isDaSilvaSchoolId(key) ? await refreshDaSilvaSchoolIdCache() : [key];
  const fees = await prisma.feeStructure.findMany({
    where: { schoolId: { in: schoolIds }, isActive: true },
    select: { id: true, name: true, amount: true, frequency: true, grade: true },
  });
  return fees
    .map((fee) => ({
      id: fee.id,
      name: fee.name,
      amount: fee.amount,
      type: resolveFeeStructureType(fee),
    }))
    .filter((fee) => isOnceOffCatalogueType(fee.type));
}
