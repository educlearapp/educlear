/**
 * Permanent Fly Eagle / school integrity findings for billing FA health.
 * Pure over a school bundle — reusable by CLI and Super Admin reports.
 */
import { assertFlyEagleSchoolId, FLY_EAGLE_SCHOOL_ID } from "./constants";
import { classifyZeroLinkedFamilyAccounts } from "./classify";
import { computeCountChecksums, computeMoneyTotals, ledgerStatsForAccountRef } from "./checksums";
import { normRef, round2 } from "./normalize";
import type { FlyEagleSchoolBundle } from "./types";

export type IntegrityFindingSeverity = "INFO" | "WARNING" | "BLOCKING";

export type IntegrityFinding = {
  code:
    | "ACTIVE_ZERO_LINKED_FA"
    | "SPLIT_LEARNER_LEDGER"
    | "LEARNER_FA_MISMATCH"
    | "DUPLICATE_SUCCESSOR_PREDECESSOR"
    | "ACTIVE_LEARNER_WITHOUT_FA"
    | "LEDGER_ON_CURRENT_INELIGIBLE_FA"
    | "RETIRED_FA_STILL_LINKED";
  severity: IntegrityFindingSeverity;
  schoolId: string;
  message: string;
  familyAccountId?: string;
  accountRef?: string;
  accountNo?: string | null;
  learnerIds?: string[];
  meta?: Record<string, unknown>;
};

export type BillingIntegrityReport = {
  schoolId: string;
  capturedAt: string;
  checksums: ReturnType<typeof computeCountChecksums>;
  money: ReturnType<typeof computeMoneyTotals>;
  findings: IntegrityFinding[];
  countsByCode: Record<string, number>;
  blockingCount: number;
  warningCount: number;
};

function isActive(status: unknown): boolean {
  return String(status || "ACTIVE").trim().toUpperCase() === "ACTIVE";
}

export function buildBillingIntegrityReport(
  bundle: FlyEagleSchoolBundle,
  opts?: { flyEagleOnly?: boolean }
): BillingIntegrityReport {
  if (opts?.flyEagleOnly !== false) {
    assertFlyEagleSchoolId(bundle.schoolId);
  }

  const checksums = computeCountChecksums(bundle);
  const money = computeMoneyTotals(bundle);
  const findings: IntegrityFinding[] = [];
  const faById = new Map(bundle.familyAccounts.map((fa) => [fa.id, fa]));
  const zeroRows = classifyZeroLinkedFamilyAccounts(bundle);

  for (const row of zeroRows) {
    const isValidHistorical =
      row.category === "VALID_HISTORICAL_NO_REPAIR" ||
      row.category === "LEGITIMATE_HISTORICAL_PREDECESSOR" ||
      (row.category === "HISTORICAL_LEARNER_ACCOUNT" && row.proposedAction === "none");

    findings.push({
      code: "ACTIVE_ZERO_LINKED_FA",
      severity: isValidHistorical
        ? "INFO"
        : row.repairClass === "C"
          ? "WARNING"
          : row.balance || row.ledgerBalance || row.invoiceCount
            ? "WARNING"
            : "INFO",
      schoolId: bundle.schoolId,
      message: isValidHistorical
        ? `VALID HISTORICAL — NO REPAIR REQUIRED: ${row.accountNo || row.accountRef} (${row.category})`
        : `Zero-linked FA ${row.accountNo || row.accountRef} classified ${row.category} / Class ${row.repairClass}`,
      familyAccountId: row.faId,
      accountRef: row.accountRef,
      accountNo: row.accountNo,
      learnerIds: row.matchedLearnerIds,
      meta: {
        category: row.category,
        repairClass: row.repairClass,
        action: row.proposedAction,
        validHistorical: isValidHistorical,
        snapshotBalance: row.balance,
        ledgerBalance: row.ledgerBalance,
      },
    });

    if (
      !isValidHistorical &&
      (row.category === "SPLIT_LEDGER" ||
        (row.evidence.includes("ledger_on_orphan") && row.evidence.includes("ledger_on_current")))
    ) {
      findings.push({
        code: "SPLIT_LEARNER_LEDGER",
        severity: "BLOCKING",
        schoolId: bundle.schoolId,
        message: `Split ledger between orphan ${row.accountNo || row.accountRef} and current FA(s)`,
        familyAccountId: row.faId,
        accountRef: row.accountRef,
        accountNo: row.accountNo,
        learnerIds: row.matchedLearnerIds,
        meta: { currentFaIds: row.currentFaIds },
      });
    }

    if (
      !isValidHistorical &&
      (row.invoiceCount + row.paymentCount + row.creditCount > 0 ||
        round2(row.balance) !== 0 ||
        round2(row.ledgerBalance) !== 0)
    ) {
      findings.push({
        code: "LEDGER_ON_CURRENT_INELIGIBLE_FA",
        severity: "WARNING",
        schoolId: bundle.schoolId,
        message: `Ledger/balance on payment-ineligible (zero-linked) FA ${row.accountNo || row.accountRef}`,
        familyAccountId: row.faId,
        accountRef: row.accountRef,
        accountNo: row.accountNo,
      });
    }
  }

  for (const learner of bundle.learners) {
    if (!isActive(learner.enrollmentStatus)) continue;
    if (!learner.familyAccountId) {
      findings.push({
        code: "ACTIVE_LEARNER_WITHOUT_FA",
        severity: "BLOCKING",
        schoolId: bundle.schoolId,
        message: `Active learner ${learner.id} has no FamilyAccount`,
        learnerIds: [learner.id],
      });
      continue;
    }
    const fa = faById.get(learner.familyAccountId);
    if (!fa) {
      findings.push({
        code: "LEARNER_FA_MISMATCH",
        severity: "BLOCKING",
        schoolId: bundle.schoolId,
        message: `Active learner ${learner.id} points at missing FA ${learner.familyAccountId}`,
        learnerIds: [learner.id],
        familyAccountId: learner.familyAccountId,
      });
      continue;
    }
    if (fa.schoolId !== bundle.schoolId) {
      findings.push({
        code: "LEARNER_FA_MISMATCH",
        severity: "BLOCKING",
        schoolId: bundle.schoolId,
        message: `Active learner ${learner.id} FA belongs to another school`,
        learnerIds: [learner.id],
        familyAccountId: fa.id,
      });
    }
    if (fa.retiredAt || fa.mergedIntoFamilyAccountId) {
      findings.push({
        code: "RETIRED_FA_STILL_LINKED",
        severity: "BLOCKING",
        schoolId: bundle.schoolId,
        message: `Active learner ${learner.id} linked to retired/merged FA ${normRef(fa.accountNo || fa.accountRef)}`,
        learnerIds: [learner.id],
        familyAccountId: fa.id,
        accountRef: fa.accountRef,
        accountNo: fa.accountNo,
      });
    }
  }

  // Duplicate successor/predecessor: same accountNo prefix with one retired pointing at another
  const byNo = new Map<string, typeof bundle.familyAccounts>();
  for (const fa of bundle.familyAccounts) {
    const no = normRef(fa.accountNo);
    if (!no) continue;
    const list = byNo.get(no) || [];
    list.push(fa);
    byNo.set(no, list);
  }
  for (const [no, list] of byNo) {
    if (list.length < 2) continue;
    findings.push({
      code: "DUPLICATE_SUCCESSOR_PREDECESSOR",
      severity: "WARNING",
      schoolId: bundle.schoolId,
      message: `Duplicate FamilyAccount rows share accountNo ${no}`,
      meta: { faIds: list.map((f) => f.id) },
      accountNo: no,
    });
  }

  // Cross-check: linked FA with no ledger but orphan predecessor has ledger for same surname tokens — already in zeroRows

  const countsByCode: Record<string, number> = {};
  let blockingCount = 0;
  let warningCount = 0;
  for (const f of findings) {
    countsByCode[f.code] = (countsByCode[f.code] || 0) + 1;
    if (f.severity === "BLOCKING") blockingCount += 1;
    if (f.severity === "WARNING") warningCount += 1;
  }

  return {
    schoolId: bundle.schoolId,
    capturedAt: bundle.capturedAt,
    checksums,
    money,
    findings,
    countsByCode,
    blockingCount,
    warningCount,
  };
}

/** Migration post-apply guard: surface silent zero-linked creations. */
export function migrationSilentOrphanFindings(input: {
  schoolId: string;
  createdFamilyAccountIds: string[];
  bundle: FlyEagleSchoolBundle;
}): IntegrityFinding[] {
  if (input.schoolId === FLY_EAGLE_SCHOOL_ID) {
    assertFlyEagleSchoolId(input.schoolId);
  }
  const created = new Set(input.createdFamilyAccountIds);
  const linked = new Set(
    input.bundle.learners.map((l) => String(l.familyAccountId || "").trim()).filter(Boolean)
  );
  const findings: IntegrityFinding[] = [];
  for (const fa of input.bundle.familyAccounts) {
    if (!created.has(fa.id)) continue;
    if (linked.has(fa.id)) continue;
    const stats = ledgerStatsForAccountRef(input.bundle.ledger, fa.accountRef);
    findings.push({
      code: "ACTIVE_ZERO_LINKED_FA",
      severity: stats.invoiceCount + stats.paymentCount > 0 ? "BLOCKING" : "WARNING",
      schoolId: input.schoolId,
      message:
        "Migration created a FamilyAccount with zero linked learners — cannot silently leave as active payment account",
      familyAccountId: fa.id,
      accountRef: fa.accountRef,
      accountNo: fa.accountNo,
      meta: { migrationGuard: true, stats },
    });
  }
  return findings;
}
