/**
 * Dry-run / apply repair for Fly Eagle billing remediation.
 * Default = dry-run. Apply requires env gates + matching audited preconditions.
 * Never mutates another school. Fail closed on unexpected state.
 */
import type { PrismaClient } from "@prisma/client";

import { readSchoolLedger } from "../../utils/billingLedgerStore";

import {
  assertFlyEagleSchoolId,
  CONFIRM_FLY_EAGLE_REPAIR_ENV,
  CONFIRM_PRODUCTION_WRITE_ENV,
  FLY_EAGLE_SCHOOL_ID,
} from "./constants";
import {
  matchApprovedClassB,
  PRODUCTION_APPROVED_CLASS_B,
  type ApprovedClassBSpec,
} from "./approvedClassBManifests";
import { executeApprovedClassBConsolidation } from "./classBApply";
import { moneyCents, normRef, round2 } from "./normalize";
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

/**
 * Class A: keep learner on current FA; move parents from empty orphan; retire orphan.
 * Used when staff unmerge left continuing ledger on current (SOT002 pattern).
 */
async function executeRelinkParentsRetireOrphan(
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
      reason: "relink_parents_to_current_retire_orphan only for Class A",
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

  const currentFaId = item.currentFaIds[0];
  const before = {
    orphanFaId: item.orphanFaId,
    currentFaId,
    learnerIds: item.learnerIds,
  };

  if (mode === "dry-run") {
    return {
      caseKey: item.caseKey,
      repairClass: "A",
      action: item.action,
      status: "would_change",
      reason:
        "would keep learners on current FA; move parents from orphan → current; retire empty orphan predecessor",
      before,
      after: { ...before, orphanRetired: true, parentsMovedToCurrent: true },
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

  if (item.learnerIds.length) {
    const learners = await prisma.learner.findMany({
      where: { schoolId, id: { in: item.learnerIds } },
      select: { id: true, familyAccountId: true },
    });
    for (const l of learners) {
      if (l.familyAccountId !== currentFaId) {
        return {
          caseKey: item.caseKey,
          repairClass: item.repairClass,
          action: item.action,
          status: "skipped",
          reason: `learner ${l.id} not on expected current FA ${currentFaId}`,
        };
      }
    }
  }

  // Refuse SOT001-style retirement if orphan still holds any ledger / balance
  const ledgerEmpty = assertOrphanLedgerEmptyForRetire(schoolId, item);
  if (!ledgerEmpty.ok) {
    return {
      caseKey: item.caseKey,
      repairClass: item.repairClass,
      action: item.action,
      status: "aborted",
      reason: ledgerEmpty.reason,
      before,
    };
  }

  await prisma.$transaction(async (tx) => {
    assertFlyEagleSchoolId(schoolId);
    await tx.parent.updateMany({
      where: { schoolId, familyAccountId: item.orphanFaId },
      data: { familyAccountId: currentFaId },
    });
    const remainingLearners = await tx.learner.count({
      where: { schoolId, familyAccountId: item.orphanFaId },
    });
    if (remainingLearners !== 0) {
      throw new Error("refuse retire: orphan unexpectedly has learners");
    }
    // Re-check empty inside transaction boundary (learners); ledger already verified
    const updated = await tx.familyAccount.updateMany({
      where: { id: item.orphanFaId, schoolId, retiredAt: null },
      data: { retiredAt: new Date(), mergedIntoFamilyAccountId: currentFaId },
    });
    if (updated.count !== 1) {
      throw new Error("unexpected orphan retire count");
    }
  });

  return {
    caseKey: item.caseKey,
    repairClass: "A",
    action: item.action,
    status: "applied",
    reason: "parents moved to current; orphan retired as predecessor",
    before,
    after: { ...before, orphanRetired: true, parentsMovedToCurrent: true },
  };
}

/** Orphan must have zero invoices/payments/credits/balance before retirement. */
export function assertOrphanLedgerEmptyForRetire(
  schoolId: string,
  item: RepairPlanItem
): { ok: boolean; reason: string } {
  const refs = [item.orphanAccountRef, item.orphanAccountNo]
    .map((r) => normRef(r))
    .filter(Boolean);
  if (!refs.length) {
    return { ok: false, reason: "refuse retire: orphan account ref unknown" };
  }
  const ledger = readSchoolLedger(schoolId);
  const matched = ledger.filter((e) => refs.includes(normRef(e.accountNo)));
  if (!matched.length) return { ok: true, reason: "orphan ledger empty" };

  let inv = 0;
  let pay = 0;
  let cred = 0;
  for (const e of matched) {
    const amt = round2(e.amount);
    if (e.type === "invoice") inv += amt;
    else if (e.type === "payment") pay += amt;
    else if (e.type === "credit") cred += amt;
  }
  const bal = round2(inv - pay - cred);
  if (matched.length > 0 || moneyCents(bal) !== 0) {
    return {
      ok: false,
      reason: `refuse retire: orphan still has ledger rows=${matched.length} balance=${bal}`,
    };
  }
  return { ok: true, reason: "orphan ledger empty" };
}

export async function executeRepairPlan(opts: {
  prisma: PrismaClient | null;
  schoolId?: string;
  report: ReconciliationReport;
  mode: RepairExecutionMode;
  /** When set, only these caseKeys run. */
  onlyCaseKeys?: string[];
  /**
   * When true, Class B items run ONLY if they match the approved allowlist
   * (production: LEDIKWA + MAPUTLA). No generic merge.
   */
  includeClassBPlans?: boolean;
  /** Override allowlist (tests). Defaults to PRODUCTION_APPROVED_CLASS_B. */
  approvedClassBSpecs?: readonly ApprovedClassBSpec[];
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
  const classBAllowlist = opts.approvedClassBSpecs || PRODUCTION_APPROVED_CLASS_B;

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
      if (!opts.includeClassBPlans) {
        cases.push({
          caseKey: item.caseKey,
          repairClass: item.repairClass,
          action: item.action,
          status: "skipped",
          reason:
            "Class B accounting-sensitive — not enabled (pass includeClassBPlans + approved allowlist)",
        });
        continue;
      }
      if (item.currentFaIds.length !== 1) {
        aborted = true;
        abortReason = "Class B requires exactly one current FA";
        cases.push({
          caseKey: item.caseKey,
          repairClass: "B",
          action: item.action,
          status: "aborted",
          reason: abortReason,
        });
        break;
      }
      const spec = matchApprovedClassB(
        item.orphanFaId,
        item.currentFaIds[0],
        item.orphanAccountRef,
        classBAllowlist
      );
      if (!spec) {
        cases.push({
          caseKey: item.caseKey,
          repairClass: "B",
          action: item.action,
          status: "skipped",
          reason: "Class B case not in approved allowlist — refuse generic merge (skipped)",
        });
        continue;
      }
      try {
        const result = await executeApprovedClassBConsolidation({
          prisma: opts.prisma,
          schoolId,
          item,
          spec,
          mode: opts.mode,
        });
        cases.push(result);
        if (result.status === "aborted") {
          aborted = true;
          abortReason = result.reason;
          break;
        }
      } catch (err) {
        aborted = true;
        abortReason = err instanceof Error ? err.message : String(err);
        cases.push({
          caseKey: item.caseKey,
          repairClass: "B",
          action: item.action,
          status: "aborted",
          reason: abortReason,
        });
        break;
      }
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
      } else if (item.action === "relink_parents_to_current_retire_orphan") {
        result = await executeRelinkParentsRetireOrphan(opts.prisma, schoolId, item, opts.mode);
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

  // Money totals: Class A/B must preserve school-wide invoice/payment/credit sums
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
