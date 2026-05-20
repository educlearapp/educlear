import React, { useCallback, useEffect, useMemo, useState } from "react";
import { formatMoney } from "../billing/billingLedger";
import { DEFAULT_SUPPLIER_CATEGORIES } from "./AccountingSuppliers";
import {
  approveSupplierInvoice as approveSupplierInvoiceApi,
  createSupplierInvoice as createSupplierInvoiceApi,
  fetchExpenseCategories,
  fetchSupplierInvoices,
  fetchSuppliers,
  mergeJournalsIntoLocalStore,
  postSupplierInvoicePayment,
  type ApiSupplierInvoice,
} from "./accountingSuppliersApi";
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

type SupplierInvoice = Omit<ApiSupplierInvoice, "status"> & {
  category: string;
  description: string;
  balance: number;
  status: string;
  captureMethod: string;
};

type TabId =
  | "list"
  | "manual"
  | "upload"
  | "banking"
  | "payments"
  | "history";

type Props = {
  schoolId: string;
  setActivePage?: (page: any) => void;
  initialTab?: TabId;
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
  fontSize: 13,
};

const ghostBtn: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 10,
  border: `1px solid ${ACCOUNTING_GOLD}`,
  background: "#fff",
  color: ACCOUNTING_INK,
  fontWeight: 800,
  cursor: "pointer",
  fontSize: 12,
};

const field: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #cbd5e1",
  fontWeight: 600,
};

const th: React.CSSProperties = {
  padding: "10px 12px",
  textAlign: "left",
  fontSize: 11,
  fontWeight: 900,
  color: ACCOUNTING_GOLD,
  background: ACCOUNTING_INK,
};

const td: React.CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid #f1f5f9",
  fontSize: 13,
};

const tabBtn = (active: boolean): React.CSSProperties => ({
  padding: "10px 14px",
  borderRadius: 10,
  border: active ? `2px solid ${ACCOUNTING_GOLD}` : "1px solid #e2e8f0",
  background: active ? "linear-gradient(135deg, #f7d56a, #d4af37)" : "#fff",
  color: ACCOUNTING_INK,
  fontWeight: active ? 900 : 700,
  cursor: "pointer",
  fontSize: 12,
});

const emptyForm = () => ({
  supplierId: "",
  supplierName: "",
  category: "Other",
  invoiceNumber: "",
  invoiceDate: new Date().toISOString().slice(0, 10),
  dueDate: new Date().toISOString().slice(0, 10),
  amount: 0,
  vatAmount: 0,
  totalAmount: 0,
  description: "",
  notes: "",
  attachmentName: "",
});

export default function SupplierInvoiceEngine({
  schoolId,
  setActivePage,
  initialTab = "list",
}: Props) {
  const [tab, setTab] = useState<TabId>(initialTab);
  const [refreshKey, setRefreshKey] = useState(0);
  const [banner, setBanner] = useState("");
  const [tablePage, setTablePage] = useState(1);
  const [form, setForm] = useState(emptyForm());
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [ocrConfirmed, setOcrConfirmed] = useState(false);

  const [payInvoiceId, setPayInvoiceId] = useState("");
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [payAmount, setPayAmount] = useState(0);
  const [payReference, setPayReference] = useState("");
  const [payMethod, setPayMethod] = useState("EFT");
  const [payNotes, setPayNotes] = useState("");
  const [invoices, setInvoices] = useState<SupplierInvoice[]>([]);
  const [suppliers, setSuppliers] = useState<Array<{ id: string; name: string; category: string }>>([]);
  const [expenseCategories, setExpenseCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [invoiceLines, setInvoiceLines] = useState([
    { description: "", quantity: 1, unitPrice: 0, expenseCategoryId: "" },
  ]);

  const bump = useCallback(() => setRefreshKey((k) => k + 1), []);

  const reload = useCallback(async () => {
    if (!schoolId) return;
    try {
      const [supRes, invRes, catRes] = await Promise.all([
        fetchSuppliers(schoolId, { pageSize: 200 }),
        fetchSupplierInvoices(schoolId, { pageSize: 200 }),
        fetchExpenseCategories(schoolId),
      ]);
      setSuppliers(
        supRes.suppliers.map((s) => ({
          id: s.id,
          name: s.supplierName || s.name,
          category: "Other",
        }))
      );
      setExpenseCategories(catRes.categories.map((c) => ({ id: c.id, name: c.name })));
      setInvoices(
        invRes.invoices.map((inv) => ({
          ...inv,
          category: inv.lines[0]?.expenseCategoryName || "Other",
          description: inv.lines[0]?.description || inv.notes,
          balance: inv.outstandingAmount,
          status: inv.statusLabel,
          captureMethod: "Manual",
        }))
      );
    } catch {
      setInvoices([]);
    }
  }, [schoolId]);

  useEffect(() => {
    void reload();
  }, [reload, refreshKey]);

  const stats = useMemo(() => {
    const now = new Date();
    const month = now.getMonth();
    const year = now.getFullYear();
    const open = invoices.filter((i) => i.status !== "Paid" && i.status !== "pending").length;
    const awaitingApproval = invoices.filter((i) => i.status === "Pending").length;
    const dueThisMonth = invoices.filter((i) => {
      const d = new Date(i.dueDate);
      return d.getMonth() === month && d.getFullYear() === year && i.outstandingAmount > 0;
    }).length;
    const overdue = invoices.filter((i) => new Date(i.dueDate) < now && i.outstandingAmount > 0).length;
    const partPaid = invoices.filter((i) => i.status === "Partially Paid").length;
    const paidThisMonth = invoices.filter((i) => {
      if (i.status !== "Paid") return false;
      const d = new Date(i.updatedAt);
      return d.getMonth() === month && d.getFullYear() === year;
    }).length;
    return { open, awaitingApproval, dueThisMonth, overdue, partPaid, paidThisMonth };
  }, [invoices]);

  const tableInvoices = useMemo(() => {
    if (tab === "history") {
      return invoices.filter((i) => i.status === "Paid");
    }
    return invoices;
  }, [invoices, tab]);

  const pageCount = Math.max(1, Math.ceil(tableInvoices.length / PAGE_SIZE));
  const safePage = Math.min(tablePage, pageCount);
  const paged = tableInvoices.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const payable = useMemo(
    () => invoices.filter((i) => i.status === "Approved" || i.status === "Partially Paid"),
    [invoices]
  );

  const syncTotal = (next: typeof form, patch: Partial<typeof form>) => {
    const merged = { ...next, ...patch };
    const amount = Number(merged.amount) || 0;
    const vat = Number(merged.vatAmount) || 0;
    const total = patch.totalAmount !== undefined ? Number(patch.totalAmount) : amount + vat;
    return { ...merged, totalAmount: Math.round(total * 100) / 100 };
  };

  const saveManual = async (target: "Draft" | "Awaiting Approval" | "Approved") => {
    if (!schoolId || !form.supplierId) {
      setBanner("Select a supplier.");
      return;
    }
    try {
      const lines = invoiceLines
        .filter((l) => l.description.trim())
        .map((l) => ({
          description: l.description.trim(),
          quantity: Number(l.quantity) || 1,
          unitPrice: Number(l.unitPrice) || 0,
          lineTotal: Math.round((Number(l.quantity) || 1) * (Number(l.unitPrice) || 0) * 100) / 100,
          expenseCategoryId: l.expenseCategoryId || null,
        }));

      const res = await createSupplierInvoiceApi(schoolId, {
        supplierId: form.supplierId,
        invoiceNumber: form.invoiceNumber,
        invoiceDate: form.invoiceDate,
        dueDate: form.dueDate,
        subtotal: form.amount,
        vatAmount: form.vatAmount,
        totalAmount: form.totalAmount,
        notes: form.notes || form.description,
        lines: lines.length ? lines : undefined,
        autoApprove: target === "Approved",
      });

      if (res.journal) mergeJournalsIntoLocalStore(schoolId, [res.journal]);
      if (target === "Approved" && res.invoice.status === "pending") {
        const approved = await approveSupplierInvoiceApi(schoolId, res.invoice.id);
        if (approved.journal) mergeJournalsIntoLocalStore(schoolId, [approved.journal]);
      }

      setBanner(`Invoice saved (${target}).`);
      setForm(emptyForm());
      setInvoiceLines([{ description: "", quantity: 1, unitPrice: 0, expenseCategoryId: "" }]);
      bump();
      setTab("list");
    } catch (e: unknown) {
      setBanner(e instanceof Error ? e.message : "Save failed.");
    }
  };

  const confirmUpload = async () => {
    if (!schoolId || !ocrConfirmed) {
      setBanner("Confirm extracted details before saving.");
      return;
    }
    await saveManual("Awaiting Approval");
    setUploadFile(null);
    setOcrConfirmed(false);
  };

  const simulateOcr = () => {
    if (!uploadFile) {
      setBanner("Choose a PDF or image first.");
      return;
    }
    setForm(
      syncTotal(emptyForm(), {
        supplierName: suppliers[0]?.name || "Supplier from upload",
        supplierId: suppliers[0]?.id || "",
        category: suppliers[0]?.category || "Other",
        invoiceNumber: `UPL-${Date.now().toString().slice(-6)}`,
        amount: 1000,
        vatAmount: 150,
        description: `OCR placeholder — ${uploadFile.name}`,
        attachmentName: uploadFile.name,
      })
    );
    setBanner("OCR extraction will be connected later. Review simulated fields below.");
  };

  const postPayment = async () => {
    if (!schoolId || !payInvoiceId) return;
    try {
      const data = await postSupplierInvoicePayment(schoolId, payInvoiceId, {
        amount: payAmount,
        paymentDate: payDate,
        reference: payReference,
        method: payMethod,
        notes: payNotes,
      });
      if (data.journal) mergeJournalsIntoLocalStore(schoolId, [data.journal]);
      setBanner("Supplier payment posted.");
      setPayInvoiceId("");
      bump();
    } catch (e: unknown) {
      setBanner(e instanceof Error ? e.message : "Payment failed.");
    }
  };

  const renderFormFields = (forUpload?: boolean) => (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
      <label style={{ gridColumn: "span 2" }}>
        Supplier
        <select
          style={field}
          value={form.supplierId}
          onChange={(e) => {
            const s = suppliers.find((x) => x.id === e.target.value);
            setForm(
              syncTotal(form, {
                supplierId: e.target.value,
                supplierName: s?.name || "",
                category: s?.category || form.category,
              })
            );
          }}
        >
          <option value="">Select or type name below</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Supplier name
        <input
          style={field}
          value={form.supplierName}
          onChange={(e) => setForm(syncTotal(form, { supplierName: e.target.value }))}
        />
      </label>
      <label>
        Category
        <select
          style={field}
          value={form.category}
          onChange={(e) => setForm(syncTotal(form, { category: e.target.value }))}
        >
          {DEFAULT_SUPPLIER_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <label>
        Invoice number
        <input
          style={field}
          value={form.invoiceNumber}
          onChange={(e) => setForm(syncTotal(form, { invoiceNumber: e.target.value }))}
        />
      </label>
      <label>
        Invoice date
        <input
          type="date"
          style={field}
          value={form.invoiceDate}
          onChange={(e) => setForm(syncTotal(form, { invoiceDate: e.target.value }))}
        />
      </label>
      <label>
        Due date
        <input
          type="date"
          style={field}
          value={form.dueDate}
          onChange={(e) => setForm(syncTotal(form, { dueDate: e.target.value }))}
        />
      </label>
      <label>
        Amount ex VAT
        <input
          type="number"
          style={field}
          value={form.amount || ""}
          onChange={(e) => setForm(syncTotal(form, { amount: Number(e.target.value) }))}
        />
      </label>
      <label>
        VAT
        <input
          type="number"
          style={field}
          value={form.vatAmount || ""}
          onChange={(e) => setForm(syncTotal(form, { vatAmount: Number(e.target.value) }))}
        />
      </label>
      <label>
        Total
        <input
          type="number"
          style={field}
          value={form.totalAmount || ""}
          onChange={(e) => setForm(syncTotal(form, { totalAmount: Number(e.target.value) }))}
        />
      </label>
      <label style={{ gridColumn: "span 2" }}>
        Description
        <input
          style={field}
          value={form.description}
          onChange={(e) => setForm(syncTotal(form, { description: e.target.value }))}
        />
      </label>
      <label style={{ gridColumn: "span 2" }}>
        Notes
        <textarea
          style={{ ...field, minHeight: 70 }}
          value={form.notes}
          onChange={(e) => setForm(syncTotal(form, { notes: e.target.value }))}
        />
      </label>
      <div style={{ gridColumn: "span 2", marginTop: 8 }}>
        <div style={{ fontWeight: 800, marginBottom: 8 }}>Invoice lines</div>
        {invoiceLines.map((line, idx) => (
          <div
            key={idx}
            style={{ display: "grid", gridTemplateColumns: "2fr 80px 100px 1fr auto", gap: 8, marginBottom: 8 }}
          >
            <input
              style={field}
              placeholder="Description"
              value={line.description}
              onChange={(e) => {
                const next = [...invoiceLines];
                next[idx] = { ...next[idx], description: e.target.value };
                setInvoiceLines(next);
              }}
            />
            <input
              type="number"
              style={field}
              value={line.quantity}
              onChange={(e) => {
                const next = [...invoiceLines];
                next[idx] = { ...next[idx], quantity: Number(e.target.value) };
                setInvoiceLines(next);
              }}
            />
            <input
              type="number"
              style={field}
              value={line.unitPrice || ""}
              onChange={(e) => {
                const next = [...invoiceLines];
                next[idx] = { ...next[idx], unitPrice: Number(e.target.value) };
                setInvoiceLines(next);
              }}
            />
            <select
              style={field}
              value={line.expenseCategoryId}
              onChange={(e) => {
                const next = [...invoiceLines];
                next[idx] = { ...next[idx], expenseCategoryId: e.target.value };
                setInvoiceLines(next);
              }}
            >
              <option value="">Category</option>
              {expenseCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              style={ghostBtn}
              onClick={() => setInvoiceLines(invoiceLines.filter((_, i) => i !== idx))}
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          style={ghostBtn}
          onClick={() =>
            setInvoiceLines([
              ...invoiceLines,
              { description: "", quantity: 1, unitPrice: 0, expenseCategoryId: "" },
            ])
          }
        >
          + Add line
        </button>
      </div>
    </div>
  );

  return (
    <div style={accountingPageWrap}>
      <div style={{ borderBottom: `2px solid ${ACCOUNTING_GOLD}`, paddingBottom: 14, marginBottom: 18 }}>
        <h1 style={accountingTitle}>Supplier Invoice Engine</h1>
        <p style={accountingSubtitle}>
          One workflow for manual capture, upload (OCR later), and banking match — creditors ageing, payables,
          payments, journals, and audit.
        </p>
        {setActivePage ? (
          <button type="button" style={{ ...ghostBtn, marginTop: 10 }} onClick={() => setActivePage("accountingCreditorsAgeing")}>
            Open Creditors Ageing
          </button>
        ) : null}
      </div>

      {banner ? (
        <div style={{ marginBottom: 14, padding: 12, borderRadius: 10, background: "#f8fafc", fontWeight: 700 }}>
          {banner}
        </div>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
          gap: 12,
          marginBottom: 18,
        }}
      >
        {[
          { label: "Open Invoices", value: stats.open },
          { label: "Awaiting Approval", value: stats.awaitingApproval },
          { label: "Due This Month", value: stats.dueThisMonth },
          { label: "Overdue", value: stats.overdue },
          { label: "Part Paid", value: stats.partPaid },
          { label: "Paid This Month", value: stats.paidThisMonth },
        ].map((c) => (
          <div key={c.label} style={accountingCard}>
            <div style={accountingCardLabel}>{c.label}</div>
            <div style={accountingCardValue}>{c.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {(
          [
            ["list", "Supplier Invoices"],
            ["manual", "Manual Capture"],
            ["upload", "Upload Invoice"],
            ["banking", "Banking Matches"],
            ["payments", "Payment Queue"],
            ["history", "History"],
          ] as [TabId, string][]
        ).map(([id, label]) => (
          <button key={id} type="button" style={tabBtn(tab === id)} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === "list" || tab === "history" ? (
        <div style={{ ...accountingCard, padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1000 }}>
            <thead>
              <tr>
                {[
                  "Invoice No",
                  "Supplier",
                  "Category",
                  "Due",
                  "Amount",
                  "Paid",
                  "Balance",
                  "Status",
                  "Capture",
                  "Actions",
                ].map((h) => (
                  <th key={h} style={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paged.map((inv) => (
                <tr key={inv.id}>
                  <td style={td}>{inv.invoiceNumber || inv.id}</td>
                  <td style={td}>{inv.supplierName}</td>
                  <td style={td}>{inv.category}</td>
                  <td style={td}>{inv.dueDate}</td>
                  <td style={td}>{formatMoney(inv.totalAmount)}</td>
                  <td style={td}>{formatMoney(inv.paidAmount)}</td>
                  <td style={td}>{formatMoney(inv.balance)}</td>
                  <td style={td}>{inv.status}</td>
                  <td style={td}>{inv.captureMethod}</td>
                  <td style={td}>
                    {inv.status === "Pending" ? (
                      <button
                        type="button"
                        style={ghostBtn}
                        onClick={async () => {
                          const res = await approveSupplierInvoiceApi(schoolId, inv.id);
                          if (res.journal) mergeJournalsIntoLocalStore(schoolId, [res.journal]);
                          setBanner(`Approved ${inv.invoiceNumber || inv.id}.`);
                          bump();
                        }}
                      >
                        Approve
                      </button>
                    ) : null}
                    {inv.status === "Approved" || inv.status === "Partially Paid" ? (
                      <button
                        type="button"
                        style={ghostBtn}
                        onClick={() => {
                          setPayInvoiceId(inv.id);
                          setPayAmount(inv.balance);
                          setTab("payments");
                        }}
                      >
                        Pay
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ padding: 12, display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" style={ghostBtn} disabled={safePage <= 1} onClick={() => setTablePage((p) => p - 1)}>
              Prev
            </button>
            <span style={{ fontWeight: 700, alignSelf: "center" }}>
              Page {safePage} / {pageCount}
            </span>
            <button
              type="button"
              style={ghostBtn}
              disabled={safePage >= pageCount}
              onClick={() => setTablePage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </div>
      ) : null}

      {tab === "manual" ? (
        <div style={accountingCard}>
          <h3 style={{ marginTop: 0 }}>Manual capture</h3>
          {renderFormFields()}
          <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
            <button type="button" style={goldBtn} onClick={() => saveManual("Draft")}>
              Save draft
            </button>
            <button type="button" style={goldBtn} onClick={() => saveManual("Awaiting Approval")}>
              Submit for approval
            </button>
            <button type="button" style={goldBtn} onClick={() => saveManual("Approved")}>
              Approve now
            </button>
          </div>
        </div>
      ) : null}

      {tab === "upload" ? (
        <div style={accountingCard}>
          <h3 style={{ marginTop: 0 }}>Upload supplier invoice</h3>
          <p style={{ color: "#64748b", fontWeight: 600 }}>
            OCR extraction will be connected later. Use simulated fields to confirm and create the invoice.
          </p>
          <input
            type="file"
            accept=".pdf,image/*"
            onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
          />
          <button type="button" style={{ ...goldBtn, marginTop: 10 }} onClick={simulateOcr}>
            Simulate OCR extract
          </button>
          {form.supplierName ? (
            <>
              {renderFormFields(true)}
              <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, fontWeight: 700 }}>
                <input type="checkbox" checked={ocrConfirmed} onChange={(e) => setOcrConfirmed(e.target.checked)} />
                I confirm these extracted details are correct
              </label>
              <button type="button" style={{ ...goldBtn, marginTop: 10 }} onClick={confirmUpload}>
                Create invoice (awaiting approval)
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {tab === "banking" ? (
        <div style={accountingCard}>
          <h3 style={{ marginTop: 0 }}>Banking matches</h3>
          <p style={{ color: "#64748b", fontWeight: 600 }}>
            Match money-out lines from Banking → Reconciliation Review using &quot;Match supplier invoice&quot; on each
            row. Create-from-bank is available in the match dialog.
          </p>
          {setActivePage ? (
            <button type="button" style={goldBtn} onClick={() => setActivePage("accountingBanking")}>
              Open Banking
            </button>
          ) : null}
        </div>
      ) : null}

      {tab === "payments" ? (
        <div style={accountingCard}>
          <h3 style={{ marginTop: 0 }}>Supplier payment</h3>
          <label>
            Invoice
            <select style={field} value={payInvoiceId} onChange={(e) => {
              setPayInvoiceId(e.target.value);
              const inv = payable.find((i) => i.id === e.target.value);
              if (inv) setPayAmount(inv.balance);
            }}>
              <option value="">Select…</option>
              {payable.filter((i) => i.balance > 0).map((inv) => (
                <option key={inv.id} value={inv.id}>
                  {inv.supplierName} · {formatMoney(inv.balance)} · {inv.invoiceNumber}
                </option>
              ))}
            </select>
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
            <label>
              Payment date
              <input type="date" style={field} value={payDate} onChange={(e) => setPayDate(e.target.value)} />
            </label>
            <label>
              Amount
              <input type="number" style={field} value={payAmount} onChange={(e) => setPayAmount(Number(e.target.value))} />
            </label>
            <label>
              Reference
              <input style={field} value={payReference} onChange={(e) => setPayReference(e.target.value)} />
            </label>
            <label>
              Method
              <input style={field} value={payMethod} onChange={(e) => setPayMethod(e.target.value)} />
            </label>
          </div>
          <label style={{ display: "block", marginTop: 12 }}>
            Notes
            <textarea style={{ ...field, minHeight: 60 }} value={payNotes} onChange={(e) => setPayNotes(e.target.value)} />
          </label>
          <button type="button" style={{ ...goldBtn, marginTop: 14 }} onClick={postPayment}>
            Post payment
          </button>
        </div>
      ) : null}
    </div>
  );
}
