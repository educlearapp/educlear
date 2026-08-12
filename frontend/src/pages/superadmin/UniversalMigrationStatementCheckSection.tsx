import { useState } from "react";
import {
  postStatementAuthorityCheck,
  postStatementAuthorityFinalize,
  type MigrationFinanceReconciliation,
  type MigrationStatementAuthorityCheck,
} from "../../superAdmin/utils/universalMigrationFinance";
import { formatRandFromCents } from "./migrationFinanceFormat";

type Props = {
  reconciliation: MigrationFinanceReconciliation | null;
  onNotice?: (message: string) => void;
  onStatementCheck?: (check: MigrationStatementAuthorityCheck | null) => void;
};

export default function UniversalMigrationStatementCheckSection({
  reconciliation,
  onNotice,
  onStatementCheck,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [check, setCheck] = useState<MigrationStatementAuthorityCheck | null>(null);
  const [confirmSameDate, setConfirmSameDate] = useState(false);

  async function runCheck() {
    if (!reconciliation) {
      setError("Run Finance Check first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await postStatementAuthorityCheck({
        stageId: reconciliation.stageId,
        reconciliationId: reconciliation.reconciliationId,
        targetSchoolId: reconciliation.targetSchoolId,
        confirmSameDatePrecedence: confirmSameDate,
      });
      setCheck(result.check);
      onStatementCheck?.(result.check);
      onNotice?.(
        result.plainLanguage.statementAuthorityMatch
          ? "Statement Balance Check passed — statements match migration balances."
          : `${result.plainLanguage.mismatchCount} statement(s) need attention.`
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Statement Balance Check failed");
      setCheck(null);
      onStatementCheck?.(null);
    } finally {
      setBusy(false);
    }
  }

  async function applyBaseline() {
    if (!reconciliation) return;
    setBusy(true);
    setError(null);
    try {
      const result = await postStatementAuthorityFinalize({
        stageId: reconciliation.stageId,
        reconciliationId: reconciliation.reconciliationId,
        targetSchoolId: reconciliation.targetSchoolId,
        confirmSameDatePrecedence: confirmSameDate,
      });
      setCheck(result.check);
      onStatementCheck?.(result.check);
      onNotice?.(
        result.statementAuthorityMatch
          ? "Migrated balances are now the statement balances."
          : "Baseline applied — some statements still need attention."
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not apply statement balances");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="uc-migration-statement-check">
      <p className="uc-migration-dry-run-hint" role="note">
        Statement Balance Check confirms the same totals you see in Finance Check also appear on
        EduClear statements. Older balance snapshots must not silently override the migrated
        position.
      </p>
      {!reconciliation ? (
        <p>Run Finance Check first.</p>
      ) : (
        <>
          <label className="uc-migration-accept-confirm">
            <input
              type="checkbox"
              checked={confirmSameDate}
              onChange={(e) => setConfirmSameDate(e.target.checked)}
            />{" "}
            If a statement snapshot falls on the same cutover date, use the migrated balances.
          </label>
          <div className="uc-migration-apply-stage-row">
            <button
              type="button"
              className="uc-migration-upload-primary"
              disabled={busy}
              onClick={() => void runCheck()}
            >
              {busy ? "Checking…" : "Run Statement Balance Check"}
            </button>
            <button
              type="button"
              className="uc-migration-upload-clear"
              disabled={busy || !check?.canFinalizeBaseline}
              onClick={() => void applyBaseline()}
            >
              Apply migrated balances to statements
            </button>
          </div>
        </>
      )}
      {error ? (
        <p className="uc-migration-error" role="alert">
          {error}
        </p>
      ) : null}
      {check ? (
        <div className="uc-migration-finance-summary" role="status">
          <h3>Statement Balance Check</h3>
          <ul className="uc-migration-finance-totals">
            <li>Accounts checked: {check.accountsChecked}</li>
            <li>
              {check.statementAuthorityMatch
                ? `${check.matchCount} statements match migration balances ✓`
                : `${check.mismatchCount} statements still need attention`}
            </li>
          </ul>
          {check.mismatches.length > 0 ? (
            <div className="uc-migration-finance-mismatches">
              <h4>Accounts that need attention</h4>
              <ul>
                {check.mismatches.slice(0, 20).map((m) => (
                  <li key={m.accountRef}>
                    Account {m.accountRef}: Source migrated{" "}
                    {formatRandFromCents(m.sourceMigratedCents)} · Finance Check{" "}
                    {formatRandFromCents(m.financeCheckCents)} · Statement{" "}
                    {formatRandFromCents(m.statementAuthorityCents)} — {m.operatorMessage}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {check.blockedReasons.length > 0 ? (
            <ul className="uc-migration-finance-blocked">
              {check.blockedReasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
