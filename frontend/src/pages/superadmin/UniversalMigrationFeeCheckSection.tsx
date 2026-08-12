import { useState } from "react";
import {
  postFeeCheckAuthority,
  type MigrationFeeCheckAuthorityCheck,
  type MigrationFinanceReconciliation,
  type MigrationStatementAuthorityCheck,
} from "../../superAdmin/utils/universalMigrationFinance";
import { formatRandFromCents } from "./migrationFinanceFormat";

type Props = {
  reconciliation: MigrationFinanceReconciliation | null;
  statementCheck: MigrationStatementAuthorityCheck | null;
  onNotice?: (message: string) => void;
  onFeeCheck?: (check: MigrationFeeCheckAuthorityCheck | null) => void;
};

export default function UniversalMigrationFeeCheckSection({
  reconciliation,
  statementCheck,
  onNotice,
  onFeeCheck,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [check, setCheck] = useState<MigrationFeeCheckAuthorityCheck | null>(null);

  async function runCheck() {
    if (!reconciliation || !statementCheck) {
      setError("Run Finance Check and Statement Balance Check first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await postFeeCheckAuthority({
        stageId: reconciliation.stageId,
        reconciliationId: reconciliation.reconciliationId,
        statementAuthorityCheckId: statementCheck.checkId,
        targetSchoolId: reconciliation.targetSchoolId,
      });
      setCheck(result.check);
      onFeeCheck?.(result.check);
      onNotice?.(
        result.plainLanguage.feeCheckAuthorityMatch
          ? "Fee Check Authority Check passed — Source = Finance = Statement = Fee Check."
          : `${result.plainLanguage.mismatchCount} Fee Check account(s) need attention.`
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Fee Check Authority Check failed");
      setCheck(null);
      onFeeCheck?.(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="uc-migration-fee-check">
      <p className="uc-migration-dry-run-hint" role="note">
        Fee Check must use the same authoritative family-account balance as statements — not a
        stale Parent.outstandingAmount when a family account exists.
      </p>
      {!reconciliation || !statementCheck ? (
        <p>Run Finance Check and Statement Balance Check first.</p>
      ) : (
        <div className="uc-migration-apply-stage-row">
          <button
            type="button"
            className="uc-migration-upload-primary"
            disabled={busy || !statementCheck.statementAuthorityMatch}
            onClick={() => void runCheck()}
          >
            {busy ? "Checking…" : "Run Fee Check Balance Check"}
          </button>
        </div>
      )}
      {error ? (
        <p className="uc-migration-error" role="alert">
          {error}
        </p>
      ) : null}
      {check ? (
        <div className="uc-migration-finance-summary" role="status">
          <h3>Fee Check Authority</h3>
          <ul className="uc-migration-finance-totals">
            <li>Accounts checked: {check.accountsChecked}</li>
            <li>
              {check.feeCheckAuthorityMatch
                ? `${check.matchCount} accounts match across Source / Finance / Statement / Fee Check ✓`
                : `${check.mismatchCount} accounts still need attention`}
            </li>
          </ul>
          {check.mismatches.length > 0 ? (
            <div className="uc-migration-finance-mismatches">
              <h4>Accounts that need attention</h4>
              <ul>
                {check.mismatches.slice(0, 20).map((m) => (
                  <li key={m.accountRef}>
                    Account {m.accountRef}: Source {formatRandFromCents(m.sourceCents)} · Finance{" "}
                    {formatRandFromCents(m.financeCents)} · Statement{" "}
                    {formatRandFromCents(m.statementCents)} · Fee Check{" "}
                    {formatRandFromCents(m.feeCheckCents)} — {m.operatorMessage}
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
