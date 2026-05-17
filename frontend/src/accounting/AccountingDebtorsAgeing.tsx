import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchLegalDocumentHistory } from "../billing/billingApi";
import {
  BILLING_UPDATED_EVENT,
  formatMoney,
  getBillingRows,
  normaliseBillingAmount,
  type BillingAccountRow,
} from "../billing/billingLedger";
import {
  accountLookupKey,
  buildDebtorAgeingRows,
  DEBTORS_UPDATED_EVENT,
  getActiveArrangement,
  loadLegalHandovers,
  loadPaymentArrangements,
  loadRecoveryNotes,
  saveLegalHandovers,
  savePaymentArrangements,
  saveRecoveryNotes,
  statusColor,
  sumAgeingBuckets,
  type DebtorAgeingRow,
  type LegalHandover,
  type PaymentArrangement,
  type RecoveryNote,
  type RecoveryNoteType,
} from "./accountingDebtorsHelpers";
import {
  loadAccountingSettings,
  MONTH_NAMES,
  REPORTING_BASIS_OPTIONS,
  reportingBasisYearLabel,
  resolveReportingPeriod,
  type ReportingBasis,
} from "./accountingSettingsStorage";
import {
  ACCOUNTING_GOLD,
  ACCOUNTING_INK,
  accountingCard,
  accountingCardLabel,
  accountingCardValue,
  accountingPageWrap,
  accountingSubtitle,
  accountingTitle,
} from "./accountingTheme";
import {
  exportPayloadCsv,
  exportPayloadPdf,
  formatExportMoney,
  payloadFromTable,
  resolveExportBranding,
} from "./accountingExportEngine";

type Props = {
  schoolId: string;
  learners: any[];
  statementRows?: BillingAccountRow[];
  setActivePage?: (page: any) => void;
  onOpenLearner?: (learnerId: string) => void;
};

const PAGE_SIZE = 10;

const STATUS_FILTER_OPTIONS = [
  "All",
  "Up To Date",
  "Recently Owing",
  "Bad Debt",
  "Legal Recovery",
  "Payment Arrangement",
] as const;

const LEGAL_STAGE_FILTER_OPTIONS = [
  "All",
  "None",
  "Section 41",
  "Letter of Demand",
  "Final Demand",
  "Attorney Collection",
  "Collection Closed",
] as const;

const goldBtn: React.CSSProperties = {
  padding: "10px 18px",
  borderRadius: 10,
  border: "1px solid #b89329",
  background: "linear-gradient(135deg, #f7d56a, #d4af37)",
  color: ACCOUNTING_INK,
  fontWeight: 900,
  cursor: "pointer",
  fontSize: 14,
};

const outlineBtn: React.CSSProperties = {
  ...goldBtn,
  background: "#fff",
  border: `2px solid ${ACCOUNTING_GOLD}`,
};

const fieldStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  border: `1px solid ${ACCOUNTING_GOLD}`,
  fontWeight: 700,
  color: ACCOUNTING_INK,
  background: "#fff",
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
  whiteSpace: "nowrap",
};

const td: React.CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid #f1f5f9",
  fontSize: 13,
  fontWeight: 600,
  color: ACCOUNTING_INK,
  verticalAlign: "top",
};

const sectionCard: React.CSSProperties = {
  ...accountingCard,
  marginBottom: 20,
};

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(15,23,42,0.55)",
  zIndex: 6000,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 20,
};

const modalPanel: React.CSSProperties = {
  background: "#fff",
  border: `2px solid ${ACCOUNTING_GOLD}`,
  borderRadius: 14,
  width: "min(520px, 100%)",
  maxHeight: "90vh",
  overflow: "auto",
  padding: 24,
  boxShadow: "0 24px 60px rgba(0,0,0,0.25)",
};

function StatusPill({ status }: { status: string }) {
  const colors = statusColor(status as any);
  return (
    <span
      style={{
        display: "inline-block",
        padding: "4px 10px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 900,
        background: colors.bg,
        color: colors.text,
        border: `1px solid ${colors.border}`,
      }}
    >
      {status}
    </span>
  );
}

export default function AccountingDebtorsAgeing({
  schoolId,
  learners,
  statementRows: statementRowsProp,
  setActivePage,
  onOpenLearner,
}: Props) {
  const now = new Date();
  const settings = useMemo(() => loadAccountingSettings(schoolId), [schoolId]);
  const [reportingBasis, setReportingBasis] = useState<ReportingBasis>(
    settings.reports.defaultReportBasis || "month"
  );
  const [year, setYear] = useState(now.getFullYear());
  const [monthIndex, setMonthIndex] = useState(now.getMonth());
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("All");
  const [legalStageFilter, setLegalStageFilter] = useState<string>("All");
  const [generated, setGenerated] = useState(true);
  const [tablePage, setTablePage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);
  const [legalHistory, setLegalHistory] = useState<any[]>([]);
  const [banner, setBanner] = useState("");

  const [arrangementModal, setArrangementModal] = useState<DebtorAgeingRow | null>(null);
  const [handoverModal, setHandoverModal] = useState<DebtorAgeingRow | null>(null);
  const [notesModal, setNotesModal] = useState<DebtorAgeingRow | null>(null);
  const [detailRow, setDetailRow] = useState<DebtorAgeingRow | null>(null);

  const [arrAmount, setArrAmount] = useState(0);
  const [arrStart, setArrStart] = useState("");
  const [arrEnd, setArrEnd] = useState("");
  const [arrNotes, setArrNotes] = useState("");
  const [arrStatus, setArrStatus] = useState<PaymentArrangement["status"]>("Active");

  const [attorneyName, setAttorneyName] = useState("");
  const [handoverDate, setHandoverDate] = useState("");
  const [handoverContact, setHandoverContact] = useState("");
  const [handoverNotes, setHandoverNotes] = useState("");

  const [noteType, setNoteType] = useState<RecoveryNoteType>("note");
  const [noteDate, setNoteDate] = useState(new Date().toISOString().slice(0, 10));
  const [noteSummary, setNoteSummary] = useState("");

  const reportRef = useRef<HTMLDivElement>(null);

  const bumpRefresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    const onBilling = () => bumpRefresh();
    const onDebtors = (e: Event) => {
      const detail = (e as CustomEvent<{ schoolId?: string }>).detail;
      if (!detail?.schoolId || detail.schoolId === schoolId) bumpRefresh();
    };
    window.addEventListener(BILLING_UPDATED_EVENT, onBilling);
    window.addEventListener(DEBTORS_UPDATED_EVENT, onDebtors);
    return () => {
      window.removeEventListener(BILLING_UPDATED_EVENT, onBilling);
      window.removeEventListener(DEBTORS_UPDATED_EVENT, onDebtors);
    };
  }, [schoolId, bumpRefresh]);

  useEffect(() => {
    if (!schoolId) {
      setLegalHistory([]);
      return;
    }
    fetchLegalDocumentHistory(schoolId)
      .then((res) => setLegalHistory(Array.isArray(res?.history) ? res.history : []))
      .catch(() => setLegalHistory([]));
  }, [schoolId, refreshKey]);

  const period = useMemo(
    () => resolveReportingPeriod(reportingBasis, year, monthIndex),
    [reportingBasis, year, monthIndex]
  );

  const asOfDate = period.endDate;

  const statementRows = useMemo(() => {
    void refreshKey;
    if (statementRowsProp?.length) return statementRowsProp;
    return schoolId ? getBillingRows(learners, schoolId) : [];
  }, [statementRowsProp, learners, schoolId, refreshKey]);

  const arrangements = useMemo(() => {
    void refreshKey;
    return schoolId ? loadPaymentArrangements(schoolId) : [];
  }, [schoolId, refreshKey]);

  const handovers = useMemo(() => {
    void refreshKey;
    return schoolId ? loadLegalHandovers(schoolId) : [];
  }, [schoolId, refreshKey]);

  const allRows = useMemo(() => {
    if (!schoolId || !generated) return [];
    return buildDebtorAgeingRows({
      schoolId,
      statementRows,
      learners,
      legalHistory,
      arrangements,
      handovers,
      asOfDate,
    });
  }, [
    schoolId,
    generated,
    statementRows,
    learners,
    legalHistory,
    arrangements,
    handovers,
    asOfDate,
  ]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allRows.filter((row) => {
      if (statusFilter !== "All" && row.displayStatus !== statusFilter) return false;
      if (legalStageFilter !== "All" && row.legalStage !== legalStageFilter) return false;
      if (!q) return true;
      const hay = [
        row.accountNo,
        row.parentName,
        row.learnerName,
        row.grade,
        row.className,
        row.legalStage,
        ...row.legalTags,
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [allRows, search, statusFilter, legalStageFilter]);

  useEffect(() => {
    setTablePage(1);
  }, [search, statusFilter, legalStageFilter, generated, reportingBasis, year, monthIndex]);

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const safePage = Math.min(tablePage, pageCount);
  const pagedRows = filteredRows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const owingRows = allRows.filter((r) => r.outstandingBalance > 0);
  const bucketTotals = sumAgeingBuckets(owingRows);

  const totalOutstanding = owingRows.reduce(
    (s, r) => s + normaliseBillingAmount(r.outstandingBalance),
    0
  );

  const recentlyOwingCount = owingRows.filter((r) => r.displayStatus === "Recently Owing").length;
  const badDebtCount = owingRows.filter(
    (r) => r.displayStatus === "Bad Debt" && !r.arrangementActive
  ).length;
  const legalRecoveryCount = owingRows.filter((r) => r.displayStatus === "Legal Recovery").length;
  const arrangementCount = owingRows.filter((r) => r.arrangementActive).length;

  const topDebtors = [...owingRows]
    .sort((a, b) => b.outstandingBalance - a.outstandingBalance)
    .slice(0, 10);

  const legalAccounts = owingRows.filter(
    (r) => r.legalStage !== "None" || r.displayStatus === "Legal Recovery"
  );

  const recentlyPaid = allRows
    .filter((r) => r.lastPaymentDate)
    .sort((a, b) => (b.lastPaymentDate || "").localeCompare(a.lastPaymentDate || ""))
    .slice(0, 10);

  const noPayment60 = owingRows.filter(
    (r) => r.daysSincePayment === null || r.daysSincePayment >= 60
  );

  const openArrangementModal = (row: DebtorAgeingRow) => {
    const existing = getActiveArrangement(arrangements, row.learnerId, row.accountNo, asOfDate);
    setArrAmount(existing?.amount ?? row.outstandingBalance);
    setArrStart(existing?.startDate || asOfDate);
    setArrEnd(existing?.endDate || asOfDate);
    setArrNotes(existing?.notes || "");
    setArrStatus(existing?.status || "Active");
    setArrangementModal(row);
  };

  const saveArrangement = () => {
    if (!schoolId || !arrangementModal) return;
    const rows = loadPaymentArrangements(schoolId).filter(
      (a) =>
        !(
          a.learnerId === arrangementModal.learnerId &&
          a.accountNo === arrangementModal.accountNo &&
          a.status === "Active"
        )
    );
    rows.push({
      id: `arr-${Date.now()}`,
      learnerId: arrangementModal.learnerId,
      accountNo: arrangementModal.accountNo,
      amount: normaliseBillingAmount(arrAmount),
      startDate: arrStart,
      endDate: arrEnd,
      notes: arrNotes,
      status: arrStatus,
      createdAt: new Date().toISOString(),
    });
    savePaymentArrangements(schoolId, rows);
    setArrangementModal(null);
    bumpRefresh();
  };

  const openHandoverModal = (row: DebtorAgeingRow) => {
    setAttorneyName("");
    setHandoverDate(asOfDate);
    setHandoverContact("");
    setHandoverNotes("");
    setHandoverModal(row);
  };

  const saveHandover = () => {
    if (!schoolId || !handoverModal) return;
    const rows = loadLegalHandovers(schoolId);
    rows.push({
      id: `ho-${Date.now()}`,
      learnerId: handoverModal.learnerId,
      accountNo: handoverModal.accountNo,
      attorneyName,
      handedOverDate: handoverDate,
      contactDetails: handoverContact,
      notes: handoverNotes,
      status: "Active",
      createdAt: new Date().toISOString(),
    });
    saveLegalHandovers(schoolId, rows);
    setHandoverModal(null);
    bumpRefresh();
  };

  const markCollectionClosed = (row: DebtorAgeingRow) => {
    if (!schoolId) return;
    const rows = loadLegalHandovers(schoolId);
    rows.push({
      id: `closed-${Date.now()}`,
      learnerId: row.learnerId,
      accountNo: row.accountNo,
      attorneyName: "Internal",
      handedOverDate: asOfDate,
      contactDetails: "",
      notes: "Collection closed",
      status: "Closed",
      createdAt: new Date().toISOString(),
    });
    saveLegalHandovers(schoolId, rows);
    bumpRefresh();
  };

  const accountNotes = useMemo(() => {
    if (!schoolId || !notesModal) return [];
    const store = loadRecoveryNotes(schoolId);
    return store[accountLookupKey(notesModal.learnerId, notesModal.accountNo)] || [];
  }, [schoolId, notesModal, refreshKey]);

  const addRecoveryNote = () => {
    if (!schoolId || !notesModal || !noteSummary.trim()) return;
    const key = accountLookupKey(notesModal.learnerId, notesModal.accountNo);
    const store = loadRecoveryNotes(schoolId);
    const list = store[key] || [];
    const entry: RecoveryNote = {
      id: `note-${Date.now()}`,
      type: noteType,
      date: noteDate,
      summary: noteSummary.trim(),
      createdAt: new Date().toISOString(),
    };
    saveRecoveryNotes(schoolId, { ...store, [key]: [entry, ...list] });
    setNoteSummary("");
    bumpRefresh();
  };

  const handlePrint = () => {
    const el = reportRef.current;
    if (!el) return;
    const w = window.open("", "_blank");
    if (!w) {
      setBanner("Pop-up blocked. Allow pop-ups to print the debtors ageing report.");
      return;
    }
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Debtors Ageing — ${period.label}</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;color:#111827;margin:24px;line-height:1.45}
h1{font-size:22px;margin:0 0 6px}
.sub{color:#64748b;font-size:13px;margin-bottom:20px}
table{width:100%;border-collapse:collapse;margin:12px 0 20px;font-size:11px}
th,td{padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:left}
th{background:#111827;color:#d4af37;font-size:10px;text-transform:uppercase}
.cards{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:20px}
.card{border:1px solid #d4af37;border-radius:8px;padding:12px;min-width:140px}
.card label{font-size:10px;text-transform:uppercase;color:#64748b;font-weight:700}
.card div{font-size:18px;font-weight:900;margin-top:4px}
@media print { .no-print { display:none } }
</style></head><body>
<h1>Debtors Ageing</h1>
<div class="sub">Period: ${period.label} · As at ${asOfDate}</div>
${el.innerHTML}
</body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 400);
  };

  const buildDebtorsExportPayload = () => {
    if (!filteredRows.length) return null;
    return payloadFromTable(
      resolveExportBranding(),
      "Debtors Ageing",
      period.label,
      new Date().toLocaleString("en-ZA"),
      {
        columns: [
          "Account",
          "Learner",
          "Parent",
          "Balance",
          "Current",
          "30 Days",
          "60 Days",
          "90 Days",
          "120+",
          "Status",
        ],
        rows: filteredRows.map((r) => [
          r.accountNo,
          r.learnerName,
          r.parentName,
          formatExportMoney(r.outstandingBalance),
          formatExportMoney(r.ageing.current),
          formatExportMoney(r.ageing.days30),
          formatExportMoney(r.ageing.days60),
          formatExportMoney(r.ageing.days90),
          formatExportMoney(r.ageing.days120Plus),
          r.displayStatus,
        ]),
      },
      [{ label: "Accounts", value: String(filteredRows.length) }]
    );
  };

  const handleExportPdf = () => {
    const payload = buildDebtorsExportPayload();
    if (!payload) {
      setBanner("No debtor rows to export for the current filters.");
      return;
    }
    if (!exportPayloadPdf(payload)) setBanner("Pop-up blocked. Allow pop-ups to export PDF.");
    else setBanner("");
  };

  const handleExportExcel = () => {
    const payload = buildDebtorsExportPayload();
    if (!payload) {
      setBanner("No debtor rows to export for the current filters.");
      return;
    }
    exportPayloadCsv(payload);
    setBanner("");
  };

  const yearOptions = useMemo(() => {
    const current = new Date().getFullYear();
    return [current - 2, current - 1, current, current + 1];
  }, []);

  const viewAccount = (row: DebtorAgeingRow) => {
    if (onOpenLearner) {
      onOpenLearner(row.learnerId);
      return;
    }
    setDetailRow(row);
  };

  return (
    <div style={accountingPageWrap}>
      <div style={{ borderBottom: `2px solid ${ACCOUNTING_GOLD}`, paddingBottom: 18, marginBottom: 24 }}>
        <h1 style={accountingTitle}>Debtors Ageing</h1>
        <p style={accountingSubtitle}>
          Monitor overdue accounts, collection stages, and legal recovery status.
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
            fontWeight: 700,
            color: "#92400e",
          }}
        >
          {banner}
        </div>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
          gap: 14,
          marginBottom: 24,
        }}
      >
        {[
          { label: "Total Outstanding", value: formatMoney(totalOutstanding) },
          { label: "Recently Owing", value: String(recentlyOwingCount) },
          { label: "Bad Debt", value: String(badDebtCount) },
          { label: "Accounts in Legal Recovery", value: String(legalRecoveryCount) },
          { label: "Payment Arrangements", value: String(arrangementCount) },
          { label: "Collection Success Rate", value: "— (placeholder)" },
        ].map((card) => (
          <div key={card.label} style={accountingCard}>
            <div style={accountingCardLabel}>{card.label}</div>
            <div style={accountingCardValue}>{card.value}</div>
          </div>
        ))}
      </div>

      <div
        className="no-print"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          alignItems: "flex-end",
          marginBottom: 20,
        }}
      >
        <label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 800, color: "#64748b" }}>
          Reporting basis
          <select
            style={{ ...fieldStyle, minWidth: 220 }}
            value={reportingBasis}
            onChange={(e) => setReportingBasis(e.target.value as ReportingBasis)}
          >
            {REPORTING_BASIS_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 800, color: "#64748b" }}>
          {reportingBasisYearLabel(reportingBasis)}
          <select style={fieldStyle} value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        {reportingBasis === "month" ? (
          <label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 800, color: "#64748b" }}>
            Month
            <select
              style={fieldStyle}
              value={monthIndex}
              onChange={(e) => setMonthIndex(Number(e.target.value))}
            >
              {MONTH_NAMES.map((name, idx) => (
                <option key={name} value={idx}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 800, color: "#64748b" }}>
          Search
          <input
            style={{ ...fieldStyle, minWidth: 200 }}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Account, parent, learner…"
          />
        </label>
        <label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 800, color: "#64748b" }}>
          Filter by status
          <select style={fieldStyle} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            {STATUS_FILTER_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 800, color: "#64748b" }}>
          Filter by legal stage
          <select
            style={fieldStyle}
            value={legalStageFilter}
            onChange={(e) => setLegalStageFilter(e.target.value)}
          >
            {LEGAL_STAGE_FILTER_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
        <button type="button" style={goldBtn} onClick={() => setGenerated(true)}>
          Generate
        </button>
        <button type="button" style={outlineBtn} onClick={handlePrint}>
          Print
        </button>
        <button type="button" style={outlineBtn} onClick={handleExportPdf}>
          Export PDF
        </button>
        <button type="button" style={outlineBtn} onClick={handleExportExcel}>
          Export Excel
        </button>
      </div>

      <div ref={reportRef}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
            gap: 10,
            marginBottom: 20,
          }}
        >
          {[
            { label: "Current", value: bucketTotals.current },
            { label: "30 Days", value: bucketTotals.days30 },
            { label: "60 Days", value: bucketTotals.days60 },
            { label: "90 Days", value: bucketTotals.days90 },
            { label: "120+ Days", value: bucketTotals.days120Plus },
          ].map((b) => (
            <div key={b.label} style={{ ...accountingCard, padding: "14px 16px" }}>
              <div style={{ ...accountingCardLabel, fontSize: 11 }}>{b.label}</div>
              <div style={{ ...accountingCardValue, fontSize: 20 }}>{formatMoney(b.value)}</div>
            </div>
          ))}
        </div>

        <p style={{ fontSize: 13, color: "#64748b", fontWeight: 600, marginBottom: 16 }}>
          Legal recovery stages are synchronized with Billing Documents.
        </p>

        <div style={{ overflowX: "auto", marginBottom: 16 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1400 }}>
            <thead>
              <tr>
                {[
                  "Account No",
                  "Parent / Guardian",
                  "Learner",
                  "Grade / Class",
                  "Outstanding",
                  "Current",
                  "30 Days",
                  "60 Days",
                  "90 Days",
                  "120+ Days",
                  "Status",
                  "Legal Stage",
                  "Last Payment",
                  "Actions",
                ].map((h) => (
                  <th key={h} style={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!generated ? (
                <tr>
                  <td colSpan={14} style={{ ...td, textAlign: "center", color: "#64748b" }}>
                    Click Generate to load debtor ageing from the billing ledger.
                  </td>
                </tr>
              ) : pagedRows.length === 0 ? (
                <tr>
                  <td colSpan={14} style={{ ...td, textAlign: "center", color: "#64748b" }}>
                    No accounts match the current filters.
                  </td>
                </tr>
              ) : (
                pagedRows.map((row) => (
                  <tr key={`${row.learnerId}-${row.accountNo}`}>
                    <td style={td}>{row.accountNo || "-"}</td>
                    <td style={td}>{row.parentName}</td>
                    <td style={{ ...td, fontWeight: 800 }}>{row.learnerName}</td>
                    <td style={td}>
                      {row.grade || "—"} / {row.className || "—"}
                    </td>
                    <td style={td}>{formatMoney(row.outstandingBalance)}</td>
                    <td style={td}>{formatMoney(row.ageing.current)}</td>
                    <td style={td}>{formatMoney(row.ageing.days30)}</td>
                    <td style={td}>{formatMoney(row.ageing.days60)}</td>
                    <td style={td}>{formatMoney(row.ageing.days90)}</td>
                    <td style={td}>{formatMoney(row.ageing.days120Plus)}</td>
                    <td style={td}>
                      <StatusPill status={row.displayStatus} />
                    </td>
                    <td style={td}>
                      <div style={{ fontWeight: 800 }}>{row.legalStage}</div>
                      {row.legalTags.length ? (
                        <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {row.legalTags.map((tag) => (
                            <span
                              key={tag}
                              style={{
                                fontSize: 10,
                                fontWeight: 800,
                                padding: "2px 6px",
                                borderRadius: 6,
                                background: "#f5f3ff",
                                color: "#6d28d9",
                              }}
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </td>
                    <td style={td}>{row.lastPaymentLabel}</td>
                    <td style={td}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 130 }}>
                        <button type="button" style={outlineBtn} onClick={() => viewAccount(row)}>
                          View account
                        </button>
                        <button
                          type="button"
                          style={outlineBtn}
                          onClick={() => setActivePage?.("statements")}
                        >
                          Statements
                        </button>
                        <button
                          type="button"
                          style={outlineBtn}
                          onClick={() => setActivePage?.("documents")}
                        >
                          Legal documents
                        </button>
                        <button type="button" style={outlineBtn} onClick={() => openArrangementModal(row)}>
                          Arrangement
                        </button>
                        <button type="button" style={outlineBtn} onClick={() => openHandoverModal(row)}>
                          Hand to lawyer
                        </button>
                        <button type="button" style={outlineBtn} onClick={() => markCollectionClosed(row)}>
                          Close collection
                        </button>
                        <button type="button" style={outlineBtn} onClick={() => setNotesModal(row)}>
                          Notes
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="no-print" style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 24 }}>
          <button
            type="button"
            style={outlineBtn}
            disabled={safePage <= 1}
            onClick={() => setTablePage((p) => Math.max(1, p - 1))}
          >
            Previous
          </button>
          <span style={{ fontWeight: 800, fontSize: 13 }}>
            Page {safePage} of {pageCount} · {filteredRows.length} account(s)
          </span>
          <button
            type="button"
            style={outlineBtn}
            disabled={safePage >= pageCount}
            onClick={() => setTablePage((p) => Math.min(pageCount, p + 1))}
          >
            Next
          </button>
        </div>

        <SummaryTable title="Top 10 debtors" columns={["Learner", "Account", "Balance", "Status"]} rows={topDebtors.map((r) => [
          r.learnerName,
          r.accountNo,
          formatMoney(r.outstandingBalance),
          r.displayStatus,
        ])} empty="No outstanding balances." />

        <SummaryTable
          title="Legal recovery accounts"
          columns={["Learner", "Account", "Balance", "Legal stage", "Tags"]}
          rows={legalAccounts.slice(0, 10).map((r) => [
            r.learnerName,
            r.accountNo,
            formatMoney(r.outstandingBalance),
            r.legalStage,
            r.legalTags.join(", ") || "—",
          ])}
          empty="No accounts in legal recovery."
        />

        <SummaryTable
          title="Recently paid accounts"
          columns={["Learner", "Account", "Last payment"]}
          rows={recentlyPaid.map((r) => [r.learnerName, r.accountNo, r.lastPaymentLabel])}
          empty="No recent payments recorded."
        />

        <SummaryTable
          title="No payment in 60+ days"
          columns={["Learner", "Account", "Balance", "Days since payment"]}
          rows={noPayment60.slice(0, 10).map((r) => [
            r.learnerName,
            r.accountNo,
            formatMoney(r.outstandingBalance),
            r.daysSincePayment === null ? "Never" : String(r.daysSincePayment),
          ])}
          empty="No accounts in this category."
        />
      </div>

      {arrangementModal ? (
        <Modal title="Payment arrangement" onClose={() => setArrangementModal(null)}>
          <p style={{ fontWeight: 700, marginTop: 0 }}>
            {arrangementModal.learnerName} · {arrangementModal.accountNo}
          </p>
          <label style={labelBlock}>
            Arrangement amount (R)
            <input
              type="number"
              style={fieldStyle}
              value={arrAmount}
              onChange={(e) => setArrAmount(Number(e.target.value) || 0)}
            />
          </label>
          <label style={labelBlock}>
            Start date
            <input type="date" style={fieldStyle} value={arrStart} onChange={(e) => setArrStart(e.target.value)} />
          </label>
          <label style={labelBlock}>
            End date
            <input type="date" style={fieldStyle} value={arrEnd} onChange={(e) => setArrEnd(e.target.value)} />
          </label>
          <label style={labelBlock}>
            Status
            <select
              style={fieldStyle}
              value={arrStatus}
              onChange={(e) => setArrStatus(e.target.value as PaymentArrangement["status"])}
            >
              <option value="Active">Active</option>
              <option value="Completed">Completed</option>
              <option value="Cancelled">Cancelled</option>
            </select>
          </label>
          <label style={labelBlock}>
            Notes
            <textarea
              style={{ ...fieldStyle, minHeight: 80, width: "100%" }}
              value={arrNotes}
              onChange={(e) => setArrNotes(e.target.value)}
            />
          </label>
          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button type="button" style={goldBtn} onClick={saveArrangement}>
              Save arrangement
            </button>
            <button type="button" style={outlineBtn} onClick={() => setArrangementModal(null)}>
              Cancel
            </button>
          </div>
        </Modal>
      ) : null}

      {handoverModal ? (
        <Modal title="Legal handover" onClose={() => setHandoverModal(null)}>
          <p style={{ fontWeight: 700, marginTop: 0 }}>
            {handoverModal.learnerName} · {handoverModal.accountNo}
          </p>
          <label style={labelBlock}>
            Attorney / Collection agency
            <input style={fieldStyle} value={attorneyName} onChange={(e) => setAttorneyName(e.target.value)} />
          </label>
          <label style={labelBlock}>
            Date handed over
            <input
              type="date"
              style={fieldStyle}
              value={handoverDate}
              onChange={(e) => setHandoverDate(e.target.value)}
            />
          </label>
          <label style={labelBlock}>
            Contact details
            <input style={fieldStyle} value={handoverContact} onChange={(e) => setHandoverContact(e.target.value)} />
          </label>
          <label style={labelBlock}>
            Notes
            <textarea
              style={{ ...fieldStyle, minHeight: 80, width: "100%" }}
              value={handoverNotes}
              onChange={(e) => setHandoverNotes(e.target.value)}
            />
          </label>
          <label style={labelBlock}>
            Status
            <input style={fieldStyle} value="Active" disabled />
          </label>
          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button type="button" style={goldBtn} onClick={saveHandover}>
              Save handover
            </button>
            <button type="button" style={outlineBtn} onClick={() => setHandoverModal(null)}>
              Cancel
            </button>
          </div>
        </Modal>
      ) : null}

      {notesModal ? (
        <Modal title="Recovery notes & history" onClose={() => setNotesModal(null)}>
          <p style={{ fontWeight: 700, marginTop: 0 }}>
            {notesModal.learnerName} · {notesModal.accountNo}
          </p>
          <div style={{ display: "grid", gap: 10, marginBottom: 16 }}>
            <select style={fieldStyle} value={noteType} onChange={(e) => setNoteType(e.target.value as RecoveryNoteType)}>
              <option value="note">Note</option>
              <option value="call">Call</option>
              <option value="email">Email</option>
              <option value="meeting">Meeting</option>
              <option value="promise">Promise to pay</option>
            </select>
            <input type="date" style={fieldStyle} value={noteDate} onChange={(e) => setNoteDate(e.target.value)} />
            <textarea
              style={{ ...fieldStyle, minHeight: 70, width: "100%" }}
              placeholder="Summary"
              value={noteSummary}
              onChange={(e) => setNoteSummary(e.target.value)}
            />
            <button type="button" style={goldBtn} onClick={addRecoveryNote}>
              Add entry
            </button>
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
            {accountNotes.length === 0 ? (
              <li style={{ color: "#64748b" }}>No recovery history yet.</li>
            ) : (
              accountNotes.map((n) => (
                <li key={n.id}>
                  <strong>{n.type}</strong> · {n.date} — {n.summary}
                </li>
              ))
            )}
          </ul>
        </Modal>
      ) : null}

      {detailRow ? (
        <Modal title="Account detail" onClose={() => setDetailRow(null)}>
          <p style={{ margin: "0 0 8px", fontWeight: 800 }}>{detailRow.learnerName}</p>
          <p style={{ margin: "0 0 16px", color: "#64748b" }}>Account {detailRow.accountNo}</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
            <button type="button" style={goldBtn} onClick={() => openArrangementModal(detailRow)}>
              Mark payment arrangement
            </button>
            <button type="button" style={outlineBtn} onClick={() => openHandoverModal(detailRow)}>
              Mark handed to lawyer
            </button>
            <button type="button" style={outlineBtn} onClick={() => markCollectionClosed(detailRow)}>
              Mark collection closed
            </button>
            <button
              type="button"
              style={outlineBtn}
              onClick={() => {
                setNotesModal(detailRow);
                setDetailRow(null);
              }}
            >
              Recovery notes
            </button>
          </div>
        </Modal>
      ) : null}

      {pagedRows.length > 0 ? (
        <div className="no-print" style={{ ...sectionCard, marginTop: 8 }}>
          <h2 style={{ margin: "0 0 12px", fontSize: 17, fontWeight: 900 }}>Quick actions (visible rows)</h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {pagedRows.map((row) => (
              <button
                key={`qa-${row.learnerId}`}
                type="button"
                style={{ ...outlineBtn, fontSize: 12, padding: "8px 12px" }}
                onClick={() => openArrangementModal(row)}
              >
                Arrangement · {row.accountNo}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

const labelBlock: React.CSSProperties = {
  display: "grid",
  gap: 6,
  fontWeight: 800,
  fontSize: 12,
  color: "#64748b",
  marginBottom: 12,
};

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
    <div style={overlay}>
      <div style={modalPanel}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>{title}</h2>
          <button type="button" style={outlineBtn} onClick={onClose}>
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function SummaryTable({
  title,
  columns,
  rows,
  empty,
}: {
  title: string;
  columns: string[];
  rows: string[][];
  empty: string;
}) {
  return (
    <div style={sectionCard}>
      <h2 style={{ margin: "0 0 12px", fontSize: 17, fontWeight: 900 }}>{title}</h2>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c} style={th}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} style={{ ...td, color: "#64748b" }}>
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row, idx) => (
              <tr key={idx}>
                {row.map((cell, ci) => (
                  <td key={ci} style={td}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
