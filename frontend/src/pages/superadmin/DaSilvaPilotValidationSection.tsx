import { useCallback, useEffect, useMemo, useState } from "react";
import { superAdminApiFetch } from "../../superAdmin/superAdminApi";
import type { SchoolOption } from "../../superAdmin/types/migration";
import {
  createUniversalMigrationPilot,
  fetchUniversalMigrationPilot,
  fetchUniversalMigrationPilots,
  pilotStatusLabel,
  type MigrationPilotRun,
  type MigrationPilotStatus,
  type MigrationPilotUploadedFile,
  type MigrationPilotVerificationCheck,
} from "../../superAdmin/utils/universalMigrationPilot";
import {
  fetchUniversalMigrationImportBatches,
  type MigrationImportBatchSummary,
} from "../../superAdmin/utils/universalMigrationImportBatches";
import {
  fetchUniversalMigrationStages,
  type MigrationStageListItem,
} from "../../superAdmin/utils/universalMigrationStage";

const DA_SILVA_DEFAULT_SCHOOL_ID = "cmpideqeq0000108xb6ouv9zi";
const DA_SILVA_DEFAULT_SOURCE = "kideesys";

function formatDate(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function reconciliationLabel(status: string | undefined): string {
  if (!status) return "Not run";
  if (status === "pass") return "PASS";
  if (status === "warning") return "WARNING";
  return "FAIL";
}

function pilotBadgeClass(status: MigrationPilotStatus): string {
  return `uc-migration-pilot-badge uc-migration-pilot-badge--${status}`;
}

export default function DaSilvaPilotValidationSection() {
  const [schoolOptions, setSchoolOptions] = useState<SchoolOption[]>([]);
  const [schoolId, setSchoolId] = useState(DA_SILVA_DEFAULT_SCHOOL_ID);
  const [sourceSystem, setSourceSystem] = useState(DA_SILVA_DEFAULT_SOURCE);
  const [stageId, setStageId] = useState("");
  const [batchId, setBatchId] = useState("");
  const [notes, setNotes] = useState("");
  const [uploadedFilesText, setUploadedFilesText] = useState(
    "01_transactions.xls|transactions\n02_age_analysis.xls|billing\n03_billing_plan.xls|billing\n04_contact_list.xls|learners"
  );

  const [pilots, setPilots] = useState<MigrationPilotRun[]>([]);
  const [stages, setStages] = useState<MigrationStageListItem[]>([]);
  const [batches, setBatches] = useState<MigrationImportBatchSummary[]>([]);
  const [openPilotId, setOpenPilotId] = useState<string | null>(null);
  const [openPilot, setOpenPilot] = useState<MigrationPilotRun | null>(null);
  const [verificationChecks, setVerificationChecks] = useState<MigrationPilotVerificationCheck[]>(
    []
  );
  const [statusReasons, setStatusReasons] = useState<string[]>([]);
  const [listBusy, setListBusy] = useState(false);
  const [detailBusy, setDetailBusy] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedSchool = useMemo(
    () => schoolOptions.find((s) => s.id === schoolId) ?? null,
    [schoolOptions, schoolId]
  );

  const schoolName = selectedSchool?.name ?? "Da Silva Academy";

  const parseUploadedFiles = useCallback((): MigrationPilotUploadedFile[] => {
    const lines = uploadedFilesText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    return lines.map((line, index) => {
      const [filename, category] = line.split("|").map((p) => p.trim());
      const name = filename || `file-${index + 1}`;
      return {
        fileId: `pilot-file-${index + 1}`,
        filename: name,
        category: category || "unknown",
      };
    });
  }, [uploadedFilesText]);

  const refreshList = useCallback(async () => {
    setListBusy(true);
    setError(null);
    try {
      const [pilotList, stageList, batchList] = await Promise.all([
        fetchUniversalMigrationPilots(),
        fetchUniversalMigrationStages(),
        fetchUniversalMigrationImportBatches(),
      ]);
      setPilots(pilotList);
      setStages(stageList);
      setBatches(batchList);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to refresh pilot data");
    } finally {
      setListBusy(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const schools = (await superAdminApiFetch("/api/schools")) as Array<{
          id: string;
          name: string;
        }>;
        setSchoolOptions(
          schools.map((s) => ({
            id: s.id,
            name: s.name,
          }))
        );
        if (schools.some((s) => s.id === DA_SILVA_DEFAULT_SCHOOL_ID)) {
          setSchoolId(DA_SILVA_DEFAULT_SCHOOL_ID);
        } else if (schools[0]) {
          setSchoolId(schools[0].id);
        }
      } catch {
        /* schools optional for pilot UI */
      }
    })();
    void refreshList();
  }, [refreshList]);

  const openPilotRecord = useCallback(async (pilotId: string) => {
    setOpenPilotId(pilotId);
    setOpenPilot(null);
    setVerificationChecks([]);
    setStatusReasons([]);
    setDetailBusy(true);
    setError(null);
    try {
      const loaded = await fetchUniversalMigrationPilot(pilotId);
      setOpenPilot(loaded.pilot);
      setVerificationChecks(loaded.verificationChecks);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to open pilot");
      setOpenPilotId(null);
    } finally {
      setDetailBusy(false);
    }
  }, []);

  const handleCreatePilot = useCallback(async () => {
    const files = parseUploadedFiles();
    if (files.length === 0) {
      setError("Add at least one uploaded file line (filename|category).");
      return;
    }
    setCreateBusy(true);
    setError(null);
    try {
      const result = await createUniversalMigrationPilot({
        schoolId,
        schoolName,
        sourceSystem: sourceSystem.trim() || DA_SILVA_DEFAULT_SOURCE,
        uploadedFiles: files,
        notes,
        ...(stageId.trim() ? { stageId: stageId.trim() } : {}),
        ...(batchId.trim() ? { batchId: batchId.trim() } : {}),
      });
      setOpenPilot(result.pilot);
      setOpenPilotId(result.pilot.pilotId);
      setVerificationChecks(result.verificationChecks);
      setStatusReasons(result.statusReasons);
      await refreshList();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create pilot record");
    } finally {
      setCreateBusy(false);
    }
  }, [
    batchId,
    notes,
    parseUploadedFiles,
    refreshList,
    schoolId,
    schoolName,
    sourceSystem,
    stageId,
  ]);

  const schoolStages = useMemo(
    () => stages.filter((s) => s.sourceSystem === sourceSystem || !sourceSystem),
    [stages, sourceSystem]
  );

  const schoolBatches = useMemo(
    () => batches.filter((b) => b.targetSchoolId === schoolId),
    [batches, schoolId]
  );

  const displayPilot = openPilot;

  return (
    <div className="uc-migration-pilot-panel">
      <p className="uc-migration-pilot-intro">
        Da Silva pilot validation uses real Universal Migration Framework outputs (validation, dry
        run, reconciliation). Read-only — no automatic apply and no changes to legacy Da Silva
        migration routes.
      </p>

      {error ? (
        <p className="uc-migration-pilot-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="uc-migration-pilot-toolbar">
        <button
          type="button"
          className="uc-migration-pilot-btn uc-migration-pilot-btn--primary"
          disabled={createBusy}
          onClick={() => void handleCreatePilot()}
        >
          {createBusy ? "Creating…" : "Create Pilot Record"}
        </button>
        <button
          type="button"
          className="uc-migration-pilot-btn"
          disabled={listBusy}
          onClick={() => void refreshList()}
        >
          {listBusy ? "Refreshing…" : "Refresh"}
        </button>
        {openPilotId ? (
          <button
            type="button"
            className="uc-migration-pilot-btn"
            disabled={detailBusy}
            onClick={() => void openPilotRecord(openPilotId)}
          >
            Open Pilot
          </button>
        ) : null}
      </div>

      <div className="uc-migration-pilot-form-grid">
        <label className="uc-migration-pilot-field">
          <span>School</span>
          <select value={schoolId} onChange={(e) => setSchoolId(e.target.value)}>
            {schoolOptions.length === 0 ? (
              <option value={schoolId}>{schoolName}</option>
            ) : (
              schoolOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))
            )}
          </select>
        </label>
        <label className="uc-migration-pilot-field">
          <span>Source system</span>
          <input
            type="text"
            value={sourceSystem}
            onChange={(e) => setSourceSystem(e.target.value)}
            placeholder="kideesys"
          />
        </label>
        <label className="uc-migration-pilot-field">
          <span>Dry-run stage (optional)</span>
          <select value={stageId} onChange={(e) => setStageId(e.target.value)}>
            <option value="">— None —</option>
            {schoolStages.map((s) => (
              <option key={s.stageId} value={s.stageId}>
                {s.stageId.slice(0, 8)}… · {formatDate(s.createdAt)}
              </option>
            ))}
          </select>
        </label>
        <label className="uc-migration-pilot-field">
          <span>Import batch (optional)</span>
          <select value={batchId} onChange={(e) => setBatchId(e.target.value)}>
            <option value="">— None —</option>
            {schoolBatches.map((b) => (
              <option key={b.batchId} value={b.batchId}>
                {b.batchId.slice(0, 8)}… · {b.status} · {formatDate(b.createdAt)}
              </option>
            ))}
          </select>
        </label>
        <label className="uc-migration-pilot-field uc-migration-pilot-field--wide">
          <span>Uploaded files (one per line: filename|category)</span>
          <textarea
            rows={4}
            value={uploadedFilesText}
            onChange={(e) => setUploadedFilesText(e.target.value)}
          />
        </label>
        <label className="uc-migration-pilot-field uc-migration-pilot-field--wide">
          <span>Notes</span>
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>

      {displayPilot ? (
        <div className="uc-migration-pilot-detail">
          <div className="uc-migration-pilot-detail-header">
            <h3 className="uc-migration-pilot-detail-title">Pilot run</h3>
            <span className={pilotBadgeClass(displayPilot.status)}>
              {pilotStatusLabel(displayPilot.status)}
            </span>
          </div>

          <dl className="uc-migration-pilot-meta">
            <div>
              <dt>School</dt>
              <dd>
                {displayPilot.schoolName} ({displayPilot.schoolId})
              </dd>
            </div>
            <div>
              <dt>Source system</dt>
              <dd>{displayPilot.sourceSystem}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{formatDate(displayPilot.createdAt)}</dd>
            </div>
            <div>
              <dt>Reconciliation</dt>
              <dd>
                {displayPilot.reconciliationSummary.run
                  ? reconciliationLabel(displayPilot.reconciliationSummary.overallStatus)
                  : "Not run"}
              </dd>
            </div>
          </dl>

          {statusReasons.length > 0 ? (
            <div className="uc-migration-pilot-reasons">
              <h4>Status reasons</h4>
              <ul>
                {statusReasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="uc-migration-pilot-summaries">
            <section>
              <h4>Validation summary</h4>
              <ul>
                <li>Mode: {displayPilot.validationSummary.mode}</li>
                <li>Rows checked: {displayPilot.validationSummary.rowsChecked}</li>
                <li>
                  Errors / warnings: {displayPilot.validationSummary.errors} /{" "}
                  {displayPilot.validationSummary.warnings}
                </li>
                <li>Can proceed: {displayPilot.validationSummary.canProceed ? "Yes" : "No"}</li>
              </ul>
            </section>
            <section>
              <h4>Dry run summary</h4>
              <ul>
                <li>Stage created: {displayPilot.dryRunSummary.stageCreated ? "Yes" : "No"}</li>
                <li>Can apply: {displayPilot.dryRunSummary.canApply ? "Yes" : "No"}</li>
                <li>
                  Staged learners: {displayPilot.dryRunSummary.stagedCounts.learners} · historical:{" "}
                  {displayPilot.dryRunSummary.stagedCounts.historical}
                </li>
                <li>
                  Transaction readiness — blocked:{" "}
                  {displayPilot.dryRunSummary.transactionReadiness.blockedTransactions} · unmatched:{" "}
                  {displayPilot.dryRunSummary.transactionReadiness.unmatchedTransactions}
                </li>
              </ul>
            </section>
            <section>
              <h4>Reconciliation summary</h4>
              {displayPilot.reconciliationSummary.run ? (
                <ul>
                  <li>
                    Checks: {displayPilot.reconciliationSummary.passed} pass /{" "}
                    {displayPilot.reconciliationSummary.warnings} warn /{" "}
                    {displayPilot.reconciliationSummary.failed} fail
                  </li>
                  <li>
                    Head count protected:{" "}
                    {displayPilot.reconciliationSummary.headCountProtected ? "Yes" : "No"}
                  </li>
                  <li>
                    Historical protected:{" "}
                    {displayPilot.reconciliationSummary.historicalLearnersProtected ? "Yes" : "No"}
                  </li>
                </ul>
              ) : (
                <p className="uc-migration-pilot-muted">Link an import batch to run reconciliation.</p>
              )}
            </section>
          </div>

          {displayPilot.notes ? (
            <p className="uc-migration-pilot-notes">
              <strong>Notes:</strong> {displayPilot.notes}
            </p>
          ) : null}

          <section className="uc-migration-pilot-checklist" aria-labelledby="da-silva-pilot-verify-heading">
            <h4 id="da-silva-pilot-verify-heading">Da Silva Pilot Verification</h4>
            <p className="uc-migration-pilot-checklist-hint">Advisory only — does not auto-pass the pilot.</p>
            <ul className="uc-migration-pilot-checklist-list">
              {verificationChecks.map((check) => (
                <li
                  key={check.key}
                  className={
                    check.satisfied
                      ? "uc-migration-pilot-checklist-item uc-migration-pilot-checklist-item--ok"
                      : "uc-migration-pilot-checklist-item"
                  }
                >
                  <span aria-hidden="true">{check.satisfied ? "✓" : "○"}</span>
                  <span>{check.label}</span>
                  {!check.satisfied && check.hint ? (
                    <span className="uc-migration-pilot-checklist-hint-inline">{check.hint}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}

      <div className="uc-migration-pilot-list-wrap">
        <h3 className="uc-migration-pilot-list-title">Pilot records</h3>
        {pilots.length === 0 ? (
          <p className="uc-migration-pilot-muted">No pilot validation runs yet.</p>
        ) : (
          <ul className="uc-migration-pilot-list">
            {pilots.map((p) => (
              <li key={p.pilotId}>
                <button
                  type="button"
                  className="uc-migration-pilot-list-btn"
                  onClick={() => void openPilotRecord(p.pilotId)}
                >
                  <span className={pilotBadgeClass(p.status)}>{pilotStatusLabel(p.status)}</span>
                  <span className="uc-migration-pilot-list-school">{p.schoolName}</span>
                  <span className="uc-migration-pilot-list-meta">
                    {p.sourceSystem} · {formatDate(p.createdAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
