import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { ChartAccount } from "./AccountingChartOfAccounts";
import {
  ACCOUNTING_JOURNALS_UPDATED_EVENT,
  appendAudit,
  journalOrigin,
  journalSourceModule,
  journalTotals,
  lineTotals,
  loadActiveCoaAccounts,
  loadJournalStore,
  nextJournalNo,
  roundMoney,
  saveJournalStore,
  uid,
  type AuditEntry,
  type Journal,
  type JournalLine,
  type JournalStatus,
  type JournalStore,
} from "./accountingJournalStorage";
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

type TabId = "list" | "drafts" | "posted" | "audit";

type Props = {
  schoolId?: string;
  createdBy?: string;
};

const PAGE_SIZE = 10;

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
  padding: "10px 18px",
  borderRadius: 10,
  border: `2px solid ${ACCOUNTING_GOLD}`,
  background: "#fff",
  color: ACCOUNTING_INK,
  fontWeight: 800,
  cursor: "pointer",
  fontSize: 14,
};

const disabledBtn: React.CSSProperties = {
  ...goldBtn,
  opacity: 0.45,
  cursor: "not-allowed",
};

const fieldStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #cbd5e1",
  fontWeight: 600,
  fontSize: 14,
  marginTop: 6,
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
  width: "min(960px, 100%)",
  maxHeight: "92vh",
  overflow: "auto",
  boxShadow: "0 24px 60px rgba(0,0,0,0.25)",
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

const tdStyle: React.CSSProperties = {
  padding: "12px 14px",
  borderBottom: "1px solid #f1f5f9",
  fontSize: 14,
  fontWeight: 600,
  color: ACCOUNTING_INK,
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
  marginRight: 6,
};

function formatMoney(value: number) {
  return roundMoney(value).toLocaleString("en-ZA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function emptyLine(): JournalLine {
  return {
    id: uid("jl"),
    accountCode: "",
    accountName: "",
    debit: 0,
    credit: 0,
    memo: "",
  };
}

function defaultJournalForm(user: string): Omit<Journal, "id" | "journalNo" | "createdAt" | "updatedAt"> {
  return {
    date: new Date().toISOString().slice(0, 10),
    description: "",
    reference: "",
    notes: "",
    status: "Draft",
    lines: [emptyLine(), emptyLine()],
    createdBy: user,
  };
}

function paginate<T>(items: T[], page: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize) || 1);
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  return { rows: items.slice(start, start + pageSize), totalPages, page: safePage };
}

function statusBadge(status: JournalStatus): React.CSSProperties {
  if (status === "Posted") {
    return {
      padding: "4px 10px",
      borderRadius: 999,
      background: "rgba(34,197,94,0.15)",
      color: "#15803d",
      fontWeight: 900,
      fontSize: 12,
    };
  }
  return {
    padding: "4px 10px",
    borderRadius: 999,
    background: "rgba(212,175,55,0.2)",
    color: "#92400e",
    fontWeight: 900,
    fontSize: 12,
  };
}

function originBadge(origin: "MANUAL" | "AUTO"): React.CSSProperties {
  if (origin === "AUTO") {
    return {
      padding: "4px 8px",
      borderRadius: 999,
      background: "rgba(59,130,246,0.12)",
      color: "#1d4ed8",
      fontWeight: 900,
      fontSize: 11,
      letterSpacing: "0.04em",
    };
  }
  return {
    padding: "4px 8px",
    borderRadius: 999,
    background: "rgba(15,23,42,0.08)",
    color: "#334155",
    fontWeight: 900,
    fontSize: 11,
    letterSpacing: "0.04em",
  };
}

type PostValidation = { ok: true } | { ok: false; message: string };

function validateCanPost(journal: Journal, activeAccounts: ChartAccount[]): PostValidation {
  if (journal.status === "Posted") return { ok: false, message: "Journal is already posted." };
  if (!activeAccounts.length) {
    return { ok: false, message: "Import or create Chart of Accounts before posting journals." };
  }
  if (!journal.lines.length) return { ok: false, message: "Cannot post a journal with no lines." };
  for (const line of journal.lines) {
    if (!String(line.accountCode || "").trim()) {
      return { ok: false, message: "Every line must have an account selected before posting." };
    }
  }
  const { balanced, debit, credit } = lineTotals(journal.lines);
  if (!balanced) {
    return {
      ok: false,
      message: `Debits (${formatMoney(debit)}) must equal credits (${formatMoney(credit)}) before posting.`,
    };
  }
  return { ok: true };
}

export default function AccountingJournals({
  schoolId = "",
  createdBy = "Finance User",
}: Props) {
  const [store, setStore] = useState<JournalStore>(() => loadJournalStore(schoolId));
  const [tab, setTab] = useState<TabId>("list");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Journal | null>(null);
  const [readOnly, setReadOnly] = useState(false);
  const [form, setForm] = useState(() => defaultJournalForm(createdBy));
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");

  const coaAccounts = useMemo(() => loadActiveCoaAccounts(schoolId), [schoolId]);

  useEffect(() => {
    setStore(loadJournalStore(schoolId));
    setSelected(new Set());
    setPage(1);
  }, [schoolId]);

  useEffect(() => {
    const onUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ schoolId?: string }>).detail;
      if (detail?.schoolId && detail.schoolId !== schoolId) return;
      setStore(loadJournalStore(schoolId));
    };
    window.addEventListener(ACCOUNTING_JOURNALS_UPDATED_EVENT, onUpdated);
    return () => window.removeEventListener(ACCOUNTING_JOURNALS_UPDATED_EVENT, onUpdated);
  }, [schoolId]);

  const persist = useCallback(
    (next: JournalStore) => {
      setStore(next);
      saveJournalStore(schoolId, next);
    },
    [schoolId]
  );

  const stats = useMemo(() => {
    const journals = store.journals;
    const draft = journals.filter((j) => j.status === "Draft");
    const posted = journals.filter((j) => j.status === "Posted");
    let totalDebits = 0;
    let totalCredits = 0;
    for (const j of journals) {
      const t = journalTotals(j);
      totalDebits += t.debit;
      totalCredits += t.credit;
    }
    const outOfBalance = roundMoney(totalDebits - totalCredits);
    return {
      total: journals.length,
      draft: draft.length,
      posted: posted.length,
      totalDebits: roundMoney(totalDebits),
      totalCredits: roundMoney(totalCredits),
      outOfBalance,
    };
  }, [store.journals]);

  const filteredJournals = useMemo(() => {
    const sorted = [...store.journals].sort((a, b) => {
      const d = b.date.localeCompare(a.date);
      if (d !== 0) return d;
      return b.journalNo.localeCompare(a.journalNo);
    });
    if (tab === "drafts") return sorted.filter((j) => j.status === "Draft");
    if (tab === "posted") return sorted.filter((j) => j.status === "Posted");
    if (tab === "list") return sorted;
    return [];
  }, [store.journals, tab]);

  const auditSorted = useMemo(
    () => [...store.audit].sort((a, b) => b.at.localeCompare(a.at)),
    [store.audit]
  );

  const journalPagination = paginate(filteredJournals, page, PAGE_SIZE);
  const auditPagination = paginate(auditSorted, page, PAGE_SIZE);
  const isAuditTab = tab === "audit";
  const journalPageRows = journalPagination.rows;
  const auditPageRows = auditPagination.rows;
  const totalPages = isAuditTab ? auditPagination.totalPages : journalPagination.totalPages;
  const safePage = isAuditTab ? auditPagination.page : journalPagination.page;
  const listSourceLength = isAuditTab ? auditSorted.length : filteredJournals.length;

  useEffect(() => {
    setPage(1);
  }, [tab]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(t);
  }, [toast]);

  const openNew = () => {
    setError("");
    setReadOnly(false);
    setEditing(null);
    setForm(defaultJournalForm(createdBy));
    setModalOpen(true);
  };

  const openJournal = (journal: Journal, viewOnly = false) => {
    setError("");
    setEditing(journal);
    setReadOnly(viewOnly || journal.status === "Posted");
    setForm({
      date: journal.date,
      description: journal.description,
      reference: journal.reference,
      notes: journal.notes,
      status: journal.status,
      lines: journal.lines.map((l) => ({ ...l })),
      createdBy: journal.createdBy,
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
    setReadOnly(false);
    setError("");
  };

  const formTotals = useMemo(() => lineTotals(form.lines), [form.lines]);

  const saveDraft = () => {
    setError("");
    const now = new Date().toISOString();
    if (editing) {
      if (editing.status === "Posted") {
        setError("Posted journals cannot be edited. Use Reverse to create an adjusting entry.");
        return;
      }
      const updated: Journal = {
        ...editing,
        date: form.date,
        description: form.description.trim(),
        reference: form.reference.trim(),
        notes: form.notes.trim(),
        status: "Draft",
        lines: form.lines.map((l) => ({
          ...l,
          debit: roundMoney(l.debit),
          credit: roundMoney(l.credit),
        })),
        updatedAt: now,
      };
      const journals = store.journals.map((j) => (j.id === updated.id ? updated : j));
      const audit = appendAudit(store.audit, {
        journalNo: updated.journalNo,
        action: "Edited",
        user: createdBy,
        details: updated.description || "Journal updated",
      });
      persist({ journals, audit });
      setToast(`Draft ${updated.journalNo} saved.`);
      closeModal();
      return;
    }

    const journalNo = nextJournalNo(store.journals, form.date);
    const journal: Journal = {
      id: uid("jn"),
      journalNo,
      date: form.date,
      description: form.description.trim(),
      reference: form.reference.trim(),
      notes: form.notes.trim(),
      status: "Draft",
      lines: form.lines.map((l) => ({
        ...l,
        debit: roundMoney(l.debit),
        credit: roundMoney(l.credit),
      })),
      createdBy: createdBy,
      createdAt: now,
      updatedAt: now,
    };
    const audit = appendAudit(store.audit, {
      journalNo: journal.journalNo,
      action: "Created",
      user: createdBy,
      details: journal.description || "New journal created",
    });
    persist({ journals: [journal, ...store.journals], audit });
    setToast(`Journal ${journalNo} created as draft.`);
    closeModal();
  };

  const postJournal = (journal: Journal): boolean => {
    const check = validateCanPost(journal, coaAccounts);
    if (!check.ok) {
      setError(check.message);
      setToast("");
      return false;
    }
    const now = new Date().toISOString();
    const posted: Journal = {
      ...journal,
      status: "Posted",
      postedAt: now,
      updatedAt: now,
    };
    const journals = store.journals.map((j) => (j.id === posted.id ? posted : j));
    const audit = appendAudit(store.audit, {
      journalNo: posted.journalNo,
      action: "Posted",
      user: createdBy,
      details: `Posted · Dr ${formatMoney(journalTotals(posted).debit)} / Cr ${formatMoney(journalTotals(posted).credit)}`,
    });
    persist({ journals, audit });
    return true;
  };

  const handlePostOne = (journal: Journal) => {
    setError("");
    if (postJournal(journal)) {
      setToast(`Journal ${journal.journalNo} posted.`);
      if (editing?.id === journal.id) closeModal();
    }
  };

  const handlePostSelected = () => {
    setError("");
    const ids = Array.from(selected);
    const drafts = store.journals.filter((j) => ids.includes(j.id) && j.status === "Draft");
    if (!drafts.length) {
      setError("Select one or more draft journals to post.");
      return;
    }
    let posted = 0;
    let failed = 0;
    let lastError = "";
    const nextJournals = [...store.journals];
    let nextAudit = [...store.audit];
    const now = new Date().toISOString();

    for (const journal of drafts) {
      const check = validateCanPost(journal, coaAccounts);
      if (!check.ok) {
        failed += 1;
        lastError = `${journal.journalNo}: ${check.message}`;
        continue;
      }
      const idx = nextJournals.findIndex((j) => j.id === journal.id);
      if (idx < 0) continue;
      const postedJournal: Journal = {
        ...journal,
        status: "Posted",
        postedAt: now,
        updatedAt: now,
      };
      nextJournals[idx] = postedJournal;
      nextAudit = appendAudit(nextAudit, {
        journalNo: postedJournal.journalNo,
        action: "Posted",
        user: createdBy,
        details: `Bulk post · Dr ${formatMoney(journalTotals(postedJournal).debit)} / Cr ${formatMoney(journalTotals(postedJournal).credit)}`,
      });
      posted += 1;
    }

    persist({ journals: nextJournals, audit: nextAudit });
    setSelected(new Set());
    if (posted) setToast(`${posted} journal(s) posted.`);
    if (failed) setError(lastError || `${failed} journal(s) could not be posted.`);
  };

  const handleReverse = (journal: Journal) => {
    setError("");
    if (journal.status !== "Posted") {
      setError("Only posted journals can be reversed.");
      return;
    }
    const now = new Date().toISOString();
    const journalNo = nextJournalNo(store.journals, journal.date);
    const reversal: Journal = {
      id: uid("jn"),
      journalNo,
      date: new Date().toISOString().slice(0, 10),
      description: `Reversal of ${journal.journalNo}`,
      reference: journal.journalNo,
      notes: `Auto-reversal of ${journal.journalNo}. ${journal.description}`.trim(),
      status: "Draft",
      reversedFromJournalNo: journal.journalNo,
      lines: journal.lines.map((l) => ({
        id: uid("jl"),
        accountCode: l.accountCode,
        accountName: l.accountName,
        debit: roundMoney(l.credit),
        credit: roundMoney(l.debit),
        memo: l.memo ? `Reversal: ${l.memo}` : "Reversal",
      })),
      createdBy: createdBy,
      createdAt: now,
      updatedAt: now,
    };
    const audit = appendAudit(store.audit, {
      journalNo: reversal.journalNo,
      action: "Reversed",
      user: createdBy,
      details: `Reversal draft for ${journal.journalNo}`,
    });
    persist({ journals: [reversal, ...store.journals], audit });
    setToast(`Reversal draft ${journalNo} created (references ${journal.journalNo}).`);
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllOnPage = () => {
    const draftIds = journalPageRows
      .filter((r) => r.status === "Draft")
      .map((j) => j.id);
    const allSelected = draftIds.length > 0 && draftIds.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) draftIds.forEach((id) => next.delete(id));
      else draftIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const updateLine = (lineId: string, patch: Partial<JournalLine>) => {
    setForm((f) => ({
      ...f,
      lines: f.lines.map((l) => (l.id === lineId ? { ...l, ...patch } : l)),
    }));
  };

  const onAccountPick = (lineId: string, code: string) => {
    const account = coaAccounts.find((a) => a.code === code);
    updateLine(lineId, {
      accountCode: code,
      accountName: account?.name || "",
    });
  };

  const addLine = () => {
    setForm((f) => ({ ...f, lines: [...f.lines, emptyLine()] }));
  };

  const removeLine = (lineId: string) => {
    setForm((f) => ({
      ...f,
      lines: f.lines.length <= 1 ? f.lines : f.lines.filter((l) => l.id !== lineId),
    }));
  };

  const coaWarning = !coaAccounts.length;

  const exportJournalList = (format: "pdf" | "csv") => {
    if (tab === "audit") {
      setToast("Switch to Journal List, Drafts, or Posted to export journals.");
      return;
    }
    if (!filteredJournals.length) {
      setToast("No journals to export for this tab.");
      return;
    }
    const payload = payloadFromTable(
      resolveExportBranding(),
      "Journal List",
      tab === "list" ? "All journals" : tab === "drafts" ? "Draft journals" : "Posted journals",
      new Date().toLocaleString("en-ZA"),
      {
        columns: ["Journal No", "Date", "Description", "Status", "Debit", "Credit"],
        rows: filteredJournals.map((j) => {
          const totals = journalTotals(j);
          return [
            j.journalNo,
            j.date,
            j.description,
            j.status,
            formatExportMoney(totals.debit),
            formatExportMoney(totals.credit),
          ];
        }),
      },
      [{ label: "Journals", value: String(filteredJournals.length) }]
    );
    if (format === "pdf") {
      if (!exportPayloadPdf(payload)) setToast("Pop-up blocked. Allow pop-ups to export.");
    } else {
      exportPayloadCsv(payload);
    }
  };

  const tabs: { id: TabId; label: string }[] = [
    { id: "list", label: "Journal List" },
    { id: "drafts", label: "Drafts" },
    { id: "posted", label: "Posted" },
    { id: "audit", label: "Audit Trail" },
  ];

  return (
    <div style={{ ...accountingPageWrap, maxWidth: 1320 }}>
      <div style={{ borderBottom: `2px solid ${ACCOUNTING_GOLD}`, paddingBottom: 18, marginBottom: 24 }}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 16, alignItems: "flex-start" }}>
          <div>
            <h1 style={accountingTitle}>Journals</h1>
            <p style={accountingSubtitle}>Capture, review, and approve accounting journal entries.</p>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button type="button" style={goldBtn} onClick={openNew}>
              New Journal
            </button>
            <button
              type="button"
              style={selected.size ? goldBtn : disabledBtn}
              disabled={!selected.size}
              onClick={handlePostSelected}
            >
              Post Selected
            </button>
            <button type="button" style={outlineBtn} onClick={() => exportJournalList("pdf")}>
              Export Journal List (PDF)
            </button>
            <button type="button" style={outlineBtn} onClick={() => exportJournalList("csv")}>
              Export Journal List (CSV)
            </button>
          </div>
        </div>
      </div>

      {coaWarning ? (
        <div
          style={{
            marginBottom: 20,
            padding: 14,
            borderRadius: 10,
            background: "#fffbeb",
            border: `1px solid ${ACCOUNTING_GOLD}`,
            color: "#92400e",
            fontWeight: 700,
          }}
        >
          Import or create Chart of Accounts before posting journals.
        </div>
      ) : null}

      {toast ? (
        <div
          style={{
            marginBottom: 16,
            padding: 12,
            borderRadius: 10,
            background: "rgba(212,175,55,0.15)",
            border: `1px solid ${ACCOUNTING_GOLD}`,
            fontWeight: 700,
            color: ACCOUNTING_INK,
          }}
        >
          {toast}
        </div>
      ) : null}

      {error && !modalOpen ? (
        <div
          style={{
            marginBottom: 16,
            padding: 12,
            borderRadius: 10,
            background: "#fef2f2",
            color: "#b91c1c",
            fontWeight: 700,
          }}
        >
          {error}
        </div>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
          gap: 14,
          marginBottom: 24,
        }}
      >
        {[
          { label: "Total Journals", value: stats.total },
          { label: "Draft Journals", value: stats.draft },
          { label: "Posted Journals", value: stats.posted },
          { label: "Total Debits", value: `R ${formatMoney(stats.totalDebits)}` },
          { label: "Total Credits", value: `R ${formatMoney(stats.totalCredits)}` },
          {
            label: "Out of Balance",
            value: `R ${formatMoney(Math.abs(stats.outOfBalance))}`,
            warn: Math.abs(stats.outOfBalance) >= 0.01,
          },
        ].map((card) => (
          <div key={card.label} style={accountingCard}>
            <div style={accountingCardLabel}>{card.label}</div>
            <div
              style={{
                ...accountingCardValue,
                color: card.warn ? "#b91c1c" : ACCOUNTING_INK,
                fontSize: card.label.includes("Total") && String(card.value).startsWith("R") ? 22 : 28,
              }}
            >
              {card.value}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            style={{
              padding: "10px 16px",
              borderRadius: 10,
              border: `2px solid ${ACCOUNTING_GOLD}`,
              background: tab === t.id ? "linear-gradient(135deg, #f7d56a, #d4af37)" : "#fff",
              color: ACCOUNTING_INK,
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ ...accountingCard, padding: 0, overflow: "hidden" }}>
        {tab === "audit" ? (
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
            <thead>
              <tr>
                {["Date / Time", "Journal No", "Action", "User", "Details"].map((h) => (
                  <th key={h} style={darkTh}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {auditPageRows.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ ...tdStyle, textAlign: "center", color: "#64748b" }}>
                    No audit events yet.
                  </td>
                </tr>
              ) : (
                auditPageRows.map((row) => (
                  <tr key={row.id}>
                    <td style={tdStyle}>{new Date(row.at).toLocaleString("en-ZA")}</td>
                    <td style={{ ...tdStyle, fontFamily: "ui-monospace, monospace", fontWeight: 900 }}>{row.journalNo}</td>
                    <td style={tdStyle}>{row.action}</td>
                    <td style={tdStyle}>{row.user}</td>
                    <td style={tdStyle}>{row.details}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 960 }}>
            <thead>
              <tr>
                <th style={darkTh}>
                  <input
                    type="checkbox"
                    aria-label="Select all drafts on page"
                    onChange={toggleSelectAllOnPage}
                    checked={
                      journalPageRows.length > 0 &&
                      journalPageRows.filter((j) => j.status === "Draft").every((j) => selected.has(j.id))
                    }
                  />
                </th>
                {[
                  "Date",
                  "Journal No",
                  "Type",
                  "Source",
                  "Description",
                  "Debit Total",
                  "Credit Total",
                  "Status",
                  "Created By",
                  "Actions",
                ].map((h) => (
                  <th key={h} style={darkTh}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {journalPageRows.length === 0 ? (
                <tr>
                  <td colSpan={11} style={{ ...tdStyle, textAlign: "center", color: "#64748b" }}>
                    No journals in this view.
                  </td>
                </tr>
              ) : (
                journalPageRows.map((row) => {
                  const t = journalTotals(row);
                  return (
                    <tr key={row.id}>
                      <td style={tdStyle}>
                        <input
                          type="checkbox"
                          disabled={row.status !== "Draft"}
                          checked={selected.has(row.id)}
                          onChange={() => toggleSelect(row.id)}
                        />
                      </td>
                      <td style={tdStyle}>{row.date}</td>
                      <td style={{ ...tdStyle, fontFamily: "ui-monospace, monospace", fontWeight: 900 }}>{row.journalNo}</td>
                      <td style={tdStyle}>
                        <span style={originBadge(journalOrigin(row))}>{journalOrigin(row)}</span>
                      </td>
                      <td style={tdStyle}>{journalSourceModule(row)}</td>
                      <td style={tdStyle}>
                        {row.description || "—"}
                        {row.reversedFromJournalNo ? (
                          <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
                            Reverses {row.reversedFromJournalNo}
                          </div>
                        ) : null}
                      </td>
                      <td style={tdStyle}>R {formatMoney(t.debit)}</td>
                      <td style={tdStyle}>R {formatMoney(t.credit)}</td>
                      <td style={tdStyle}>
                        <span style={statusBadge(row.status)}>{row.status}</span>
                      </td>
                      <td style={tdStyle}>{row.createdBy}</td>
                      <td style={tdStyle}>
                        <button
                          type="button"
                          style={actionBtn}
                          onClick={() => openJournal(row, row.status === "Posted")}
                        >
                          {row.status === "Posted" ? "View" : "View/Edit"}
                        </button>
                        {row.status === "Draft" && journalOrigin(row) === "MANUAL" ? (
                          <button type="button" style={actionBtn} onClick={() => handlePostOne(row)}>
                            Post
                          </button>
                        ) : null}
                        {row.status === "Posted" ? (
                          <button type="button" style={actionBtn} onClick={() => handleReverse(row)}>
                            Reverse
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}

        <div
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
            {listSourceLength} record(s) · page {safePage} of {totalPages}
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              style={outlineBtn}
              disabled={safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </button>
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
      </div>

      <p style={{ marginTop: 20, fontSize: 13, color: "#64748b", fontWeight: 600, lineHeight: 1.5 }}>
        AUTO journals are posted automatically from Billing payments, approved Expenses, and Bank Charges.
        Payroll and Supplier auto-posting will be connected later.
      </p>

      {modalOpen ? (
        <div style={overlay} onClick={closeModal}>
          <div
            style={modalPanel}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="journal-modal-title"
          >
            <div
              style={{
                padding: "18px 22px",
                borderBottom: `2px solid ${ACCOUNTING_GOLD}`,
                background: ACCOUNTING_INK,
                color: ACCOUNTING_GOLD,
              }}
            >
              <h2 id="journal-modal-title" style={{ margin: 0, fontSize: 20, fontWeight: 900 }}>
                {readOnly ? "View Journal" : editing ? "Edit Journal" : "New Journal"}
              </h2>
              {editing ? (
                <div style={{ fontSize: 13, marginTop: 6, opacity: 0.9 }}>
                  {editing.journalNo}
                  {editing.autoGenerated ? ` · AUTO · ${journalSourceModule(editing)}` : ""}
                </div>
              ) : null}
            </div>

            <div style={{ padding: 22 }}>
              {error ? (
                <div
                  style={{
                    marginBottom: 14,
                    padding: 12,
                    borderRadius: 10,
                    background: "#fef2f2",
                    color: "#b91c1c",
                    fontWeight: 700,
                  }}
                >
                  {error}
                </div>
              ) : null}

              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14 }}>
                <label>
                  Date
                  <input
                    type="date"
                    style={fieldStyle}
                    value={form.date}
                    disabled={readOnly}
                    onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                  />
                </label>
                <label>
                  Status
                  <input style={fieldStyle} value={readOnly ? form.status : "Draft"} disabled readOnly />
                </label>
                <label style={{ gridColumn: "1 / -1" }}>
                  Description
                  <input
                    style={fieldStyle}
                    value={form.description}
                    disabled={readOnly}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  />
                </label>
                <label>
                  Reference
                  <input
                    style={fieldStyle}
                    value={form.reference}
                    disabled={readOnly}
                    onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
                  />
                </label>
                <label>
                  Notes
                  <input
                    style={fieldStyle}
                    value={form.notes}
                    disabled={readOnly}
                    onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  />
                </label>
              </div>

              <div
                style={{
                  marginTop: 18,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 10,
                }}
              >
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 900, color: ACCOUNTING_INK }}>Journal lines</h3>
                {!readOnly ? (
                  <button type="button" style={outlineBtn} onClick={addLine}>
                    Add Line
                  </button>
                ) : null}
              </div>

              <div style={{ overflowX: "auto", marginTop: 12 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
                  <thead>
                    <tr>
                      {["Account", "Debit", "Credit", "Line Memo", ""].map((h) => (
                        <th key={h || "rm"} style={darkTh}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {form.lines.map((line) => (
                      <tr key={line.id}>
                        <td style={tdStyle}>
                          <select
                            style={{ ...fieldStyle, marginTop: 0, minWidth: 220 }}
                            value={line.accountCode}
                            disabled={readOnly}
                            onChange={(e) => onAccountPick(line.id, e.target.value)}
                          >
                            <option value="">Select account…</option>
                            {coaAccounts.map((a) => (
                              <option key={a.id} value={a.code}>
                                {a.code} — {a.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td style={tdStyle}>
                          <input
                            type="number"
                            min={0}
                            step={0.01}
                            style={{ ...fieldStyle, marginTop: 0, width: 110 }}
                            value={line.debit || ""}
                            disabled={readOnly}
                            onChange={(e) =>
                              updateLine(line.id, { debit: roundMoney(Number(e.target.value) || 0) })
                            }
                          />
                        </td>
                        <td style={tdStyle}>
                          <input
                            type="number"
                            min={0}
                            step={0.01}
                            style={{ ...fieldStyle, marginTop: 0, width: 110 }}
                            value={line.credit || ""}
                            disabled={readOnly}
                            onChange={(e) =>
                              updateLine(line.id, { credit: roundMoney(Number(e.target.value) || 0) })
                            }
                          />
                        </td>
                        <td style={tdStyle}>
                          <input
                            style={{ ...fieldStyle, marginTop: 0, minWidth: 140 }}
                            value={line.memo}
                            disabled={readOnly}
                            onChange={(e) => updateLine(line.id, { memo: e.target.value })}
                          />
                        </td>
                        <td style={tdStyle}>
                          {!readOnly ? (
                            <button type="button" style={actionBtn} onClick={() => removeLine(line.id)}>
                              Remove
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: "rgba(212,175,55,0.08)" }}>
                      <td style={{ ...tdStyle, fontWeight: 900 }}>Totals</td>
                      <td style={{ ...tdStyle, fontWeight: 900 }}>R {formatMoney(formTotals.debit)}</td>
                      <td style={{ ...tdStyle, fontWeight: 900 }}>R {formatMoney(formTotals.credit)}</td>
                      <td colSpan={2} style={{ ...tdStyle, fontWeight: 800, color: formTotals.balanced ? "#15803d" : "#b91c1c" }}>
                        {formTotals.balanced ? "Balanced" : `Out of balance by R ${formatMoney(Math.abs(formTotals.diff))}`}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 22 }}>
                {!readOnly ? (
                  <button type="button" style={goldBtn} onClick={saveDraft}>
                    Save Draft
                  </button>
                ) : null}
                {!readOnly && editing ? (
                  <button
                    type="button"
                    style={formTotals.balanced && coaAccounts.length ? goldBtn : disabledBtn}
                    disabled={!formTotals.balanced || !coaAccounts.length}
                    onClick={() => {
                      const draft: Journal = {
                        ...editing,
                        date: form.date,
                        description: form.description.trim(),
                        reference: form.reference.trim(),
                        notes: form.notes.trim(),
                        lines: form.lines,
                        status: "Draft",
                      };
                      handlePostOne(draft);
                    }}
                  >
                    Post
                  </button>
                ) : null}
                <button type="button" style={outlineBtn} onClick={closeModal}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
