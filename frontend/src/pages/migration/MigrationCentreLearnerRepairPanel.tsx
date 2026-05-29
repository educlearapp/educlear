import { useCallback, useRef, useState } from "react";
import {
  applyMigrationLearnerRepair,
  previewMigrationLearnerRepair,
} from "../../migration/migrationCentreApi";
import type {
  MigrationLearnerRepairApplyResult,
  MigrationLearnerRepairPreview,
  MigrationToolStatus,
} from "../../migration/types/migrationCentre";

const ACCEPT = ".xls,.xlsx,.csv";

type Props = {
  schoolId: string;
  onBack: () => void;
};

type ModalState =
  | { kind: "confirm-apply" }
  | { kind: "success"; result: MigrationLearnerRepairApplyResult }
  | null;

export default function MigrationCentreLearnerRepairPanel({ schoolId, onBack }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<MigrationLearnerRepairPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<ModalState>(null);
  const [status, setStatus] = useState<MigrationToolStatus>({
    phase: "idle",
    message:
      "Upload SASAMS learner export or class list (.csv, .xls, .xlsx) and run preview.",
  });

  const runPreview = useCallback(async () => {
    if (!schoolId || !file) return;
    setBusy(true);
    setModal(null);
    setStatus({ phase: "idle", message: "Running preview…" });
    try {
      const result = await previewMigrationLearnerRepair({ schoolId, file });
      setPreview(result);
      setStatus({
        phase: "previewed",
        message: `Preview ready — ${result.counts.genderUpdates} gender update(s). Boys ${result.counts.boysBefore}→${result.counts.boysAfter}, Girls ${result.counts.girlsBefore}→${result.counts.girlsAfter}.`,
      });
    } catch (e: unknown) {
      setPreview(null);
      const msg = e instanceof Error ? e.message : "Preview failed";
      setStatus({ phase: "error", message: msg });
    } finally {
      setBusy(false);
    }
  }, [schoolId, file]);

  const runApply = useCallback(async () => {
    if (!preview?.sessionId) return;
    setBusy(true);
    setModal(null);
    try {
      const result = await applyMigrationLearnerRepair({
        schoolId,
        sessionId: preview.sessionId,
      });
      setStatus({
        phase: "applied",
        message: `Gender repair completed — ${result.updatedLearners} learner(s) updated.`,
      });
      setModal({ kind: "success", result });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Apply failed";
      setStatus({ phase: "error", message: msg });
    } finally {
      setBusy(false);
    }
  }, [preview, schoolId]);

  const summary = preview
    ? [
        { label: "Total rows", value: preview.counts.totalRows },
        { label: "Matched", value: preview.counts.matched },
        { label: "Ambiguous", value: preview.counts.ambiguous },
        { label: "No match", value: preview.counts.noMatch },
        { label: "Boys detected", value: preview.counts.boysDetected },
        { label: "Girls detected", value: preview.counts.girlsDetected },
        {
          label: "Dashboard (after)",
          value: `${preview.counts.boysAfter} boys · ${preview.counts.girlsAfter} girls`,
        },
      ]
    : [];

  return (
    <div className="migration-centre-page">
      <div className="migration-centre-back">
        <button
          type="button"
          className="migration-centre-btn migration-centre-btn--outline"
          onClick={onBack}
        >
          ← Universal Migration Center
        </button>
      </div>

      <header className="migration-centre-header">
        <h1 className="page-title">Learner Repair / Gender Repair</h1>
        <p className="migration-centre-subtitle">
          Upload SASAMS learner exports or class lists to repair missing gender on live learners.
          Preview every row before apply — only <strong>Learner.gender</strong> is written. Statements,
          payments, invoices, billing plans, family accounts, and balances are never modified.
        </p>
      </header>

      <div
        className="migration-centre-dropzone"
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
        role="button"
        tabIndex={0}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT}
          className="migration-centre-file-input"
          onChange={(e) => {
            const picked = e.target.files?.[0] || null;
            setFile(picked);
            setPreview(null);
            setModal(null);
            setStatus({
              phase: picked ? "ready" : "idle",
              message: picked ? `Selected ${picked.name}` : "Choose a file to upload.",
            });
          }}
        />
        <p className="migration-centre-dropzone-title">
          {file ? file.name : "Upload SASAMS or class list (.csv, .xls, .xlsx)"}
        </p>
        <p className="migration-centre-dropzone-hint">
          Gender columns: Gender, Sex, gender, sex — match: SA ID → admission → name + class → name
        </p>
      </div>

      <div className="migration-centre-card-actions" style={{ marginTop: 12 }}>
        <button
          type="button"
          className="migration-centre-btn migration-centre-btn--outline"
          disabled={!file}
          onClick={() => fileInputRef.current?.click()}
        >
          Upload
        </button>
        <button
          type="button"
          className="migration-centre-btn migration-centre-btn--gold"
          disabled={!file || busy}
          onClick={() => void runPreview()}
        >
          {busy && !modal ? "Previewing…" : "Preview"}
        </button>
        <button
          type="button"
          className="migration-centre-btn migration-centre-btn--dark"
          disabled={!preview?.canApply || busy || status.phase === "applied"}
          onClick={() => setModal({ kind: "confirm-apply" })}
        >
          Apply
        </button>
      </div>

      <p
        className={`migration-centre-status${
          status.phase === "error"
            ? " migration-centre-status--error"
            : status.phase === "applied"
              ? " migration-centre-status--success"
              : ""
        }`}
        role="status"
      >
        {status.message}
      </p>

      {preview ? (
        <>
          <div className="migration-centre-summary-grid">
            {summary.map((card) => (
              <div key={card.label} className="migration-centre-summary-card">
                <p className="migration-centre-summary-label">{card.label}</p>
                <p className="migration-centre-summary-value">{card.value}</p>
              </div>
            ))}
          </div>

          <section className="migration-centre-section">
            <h2 className="migration-centre-section-title">Preview</h2>
            <p className="migration-centre-section-hint">
              Showing up to {preview.rows.length} rows. Match order: SA ID number → admission number →
              first + surname + classroom → first + surname. Existing Male/Female is not overwritten by
              blank imports.
            </p>
            <div className="migration-centre-table-wrap">
              <div className="migration-centre-table-scroll">
                <table className="migration-centre-table">
                  <thead>
                    <tr>
                      <th>Current learner</th>
                      <th>Imported learner</th>
                      <th>Class</th>
                      <th>Current gender</th>
                      <th>Imported gender</th>
                      <th>Match type</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row) => (
                      <tr key={row.importKey}>
                        <td>{row.currentLearnerName || "—"}</td>
                        <td>{row.importedLearnerLabel}</td>
                        <td>{row.importedClass || "—"}</td>
                        <td>{row.currentGender || "—"}</td>
                        <td>{row.importedGender || "—"}</td>
                        <td>{row.matchType}</td>
                        <td>{row.action}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {preview.counts.genderUpdates > 0 ? (
            <p className="migration-centre-section-hint" style={{ marginTop: 8 }}>
              {preview.counts.genderUpdates} learner(s) will receive a gender update when you apply.
            </p>
          ) : null}
        </>
      ) : null}

      {modal?.kind === "confirm-apply" ? (
        <div
          className="migration-centre-modal-overlay"
          role="presentation"
          onClick={() => setModal(null)}
        >
          <div
            className="migration-centre-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="migration-centre-confirm-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="migration-centre-modal-accent" aria-hidden="true" />
            <h2 id="migration-centre-confirm-title" className="migration-centre-modal-title">
              Confirm gender repair
            </h2>
            <p className="migration-centre-modal-message">
              This will update learner gender information only. No financial or billing data will be
              modified.
            </p>
            <p className="migration-centre-modal-message">
              Apply {preview?.counts.genderUpdates ?? 0} gender update(s) to matched learners?
            </p>
            <div className="migration-centre-modal-actions">
              <button
                type="button"
                className="migration-centre-btn migration-centre-btn--outline"
                onClick={() => setModal(null)}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="migration-centre-btn migration-centre-btn--gold"
                disabled={busy}
                onClick={() => void runApply()}
              >
                {busy ? "Applying…" : "Confirm apply"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {modal?.kind === "success" ? (
        <div
          className="migration-centre-modal-overlay"
          role="presentation"
          onClick={() => setModal(null)}
        >
          <div
            className="migration-centre-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="migration-centre-success-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="migration-centre-modal-accent" aria-hidden="true" />
            <h2 id="migration-centre-success-title" className="migration-centre-modal-title">
              Gender repair completed
            </h2>
            <ul className="migration-centre-modal-stats">
              <li>
                <span>Updated learners</span>
                <strong>{modal.result.updatedLearners}</strong>
              </li>
              <li>
                <span>Boys (live)</span>
                <strong>{modal.result.boys}</strong>
              </li>
              <li>
                <span>Girls (live)</span>
                <strong>{modal.result.girls}</strong>
              </li>
              <li>
                <span>Skipped</span>
                <strong>{modal.result.skipped}</strong>
              </li>
              <li>
                <span>Ambiguous</span>
                <strong>{modal.result.ambiguous}</strong>
              </li>
            </ul>
            <p className="migration-centre-modal-message">
              Refresh the school dashboard to see updated boys/girls counts from live learner records.
            </p>
            <div className="migration-centre-modal-actions">
              <button
                type="button"
                className="migration-centre-btn migration-centre-btn--gold"
                onClick={() => setModal(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
