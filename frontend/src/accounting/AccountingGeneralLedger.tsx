import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchBankImports, type BankTransactionRow } from "../banking/bankingApi";
import type { ChartAccount } from "./AccountingChartOfAccounts";
import {
  ACCOUNTING_JOURNALS_UPDATED_EVENT,
  journalOrigin,
  journalSourceModule,
  journalTotals,
  loadActiveCoaAccounts,
  type Journal,
} from "./accountingJournalStorage";
import {
  ACCOUNTING_SETTINGS_UPDATED_EVENT,
  getDefaultReportingBasis,
  loadAccountingSettings,
  MONTH_NAMES,
  REPORTING_BASIS_OPTIONS,
  reportingBasisYearLabel,
  resolveReportingPeriod,
  type ReportingBasis,
} from "./accountingSettingsStorage";
import {
  computeAccountPeriodSummary,
  filterLedgerRows,
  findApprovedExpense,
  findBillingEntry,
  findJournalInStore,
  formatLedgerMoney,
  groupRowsByAccountType,
  loadPostedGeneralLedger,
  paginateRows,
  summarizeLedger,
  type GeneralLedgerRow,
  type LedgerDisplaySource,
} from "./accountingLedgerHelpers";
import { loadAssets } from "./accountingAssetStorage";
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

type Props = {
  schoolId?: string;
};

type AppliedFilters = {
  reportingBasis: ReportingBasis;
  year: number;
  monthIndex: number;
  accountCode: string;
  search: string;
  groupByType: boolean;
  periodLabel: string;
  startDate: string;
  endDate: string;
};

type SourcePreview =
  | { kind: "journal"; journal: Journal }
  | { kind: "billing"; entry: ReturnType<typeof findBillingEntry> }
  | { kind: "expense"; expense: ReturnType<typeof findApprovedExpense> }
  | { kind: "banking"; transaction: BankTransactionRow; importLabel: string }
  | { kind: "assets"; assetName: string; details: string }
  | { kind: "payroll"; message: string }
  | { kind: "missing"; message: string };

const PAGE_SIZE = 12;

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
  minWidth: 140,
};

const darkTh: React.CSSProperties = {
  padding: "12px 14px",
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
  padding: "12px 14px",
  borderBottom: "1px solid #f1f5f9",
  fontSize: 13,
  fontWeight: 600,
  color: ACCOUNTING_INK,
};

const tdRight: React.CSSProperties = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" };

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
  width: "min(720px, 100%)",
  maxHeight: "90vh",
  overflow: "auto",
  boxShadow: "0 24px 60px rgba(0,0,0,0.25)",
};

const actionBtn: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: 8,
  border: `1px solid ${ACCOUNTING_GOLD}`,
  background: "#fff",
  color: ACCOUNTING_INK,
  fontWeight: 800,
  fontSize: 12,
  cursor: "pointer",
};

function originBadge(origin: "MANUAL" | "AUTO"): React.CSSProperties {
  return {
    padding: "4px 8px",
    borderRadius: 999,
    background: origin === "AUTO" ? "rgba(59,130,246,0.12)" : "rgba(212,175,55,0.2)",
    color: origin === "AUTO" ? "#1d4ed8" : "#92400e",
    fontWeight: 900,
    fontSize: 11,
  };
}

function sourceBadge(source: LedgerDisplaySource): React.CSSProperties {
  const colors: Record<LedgerDisplaySource, { bg: string; fg: string }> = {
    Billing: { bg: "rgba(34,197,94,0.12)", fg: "#15803d" },
    Expenses: { bg: "rgba(239,68,68,0.12)", fg: "#b91c1c" },
    Banking: { bg: "rgba(59,130,246,0.12)", fg: "#1d4ed8" },
    Journals: { bg: "rgba(212,175,55,0.2)", fg: "#92400e" },
    Assets: { bg: "rgba(168,85,247,0.12)", fg: "#7c3aed" },
    Payroll: { bg: "rgba(100,116,139,0.15)", fg: "#475569" },
    Suppliers: { bg: "rgba(14,165,233,0.12)", fg: "#0369a1" },
  };
  const c = colors[source];
  return {
    padding: "4px 8px",
    borderRadius: 999,
    background: c.bg,
    color: c.fg,
    fontWeight: 900,
    fontSize: 11,
  };
}

export default function AccountingGeneralLedger({ schoolId = "" }: Props) {
  const sid = String(schoolId || "").trim();
  const printRef = useRef<HTMLDivElement>(null);

  const now = new Date();
  const [coaAccounts, setCoaAccounts] = useState<ChartAccount[]>([]);
  const [allLedgerRows, setAllLedgerRows] = useState<GeneralLedgerRow[]>([]);

  const [reportingBasis, setReportingBasis] = useState<ReportingBasis>("doe");
  const [year, setYear] = useState(now.getFullYear());
  const [monthIndex, setMonthIndex] = useState(now.getMonth());
  const [accountCode, setAccountCode] = useState("");
  const [search, setSearch] = useState("");
  const [groupByType, setGroupByType] = useState(false);
  const [page, setPage] = useState(1);
  const [applied, setApplied] = useState<AppliedFilters | null>(null);
  const [exportBanner, setExportBanner] = useState("");
  const [sourcePreview, setSourcePreview] = useState<SourcePreview | null>(null);
  const [loadingSource, setLoadingSource] = useState(false);

  const reloadLedger = useCallback(() => {
    if (!sid) {
      setCoaAccounts([]);
      setAllLedgerRows([]);
      return;
    }
    const coa = loadActiveCoaAccounts(sid);
    setCoaAccounts(coa);
    setAllLedgerRows(loadPostedGeneralLedger(sid, coa));
  }, [sid]);

  useEffect(() => {
    reloadLedger();
    const settings = loadAccountingSettings(sid);
    setReportingBasis(getDefaultReportingBasis(sid) || settings.reports.defaultReportBasis || "doe");
  }, [sid, reloadLedger]);

  useEffect(() => {
    const onJournals = (e: Event) => {
      const detail = (e as CustomEvent<{ schoolId?: string }>).detail;
      if (!detail?.schoolId || detail.schoolId === sid) reloadLedger();
    };
    const onSettings = (e: Event) => {
      const detail = (e as CustomEvent<{ schoolId?: string }>).detail;
      if (!detail?.schoolId || detail.schoolId === sid) {
        setReportingBasis(getDefaultReportingBasis(sid));
      }
    };
    window.addEventListener(ACCOUNTING_JOURNALS_UPDATED_EVENT, onJournals);
    window.addEventListener(ACCOUNTING_SETTINGS_UPDATED_EVENT, onSettings);
    return () => {
      window.removeEventListener(ACCOUNTING_JOURNALS_UPDATED_EVENT, onJournals);
      window.removeEventListener(ACCOUNTING_SETTINGS_UPDATED_EVENT, onSettings);
    };
  }, [sid, reloadLedger]);

  const periodDraft = useMemo(
    () => resolveReportingPeriod(reportingBasis, year, monthIndex),
    [reportingBasis, year, monthIndex]
  );

  const handleGenerate = () => {
    setApplied({
      reportingBasis,
      year,
      monthIndex,
      accountCode,
      search,
      groupByType,
      periodLabel: periodDraft.label,
      startDate: periodDraft.startDate,
      endDate: periodDraft.endDate,
    });
    setPage(1);
    setExportBanner("");
  };

  const filteredRows = useMemo(() => {
    if (!applied || !sid) return [];
    return filterLedgerRows(allLedgerRows, {
      schoolId: sid,
      startDate: applied.startDate,
      endDate: applied.endDate,
      accountCode: applied.accountCode,
      search: applied.search,
      groupByType: applied.groupByType,
    });
  }, [allLedgerRows, applied, sid]);

  const summary = useMemo(() => summarizeLedger(filteredRows), [filteredRows]);

  const accountSummary = useMemo(() => {
    if (!applied?.accountCode) return null;
    return computeAccountPeriodSummary(
      allLedgerRows,
      applied.accountCode,
      applied.startDate,
      applied.endDate
    );
  }, [allLedgerRows, applied]);

  const displayRows = useMemo(() => {
    if (!applied?.groupByType || applied.accountCode) return filteredRows;
    return groupRowsByAccountType(filteredRows).flatMap((section) => section.rows);
  }, [filteredRows, applied]);

  const { rows: pageRows, totalPages, page: safePage, total } = useMemo(
    () => paginateRows(displayRows, page, PAGE_SIZE),
    [displayRows, page]
  );

  const groupedSections = useMemo(() => {
    if (!applied?.groupByType || applied.accountCode) return null;
    return groupRowsByAccountType(filteredRows);
  }, [filteredRows, applied]);

  const yearOptions = useMemo(() => {
    const current = new Date().getFullYear();
    return [current - 2, current - 1, current, current + 1];
  }, []);

  const openSourcePreview = async (row: GeneralLedgerRow) => {
    if (!sid) return;
    setLoadingSource(true);
    setSourcePreview(null);

    try {
      if (row.source === "Payroll") {
        setSourcePreview({
          kind: "payroll",
          message: "Payroll automatic journal posting will be connected in a future release.",
        });
        return;
      }

      if (row.source === "Journals" || row.source === "Assets" || row.source === "Suppliers") {
        const journal = findJournalInStore(sid, row.journalId);
        if (journal) {
          setSourcePreview({ kind: "journal", journal });
          return;
        }
      }

      if (row.source === "Billing") {
        const entry = findBillingEntry(sid, row.sourceId);
        if (entry) {
          setSourcePreview({ kind: "billing", entry });
          return;
        }
        const journal = findJournalInStore(sid, row.journalId);
        if (journal) {
          setSourcePreview({ kind: "journal", journal });
          return;
        }
      }

      if (row.source === "Expenses") {
        const expense = findApprovedExpense(sid, row.sourceId);
        if (expense) {
          setSourcePreview({ kind: "expense", expense });
          return;
        }
      }

      if (row.source === "Banking") {
        const res = await fetchBankImports(sid);
        const imports = Array.isArray(res?.imports) ? res.imports : [];
        for (const imp of imports) {
          const tx = (imp.transactions || []).find((t) => t.id === row.sourceId);
          if (tx) {
            setSourcePreview({
              kind: "banking",
              transaction: tx,
              importLabel: imp.fileName || imp.id,
            });
            return;
          }
        }
      }

      if (row.source === "Assets") {
        const assets = loadAssets(sid);
        const asset = assets.find((a) => a.id === row.sourceId);
        if (asset) {
          setSourcePreview({
            kind: "assets",
            assetName: asset.name,
            details: `${asset.category} · ${asset.status} · Cost R ${formatLedgerMoney(asset.purchaseCost)}`,
          });
          return;
        }
        const journal = findJournalInStore(sid, row.journalId);
        if (journal) {
          setSourcePreview({ kind: "journal", journal });
          return;
        }
      }

      const journal = findJournalInStore(sid, row.journalId);
      if (journal) {
        setSourcePreview({ kind: "journal", journal });
        return;
      }

      setSourcePreview({
        kind: "missing",
        message: "Source record not found. The journal posting remains on file.",
      });
    } catch {
      setSourcePreview({
        kind: "missing",
        message: "Could not load source preview.",
      });
    } finally {
      setLoadingSource(false);
    }
  };

  const handlePrint = () => {
    const root = printRef.current;
    if (!root) return;
    const html = root.innerHTML;
    const w = window.open("", "_blank");
    if (!w) {
      alert("Pop-up blocked. Allow pop-ups to print the General Ledger.");
      return;
    }
    w.document.write(`<!DOCTYPE html><html><head><title>General Ledger</title>
<style>
  body { font-family: Georgia, serif; color: #111827; margin: 24px; font-size: 12px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .meta { color: #64748b; margin-bottom: 16px; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; padding: 8px; border-bottom: 2px solid #d4af37; font-size: 10px; text-transform: uppercase; }
  td { padding: 8px; border-bottom: 1px solid #e5e7eb; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 20px; }
  .card { border: 1px solid #d4af37; border-radius: 8px; padding: 10px; }
  .label { font-size: 10px; text-transform: uppercase; color: #64748b; font-weight: 800; }
  .value { font-size: 16px; font-weight: 900; margin-top: 4px; }
</style></head><body>
<h1>General Ledger</h1>
<div class="meta">${applied?.periodLabel || "Not generated"} · Printed ${new Date().toLocaleString("en-ZA")}</div>
${html}
</body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 400);
  };

  const renderPreviewBody = () => {
    if (loadingSource) {
      return <p style={{ fontWeight: 600, color: "#64748b" }}>Loading source…</p>;
    }
    if (!sourcePreview) return null;

    if (sourcePreview.kind === "journal") {
      const j = sourcePreview.journal;
      const totals = journalTotals(j);
      return (
        <>
          <p style={{ fontWeight: 700 }}>
            {j.journalNo} · {j.date} · <span style={originBadge(journalOrigin(j))}>{journalOrigin(j)}</span> ·{" "}
            {journalSourceModule(j)}
          </p>
          <p>{j.description}</p>
          <p style={{ color: "#64748b", fontSize: 13 }}>
            Reference: {j.reference || "—"} · Posted {j.postedAt ? new Date(j.postedAt).toLocaleString("en-ZA") : "—"}
          </p>
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 12 }}>
            <thead>
              <tr>
                {["Account", "Debit", "Credit", "Memo"].map((h) => (
                  <th key={h} style={{ ...darkTh, fontSize: 10 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {j.lines.map((line) => (
                <tr key={line.id}>
                  <td style={td}>
                    {line.accountCode} — {line.accountName}
                  </td>
                  <td style={tdRight}>R {formatLedgerMoney(line.debit)}</td>
                  <td style={tdRight}>R {formatLedgerMoney(line.credit)}</td>
                  <td style={td}>{line.memo || "—"}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td style={{ ...td, fontWeight: 900 }}>Totals</td>
                <td style={{ ...tdRight, fontWeight: 900 }}>R {formatLedgerMoney(totals.debit)}</td>
                <td style={{ ...tdRight, fontWeight: 900 }}>R {formatLedgerMoney(totals.credit)}</td>
                <td style={td} />
              </tr>
            </tfoot>
          </table>
        </>
      );
    }

    if (sourcePreview.kind === "billing" && sourcePreview.entry) {
      const e = sourcePreview.entry;
      return (
        <>
          <p style={{ fontWeight: 900 }}>Billing ledger entry</p>
          <p>Type: {e.type} · Date: {e.date}</p>
          <p>Account: {e.accountNo} · Amount: R {formatLedgerMoney(e.amount)}</p>
          <p>Reference: {e.reference || "—"}</p>
          <p>Description: {e.description || "—"}</p>
          {e.method ? <p>Method: {e.method}</p> : null}
        </>
      );
    }

    if (sourcePreview.kind === "expense" && sourcePreview.expense) {
      const e = sourcePreview.expense;
      return (
        <>
          <p style={{ fontWeight: 900 }}>Approved expense</p>
          <p>
            {e.date} · {e.supplier} · {e.category}
          </p>
          <p>Amount: R {formatLedgerMoney(e.amount)}</p>
          <p>{e.description}</p>
          <p style={{ color: "#64748b", fontSize: 13 }}>Approved by {e.approvedBy}</p>
        </>
      );
    }

    if (sourcePreview.kind === "banking") {
      const t = sourcePreview.transaction;
      const amount = t.moneyOut > 0 ? t.moneyOut : t.moneyIn;
      return (
        <>
          <p style={{ fontWeight: 900 }}>Bank transaction</p>
          <p>Import: {sourcePreview.importLabel}</p>
          <p>
            {t.date} · {t.description}
          </p>
          <p>
            Amount: R {formatLedgerMoney(amount)} ({t.direction === "out" ? "Money out" : "Money in"})
          </p>
          <p>Reference: {t.reference || "—"}</p>
        </>
      );
    }

    if (sourcePreview.kind === "assets") {
      return (
        <>
          <p style={{ fontWeight: 900 }}>Fixed asset</p>
          <p>{sourcePreview.assetName}</p>
          <p>{sourcePreview.details}</p>
        </>
      );
    }

    if (sourcePreview.kind === "payroll" || sourcePreview.kind === "missing") {
      return <p style={{ fontWeight: 600 }}>{sourcePreview.message}</p>;
    }

    return null;
  };

  const tableColumns = [
    "Date",
    "Account Code",
    "Account Name",
    "Description",
    "Reference",
    "Source",
    "Debit",
    "Credit",
    "Running Balance",
    "Journal No",
    "Status",
    "Actions",
  ];

  const renderTableBody = () => {
    if (!applied) {
      return (
        <tr>
          <td colSpan={12} style={{ ...td, textAlign: "center", color: "#64748b" }}>
            Set filters and click Generate to load the General Ledger.
          </td>
        </tr>
      );
    }

    if (pageRows.length === 0) {
      return (
        <tr>
          <td colSpan={12} style={{ ...td, textAlign: "center", color: "#64748b" }}>
            No posted transactions for this period and filter.
          </td>
        </tr>
      );
    }

    return pageRows.map((row) => (
      <tr key={row.id}>
        <td style={td}>{row.date}</td>
        <td style={{ ...td, fontFamily: "ui-monospace, monospace", fontWeight: 900 }}>{row.accountCode}</td>
        <td style={td}>{row.accountName}</td>
        <td style={td}>{row.description}</td>
        <td style={td}>{row.reference}</td>
        <td style={td}>
          <span style={sourceBadge(row.source)}>{row.source}</span>
          <div style={{ marginTop: 4 }}>
            <span style={originBadge(row.origin)}>{row.origin}</span>
          </div>
        </td>
        <td style={tdRight}>{row.debit > 0 ? `R ${formatLedgerMoney(row.debit)}` : "—"}</td>
        <td style={tdRight}>{row.credit > 0 ? `R ${formatLedgerMoney(row.credit)}` : "—"}</td>
        <td style={tdRight}>R {formatLedgerMoney(row.runningBalance)}</td>
        <td style={{ ...td, fontFamily: "ui-monospace, monospace", fontWeight: 900 }}>{row.journalNo}</td>
        <td style={td}>
          <span
            style={{
              padding: "4px 10px",
              borderRadius: 999,
              background: "rgba(34,197,94,0.15)",
              color: "#15803d",
              fontWeight: 900,
              fontSize: 12,
            }}
          >
            Posted
          </span>
        </td>
        <td style={td}>
          <button type="button" style={actionBtn} onClick={() => openSourcePreview(row)}>
            View Source
          </button>
        </td>
      </tr>
    ));
  };

  return (
    <div style={accountingPageWrap} className="accounting-gl-page">
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .accounting-gl-print-area, .accounting-gl-print-area * { visibility: visible !important; }
          .accounting-gl-print-area { position: absolute; left: 0; top: 0; width: 100%; padding: 16px; }
          .accounting-gl-no-print { display: none !important; }
        }
      `}</style>

      <div className="accounting-gl-no-print" style={{ borderBottom: `2px solid ${ACCOUNTING_GOLD}`, paddingBottom: 18, marginBottom: 24 }}>
        <h1 style={accountingTitle}>General Ledger</h1>
        <p style={accountingSubtitle}>
          View account-level transaction history, balances, and accounting movements.
        </p>
      </div>

      <div
        className="accounting-gl-no-print"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 14,
          alignItems: "flex-end",
          marginBottom: 20,
        }}
      >
        <label style={{ display: "grid", gap: 6, fontWeight: 800, fontSize: 12, color: "#64748b" }}>
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
        <label style={{ display: "grid", gap: 6, fontWeight: 800, fontSize: 12, color: "#64748b" }}>
          {reportingBasisYearLabel(reportingBasis)}
          <select style={fieldStyle} value={year} onChange={(e) => setYear(Number(e.target.value))}>
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
        <label style={{ display: "grid", gap: 6, fontWeight: 800, fontSize: 12, color: "#64748b" }}>
          Account
          <select style={{ ...fieldStyle, minWidth: 220 }} value={accountCode} onChange={(e) => setAccountCode(e.target.value)}>
            <option value="">All accounts</option>
            {coaAccounts.map((a) => (
              <option key={a.id} value={a.code}>
                {a.code} — {a.name}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "grid", gap: 6, fontWeight: 800, fontSize: 12, color: "#64748b", flex: "1 1 200px" }}>
          Search
          <input
            style={{ ...fieldStyle, width: "100%" }}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Description, reference, journal no…"
          />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, fontSize: 13, paddingBottom: 10 }}>
          <input type="checkbox" checked={groupByType} onChange={(e) => setGroupByType(e.target.checked)} />
          Group by account type
        </label>
        <button type="button" style={goldBtn} onClick={handleGenerate}>
          Generate
        </button>
        <button type="button" style={outlineBtn} onClick={handlePrint} disabled={!applied || !filteredRows.length}>
          Print
        </button>
        <button
          type="button"
          style={outlineBtn}
          onClick={() => setExportBanner("Export PDF — coming soon. Use Print to save as PDF from your browser.")}
        >
          Export PDF
        </button>
        <button
          type="button"
          style={outlineBtn}
          onClick={() => setExportBanner("Export Excel — coming soon.")}
        >
          Export Excel
        </button>
      </div>

      {exportBanner ? (
        <div
          className="accounting-gl-no-print"
          style={{
            marginBottom: 16,
            padding: 12,
            borderRadius: 10,
            background: "#fffbeb",
            border: `1px solid ${ACCOUNTING_GOLD}`,
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          {exportBanner}
        </div>
      ) : null}

      {applied ? (
        <p className="accounting-gl-no-print" style={{ margin: "0 0 16px", fontWeight: 700, color: "#64748b" }}>
          Period: {applied.periodLabel} ({applied.startDate} to {applied.endDate})
          {applied.accountCode
            ? ` · Account ${applied.accountCode}`
            : ""}
        </p>
      ) : null}

      <div ref={printRef} className="accounting-gl-print-area">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
            gap: 14,
            marginBottom: 20,
          }}
        >
          {[
            { label: "Total Debits", value: `R ${formatLedgerMoney(summary.totalDebits)}` },
            { label: "Total Credits", value: `R ${formatLedgerMoney(summary.totalCredits)}` },
            { label: "Net Movement", value: `R ${formatLedgerMoney(summary.netMovement)}` },
            { label: "Transactions", value: String(summary.transactionCount) },
            { label: "Active Accounts", value: String(summary.activeAccounts) },
            { label: "Last Posting Date", value: summary.lastPostingDate },
          ].map((card) => (
            <div key={card.label} style={accountingCard}>
              <div style={accountingCardLabel}>{card.label}</div>
              <div style={{ ...accountingCardValue, fontSize: card.label === "Last Posting Date" ? 18 : 24 }}>{card.value}</div>
            </div>
          ))}
        </div>

        {accountSummary && applied?.accountCode ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
              gap: 12,
              marginBottom: 20,
            }}
          >
            {[
              { label: "Opening Balance", value: accountSummary.openingBalance },
              { label: "Period Debits", value: accountSummary.periodDebits },
              { label: "Period Credits", value: accountSummary.periodCredits },
              { label: "Closing Balance", value: accountSummary.closingBalance },
            ].map((card) => (
              <div key={card.label} style={{ ...accountingCard, borderWidth: 1 }}>
                <div style={accountingCardLabel}>{card.label}</div>
                <div style={accountingCardValue}>R {formatLedgerMoney(card.value)}</div>
              </div>
            ))}
          </div>
        ) : null}

        {applied?.groupByType && !applied.accountCode && groupedSections?.length ? (
          <div className="accounting-gl-no-print" style={{ marginBottom: 16 }}>
            {groupedSections.map((section) => (
              <div key={section.type} style={{ marginBottom: 8, fontWeight: 800, color: ACCOUNTING_INK }}>
                {section.type}: {section.rows.length} line(s)
              </div>
            ))}
          </div>
        ) : null}

        <div style={{ ...accountingCard, padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1100 }}>
            <thead>
              <tr>
                {tableColumns.map((h) => (
                  <th key={h} style={darkTh}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>{renderTableBody()}</tbody>
          </table>

          {applied && total > 0 ? (
            <div
              className="accounting-gl-no-print"
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "14px 18px",
                borderTop: `1px solid ${ACCOUNTING_GOLD}`,
                flexWrap: "wrap",
                gap: 10,
              }}
            >
              <span style={{ fontSize: 13, color: "#64748b", fontWeight: 700 }}>
                {total} transaction line(s)
              </span>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  type="button"
                  style={outlineBtn}
                  disabled={safePage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </button>
                <span style={{ fontWeight: 800, fontSize: 13 }}>
                  Page {safePage} of {totalPages}
                </span>
                <button
                  type="button"
                  style={outlineBtn}
                  disabled={safePage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Next
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <p style={{ marginTop: 20, fontSize: 13, color: "#64748b", fontWeight: 600, lineHeight: 1.55 }}>
          General Ledger combines manual journals and automatic operational postings.
          <br />
          Final audited balances should be reviewed by the school accountant.
        </p>
      </div>

      {sourcePreview || loadingSource ? (
        <div style={overlay} onClick={() => !loadingSource && setSourcePreview(null)}>
          <div style={modalPanel} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div
              style={{
                padding: "16px 20px",
                borderBottom: `2px solid ${ACCOUNTING_GOLD}`,
                background: ACCOUNTING_INK,
                color: ACCOUNTING_GOLD,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>Source preview</h2>
              <button
                type="button"
                style={{ ...outlineBtn, padding: "6px 12px", color: ACCOUNTING_GOLD, borderColor: ACCOUNTING_GOLD }}
                onClick={() => setSourcePreview(null)}
              >
                Close
              </button>
            </div>
            <div style={{ padding: 20 }}>{renderPreviewBody()}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
