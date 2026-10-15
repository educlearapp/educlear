import { prisma } from "../prisma";
import { isDaSilvaSchoolId, refreshDaSilvaSchoolIdCache } from "./daSilvaSchoolResolve";
import type { StoredBillingPlanItem } from "../utils/learnerBillingPlanStore";

/**
 * Billing-plan lines are charged on every monthly invoice run, so fees typed as once-off, annual,
 * yearly or termly must never be newly added to a plan. Must match the frontend rule in
 * frontend/src/billing/billingPlansBulkAddFees.ts.
 */
const NON_RECURRING_PLAN_FEE_TYPES = new Set(["ONCE_OFF", "ONCEOFF", "ANNUALLY", "YEARLY", "TERMLY"]);

export const ONCE_OFF_FEE_GUIDANCE =
  'Billing plans are charged every month. Add once-off, termly or annual fees in Invoice Runs → Fees → "Add Once-off Fee To Selected Learners" so they are invoiced once.';

export const NON_RECURRING_PLAN_FEE_ERROR_CODE = "NON_RECURRING_FEE_ON_BILLING_PLAN";

const FEES_META_PREFIX = "FEES_META:";

export type PlanFeeCatalogueEntry = {
  name: string;
  amount: number;
  type: string;
};

export type BlockedPlanLine = {
  feeDescription: string;
  amount: number;
  type: string;
};

export function isNonRecurringPlanFeeType(type: unknown): boolean {
  const key = String(type ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  return NON_RECURRING_PLAN_FEE_TYPES.has(key);
}

export function nonRecurringPlanFeeMessage(line: BlockedPlanLine): string {
  return `"${line.feeDescription}" is a ${line.type} fee and cannot be added to billing plans. ${ONCE_OFF_FEE_GUIDANCE}`;
}

function normaliseName(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function lineKey(description: unknown, amount: unknown): string {
  const n = Number(amount);
  return `${normaliseName(description)}|${(Number.isFinite(n) ? n : 0).toFixed(2)}`;
}

/** Same type the Fees API reports: FEES_META uiType, else the legacy frequency column. */
export function resolveFeeStructureType(fee: { grade?: unknown; frequency?: unknown }): string {
  const grade = String(fee.grade ?? "").trim();
  if (grade.startsWith(FEES_META_PREFIX)) {
    try {
      const meta = JSON.parse(grade.slice(FEES_META_PREFIX.length)) as { uiType?: unknown };
      const uiType = String(meta?.uiType ?? "").trim();
      if (uiType) return uiType;
    } catch {
      /* fall back to frequency */
    }
  }
  return String(fee.frequency ?? "").trim();
}

/**
 * Lines present in `next` but not in `existing` (multiset by description + amount) whose
 * fee catalogue type is non-recurring. Lines already on the plan are never blocked, so
 * unrelated edits to a plan that still carries an old once-off line keep working.
 */
export function findNewlyAddedNonRecurringPlanLine(
  existing: StoredBillingPlanItem[],
  next: StoredBillingPlanItem[],
  catalogue: PlanFeeCatalogueEntry[]
): BlockedPlanLine | null {
  const remaining = new Map<string, number>();
  for (const item of existing) {
    const key = lineKey(item.feeDescription, item.amount);
    remaining.set(key, (remaining.get(key) || 0) + 1);
  }

  const byName = new Map<string, PlanFeeCatalogueEntry[]>();
  for (const fee of catalogue) {
    const name = normaliseName(fee.name);
    if (!name) continue;
    const list = byName.get(name) || [];
    list.push(fee);
    byName.set(name, list);
  }

  for (const item of next) {
    const key = lineKey(item.feeDescription, item.amount);
    const count = remaining.get(key) || 0;
    if (count > 0) {
      remaining.set(key, count - 1);
      continue;
    }
    const named = byName.get(normaliseName(item.feeDescription)) || [];
    const sameAmount = named.filter((fee) => Math.abs(Number(fee.amount) - Number(item.amount)) < 0.005);
    const candidates = sameAmount.length ? sameAmount : named;
    const nonRecurring = candidates.find((fee) => isNonRecurringPlanFeeType(fee.type));
    if (nonRecurring) {
      return {
        feeDescription: String(item.feeDescription || "").trim(),
        amount: Number(item.amount) || 0,
        type: nonRecurring.type,
      };
    }
  }
  return null;
}

export async function loadPlanFeeCatalogue(schoolId: string): Promise<PlanFeeCatalogueEntry[]> {
  const key = String(schoolId || "").trim();
  if (!key) return [];
  const schoolIds = isDaSilvaSchoolId(key) ? await refreshDaSilvaSchoolIdCache() : [key];
  const fees = await prisma.feeStructure.findMany({
    where: { schoolId: { in: schoolIds } },
    select: { name: true, amount: true, frequency: true, grade: true },
  });
  return fees.map((fee) => ({
    name: fee.name,
    amount: fee.amount,
    type: resolveFeeStructureType(fee),
  }));
}

/** Server-side guard for every staff billing-plan save; returns the first blocked line or null. */
export async function findBlockedNonRecurringPlanLine(
  schoolId: string,
  existing: StoredBillingPlanItem[],
  next: StoredBillingPlanItem[]
): Promise<BlockedPlanLine | null> {
  if (!next.length) return null;
  const catalogue = await loadPlanFeeCatalogue(schoolId);
  return findNewlyAddedNonRecurringPlanLine(existing, next, catalogue);
}
