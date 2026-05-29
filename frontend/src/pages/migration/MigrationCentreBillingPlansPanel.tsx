import { useCallback, useRef, useState } from "react";
import {
  applyMigrationBillingPlans,
  formatMigrationMoney,
  previewMigrationBillingPlans,
} from "../../migration/migrationCentreApi";
import type {
  MigrationBillingPlansPreview,
  MigrationToolStatus,
} from "../../migration/types/migrationCentre";

const ACCEPT = ".xls,.xlsx,.csv";

type Props = {
  schoolId: string;
  onBack: () => void;
};

export default function MigrationCentreBillingPlansPanel({ schoolId, onBack }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<MigrationBillingPlansPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [status, setStatus] = useState<MigrationToolStatus>({
    phase: "idle",
    message: "Upload Kid-e-Sys billing_plan_summary_by_child and run preview.",
  });

  const runPreview = useCallback(async () => {
    if (!schoolId || !file) return;
    setBusy(true);
    setConfirmed(false);
    setStatus({ phase: "idle", message: "Running preview…" });
    try {
      const result = await previewMigrationBillingPlans({ schoolId, file });
      setPreview(result);
      setStatus({
        phase: "previewed",
        message: `Preview ready — ${result.counts.matched} matched, ${result.counts.unmatched} unmatched, ${result.counts.learnersWithoutPlan} live learners without a plan in file.`,
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
      const result = await applyMigrationBillingPlans({
        schoolId,
        sessionId: preview.sessionId,
      });
      setStatus({
        phase: "applied",
        message: `Applied ${result.learnersUpdated} billing plan(s) from ${result.fileName}. Statements, payments, invoices, and balances were not changed.`,
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
        { label: "Matched", value: preview.counts.matched },
        { label: "Unmatched", value: preview.counts.unmatched },
        { label: "No plan in file", value: preview.counts.learnersWithoutPlan },
        { label: "Plans to write", value: preview.counts.plansToWrite },
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
        <h1 className="page-title">Billing Plans Import</h1>
        <p className="migration-centre-subtitle">
          Upload Kid-e-Sys Billing Plan Summary and apply fee lines to matched live learners only. Existing
          plans for learners not in the file stay unchanged.
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
          {file ? file.name : "Upload billing plan (.xls, .xlsx, .csv)"}
        </p>
        <p className="migration-centre-dropzone-hint">billing_plan_summary_by_child</p>
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

          {preview.amountExamples.length > 0 ? (
            <section className="migration-centre-section">
              <h2 className="migration-centre-section-title">Amount examples</h2>
              <div className="migration-centre-table-wrap">
                <div className="migration-centre-table-scroll">
                  <table className="migration-centre-table">
                    <thead>
                      <tr>
                        <th>Learner</th>
                        <th>Class</th>
                        <th>Fee description</th>
                        <th>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.amountExamples.flatMap((row) =>
                        row.fees.slice(0, 2).map((fee) => (
                          <tr key={`${row.fullName}-${fee.feeDescription}`}>
                            <td>{row.fullName}</td>
                            <td>{row.className}</td>
                            <td>{fee.feeDescription}</td>
                            <td>{formatMigrationMoney(fee.amount)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          ) : null}

          <section className="migration-centre-section">
            <h2 className="migration-centre-section-title">Preview</h2>
            <p className="migration-centre-section-hint">
              Showing up to {preview.rows.length} rows. Match order: ID number → admission number → name +
              surname → classroom.
            </p>
            <div className="migration-centre-table-wrap">
              <div className="migration-centre-table-scroll">
                <table className="migration-centre-table">
                  <thead>
                    <tr>
                      <th>Learner</th>
                      <th>Matched learner</th>
                      <th>Fee description</th>
                      <th>Amount</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row) => {
                      const primaryFee = row.fees[0];
                      return (
                        <tr key={row.billingMatchKey}>
                          <td>
                            {row.fullName}
                            <div style={{ fontSize: "0.72rem", color: "#64748b" }}>{row.className}</div>
                          </td>
                          <td>{row.learnerName || "—"}</td>
                          <td>
                            {primaryFee?.feeDescription || "—"}
                            {row.feeLineCount > 1 ? ` (+${row.feeLineCount - 1})` : ""}
                          </td>
                          <td>{formatMigrationMoney(row.totalAmount)}</td>
                          <td>{row.status}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <div className="migration-centre-confirm">
            <label>
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              <span>
                I confirm applying {preview.counts.plansToWrite} billing plan(s). Only matched learners
                are updated; statements, payments, invoices, ledger, opening balances, and family accounts
                are not touched.
              </span>
            </label>
          </div>
        </>
      ) : null}
    </div>
  );
}
