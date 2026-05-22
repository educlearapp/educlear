import React, { useCallback, useMemo, useState } from "react";
import {
  buildReportHtml,
  exportPayloadCsv,
  openPrintWindow,
  payloadFromTable,
  resolveExportBranding,
  type AccountingExportPayload,
} from "../accounting/accountingExportEngine";
import {
  BILLING_REPORT_LIST,
  DEFAULT_BILLING_REPORT_CONFIG,
  DEFAULT_PAYMENT_RECEIVE_LIST_CONFIG,
  getReportFieldOptions,
  reportTitle,
  type BillingReportConfig,
  type BillingReportId,
} from "./billingReportDefinitions";
import { generateBillingReport, type GeneratedBillingReport } from "./billingReportsEngine";
import type { BillingAccountRow } from "./billingLedger";
import {
  buildPaymentReceivePrintHtml,
  downloadPaymentReceiveHtml,
  exportPaymentReceiveListCsv,
  rowCount,
} from "./paymentReceiveListReport";
import "./BillingReports.css";

const PAGE_SIZE = 25;

type Props = {
  schoolId: string;
  schoolName?: string;
  learners: any[];
  parents: any[];
  statementRows: BillingAccountRow[];
};

function reportExportPayload(
  report: GeneratedBillingReport,
  schoolName: string
): AccountingExportPayload {
  return payloadFromTable(
    resolveExportBranding(schoolName),
    report.title,
    "Billing Reports",
    new Date(report.generatedAt).toLocaleString("en-ZA"),
    { columns: report.columns, rows: report.rows },
    report.summary
  );
}

function printReportList() {
  window.print();
}

function printGeneratedReport(report: GeneratedBillingReport, schoolName: string) {
  openPrintWindow(buildReportHtml(reportExportPayload(report, schoolName)));
}

function exportReportCsv(report: GeneratedBillingReport, schoolName: string) {
  exportPayloadCsv(reportExportPayload(report, schoolName));
}

type ConfigModalProps = {
  reportId: BillingReportId;
  config: BillingReportConfig;
  loading: boolean;
  onChange: (next: BillingReportConfig) => void;
  onContinue: () => void;
  onCancel: () => void;
};

function ReportConfigModal({
  reportId,
  config,
  loading,
  onChange,
  onContinue,
  onCancel,
}: ConfigModalProps) {
  const options = getReportFieldOptions(reportId);
  const isReceiveList = reportId === "payment-receive-list";

  const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onCancel();
  };

  return (
    <div
      className="billing-reports-modal-overlay billing-reports-no-print"
      role="presentation"
      onClick={handleBackdrop}
    >
      <div
        className="billing-reports-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="billing-reports-config-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="billing-reports-modal-accent" aria-hidden="true" />
        <h2 id="billing-reports-config-title" className="billing-reports-modal-title">
          {reportTitle(reportId)}
        </h2>
        <div className="billing-reports-modal-fields">
          <label className="billing-reports-modal-label">
            Group By
            <select
              className="billing-reports-modal-select"
              value={config.groupBy}
              onChange={(e) => onChange({ ...config, groupBy: e.target.value })}
            >
              {options.groupBy.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>
          <label className="billing-reports-modal-label">
            Sort By
            <select
              className="billing-reports-modal-select"
              value={config.sortBy}
              onChange={(e) => onChange({ ...config, sortBy: e.target.value })}
            >
              {options.sortBy.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>
          <label className="billing-reports-modal-label">
            Show
            <select
              className="billing-reports-modal-select"
              value={config.show}
              onChange={(e) => onChange({ ...config, show: e.target.value })}
            >
              {options.show.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>
          <label className="billing-reports-modal-check">
            <input
              type="checkbox"
              checked={config.includeInactiveAccounts}
              onChange={(e) =>
                onChange({ ...config, includeInactiveAccounts: e.target.checked })
              }
            />
            {isReceiveList
              ? "Include inactive accounts with balances"
              : "Include inactive accounts"}
          </label>
        </div>
        <div className="billing-reports-modal-actions">
          <button
            type="button"
            className="billing-reports-btn billing-reports-btn--ghost"
            onClick={onCancel}
            disabled={loading}
          >
            Cancel
          </button>
          <button
            type="button"
            className="billing-reports-btn billing-reports-btn--gold"
            onClick={onContinue}
            disabled={loading}
          >
            {loading ? "Generating…" : "Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}

type ActionModalProps = {
  report: GeneratedBillingReport;
  loading: boolean;
  onView: () => void;
  onDownload: () => void;
  onExport: () => void;
  onClose: () => void;
};

function ReportActionModal({
  report,
  loading,
  onView,
  onDownload,
  onExport,
  onClose,
}: ActionModalProps) {
  const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="billing-reports-modal-overlay billing-reports-no-print"
      role="presentation"
      onClick={handleBackdrop}
    >
      <div
        className="billing-reports-modal billing-reports-action-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="billing-reports-action-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="billing-reports-modal-accent" aria-hidden="true" />
        <h2 id="billing-reports-action-title" className="billing-reports-modal-title">
          {report.title}
        </h2>
        <p className="billing-reports-action-meta">
          {rowCount(report)} account(s) ready · Generated{" "}
          {new Date(report.generatedAt).toLocaleString("en-ZA")}
        </p>
        <div className="billing-reports-action-list">
          <button
            type="button"
            className="billing-reports-action-item"
            onClick={onView}
            disabled={loading}
          >
            View
          </button>
          <button
            type="button"
            className="billing-reports-action-item"
            onClick={onDownload}
            disabled={loading}
          >
            Download
          </button>
          <button
            type="button"
            className="billing-reports-action-item"
            onClick={onExport}
            disabled={loading}
          >
            Export
          </button>
          <button
            type="button"
            className="billing-reports-action-item billing-reports-action-item--muted"
            onClick={onClose}
            disabled={loading}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

type PaymentReceivePreviewProps = {
  report: GeneratedBillingReport;
  schoolName: string;
  onBack: () => void;
};

function PaymentReceiveListPreview({ report, schoolName, onBack }: PaymentReceivePreviewProps) {
  const groups = report.groups || [];

  const handlePrint = () => {
    const html = buildPaymentReceivePrintHtml(report, schoolName);
    openPrintWindow(html);
  };

  return (
    <div className="billing-reports-prl-page">
      <div className="billing-reports-prl-toolbar billing-reports-no-print">
        <button
          type="button"
          className="billing-reports-btn billing-reports-btn--ghost"
          onClick={onBack}
        >
          Back
        </button>
        <button
          type="button"
          className="billing-reports-btn billing-reports-btn--gold"
          onClick={handlePrint}
        >
          Print
        </button>
      </div>

      <div className="billing-reports-prl-print" id="billing-reports-prl-print">
        <div className="billing-reports-prl-top">
          <div>
            <h1 className="billing-reports-prl-title">Payment Receive List</h1>
            <p className="billing-reports-prl-meta">
              Generated {new Date(report.generatedAt).toLocaleString("en-ZA")}
            </p>
          </div>
          <div className="billing-reports-prl-school">{schoolName}</div>
        </div>

        {groups.length === 0 ? (
          <p className="billing-reports-prl-empty">No accounts match your filters.</p>
        ) : (
          groups.map((group) => (
            <section key={group.heading || "__ungrouped"} className="billing-reports-prl-group">
              {group.heading ? (
                <h2 className="billing-reports-prl-group-heading">{group.heading}</h2>
              ) : null}
              <table className="billing-reports-prl-table">
                <thead>
                  <tr>
                    <th className="billing-reports-prl-num">#</th>
                    <th>Account</th>
                    <th>Learner name</th>
                    <th>Balance</th>
                    <th>Amount</th>
                    <th>Type</th>
                    <th>Date</th>
                    <th>Receipt No</th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="billing-reports-prl-empty-cell">
                        No accounts in this group.
                      </td>
                    </tr>
                  ) : (
                    group.rows.map((row) => (
                      <tr key={`${group.heading}-${row.rowNum}-${row.accountNo}`}>
                        <td className="billing-reports-prl-num">{row.rowNum}</td>
                        <td>{row.accountNo}</td>
                        <td>{row.learnerName}</td>
                        <td className="billing-reports-prl-balance">{row.balance}</td>
                        <td className="billing-reports-prl-blank" />
                        <td className="billing-reports-prl-blank" />
                        <td className="billing-reports-prl-blank" />
                        <td className="billing-reports-prl-blank" />
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

export default function BillingReports({
  schoolId,
  schoolName = "School",
  learners,
  parents,
  statementRows,
}: Props) {
  const [selectedReportId, setSelectedReportId] = useState<BillingReportId | null>(null);
  const [config, setConfig] = useState<BillingReportConfig>(DEFAULT_BILLING_REPORT_CONFIG);
  const [generated, setGenerated] = useState<GeneratedBillingReport | null>(null);
  const [pendingReceiveList, setPendingReceiveList] = useState<GeneratedBillingReport | null>(
    null
  );
  const [showReceivePreview, setShowReceivePreview] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);

  const openConfig = useCallback((reportId: BillingReportId) => {
    const opts = getReportFieldOptions(reportId);
    const defaults =
      reportId === "payment-receive-list"
        ? DEFAULT_PAYMENT_RECEIVE_LIST_CONFIG
        : DEFAULT_BILLING_REPORT_CONFIG;
    setConfig({
      groupBy: opts.groupBy.includes(defaults.groupBy) ? defaults.groupBy : opts.groupBy[0],
      sortBy: opts.sortBy.includes(defaults.sortBy) ? defaults.sortBy : opts.sortBy[0],
      show: opts.show.includes(defaults.show) ? defaults.show : opts.show[0],
      includeInactiveAccounts: defaults.includeInactiveAccounts,
    });
    setError("");
    setSelectedReportId(reportId);
  }, []);

  const closeConfig = useCallback(() => {
    if (loading) return;
    setSelectedReportId(null);
  }, [loading]);

  const runReport = useCallback(async () => {
    if (!selectedReportId || !schoolId) return;
    const reportId = selectedReportId;
    setLoading(true);
    setError("");
    try {
      const report = await generateBillingReport({
        schoolId,
        reportId,
        config,
        statementRows,
        learners,
        parents,
      });
      if (reportId === "payment-receive-list") {
        setPendingReceiveList(report);
        setSelectedReportId(null);
      } else {
        setGenerated(report);
        setPage(1);
        setSelectedReportId(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate report");
    } finally {
      setLoading(false);
    }
  }, [selectedReportId, schoolId, config, statementRows, learners, parents]);

  const closeReceiveAction = useCallback(() => {
    setPendingReceiveList(null);
    setShowReceivePreview(false);
  }, []);

  const openReceiveView = useCallback(() => {
    setShowReceivePreview(true);
  }, []);

  const backFromReceivePreview = useCallback(() => {
    setShowReceivePreview(false);
  }, []);

  const downloadReceiveList = useCallback(() => {
    if (!pendingReceiveList) return;
    downloadPaymentReceiveHtml(
      buildPaymentReceivePrintHtml(pendingReceiveList, schoolName),
      pendingReceiveList.generatedAt
    );
  }, [pendingReceiveList, schoolName]);

  const exportReceiveList = useCallback(() => {
    if (!pendingReceiveList) return;
    exportPaymentReceiveListCsv(pendingReceiveList, schoolName);
  }, [pendingReceiveList, schoolName]);

  const backToList = useCallback(() => {
    setGenerated(null);
    setPage(1);
    setError("");
  }, []);

  const totalPages = useMemo(() => {
    if (!generated) return 1;
    return Math.max(1, Math.ceil(generated.rows.length / PAGE_SIZE));
  }, [generated]);

  const pageRows = useMemo(() => {
    if (!generated) return [];
    const start = (page - 1) * PAGE_SIZE;
    return generated.rows.slice(start, start + PAGE_SIZE);
  }, [generated, page]);

  if (showReceivePreview && pendingReceiveList) {
    return (
      <PaymentReceiveListPreview
        report={pendingReceiveList}
        schoolName={schoolName}
        onBack={backFromReceivePreview}
      />
    );
  }

  if (generated) {
    return (
      <div className="billing-reports-result">
        <div className="billing-reports-result-toolbar billing-reports-no-print">
          <div>
            <h1 className="billing-reports-title">{generated.title}</h1>
            <p className="billing-reports-subtitle">
              Generated {new Date(generated.generatedAt).toLocaleString("en-ZA")} ·{" "}
              {generated.rows.length} row(s)
            </p>
          </div>
          <div className="billing-reports-result-actions">
            <button
              type="button"
              className="billing-reports-btn billing-reports-btn--ghost"
              onClick={backToList}
            >
              Back to Reports
            </button>
            <button
              type="button"
              className="billing-reports-btn billing-reports-btn--gold"
              onClick={() => printGeneratedReport(generated, schoolName)}
            >
              Print
            </button>
            <button
              type="button"
              className="billing-reports-btn billing-reports-btn--gold"
              onClick={() => exportReportCsv(generated, schoolName)}
            >
              Export CSV
            </button>
          </div>
        </div>

        {error ? <p className="billing-reports-error">{error}</p> : null}

        {generated.summary.length > 0 ? (
          <div className="billing-reports-summary">
            {generated.summary.map((s) => (
              <div key={s.label} className="billing-reports-summary-item">
                <strong>{s.label}:</strong> {s.value}
              </div>
            ))}
          </div>
        ) : null}

        <div className="billing-reports-table-wrap">
          <table className="billing-reports-table">
            <thead>
              <tr>
                {generated.columns.map((col) => (
                  <th key={col}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 ? (
                <tr>
                  <td colSpan={generated.columns.length} style={{ textAlign: "center", padding: 24 }}>
                    No data matches your filters.
                  </td>
                </tr>
              ) : (
                pageRows.map((row, idx) => (
                  <tr key={`${page}-${idx}`}>
                    {row.map((cell, ci) => (
                      <td key={ci}>{cell}</td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {generated.rows.length > PAGE_SIZE ? (
          <div className="billing-reports-pagination billing-reports-no-print">
            <span>
              Page {page} of {totalPages}
            </span>
            <div className="billing-reports-result-actions">
              <button
                type="button"
                className="billing-reports-btn billing-reports-btn--ghost"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <button
                type="button"
                className="billing-reports-btn billing-reports-btn--ghost"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </button>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="billing-reports-page">
      <div className="billing-reports-header billing-reports-no-print">
        <div>
          <h1 className="billing-reports-title">Billing Reports</h1>
          <p className="billing-reports-subtitle">
            Select a report to configure filters and generate from live billing data.
          </p>
        </div>
        <button
          type="button"
          className="billing-reports-print-btn"
          onClick={printReportList}
        >
          Print
        </button>
      </div>

      {error ? <p className="billing-reports-error billing-reports-no-print">{error}</p> : null}

      <div className="billing-reports-list-card" id="billing-reports-print-list">
        <ul className="billing-reports-list">
          {BILLING_REPORT_LIST.map((report) => (
            <li key={report.id}>
              <button
                type="button"
                className="billing-reports-list-item"
                onClick={() => openConfig(report.id)}
              >
                {report.name}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {selectedReportId ? (
        <ReportConfigModal
          reportId={selectedReportId}
          config={config}
          loading={loading}
          onChange={setConfig}
          onContinue={() => void runReport()}
          onCancel={closeConfig}
        />
      ) : null}

      {pendingReceiveList ? (
        <ReportActionModal
          report={pendingReceiveList}
          loading={loading}
          onView={openReceiveView}
          onDownload={downloadReceiveList}
          onExport={exportReceiveList}
          onClose={closeReceiveAction}
        />
      ) : null}
    </div>
  );
}
