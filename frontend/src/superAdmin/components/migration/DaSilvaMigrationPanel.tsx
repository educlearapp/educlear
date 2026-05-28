import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  DaSilvaFileSlots,
  DaSilvaManifestDebugReport,
  DaSilvaSavedFilesAuditRow,
  DaSilvaWizardPreviews,
} from "../../types/daSilvaMigration";
import {
  allDaSilvaManifestSlotsGreen,
  allDaSilvaPreviewsPassed,
  buildSavedFilesAuditRows,
  createDaSilvaProject,
  fetchDaSilvaManifestDebug,
  fetchDaSilvaProjectStatus,
  formatDaSilvaWizardReport,
  importDaSilvaPhase,
  rollbackDaSilvaImport,
  runAllDaSilvaPreviews,
  slotsSatisfyUpload,
  uploadDaSilvaStagingFiles,
} from "../../utils/daSilvaMigration";

type Props = {
  schoolId: string;
  disabled?: boolean;
  onNotice: (payload: {
    title: string;
    message: string;
    details?: string;
    primaryAction?: { label: string; onClick: () => void };
  }) => void;
};

const UPLOAD_SLOTS: Array<{
  key: keyof Omit<DaSilvaFileSlots, "classListFiles">;
  label: string;
  accept: string;
  multiple?: boolean;
}> = [
  { key: "learnerRegister", label: "SA-SAMS learner_register.xls", accept: ".xls,.xlsx" },
  { key: "parentLearnerLinks", label: "SA-SAMS parent_learner_links.xls", accept: ".xls,.xlsx" },
  { key: "parentRegister", label: "SA-SAMS parent_register.xls", accept: ".xls,.xlsx" },
  { key: "billingPlan", label: "Kid-e-Sys billing plan summary", accept: ".xls,.xlsx" },
  { key: "ageAnalysis", label: "Kid-e-Sys age analysis", accept: ".xls,.xlsx" },
  { key: "transactions", label: "Kid-e-Sys transaction list", accept: ".xls,.xlsx" },
  { key: "contactList", label: "Kid-e-Sys contact list (04 Contact List)", accept: ".xls,.xlsx" },
  {
    key: "employeeContactList",
    label: "Kid-e-Sys employee contact list (06 Employees)",
    accept: ".xls,.xlsx",
  },
];

const IMPORT_PHASES = [
  {
    id: "classrooms" as const,
    manifestPhase: "classrooms",
    label: "Phase 1 — Classes",
    requires: "sasamsClassesLearners",
  },
  {
    id: "learners" as const,
    manifestPhase: "learners",
    label: "Phase 2 — Learners",
    requires: "sasamsClassesLearners",
    prior: "classrooms",
  },
  {
    id: "parents" as const,
    manifestPhase: "parents",
    label: "Phase 3 — Parents/Links",
    requires: "sasamsParentsLinks",
    prior: "learners",
  },
  {
    id: "billing-match" as const,
    manifestPhase: "billing_match",
    label: "Phase 4 — Billing Match",
    requires: "kideesysBillingMatch",
    prior: "parents",
  },
  {
    id: "billing" as const,
    manifestPhase: "billing_accounts",
    label: "Phase 5 — Billing/Balances",
    requires: "billingImport",
    prior: "billing_match",
  },
];

export default function DaSilvaMigrationPanel({ schoolId, disabled, onNotice }: Props) {
  const [projectId, setProjectId] = useState("");
  const [busy, setBusy] = useState(false);
  const [phasesCompleted, setPhasesCompleted] = useState<string[]>([]);
  const [manifestDebug, setManifestDebug] = useState<DaSilvaManifestDebugReport | null>(null);
  const [savedAudit, setSavedAudit] = useState<DaSilvaSavedFilesAuditRow[]>([]);
  const [slots, setSlots] = useState<DaSilvaFileSlots>({
    classListFiles: [],
    learnerRegister: null,
    parentLearnerLinks: null,
    parentRegister: null,
    billingPlan: null,
    ageAnalysis: null,
    transactions: null,
    contactList: null,
    employeeContactList: null,
  });
  const [previews, setPreviews] = useState<DaSilvaWizardPreviews>({
    sasamsClassesLearners: null,
    sasamsParentsLinks: null,
    kideesysBillingMatch: null,
    billingImport: null,
  });

  const canUpload = Boolean(schoolId) && slotsSatisfyUpload(slots);
  const manifestReady = allDaSilvaManifestSlotsGreen(manifestDebug);
  const validationPassed = allDaSilvaPreviewsPassed(previews);

  const refreshStatus = useCallback(async () => {
    if (!schoolId || !projectId) return;
    try {
      const status = await fetchDaSilvaProjectStatus(schoolId, projectId);
      setPhasesCompleted(status.phasesCompleted || []);
    } catch {
      /* ignore */
    }
  }, [schoolId, projectId]);

  const refreshManifestDebug = useCallback(async () => {
    if (!schoolId || !projectId) return;
    try {
      const report = await fetchDaSilvaManifestDebug(schoolId, projectId);
      setManifestDebug(report);
      setSavedAudit(buildSavedFilesAuditRows(report));
    } catch {
      setManifestDebug(null);
      setSavedAudit([]);
    }
  }, [schoolId, projectId]);

  useEffect(() => {
    void refreshStatus();
    void refreshManifestDebug();
  }, [refreshStatus, refreshManifestDebug]);

  const ensureProject = useCallback(async (): Promise<string> => {
    if (projectId) return projectId;
    const pid = await createDaSilvaProject(schoolId);
    setProjectId(pid);
    return pid;
  }, [projectId, schoolId]);

  const runUpload = useCallback(async () => {
    if (!canUpload || !schoolId) return;
    setBusy(true);
    setPreviews({
      sasamsClassesLearners: null,
      sasamsParentsLinks: null,
      kideesysBillingMatch: null,
      billingImport: null,
    });
    try {
      const pid = await ensureProject();
      const result = await uploadDaSilvaStagingFiles({ schoolId, projectId: pid, slots });
      setProjectId(result.projectId);
      const report = await fetchDaSilvaManifestDebug(schoolId, result.projectId);
      setManifestDebug(report);
      setSavedAudit(buildSavedFilesAuditRows(report));
      onNotice({
        title: result.manifestReady ? "Upload complete — manifest ready" : "Upload saved — manifest incomplete",
        message: result.manifestWritten
          ? `manifest.json written at ${result.manifestPath}`
          : "Upload finished but manifest was not written",
        details: result.manifestErrors.length
          ? result.manifestErrors.join("\n")
          : `${result.filesSaved.length} file(s) saved · ${result.classListsSaved} class list(s)`,
      });
    } catch (e: unknown) {
      onNotice({
        title: "Upload failed",
        message: e instanceof Error ? e.message : "Upload failed",
      });
    } finally {
      setBusy(false);
    }
  }, [canUpload, schoolId, slots, ensureProject, onNotice]);

  const runValidation = useCallback(async () => {
    if (!schoolId || !projectId || !manifestReady) return;
    setBusy(true);
    setPreviews({
      sasamsClassesLearners: null,
      sasamsParentsLinks: null,
      kideesysBillingMatch: null,
      billingImport: null,
    });
    try {
      const result = await runAllDaSilvaPreviews({ schoolId, projectId });
      setPreviews(result);
      const passed = allDaSilvaPreviewsPassed(result);
      onNotice({
        title: passed ? "Validation passed" : "Validation blocked",
        message: passed
          ? "All staged previews passed. You may run phased imports in order."
          : "Fix blocking issues before importing. No data was written to the live school.",
        details: formatDaSilvaWizardReport(result),
      });
    } catch (e: unknown) {
      onNotice({
        title: "Validation failed",
        message: e instanceof Error ? e.message : "Preview failed",
      });
    } finally {
      setBusy(false);
    }
  }, [schoolId, projectId, manifestReady, onNotice]);

  const runPhaseImport = useCallback(
    async (phase: (typeof IMPORT_PHASES)[number]["id"]) => {
      if (!schoolId || !projectId || !validationPassed) return;
      setBusy(true);
      try {
        const result = await importDaSilvaPhase(phase, { schoolId, projectId });
        await refreshStatus();
        onNotice({
          title: `${phase} import complete`,
          message: "Phase completed successfully.",
          details: JSON.stringify(result, null, 2),
        });
      } catch (e: unknown) {
        onNotice({
          title: "Import failed",
          message: e instanceof Error ? e.message : "Import failed",
        });
      } finally {
        setBusy(false);
      }
    },
    [schoolId, projectId, validationPassed, refreshStatus, onNotice]
  );

  const runRollback = useCallback(async () => {
    if (!projectId || !schoolId) return;
    setBusy(true);
    try {
      const result = await rollbackDaSilvaImport({ schoolId, projectId });
      setPhasesCompleted([]);
      onNotice({
        title: "Rollback complete",
        message: "Da Silva import batch rolled back.",
        details: JSON.stringify(result, null, 2),
      });
    } catch (e: unknown) {
      onNotice({
        title: "Rollback failed",
        message: e instanceof Error ? e.message : "Rollback failed",
      });
    } finally {
      setBusy(false);
    }
  }, [projectId, schoolId, onNotice]);

  const phaseEnabled = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const phase of IMPORT_PHASES) {
      const previewKey = phase.requires as keyof DaSilvaWizardPreviews;
      const previewOk = previews[previewKey]?.passed === true;
      const priorOk = !phase.prior || phasesCompleted.includes(phase.prior);
      map[phase.id] = validationPassed && previewOk && priorOk;
    }
    return map;
  }, [previews, phasesCompleted, validationPassed]);

  return (
    <section className="sa-migration-dasilva">
      <h2 className="sa-migration-section-title">SA-SAMS + Kid-e-Sys — Da Silva Academy</h2>
      <p className="sa-migration-subtitle">
        Upload all exports to migration staging. Validation runs only after manifest.json confirms every
        required file is saved and readable.
      </p>

      {projectId ? (
        <p className="sa-migration-subtitle" style={{ marginTop: 0 }}>
          Project: <code>{projectId}</code>
          {manifestDebug?.manifestPath ? (
            <>
              {" "}
              · Manifest: <code>{manifestDebug.manifestPath}</code>
            </>
          ) : null}
          {phasesCompleted.length > 0 ? ` · Completed: ${phasesCompleted.join(", ")}` : null}
        </p>
      ) : null}

      <div className="sa-migration-dasilva-slots">
        <label className="sa-migration-dasilva-slot sa-migration-dasilva-slot--wide">
          <span>1. SA-SAMS class lists (20 .xls files — Crèche excluded)</span>
          <input
            type="file"
            accept=".xls,.xlsx"
            multiple
            disabled={disabled || busy}
            onChange={(e) =>
              setSlots((s) => ({
                ...s,
                classListFiles: Array.from(e.target.files || []),
              }))
            }
          />
          {slots.classListFiles.length > 0 ? (
            <small>{slots.classListFiles.length} class file(s) selected</small>
          ) : null}
        </label>

        {UPLOAD_SLOTS.map(({ key, label, accept }) => (
          <label key={key} className="sa-migration-dasilva-slot">
            <span>{label}</span>
            <input
              type="file"
              accept={accept}
              disabled={disabled || busy}
              onChange={(e) => {
                const file = e.target.files?.[0] || null;
                setSlots((s) => ({ ...s, [key]: file }));
              }}
            />
            {slots[key] ? <small>{slots[key]!.name}</small> : null}
          </label>
        ))}
      </div>

      <div className="sa-migration-dasilva-actions">
        <button
          type="button"
          className="sa-migration-btn sa-migration-btn--gold"
          disabled={!canUpload || disabled || busy}
          onClick={() => void runUpload()}
        >
          {busy ? "Working…" : "Upload to staging"}
        </button>
        <button
          type="button"
          className="sa-migration-btn sa-migration-btn--gold"
          disabled={!manifestReady || !projectId || disabled || busy}
          onClick={() => void runValidation()}
        >
          Run validation
        </button>
        {projectId ? (
          <button
            type="button"
            className="sa-migration-btn"
            disabled={disabled || busy}
            onClick={() => void runRollback()}
          >
            Rollback import
          </button>
        ) : null}
      </div>

      {savedAudit.length > 0 ? (
        <div className="sa-migration-dasilva-validation">
          <h3 className="sa-migration-dasilva-phase-title">Saved Files Audit</h3>
          <p className="sa-migration-subtitle">
            Class lists: {manifestDebug?.classListsCount ?? 0} · filesSaved:{" "}
            {manifestDebug?.filesSavedCount ?? 0}
            {manifestReady ? " · all slots green" : " · fix red slots before validation"}
          </p>
          <ul className="sa-migration-dasilva-checklist">
            {savedAudit.map((row) => (
              <li key={row.slot} className={row.ok ? "ok" : "fail"}>
                {row.label}
                {row.filename ? ` — ${row.filename}` : ""}
                {row.path ? (
                  <>
                    {" "}
                    <code style={{ fontSize: "0.85em" }}>{row.path}</code>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
          {manifestDebug?.manifestErrors?.length ? (
            <pre className="sa-migration-dasilva-report">
              {manifestDebug.manifestErrors.join("\n")}
            </pre>
          ) : null}
        </div>
      ) : null}

      {previews.sasamsClassesLearners ? (
        <div className="sa-migration-dasilva-validation">
          <h3 className="sa-migration-dasilva-phase-title">Validation summary</h3>
          <ul className="sa-migration-dasilva-checklist">
            <li className={previews.sasamsClassesLearners.passed ? "ok" : "fail"}>
              SA-SAMS classes/learners — {previews.sasamsClassesLearners.sasamsClassListLearners ?? previews.sasamsClassesLearners.totalLearners} accepted
              (expected {previews.sasamsClassesLearners.expectedSasamsLearners ?? 388})
              · Crèche supplement {previews.sasamsClassesLearners.crecheSupplementExpected ?? 8} →{" "}
              {previews.sasamsClassesLearners.finalLearnersExpected ?? 396} total
              · missing ID {previews.sasamsClassesLearners.missingId}, DOB{" "}
              {previews.sasamsClassesLearners.missingDob}, gender{" "}
              {previews.sasamsClassesLearners.missingGender}
            </li>
            <li className={previews.sasamsParentsLinks?.passed ? "ok" : "fail"}>
              Parent-link matches — {previews.sasamsParentsLinks?.matchedLinks ?? 0}/
              {previews.sasamsParentsLinks?.expectedParentLinks ?? 653}
            </li>
            <li className={previews.kideesysBillingMatch?.passed ? "ok" : "fail"}>
              Kid-e-Sys billing match — {previews.kideesysBillingMatch?.matchedAccounts ?? 0}/
              {previews.kideesysBillingMatch?.totalAccounts ?? 0}
            </li>
            <li className={previews.billingImport?.passed ? "ok" : "fail"}>
              Billing import preview — {previews.billingImport?.transactionRowCount ?? 0} transactions
            </li>
          </ul>
          <pre className="sa-migration-dasilva-report">{formatDaSilvaWizardReport(previews)}</pre>
        </div>
      ) : null}

      <div className="sa-migration-dasilva-phases">
        <h3 className="sa-migration-dasilva-phase-title">Phased import</h3>
        <p className="sa-migration-subtitle">
          Imports are disabled until Saved Files Audit is all green and validation previews pass.
        </p>
        <div className="sa-migration-dasilva-actions">
          {IMPORT_PHASES.map((phase) => (
            <button
              key={phase.id}
              type="button"
              className="sa-migration-btn sa-migration-btn--gold"
              disabled={!phaseEnabled[phase.id] || disabled || busy || !projectId}
              onClick={() => void runPhaseImport(phase.id)}
            >
              {phase.label}
              {phasesCompleted.includes(phase.manifestPhase) ? " ✓" : ""}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
