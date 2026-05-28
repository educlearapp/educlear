import { useCallback, useEffect, useMemo, useState } from "react";
import { superAdminApiFetch } from "../../superAdmin/superAdminApi";
import type { SchoolOption } from "../../superAdmin/types/migration";
import { fetchUniversalMigrationPilots, type MigrationPilotRun } from "../../superAdmin/utils/universalMigrationPilot";
import {
  createUniversalMigrationRunbook,
  fetchUniversalMigrationRunbook,
  fetchUniversalMigrationRunbooks,
  patchUniversalMigrationRunbook,
  runbookOverallStatusLabel,
  runbookStepStatusLabel,
  type MigrationRunbook,
  type MigrationRunbookStep,
  type MigrationRunbookStepStatus,
} from "../../superAdmin/utils/universalMigrationRunbook";

const DA_SILVA_DEFAULT_SCHOOL_ID = "cmpideqeq0000108xb6ouv9zi";
const DA_SILVA_DEFAULT_SOURCE = "kideesys";

function formatDate(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function overallBadgeClass(status: string): string {
  return `uc-migration-runbook-badge uc-migration-runbook-badge--${status}`;
}

function stepStatusClass(status: MigrationRunbookStepStatus): string {
  return `uc-migration-runbook-step-status uc-migration-runbook-step-status--${status}`;
}

export default function DaSilvaPilotRunbookSection() {
  const [schoolOptions, setSchoolOptions] = useState<SchoolOption[]>([]);
  const [schoolId, setSchoolId] = useState(DA_SILVA_DEFAULT_SCHOOL_ID);
  const [sourceSystem, setSourceSystem] = useState(DA_SILVA_DEFAULT_SOURCE);
  const [pilotId, setPilotId] = useState("");
  const [runbookNotes, setRunbookNotes] = useState("");

  const [runbooks, setRunbooks] = useState<MigrationRunbook[]>([]);
  const [pilots, setPilots] = useState<MigrationPilotRun[]>([]);
  const [activeRunbook, setActiveRunbook] = useState<MigrationRunbook | null>(null);
  const [activeRunbookId, setActiveRunbookId] = useState<string | null>(null);
  const [stepNoteDrafts, setStepNoteDrafts] = useState<Record<string, string>>({});

  const [listBusy, setListBusy] = useState(false);
  const [detailBusy, setDetailBusy] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedSchool = useMemo(
    () => schoolOptions.find((s) => s.id === schoolId) ?? null,
    [schoolOptions, schoolId]
  );
  const schoolName = selectedSchool?.name ?? "Da Silva Academy";

  const refreshList = useCallback(async () => {
    setListBusy(true);
    setError(null);
    try {
      const [runbookList, pilotList] = await Promise.all([
        fetchUniversalMigrationRunbooks(),
        fetchUniversalMigrationPilots(),
      ]);
      setRunbooks(runbookList);
      setPilots(pilotList);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to refresh runbooks");
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
        setSchoolOptions(schools.map((s) => ({ id: s.id, name: s.name })));
        if (schools.some((s) => s.id === DA_SILVA_DEFAULT_SCHOOL_ID)) {
          setSchoolId(DA_SILVA_DEFAULT_SCHOOL_ID);
        } else if (schools[0]) {
          setSchoolId(schools[0].id);
        }
      } catch {
        /* schools optional */
      }
    })();
    void refreshList();
  }, [refreshList]);

  const openRunbook = useCallback(async (runbookId: string) => {
    setActiveRunbookId(runbookId);
    setActiveRunbook(null);
    setDetailBusy(true);
    setError(null);
    try {
      const loaded = await fetchUniversalMigrationRunbook(runbookId);
      setActiveRunbook(loaded);
      const drafts: Record<string, string> = {};
      for (const step of loaded.steps) {
        drafts[step.stepId] = step.notes;
      }
      setStepNoteDrafts(drafts);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to open runbook");
      setActiveRunbookId(null);
    } finally {
      setDetailBusy(false);
    }
  }, []);

  const handleCreateRunbook = useCallback(async () => {
    setCreateBusy(true);
    setError(null);
    try {
      const created = await createUniversalMigrationRunbook({
        schoolId,
        schoolName,
        sourceSystem: sourceSystem.trim() || DA_SILVA_DEFAULT_SOURCE,
        ...(pilotId.trim() ? { pilotId: pilotId.trim() } : {}),
        ...(runbookNotes.trim() ? { notes: runbookNotes.trim() } : {}),
      });
      setActiveRunbook(created);
      setActiveRunbookId(created.runbookId);
      const drafts: Record<string, string> = {};
      for (const step of created.steps) {
        drafts[step.stepId] = step.notes;
      }
      setStepNoteDrafts(drafts);
      await refreshList();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create runbook");
    } finally {
      setCreateBusy(false);
    }
  }, [pilotId, refreshList, runbookNotes, schoolId, schoolName, sourceSystem]);

  const updateStepStatus = useCallback(
    async (step: MigrationRunbookStep, status: MigrationRunbookStepStatus) => {
      if (!activeRunbook) return;
      setSaveBusy(true);
      setError(null);
      try {
        const notes = stepNoteDrafts[step.stepId] ?? step.notes;
        const updated = await patchUniversalMigrationRunbook(activeRunbook.runbookId, {
          steps: [{ stepId: step.stepId, status, notes }],
        });
        setActiveRunbook(updated);
        await refreshList();
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Failed to update step");
      } finally {
        setSaveBusy(false);
      }
    },
    [activeRunbook, refreshList, stepNoteDrafts]
  );

  const saveStepNotes = useCallback(
    async (step: MigrationRunbookStep) => {
      if (!activeRunbook) return;
      const notes = stepNoteDrafts[step.stepId] ?? "";
      if (notes === step.notes) return;
      setSaveBusy(true);
      setError(null);
      try {
        const updated = await patchUniversalMigrationRunbook(activeRunbook.runbookId, {
          steps: [{ stepId: step.stepId, notes }],
        });
        setActiveRunbook(updated);
        const drafts: Record<string, string> = {};
        for (const s of updated.steps) {
          drafts[s.stepId] = s.notes;
        }
        setStepNoteDrafts(drafts);
        await refreshList();
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Failed to save step notes");
      } finally {
        setSaveBusy(false);
      }
    },
    [activeRunbook, refreshList, stepNoteDrafts]
  );

  const linkPilot = useCallback(async () => {
    if (!activeRunbook) return;
    setSaveBusy(true);
    setError(null);
    try {
      const updated = await patchUniversalMigrationRunbook(activeRunbook.runbookId, {
        pilotId: pilotId.trim() || null,
      });
      setActiveRunbook(updated);
      await refreshList();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to link pilot");
    } finally {
      setSaveBusy(false);
    }
  }, [activeRunbook, pilotId, refreshList]);

  const schoolPilots = useMemo(
    () => pilots.filter((p) => p.schoolId === schoolId),
    [pilots, schoolId]
  );

  const displayRunbook = activeRunbook;

  return (
    <div className="uc-migration-runbook-panel">
      <p className="uc-migration-runbook-intro">
        Operational checklist for a real Da Silva pilot migration. Track progress step by step —
        read-only guidance only. Apply, reconciliation, and sign-off steps must be marked complete
        manually after you run those actions in the pipeline sections above.
      </p>

      {error ? (
        <p className="uc-migration-runbook-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="uc-migration-runbook-toolbar">
        <button
          type="button"
          className="uc-migration-runbook-btn uc-migration-runbook-btn--primary"
          disabled={createBusy}
          onClick={() => void handleCreateRunbook()}
        >
          {createBusy ? "Creating…" : "Create Runbook"}
        </button>
        <button
          type="button"
          className="uc-migration-runbook-btn"
          disabled={listBusy}
          onClick={() => void refreshList()}
        >
          {listBusy ? "Refreshing…" : "Refresh"}
        </button>
        {activeRunbookId ? (
          <button
            type="button"
            className="uc-migration-runbook-btn"
            disabled={detailBusy}
            onClick={() => void openRunbook(activeRunbookId)}
          >
            Reload Runbook
          </button>
        ) : null}
      </div>

      <div className="uc-migration-runbook-form-grid">
        <label className="uc-migration-runbook-field">
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
        <label className="uc-migration-runbook-field">
          <span>Source system</span>
          <input
            type="text"
            value={sourceSystem}
            onChange={(e) => setSourceSystem(e.target.value)}
            placeholder="kideesys"
          />
        </label>
        <label className="uc-migration-runbook-field">
          <span>Linked pilot (optional)</span>
          <select value={pilotId} onChange={(e) => setPilotId(e.target.value)}>
            <option value="">— None —</option>
            {schoolPilots.map((p) => (
              <option key={p.pilotId} value={p.pilotId}>
                {p.pilotId.slice(0, 8)}… · {formatDate(p.createdAt)}
              </option>
            ))}
          </select>
        </label>
        <label className="uc-migration-runbook-field uc-migration-runbook-field--wide">
          <span>Runbook notes</span>
          <textarea rows={2} value={runbookNotes} onChange={(e) => setRunbookNotes(e.target.value)} />
        </label>
      </div>

      {displayRunbook ? (
        <div className="uc-migration-runbook-detail">
          <div className="uc-migration-runbook-detail-header">
            <h3 className="uc-migration-runbook-detail-title">Da Silva pilot runbook</h3>
            <span className={overallBadgeClass(displayRunbook.overallStatus)}>
              {runbookOverallStatusLabel(displayRunbook.overallStatus)}
            </span>
          </div>

          <dl className="uc-migration-runbook-meta">
            <div>
              <dt>School</dt>
              <dd>
                {displayRunbook.schoolName} ({displayRunbook.schoolId})
              </dd>
            </div>
            <div>
              <dt>Source system</dt>
              <dd>{displayRunbook.sourceSystem}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{formatDate(displayRunbook.createdAt)}</dd>
            </div>
            <div>
              <dt>Linked pilot</dt>
              <dd>
                {displayRunbook.pilotId ? (
                  <button
                    type="button"
                    className="uc-migration-runbook-link-btn"
                    onClick={() => setPilotId(displayRunbook.pilotId)}
                  >
                    {displayRunbook.pilotId}
                  </button>
                ) : (
                  "—"
                )}
              </dd>
            </div>
          </dl>

          <div className="uc-migration-runbook-link-row">
            <label className="uc-migration-runbook-field">
              <span>Update linked pilot</span>
              <select
                value={pilotId || displayRunbook.pilotId}
                onChange={(e) => setPilotId(e.target.value)}
              >
                <option value="">— None —</option>
                {schoolPilots.map((p) => (
                  <option key={p.pilotId} value={p.pilotId}>
                    {p.pilotId.slice(0, 8)}… · {formatDate(p.createdAt)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="uc-migration-runbook-btn"
              disabled={saveBusy}
              onClick={() => void linkPilot()}
            >
              Save pilot link
            </button>
          </div>

          {displayRunbook.notes ? (
            <p className="uc-migration-runbook-notes-block">
              <strong>Runbook notes:</strong> {displayRunbook.notes}
            </p>
          ) : null}

          <div className="uc-migration-runbook-table-wrap">
            <table className="uc-migration-runbook-table">
              <thead>
                <tr>
                  <th scope="col">Step</th>
                  <th scope="col">Description</th>
                  <th scope="col">Status</th>
                  <th scope="col">Required</th>
                  <th scope="col">Notes</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {displayRunbook.steps.map((step) => (
                  <tr key={step.stepId}>
                    <td>
                      <span className="uc-migration-runbook-step-title">{step.title}</span>
                    </td>
                    <td className="uc-migration-runbook-step-desc">{step.description}</td>
                    <td>
                      <span className={stepStatusClass(step.status)}>
                        {runbookStepStatusLabel(step.status)}
                      </span>
                    </td>
                    <td>{step.required ? "Yes" : "No"}</td>
                    <td>
                      <textarea
                        className="uc-migration-runbook-step-notes-input"
                        rows={2}
                        value={stepNoteDrafts[step.stepId] ?? step.notes}
                        onChange={(e) =>
                          setStepNoteDrafts((prev) => ({
                            ...prev,
                            [step.stepId]: e.target.value,
                          }))
                        }
                        onBlur={() => void saveStepNotes(step)}
                        placeholder="Operator notes…"
                      />
                    </td>
                    <td>
                      <div className="uc-migration-runbook-step-actions">
                        <button
                          type="button"
                          className="uc-migration-runbook-step-btn"
                          disabled={saveBusy || step.status === "in_progress"}
                          onClick={() => void updateStepStatus(step, "in_progress")}
                        >
                          In progress
                        </button>
                        <button
                          type="button"
                          className="uc-migration-runbook-step-btn uc-migration-runbook-step-btn--done"
                          disabled={saveBusy || step.status === "completed"}
                          onClick={() => void updateStepStatus(step, "completed")}
                        >
                          Completed
                        </button>
                        <button
                          type="button"
                          className="uc-migration-runbook-step-btn uc-migration-runbook-step-btn--block"
                          disabled={saveBusy || step.status === "blocked"}
                          onClick={() => void updateStepStatus(step, "blocked")}
                        >
                          Blocked
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="uc-migration-runbook-list-wrap">
        <h3 className="uc-migration-runbook-list-title">Runbooks</h3>
        {runbooks.length === 0 ? (
          <p className="uc-migration-runbook-muted">No pilot runbooks yet.</p>
        ) : (
          <ul className="uc-migration-runbook-list">
            {runbooks.map((r) => (
              <li key={r.runbookId}>
                <button
                  type="button"
                  className="uc-migration-runbook-list-btn"
                  onClick={() => void openRunbook(r.runbookId)}
                >
                  <span className={overallBadgeClass(r.overallStatus)}>
                    {runbookOverallStatusLabel(r.overallStatus)}
                  </span>
                  <span className="uc-migration-runbook-list-school">{r.schoolName}</span>
                  <span className="uc-migration-runbook-list-meta">
                    {r.sourceSystem} · {formatDate(r.createdAt)}
                    {r.pilotId ? ` · pilot ${r.pilotId.slice(0, 8)}…` : ""}
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
