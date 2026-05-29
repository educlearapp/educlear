import { useCallback, useRef, useState } from "react";
import {
  applyMigrationLearnerRepair,
  previewMigrationLearnerRepair,
} from "../../migration/migrationCentreApi";
import type {
  MigrationLearnerRepairPreview,
  MigrationToolStatus,
} from "../../migration/types/migrationCentre";

const ACCEPT = ".xls,.xlsx,.csv";

type Props = {
  schoolId: string;
  onBack: () => void;
};

export default function MigrationCentreLearnerRepairPanel({ schoolId, onBack }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<MigrationLearnerRepairPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [status, setStatus] = useState<MigrationToolStatus>({
    phase: "idle",
    message: "Upload SA-SAMS class list or learner register and run preview.",
  });

  const runPreview = useCallback(async () => {
    if (!schoolId || !file) return;
    setBusy(true);
    setConfirmed(false);
    setStatus({ phase: "idle", message: "Running preview…" });
    try {
      const result = await previewMigrationLearnerRepair({ schoolId, file });
      setPreview(result);
      setStatus({
        phase: "previewed",
        message: `Preview ready — ${result.counts.genderFixes} gender, ${result.counts.classroomFixes} classroom, ${result.counts.idFixes} ID update(s). Boys ${result.counts.boysBefore}→${result.counts.boysAfter}, Girls ${result.counts.girlsBefore}→${result.counts.girlsAfter}.`,
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
    if (!preview?.sessionId || !confirmed) return;
    setBusy(true);
    try {
      const result = await applyMigrationLearnerRepair({
        schoolId,
        sessionId: preview.sessionId,
      });
      setStatus({
        phase: "applied",
        message: `Updated ${result.learnersUpdated} learner(s) from ${result.fileName}. No learners were deleted.`,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Apply failed";
      setStatus({ phase: "error", message: msg });
    } finally {
      setBusy(false);
    }
  }, [preview, schoolId, confirmed]);

  const summary = preview
    ? [
        { label: "Gender fixes", value: preview.counts.genderFixes },
        { label: "Classroom fixes", value: preview.counts.classroomFixes },
        { label: "ID fixes", value: preview.counts.idFixes },
        { label: "Matched", value: preview.counts.matched },
        { label: "Unmatched", value: preview.counts.unmatched },
        { label: "Boys", value: `${preview.counts.boysBefore} → ${preview.counts.boysAfter}` },
        { label: "Girls", value: `${preview.counts.girlsBefore} → ${preview.counts.girlsAfter}` },
      ]
    : [];

  return (
    <div className="migration-centre-page">
      <div className="migration-centre-back">
        <button type="button" className="migration-centre-btn migration-centre-btn--outline" onClick={onBack}>
          ← Migration Centre
        </button>
      </div>

      <header className="migration-centre-header">
        <h1 className="page-title">Learner / Gender Repair</h1>
        <p className="migration-centre-subtitle">
          Upload SA-SAMS learner or class list exports to repair gender, ID number, and classroom on live
          learners. Optional fields are filled only when empty. Learners are never deleted.
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
            setConfirmed(false);
            setStatus({
              phase: picked ? "ready" : "idle",
              message: picked ? `Selected ${picked.name}` : "Choose a file to upload.",
            });
          }}
        />
        <p className="migration-centre-dropzone-title">
          {file ? file.name : "Upload class list or learner register (.xls, .xlsx, .csv)"}
        </p>
        <p className="migration-centre-dropzone-hint">SA-SAMS export — one file per preview</p>
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
          {busy ? "Previewing…" : "Preview"}
        </button>
        <button
          type="button"
          className="migration-centre-btn migration-centre-btn--dark"
          disabled={!preview?.canApply || !confirmed || busy || status.phase === "applied"}
          onClick={() => void runApply()}
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
              Match order: ID number → admission number → name + surname → classroom.
            </p>
            <div className="migration-centre-table-wrap">
              <div className="migration-centre-table-scroll">
                <table className="migration-centre-table">
                  <thead>
                    <tr>
                      <th>Learner</th>
                      <th>Current gender</th>
                      <th>Imported gender</th>
                      <th>Current classroom</th>
                      <th>Imported classroom</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row) => (
                      <tr key={row.importKey}>
                        <td>
                          {row.learnerLabel}
                          {row.matchedLearnerName ? (
                            <div style={{ fontSize: "0.72rem", color: "#64748b" }}>
                              → {row.matchedLearnerName}
                            </div>
                          ) : null}
                        </td>
                        <td>{row.currentGender || "—"}</td>
                        <td>{row.importedGender || "—"}</td>
                        <td>{row.currentClassroom || "—"}</td>
                        <td>{row.importedClassroom || "—"}</td>
                        <td>{row.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {preview.unmatched.length > 0 ? (
            <section className="migration-centre-section">
              <h2 className="migration-centre-section-title">Unmatched ({preview.counts.unmatched})</h2>
              <div className="migration-centre-table-wrap">
                <div className="migration-centre-table-scroll">
                  <table className="migration-centre-table">
                    <thead>
                      <tr>
                        <th>Learner</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.unmatched.map((row) => (
                        <tr key={row.importKey}>
                          <td>{row.learnerLabel}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          ) : null}

          <div className="migration-centre-confirm">
            <label>
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              <span>
                I confirm applying updates to matched learners only (gender, ID number, classroom, and
                missing optional fields). No learners will be deleted.
              </span>
            </label>
          </div>
        </>
      ) : null}
    </div>
  );
}
