import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyMigrationTopupPayments,
  formatMigrationMoney,
  listMigrationTopupPaymentBatches,
  previewMigrationTopupPayments,
} from "../../migration/migrationCentreApi";
import type {
  MigrationToolStatus,
  MigrationTopupPaymentBatchSummary,
  MigrationTopupPaymentsApplyResult,
  MigrationTopupPaymentsPreview,
} from "../../migration/types/migrationCentre";

const ACCEPT = ".xls,.xlsx,.csv";

type Props = {
  schoolId: string;
  onBack: () => void;
};

export default function MigrationCentreTopupPaymentsPanel({ schoolId, onBack }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<MigrationTopupPaymentsPreview | null>(null);
  const [applyResult, setApplyResult] = useState<MigrationTopupPaymentsApplyResult | null>(null);
  const [batches, setBatches] = useState<MigrationTopupPaymentBatchSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [status, setStatus] = useState<MigrationToolStatus>({
    phase: "idle",
    message: "Upload Kid-e-Sys Transaction List export and run a dry-run preview first.",
  });

  const runPreview = useCallback(async () => {
    if (!schoolId || !file) return;
    setBusy(true);
    setConfirmed(false);
    setApplyResult(null);
    setStatus({ phase: "idle", message: "Running dry-run preview…" });
    try {
      const result = await previewMigrationTopupPayments({ schoolId, file });
      setPreview(result);
      setStatus({
        phase: "previewed",
        message: `Preview ready — ${result.totals.newPayments} new payment(s), ${result.totals.duplicatesSkipped} duplicate(s) skipped, ${result.totals.unmatchedRows} unmatched row(s).`,
      });
    } catch (e: unknown) {
      setPreview(null);
      const msg = e instanceof Error ? e.message : "Preview failed";
      setStatus({ phase: "error", message: msg });
    } finally {
      setBusy(false);
    }
  }, [schoolId, file]);

  const refreshBatches = useCallback(async () => {
    if (!schoolId) return;
    try {
      const res = await listMigrationTopupPaymentBatches({ schoolId });
      setBatches(Array.isArray(res.batches) ? res.batches : []);
    } catch {
      setBatches([]);
    }
  }, [schoolId]);

  useEffect(() => {
    void refreshBatches();
  }, [refreshBatches]);

  const runApply = useCallback(async () => {
    if (!preview?.sessionId || !confirmed) return;
    setBusy(true);
    try {
      const result = await applyMigrationTopupPayments({
        schoolId,
        sessionId: preview.sessionId,
      });
      setApplyResult(result);
      void refreshBatches();
      setStatus({
        phase: "applied",
        message: `Imported ${result.rowsImported} new payment(s) (skipped ${result.rowsSkipped}) from ${result.fileName}. Batch ${result.batchId} saved.`,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Apply failed";
      setStatus({ phase: "error", message: msg });
    } finally {
      setBusy(false);
    }
  }, [preview, schoolId, confirmed, refreshBatches]);

  const summary = useMemo(() => {
    if (!preview) return [];
    return [
      { label: "Total rows", value: preview.totals.totalRows },
      { label: "New payments", value: preview.totals.newPayments },
      { label: "Duplicates skipped", value: preview.totals.duplicatesSkipped },
      { label: "Unmatched rows", value: preview.totals.unmatchedRows },
      { label: "Accounts affected", value: preview.totals.accountsAffected },
      { label: "Total amount", value: formatMigrationMoney(preview.totals.totalPaymentAmount) },
    ];
  }, [preview]);

  return (
    <div className="migration-centre-page">
      <div className="migration-centre-back">
        <button
          type="button"
          className="migration-centre-btn migration-centre-btn--outline"
          onClick={onBack}
        >
          ← Migration Centre
        </button>
      </div>

      <header className="migration-centre-header">
        <h1 className="page-title">Top-Up Payments</h1>
        <p className="migration-centre-subtitle">
          Import new Kid-e-Sys payment transactions captured after the original cutover. Preview first,
          then apply to post only NEW payments (duplicates are skipped).
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
            setApplyResult(null);
            setConfirmed(false);
            setStatus({
              phase: picked ? "ready" : "idle",
              message: picked ? `Selected ${picked.name}` : "Choose a file to upload.",
            });
          }}
        />
        <p className="migration-centre-dropzone-title">
          {file ? file.name : "Upload transaction list (.xls, .xlsx, .csv)"}
        </p>
        <p className="migration-centre-dropzone-hint">Kid-e-Sys → Reports → Transaction List export</p>
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
          {busy ? "Previewing…" : "Dry run (Preview)"}
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
                <p className="migration-centre-summary-value">{String(card.value)}</p>
              </div>
            ))}
          </div>

          <section className="migration-centre-section">
            <h2 className="migration-centre-section-title">Preview</h2>
            <p className="migration-centre-section-hint">
              Showing up to {preview.rows.length} rows. Only rows marked <strong>new</strong> will be
              posted when you apply.
            </p>
            <div className="migration-centre-table-wrap">
              <div className="migration-centre-table-scroll">
                <table className="migration-centre-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Account</th>
                      <th>Receipt / Ref</th>
                      <th>Date</th>
                      <th>Amount</th>
                      <th>Type</th>
                      <th>Status</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row) => (
                      <tr key={`${row.rowNumber}-${row.fingerprint}`}>
                        <td>{row.rowNumber}</td>
                        <td>{row.accountNo || "—"}</td>
                        <td>{row.receiptNo || "—"}</td>
                        <td>{row.transactionDate || "—"}</td>
                        <td>{formatMigrationMoney(row.amount)}</td>
                        <td>{row.paymentType || "—"}</td>
                        <td>{row.status}</td>
                        <td>{row.reason}</td>
                      </tr>
                    ))}
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
                I confirm importing <strong>{preview.totals.newPayments}</strong> new payment(s) from{" "}
                <strong>{preview.fileName}</strong>. Duplicates will be skipped and the import will post
                to statements/balances.
              </span>
            </label>
          </div>
        </>
      ) : null}

      {applyResult ? (
        <section className="migration-centre-section">
          <h2 className="migration-centre-section-title">Apply result</h2>
          <p className="migration-centre-section-hint">
            Batch <strong>{applyResult.batchId}</strong> saved at{" "}
            <strong>{applyResult.uploadedAt}</strong> by <strong>{applyResult.uploadedBy}</strong>.
          </p>
          <div className="migration-centre-summary-grid" style={{ marginTop: 10 }}>
            {[
              { label: "Imported", value: applyResult.rowsImported },
              { label: "Skipped", value: applyResult.rowsSkipped },
              { label: "Total imported", value: formatMigrationMoney(applyResult.totalAmount) },
            ].map((card) => (
              <div key={card.label} className="migration-centre-summary-card">
                <p className="migration-centre-summary-label">{card.label}</p>
                <p className="migration-centre-summary-value">{String(card.value)}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {batches.length ? (
        <section className="migration-centre-section">
          <h2 className="migration-centre-section-title">Recent batches</h2>
          <p className="migration-centre-section-hint">
            Saved import history for this school (latest first).
          </p>
          <div className="migration-centre-table-wrap">
            <div className="migration-centre-table-scroll">
              <table className="migration-centre-table">
                <thead>
                  <tr>
                    <th>Uploaded</th>
                    <th>File</th>
                    <th>By</th>
                    <th>Imported</th>
                    <th>Skipped</th>
                    <th>Total</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map((b) => (
                    <tr key={b.id}>
                      <td>{String(b.uploadedAt || "").slice(0, 19).replace("T", " ")}</td>
                      <td>{b.sourceFilename || "—"}</td>
                      <td>{b.uploadedBy || "—"}</td>
                      <td>{b.rowsImported}</td>
                      <td>{b.rowsSkipped}</td>
                      <td>{formatMigrationMoney(b.totalAmount)}</td>
                      <td>{b.rolledBackAt ? "Rolled back" : "Applied"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

