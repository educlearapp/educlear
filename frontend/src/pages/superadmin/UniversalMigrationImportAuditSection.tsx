import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchUniversalMigrationImportBatch,
  fetchUniversalMigrationImportBatches,
  reconcileUniversalMigrationImportBatch,
  reverseUniversalMigrationLedgerBatch,
  rollbackUniversalMigrationImportBatch,
  type MigrationImportBatchDetail,
  type MigrationImportBatchSummary,
  type MigrationReconciliationResult,
  type MigrationReconciliationStatus,
  type MigrationReversalResult,
  type MigrationRollbackResult,
} from "../../superAdmin/utils/universalMigrationImportBatches";
import type { MigrationImportReportRow } from "../../superAdmin/utils/universalMigrationApply";
import {
  exportUniversalMigrationImportBatchReport,
  exportUniversalMigrationReconciliationReport,
} from "../../superAdmin/utils/universalMigrationReportExport";
import {
  createUniversalMigrationSignoff,
  downloadUniversalMigrationSignoffFile,
  type MigrationSignoffPack,
} from "../../superAdmin/utils/universalMigrationSignoff";

const SAFETY_MESSAGES = [
  "Deletion rollback only removes learner/parent/billing records created by this import batch.",
  "Batches with posted ledger transactions cannot be deletion-rolled back — use reversal rollback instead.",
  "Reversal rollback creates opposite billing-ledger entries; original transactions stay for audit history.",
] as const;

type Props = {
  onNotice?: (message: string) => void;
};

function formatDate(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function formatCounts(counts: MigrationImportBatchSummary["createdCounts"]): string {
  return [
    `learners ${counts.learners}`,
    `parents ${counts.parents}`,
    `billing ${counts.billingAccounts}`,
    `links ${counts.parentLearnerLinks}`,
  ].join(", ");
}

function formatTransactionCounts(counts: MigrationImportBatchSummary["createdCounts"]): string {
  return `transactions ${counts.transactions}`;
}

function statusLabel(status: string): string {
  if (status === "rolled_back") return "Rolled back";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function reconciliationStatusLabel(status: MigrationReconciliationStatus): string {
  if (status === "pass") return "PASS";
  if (status === "warning") return "WARNING";
  return "FAIL";
}

function formatSignoffCounts(counts: MigrationSignoffPack["counts"]["created"]): string {
  return [
    `learners ${counts.learners}`,
    `parents ${counts.parents}`,
    `billing ${counts.billingAccounts}`,
    `transactions ${counts.transactions}`,
    `classrooms ${counts.classrooms}`,
    `links ${counts.parentLearnerLinks}`,
  ].join(", ");
}

function signoffStatusLabel(status: MigrationSignoffPack["signoffStatus"]): string {
  if (status === "approved") return "Approved";
  if (status === "blocked") return "Blocked";
  return "Draft (manual review)";
}

export default function UniversalMigrationImportAuditSection({ onNotice }: Props) {
  const [batches, setBatches] = useState<MigrationImportBatchSummary[]>([]);
  const [listBusy, setListBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openBatchId, setOpenBatchId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MigrationImportBatchDetail | null>(null);
  const [hasCreatedTransactions, setHasCreatedTransactions] = useState(false);
  const [detailBusy, setDetailBusy] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [entityFilter, setEntityFilter] = useState<string>("all");
  const [confirmationText, setConfirmationText] = useState("");
  const [rollbackBusy, setRollbackBusy] = useState(false);
  const [rollbackResult, setRollbackResult] = useState<MigrationRollbackResult | null>(null);
  const [reversalBusy, setReversalBusy] = useState(false);
  const [reversalResult, setReversalResult] = useState<MigrationReversalResult | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [reconcileBusy, setReconcileBusy] = useState(false);
  const [reconciliation, setReconciliation] = useState<MigrationReconciliationResult | null>(null);
  const [reconcileExportBusy, setReconcileExportBusy] = useState(false);
  const [operatorName, setOperatorName] = useState("");
  const [operatorEmail, setOperatorEmail] = useState("");
  const [signoffNotes, setSignoffNotes] = useState("");
  const [approvalConfirmed, setApprovalConfirmed] = useState(false);
  const [signoffBusy, setSignoffBusy] = useState(false);
  const [signoffPack, setSignoffPack] = useState<MigrationSignoffPack | null>(null);

  const refreshList = useCallback(async () => {
    setListBusy(true);
    setError(null);
    try {
      const list = await fetchUniversalMigrationImportBatches();
      setBatches(list);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load import batches");
    } finally {
      setListBusy(false);
    }
  }, []);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  const openBatch = useCallback(async (batchId: string) => {
    setOpenBatchId(batchId);
    setDetail(null);
    setRollbackResult(null);
    setReversalResult(null);
    setReconciliation(null);
    setSignoffPack(null);
    setApprovalConfirmed(false);
    setConfirmationText("");
    setStatusFilter("all");
    setEntityFilter("all");
    setDetailBusy(true);
    setError(null);
    try {
      const loaded = await fetchUniversalMigrationImportBatch(batchId);
      setDetail(loaded.batch);
      setHasCreatedTransactions(loaded.hasCreatedTransactions);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load batch");
      setOpenBatchId(null);
    } finally {
      setDetailBusy(false);
    }
  }, []);

  const closeBatch = useCallback(() => {
    setOpenBatchId(null);
    setDetail(null);
    setConfirmationText("");
    setRollbackResult(null);
    setReversalResult(null);
    setReconciliation(null);
    setSignoffPack(null);
    setApprovalConfirmed(false);
  }, []);

  const runReconciliation = useCallback(async () => {
    if (!detail) return;
    setReconcileBusy(true);
    setError(null);
    try {
      const result = await reconcileUniversalMigrationImportBatch({
        batchId: detail.batchId,
        targetSchoolId: detail.targetSchoolId,
      });
      setReconciliation(result);
      onNotice?.(
        `Reconciliation ${reconciliationStatusLabel(result.overallStatus)} for batch ${detail.batchId}`
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Reconciliation failed");
    } finally {
      setReconcileBusy(false);
    }
  }, [detail, onNotice]);

  const canGenerateSignoff = useMemo(() => {
    if (!reconciliation) return false;
    if (!approvalConfirmed) return false;
    if (!operatorName.trim() || !operatorEmail.trim()) return false;
    return true;
  }, [reconciliation, approvalConfirmed, operatorName, operatorEmail]);

  const runGenerateSignoff = useCallback(async () => {
    if (!detail || !canGenerateSignoff) return;
    setSignoffBusy(true);
    setError(null);
    try {
      const pack = await createUniversalMigrationSignoff({
        batchId: detail.batchId,
        targetSchoolId: detail.targetSchoolId,
        operatorName: operatorName.trim(),
        operatorEmail: operatorEmail.trim(),
        notes: signoffNotes.trim(),
        approvalConfirmed: true,
      });
      setSignoffPack(pack);
      onNotice?.(`Migration sign-off pack generated (${pack.signoffId})`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Sign-off generation failed");
    } finally {
      setSignoffBusy(false);
    }
  }, [detail, canGenerateSignoff, operatorName, operatorEmail, signoffNotes, onNotice]);

  const handleExportReconciliation = useCallback(async () => {
    if (!detail) return;
    setReconcileExportBusy(true);
    setError(null);
    try {
      await exportUniversalMigrationReconciliationReport(detail.batchId, detail.targetSchoolId);
      onNotice?.(`Reconciliation report exported for ${detail.batchId}.`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Reconciliation export failed");
    } finally {
      setReconcileExportBusy(false);
    }
  }, [detail, onNotice]);

  const filteredReportRows = useMemo(() => {
    const rows = detail?.reportRows ?? [];
    return rows.filter((row) => {
      if (statusFilter !== "all" && row.status !== statusFilter) return false;
      if (entityFilter !== "all" && row.entityType !== entityFilter) return false;
      return true;
    });
  }, [detail, statusFilter, entityFilter]);

  const entityTypes = useMemo(() => {
    const set = new Set<string>();
    for (const row of detail?.reportRows ?? []) set.add(row.entityType);
    return [...set].sort();
  }, [detail]);

  const confirmationMatches = useMemo(() => {
    if (!detail) return false;
    const expected = detail.targetSchoolName.trim().toLowerCase();
    const typed = confirmationText.trim().toLowerCase();
    return Boolean(expected) && typed === expected;
  }, [detail, confirmationText]);

  const canRollback = useMemo(() => {
    if (!detail) return false;
    if (detail.status !== "completed") return false;
    if (hasCreatedTransactions) return false;
    return confirmationMatches;
  }, [detail, hasCreatedTransactions, confirmationMatches]);

  const canReversalRollback = useMemo(() => {
    if (!detail) return false;
    if (detail.status !== "completed") return false;
    if (!hasCreatedTransactions) return false;
    return confirmationMatches;
  }, [detail, hasCreatedTransactions, confirmationMatches]);

  const handleExportBatch = useCallback(async () => {
    if (!detail) return;
    setExportBusy(true);
    setError(null);
    try {
      await exportUniversalMigrationImportBatchReport(detail.batchId);
      onNotice?.(`Batch report exported for ${detail.batchId}.`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Batch export failed");
    } finally {
      setExportBusy(false);
    }
  }, [detail, onNotice]);

  const runRollback = useCallback(async () => {
    if (!detail || !canRollback) return;
    setRollbackBusy(true);
    setError(null);
    try {
      const result = await rollbackUniversalMigrationImportBatch({
        batchId: detail.batchId,
        targetSchoolId: detail.targetSchoolId,
        confirmationText,
      });
      setRollbackResult(result);
      onNotice?.(`Rollback completed for batch ${detail.batchId}`);
      await refreshList();
      await openBatch(detail.batchId);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Rollback failed");
    } finally {
      setRollbackBusy(false);
    }
  }, [detail, canRollback, confirmationText, onNotice, refreshList, openBatch]);

  const runReversalRollback = useCallback(async () => {
    if (!detail || !canReversalRollback) return;
    setReversalBusy(true);
    setError(null);
    try {
      const result = await reverseUniversalMigrationLedgerBatch({
        batchId: detail.batchId,
        targetSchoolId: detail.targetSchoolId,
        confirmationText,
      });
      setReversalResult(result);
      onNotice?.(`Reversal rollback completed for batch ${detail.batchId}`);
      await refreshList();
      await openBatch(detail.batchId);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Reversal rollback failed");
    } finally {
      setReversalBusy(false);
    }
  }, [detail, canReversalRollback, confirmationText, onNotice, refreshList, openBatch]);

  return (
    <div className="uc-migration-audit-section">
      <div className="uc-migration-audit-safety" role="note">
        <p className="uc-migration-audit-safety-title">Rollback safety</p>
        <ul>
          {SAFETY_MESSAGES.map((msg) => (
            <li key={msg}>{msg}</li>
          ))}
        </ul>
      </div>

      <div className="uc-migration-dry-run-history-header">
        <h3 className="uc-migration-dry-run-subtitle">Past import batches</h3>
        <button
          type="button"
          className="uc-migration-btn uc-migration-btn--secondary"
          onClick={() => void refreshList()}
          disabled={listBusy}
        >
          {listBusy ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error ? (
        <p className="uc-migration-dry-run-blocked" role="alert">
          {error}
        </p>
      ) : null}

      {batches.length === 0 && !listBusy ? (
        <p className="uc-migration-dry-run-hint">No universal migration apply batches recorded yet.</p>
      ) : (
        <ul className="uc-migration-dry-run-history-list">
          {batches.map((batch) => (
            <li key={batch.batchId} className="uc-migration-dry-run-history-item">
              <div className="uc-migration-dry-run-history-main">
                <span className="uc-migration-dry-run-history-system">{batch.targetSchoolName}</span>
                <span className={`uc-migration-audit-status uc-migration-audit-status--${batch.status}`}>
                  {statusLabel(batch.status)}
                </span>
              </div>
              <div className="uc-migration-dry-run-history-meta">
                <span className="uc-migration-dry-run-history-date">{formatDate(batch.createdAt)}</span>
                <span className="uc-migration-dry-run-history-id">Batch {batch.batchId}</span>
                <span className="uc-migration-dry-run-history-id">Stage {batch.stageId}</span>
              </div>
              <p className="uc-migration-dry-run-hint">
                Created: {formatCounts(batch.createdCounts)} · Skipped: {formatCounts(batch.skippedCounts)} ·
                Failed: {formatCounts(batch.failedCounts)}
              </p>
              <div className="uc-migration-dry-run-history-actions">
                <button
                  type="button"
                  className="uc-migration-btn uc-migration-btn--secondary"
                  onClick={() => void openBatch(batch.batchId)}
                >
                  Open
                </button>
                {batch.status === "completed" && batch.hasCreatedTransactions ? (
                  <button
                    type="button"
                    className="uc-migration-btn uc-migration-btn--primary"
                    onClick={() => void openBatch(batch.batchId)}
                  >
                    Reversal rollback
                  </button>
                ) : batch.status === "completed" && !batch.hasCreatedTransactions ? (
                  <button
                    type="button"
                    className="uc-migration-btn uc-migration-btn--primary"
                    onClick={() => void openBatch(batch.batchId)}
                  >
                    Rollback
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {openBatchId ? (
        <div className="uc-migration-dry-run-detail uc-migration-audit-detail" role="dialog" aria-label="Import batch detail">
          <div className="uc-migration-dry-run-detail-header">
            <h3 className="uc-migration-dry-run-subtitle">Batch {openBatchId}</h3>
            <div className="uc-migration-audit-detail-actions">
              {detail && !detailBusy ? (
                <button
                  type="button"
                  className="uc-migration-export-btn"
                  disabled={exportBusy}
                  onClick={() => void handleExportBatch()}
                >
                  {exportBusy ? "Exporting…" : "Export Batch Report"}
                </button>
              ) : null}
              <button type="button" className="uc-migration-btn uc-migration-btn--secondary" onClick={closeBatch}>
                Close
              </button>
            </div>
          </div>

          {detailBusy ? <p className="uc-migration-dry-run-hint">Loading batch report…</p> : null}

          {detail && !detailBusy ? (
            <>
              <dl className="uc-migration-dry-run-meta">
                <dt>Target school</dt>
                <dd>{detail.targetSchoolName}</dd>
                <dt>Status</dt>
                <dd>{statusLabel(detail.status)}</dd>
                <dt>Stage</dt>
                <dd className="uc-migration-dry-run-mono">{detail.stageId}</dd>
                <dt>Created</dt>
                <dd>{formatDate(detail.createdAt)}</dd>
                <dt>Completed</dt>
                <dd>{formatDate(detail.completedAt)}</dd>
                {detail.rolledBackAt ? (
                  <>
                    <dt>Rolled back</dt>
                    <dd>{formatDate(detail.rolledBackAt)}</dd>
                  </>
                ) : null}
              </dl>

              <div className="uc-migration-audit-filters">
                <label>
                  Status
                  <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                    <option value="all">All</option>
                    <option value="created">Created</option>
                    <option value="skipped">Skipped</option>
                    <option value="failed">Failed</option>
                    <option value="not_applied">Not applied</option>
                  </select>
                </label>
                <label>
                  Entity type
                  <select value={entityFilter} onChange={(e) => setEntityFilter(e.target.value)}>
                    <option value="all">All</option>
                    {entityTypes.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="uc-migration-apply-report-wrap">
                <table className="uc-migration-apply-report-table">
                  <thead>
                    <tr>
                      <th>Row</th>
                      <th>Entity</th>
                      <th>Status</th>
                      <th>File</th>
                      <th>Message</th>
                      <th>Record</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredReportRows.map((row: MigrationImportReportRow, idx) => (
                      <tr key={`${row.sourceFileId}-${row.rowNumber}-${idx}`}>
                        <td>{row.rowNumber}</td>
                        <td>{row.entityType}</td>
                        <td>{row.status}</td>
                        <td>{row.sourceFilename}</td>
                        <td>{row.message}</td>
                        <td className="uc-migration-dry-run-mono">{row.recordId ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {detail.rollbackReport && detail.rollbackReport.length > 0 ? (
                <div className="uc-migration-audit-rollback-report">
                  <h4 className="uc-migration-dry-run-subtitle">Rollback audit</h4>
                  <ul>
                    {detail.rollbackReport.map((row, idx) => (
                      <li key={`${row.recordId}-${idx}`}>
                        {row.entityType} {row.recordId}: {row.status} — {row.message}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {rollbackResult ? (
                <p className="uc-migration-dry-run-hint" role="status">
                  Rollback finished at {formatDate(rollbackResult.rolledBackAt)}. Deleted:{" "}
                  {formatCounts(rollbackResult.deletedCounts)}.
                </p>
              ) : null}

              {reversalResult ? (
                <div className="uc-migration-audit-reversal-summary" role="status">
                  <p className="uc-migration-dry-run-hint">
                    Reversal finished at {formatDate(reversalResult.rolledBackAt)}. Reversed:{" "}
                    {formatTransactionCounts(reversalResult.reversedCounts)} · Skipped:{" "}
                    {formatTransactionCounts(reversalResult.skippedCounts)} · Failed:{" "}
                    {formatTransactionCounts(reversalResult.failedCounts)}.
                  </p>
                  <div className="uc-migration-apply-report-wrap">
                    <table className="uc-migration-apply-report-table">
                      <thead>
                        <tr>
                          <th>Row</th>
                          <th>Original record</th>
                          <th>Status</th>
                          <th>Reversal record</th>
                          <th>Message</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reversalResult.report.map((row, idx) => (
                          <tr key={`${row.recordId}-${idx}`}>
                            <td>{row.rowNumber ?? "—"}</td>
                            <td className="uc-migration-dry-run-mono">{row.recordId}</td>
                            <td>{row.status}</td>
                            <td className="uc-migration-dry-run-mono">{row.reversalRecordId ?? "—"}</td>
                            <td>{row.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}

              <div className="uc-migration-audit-reconciliation-panel">
                <h4 className="uc-migration-dry-run-subtitle">Final reconciliation</h4>
                <p className="uc-migration-dry-run-hint">
                  Read-only comparison of dry-run expectations vs live school data and billing ledger.
                  Does not modify school records.
                </p>
                <div className="uc-migration-audit-reconciliation-actions">
                  <button
                    type="button"
                    className="uc-migration-btn uc-migration-btn--primary"
                    disabled={reconcileBusy}
                    onClick={() => void runReconciliation()}
                  >
                    {reconcileBusy ? "Running reconciliation…" : "Run Reconciliation"}
                  </button>
                  {reconciliation ? (
                    <button
                      type="button"
                      className="uc-migration-export-btn"
                      disabled={reconcileExportBusy}
                      onClick={() => void handleExportReconciliation()}
                    >
                      {reconcileExportBusy ? "Exporting…" : "Export Reconciliation CSV"}
                    </button>
                  ) : null}
                </div>

                {reconciliation ? (
                  <div className="uc-migration-audit-reconciliation-results">
                    <p
                      className={`uc-migration-reconcile-overall uc-migration-reconcile-overall--${reconciliation.overallStatus}`}
                      role="status"
                    >
                      Overall: {reconciliationStatusLabel(reconciliation.overallStatus)}
                    </p>
                    <div className="uc-migration-reconcile-summary-cards">
                      <div className="uc-migration-reconcile-card uc-migration-reconcile-card--pass">
                        <span className="uc-migration-reconcile-card-label">Passed</span>
                        <span className="uc-migration-reconcile-card-value">
                          {reconciliation.summary.passed}
                        </span>
                      </div>
                      <div className="uc-migration-reconcile-card uc-migration-reconcile-card--warning">
                        <span className="uc-migration-reconcile-card-label">Warnings</span>
                        <span className="uc-migration-reconcile-card-value">
                          {reconciliation.summary.warnings}
                        </span>
                      </div>
                      <div className="uc-migration-reconcile-card uc-migration-reconcile-card--fail">
                        <span className="uc-migration-reconcile-card-label">Failed</span>
                        <span className="uc-migration-reconcile-card-value">
                          {reconciliation.summary.failed}
                        </span>
                      </div>
                    </div>
                    <div className="uc-migration-apply-report-wrap">
                      <table className="uc-migration-apply-report-table uc-migration-reconcile-table">
                        <thead>
                          <tr>
                            <th>Check</th>
                            <th>Expected</th>
                            <th>Actual</th>
                            <th>Status</th>
                            <th>Message</th>
                          </tr>
                        </thead>
                        <tbody>
                          {reconciliation.checks.map((row) => (
                            <tr
                              key={row.id}
                              className={`uc-migration-reconcile-row--${row.status}`}
                            >
                              <td>{row.check}</td>
                              <td>{row.expected}</td>
                              <td>{row.actual}</td>
                              <td>
                                <span
                                  className={`uc-migration-reconcile-status uc-migration-reconcile-status--${row.status}`}
                                >
                                  {reconciliationStatusLabel(row.status)}
                                </span>
                              </td>
                              <td>{row.message}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="uc-migration-dry-run-hint">
                      Reconciled at {formatDate(reconciliation.reconciledAt)}.
                    </p>
                  </div>
                ) : null}
              </div>

              <div className="uc-migration-signoff-panel">
                <h4 className="uc-migration-dry-run-subtitle">Migration sign-off pack</h4>
                <p className="uc-migration-dry-run-hint">
                  Formal go-live sign-off record from batch and reconciliation results only. Run
                  reconciliation first, then confirm approval to generate CSV and PDF exports.
                </p>
                {!reconciliation ? (
                  <p className="uc-migration-dry-run-blocked" role="status">
                    Run final reconciliation before generating a sign-off pack.
                  </p>
                ) : (
                  <>
                    <div className="uc-migration-signoff-form">
                      <label className="uc-migration-audit-confirm-label">
                        Operator name
                        <input
                          type="text"
                          className="uc-migration-staging-source-input"
                          value={operatorName}
                          onChange={(e) => setOperatorName(e.target.value)}
                          autoComplete="name"
                        />
                      </label>
                      <label className="uc-migration-audit-confirm-label">
                        Operator email
                        <input
                          type="email"
                          className="uc-migration-staging-source-input"
                          value={operatorEmail}
                          onChange={(e) => setOperatorEmail(e.target.value)}
                          autoComplete="email"
                        />
                      </label>
                      <label className="uc-migration-audit-confirm-label">
                        Notes
                        <textarea
                          className="uc-migration-staging-source-input uc-migration-signoff-notes"
                          value={signoffNotes}
                          onChange={(e) => setSignoffNotes(e.target.value)}
                          rows={3}
                        />
                      </label>
                      <label className="uc-migration-signoff-approval">
                        <input
                          type="checkbox"
                          checked={approvalConfirmed}
                          onChange={(e) => setApprovalConfirmed(e.target.checked)}
                        />
                        <span>
                          I confirm this migration has been reviewed and approved for sign-off.
                        </span>
                      </label>
                      <button
                        type="button"
                        className="uc-migration-btn uc-migration-btn--primary"
                        disabled={!canGenerateSignoff || signoffBusy}
                        onClick={() => void runGenerateSignoff()}
                      >
                        {signoffBusy ? "Generating sign-off…" : "Generate Sign-Off Pack"}
                      </button>
                    </div>

                    {signoffPack ? (
                      <div className="uc-migration-signoff-result" role="status">
                        <h5 className="uc-migration-signoff-result-title">Migration Sign-Off</h5>
                        <dl className="uc-migration-signoff-meta">
                          <dt>School</dt>
                          <dd>{signoffPack.schoolName}</dd>
                          <dt>Batch</dt>
                          <dd className="uc-migration-dry-run-mono">{signoffPack.batchId}</dd>
                          <dt>Operator</dt>
                          <dd>
                            {signoffPack.operatorName} ({signoffPack.operatorEmail})
                          </dd>
                          <dt>Reconciliation</dt>
                          <dd>
                            <span
                              className={`uc-migration-reconcile-status uc-migration-reconcile-status--${signoffPack.reconciliationStatus}`}
                            >
                              {reconciliationStatusLabel(signoffPack.reconciliationStatus)}
                            </span>
                          </dd>
                          <dt>Migration status</dt>
                          <dd>{statusLabel(signoffPack.migrationStatus)}</dd>
                          <dt>Sign-off status</dt>
                          <dd>
                            <span
                              className={`uc-migration-signoff-badge uc-migration-signoff-badge--${signoffPack.signoffStatus}`}
                            >
                              {signoffStatusLabel(signoffPack.signoffStatus)}
                            </span>
                          </dd>
                          <dt>Go-live approved</dt>
                          <dd>
                            <span
                              className={
                                signoffPack.approvedForGoLive
                                  ? "uc-migration-signoff-golive--yes"
                                  : "uc-migration-signoff-golive--no"
                              }
                            >
                              {signoffPack.approvedForGoLive ? "YES" : "NO"}
                            </span>
                          </dd>
                          <dt>Created</dt>
                          <dd>{formatDate(signoffPack.createdAt)}</dd>
                          <dt>Counts (created)</dt>
                          <dd>{formatSignoffCounts(signoffPack.counts.created)}</dd>
                          <dt>Counts (skipped)</dt>
                          <dd>{formatSignoffCounts(signoffPack.counts.skipped)}</dd>
                          <dt>Counts (failed)</dt>
                          <dd>{formatSignoffCounts(signoffPack.counts.failed)}</dd>
                        </dl>
                        {signoffPack.warnings.length > 0 ? (
                          <div className="uc-migration-signoff-warnings">
                            <h6>Warnings</h6>
                            <ul>
                              {signoffPack.warnings.map((w, idx) => (
                                <li key={`${idx}-${w.slice(0, 40)}`}>{w}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                        {signoffPack.exportedReports.length > 0 ? (
                          <div className="uc-migration-signoff-reports">
                            <h6>Reports</h6>
                            <ul>
                              {signoffPack.exportedReports.map((report) => (
                                <li key={report.filename}>
                                  <button
                                    type="button"
                                    className="uc-migration-export-btn"
                                    onClick={() =>
                                      void downloadUniversalMigrationSignoffFile(
                                        report.downloadPath
                                      ).catch((e: unknown) =>
                                        setError(
                                          e instanceof Error ? e.message : "Download failed"
                                        )
                                      )
                                    }
                                  >
                                    {report.label}
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </>
                )}
              </div>

              {detail.reversalReport && detail.reversalReport.length > 0 ? (
                <div className="uc-migration-audit-rollback-report">
                  <h4 className="uc-migration-dry-run-subtitle">Reversal audit</h4>
                  <div className="uc-migration-apply-report-wrap">
                    <table className="uc-migration-apply-report-table">
                      <thead>
                        <tr>
                          <th>Row</th>
                          <th>Original record</th>
                          <th>Status</th>
                          <th>Reversal record</th>
                          <th>Message</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.reversalReport.map((row, idx) => (
                          <tr key={`${row.recordId}-rev-${idx}`}>
                            <td>{row.rowNumber ?? "—"}</td>
                            <td className="uc-migration-dry-run-mono">{row.recordId}</td>
                            <td>{row.status}</td>
                            <td className="uc-migration-dry-run-mono">{row.reversalRecordId ?? "—"}</td>
                            <td>{row.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}

              {detail.status === "completed" ? (
                <div className="uc-migration-audit-rollback-panel">
                  <h4 className="uc-migration-dry-run-subtitle">
                    {hasCreatedTransactions ? "Reversal rollback" : "Rollback this batch"}
                  </h4>
                  {hasCreatedTransactions ? (
                    <>
                      <p className="uc-migration-dry-run-blocked" role="alert">
                        This batch contains posted ledger transactions. EduClear will create reversing
                        ledger entries. Original transactions will remain for audit history.
                      </p>
                      <p className="uc-migration-dry-run-hint">
                        Deletion rollback is blocked for batches with posted transactions. Type the
                        target school name exactly to confirm reversal for{" "}
                        <strong>{detail.targetSchoolName}</strong>.
                      </p>
                      <label className="uc-migration-audit-confirm-label">
                        School name confirmation
                        <input
                          type="text"
                          className="uc-migration-staging-source-input"
                          value={confirmationText}
                          onChange={(e) => setConfirmationText(e.target.value)}
                          placeholder={detail.targetSchoolName}
                          autoComplete="off"
                        />
                      </label>
                      <button
                        type="button"
                        className="uc-migration-btn uc-migration-btn--danger"
                        disabled={!canReversalRollback || reversalBusy}
                        onClick={() => void runReversalRollback()}
                      >
                        {reversalBusy ? "Reversing ledger…" : "Reversal rollback (ledger)"}
                      </button>
                      {!canReversalRollback && confirmationText ? (
                        <p className="uc-migration-dry-run-hint">Confirmation must match the school name exactly.</p>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <p className="uc-migration-dry-run-hint">
                        Type the target school name exactly to confirm rollback for{" "}
                        <strong>{detail.targetSchoolName}</strong>.
                      </p>
                      <label className="uc-migration-audit-confirm-label">
                        School name confirmation
                        <input
                          type="text"
                          className="uc-migration-staging-source-input"
                          value={confirmationText}
                          onChange={(e) => setConfirmationText(e.target.value)}
                          placeholder={detail.targetSchoolName}
                          autoComplete="off"
                        />
                      </label>
                      <button
                        type="button"
                        className="uc-migration-btn uc-migration-btn--danger"
                        disabled={!canRollback || rollbackBusy}
                        onClick={() => void runRollback()}
                      >
                        {rollbackBusy ? "Rolling back…" : "Rollback created records"}
                      </button>
                      {!canRollback && confirmationText ? (
                        <p className="uc-migration-dry-run-hint">Confirmation must match the school name exactly.</p>
                      ) : null}
                    </>
                  )}
                </div>
              ) : detail.status === "rolled_back" ? (
                <p className="uc-migration-dry-run-hint">This batch has already been rolled back.</p>
              ) : (
                <p className="uc-migration-dry-run-hint">Rollback is only available for completed batches.</p>
              )}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
