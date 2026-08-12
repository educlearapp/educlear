/**
 * Verify Finance Check balances vs live statement authority
 * (resolveAuthoritativeAccountBalance / age-analysis + delta).
 */

import { randomUUID } from "crypto";
import {
  readSchoolFamilyAccountAgeAnalysisSnapshots,
} from "../../../../utils/familyAccountAgeAnalysisStore";
import {
  readSchoolLedger,
  type BillingLedgerEntry,
} from "../../../../utils/billingLedgerStore";
import { resolveAuthoritativeAccountBalanceFromSnapshot } from "../../../statementAccounts";
import type { MigrationFinanceReconciliation } from "../MigrationFinanceReconciliation";
import { centsEqual, randToCents } from "../moneyCents";
import {
  classifySnapshotRelativeToCutover,
  snapshotCaseOperatorMessage,
} from "./classifySnapshotRelativeToCutover";
import { normalizeCutoverAt } from "./cutoverInstant";
import {
  MIGRATION_STATEMENT_AUTHORITY_VERSION,
  type MigrationStatementAuthorityCheck,
  type StatementAuthorityAccountRow,
} from "./MigrationStatementAuthority";
import { saveStatementAuthorityCheck } from "./statementAuthorityStore";
import { getBoundCompiledPlan } from "../../migrationPlan/migrationPlanStore";
import type { MigrationStage } from "../../types/MigrationStage";

const LIVE_SOURCES = new Set(["manual", "bank_import", "kidesys_topup"]);

function isLiveEntry(entry: BillingLedgerEntry): boolean {
  const source = String(entry.source || "").trim().toLowerCase();
  return LIVE_SOURCES.has(source);
}

export function verifyStatementAuthority(input: {
  stage: MigrationStage;
  reconciliation: MigrationFinanceReconciliation;
  /** Operator explicitly allows same-day snapshot supersession. */
  confirmSameDatePrecedence?: boolean;
}): MigrationStatementAuthorityCheck {
  const stage = input.stage;
  const recon = input.reconciliation;
  const blockedReasons: string[] = [];
  const staleReasons: string[] = [];

  const cutoverAt = normalizeCutoverAt(stage.cutoverDate);
  if (!cutoverAt) {
    blockedReasons.push("Cutover date/time is required for statement balance authority.");
  }

  if (recon.targetSchoolId !== stage.targetSchoolId) {
    blockedReasons.push("Finance Check is bound to a different school than this dry run.");
  }
  if (recon.stageId !== stage.stageId) {
    blockedReasons.push("Finance Check is bound to a different dry run.");
  }
  if (!recon.canAccept || recon.differenceCents !== 0 || recon.mismatches.length > 0) {
    blockedReasons.push("Finance Check must be clear (difference R0.00) before statement check.");
  }
  if (recon.stale) {
    staleReasons.push("Finance Check is stale.");
  }

  // Plan fingerprint stale
  if (stage.compiledPlanId) {
    const plan = getBoundCompiledPlan(stage.compiledPlanId, {
      targetSchoolId: stage.targetSchoolId,
    });
    if (!plan) {
      staleReasons.push("Compiled plan missing or wrong school.");
    } else {
      const byId = new Map(plan.sourceFingerprints.map((f) => [f.fileId, f.headerFingerprint]));
      for (const fp of stage.sourceFingerprints || []) {
        const expected = byId.get(fp.fileId);
        if (expected && expected !== fp.headerFingerprint) {
          staleReasons.push("Source/plan fingerprints changed.");
          break;
        }
      }
    }
  }

  const effectiveCutover = cutoverAt || new Date().toISOString();
  const snapshots = readSchoolFamilyAccountAgeAnalysisSnapshots(stage.targetSchoolId);
  const ledger = readSchoolLedger(stage.targetSchoolId);

  const liveConcurrency: MigrationStatementAuthorityCheck["liveConcurrency"] = [];
  for (const entry of ledger) {
    if (!isLiveEntry(entry)) continue;
    const created = String(entry.createdAt || "").trim();
    if (!created) continue;
    if (new Date(created).getTime() >= new Date(effectiveCutover).getTime()) {
      // Between cutover and now — concurrent live activity
      liveConcurrency.push({
        accountRef: String(entry.accountNo || "").trim(),
        entryId: entry.id,
        source: String(entry.source || ""),
        createdAt: created,
        amount: Number(entry.amount) || 0,
        type: entry.type,
      });
    }
  }

  const perAccount: StatementAuthorityAccountRow[] = [];
  for (const row of recon.perAccount) {
    const ref = row.accountRef;
    const snap =
      snapshots[ref] ||
      snapshots[ref.toUpperCase()] ||
      Object.values(snapshots).find(
        (s) => String(s.accountRef || "").trim().toUpperCase() === ref.toUpperCase()
      );

    const accountEntries = ledger.filter(
      (e) => String(e.accountNo || "").trim().toUpperCase() === ref.toUpperCase()
    );
    const statementAuthorityCents = randToCents(
      resolveAuthoritativeAccountBalanceFromSnapshot(snap, accountEntries)
    );

    const accountLive = liveConcurrency.some(
      (l) => l.accountRef.toUpperCase() === ref.toUpperCase()
    );
    let snapshotCase = classifySnapshotRelativeToCutover({
      snap,
      cutoverAt: effectiveCutover,
      hasProtectedLiveActivity: accountLive,
    });
    if (accountLive && snapshotCase !== "NEWER_THAN_CUTOVER") {
      // Elevate messaging for live concurrency without changing NEWER block semantics
      if (snapshotCase === "NO_SNAPSHOT" || snapshotCase === "OLDER_THAN_CUTOVER") {
        // still finalizable, but note concurrency
      }
    }

    const financeCheckCents = row.educlearCents;
    const sourceMigratedCents = row.sourceCents;
    const diff = financeCheckCents - statementAuthorityCents;
    const alreadyMatches =
      centsEqual(sourceMigratedCents, financeCheckCents) &&
      centsEqual(financeCheckCents, statementAuthorityCents);

    let ok = alreadyMatches;
    let operatorMessage = snapshotCaseOperatorMessage(
      snapshotCase,
      snap?.importedAt || null
    );

    if (snapshotCase === "NEWER_THAN_CUTOVER" && !alreadyMatches) {
      ok = false;
      operatorMessage = snapshotCaseOperatorMessage(snapshotCase, snap?.importedAt || null);
    } else if (
      snapshotCase === "SAME_DATE_AS_CUTOVER" &&
      !alreadyMatches &&
      !input.confirmSameDatePrecedence
    ) {
      ok = false;
      operatorMessage =
        "A statement snapshot exists on the same cutover date — confirm migrated balances take precedence, then re-run Statement Balance Check.";
    } else if (!alreadyMatches) {
      // Expected before baseline finalization for NO_SNAPSHOT / OLDER
      ok = false;
      if (snapshotCase === "NO_SNAPSHOT" || snapshotCase === "OLDER_THAN_CUTOVER") {
        operatorMessage =
          "Statement balance does not yet match the migrated balance — apply migrated balances as the statement baseline, then re-check.";
      }
    }

    if (accountLive && !alreadyMatches) {
      operatorMessage +=
        " Live transactions were found after cutover — they are preserved; re-reconcile if totals moved.";
    }

    perAccount.push({
      accountRef: ref,
      sourceMigratedCents,
      financeCheckCents,
      statementAuthorityCents,
      diffFinanceVsStatementCents: diff,
      ok,
      snapshotCase,
      priorSnapshotImportedAt: snap?.importedAt || null,
      priorSnapshotBalanceCents: snap ? randToCents(snap.balance) : null,
      operatorMessage,
    });
  }

  const mismatches = perAccount.filter((p) => !p.ok);
  const matchCount = perAccount.filter((p) => p.ok).length;

  const hasNewerBlocking = perAccount.some(
    (p) => p.snapshotCase === "NEWER_THAN_CUTOVER" && !p.ok
  );
  const needsSameDateConfirm = perAccount.some(
    (p) =>
      p.snapshotCase === "SAME_DATE_AS_CUTOVER" &&
      !p.ok &&
      !input.confirmSameDatePrecedence
  );

  if (hasNewerBlocking) {
    blockedReasons.push(
      "One or more statements use a newer balance snapshot than the migration cutover — review required."
    );
  }
  if (needsSameDateConfirm) {
    blockedReasons.push(
      "Same-date statement snapshots need confirmation that migrated balances take precedence."
    );
  }
  if (liveConcurrency.length > 0 && mismatches.length > 0) {
    blockedReasons.push(
      `${liveConcurrency.length} live transaction(s) after cutover detected — re-run Finance Check and Statement Balance Check.`
    );
  }

  const canFinalizeBaseline =
    blockedReasons.length === 0 &&
    !hasNewerBlocking &&
    recon.canAccept &&
    staleReasons.length === 0 &&
    mismatches.length > 0; // finalize needed when not yet matching

  const statementAuthorityMatch =
    mismatches.length === 0 &&
    blockedReasons.length === 0 &&
    staleReasons.length === 0 &&
    perAccount.length > 0;

  if (!statementAuthorityMatch && mismatches.length > 0 && !canFinalizeBaseline && blockedReasons.length === 0) {
    // Can finalize path will clear mismatches — not an extra block if finalize allowed
  }

  // If already matching, canFinalize is false (idempotent — nothing to write)
  const check: MigrationStatementAuthorityCheck = {
    checkId: `stmtchk_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    authorityVersion: MIGRATION_STATEMENT_AUTHORITY_VERSION,
    generatedAt: new Date().toISOString(),
    migrationRunId: stage.migrationRunId || stage.stageId,
    stageId: stage.stageId,
    targetSchoolId: stage.targetSchoolId,
    sourceAnalysisId: stage.sourceAnalysisId || null,
    compiledPlanId: stage.compiledPlanId || null,
    reconciliationId: recon.reconciliationId,
    cutoverAt: effectiveCutover,
    accountsChecked: perAccount.length,
    matchCount,
    mismatchCount: mismatches.length,
    perAccount,
    mismatches,
    liveConcurrency,
    statementAuthorityMatch,
    canFinalizeBaseline:
      canFinalizeBaseline ||
      (mismatches.length > 0 &&
        !hasNewerBlocking &&
        !needsSameDateConfirm &&
        recon.canAccept &&
        staleReasons.length === 0 &&
        Boolean(cutoverAt)),
    blockedReasons: [...blockedReasons, ...staleReasons],
    stale: staleReasons.length > 0,
    staleReasons,
  };

  return saveStatementAuthorityCheck(check);
}
