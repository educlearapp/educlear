import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchBankImports, type BankImportRecord } from "../banking/bankingApi";
import { BILLING_UPDATED_EVENT, getBillingRows } from "../billing/billingLedger";
import { ACCOUNTING_ASSETS_UPDATED_EVENT } from "./accountingAssetStorage";
import {
  ACCOUNTING_SETTINGS_UPDATED_EVENT,
  loadAccountingSettings,
  MONTH_NAMES,
  REPORTING_BASIS_OPTIONS,
  reportingBasisYearLabel,
  resolveReportingPeriod,
  type ReportingBasis,
} from "./accountingSettingsStorage";
import { ACCOUNTING_AUDIT_COMPLIANCE_UPDATED_EVENT } from "./accountingAuditComplianceStorage";
import { ACCOUNTING_EXPENSES_UPDATED_EVENT } from "./accountingExpenseStorage";
import { CREDITORS_UPDATED_EVENT } from "./accountingCreditorsHelpers";
import { ACCOUNTING_JOURNALS_UPDATED_EVENT } from "./accountingJournalStorage";
import {
  buildComplianceChecks,
  buildComplianceMetrics,
  COMPLIANCE_REFRESH_EVENTS,
  listMergedAuditTrail,
  recordPeriodLockAudit,
  resolveReportingBasisSummary,
} from "./accountingAuditComplianceHelpers";
import {
  appendAuditTrailEntry,
  AUDIT_PACK_ITEMS,
  loadAuditPackStore,
  loadLockedPeriods,
  loadSupportingDocuments,
  markAllAuditPackPrepared,
  markAuditPackItemPrepared,
  saveLockedPeriods,
  saveSupportingDocuments,
  SUPPORTING_DOC_TYPES,
  type AuditPackItemId,
  type LockedPeriodRecord,
  type LockedPeriodType,
  type SupportingDocument,
  type SupportingDocumentType,
} from "./accountingAuditComplianceStorage";
import {
  ACCOUNTING_GOLD,
  ACCOUNTING_INK,
  accountingCard,
  accountingPageWrap,
  accountingSubtitle,
  accountingTitle,
} from "./accountingTheme";

type Props = {
  schoolId: string;
  schoolName?: string;
  learners?: any[];
};

type TabId =
  | "audit-trail"
  | "period-locks"
  | "compliance-checks"
  | "supporting-documents"
  | "audit-pack"
  | "sars-doe"
  | "reconciliation";

const TABS: { id: TabId; label: string }[] = [
  { id: "audit-trail", label: "Audit Trail" },
  { id: "period-locks", label: "Period Locks" },
  { id: "compliance-checks", label: "Compliance Checks" },
  { id: "supporting-documents", label: "Supporting Documents" },
  { id: "audit-pack", label: "Audit Pack" },
  { id: "sars-doe", label: "SARS & DOE" },
  { id: "reconciliation", label: "Reconciliation Status" },
];

const PAGE_SIZE = 10;

const fieldStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: `1px solid ${ACCOUNTING_GOLD}`,
  fontWeight: 700,
  color: ACCOUNTING_INK,
  background: "#fff",
  boxSizing: "border-box",
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

const th: React.CSSProperties = {
  padding: "10px 12px",
  textAlign: "left",
  fontSize: 11,
  fontWeight: 900,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  color: ACCOUNTING_GOLD,
  background: ACCOUNTING_INK,
  borderBottom: `2px solid ${ACCOUNTING_GOLD}`,
};

const td: React.CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid #f1f5f9",
  fontSize: 13,
  fontWeight: 600,
  color: ACCOUNTING_INK,
};

const summaryGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(185px, 1fr))",
  gap: 16,
  marginBottom: 24,
  alignItems: "stretch",
};

const summaryCard: React.CSSProperties = {
  ...accountingCard,
  boxSizing: "border-box",
  minHeight: 124,
  height: "100%",
  padding: "18px 20px",
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  justifyContent: "space-between",
};

const summaryLabel: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 800,
  color: "#64748b",
  textTransform: "uppercase",
  letterSpacing: "0.07em",
  lineHeight: 1.25,
  marginBottom: 8,
};

const summaryValue: React.CSSProperties = {
  fontSize: "clamp(1.35rem, 1.6vw, 2rem)",
  lineHeight: 1.1,
  fontWeight: 700,
  letterSpacing: "-0.02em",
  fontVariantNumeric: "tabular-nums",
  color: ACCOUNTING_INK,
};

const tabBar: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
  marginBottom: 20,
  borderBottom: `2px solid ${ACCOUNTING_GOLD}`,
  paddingBottom: 4,
};

const paginationWrap: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 12,
  padding: "14px 16px",
  borderTop: `1px solid ${ACCOUNTING_GOLD}`,
  background: "#faf8f0",
};

function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function formatDateTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" });
}

function formatDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-ZA", { dateStyle: "medium" });
}

function paginate<T>(rows: T[], page: number, pageSize = PAGE_SIZE) {
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  return { rows: rows.slice(start, start + pageSize), totalPages, safePage };
}

function PaginationBar({
  page,
  totalPages,
  totalRows,
  onPage,
}: {
  page: number;
  totalPages: number;
  totalRows: number;
  onPage: (p: number) => void;
}) {
  if (totalRows <= PAGE_SIZE) return null;
  return (
    <div style={paginationWrap}>
      <button type="button" style={outlineBtn} disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </button>
      <span style={{ fontWeight: 800, fontSize: 13 }}>
        Page {page} of {totalPages} · {totalRows} rows
      </span>
      <button type="button" style={outlineBtn} disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
        Next
      </button>
    </div>
  );
}

function severityIcon(severity: "low" | "medium" | "high") {
  if (severity === "high") return "🔴";
  if (severity === "medium") return "🟠";
  return "🟢";
}

function openPrintReport(title: string, htmlBody: string, schoolName: string) {
  const w = window.open("", "_blank");
  if (!w) {
    alert("Pop-up blocked. Allow pop-ups to print the compliance report.");
    return;
  }
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${title}</title>
<style>
  body { font-family: system-ui, sans-serif; color: #111827; margin: 28px; line-height: 1.5; }
  h1 { font-size: 22px; margin: 0 0 8px; }
  .meta { color: #64748b; font-size: 13px; margin-bottom: 20px; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th, td { border: 1px solid #e5e7eb; padding: 8px 10px; text-align: left; font-size: 13px; }
  th { background: #111827; color: #d4af37; }
</style></head><body>
<h1>${title}</h1>
<p class="meta">${schoolName} · Printed ${new Date().toLocaleString("en-ZA")}</p>
${htmlBody}
</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 400);
}

export default function AccountingAuditCompliance({ schoolId, schoolName, learners }: Props) {
  const printRef = useRef<HTMLDivElement>(null);
  const now = new Date();
  const [tab, setTab] = useState<TabId>("audit-trail");
  const [refreshKey, setRefreshKey] = useState(0);
  const [bankImports, setBankImports] = useState<BankImportRecord[]>([]);
  const [auditPage, setAuditPage] = useState(1);
  const [locksPage, setLocksPage] = useState(1);
  const [docsPage, setDocsPage] = useState(1);
  const [banner, setBanner] = useState("");

  const [lockModalOpen, setLockModalOpen] = useState(false);
  const [reopenModalOpen, setReopenModalOpen] = useState(false);
  const [docModalOpen, setDocModalOpen] = useState(false);

  const [lockType, setLockType] = useState<LockedPeriodType>("month");
  const [lockYear, setLockYear] = useState(now.getFullYear());
  const [lockMonth, setLockMonth] = useState(now.getMonth());
  const [lockUser, setLockUser] = useState("Finance User");

  const [reopenTargetId, setReopenTargetId] = useState("");
  const [reopenReason, setReopenReason] = useState("");
  const [reopenConfirm, setReopenConfirm] = useState(false);

  const [docTitle, setDocTitle] = useState("");
  const [docType, setDocType] = useState<SupportingDocumentType>("Audit Evidence");
  const [docModule, setDocModule] = useState("General");
  const [docNotes, setDocNotes] = useState("");

  const [reportYear, setReportYear] = useState(now.getFullYear());
  const [reportMonth, setReportMonth] = useState(now.getMonth());
  const [reportBasis, setReportBasis] = useState<ReportingBasis>("doe");

  const bump = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    const handler = () => bump();
    for (const evt of COMPLIANCE_REFRESH_EVENTS) {
      window.addEventListener(evt, handler);
    }
    window.addEventListener(ACCOUNTING_SETTINGS_UPDATED_EVENT, handler);
    return () => {
      for (const evt of COMPLIANCE_REFRESH_EVENTS) {
        window.removeEventListener(evt, handler);
      }
      window.removeEventListener(ACCOUNTING_SETTINGS_UPDATED_EVENT, handler);
    };
  }, [bump]);

  useEffect(() => {
    if (!schoolId) {
      setBankImports([]);
      return;
    }
    let cancelled = false;
    fetchBankImports(schoolId)
      .then((res) => {
        if (!cancelled && res?.success) setBankImports(Array.isArray(res.imports) ? res.imports : []);
      })
      .catch(() => {
        if (!cancelled) setBankImports([]);
      });
    return () => {
      cancelled = true;
    };
  }, [schoolId, refreshKey]);

  useEffect(() => {
    const settings = loadAccountingSettings(schoolId);
    setReportBasis(settings.financialYears.defaultReportBasis || "doe");
  }, [schoolId, refreshKey]);

  const statementRows = useMemo(
    () => getBillingRows(learners || [], schoolId || ""),
    [learners, schoolId, refreshKey]
  );

  const metrics = useMemo(
    () => buildComplianceMetrics(schoolId, statementRows, bankImports),
    [schoolId, statementRows, bankImports, refreshKey]
  );

  const complianceChecks = useMemo(() => buildComplianceChecks(metrics), [metrics]);
  const hasHighSeverity = complianceChecks.some((c) => c.severity === "high" && (c.count === undefined || c.count > 0));

  const auditTrail = useMemo(() => listMergedAuditTrail(schoolId), [schoolId, refreshKey]);
  const auditPaged = useMemo(() => paginate(auditTrail, auditPage), [auditTrail, auditPage]);

  const lockedPeriods = useMemo(() => loadLockedPeriods(schoolId), [schoolId, refreshKey]);
  const locksPaged = useMemo(() => paginate(lockedPeriods, locksPage), [lockedPeriods, locksPage]);

  const supportingDocs = useMemo(() => loadSupportingDocuments(schoolId), [schoolId, refreshKey]);
  const docsPaged = useMemo(() => paginate(supportingDocs, docsPage), [supportingDocs, docsPage]);

  const auditPack = useMemo(() => loadAuditPackStore(schoolId), [schoolId, refreshKey]);

  const reportingSummary = useMemo(
    () => resolveReportingBasisSummary(schoolId, reportBasis, reportYear, reportMonth),
    [schoolId, reportBasis, reportYear, reportMonth, refreshKey]
  );

  const activeLocks = lockedPeriods.filter((p) => p.status === "locked");

  const summaryCards = [
    { label: "Open Audit Items", value: String(metrics.openAuditItems) },
    { label: "Locked Periods", value: String(metrics.lockedPeriods) },
    { label: "Unreconciled Bank Items", value: String(metrics.unreconciledBankItems) },
    { label: "Unposted Journals", value: String(metrics.unpostedJournals) },
    { label: "Overdue Debtors", value: String(metrics.overdueDebtors) },
    { label: "Overdue Creditors", value: String(metrics.overdueCreditors) },
  ];

  const handleLockPeriod = () => {
    const sid = String(schoolId || "").trim();
    if (!sid) return;

    let periodKey = "";
    let label = "";
    if (lockType === "month") {
      periodKey = `${lockYear}-${String(lockMonth + 1).padStart(2, "0")}`;
      label = `${MONTH_NAMES[lockMonth]} ${lockYear}`;
    } else if (lockType === "doe") {
      periodKey = `doe-${lockYear}`;
      label = `DOE · ${resolveReportingPeriod("doe", lockYear, 0).label}`;
    } else {
      periodKey = `sars-${lockYear}`;
      label = `SARS · ${resolveReportingPeriod("sars", lockYear, 0).label}`;
    }

    const existing = lockedPeriods.find(
      (p) => p.periodType === lockType && p.periodKey === periodKey && p.status === "locked"
    );
    if (existing) {
      setBanner("This period is already locked.");
      return;
    }

    const record: LockedPeriodRecord = {
      id: uid("lock"),
      periodType: lockType,
      periodKey,
      label,
      status: "locked",
      lockedBy: lockUser.trim() || "Finance User",
      lockedAt: new Date().toISOString(),
    };

    saveLockedPeriods(sid, [record, ...lockedPeriods]);
    recordPeriodLockAudit(sid, "Locked period", label, `Locked ${lockType} period ${periodKey}`, record.lockedBy);
    setLockModalOpen(false);
    setBanner(`Period locked: ${label}`);
    bump();
  };

  const handleReopenPeriod = () => {
    const sid = String(schoolId || "").trim();
    if (!sid || !reopenTargetId) return;
    if (!reopenReason.trim()) {
      setBanner("Reopen reason is required.");
      return;
    }
    if (!reopenConfirm) {
      setBanner("Please confirm you understand this will allow modifications to a closed period.");
      return;
    }

    const target = lockedPeriods.find((p) => p.id === reopenTargetId);
    if (!target || target.status !== "locked") {
      setBanner("Select a valid locked period to reopen.");
      return;
    }

    const updated = lockedPeriods.map((p) =>
      p.id === reopenTargetId
        ? {
            ...p,
            status: "reopened" as const,
            reopenedBy: lockUser.trim() || "Finance User",
            reopenedAt: new Date().toISOString(),
            reopenReason: reopenReason.trim(),
          }
        : p
    );

    saveLockedPeriods(sid, updated);
    recordPeriodLockAudit(
      sid,
      "Reopened period",
      target.label,
      `Reason: ${reopenReason.trim()}`,
      lockUser.trim() || "Finance User"
    );
    setReopenModalOpen(false);
    setReopenTargetId("");
    setReopenReason("");
    setReopenConfirm(false);
    setBanner(`Period reopened: ${target.label}`);
    bump();
  };

  const handleAddDocument = () => {
    const sid = String(schoolId || "").trim();
    if (!sid || !docTitle.trim()) {
      setBanner("Document title is required.");
      return;
    }
    const doc: SupportingDocument = {
      id: uid("doc"),
      title: docTitle.trim(),
      documentType: docType,
      linkedModule: docModule.trim() || "General",
      notes: docNotes.trim(),
      uploadedDate: new Date().toISOString().slice(0, 10),
      createdAt: new Date().toISOString(),
    };
    saveSupportingDocuments(sid, [doc, ...supportingDocs]);
    appendAuditTrailEntry(sid, {
      user: lockUser.trim() || "Finance User",
      module: "Audit & Compliance",
      action: "Supporting document registered",
      reference: doc.title,
      details: `${doc.documentType} · ${doc.linkedModule} (local registry placeholder)`,
      sourceKey: `doc:${doc.id}`,
    });
    setDocModalOpen(false);
    setDocTitle("");
    setDocNotes("");
    setBanner("Supporting document registered locally.");
    bump();
  };

  const handleGenerateAuditPack = () => {
    markAllAuditPackPrepared(schoolId, lockUser.trim() || "Finance User");
    setBanner("Audit pack checklist marked as prepared.");
    bump();
  };

  const handleExportCompliance = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      schoolId,
      schoolName: schoolName || "School",
      metrics,
      complianceChecks,
      lockedPeriods: activeLocks,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `compliance-report-${schoolId || "school"}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setBanner("Compliance report exported (JSON).");
  };

  const handlePrint = () => {
    const school = schoolName || "School";
    let body = "";
    if (tab === "audit-trail") {
      body = `<table><thead><tr><th>Date</th><th>Module</th><th>Action</th><th>Reference</th><th>User</th><th>Details</th></tr></thead><tbody>${auditTrail
        .map(
          (r) =>
            `<tr><td>${formatDateTime(r.timestamp)}</td><td>${r.module}</td><td>${r.action}</td><td>${r.reference}</td><td>${r.user}</td><td>${r.details}</td></tr>`
        )
        .join("")}</tbody></table>`;
    } else if (tab === "compliance-checks") {
      body = `<table><thead><tr><th>Issue</th><th>Severity</th><th>Count</th><th>Action</th></tr></thead><tbody>${complianceChecks
        .map(
          (c) =>
            `<tr><td>${c.issue}</td><td>${c.severity}</td><td>${c.count ?? "—"}</td><td>${c.recommendedAction}</td></tr>`
        )
        .join("")}</tbody></table>`;
    } else if (tab === "reconciliation") {
      body = `<ul>${[
        `Unreconciled bank lines: ${metrics.unreconciledBankItems}`,
        `Unposted journals: ${metrics.unpostedJournals}`,
        `Expense candidates: ${metrics.expenseCandidates}`,
        `Overdue debtors: ${metrics.overdueDebtors}`,
        `Overdue creditors: ${metrics.overdueCreditors}`,
        `Supplier payment plans: ${metrics.supplierPaymentPlans}`,
      ]
        .map((l) => `<li>${l}</li>`)
        .join("")}</ul>`;
    } else {
      body = printRef.current?.innerHTML || "<p>Audit & Compliance summary</p>";
    }
    openPrintReport("Audit & Compliance Report", body, school);
  };

  const yearOptions = useMemo(() => {
    const y = new Date().getFullYear();
    return [y - 2, y - 1, y, y + 1];
  }, []);

  return (
    <div style={accountingPageWrap} className="accounting-audit-compliance">
      <div style={{ borderBottom: `2px solid ${ACCOUNTING_GOLD}`, paddingBottom: 18, marginBottom: 24 }}>
        <h1 style={accountingTitle}>Audit & Compliance</h1>
        <p style={accountingSubtitle}>
          Manage audit readiness, financial controls, reconciliations, period locks, and compliance reporting.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 18 }}>
          <button type="button" style={goldBtn} onClick={() => setLockModalOpen(true)}>
            Lock Period
          </button>
          <button
            type="button"
            style={outlineBtn}
            onClick={() => {
              setReopenModalOpen(true);
              setReopenTargetId(activeLocks[0]?.id || "");
            }}
            disabled={!activeLocks.length}
          >
            Reopen Period
          </button>
          <button type="button" style={goldBtn} onClick={handleGenerateAuditPack}>
            Generate Audit Pack
          </button>
          <button type="button" style={outlineBtn} onClick={handleExportCompliance}>
            Export Compliance Report
          </button>
          <button type="button" style={outlineBtn} onClick={handlePrint}>
            Print
          </button>
        </div>
        {banner ? (
          <div
            style={{
              marginTop: 14,
              padding: 12,
              borderRadius: 10,
              background: "#fffbeb",
              border: `1px solid ${ACCOUNTING_GOLD}`,
              fontWeight: 700,
              fontSize: 14,
            }}
          >
            {banner}
          </div>
        ) : null}
      </div>

      <div style={summaryGrid}>
        {summaryCards.map((card) => (
          <div key={card.label} style={summaryCard}>
            <div style={summaryLabel}>{card.label}</div>
            <div style={summaryValue}>{card.value}</div>
          </div>
        ))}
      </div>

      <div style={tabBar}>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            style={{
              padding: "10px 16px",
              borderRadius: "10px 10px 0 0",
              border: "none",
              borderBottom: tab === t.id ? `3px solid ${ACCOUNTING_GOLD}` : "3px solid transparent",
              background: tab === t.id ? "rgba(212,175,55,0.15)" : "transparent",
              fontWeight: 900,
              color: ACCOUNTING_INK,
              cursor: "pointer",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div ref={printRef} style={{ ...accountingCard, padding: 0, overflow: "hidden" }}>
        {tab === "audit-trail" && (
          <>
            <div style={{ padding: "16px 20px", borderBottom: `1px solid ${ACCOUNTING_GOLD}`, background: "#faf8f0" }}>
              <strong>Accounting action history</strong>
              <span style={{ marginLeft: 8, color: "#64748b", fontWeight: 600, fontSize: 13 }}>
                Journal events sync from Journals module audit log.
              </span>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
                <thead>
                  <tr>
                    {["Date", "Module", "Action", "Reference", "User", "Details"].map((h) => (
                      <th key={h} style={th}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {!auditPaged.rows.length ? (
                    <tr>
                      <td colSpan={6} style={{ ...td, textAlign: "center", color: "#64748b" }}>
                        No audit trail entries yet. Post journals or lock periods to build history.
                      </td>
                    </tr>
                  ) : (
                    auditPaged.rows.map((row) => (
                      <tr key={row.id}>
                        <td style={td}>{formatDateTime(row.timestamp)}</td>
                        <td style={td}>{row.module}</td>
                        <td style={td}>{row.action}</td>
                        <td style={td}>{row.reference}</td>
                        <td style={td}>{row.user}</td>
                        <td style={td}>{row.details}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <PaginationBar
              page={auditPaged.safePage}
              totalPages={auditPaged.totalPages}
              totalRows={auditTrail.length}
              onPage={setAuditPage}
            />
          </>
        )}

        {tab === "period-locks" && (
          <>
            <div style={{ padding: 16, background: "#fffbeb", borderBottom: `1px solid ${ACCOUNTING_GOLD}`, fontWeight: 600, fontSize: 13 }}>
              Locked periods prevent accidental financial modifications after month-end or year-end close.
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Period", "Type", "Status", "Locked by", "Locked date", "Reopen"].map((h) => (
                      <th key={h} style={th}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {!locksPaged.rows.length ? (
                    <tr>
                      <td colSpan={6} style={{ ...td, textAlign: "center", color: "#64748b" }}>
                        No period locks recorded. Use Lock Period to close a month or financial year.
                      </td>
                    </tr>
                  ) : (
                    locksPaged.rows.map((row) => (
                      <tr key={row.id}>
                        <td style={td}>{row.label}</td>
                        <td style={td}>{row.periodType.toUpperCase()}</td>
                        <td style={td}>
                          <span
                            style={{
                              display: "inline-block",
                              padding: "4px 10px",
                              borderRadius: 999,
                              fontSize: 11,
                              fontWeight: 900,
                              background: row.status === "locked" ? "rgba(212,175,55,0.25)" : "#f1f5f9",
                              color: ACCOUNTING_INK,
                            }}
                          >
                            {row.status === "locked" ? "Locked" : "Reopened"}
                          </span>
                        </td>
                        <td style={td}>{row.lockedBy}</td>
                        <td style={td}>{formatDate(row.lockedAt)}</td>
                        <td style={td}>
                          {row.status === "locked" ? (
                            <button
                              type="button"
                              style={{ ...outlineBtn, padding: "6px 12px", fontSize: 12 }}
                              onClick={() => {
                                setReopenTargetId(row.id);
                                setReopenModalOpen(true);
                              }}
                            >
                              Reopen
                            </button>
                          ) : (
                            <span style={{ fontSize: 12, color: "#64748b" }}>{row.reopenReason || "—"}</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <PaginationBar
              page={locksPaged.safePage}
              totalPages={locksPaged.totalPages}
              totalRows={lockedPeriods.length}
              onPage={setLocksPage}
            />
          </>
        )}

        {tab === "compliance-checks" && (
          <div style={{ padding: 20 }}>
            {hasHighSeverity ? (
              <div
                style={{
                  padding: 14,
                  borderRadius: 10,
                  background: "#fef2f2",
                  border: "1px solid #fecaca",
                  color: "#b91c1c",
                  fontWeight: 800,
                  marginBottom: 16,
                }}
              >
                High-severity compliance issues require attention before audit sign-off.
              </div>
            ) : null}
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["", "Issue", "Severity", "Count", "Recommended action"].map((h) => (
                    <th key={h || "icon"} style={th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {complianceChecks.map((check) => (
                  <tr key={check.id}>
                    <td style={td}>{severityIcon(check.severity)}</td>
                    <td style={td}>{check.issue}</td>
                    <td style={{ ...td, textTransform: "capitalize" }}>{check.severity}</td>
                    <td style={td}>{check.count !== undefined ? check.count : "—"}</td>
                    <td style={td}>{check.recommendedAction}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === "supporting-documents" && (
          <>
            <div style={{ padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, borderBottom: `1px solid ${ACCOUNTING_GOLD}` }}>
              <span style={{ fontWeight: 700, fontSize: 13, color: "#64748b" }}>
                Local document registry — file upload backend coming in a future release.
              </span>
              <button type="button" style={goldBtn} onClick={() => setDocModalOpen(true)}>
                Add document
              </button>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Title", "Type", "Module", "Uploaded", "Notes"].map((h) => (
                      <th key={h} style={th}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {!docsPaged.rows.length ? (
                    <tr>
                      <td colSpan={5} style={{ ...td, textAlign: "center", color: "#64748b" }}>
                        No supporting documents registered.
                      </td>
                    </tr>
                  ) : (
                    docsPaged.rows.map((doc) => (
                      <tr key={doc.id}>
                        <td style={td}>{doc.title}</td>
                        <td style={td}>{doc.documentType}</td>
                        <td style={td}>{doc.linkedModule}</td>
                        <td style={td}>{formatDate(doc.uploadedDate)}</td>
                        <td style={td}>{doc.notes || "—"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <PaginationBar
              page={docsPaged.safePage}
              totalPages={docsPaged.totalPages}
              totalRows={supportingDocs.length}
              onPage={setDocsPage}
            />
          </>
        )}

        {tab === "audit-pack" && (
          <div style={{ padding: 20, display: "grid", gap: 14 }}>
            <p style={{ margin: 0, fontSize: 13, color: "#64748b", fontWeight: 600 }}>
              Prepare audit-ready packs. Export ZIP/PDF is a placeholder — use Print Checklist and individual accounting
              reports.
            </p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
                gap: 12,
              }}
            >
              {AUDIT_PACK_ITEMS.map((item) => {
                const state = auditPack.items[item.id];
                const prepared = Boolean(state?.prepared);
                return (
                  <div
                    key={item.id}
                    style={{
                      border: `1px solid ${ACCOUNTING_GOLD}`,
                      borderRadius: 12,
                      padding: 14,
                      background: prepared ? "rgba(212,175,55,0.08)" : "#fff",
                    }}
                  >
                    <div style={{ fontWeight: 900, marginBottom: 8 }}>{item.label}</div>
                    <div style={{ fontSize: 12, color: "#64748b", marginBottom: 10 }}>
                      {prepared
                        ? `Prepared ${state?.preparedAt ? formatDate(state.preparedAt) : ""} by ${state?.preparedBy || "—"}`
                        : "Not yet prepared"}
                    </div>
                    <button
                      type="button"
                      style={{ ...outlineBtn, padding: "8px 14px", fontSize: 12 }}
                      onClick={() => {
                        markAuditPackItemPrepared(schoolId, item.id as AuditPackItemId, lockUser.trim() || "Finance User");
                        setBanner(`${item.label} marked prepared.`);
                        bump();
                      }}
                    >
                      Prepare
                    </button>
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 8 }}>
              <button
                type="button"
                style={outlineBtn}
                onClick={() => {
                  const lines = AUDIT_PACK_ITEMS.map((i) => {
                    const s = auditPack.items[i.id];
                    return `<li>${i.label}: ${s?.prepared ? "Prepared" : "Pending"}</li>`;
                  }).join("");
                  openPrintReport("Audit Pack Checklist", `<ul>${lines}</ul>`, schoolName || "School");
                }}
              >
                Print Checklist
              </button>
              <button
                type="button"
                style={outlineBtn}
                onClick={() => setBanner("Export Pack — ZIP/PDF bundle coming in a future release.")}
              >
                Export Pack (placeholder)
              </button>
            </div>
          </div>
        )}

        {tab === "sars-doe" && (
          <div style={{ padding: 20, display: "grid", gap: 20 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 8 }}>
              <label style={{ fontWeight: 800 }}>
                Reporting basis
                <select
                  style={{ ...fieldStyle, width: "auto", minWidth: 200, marginLeft: 8 }}
                  value={reportBasis}
                  onChange={(e) => setReportBasis(e.target.value as ReportingBasis)}
                >
                  {REPORTING_BASIS_OPTIONS.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ fontWeight: 800 }}>
                Year
                <select
                  style={{ ...fieldStyle, width: "auto", marginLeft: 8 }}
                  value={reportYear}
                  onChange={(e) => setReportYear(Number(e.target.value))}
                >
                  {yearOptions.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
              <div style={{ ...accountingCard, padding: 20 }}>
                <h3 style={{ margin: "0 0 12px", fontWeight: 900 }}>Department of Education</h3>
                <ul style={{ margin: 0, paddingLeft: 18, fontWeight: 600, lineHeight: 1.9, fontSize: 14 }}>
                  <li>DOE financial year: {resolveReportingPeriod("doe", reportYear, 0).label}</li>
                  <li>Period: {reportingSummary.period.label}</li>
                  <li>Governance reporting readiness</li>
                  <li>Audit readiness checklist (Audit Pack tab)</li>
                  <li>School finance summaries via Financial Statements</li>
                </ul>
              </div>
              <div style={{ ...accountingCard, padding: 20 }}>
                <h3 style={{ margin: "0 0 12px", fontWeight: 900 }}>SARS</h3>
                <ul style={{ margin: 0, paddingLeft: 18, fontWeight: 600, lineHeight: 1.9, fontSize: 14 }}>
                  <li>Tax year: {resolveReportingPeriod("sars", reportYear, 0).label}</li>
                  <li>Default report basis: {reportingSummary.defaultBasis.toUpperCase()}</li>
                  <li>VAT-ready placeholders (configure in Settings)</li>
                  <li>PAYE / UIF placeholders (Payroll module)</li>
                  <li>Payroll reconciliation placeholder</li>
                </ul>
              </div>
            </div>
            <p style={{ margin: 0, fontSize: 12, color: "#64748b", fontWeight: 600 }}>
              Current reporting window: {reportingSummary.period.startDate} → {reportingSummary.period.endDate}
            </p>
          </div>
        )}

        {tab === "reconciliation" && (
          <div style={{ padding: 20 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
              {[
                { label: "Unreconciled bank lines", value: metrics.unreconciledBankItems },
                { label: "Unposted journals", value: metrics.unpostedJournals },
                { label: "Unbalanced journals", value: metrics.unbalancedJournals },
                { label: "Pending expenses", value: metrics.expenseCandidates },
                { label: "Overdue debtors", value: metrics.overdueDebtors },
                { label: "Overdue creditors", value: metrics.overdueCreditors },
                { label: "Supplier payment plans", value: metrics.supplierPaymentPlans },
              ].map((item) => (
                <div key={item.label} style={{ ...summaryCard, minHeight: 100 }}>
                  <div style={summaryLabel}>{item.label}</div>
                  <div style={summaryValue}>{item.value}</div>
                </div>
              ))}
            </div>
            <p style={{ marginTop: 16, fontSize: 13, color: "#64748b", fontWeight: 600 }}>
              Counts are sourced live from Banking, Journals, Expenses, Debtors, and Creditors modules (browser storage).
            </p>
          </div>
        )}
      </div>

      {lockModalOpen ? (
        <Modal title="Lock period" onClose={() => setLockModalOpen(false)}>
          <label style={{ display: "grid", gap: 6, fontWeight: 800 }}>
            Period type
            <select style={fieldStyle} value={lockType} onChange={(e) => setLockType(e.target.value as LockedPeriodType)}>
              <option value="month">Month</option>
              <option value="doe">DOE year</option>
              <option value="sars">SARS tax year</option>
            </select>
          </label>
          {lockType === "month" ? (
            <label style={{ display: "grid", gap: 6, fontWeight: 800 }}>
              Month
              <select style={fieldStyle} value={lockMonth} onChange={(e) => setLockMonth(Number(e.target.value))}>
                {MONTH_NAMES.map((m, i) => (
                  <option key={m} value={i}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label style={{ display: "grid", gap: 6, fontWeight: 800 }}>
            Year
            <select style={fieldStyle} value={lockYear} onChange={(e) => setLockYear(Number(e.target.value))}>
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "grid", gap: 6, fontWeight: 800 }}>
            Locked by
            <input style={fieldStyle} value={lockUser} onChange={(e) => setLockUser(e.target.value)} />
          </label>
          <button type="button" style={goldBtn} onClick={handleLockPeriod}>
            Confirm lock
          </button>
        </Modal>
      ) : null}

      {reopenModalOpen ? (
        <Modal title="Reopen period" onClose={() => setReopenModalOpen(false)}>
          <label style={{ display: "grid", gap: 6, fontWeight: 800 }}>
            Locked period
            <select style={fieldStyle} value={reopenTargetId} onChange={(e) => setReopenTargetId(e.target.value)}>
              <option value="">Select period</option>
              {activeLocks.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "grid", gap: 6, fontWeight: 800 }}>
            Reason (required)
            <textarea
              style={{ ...fieldStyle, minHeight: 80 }}
              value={reopenReason}
              onChange={(e) => setReopenReason(e.target.value)}
              placeholder="Explain why this closed period must be reopened…"
            />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700 }}>
            <input type="checkbox" checked={reopenConfirm} onChange={(e) => setReopenConfirm(e.target.checked)} />
            I confirm reopening may allow changes to closed financial data.
          </label>
          <button type="button" style={goldBtn} onClick={handleReopenPeriod}>
            Confirm reopen
          </button>
        </Modal>
      ) : null}

      {docModalOpen ? (
        <Modal title="Add supporting document" onClose={() => setDocModalOpen(false)}>
          <label style={{ display: "grid", gap: 6, fontWeight: 800 }}>
            Title
            <input style={fieldStyle} value={docTitle} onChange={(e) => setDocTitle(e.target.value)} />
          </label>
          <label style={{ display: "grid", gap: 6, fontWeight: 800 }}>
            Document type
            <select style={fieldStyle} value={docType} onChange={(e) => setDocType(e.target.value as SupportingDocumentType)}>
              {SUPPORTING_DOC_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "grid", gap: 6, fontWeight: 800 }}>
            Linked module
            <input style={fieldStyle} value={docModule} onChange={(e) => setDocModule(e.target.value)} />
          </label>
          <label style={{ display: "grid", gap: 6, fontWeight: 800 }}>
            Notes
            <textarea style={{ ...fieldStyle, minHeight: 70 }} value={docNotes} onChange={(e) => setDocNotes(e.target.value)} />
          </label>
          <button type="button" style={goldBtn} onClick={handleAddDocument}>
            Save document
          </button>
        </Modal>
      ) : null}
    </div>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.55)",
        zIndex: 8000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        style={{
          background: "#fff",
          border: `2px solid ${ACCOUNTING_GOLD}`,
          borderRadius: 14,
          padding: 24,
          width: "min(480px, 100%)",
          maxHeight: "90vh",
          overflow: "auto",
          display: "grid",
          gap: 14,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0, fontWeight: 900 }}>{title}</h2>
          <button type="button" style={outlineBtn} onClick={onClose}>
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
