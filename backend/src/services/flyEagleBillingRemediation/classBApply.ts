/**
 * Deterministic Class B ledger consolidation apply — approved specs only.
 * Rewrites accountNo on exact ledger row IDs; never changes amount/date/reference/id.
 */
import type { PrismaClient } from "@prisma/client";

import {
  readSchoolLedger,
  relocateLedgerAccountNoByExactIds,
  type BillingLedgerEntry,
} from "../../utils/billingLedgerStore";
import { assertFlyEagleSchoolId, FLY_EAGLE_SCHOOL_ID } from "./constants";
import type { ApprovedClassBSpec } from "./approvedClassBManifests";
import { moneyCents, normRef, round2 } from "./normalize";
import type { RepairPlanItem, ZeroLinkedFaRow } from "./types";

export type ClassBApplyMode = "dry-run" | "apply";

export type ClassBApplyResult = {
  caseKey: string;
  repairClass: "B";
  action: ZeroLinkedFaRow["proposedAction"];
  status: "would_change" | "applied" | "skipped" | "aborted" | "unchanged";
  reason: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
};

function refEq(a: unknown, b: unknown): boolean {
  return normRef(a) === normRef(b);
}

function statsForRefs(
  entries: BillingLedgerEntry[],
  refs: string[]
): { invoiceTotal: number; paymentTotal: number; creditTotal: number; balance: number } {
  const want = new Set(refs.map(normRef));
  const matched = entries.filter((e) => want.has(normRef(e.accountNo)));
  let invoiceTotal = 0;
  let paymentTotal = 0;
  let creditTotal = 0;
  for (const e of matched) {
    const amt = round2(e.amount);
    if (e.type === "invoice") invoiceTotal += amt;
    else if (e.type === "payment") paymentTotal += amt;
    else if (e.type === "credit") creditTotal += amt;
  }
  invoiceTotal = round2(invoiceTotal);
  paymentTotal = round2(paymentTotal);
  creditTotal = round2(creditTotal);
  return {
    invoiceTotal,
    paymentTotal,
    creditTotal,
    balance: round2(invoiceTotal - paymentTotal - creditTotal),
  };
}

/**
 * Apply one approved Class B consolidation. Fail closed on any mismatch.
 */
export async function executeApprovedClassBConsolidation(opts: {
  prisma: PrismaClient | null;
  schoolId: string;
  item: RepairPlanItem;
  spec: ApprovedClassBSpec;
  mode: ClassBApplyMode;
}): Promise<ClassBApplyResult> {
  const schoolId = String(opts.schoolId || "").trim();
  assertFlyEagleSchoolId(schoolId);
  if (schoolId !== FLY_EAGLE_SCHOOL_ID) {
    return {
      caseKey: opts.item.caseKey,
      repairClass: "B",
      action: "ledger_consolidate_then_merge",
      status: "aborted",
      reason: "cross-school rejection",
    };
  }

  const { item, spec, mode } = opts;
  if (item.orphanFaId !== spec.orphanFaId || item.currentFaIds[0] !== spec.currentFaId) {
    return {
      caseKey: item.caseKey,
      repairClass: "B",
      action: item.action,
      status: "aborted",
      reason: "plan FA ids do not match approved spec",
    };
  }

  const before = {
    label: spec.label,
    orphanFaId: spec.orphanFaId,
    currentFaId: spec.currentFaId,
    moveCount: spec.moves.length,
    expectedCombined: spec.expectedCombined,
  };

  if (mode === "dry-run") {
    return {
      caseKey: item.caseKey,
      repairClass: "B",
      action: item.action,
      status: "would_change",
      reason: `would consolidate ${spec.moves.length} ledger rows ${spec.orphanAccountRef} → ${spec.currentAccountRef} (${spec.label})`,
      before,
      after: { ...before, consolidated: true },
    };
  }

  if (!opts.prisma) {
    return {
      caseKey: item.caseKey,
      repairClass: "B",
      action: item.action,
      status: "aborted",
      reason: "prisma required for Class B apply (FA verification / optional retire)",
    };
  }

  const [orphanFa, currentFa] = await Promise.all([
    opts.prisma.familyAccount.findFirst({
      where: { id: spec.orphanFaId, schoolId },
      select: {
        id: true,
        accountRef: true,
        accountNo: true,
        retiredAt: true,
        mergedIntoFamilyAccountId: true,
      },
    }),
    opts.prisma.familyAccount.findFirst({
      where: { id: spec.currentFaId, schoolId },
      select: { id: true, accountRef: true, accountNo: true, retiredAt: true },
    }),
  ]);

  if (!orphanFa) {
    return {
      caseKey: item.caseKey,
      repairClass: "B",
      action: item.action,
      status: "aborted",
      reason: "orphan FA missing or wrong school",
    };
  }
  if (!currentFa) {
    return {
      caseKey: item.caseKey,
      repairClass: "B",
      action: item.action,
      status: "aborted",
      reason: "destination FA missing or wrong school",
    };
  }

  if (orphanFa.retiredAt || orphanFa.mergedIntoFamilyAccountId) {
    const ledger = readSchoolLedger(schoolId);
    const allOnDest = spec.moves.every((m) => {
      const e = ledger.find((x) => x.id === m.id);
      return e && refEq(e.accountNo, m.toAccountNo);
    });
    if (allOnDest) {
      return {
        caseKey: item.caseKey,
        repairClass: "B",
        action: item.action,
        status: "applied",
        reason: "idempotent: already consolidated and orphan retired",
        before,
        after: { ...before, alreadyDone: true },
      };
    }
    return {
      caseKey: item.caseKey,
      repairClass: "B",
      action: item.action,
      status: "aborted",
      reason: "orphan FA already retired/merged but ledger not fully on destination",
    };
  }

  if (currentFa.retiredAt) {
    return {
      caseKey: item.caseKey,
      repairClass: "B",
      action: item.action,
      status: "aborted",
      reason: "destination FA is retired — unexpected state",
    };
  }

  if (
    !refEq(currentFa.accountRef, spec.currentAccountRef) &&
    !refEq(currentFa.accountNo, spec.currentAccountNo)
  ) {
    return {
      caseKey: item.caseKey,
      repairClass: "B",
      action: item.action,
      status: "aborted",
      reason: "destination FA accountRef/accountNo mismatch vs approved spec",
    };
  }

  const learnerCount = await opts.prisma.learner.count({
    where: { schoolId, familyAccountId: spec.orphanFaId },
  });
  if (learnerCount !== 0) {
    return {
      caseKey: item.caseKey,
      repairClass: "B",
      action: item.action,
      status: "aborted",
      reason: `orphan unexpectedly has ${learnerCount} learners`,
    };
  }

  // Preflight: refuse unexpected residual ledger on source outside approved move set
  {
    const ledger = readSchoolLedger(schoolId);
    const moveIds = new Set(spec.moves.map((m) => m.id));
    const unexpected = ledger.filter(
      (e) => refEq(e.accountNo, spec.orphanAccountRef) && !moveIds.has(e.id)
    );
    if (unexpected.length) {
      return {
        caseKey: item.caseKey,
        repairClass: "B",
        action: item.action,
        status: "aborted",
        reason: `unexpected residual ledger on source (${unexpected.length} rows)`,
        before,
      };
    }
  }

  let relocateResult: { updated: number; alreadyOnDest: number; entries: BillingLedgerEntry[] };
  try {
    relocateResult = relocateLedgerAccountNoByExactIds(
      schoolId,
      spec.moves.map((m) => ({
        id: m.id,
        fromAccountNo: m.fromAccountNo,
        toAccountNo: m.toAccountNo,
        type: m.type,
        date: m.date,
        amount: m.amount,
        reference: m.reference,
        familyAccountId: spec.currentFaId,
      }))
    );
  } catch (err) {
    return {
      caseKey: item.caseKey,
      repairClass: "B",
      action: item.action,
      status: "aborted",
      reason: err instanceof Error ? err.message : String(err),
      before,
    };
  }

  const combinedAfter = statsForRefs(relocateResult.entries, [
    spec.orphanAccountRef,
    spec.currentAccountRef,
    spec.currentAccountNo,
  ]);
  if (moneyCents(combinedAfter.invoiceTotal) !== moneyCents(spec.expectedCombined.invoiceTotal)) {
    return {
      caseKey: item.caseKey,
      repairClass: "B",
      action: item.action,
      status: "aborted",
      reason: `combined invoiceTotal ${combinedAfter.invoiceTotal} != expected ${spec.expectedCombined.invoiceTotal}`,
      before,
    };
  }
  if (moneyCents(combinedAfter.paymentTotal) !== moneyCents(spec.expectedCombined.paymentTotal)) {
    return {
      caseKey: item.caseKey,
      repairClass: "B",
      action: item.action,
      status: "aborted",
      reason: `combined paymentTotal ${combinedAfter.paymentTotal} != expected ${spec.expectedCombined.paymentTotal}`,
      before,
    };
  }
  if (moneyCents(combinedAfter.creditTotal) !== moneyCents(spec.expectedCombined.creditTotal)) {
    return {
      caseKey: item.caseKey,
      repairClass: "B",
      action: item.action,
      status: "aborted",
      reason: `combined creditTotal ${combinedAfter.creditTotal} != expected ${spec.expectedCombined.creditTotal}`,
      before,
    };
  }
  if (moneyCents(combinedAfter.balance) !== moneyCents(spec.expectedCombined.balance)) {
    return {
      caseKey: item.caseKey,
      repairClass: "B",
      action: item.action,
      status: "aborted",
      reason: `combined balance ${combinedAfter.balance} != expected ${spec.expectedCombined.balance}`,
      before,
    };
  }

  const sourceLeft = relocateResult.entries.filter((e) => refEq(e.accountNo, spec.orphanAccountRef));
  if (sourceLeft.length) {
    return {
      caseKey: item.caseKey,
      repairClass: "B",
      action: item.action,
      status: "aborted",
      reason: `source still has ${sourceLeft.length} ledger rows after move`,
      before,
    };
  }

  let orphanRetired = false;
  if (sourceLeft.length === 0) {
    await opts.prisma.$transaction(async (tx) => {
      assertFlyEagleSchoolId(schoolId);
      const learnersLeft = await tx.learner.count({
        where: { schoolId, familyAccountId: spec.orphanFaId },
      });
      if (learnersLeft !== 0) {
        throw new Error("refuse retire after consolidate: learners present");
      }
      const updated = await tx.familyAccount.updateMany({
        where: {
          id: spec.orphanFaId,
          schoolId,
          retiredAt: null,
          mergedIntoFamilyAccountId: null,
        },
        data: {
          retiredAt: new Date(),
          mergedIntoFamilyAccountId: spec.currentFaId,
        },
      });
      if (updated.count === 1) orphanRetired = true;
    });
  }

  return {
    caseKey: item.caseKey,
    repairClass: "B",
    action: item.action,
    status: "applied",
    reason:
      relocateResult.alreadyOnDest === spec.moves.length
        ? "idempotent: ledger already on destination"
        : `consolidated ${relocateResult.updated} ledger rows; orphanRetired=${orphanRetired}`,
    before,
    after: {
      ...before,
      movedCount: relocateResult.updated,
      alreadyOnDest: relocateResult.alreadyOnDest,
      orphanRetired,
      combinedAfter,
    },
  };
}
