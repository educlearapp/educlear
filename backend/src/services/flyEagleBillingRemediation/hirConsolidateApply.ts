/**
 * Apply approved HIR003 → HIR002 consolidation.
 * - Relocate exact ledger row IDs (accountNo only)
 * - Relink learner + parents to HIR002
 * - Retire HIR003 when empty
 * - Never touch HIR001
 */
import type { PrismaClient } from "@prisma/client";

import {
  readSchoolLedger,
  relocateLedgerAccountNoByExactIds,
  type BillingLedgerEntry,
} from "../../utils/billingLedgerStore";
import {
  readSchoolFamilyAccountAgeAnalysisSnapshots,
  upsertSchoolFamilyAccountAgeAnalysisSnapshots,
} from "../../utils/familyAccountAgeAnalysisStore";
import { assertFlyEagleSchoolId, FLY_EAGLE_SCHOOL_ID } from "./constants";
import type { ApprovedHirConsolidationSpec } from "./approvedHirConsolidation";
import { moneyCents, normRef, round2 } from "./normalize";

export type HirApplyMode = "dry-run" | "apply";

export type HirApplyResult = {
  label: "HIRBORO";
  status: "would_change" | "applied" | "aborted" | "unchanged";
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

function assertCombined(
  combined: ReturnType<typeof statsForRefs>,
  expected: ApprovedHirConsolidationSpec["expectedCombined"]
): string | null {
  if (moneyCents(combined.invoiceTotal) !== moneyCents(expected.invoiceTotal)) {
    return `combined invoiceTotal ${combined.invoiceTotal} != expected ${expected.invoiceTotal}`;
  }
  if (moneyCents(combined.paymentTotal) !== moneyCents(expected.paymentTotal)) {
    return `combined paymentTotal ${combined.paymentTotal} != expected ${expected.paymentTotal}`;
  }
  if (moneyCents(combined.creditTotal) !== moneyCents(expected.creditTotal)) {
    return `combined creditTotal ${combined.creditTotal} != expected ${expected.creditTotal}`;
  }
  if (moneyCents(combined.balance) !== moneyCents(expected.balance)) {
    return `combined balance ${combined.balance} != expected ${expected.balance}`;
  }
  return null;
}

export async function executeApprovedHirConsolidation(opts: {
  prisma: PrismaClient;
  schoolId: string;
  spec: ApprovedHirConsolidationSpec;
  mode: HirApplyMode;
}): Promise<HirApplyResult> {
  const schoolId = String(opts.schoolId || "").trim();
  assertFlyEagleSchoolId(schoolId);
  if (schoolId !== FLY_EAGLE_SCHOOL_ID) {
    return { label: "HIRBORO", status: "aborted", reason: "cross-school rejection" };
  }

  const { spec, mode } = opts;
  const ledger = readSchoolLedger(schoolId);
  const combinedBefore = statsForRefs(ledger, [
    spec.sourceAccountRef,
    spec.destAccountRef,
    spec.sourceAccountNo,
    spec.destAccountNo,
  ]);
  const before = {
    combinedBefore,
    moveCount: spec.moves.length,
    sourceFaId: spec.sourceFaId,
    destFaId: spec.destFaId,
    learnerId: spec.learnerId,
    parentIds: spec.parentIds,
  };

  // Protect HIR001: no moves may target or source its join key incorrectly
  for (const m of spec.moves) {
    if (
      refEq(m.fromAccountNo, "HIRBORO BEREKET") ||
      refEq(m.toAccountNo, "HIRBORO BEREKET") ||
      refEq(m.fromAccountNo, "HIR001") ||
      refEq(m.toAccountNo, "HIR001")
    ) {
      return { label: "HIRBORO", status: "aborted", reason: "HIR001 isolation: move touches sibling" };
    }
  }

  // Residual ledger on source outside approved moves — check before combined totals
  // so unexpected source rows fail closed with a clear reason.
  {
    const moveIds = new Set(spec.moves.map((m) => m.id));
    const unexpected = ledger.filter(
      (e) => refEq(e.accountNo, spec.sourceAccountRef) && !moveIds.has(e.id)
    );
    if (unexpected.length) {
      return {
        label: "HIRBORO",
        status: "aborted",
        reason: `unexpected residual ledger on HIR003 (${unexpected.length} rows)`,
        before,
      };
    }
  }

  const mismatch = assertCombined(combinedBefore, spec.expectedCombined);
  if (mismatch) {
    return { label: "HIRBORO", status: "aborted", reason: `preflight: ${mismatch}` };
  }

  const [sourceFa, destFa, siblingFa, learner] = await Promise.all([
    opts.prisma.familyAccount.findFirst({
      where: { id: spec.sourceFaId, schoolId },
      select: {
        id: true,
        accountRef: true,
        accountNo: true,
        retiredAt: true,
        mergedIntoFamilyAccountId: true,
      },
    }),
    opts.prisma.familyAccount.findFirst({
      where: { id: spec.destFaId, schoolId },
      select: { id: true, accountRef: true, accountNo: true, retiredAt: true },
    }),
    opts.prisma.familyAccount.findFirst({
      where: { id: spec.protectedSiblingFaId, schoolId },
      select: {
        id: true,
        accountRef: true,
        accountNo: true,
        retiredAt: true,
        mergedIntoFamilyAccountId: true,
      },
    }),
    opts.prisma.learner.findFirst({
      where: { id: spec.learnerId, schoolId },
      select: { id: true, firstName: true, lastName: true, familyAccountId: true },
    }),
  ]);

  if (!sourceFa || !destFa || !siblingFa) {
    return { label: "HIRBORO", status: "aborted", reason: "required FA missing or wrong school" };
  }
  if (destFa.retiredAt) {
    return { label: "HIRBORO", status: "aborted", reason: "destination HIR002 is retired" };
  }
  if (siblingFa.retiredAt || siblingFa.mergedIntoFamilyAccountId) {
    return { label: "HIRBORO", status: "aborted", reason: "unexpected: HIR001 retired/merged" };
  }
  if (!refEq(siblingFa.accountNo, spec.protectedSiblingAccountNo)) {
    return { label: "HIRBORO", status: "aborted", reason: "HIR001 accountNo mismatch" };
  }
  if (!learner) {
    return { label: "HIRBORO", status: "aborted", reason: "ANTEFAZEN learner missing" };
  }

  // Idempotent: learner already on dest + moves on dest + source retired
  const movesOnDest = spec.moves.every((m) => {
    const e = ledger.find((x) => x.id === m.id);
    return e && refEq(e.accountNo, m.toAccountNo);
  });
  const learnerOnDest = learner.familyAccountId === spec.destFaId;
  if (
    movesOnDest &&
    learnerOnDest &&
    (sourceFa.retiredAt || sourceFa.mergedIntoFamilyAccountId === spec.destFaId)
  ) {
    return {
      label: "HIRBORO",
      status: mode === "apply" ? "applied" : "unchanged",
      reason: "idempotent: already consolidated",
      before,
      after: { alreadyDone: true, combinedBefore },
    };
  }

  // Residual already checked above before combined totals

  // Verify each move fingerprint
  for (const m of spec.moves) {
    const e = ledger.find((x) => x.id === m.id);
    if (!e) {
      return { label: "HIRBORO", status: "aborted", reason: `ledger row missing: ${m.id}`, before };
    }
    if (!refEq(e.accountNo, m.fromAccountNo) && !refEq(e.accountNo, m.toAccountNo)) {
      return {
        label: "HIRBORO",
        status: "aborted",
        reason: `row ${m.id} accountNo=${e.accountNo} not on from/to path`,
        before,
      };
    }
    if (String(e.type) !== m.type || round2(e.amount) !== round2(m.amount)) {
      return {
        label: "HIRBORO",
        status: "aborted",
        reason: `row ${m.id} type/amount mismatch`,
        before,
      };
    }
    if (String(e.date || "").slice(0, 10) !== String(m.date).slice(0, 10)) {
      return { label: "HIRBORO", status: "aborted", reason: `row ${m.id} date mismatch`, before };
    }
    if (String(e.reference || "") !== String(m.reference || "")) {
      return {
        label: "HIRBORO",
        status: "aborted",
        reason: `row ${m.id} reference mismatch`,
        before,
      };
    }
  }

  if (mode === "dry-run") {
    return {
      label: "HIRBORO",
      status: "would_change",
      reason: `would move ${spec.moves.length} ledger row(s), relink learner+parents, retire HIR003`,
      before,
      after: {
        destFaId: spec.destFaId,
        combinedAfter: combinedBefore,
        learnerRelink: spec.learnerId,
        parentRelink: spec.parentIds,
      },
    };
  }

  // --- APPLY ---
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
        familyAccountId: spec.destFaId,
      }))
    );
  } catch (err) {
    return {
      label: "HIRBORO",
      status: "aborted",
      reason: err instanceof Error ? err.message : String(err),
      before,
    };
  }

  const combinedAfter = statsForRefs(relocateResult.entries, [
    spec.sourceAccountRef,
    spec.destAccountRef,
    spec.sourceAccountNo,
    spec.destAccountNo,
  ]);
  const afterMismatch = assertCombined(combinedAfter, spec.expectedCombined);
  if (afterMismatch) {
    return { label: "HIRBORO", status: "aborted", reason: `post-move: ${afterMismatch}`, before };
  }

  const sourceLeft = relocateResult.entries.filter((e) =>
    refEq(e.accountNo, spec.sourceAccountRef)
  );
  if (sourceLeft.length) {
    return {
      label: "HIRBORO",
      status: "aborted",
      reason: `source still has ${sourceLeft.length} ledger rows`,
      before,
    };
  }

  // Capture HIR001 fingerprint before prisma writes
  const siblingBefore = {
    accountNo: siblingFa.accountNo,
    accountRef: siblingFa.accountRef,
    retiredAt: siblingFa.retiredAt,
  };
  const siblingLearnerCountBefore = await opts.prisma.learner.count({
    where: { schoolId, familyAccountId: spec.protectedSiblingFaId },
  });
  const siblingLedgerBefore = statsForRefs(relocateResult.entries, [
    "HIRBORO BEREKET",
    "HIR001",
  ]);

  await opts.prisma.$transaction(async (tx) => {
    assertFlyEagleSchoolId(schoolId);

    // Relink learner
    const lr = await tx.learner.updateMany({
      where: { id: spec.learnerId, schoolId, familyAccountId: spec.sourceFaId },
      data: { familyAccountId: spec.destFaId },
    });
    if (lr.count !== 1) {
      // Allow if already on dest
      const cur = await tx.learner.findFirst({
        where: { id: spec.learnerId, schoolId },
        select: { familyAccountId: true },
      });
      if (cur?.familyAccountId !== spec.destFaId) {
        throw new Error(`learner relink failed (count=${lr.count})`);
      }
    }

    // Relink parents (familyAccountId)
    for (const parentId of spec.parentIds) {
      await tx.parent.updateMany({
        where: { id: parentId, schoolId, familyAccountId: spec.sourceFaId },
        data: { familyAccountId: spec.destFaId },
      });
    }

    // Refuse retire if anything remains on source
    const learnersLeft = await tx.learner.count({
      where: { schoolId, familyAccountId: spec.sourceFaId },
    });
    if (learnersLeft !== 0) {
      throw new Error("refuse retire: learners still on HIR003");
    }
    const parentsLeft = await tx.parent.count({
      where: { schoolId, familyAccountId: spec.sourceFaId },
    });
    if (parentsLeft !== 0) {
      throw new Error("refuse retire: parents still on HIR003");
    }

    await tx.familyAccount.updateMany({
      where: {
        id: spec.sourceFaId,
        schoolId,
        retiredAt: null,
      },
      data: {
        retiredAt: new Date(),
        mergedIntoFamilyAccountId: spec.destFaId,
      },
    });

    // HIR001 must be unchanged inside the same transaction scope
    const sibling = await tx.familyAccount.findFirst({
      where: { id: spec.protectedSiblingFaId, schoolId },
      select: { accountNo: true, accountRef: true, retiredAt: true, mergedIntoFamilyAccountId: true },
    });
    if (
      !sibling ||
      String(sibling.accountNo) !== String(siblingBefore.accountNo) ||
      String(sibling.accountRef) !== String(siblingBefore.accountRef) ||
      sibling.retiredAt ||
      sibling.mergedIntoFamilyAccountId
    ) {
      throw new Error("HIR001 isolation failed inside transaction");
    }
    const siblingLearners = await tx.learner.count({
      where: { schoolId, familyAccountId: spec.protectedSiblingFaId },
    });
    if (siblingLearners !== siblingLearnerCountBefore) {
      throw new Error("HIR001 learner count changed");
    }
  });

  // Retire HIR003 age-analysis key (no balance rewrite on HIR002 snap)
  try {
    const snaps = readSchoolFamilyAccountAgeAnalysisSnapshots(schoolId);
    const srcKey = normRef(spec.sourceAccountRef);
    const srcSnap = snaps[srcKey];
    if (srcSnap && !String(srcSnap.mergedIntoAccountRef || "").trim()) {
      upsertSchoolFamilyAccountAgeAnalysisSnapshots(schoolId, {
        [srcKey]: {
          ...srcSnap,
          mergedIntoAccountRef: normRef(spec.destAccountRef),
          retiredAt: new Date().toISOString(),
          retiredReason: "hir003_consolidated_into_hir002",
        },
      });
    }
  } catch {
    // Non-fatal for monetary path — FA retirement already hides from active Statements
  }

  const ledgerFinal = readSchoolLedger(schoolId);
  const siblingLedgerAfter = statsForRefs(ledgerFinal, ["HIRBORO BEREKET", "HIR001"]);
  if (
    moneyCents(siblingLedgerBefore.invoiceTotal) !== moneyCents(siblingLedgerAfter.invoiceTotal) ||
    moneyCents(siblingLedgerBefore.paymentTotal) !== moneyCents(siblingLedgerAfter.paymentTotal) ||
    moneyCents(siblingLedgerBefore.balance) !== moneyCents(siblingLedgerAfter.balance)
  ) {
    return {
      label: "HIRBORO",
      status: "aborted",
      reason: "HIR001 ledger totals changed — unexpected",
      before,
    };
  }

  return {
    label: "HIRBORO",
    status: "applied",
    reason: `moved ${relocateResult.updated} ledger row(s); learner+parents relinked; HIR003 retired`,
    before,
    after: {
      movedCount: relocateResult.updated,
      alreadyOnDest: relocateResult.alreadyOnDest,
      combinedAfter,
      destFaId: spec.destFaId,
      sourceRetired: true,
    },
  };
}
