import { useState } from "react";
import {
  postAcceptMigration,
  type MigrationFeeCheckAuthorityCheck,
  type MigrationFinanceReconciliation,
  type MigrationStatementAuthorityCheck,
} from "../../superAdmin/utils/universalMigrationFinance";
import { formatRandFromCents } from "./migrationFinanceFormat";

type Props = {
  reconciliation: MigrationFinanceReconciliation | null;
  statementCheck: MigrationStatementAuthorityCheck | null;
  feeCheck: MigrationFeeCheckAuthorityCheck | null;
  onNotice?: (message: string) => void;
};

export default function UniversalMigrationAcceptSection({
  reconciliation,
  statementCheck,
  feeCheck,
  onNotice,
}: Props) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acceptedId, setAcceptedId] = useState<string | null>(null);

  const financeOk = Boolean(reconciliation?.canAccept && !reconciliation.stale);
  const statementOk = Boolean(
    statementCheck?.statementAuthorityMatch && !statementCheck.stale
  );
  const feeOk = Boolean(feeCheck?.feeCheckAuthorityMatch && !feeCheck.stale);
  const canAccept = financeOk && statementOk && feeOk;
  const disabled = !canAccept || !confirm || busy || Boolean(acceptedId);

  async function onAccept() {
    if (!reconciliation || !statementCheck || !feeCheck) return;
    setBusy(true);
    setError(null);
    try {
      const { acceptance } = await postAcceptMigration({
        stageId: reconciliation.stageId,
        reconciliationId: reconciliation.reconciliationId,
        statementAuthorityCheckId: statementCheck.checkId,
        feeCheckAuthorityCheckId: feeCheck.checkId,
        targetSchoolId: reconciliation.targetSchoolId,
        confirmation: true,
        parentReviewUnresolved: 0,
        summary: {
          learners: 0,
          parents: 0,
          links: 0,
          classrooms: 0,
          accounts: reconciliation.sourceTotals.accountCount,
          openingBalances: reconciliation.sourceTotals.openingBalanceCount,
          transactions: reconciliation.sourceTotals.transactionCount,
          billingPlans: 0,
          unsupportedSkipped: reconciliation.skippedUnsupported.length,
          differenceCents: reconciliation.differenceCents,
        },
      });
      setAcceptedId(acceptance.acceptanceId);
      onNotice?.(
        "Migration accepted. After acceptance, correct statement issues with forward-fix — not casual rollback."
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Accept failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="uc-migration-accept">
      <p className="uc-migration-dry-run-hint" role="note">
        Accept Migration requires Finance Check, Statement Balance Check, and Fee Check Authority
        Check all clear (FEE_CHECK_AUTHORITY_MATCH). After acceptance, rollback is exceptional
        recovery — not routine undo.
      </p>
      {!reconciliation ? (
        <p>Run Finance Check first.</p>
      ) : (
        <>
          <ul className="uc-migration-finance-totals">
            <li>Accounts: {reconciliation.sourceTotals.accountCount}</li>
            <li>Opening balances: {reconciliation.sourceTotals.openingBalanceCount}</li>
            <li>Transactions (post-cutover): {reconciliation.sourceTotals.transactionCount}</li>
            <li>
              Finance difference: {formatRandFromCents(reconciliation.differenceCents)}{" "}
              {reconciliation.differenceCents === 0 ? "✓" : "✕"}
            </li>
            <li>
              Statement authority:{" "}
              {statementOk ? "Match ✓" : "Not yet matched — run Statement Balance Check"}
            </li>
            <li>
              Fee Check authority:{" "}
              {feeOk ? "Match ✓" : "Not yet matched — run Fee Check Balance Check"}
            </li>
            <li>Unsupported / skipped finance notes: {reconciliation.skippedUnsupported.length}</li>
          </ul>
          <label className="uc-migration-accept-confirm">
            <input
              type="checkbox"
              checked={confirm}
              disabled={!canAccept || Boolean(acceptedId)}
              onChange={(e) => setConfirm(e.target.checked)}
            />{" "}
            I confirm Source, Finance Check, statements and Fee Check match (difference R0.00) and
            Parent Review is clear.
          </label>
          <div className="uc-migration-apply-stage-row">
            <button
              type="button"
              className="uc-migration-upload-primary"
              disabled={disabled}
              onClick={() => void onAccept()}
            >
              {acceptedId ? "Migration accepted" : busy ? "Accepting…" : "Accept Migration"}
            </button>
          </div>
          {acceptedId ? (
            <p role="status">
              Accepted ({acceptedId}). Do not treat rollback as casually safe after this point.
            </p>
          ) : null}
          {error ? (
            <p className="uc-migration-error" role="alert">
              {error}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
