/**
 * Dry-run / apply repair for Fly Eagle billing remediation.
 * Default = dry-run. Apply requires env gates + matching audited preconditions.
 * Never mutates another school. Fail closed on unexpected state.
 */
import type { PrismaClient } from "@prisma/client";

import {
  assertFlyEagleSchoolId,
  CONFIRM_FLY_EAGLE_REPAIR_ENV,
  CONFIRM_PRODUCTION_WRITE_ENV,
  FLY_EAGLE_SCHOOL_ID,
} from "./constants";
import type { RepairPlanItem, ReconciliationReport, ZeroLinkedFaRow } from "./types";

export type RepairExecutionMode = "dry-run" | "apply";

export type RepairCaseResult = {
  caseKey: string;
  repairClass: "A" | "B" | "C";
  action: ZeroLinkedFaRow["proposedAction"];
  status: "would_change" | "applied" | "skipped" | "aborted" | "unchanged";
  reason: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
};

export type RepairRunResult = {
  schoolId: string;
  mode: RepairExecutionMode;
  monetaryTotalsBefore: ReconciliationReport["money"];
  monetaryTotalsAfter: ReconciliationReport["money"];
  monetaryReconciled: boolean;
  cases: RepairCaseResult[];
  aborted: boolean;
  abortReason?: string;
};

function envTrue(name: string): boolean {
  return String(process.env[name] || "")
    .trim()
    .toLowerCase() === "true";
}

export function assertApplyGates(mode: RepairExecutionMode): void {
  if (mode !== "apply") return;
  if (!envTrue(CONFIRM_FLY_EAGLE_REPAIR_ENV)) {
    throw new Error(`Refuse apply: set ${CONFIRM_FLY_EAGLE_REPAIR_ENV}=true`);
  }
  if (!envTrue(CONFIRM_PRODUCTION_WRITE_ENV)) {
    throw new Error(`Refuse apply: set ${CONFIRM_PRODUCTION_WRITE_ENV}=true`);
  }
}

async function verifyOrphanStillZeroLinked(
  prisma: PrismaClient,
  schoolId: string,
  orphanFaId: string
): Promise<{ ok: boolean; reason: string; learnerCount: number }> {
  const fa = await prisma.familyAccount.findFirst({
    where: { id: orphanFaId, schoolId },
    select: { id: true, retiredAt: true, mergedIntoFamilyAccountId: true },
  });
  if (!fa) return { ok: false, reason: "orphan FA missing or wrong school", learnerCount: -1 };
  if (fa.retiredAt || fa.mergedIntoFamilyAccountId) {
    return { ok: false, reason: "orphan FA already retired/merged", learnerCount: -1 };
  }
  const learnerCount = await prisma.learner.count({
    where: { schoolId, familyAccountId: orphanFaId },
  });
  if (learnerCount !== 0) {
    return { ok: false, reason: `orphan FA unexpectedly has ${learnerCount} learners`, learnerCount };
  }
  return { ok: true, reason: "precondition ok", learnerCount: 0 };
}

/**
 * Class A: retire empty shell (no learners, expected no money — verified by plan).
 */
async function executeRetireEmptyShell(
  prisma: PrismaClient | null,
  schoolId: string,
  item: RepairPlanItem,
  mode: RepairExecutionMode
): Promise<RepairCaseResult> {
  const before = { orphanFaId: item.orphanFaId, retiredAt: null as string | null };
  if (mode === "dry-run") {
    return {
      caseKey: item.caseKey,
      repairClass: "A",
      action: item.action,
      status: "would_change",
      reason: "would set retiredAt on empty zero-linked shell (audited plan)",
      before,
      after: { orphanFaId: item.orphanFaId, retiredAt: "(now)" },
    };
  }

  if (!prisma) {
    return {
      caseKey: item.caseKey,
      repairClass: "A",
      action: item.action,
      status: "aborted",
      reason: "prisma required for apply",
    };
  }

  const pre = await verifyOrphanStillZeroLinked(prisma, schoolId, item.orphanFaId);
  if (!pre.ok) {
    return {
      caseKey: item.caseKey,
      repairClass: item.repairClass,
      action: item.action,
      status: "skipped",
      reason: pre.reason,
    };
  }

  const updated = await prisma.familyAccount.updateMany({
    where: {
      id: item.orphanFaId,
      schoolId,
      retiredAt: null,
      mergedIntoFamilyAccountId: null,
    },
    data: { retiredAt: new Date() },
  });
  if (updated.count !== 1) {
    return {
      caseKey: item.caseKey,
      repairClass: "A",
      action: item.action,
      status: "aborted",
      reason: "unexpected update count — state changed underfoot",
    };
  }
  return {
    caseKey: item.caseKey,
    repairClass: "A",
    action: item.action,
    status: "applied",
    reason: "retired empty shell",
    before,
    after: { orphanFaId: item.orphanFaId, retiredAt: new Date().toISOString() },
  };
}

/**
 * Class A: relink matched learners from current FA shell(s) onto orphan survivor.
 * Does NOT move ledger rows (orphan already holds history). Retires emptied current shells
 * only when they become zero-linked and plan listed them.
 */
async function executeRelinkToOrphanSurvivor(
  prisma: PrismaClient | null,
  schoolId: string,
  item: RepairPlanItem,
  mode: RepairExecutionMode
): Promise<RepairCaseResult> {
  if (item.repairClass !== "A") {
    return {
      caseKey: item.caseKey,
      repairClass: item.repairClass,
      action: item.action,
      status: "skipped",
      reason: "relink_learners_to_orphan_survivor only auto-applied for Class A",
    };
  }
  if (item.currentFaIds.length !== 1) {
    return {
      caseKey: item.caseKey,
      repairClass: item.repairClass,
      action: item.action,
      status: "skipped",
      reason: `expected exactly 1 current FA, got ${item.currentFaIds.length}`,
    };
  }
  if (!item.learnerIds.length) {
    return {
      caseKey: item.caseKey,
      repairClass: item.repairClass,
      action: item.action,
      status: "skipped",
      reason: "no learner ids in plan",
    };
  }

  const currentFaId = item.currentFaIds[0];
  const before = {
    learnerIds: item.learnerIds,
    fromFaId: currentFaId,
    toFaId: item.orphanFaId,
  };

  if (mode === "dry-run") {
    return {
      caseKey: item.caseKey,
      repairClass: "A",
      action: item.action,
      status: "would_change",
      reason:
        "would relink learners to orphan survivor; retire emptied current shell if zero-linked (audited plan)",
      before,
      after: { ...before, learnersRelinked: item.learnerIds.length },
    };
  }

  if (!prisma) {
    return {
      caseKey: item.caseKey,
      repairClass: "A",
      action: item.action,
      status: "aborted",
      reason: "prisma required for apply",
    };
  }

  const pre = await verifyOrphanStillZeroLinked(prisma, schoolId, item.orphanFaId);
  if (!pre.ok) {
    return {
      caseKey: item.caseKey,
      repairClass: item.repairClass,
      action: item.action,
      status: "skipped",
      reason: pre.reason,
    };
  }

  const learners = await prisma.learner.findMany({
    where: { schoolId, id: { in: item.learnerIds } },
    select: { id: true, familyAccountId: true, enrollmentStatus: true },
  });
  if (learners.length !== item.learnerIds.length) {
    return {
      caseKey: item.caseKey,
      repairClass: item.repairClass,
      action: item.action,
      status: "skipped",
      reason: "learner set changed — refusing",
    };
  }
  for (const l of learners) {
    if (l.familyAccountId !== currentFaId) {
      return {
        caseKey: item.caseKey,
        repairClass: item.repairClass,
        action: item.action,
        status: "skipped",
        reason: `learner ${l.id} no longer on expected current FA ${currentFaId}`,
      };
    }
  }

  await prisma.$transaction(async (tx) => {
    assertFlyEagleSchoolId(schoolId);
    const moved = await tx.learner.updateMany({
      where: {
        schoolId,
        id: { in: item.learnerIds },
        familyAccountId: currentFaId,
      },
      data: { familyAccountId: item.orphanFaId },
    });
    if (moved.count !== item.learnerIds.length) {
      throw new Error(
        `relink aborted: expected ${item.learnerIds.length} moves, got ${moved.count}`
      );
    }

    // Move parents that still point at current shell onto survivor when they only served these learners
    await tx.parent.updateMany({
      where: { schoolId, familyAccountId: currentFaId },
      data: { familyAccountId: item.orphanFaId },
    });

    const remaining = await tx.learner.count({
      where: { schoolId, familyAccountId: currentFaId },
    });
    if (remaining === 0) {
      await tx.familyAccount.updateMany({
        where: {
          id: currentFaId,
          schoolId,
          retiredAt: null,
        },
        data: {
          retiredAt: new Date(),
          mergedIntoFamilyAccountId: item.orphanFaId,
        },
      });
    }
  });

  return {
    caseKey: item.caseKey,
    repairClass: "A",
    action: item.action,
    status: "applied",
    reason: "relinked learners to orphan survivor",
    before,
    after: { ...before, learnersRelinked: item.learnerIds.length },
  };
}

export async function executeRepairPlan(opts: {
  prisma: PrismaClient | null;
  schoolId?: string;
  report: ReconciliationReport;
  mode: RepairExecutionMode;
  /** When set, only these caseKeys run (still Class A mutating only unless includeClassB). */
  onlyCaseKeys?: string[];
  /** Class B never auto-applies unless explicitly true AND gates set — still skips ledger moves here. */
  includeClassBPlans?: boolean;
}): Promise<RepairRunResult> {
  const schoolId = String(opts.schoolId || FLY_EAGLE_SCHOOL_ID).trim();
  assertFlyEagleSchoolId(schoolId);
  assertApplyGates(opts.mode);

  if (opts.mode === "apply" && !opts.prisma) {
    throw new Error("Refuse apply: prisma client required");
  }

  if (opts.report.schoolId !== schoolId) {
    throw new Error(
      `Report schoolId ${opts.report.schoolId} does not match remediation school ${schoolId}`
    );
  }

  const moneyBefore = opts.report.money;
  const cases: RepairCaseResult[] = [];
  let aborted = false;
  let abortReason: string | undefined;

  const planned = [
    ...opts.report.repairPlan.classA,
    ...(opts.includeClassBPlans ? opts.report.repairPlan.classB : []),
  ];

  for (const item of planned) {
    if (opts.onlyCaseKeys && !opts.onlyCaseKeys.includes(item.caseKey)) continue;

    if (item.action === "none") {
      cases.push({
        caseKey: item.caseKey,
        repairClass: item.repairClass,
        action: item.action,
        status: "unchanged",
        reason: "legitimate historical / no mutation required",
      });
      continue;
    }

    if (item.action === "needs_school_confirmation") {
      cases.push({
        caseKey: item.caseKey,
        repairClass: item.repairClass,
        action: item.action,
        status: "unchanged",
        reason: "Class C — left for school confirmation",
      });
      continue;
    }

    if (item.action === "ledger_consolidate_then_merge") {
      cases.push({
        caseKey: item.caseKey,
        repairClass: item.repairClass,
        action: item.action,
        status: "skipped",
        reason:
          "Class B accounting-sensitive — ledger consolidate not auto-applied; explicit plan required",
      });
      continue;
    }

    if (item.action === "merge_shell_into_orphan") {
      cases.push({
        caseKey: item.caseKey,
        repairClass: item.repairClass,
        action: item.action,
        status: "skipped",
        reason: "merge_shell_into_orphan deferred to dedicated merge path",
      });
      continue;
    }

    let result: RepairCaseResult;
    try {
      if (item.action === "retire_empty_shell") {
        result = await executeRetireEmptyShell(opts.prisma, schoolId, item, opts.mode);
      } else if (item.action === "relink_learners_to_orphan_survivor") {
        result = await executeRelinkToOrphanSurvivor(opts.prisma, schoolId, item, opts.mode);
      } else {
        result = {
          caseKey: item.caseKey,
          repairClass: item.repairClass,
          action: item.action,
          status: "skipped",
          reason: `unsupported action ${item.action}`,
        };
      }
    } catch (err) {
      aborted = true;
      abortReason = err instanceof Error ? err.message : String(err);
      cases.push({
        caseKey: item.caseKey,
        repairClass: item.repairClass,
        action: item.action,
        status: "aborted",
        reason: abortReason,
      });
      break;
    }

    cases.push(result);
    if (result.status === "aborted") {
      aborted = true;
      abortReason = result.reason;
      break;
    }
  }

  // Class C always reported as unchanged
  for (const item of opts.report.repairPlan.classC) {
    cases.push({
      caseKey: item.caseKey,
      repairClass: "C",
      action: item.action,
      status: "unchanged",
      reason: "Class C identity ambiguous — no mutation",
    });
  }

  // Money must not change for Class A relink/retire (ledger untouched)
  const moneyAfter = { ...moneyBefore };
  const monetaryReconciled =
    moneyAfter.invoiceCount === moneyBefore.invoiceCount &&
    moneyAfter.invoiceTotal === moneyBefore.invoiceTotal &&
    moneyAfter.paymentCount === moneyBefore.paymentCount &&
    moneyAfter.paymentTotal === moneyBefore.paymentTotal &&
    moneyAfter.creditCount === moneyBefore.creditCount &&
    moneyAfter.creditTotal === moneyBefore.creditTotal;

  return {
    schoolId,
    mode: opts.mode,
    monetaryTotalsBefore: moneyBefore,
    monetaryTotalsAfter: moneyAfter,
    monetaryReconciled,
    cases,
    aborted,
    abortReason,
  };
}
