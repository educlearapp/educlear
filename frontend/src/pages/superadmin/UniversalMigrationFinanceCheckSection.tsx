import { useCallback, useEffect, useState } from "react";
import {
  fetchUniversalMigrationStages,
  type MigrationStageListItem,
} from "../../superAdmin/utils/universalMigrationStage";
import {
  postFinanceReconcile,
  type FinanceReconcilePlainLanguage,
  type MigrationFinanceReconciliation,
} from "../../superAdmin/utils/universalMigrationFinance";
import { useUniversalMigrationWorkflow } from "./UniversalMigrationWorkflowContext";
import { formatRandFromCents } from "./migrationFinanceFormat";

type Props = {
  onNotice?: (message: string) => void;
  onReconciliation?: (recon: MigrationFinanceReconciliation | null) => void;
};

export default function UniversalMigrationFinanceCheckSection({
  onNotice,
  onReconciliation,
}: Props) {
  const { selectedSessionSchoolId } = useUniversalMigrationWorkflow();
  const [stages, setStages] = useState<MigrationStageListItem[]>([]);
  const [selectedStageId, setSelectedStageId] = useState("");
  const [listBusy, setListBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recon, setRecon] = useState<MigrationFinanceReconciliation | null>(null);
  const [plain, setPlain] = useState<FinanceReconcilePlainLanguage | null>(null);

  const refreshStages = useCallback(async () => {
    setListBusy(true);
    setError(null);
    try {
      const schoolFilter = selectedSessionSchoolId.trim() || undefined;
      const list = await fetchUniversalMigrationStages(
        schoolFilter ? { targetSchoolId: schoolFilter } : undefined
      );
      setStages(list);
      if (selectedStageId && !list.some((s) => s.stageId === selectedStageId)) {
        setSelectedStageId("");
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load dry runs");
    } finally {
      setListBusy(false);
    }
  }, [selectedSessionSchoolId, selectedStageId]);

  useEffect(() => {
    void refreshStages();
  }, [refreshStages]);

  async function runCheck() {
    if (!selectedStageId) {
      setError("Select a dry run first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const stageMeta = stages.find((s) => s.stageId === selectedStageId);
      const result = await postFinanceReconcile({
        stageId: selectedStageId,
        ...(stageMeta?.targetSchoolId
          ? { targetSchoolId: stageMeta.targetSchoolId }
          : selectedSessionSchoolId.trim()
            ? { targetSchoolId: selectedSessionSchoolId.trim() }
            : {}),
      });
      setRecon(result.reconciliation);
      setPlain(result.plainLanguage);
      onReconciliation?.(result.reconciliation);
      onNotice?.(
        result.plainLanguage.ok
          ? "Finance Check passed — balances match."
          : `${result.plainLanguage.mismatchCount} account(s) need attention.`
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Finance check failed");
      setRecon(null);
      setPlain(null);
      onReconciliation?.(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="uc-migration-finance-check">
      <p className="uc-migration-dry-run-hint" role="note">
        Finance Check compares the school&apos;s export totals with what EduClear holds after apply.
        Difference must be R0.00 before you can accept the migration.
      </p>
      <div className="uc-migration-apply-stage-row">
        <label className="uc-migration-staging-source-label">
          Dry run package
          <select
            className="uc-migration-staging-source-input"
            value={selectedStageId}
            onChange={(e) => setSelectedStageId(e.target.value)}
            disabled={listBusy || stages.length === 0}
          >
            <option value="">
              {stages.length === 0 ? "No dry runs yet" : "Select a dry run"}
            </option>
            {stages.map((s) => (
              <option key={s.stageId} value={s.stageId}>
                {s.targetSchoolName || "School"} · {s.sourceSystem || "source"}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="uc-migration-upload-primary"
          disabled={busy || !selectedStageId}
          onClick={() => void runCheck()}
        >
          {busy ? "Checking…" : "Run Finance Check"}
        </button>
      </div>
      {error ? (
        <p className="uc-migration-error" role="alert">
          {error}
        </p>
      ) : null}
      {plain && recon ? (
        <div className="uc-migration-finance-summary" role="status">
          <h3>Finance Check</h3>
          <ul className="uc-migration-finance-totals">
            <li>Accounts checked: {plain.accountsChecked}</li>
            <li>Source total: {plain.sourceTotal}</li>
            <li>EduClear total: {plain.educlearTotal}</li>
            <li>
              Difference: {plain.difference} {plain.ok ? "✓" : "✕"}
            </li>
          </ul>
          {plain.ok ? (
            <p>All financial balances match.</p>
          ) : (
            <p>
              {plain.mismatchCount} account
              {plain.mismatchCount === 1 ? "" : "s"} need attention before this migration can be
              completed.
            </p>
          )}
          {recon.mismatches.length > 0 ? (
            <div className="uc-migration-finance-mismatches">
              <h4>Accounts that need attention</h4>
              <ul>
                {recon.mismatches.slice(0, 20).map((m) => (
                  <li key={m.accountRef}>
                    Account {m.accountRef}: Source {formatRandFromCents(m.sourceCents)} · EduClear{" "}
                    {formatRandFromCents(m.educlearCents)} · Difference{" "}
                    {formatRandFromCents(m.diffCents)} ✕
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {recon.blockedReasons.length > 0 ? (
            <ul className="uc-migration-finance-blocked">
              {recon.blockedReasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : null}
          <p className="uc-migration-dry-run-hint">
            Finance check id: {recon.reconciliationId}
            {recon.canAccept ? " — ready for Accept Migration." : ""}
          </p>
        </div>
      ) : null}
    </div>
  );
}
