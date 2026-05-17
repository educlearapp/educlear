import React, { useMemo, useState } from "react";
import {
  ACCOUNTING_GOLD,
  ACCOUNTING_INK,
  accountingCard,
  accountingPageWrap,
  accountingSubtitle,
  accountingTitle,
} from "./accountingTheme";
import {
  EXPORT_REPORT_OPTIONS,
  buildReportHtml,
  exportPayloadCsv,
  exportPayloadPdf,
  type ExportFormat,
  type ExportReportType,
} from "./accountingExportEngine";
import { collectAccountingExportPayload } from "./accountingExportCollectors";
import {
  MONTH_NAMES,
  REPORTING_BASIS_OPTIONS,
  getDefaultReportingBasis,
  reportingBasisYearLabel,
  resolveReportingPeriod,
  type ReportingBasis,
} from "./accountingSettingsStorage";

type Props = {
  schoolId: string;
  learners?: any[];
  schoolName?: string;
};

const fieldStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  border: `1px solid ${ACCOUNTING_GOLD}`,
  fontWeight: 700,
  color: ACCOUNTING_INK,
  background: "#fff",
  minWidth: 140,
};

const goldBtn: React.CSSProperties = {
  padding: "10px 18px",
  borderRadius: 10,
  border: "1px solid #b89329",
  background: "linear-gradient(135deg, #f7d56a, #d4af37)",
  color: ACCOUNTING_INK,
  fontWeight: 900,
  cursor: "pointer",
};

const outlineBtn: React.CSSProperties = {
  ...goldBtn,
  background: "#fff",
  border: `2px solid ${ACCOUNTING_GOLD}`,
};

const disabledBtn: React.CSSProperties = {
  ...outlineBtn,
  opacity: 0.45,
  cursor: "not-allowed",
};

export default function AccountingExportCenter({ schoolId, learners = [], schoolName }: Props) {
  const now = new Date();
  const [reportType, setReportType] = useState<ExportReportType>("financial-statements");
  const [reportingBasis, setReportingBasis] = useState<ReportingBasis>(() =>
    schoolId ? getDefaultReportingBasis(schoolId) : "doe"
  );
  const [year, setYear] = useState(now.getFullYear());
  const [monthIndex, setMonthIndex] = useState(now.getMonth());
  const [format, setFormat] = useState<ExportFormat>("pdf");
  const [previewReady, setPreviewReady] = useState(false);
  const [previewHtml, setPreviewHtml] = useState("");
  const [payload, setPayload] = useState<ReturnType<typeof collectAccountingExportPayload> | null>(null);
  const [banner, setBanner] = useState("");

  const period = useMemo(
    () => resolveReportingPeriod(reportingBasis, year, monthIndex),
    [reportingBasis, year, monthIndex]
  );

  const yearOptions = useMemo(() => {
    const current = new Date().getFullYear();
    return Array.from({ length: 6 }, (_, i) => current - i);
  }, []);

  const handleGeneratePreview = () => {
    if (!schoolId) {
      setBanner("Select a school before generating exports.");
      return;
    }
    setBanner("");
    const next = collectAccountingExportPayload({
      schoolId,
      learners,
      schoolName,
      reportType,
      reportingBasis,
      year,
      monthIndex,
    });
    setPayload(next);
    setPreviewHtml(buildReportHtml(next));
    setPreviewReady(true);
  };

  const handleExport = () => {
    if (!payload || !previewReady) {
      setBanner("Generate a preview first.");
      return;
    }
    setBanner("");
    if (format === "pdf") {
      if (!exportPayloadPdf(payload)) {
        setBanner("Pop-up blocked. Allow pop-ups to export PDF.");
      }
      return;
    }
    exportPayloadCsv(payload);
  };

  const handlePrint = () => {
    if (!payload || !previewReady) {
      setBanner("Generate a preview first.");
      return;
    }
    exportPayloadPdf(payload);
  };

  return (
    <div style={accountingPageWrap}>
      <div style={{ borderBottom: `2px solid ${ACCOUNTING_GOLD}`, paddingBottom: 18, marginBottom: 24 }}>
        <h1 style={accountingTitle}>Export Center</h1>
        <p style={accountingSubtitle}>
          Generate professional PDF and Excel-ready accounting reports.
        </p>
      </div>

      {banner ? (
        <div
          style={{
            marginBottom: 16,
            padding: 12,
            borderRadius: 10,
            background: "#fffbeb",
            border: `1px solid ${ACCOUNTING_GOLD}`,
            color: "#92400e",
            fontWeight: 700,
          }}
        >
          {banner}
        </div>
      ) : null}

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 14,
          alignItems: "flex-end",
          marginBottom: 20,
        }}
      >
        <label style={{ display: "grid", gap: 6, fontWeight: 800, fontSize: 12, color: "#64748b" }}>
          Report type
          <select
            style={{ ...fieldStyle, minWidth: 240 }}
            value={reportType}
            onChange={(e) => {
              setReportType(e.target.value as ExportReportType);
              setPreviewReady(false);
            }}
          >
            {EXPORT_REPORT_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "grid", gap: 6, fontWeight: 800, fontSize: 12, color: "#64748b" }}>
          Reporting basis
          <select
            style={{ ...fieldStyle, minWidth: 240 }}
            value={reportingBasis}
            onChange={(e) => {
              setReportingBasis(e.target.value as ReportingBasis);
              setPreviewReady(false);
            }}
          >
            {REPORTING_BASIS_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "grid", gap: 6, fontWeight: 800, fontSize: 12, color: "#64748b" }}>
          {reportingBasisYearLabel(reportingBasis)}
          <select
            style={fieldStyle}
            value={year}
            onChange={(e) => {
              setYear(Number(e.target.value));
              setPreviewReady(false);
            }}
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {reportingBasis === "sars" ? `Feb ${y}` : y}
              </option>
            ))}
          </select>
        </label>
        {reportingBasis === "month" ? (
          <label style={{ display: "grid", gap: 6, fontWeight: 800, fontSize: 12, color: "#64748b" }}>
            Month
            <select
              style={fieldStyle}
              value={monthIndex}
              onChange={(e) => {
                setMonthIndex(Number(e.target.value));
                setPreviewReady(false);
              }}
            >
              {MONTH_NAMES.map((name, idx) => (
                <option key={name} value={idx}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label style={{ display: "grid", gap: 6, fontWeight: 800, fontSize: 12, color: "#64748b" }}>
          Format
          <select
            style={fieldStyle}
            value={format}
            onChange={(e) => setFormat(e.target.value as ExportFormat)}
          >
            <option value="pdf">PDF (print)</option>
            <option value="csv">Excel CSV</option>
          </select>
        </label>
        <div style={{ fontWeight: 800, fontSize: 13, color: ACCOUNTING_INK, paddingBottom: 10 }}>
          Period: {period.label}
        </div>
        <button type="button" style={goldBtn} onClick={handleGeneratePreview}>
          Generate preview
        </button>
        <button
          type="button"
          style={previewReady ? outlineBtn : disabledBtn}
          onClick={handleExport}
          disabled={!previewReady}
        >
          Download / Export
        </button>
        <button
          type="button"
          style={previewReady ? outlineBtn : disabledBtn}
          onClick={handlePrint}
          disabled={!previewReady}
        >
          Print
        </button>
      </div>

      <div style={{ ...accountingCard, marginBottom: 20 }}>
        <h2 style={{ margin: "0 0 12px", fontSize: 17, fontWeight: 900, color: ACCOUNTING_INK }}>
          Export preview
        </h2>
        {!previewReady ? (
          <p style={{ margin: 0, color: "#64748b", fontWeight: 600 }}>
            Choose report settings and click <strong>Generate preview</strong> to see the branded report here.
          </p>
        ) : (
          <iframe
            title="Export preview"
            srcDoc={previewHtml}
            style={{
              width: "100%",
              minHeight: 520,
              border: `1px solid ${ACCOUNTING_GOLD}`,
              borderRadius: 10,
              background: "#fff",
            }}
          />
        )}
      </div>
    </div>
  );
}
