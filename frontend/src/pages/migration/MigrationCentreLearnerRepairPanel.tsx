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

function fileKey(file: File): string {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

export default function MigrationCentreLearnerRepairPanel({ schoolId, onBack }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [preview, setPreview] = useState<MigrationLearnerRepairPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<ModalState>(null);
  const [status, setStatus] = useState<MigrationToolStatus>({
    phase: "idle",
    message:
      "Upload all SA-SAMS class lists (.csv, .xls, .xlsx) — one file per class — then run preview.",
  });

  const addFiles = useCallback((incoming: FileList | File[]) => {
    const list = Array.from(incoming);
    if (!list.length) return;
    setFiles((prev) => {
      const seen = new Set(prev.map(fileKey));
      const next = [...prev];
      for (const file of list) {
        const key = fileKey(file);
        if (seen.has(key)) continue;
        seen.add(key);
        next.push(file);
      }
      return next;
    });
    setPreview(null);
    setModal(null);
    setStatus({
      phase: "ready",
      message: `${list.length} file(s) added — select Preview when ready.`,
    });
  }, []);

  const removeFile = useCallback((key: string) => {
    setFiles((prev) => {
      const next = prev.filter((f) => fileKey(f) !== key);
      setPreview(null);
      setModal(null);
      setStatus({
        phase: next.length ? "ready" : "idle",
        message: next.length
          ? `${next.length} file(s) selected`
          : "Upload all SA-SAMS class lists (.csv, .xls, .xlsx) — one file per class.",
      });
      return next;
    });
  }, []);

  const clearFiles = useCallback(() => {
    setFiles([]);
    setPreview(null);
    setModal(null);
    setStatus({
      phase: "idle",
      message:
        "Upload all SA-SAMS class lists (.csv, .xls, .xlsx) — one file per class — then run preview.",
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const runPreview = useCallback(async () => {
    if (!schoolId || !files.length) return;
    setBusy(true);
    setModal(null);
    setStatus({ phase: "idle", message: "Running preview…" });
    try {
      const result = await previewMigrationLearnerRepair({ schoolId, files });
      setPreview(result);
      setStatus({
        phase: "previewed",
        message: `Preview ready — ${result.counts.rawRowsParsed ?? result.counts.totalRows} rows parsed (${result.counts.totalRows} unique) from ${result.filesUploaded} file(s); ${result.counts.updatesToApply} update(s) to apply. Boys ${result.counts.boysBefore}→${result.counts.boysAfter}, Girls ${result.counts.girlsBefore}→${result.counts.girlsAfter}.`,
      });
    } catch (e: unknown) {
      setPreview(null);
      const msg = e instanceof Error ? e.message : "Preview failed";
      setStatus({ phase: "error", message: msg });
    } finally {
      setBusy(false);
    }
  }, [schoolId, files]);

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
        message: `Learner repair completed — ${result.updatedLearners} learner(s) updated.`,
      });
      setModal({ kind: "success", result });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Apply failed";
      setStatus({ phase: "error", message: msg });
    } finally {
      setBusy(false);
    }
  }, [preview, schoolId]);

  const displayFileNames = preview?.fileNames?.length
    ? preview.fileNames
    : files.map((f) => f.name);

  const summary = preview
    ? [
        { label: "Files uploaded", value: preview.filesUploaded },
        {
          label: "Rows parsed",
          value: preview.counts.rawRowsParsed ?? preview.counts.totalRows,
        },
        { label: "Unique learners", value: preview.counts.totalRows },
        { label: "Matched", value: preview.counts.matched },
        { label: "Ambiguous", value: preview.counts.ambiguous },
        { label: "No match", value: preview.counts.noMatch },
        { label: "Boys detected", value: preview.counts.boysDetected },
        { label: "Girls detected", value: preview.counts.girlsDetected },
        { label: "Updates to apply", value: preview.counts.updatesToApply },
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
          Upload every SA-SAMS class list (one file per class) to repair missing gender, blank SA ID
          numbers, and wrong classes on live learners. Preview every row before apply — only{" "}
          <strong>gender</strong>, <strong>ID number</strong> (when blank), and{" "}
          <strong>class</strong> (when blank or clearly wrong) are written. Statements, payments,
          invoices, billing plans, family accounts, and balances are never modified.
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
          multiple
          className="migration-centre-file-input"
          onChange={(e) => {
            if (e.target.files?.length) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <p className="migration-centre-dropzone-title">
          {files.length
            ? `${files.length} file(s) selected`
            : "Upload all SA-SAMS class lists (.csv, .xls, .xlsx)"}
        </p>
        <p className="migration-centre-dropzone-hint">
          Multi-select enabled — one export per class. Match: SA ID → admission → name + class →
          name. Duplicates across files are merged automatically.
        </p>
      </div>

      {files.length > 0 ? (
        <section className="migration-centre-section" style={{ marginTop: 12 }}>
          <div className="migration-centre-card-actions" style={{ marginBottom: 8 }}>
            <h2 className="migration-centre-section-title" style={{ margin: 0, flex: 1 }}>
              Selected files ({files.length})
            </h2>
            <button
              type="button"
              className="migration-centre-btn migration-centre-btn--outline"
              disabled={busy}
              onClick={clearFiles}
            >
              Clear all
            </button>
          </div>
          <ul className="migration-centre-file-list">
            {files.map((file) => {
              const key = fileKey(file);
              return (
                <li key={key} className="migration-centre-file-list-item">
                  <span>{file.name}</span>
                  <button
                    type="button"
                    className="migration-centre-btn migration-centre-btn--outline"
                    disabled={busy}
                    onClick={() => removeFile(key)}
                  >
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <div className="migration-centre-card-actions" style={{ marginTop: 12 }}>
        <button
          type="button"
          className="migration-centre-btn migration-centre-btn--outline"
          disabled={busy}
          onClick={() => fileInputRef.current?.click()}
        >
          Add files
        </button>
        <button
          type="button"
          className="migration-centre-btn migration-centre-btn--gold"
          disabled={!files.length || busy}
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
          {displayFileNames.length > 0 ? (
            <section className="migration-centre-section">
              <h2 className="migration-centre-section-title">Uploaded files</h2>
              <ul className="migration-centre-file-list">
                {displayFileNames.map((name) => (
                  <li key={name} className="migration-centre-file-list-item">
                    <span>{name}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

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
              Showing up to {preview.rows.length} rows from {preview.counts.totalRows} unique
              learner(s) (
              {preview.counts.rawRowsParsed ?? preview.counts.totalRows} rows parsed across files).
              Match order: SA ID number → admission number → first + surname + classroom →
              first + surname. Existing Male/Female is not overwritten by blank imports.
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

          {preview.counts.updatesToApply > 0 ? (
            <p className="migration-centre-section-hint" style={{ marginTop: 8 }}>
              {preview.counts.updatesToApply} matched learner(s) will be updated (
              {preview.counts.genderUpdates} gender
              {preview.counts.idNumberUpdates > 0
                ? `, ${preview.counts.idNumberUpdates} ID`
                : ""}
              {preview.counts.classUpdates > 0 ? `, ${preview.counts.classUpdates} class` : ""}
              ) when you apply.
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
              Confirm learner repair
            </h2>
            <p className="migration-centre-modal-message">
              This will update matched learners only (gender, blank SA ID, class when blank or
              wrong). No financial or billing data will be modified.
            </p>
            <p className="migration-centre-modal-message">
              Apply {preview?.counts.updatesToApply ?? 0} update(s) across{" "}
              {preview?.filesUploaded ?? 0} file(s)?
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
              Learner repair completed
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
