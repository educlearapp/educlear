import { useState } from "react";
import {
  postAgingCheck,
  type MigrationAgingCheck,
  type MigrationFinanceReconciliation,
} from "../../superAdmin/utils/universalMigrationFinance";
import { formatRandFromCents } from "./migrationFinanceFormat";

type Props = {
  reconciliation: MigrationFinanceReconciliation | null;
  onNotice?: (message: string) => void;
  onAgingCheck?: (check: MigrationAgingCheck | null) => void;
};

export default function UniversalMigrationAgingCheckSection({
  reconciliation,
  onNotice,
  onAgingCheck,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [check, setCheck] = useState<MigrationAgingCheck | null>(null);

  async function runCheck() {
    if (!reconciliation) {
      setError("Run Finance Check and apply statement baselines first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await postAgingCheck({
        stageId: reconciliation.stageId,
        reconciliationId: reconciliation.reconciliationId,
        targetSchoolId: reconciliation.targetSchoolId,
      });
      setCheck(result.check);
      onAgingCheck?.(result.check);
      onNotice?.(
        result.plainLanguage.agingCheckPass
          ? "Aging Check passed."
          : "Aging Check needs attention — see balance-only vs source-bucket notes."
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Aging Check failed");
      setCheck(null);
      onAgingCheck?.(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="uc-migration-aging-check">
      <p className="uc-migration-dry-run-hint" role="note">
        When the source provides reliable aging buckets, EduClear preserves them. When only a total
        balance is available, EduClear records BALANCE_ONLY — it does not invent aging history.
      </p>
      {!reconciliation ? (
        <p>Run Finance Check first.</p>
      ) : (
        <div className="uc-migration-apply-stage-row">
          <button
            type="button"
            className="uc-migration-upload-primary"
            disabled={busy}
            onClick={() => void runCheck()}
          >
            {busy ? "Checking…" : "Run Aging Check"}
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
          <h3>Aging Check</h3>
          <ul className="uc-migration-finance-totals">
            <li>Accounts checked: {check.accountsChecked}</li>
            <li>Source buckets preserved: {check.sourceBucketsCount}</li>
            <li>Balance only (no reliable aging): {check.balanceOnlyCount}</li>
            <li>
              {check.agingCheckPass
                ? "Aging Check passed ✓"
                : `${check.mismatchCount} account(s) need attention`}
            </li>
          </ul>
          <ul>
            {check.perAccount.slice(0, 20).map((row) => (
              <li key={row.accountRef}>
                Account {row.accountRef}: {row.mode} — accepted{" "}
                {formatRandFromCents(row.acceptedBalanceCents)} — {row.operatorMessage}
              </li>
            ))}
          </ul>
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
