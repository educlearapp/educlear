/**
 * Shared accounting export helpers — print-ready HTML and Excel-compatible CSV.
 * No PDF libraries; browser print / download only.
 */

export type ExportFormat = "pdf" | "csv";

export type ExportReportType =
  | "financial-statements"
  | "income-statement"
  | "balance-sheet"
  | "cash-flow"
  | "trial-balance"
  | "general-ledger"
  | "journals"
  | "debtors-ageing"
  | "creditors-ageing"
  | "assets-register"
  | "depreciation-schedule"
  | "budget-vs-actual"
  | "management-reports"
  | "audit-pack";

export const EXPORT_REPORT_OPTIONS: { id: ExportReportType; label: string }[] = [
  { id: "financial-statements", label: "Financial Statements" },
  { id: "income-statement", label: "Income Statement" },
  { id: "balance-sheet", label: "Balance Sheet" },
  { id: "cash-flow", label: "Cash Flow Statement" },
  { id: "trial-balance", label: "Trial Balance" },
  { id: "general-ledger", label: "General Ledger" },
  { id: "journals", label: "Journals" },
  { id: "debtors-ageing", label: "Debtors Ageing" },
  { id: "creditors-ageing", label: "Creditors Ageing" },
  { id: "assets-register", label: "Assets Register" },
  { id: "depreciation-schedule", label: "Depreciation Schedule" },
  { id: "budget-vs-actual", label: "Budget vs Actual" },
  { id: "management-reports", label: "Management Reports" },
  { id: "audit-pack", label: "Audit Pack Checklist" },
];

export const AUDIT_PACK_CHECKLIST_ITEMS = [
  "Financial Statements",
  "General Ledger",
  "Trial Balance",
  "Debtors Ageing",
  "Creditors Ageing",
  "Asset Register",
  "Depreciation Schedule",
  "Journals",
  "Bank Reconciliation",
  "Budget vs Actual",
] as const;

export type ExportBranding = {
  schoolName: string;
  schoolEmail?: string;
  logoUrl?: string;
};

export type ExportSummaryRow = {
  label: string;
  value: string;
};

export type ExportTableSection = {
  title?: string;
  columns: string[];
  rows: string[][];
};

export type ExportSection =
  | { kind: "summary"; title?: string; rows: ExportSummaryRow[] }
  | { kind: "table"; title?: string; columns: string[]; rows: string[][] }
  | { kind: "html"; title?: string; html: string }
  | { kind: "list"; title?: string; items: string[] };

export type AccountingExportPayload = {
  reportTitle: string;
  reportType?: ExportReportType;
  periodLabel: string;
  generatedAt: string;
  branding: ExportBranding;
  sections: ExportSection[];
  notes?: string[];
  /** When set, used as the complete print document (e.g. Financial Statements). */
  fullDocumentHtml?: string;
};

export function escapeExportHtml(value: string) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function formatExportMoney(value: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "R 0.00";
  return `R ${n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function resolveExportBranding(schoolName?: string): ExportBranding {
  const name =
    String(schoolName || "").trim() ||
    String(typeof localStorage !== "undefined" ? localStorage.getItem("schoolName") : "").trim() ||
    "School";
  const email =
    String(typeof localStorage !== "undefined" ? localStorage.getItem("schoolEmail") : "").trim() ||
    undefined;
  const logoUrl =
    String(typeof localStorage !== "undefined" ? localStorage.getItem("schoolLogoUrl") : "").trim() ||
    undefined;
  return { schoolName: name, schoolEmail: email || undefined, logoUrl: logoUrl || undefined };
}

export function buildReportHeader(payload: AccountingExportPayload) {
  const { branding, periodLabel, generatedAt, reportTitle } = payload;
  const logo = branding.logoUrl
    ? `<img class="logo" src="${escapeExportHtml(branding.logoUrl)}" alt="School logo"/>`
    : "";
  const emailLine = branding.schoolEmail
    ? `<div class="meta">${escapeExportHtml(branding.schoolEmail)}</div>`
    : "";
  return `<div class="header">
    <div class="header-row">
      ${logo}
      <div>
        <div class="school">${escapeExportHtml(branding.schoolName)}</div>
        ${emailLine}
        <div class="meta">Period: ${escapeExportHtml(periodLabel)} · Generated: ${escapeExportHtml(generatedAt)}</div>
      </div>
    </div>
    <h1>${escapeExportHtml(reportTitle)}</h1>
  </div>`;
}

export function buildReportFooter() {
  return `<div class="footer">Prepared by EduClear Accounting</div>`;
}

function renderSectionHtml(section: ExportSection): string {
  if (section.kind === "html") {
    const title = section.title ? `<h2>${escapeExportHtml(section.title)}</h2>` : "";
    return `${title}${section.html}`;
  }
  if (section.kind === "list") {
    const title = section.title ? `<h2>${escapeExportHtml(section.title)}</h2>` : "";
    const items = section.items.map((i) => `<li>${escapeExportHtml(i)}</li>`).join("");
    return `${title}<ul class="checklist">${items}</ul>`;
  }
  if (section.kind === "summary") {
    const title = section.title ? `<h2>${escapeExportHtml(section.title)}</h2>` : "";
    const rows = section.rows
      .map(
        (r) =>
          `<tr><td class="label">${escapeExportHtml(r.label)}</td><td class="value">${escapeExportHtml(r.value)}</td></tr>`
      )
      .join("");
    return `${title}<table class="summary"><tbody>${rows}</tbody></table>`;
  }
  const title = section.title ? `<h2>${escapeExportHtml(section.title)}</h2>` : "";
  const head = section.columns.map((c) => `<th>${escapeExportHtml(c)}</th>`).join("");
  const body = section.rows
    .map((row) => `<tr>${row.map((c) => `<td>${escapeExportHtml(c)}</td>`).join("")}</tr>`)
    .join("");
  return `${title}<table class="data"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

export function buildReportHtml(payload: AccountingExportPayload) {
  if (payload.fullDocumentHtml) return payload.fullDocumentHtml;
  const notes = (payload.notes || [])
    .map((n) => `<p class="note">${escapeExportHtml(n)}</p>`)
    .join("");
  const body = payload.sections.map(renderSectionHtml).join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${escapeExportHtml(payload.reportTitle)} — ${escapeExportHtml(payload.periodLabel)}</title>
<style>
  body { font-family: Georgia, "Times New Roman", serif; color: #111827; margin: 32px; line-height: 1.5; }
  .header { border-bottom: 2px solid #d4af37; padding-bottom: 16px; margin-bottom: 20px; }
  .header-row { display: flex; gap: 16px; align-items: center; }
  .logo { width: 72px; height: 72px; object-fit: contain; border: 1px solid #e5e7eb; border-radius: 8px; }
  .school { font-size: 20px; font-weight: 800; }
  .meta { color: #64748b; font-size: 13px; margin-top: 4px; }
  h1 { font-size: 22px; margin: 12px 0 0; }
  h2 { font-size: 16px; margin: 20px 0 10px; color: #111827; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; }
  table { width: 100%; border-collapse: collapse; margin: 10px 0 18px; font-size: 13px; }
  th { background: #111827; color: #d4af37; padding: 8px 10px; text-align: left; font-size: 11px; text-transform: uppercase; }
  td { padding: 8px 10px; border-bottom: 1px solid #f1f5f9; }
  table.summary td.label { font-weight: 600; width: 55%; }
  table.summary td.value { text-align: right; font-variant-numeric: tabular-nums; font-weight: 700; }
  ul.checklist { margin: 0; padding-left: 22px; line-height: 1.8; font-weight: 600; }
  .note { font-size: 12px; color: #64748b; margin-top: 16px; }
  .footer { margin-top: 28px; padding-top: 12px; border-top: 2px solid #d4af37; font-weight: 800; color: #b89329; }
  @media print { body { margin: 18px; } }
</style></head><body>
${buildReportHeader(payload)}
${body}
${notes}
${buildReportFooter()}
</body></html>`;
}

function csvEscape(value: string) {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function buildCsvContent(payload: AccountingExportPayload) {
  const lines: string[] = [];
  lines.push(csvEscape(payload.branding.schoolName));
  lines.push(csvEscape(payload.reportTitle));
  lines.push(csvEscape(`Period: ${payload.periodLabel}`));
  lines.push(csvEscape(`Generated: ${payload.generatedAt}`));
  lines.push("");

  for (const section of payload.sections) {
    if (section.kind === "html") continue;
    if (section.title) lines.push(csvEscape(section.title));
    if (section.kind === "list") {
      for (const item of section.items) lines.push(csvEscape(item));
      lines.push("");
      continue;
    }
    if (section.kind === "summary") {
      lines.push(csvEscape("Label") + "," + csvEscape("Value"));
      for (const row of section.rows) {
        lines.push(csvEscape(row.label) + "," + csvEscape(row.value));
      }
      lines.push("");
      continue;
    }
    if (section.kind === "table") {
      lines.push(section.columns.map(csvEscape).join(","));
      for (const row of section.rows) {
        lines.push(row.map(csvEscape).join(","));
      }
      lines.push("");
    }
  }

  lines.push(csvEscape("Prepared by EduClear Accounting"));
  return lines.join("\r\n");
}

export function downloadCsv(content: string, filename: string) {
  const blob = new Blob(["\ufeff", content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function openPrintWindow(html: string) {
  const w = window.open("", "_blank");
  if (!w) {
    alert("Pop-up blocked. Please allow pop-ups to print or save as PDF.");
    return false;
  }
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 400);
  return true;
}

export function exportPayloadPdf(payload: AccountingExportPayload) {
  return openPrintWindow(buildReportHtml(payload));
}

export function exportPayloadCsv(payload: AccountingExportPayload) {
  const safeTitle = payload.reportTitle.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-");
  const safePeriod = payload.periodLabel.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-");
  const filename = `${safeTitle || "report"}-${safePeriod || "export"}.csv`;
  downloadCsv(buildCsvContent(payload), filename);
}

export function slugReportFilename(title: string, periodLabel: string, ext: "csv" | "html" = "csv") {
  const safeTitle = title.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-");
  const safePeriod = periodLabel.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-");
  return `${safeTitle || "report"}-${safePeriod || "export"}.${ext}`;
}

export function payloadFromTable(
  branding: ExportBranding,
  reportTitle: string,
  periodLabel: string,
  generatedAt: string,
  table: ExportTableSection,
  summary?: ExportSummaryRow[]
): AccountingExportPayload {
  const sections: ExportSection[] = [];
  if (summary?.length) sections.push({ kind: "summary", title: "Summary", rows: summary });
  sections.push({ kind: "table", title: table.title, columns: table.columns, rows: table.rows });
  return {
    reportTitle,
    periodLabel,
    generatedAt,
    branding,
    sections,
    notes: ["Management report generated from EduClear accounting data."],
  };
}

export function payloadFromHtmlBody(
  branding: ExportBranding,
  reportTitle: string,
  periodLabel: string,
  generatedAt: string,
  htmlBody: string
): AccountingExportPayload {
  return {
    reportTitle,
    periodLabel,
    generatedAt,
    branding,
    sections: [{ kind: "html", html: htmlBody }],
    notes: ["Use your browser print dialog to save as PDF."],
  };
}

export function buildAuditPackPayload(
  branding: ExportBranding,
  periodLabel: string,
  generatedAt: string,
  checklistDetails: string[]
): AccountingExportPayload {
  return {
    reportTitle: "Audit Pack Checklist",
    reportType: "audit-pack",
    periodLabel,
    generatedAt,
    branding,
    sections: [
      {
        kind: "list",
        title: "Included documents",
        items: [...AUDIT_PACK_CHECKLIST_ITEMS],
      },
      {
        kind: "list",
        title: "Data availability",
        items: checklistDetails,
      },
    ],
    notes: [
      "This checklist reflects documents available in EduClear for the selected period.",
      "Export individual reports from their modules or use Export Center for each report type.",
    ],
  };
}
