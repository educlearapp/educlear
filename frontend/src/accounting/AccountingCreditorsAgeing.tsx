import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MONTH_NAMES } from "./accountingSettingsStorage";
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
import {
  buildCreditorAgeingRows,
  buildCreditorInvoiceLines,
  creditorStatusColor,
  CREDITORS_UPDATED_EVENT,
  formatMoney,
  getActivePaymentPlan,
  invoiceOutstanding,
  isDueInMonth,
  isPaymentPlanActive,
  loadCreditorNotes,
  loadCreditorPaymentPlans,
  loadCreditorSuppliers,
  normaliseCreditorAmount,
  normaliseIsoDate,
  noteStorageKey,
  resolveAsOfDate,
  saveCreditorNotes,
  saveCreditorPaymentPlans,
  supplierApprovedSpend,
  supplierLookupKey,
  sumAgeingBuckets,
  type CreditorAgeingRow,
  type CreditorDisplayStatus,
  type CreditorInvoice,
  type CreditorInvoiceStatus,
  type CreditorNote,
  type CreditorNoteType,
  type CreditorPaymentPlan,
} from "./accountingCreditorsHelpers";
import { loadCreditorInvoicesUnified } from "./supplierInvoiceCreditorBridge";
import {
  approveSupplierInvoice,
  createSupplierInvoice,
  markSupplierInvoiceDisputed,
  postSupplierInvoicePayment,
} from "./supplierInvoiceHelpers";
import { SUPPLIER_INVOICES_UPDATED_EVENT } from "./supplierInvoiceStorage";

type Props = {
  schoolId: string;
  setActivePage?: (page: any) => void;
};

const PAGE_SIZE = 10;

const STATUS_FILTER_OPTIONS: Array<CreditorDisplayStatus | "All"> = [
  "All",
  "Current",
  "Due Soon",
  "Overdue",
  "Payment Plan",
  "Disputed",
  "Closed / Paid",
];

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
  width: "100%",
  boxSizing: "border-box",
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
  width: "min(560px, 100%)",
  maxHeight: "90vh",
  overflow: "auto",
  padding: 24,
  boxShadow: "0 24px 60px rgba(0,0,0,0.25)",
};

function StatusPill({ status }: { status: string }) {
  const colors = creditorStatusColor(status as CreditorDisplayStatus);
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

export default function AccountingCreditorsAgeing({ schoolId, setActivePage }: Props) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [monthIndex, setMonthIndex] = useState(now.getMonth());
  const [search, setSearch] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("All");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState<string>("All");
  const [generated, setGenerated] = useState(true);
  const [tablePage, setTablePage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);
  const [banner, setBanner] = useState("");

  const [invoiceModal, setInvoiceModal] = useState<CreditorAgeingRow | null>(null);
  const [markPaidModal, setMarkPaidModal] = useState<{
    row: CreditorAgeingRow;
    invoice: CreditorInvoice;
  } | null>(null);
  const [planModal, setPlanModal] = useState<CreditorAgeingRow | null>(null);
  const [notesModal, setNotesModal] = useState<{
    row: CreditorAgeingRow;
    invoiceId?: string;
  } | null>(null);
  const [viewSupplierModal, setViewSupplierModal] = useState<CreditorAgeingRow | null>(null);

  const [invSupplierId, setInvSupplierId] = useState("");
  const [invSupplierName, setInvSupplierName] = useState("");
  const [invCategory, setInvCategory] = useState("Other");
  const [invNumber, setInvNumber] = useState("");
  const [invDate, setInvDate] = useState(new Date().toISOString().slice(0, 10));
  const [invDue, setInvDue] = useState(new Date().toISOString().slice(0, 10));
  const [invAmount, setInvAmount] = useState(0);
  const [invDescription, setInvDescription] = useState("");
  const [invNotes, setInvNotes] = useState("");
  const [invStatus, setInvStatus] = useState<CreditorInvoiceStatus>("Open");

  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [payAmount, setPayAmount] = useState(0);
  const [payReference, setPayReference] = useState("");
  const [payMethod, setPayMethod] = useState("EFT");
  const [payNotes, setPayNotes] = useState("");

  const [planAmount, setPlanAmount] = useState(0);
  const [planStart, setPlanStart] = useState("");
  const [planEnd, setPlanEnd] = useState("");
  const [planInstallment, setPlanInstallment] = useState(0);
  const [planFrequency, setPlanFrequency] = useState("Monthly");
  const [planNotes, setPlanNotes] = useState("");

  const [noteType, setNoteType] = useState<CreditorNoteType>("Internal Note");
  const [noteDate, setNoteDate] = useState(new Date().toISOString().slice(0, 10));
  const [noteText, setNoteText] = useState("");
  const [markPaidInvoiceId, setMarkPaidInvoiceId] = useState("");

  const reportRef = useRef<HTMLDivElement>(null);
  const bumpRefresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    const onCreditors = (e: Event) => {
      const detail = (e as CustomEvent<{ schoolId?: string }>).detail;
      if (!detail?.schoolId || detail.schoolId === schoolId) bumpRefresh();
    };
    window.addEventListener(CREDITORS_UPDATED_EVENT, onCreditors);
    window.addEventListener(SUPPLIER_INVOICES_UPDATED_EVENT, onCreditors);
    return () => {
      window.removeEventListener(CREDITORS_UPDATED_EVENT, onCreditors);
      window.removeEventListener(SUPPLIER_INVOICES_UPDATED_EVENT, onCreditors);
    };
  }, [schoolId, bumpRefresh]);

  const asOfDate = useMemo(() => resolveAsOfDate(year, monthIndex), [year, monthIndex]);
  const periodLabel = `${MONTH_NAMES[monthIndex]} ${year}`;

  const suppliers = useMemo(() => {
    void refreshKey;
    return schoolId ? loadCreditorSuppliers(schoolId) : [];
  }, [schoolId, refreshKey]);

  const invoices = useMemo(() => {
    void refreshKey;
    return schoolId ? loadCreditorInvoicesUnified(schoolId) : [];
  }, [schoolId, refreshKey]);

  const plans = useMemo(() => {
    void refreshKey;
    return schoolId ? loadCreditorPaymentPlans(schoolId) : [];
  }, [schoolId, refreshKey]);

  const invoiceLines = useMemo(
    () => buildCreditorInvoiceLines(invoices, plans, asOfDate),
    [invoices, plans, asOfDate]
  );

  const allRows = useMemo(() => {
    if (!schoolId || !generated) return [];
    return buildCreditorAgeingRows({ invoices, plans, asOfDate });
  }, [schoolId, generated, invoices, plans, asOfDate]);

  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const row of allRows) {
      if (row.category) set.add(row.category);
    }
    for (const inv of invoices) {
      if (inv.category) set.add(inv.category);
    }
    return Array.from(set).sort();
  }, [allRows, invoices]);

  const supplierOptions = useMemo(() => {
    const names = new Set<string>();
    for (const row of allRows) names.add(row.supplierName);
    for (const s of suppliers) names.add(s.name);
    return Array.from(names).sort();
  }, [allRows, suppliers]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allRows.filter((row) => {
      if (supplierFilter !== "All" && row.supplierName !== supplierFilter) return false;
      if (categoryFilter !== "All" && row.category !== categoryFilter) return false;
      if (statusFilter !== "All" && row.displayStatus !== statusFilter) return false;
      if (!q) return true;
      const hay = [row.supplierName, row.category, row.displayStatus, row.nextDueDate]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [allRows, search, supplierFilter, categoryFilter, statusFilter]);

  useEffect(() => {
    setTablePage(1);
  }, [search, supplierFilter, categoryFilter, statusFilter, generated, year, monthIndex]);

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const safePage = Math.min(tablePage, pageCount);
  const pagedRows = filteredRows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const owingRows = allRows.filter((r) => r.outstandingBalance > 0);
  const bucketTotals = sumAgeingBuckets(owingRows);
  const totalCreditors = owingRows.reduce((s, r) => s + r.outstandingBalance, 0);

  const dueThisMonth = invoiceLines
    .filter((l) => l.outstanding > 0 && isDueInMonth(l.dueDate, year, monthIndex))
    .reduce((s, l) => s + l.outstanding, 0);

  const overdueSupplierCount = allRows.filter((r) => r.displayStatus === "Overdue").length;
  const days30Plus =
    bucketTotals.days30 +
    bucketTotals.days60 +
    bucketTotals.days90 +
    bucketTotals.days120Plus;

  const activePlanCount = plans.filter((p) => isPaymentPlanActive(p, asOfDate)).length;
  const scheduledPayments = plans
    .filter((p) => isPaymentPlanActive(p, asOfDate))
    .reduce((s, p) => s + normaliseCreditorAmount(p.installmentAmount), 0);

  const topCreditors = [...owingRows].slice(0, 10);
  const overdueInvoices = invoiceLines
    .filter((l) => l.displayStatus === "Overdue" && l.outstanding > 0)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 10);
  const upcomingPayments = invoiceLines
    .filter((l) => l.outstanding > 0 && l.displayStatus === "Due Soon")
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 10);
  const disputedInvoices = invoiceLines
    .filter((l) => l.status === "Disputed" && l.outstanding > 0)
    .slice(0, 10);

  const openInvoiceModal = (row?: CreditorAgeingRow | null) => {
    const supplier = row
      ? suppliers.find((s) => supplierLookupKey(s.id, s.name) === supplierLookupKey(row.supplierId, row.supplierName))
      : null;
    setInvSupplierId(supplier?.id || row?.supplierId || "");
    setInvSupplierName(supplier?.name || row?.supplierName || "");
    setInvCategory(supplier?.category || row?.category || "Other");
    setInvNumber("");
    setInvDate(new Date().toISOString().slice(0, 10));
    setInvDue(new Date().toISOString().slice(0, 10));
    setInvAmount(0);
    setInvDescription("");
    setInvNotes("");
    setInvStatus("Open");
    setInvoiceModal(row || ({} as CreditorAgeingRow));
  };

  const saveInvoice = () => {
    if (!schoolId) return;
    const name = invSupplierName.trim();
    if (!name) {
      setBanner("Supplier name is required.");
      return;
    }
    const amount = normaliseCreditorAmount(invAmount);
    if (amount <= 0) {
      setBanner("Invoice amount must be greater than zero.");
      return;
    }
    const inv = createSupplierInvoice({
      schoolId,
      supplierId: invSupplierId.trim(),
      supplierName: name,
      category: invCategory.trim() || "Other",
      invoiceNumber: invNumber.trim(),
      invoiceDate: normaliseIsoDate(invDate) || invDate,
      dueDate: normaliseIsoDate(invDue) || invDue,
      amount,
      vatAmount: 0,
      totalAmount: amount,
      description: invDescription.trim(),
      notes: invNotes.trim(),
      captureMethod: "Manual",
      status: "Draft",
    });
    if (invStatus === "Open") approveSupplierInvoice(schoolId, inv.id);
    else if (invStatus === "Disputed") markSupplierInvoiceDisputed(schoolId, inv.id);
    else if (invStatus === "Paid") {
      const approved = approveSupplierInvoice(schoolId, inv.id);
      if (approved) {
        postSupplierInvoicePayment({
          schoolId,
          invoiceId: approved.id,
          paymentDate: new Date().toISOString().slice(0, 10),
          amount,
          reference: "",
          method: "EFT",
          notes: "Recorded from creditors ageing",
        });
      }
    }
    setInvoiceModal(null);
    setBanner("Supplier invoice saved to invoice engine.");
    bumpRefresh();
  };

  const openMarkPaid = (row: CreditorAgeingRow) => {
    const key = supplierLookupKey(row.supplierId, row.supplierName);
    const open = invoices.filter(
      (inv) =>
        supplierLookupKey(inv.supplierId, inv.supplierName) === key &&
        invoiceOutstanding(inv) > 0
    );
    if (!open.length) {
      setBanner("No open invoices for this supplier.");
      return;
    }
    const target = open[0];
    const outstanding = invoiceOutstanding(target);
    setMarkPaidInvoiceId(target.id);
    setPayDate(new Date().toISOString().slice(0, 10));
    setPayAmount(outstanding);
    setPayReference("");
    setPayMethod("EFT");
    setPayNotes("");
    setMarkPaidModal({ row, invoice: target });
  };

  const markPaidOpenInvoices = useMemo(() => {
    if (!markPaidModal) return [];
    const key = supplierLookupKey(markPaidModal.row.supplierId, markPaidModal.row.supplierName);
    return invoices.filter(
      (inv) =>
        supplierLookupKey(inv.supplierId, inv.supplierName) === key &&
        invoiceOutstanding(inv) > 0
    );
  }, [markPaidModal, invoices]);

  const saveMarkPaid = () => {
    if (!schoolId || !markPaidModal) return;
    const amount = normaliseCreditorAmount(payAmount);
    if (amount <= 0) {
      setBanner("Payment amount must be greater than zero.");
      return;
    }
    const targetId = markPaidInvoiceId || markPaidModal.invoice.id;
    postSupplierInvoicePayment({
      schoolId,
      invoiceId: targetId,
      paymentDate: payDate,
      amount,
      reference: payReference,
      method: payMethod,
      notes: payNotes,
    });
    setMarkPaidModal(null);
    setBanner("Supplier payment posted.");
    bumpRefresh();
  };

  const openPlanModal = (row: CreditorAgeingRow) => {
    const existing = getActivePaymentPlan(plans, row.supplierId, row.supplierName, asOfDate);
    setPlanAmount(existing?.planAmount ?? row.outstandingBalance);
    setPlanStart(existing?.startDate || asOfDate);
    setPlanEnd(existing?.endDate || asOfDate);
    setPlanInstallment(existing?.installmentAmount ?? 0);
    setPlanFrequency(existing?.frequency || "Monthly");
    setPlanNotes(existing?.notes || "");
    setPlanModal(row);
  };

  const savePaymentPlan = () => {
    if (!schoolId || !planModal) return;
    const rows = loadCreditorPaymentPlans(schoolId).filter(
      (p) =>
        !(
          supplierLookupKey(p.supplierId, p.supplierName) ===
            supplierLookupKey(planModal.supplierId, planModal.supplierName) && p.status === "Active"
        )
    );
    const plan: CreditorPaymentPlan = {
      id: `cplan-${Date.now()}`,
      supplierId: planModal.supplierId,
      supplierName: planModal.supplierName,
      planAmount: normaliseCreditorAmount(planAmount),
      startDate: normaliseIsoDate(planStart) || planStart,
      endDate: normaliseIsoDate(planEnd) || planEnd,
      installmentAmount: normaliseCreditorAmount(planInstallment),
      frequency: planFrequency,
      notes: planNotes.trim(),
      status: "Active",
      createdAt: new Date().toISOString(),
    };
    saveCreditorPaymentPlans(schoolId, [plan, ...rows]);
    setPlanModal(null);
    setBanner("Payment plan saved.");
    bumpRefresh();
  };

  const modalNotes = useMemo(() => {
    if (!schoolId || !notesModal) return [];
    const store = loadCreditorNotes(schoolId);
    const key = noteStorageKey(
      notesModal.row.supplierId,
      notesModal.row.supplierName,
      notesModal.invoiceId
    );
    return store[key] || [];
  }, [schoolId, notesModal, refreshKey]);

  const addNote = () => {
    if (!schoolId || !notesModal || !noteText.trim()) return;
    const key = noteStorageKey(
      notesModal.row.supplierId,
      notesModal.row.supplierName,
      notesModal.invoiceId
    );
    const store = loadCreditorNotes(schoolId);
    const list = store[key] || [];
    const entry: CreditorNote = {
      id: `cnote-${Date.now()}`,
      date: normaliseIsoDate(noteDate) || noteDate,
      type: noteType,
      note: noteText.trim(),
      createdAt: new Date().toISOString(),
    };
    saveCreditorNotes(schoolId, { ...store, [key]: [entry, ...list] });
    setNoteText("");
    bumpRefresh();
  };

  const viewSupplierSpend = useMemo(() => {
    if (!schoolId || !viewSupplierModal) return [];
    return supplierApprovedSpend(
      schoolId,
      viewSupplierModal.supplierId,
      viewSupplierModal.supplierName
    ).slice(0, 12);
  }, [schoolId, viewSupplierModal]);

  const handlePrint = () => {
    const el = reportRef.current;
    if (!el) return;
    const w = window.open("", "_blank");
    if (!w) {
      setBanner("Pop-up blocked. Allow pop-ups to print the creditors ageing report.");
      return;
    }
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Creditors Ageing — ${periodLabel}</title>
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
</style></head><body>
<h1>Creditors Ageing</h1>
<div class="sub">Period: ${periodLabel} · As at ${asOfDate}</div>
${el.innerHTML}
</body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 400);
  };

  const buildCreditorsExportPayload = () => {
    if (!filteredRows.length) return null;
    return payloadFromTable(
      resolveExportBranding(),
      "Creditors Ageing",
      periodLabel,
      new Date().toLocaleString("en-ZA"),
      {
        columns: ["Supplier", "Category", "Outstanding", "Open invoices", "Disputed", "Status", "Next due"],
        rows: filteredRows.map((r) => [
          r.supplierName,
          r.category,
          formatExportMoney(r.outstandingBalance),
          String(r.openInvoiceCount),
          String(r.disputedCount),
          r.displayStatus,
          r.nextDueDate || "—",
        ]),
      },
      [{ label: "Suppliers", value: String(filteredRows.length) }]
    );
  };

  const handleExportPdf = () => {
    const payload = buildCreditorsExportPayload();
    if (!payload) {
      setBanner("No creditor rows to export for the current filters.");
      return;
    }
    if (!exportPayloadPdf(payload)) setBanner("Pop-up blocked. Allow pop-ups to export PDF.");
    else setBanner("");
  };

  const handleExportExcel = () => {
    const payload = buildCreditorsExportPayload();
    if (!payload) {
      setBanner("No creditor rows to export for the current filters.");
      return;
    }
    exportPayloadCsv(payload);
    setBanner("");
  };

  const yearOptions = useMemo(() => {
    const current = new Date().getFullYear();
    return [current - 2, current - 1, current, current + 1];
  }, []);

  const goSuppliers = () => {
    if (setActivePage) setActivePage("accountingSuppliers");
  };

  return (
    <div style={accountingPageWrap}>
      <div style={{ borderBottom: `2px solid ${ACCOUNTING_GOLD}`, paddingBottom: 18, marginBottom: 24 }}>
        <h1 style={accountingTitle}>Creditors Ageing</h1>
        <p style={accountingSubtitle}>
          Track supplier balances, due dates, payment plans, and overdue supplier invoices.
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
          gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))",
          gap: 14,
          marginBottom: 24,
        }}
      >
        {[
          { label: "Total Creditors", value: formatMoney(totalCreditors) },
          { label: "Due This Month", value: formatMoney(dueThisMonth) },
          { label: "Overdue Suppliers", value: String(overdueSupplierCount) },
          { label: "30+ Days", value: formatMoney(days30Plus) },
          { label: "Payment Plans", value: String(activePlanCount) },
          { label: "Scheduled Payments", value: formatMoney(scheduledPayments) },
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
          Year
          <select style={fieldStyle} value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
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
        <label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 800, color: "#64748b" }}>
          Search
          <input
            style={{ ...fieldStyle, minWidth: 200 }}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Supplier, category…"
          />
        </label>
        <label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 800, color: "#64748b" }}>
          Filter by Supplier
          <select
            style={fieldStyle}
            value={supplierFilter}
            onChange={(e) => setSupplierFilter(e.target.value)}
          >
            <option value="All">All</option>
            {supplierOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 800, color: "#64748b" }}>
          Filter by Category
          <select
            style={fieldStyle}
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            <option value="All">All</option>
            {categoryOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 800, color: "#64748b" }}>
          Filter by Status
          <select style={fieldStyle} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            {STATUS_FILTER_OPTIONS.map((o) => (
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
        {setActivePage ? (
          <button
            type="button"
            style={goldBtn}
            onClick={() => setActivePage("accountingSupplierInvoices")}
          >
            Supplier Invoice Engine
          </button>
        ) : null}
        <button type="button" style={outlineBtn} onClick={() => openInvoiceModal(null)}>
          Quick add invoice
        </button>
      </div>

      <div ref={reportRef}>
        <div style={{ overflowX: "auto", marginBottom: 24 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1100 }}>
            <thead>
              <tr>
                {[
                  "Supplier",
                  "Category",
                  "Outstanding",
                  "Current",
                  "30 Days",
                  "60 Days",
                  "90 Days",
                  "120+ Days",
                  "Status",
                  "Next Due",
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
                  <td colSpan={11} style={{ ...td, textAlign: "center", color: "#64748b" }}>
                    Click Generate to load creditors ageing.
                  </td>
                </tr>
              ) : pagedRows.length === 0 ? (
                <tr>
                  <td colSpan={11} style={{ ...td, textAlign: "center", color: "#64748b" }}>
                    No creditor balances for this period. Add a supplier invoice to get started.
                  </td>
                </tr>
              ) : (
                pagedRows.map((row) => (
                  <tr key={supplierLookupKey(row.supplierId, row.supplierName)}>
                    <td style={{ ...td, fontWeight: 900 }}>{row.supplierName}</td>
                    <td style={td}>{row.category}</td>
                    <td style={td}>{formatMoney(row.outstandingBalance)}</td>
                    <td style={td}>{formatMoney(row.ageing.current)}</td>
                    <td style={td}>{formatMoney(row.ageing.days30)}</td>
                    <td style={td}>{formatMoney(row.ageing.days60)}</td>
                    <td style={td}>{formatMoney(row.ageing.days90)}</td>
                    <td style={td}>{formatMoney(row.ageing.days120Plus)}</td>
                    <td style={td}>
                      <StatusPill status={row.displayStatus} />
                    </td>
                    <td style={td}>{row.nextDueDate || "—"}</td>
                    <td style={td}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        <button type="button" style={outlineBtn} onClick={() => setViewSupplierModal(row)}>
                          View
                        </button>
                        <button type="button" style={outlineBtn} onClick={() => openInvoiceModal(row)}>
                          Invoice
                        </button>
                        <button type="button" style={outlineBtn} onClick={() => openMarkPaid(row)}>
                          Paid
                        </button>
                        <button type="button" style={outlineBtn} onClick={() => openPlanModal(row)}>
                          Plan
                        </button>
                        <button
                          type="button"
                          style={outlineBtn}
                          onClick={() => setNotesModal({ row })}
                        >
                          Note
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {generated && filteredRows.length > PAGE_SIZE ? (
          <div
            className="no-print"
            style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 24 }}
          >
            <button
              type="button"
              style={outlineBtn}
              disabled={safePage <= 1}
              onClick={() => setTablePage((p) => Math.max(1, p - 1))}
            >
              Previous
            </button>
            <span style={{ fontWeight: 700, color: "#64748b" }}>
              Page {safePage} of {pageCount}
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
        ) : null}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 16,
          }}
        >
          <SummaryBlock title="Top 10 creditors" rows={topCreditors.map((r) => [r.supplierName, formatMoney(r.outstandingBalance)])} />
          <SummaryBlock
            title="Overdue supplier invoices"
            rows={overdueInvoices.map((r) => [
              r.supplierName,
              r.invoiceNumber || "—",
              formatMoney(r.outstanding),
              r.dueDate,
            ])}
            cols={4}
          />
          <SummaryBlock
            title="Upcoming payments"
            rows={upcomingPayments.map((r) => [
              r.supplierName,
              formatMoney(r.outstanding),
              r.dueDate,
            ])}
            cols={3}
          />
          <SummaryBlock
            title="Disputed invoices"
            rows={disputedInvoices.map((r) => [
              r.supplierName,
              r.invoiceNumber || "—",
              formatMoney(r.outstanding),
            ])}
            cols={3}
          />
        </div>
      </div>

      {invoiceModal ? (
        <Modal title="Add Supplier Invoice" onClose={() => setInvoiceModal(null)}>
          <label style={{ display: "grid", gap: 6, marginBottom: 12 }}>
            Supplier
            <select
              style={fieldStyle}
              value={invSupplierId || invSupplierName}
              onChange={(e) => {
                const id = e.target.value;
                const match = suppliers.find((s) => s.id === id);
                if (match) {
                  setInvSupplierId(match.id);
                  setInvSupplierName(match.name);
                  setInvCategory(match.category || "Other");
                } else {
                  setInvSupplierId("");
                  setInvSupplierName(id);
                }
              }}
            >
              <option value="">— Select or type below —</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <input
              style={fieldStyle}
              value={invSupplierName}
              onChange={(e) => setInvSupplierName(e.target.value)}
              placeholder="Supplier name (manual entry)"
            />
          </label>
          <Field label="Category" value={invCategory} onChange={setInvCategory} />
          <Field label="Invoice Number" value={invNumber} onChange={setInvNumber} />
          <Field label="Invoice Date" value={invDate} onChange={setInvDate} type="date" />
          <Field label="Due Date" value={invDue} onChange={setInvDue} type="date" />
          <Field
            label="Amount (R)"
            value={String(invAmount)}
            onChange={(v) => setInvAmount(Number(v) || 0)}
            type="number"
          />
          <Field label="Description" value={invDescription} onChange={setInvDescription} />
          <Field label="Notes" value={invNotes} onChange={setInvNotes} />
          <label style={{ display: "grid", gap: 6, marginBottom: 12 }}>
            Status
            <select
              style={fieldStyle}
              value={invStatus}
              onChange={(e) => setInvStatus(e.target.value as CreditorInvoiceStatus)}
            >
              <option value="Open">Open</option>
              <option value="Paid">Paid</option>
              <option value="Disputed">Disputed</option>
            </select>
          </label>
          <ModalActions onCancel={() => setInvoiceModal(null)} onSave={saveInvoice} />
        </Modal>
      ) : null}

      {markPaidModal ? (
        <Modal title="Mark Paid" onClose={() => setMarkPaidModal(null)}>
          <p style={{ margin: "0 0 12px", fontWeight: 700 }}>{markPaidModal.invoice.supplierName}</p>
          {markPaidOpenInvoices.length > 1 ? (
            <label style={{ display: "grid", gap: 6, marginBottom: 12 }}>
              Invoice
              <select
                style={fieldStyle}
                value={markPaidInvoiceId}
                onChange={(e) => {
                  const id = e.target.value;
                  setMarkPaidInvoiceId(id);
                  const inv = markPaidOpenInvoices.find((i) => i.id === id);
                  if (inv) setPayAmount(invoiceOutstanding(inv));
                }}
              >
                {markPaidOpenInvoices.map((inv) => (
                  <option key={inv.id} value={inv.id}>
                    {inv.invoiceNumber || inv.id} · {formatMoney(invoiceOutstanding(inv))} · due{" "}
                    {inv.dueDate}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p style={{ margin: "0 0 12px", color: "#64748b", fontWeight: 600 }}>
              {markPaidModal.invoice.invoiceNumber || "Invoice"} · Outstanding{" "}
              {formatMoney(invoiceOutstanding(markPaidModal.invoice))}
            </p>
          )}
          <Field label="Payment Date" value={payDate} onChange={setPayDate} type="date" />
          <Field
            label="Amount Paid (R)"
            value={String(payAmount)}
            onChange={(v) => setPayAmount(Number(v) || 0)}
            type="number"
          />
          <Field label="Payment Reference" value={payReference} onChange={setPayReference} />
          <label style={{ display: "grid", gap: 6, marginBottom: 12 }}>
            Payment Method
            <select style={fieldStyle} value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
              {["EFT", "Cash", "Card", "Cheque", "Other"].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <Field label="Notes" value={payNotes} onChange={setPayNotes} />
          <ModalActions onCancel={() => setMarkPaidModal(null)} onSave={saveMarkPaid} saveLabel="Save payment" />
        </Modal>
      ) : null}

      {planModal ? (
        <Modal title="Create Payment Plan" onClose={() => setPlanModal(null)}>
          <p style={{ margin: "0 0 12px", fontWeight: 700 }}>{planModal.supplierName}</p>
          <Field
            label="Plan Amount (R)"
            value={String(planAmount)}
            onChange={(v) => setPlanAmount(Number(v) || 0)}
            type="number"
          />
          <Field label="Start Date" value={planStart} onChange={setPlanStart} type="date" />
          <Field label="End Date" value={planEnd} onChange={setPlanEnd} type="date" />
          <Field
            label="Installment Amount (R)"
            value={String(planInstallment)}
            onChange={(v) => setPlanInstallment(Number(v) || 0)}
            type="number"
          />
          <label style={{ display: "grid", gap: 6, marginBottom: 12 }}>
            Frequency
            <select style={fieldStyle} value={planFrequency} onChange={(e) => setPlanFrequency(e.target.value)}>
              {["Weekly", "Bi-weekly", "Monthly", "Quarterly"].map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
          <Field label="Notes" value={planNotes} onChange={setPlanNotes} />
          <ModalActions onCancel={() => setPlanModal(null)} onSave={savePaymentPlan} />
        </Modal>
      ) : null}

      {notesModal ? (
        <Modal title="Notes & History" onClose={() => setNotesModal(null)}>
          <p style={{ margin: "0 0 12px", fontWeight: 700 }}>{notesModal.row.supplierName}</p>
          <label style={{ display: "grid", gap: 6, marginBottom: 8 }}>
            Type
            <select
              style={fieldStyle}
              value={noteType}
              onChange={(e) => setNoteType(e.target.value as CreditorNoteType)}
            >
              {(["Call", "Email", "Meeting", "Promise", "Internal Note"] as CreditorNoteType[]).map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <Field label="Date" value={noteDate} onChange={setNoteDate} type="date" />
          <Field label="Note" value={noteText} onChange={setNoteText} />
          <button type="button" style={{ ...goldBtn, marginBottom: 16 }} onClick={addNote}>
            Add note
          </button>
          {modalNotes.length === 0 ? (
            <p style={{ color: "#64748b", fontWeight: 600 }}>No notes yet.</p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Date", "Type", "Note"].map((h) => (
                    <th key={h} style={{ ...th, fontSize: 10 }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {modalNotes.map((n) => (
                  <tr key={n.id}>
                    <td style={td}>{n.date}</td>
                    <td style={td}>{n.type}</td>
                    <td style={td}>{n.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <button type="button" style={{ ...outlineBtn, marginTop: 16 }} onClick={() => setNotesModal(null)}>
            Close
          </button>
        </Modal>
      ) : null}

      {viewSupplierModal ? (
        <Modal title="View Supplier" onClose={() => setViewSupplierModal(null)}>
          <p style={{ margin: "0 0 8px", fontWeight: 900, fontSize: 18 }}>{viewSupplierModal.supplierName}</p>
          <p style={{ margin: "0 0 16px", color: "#64748b" }}>
            Outstanding: {formatMoney(viewSupplierModal.outstandingBalance)} · Status:{" "}
            {viewSupplierModal.displayStatus}
          </p>
          <h3 style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 900 }}>Open invoices</h3>
          <ul style={{ margin: "0 0 16px", paddingLeft: 18 }}>
            {invoiceLines
              .filter(
                (l) =>
                  supplierLookupKey(l.supplierId, l.supplierName) ===
                    supplierLookupKey(viewSupplierModal.supplierId, viewSupplierModal.supplierName) &&
                  l.outstanding > 0
              )
              .map((l) => (
                <li key={l.id} style={{ marginBottom: 6 }}>
                  {l.invoiceNumber || l.id} · {formatMoney(l.outstanding)} · due {l.dueDate}
                </li>
              ))}
          </ul>
          <h3 style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 900 }}>
            Approved expenses (historical paid spend)
          </h3>
          {viewSupplierSpend.length === 0 ? (
            <p style={{ color: "#64748b", fontWeight: 600 }}>No approved expenses recorded for this supplier.</p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {viewSupplierSpend.map((e) => (
                <li key={e.id} style={{ marginBottom: 6 }}>
                  {e.date} · {formatMoney(e.amount)} · {e.description || e.category}
                </li>
              ))}
            </ul>
          )}
          <div style={{ display: "flex", gap: 10, marginTop: 20, flexWrap: "wrap" }}>
            <button type="button" style={goldBtn} onClick={goSuppliers}>
              Open Suppliers
            </button>
            <button type="button" style={outlineBtn} onClick={() => setViewSupplierModal(null)}>
              Close
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label style={{ display: "grid", gap: 6, marginBottom: 12, fontSize: 12, fontWeight: 800, color: "#64748b" }}>
      {label}
      <input style={fieldStyle} type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div style={overlay} onClick={onClose}>
      <div style={modalPanel} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ margin: "0 0 16px", fontSize: 20, fontWeight: 900 }}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

function ModalActions({
  onCancel,
  onSave,
  saveLabel = "Save",
}: {
  onCancel: () => void;
  onSave: () => void;
  saveLabel?: string;
}) {
  return (
    <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
      <button type="button" style={goldBtn} onClick={onSave}>
        {saveLabel}
      </button>
      <button type="button" style={outlineBtn} onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

function SummaryBlock({
  title,
  rows,
  cols = 2,
}: {
  title: string;
  rows: string[][];
  cols?: number;
}) {
  return (
    <div style={{ ...accountingCard, marginBottom: 0 }}>
      <h3 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 900 }}>{title}</h3>
      {rows.length === 0 ? (
        <p style={{ margin: 0, color: "#64748b", fontWeight: 600 }}>None</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <tbody>
            {rows.map((cells, idx) => (
              <tr key={idx}>
                {cells.map((cell, ci) => (
                  <td
                    key={ci}
                    style={{
                      padding: "6px 8px",
                      borderBottom: "1px solid #f1f5f9",
                      fontWeight: ci === 0 ? 800 : 600,
                    }}
                  >
                    {cell}
                  </td>
                ))}
                {cells.length < cols
                  ? Array.from({ length: cols - cells.length }).map((_, i) => (
                      <td key={`pad-${i}`} style={{ padding: "6px 8px" }} />
                    ))
                  : null}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
