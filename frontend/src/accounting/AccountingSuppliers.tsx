import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  createSupplier,
  fetchSuppliers,
  updateSupplier,
  type ApiSupplier,
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

export const DEFAULT_SUPPLIER_CATEGORIES = [
  "Utilities",
  "Fuel",
  "Stationery",
  "Food / Tuckshop",
  "Maintenance",
  "Insurance",
  "Security",
  "IT / Software",
  "Cleaning",
  "Transport",
  "Professional Services",
  "Rent / Bond",
  "Other",
] as const;

type SupplierStatus = "Active" | "Disabled";

export type SupplierSpendSnapshot = {
  thisMonth: number;
  lastMonth: number;
  yearToDate: number;
  lastTransactionDate: string;
  lastPaymentDate: string;
  outstandingBalance: number;
  averageMonthlySpend: number;
};

export type SupplierRecord = {
  id: string;
  name: string;
  category: string;
  contactPerson: string;
  email: string;
  phone: string;
  vatNumber: string;
  registrationNumber: string;
  bankName: string;
  accountNumber: string;
  branchCode: string;
  paymentTerms: string;
  notes: string;
  status: SupplierStatus;
  recurring: boolean;
  autoMatchRule: string;
  spend: SupplierSpendSnapshot;
  createdAt: string;
  updatedAt: string;
};

type CustomSupplierCategory = {
  id: string;
  name: string;
  notes?: string;
  createdAt: string;
};

type CategoryOption = { name: string; isCustom: boolean };

type TabId = "suppliers" | "categories" | "recurring" | "spend";

type Props = {
  schoolId?: string;
};

const SUPPLIERS_STORAGE_PREFIX = "educlearAccountingSuppliers:";
const CUSTOM_CATEGORIES_STORAGE_PREFIX = "educlearAccountingSupplierCategories:";
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

const ghostBtn: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid #cbd5e1",
  background: "#fff",
  color: ACCOUNTING_INK,
  fontWeight: 700,
  fontSize: 12,
  cursor: "pointer",
};

const fieldStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #cbd5e1",
  fontWeight: 600,
  marginTop: 6,
};

const modalOverlay: React.CSSProperties = {
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
  padding: 24,
  width: "min(560px, 100%)",
  maxHeight: "90vh",
  overflow: "auto",
  boxShadow: "0 24px 60px rgba(0,0,0,0.25)",
};

const modalHeader: React.CSSProperties = {
  padding: "16px 20px",
  background: ACCOUNTING_INK,
  color: ACCOUNTING_GOLD,
  borderRadius: "12px 12px 0 0",
  margin: "-24px -24px 20px",
  fontWeight: 900,
  fontSize: 18,
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
  padding: "12px",
  borderBottom: "1px solid #f1f5f9",
  fontSize: 13,
  verticalAlign: "top",
};

const customBadgeStyle: React.CSSProperties = {
  display: "inline-block",
  marginLeft: 6,
  padding: "2px 6px",
  borderRadius: 4,
  background: "#fef3c7",
  color: "#92400e",
  fontSize: 10,
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
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

function uid(prefix = "sup") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatMoney(value: number) {
  const n = Number.isFinite(value) ? value : 0;
  return `R ${n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function suppliersStorageKey(schoolId: string) {
  return SUPPLIERS_STORAGE_PREFIX + schoolId;
}

function customCategoriesStorageKey(schoolId: string) {
  return CUSTOM_CATEGORIES_STORAGE_PREFIX + schoolId;
}

function normalizeCategoryKey(name: string) {
  return String(name || "").trim().toLowerCase();
}

function categoryNameExists(name: string, customCategories: CustomSupplierCategory[]) {
  const key = normalizeCategoryKey(name);
  if (!key) return true;
  if (DEFAULT_SUPPLIER_CATEGORIES.some((d) => normalizeCategoryKey(d) === key)) return true;
  return customCategories.some((c) => normalizeCategoryKey(c.name) === key);
}

function loadCustomCategories(schoolId: string): CustomSupplierCategory[] {
  try {
    const raw = localStorage.getItem(customCategoriesStorageKey(schoolId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row: Record<string, unknown>) => ({
        id: String(row?.id || uid("cat")),
        name: String(row?.name || "").trim(),
        notes: String(row?.notes || "").trim() || undefined,
        createdAt: String(row?.createdAt || new Date().toISOString()),
      }))
      .filter((row) => row.name);
  } catch {
    return [];
  }
}

function saveCustomCategories(schoolId: string, rows: CustomSupplierCategory[]) {
  try {
    localStorage.setItem(customCategoriesStorageKey(schoolId), JSON.stringify(rows));
  } catch {
    /* ignore */
  }
}

function apiSupplierToRecord(row: ApiSupplier): SupplierRecord {
  return {
    id: row.id,
    name: row.supplierName || row.name,
    category: "Other",
    contactPerson: row.contactPerson,
    email: row.email,
    phone: row.phone,
    vatNumber: row.vatNumber,
    registrationNumber: "",
    bankName: "",
    accountNumber: "",
    branchCode: "",
    paymentTerms: "",
    notes: row.address,
    status: row.status === "Inactive" ? "Disabled" : "Active",
    recurring: false,
    autoMatchRule: "",
    spend: {
      thisMonth: 0,
      lastMonth: 0,
      yearToDate: 0,
      lastTransactionDate: "",
      lastPaymentDate: "",
      outstandingBalance: row.outstandingBalance,
      averageMonthlySpend: 0,
    },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function normalizeSupplier(row: Record<string, unknown>): SupplierRecord {
  const spendRaw = (row?.spend || {}) as Record<string, unknown>;
  return {
    id: String(row?.id || uid()),
    name: String(row?.name || "").trim(),
    category: String(row?.category || "Other").trim() || "Other",
    contactPerson: String(row?.contactPerson || "").trim(),
    email: String(row?.email || "").trim(),
    phone: String(row?.phone || "").trim(),
    vatNumber: String(row?.vatNumber || "").trim(),
    registrationNumber: String(row?.registrationNumber || "").trim(),
    bankName: String(row?.bankName || "").trim(),
    accountNumber: String(row?.accountNumber || "").trim(),
    branchCode: String(row?.branchCode || "").trim(),
    paymentTerms: String(row?.paymentTerms || "").trim(),
    notes: String(row?.notes || "").trim(),
    status: row?.status === "Disabled" ? "Disabled" : "Active",
    recurring: Boolean(row?.recurring),
    autoMatchRule: String(row?.autoMatchRule || "").trim(),
    spend: {
      thisMonth: Number(spendRaw?.thisMonth) || 0,
      lastMonth: Number(spendRaw?.lastMonth) || 0,
      yearToDate: Number(spendRaw?.yearToDate) || 0,
      lastTransactionDate: String(spendRaw?.lastTransactionDate || "").trim(),
      lastPaymentDate: String(spendRaw?.lastPaymentDate || "").trim(),
      outstandingBalance: Number(spendRaw?.outstandingBalance) || 0,
      averageMonthlySpend: Number(spendRaw?.averageMonthlySpend) || 0,
    },
    createdAt: String(row?.createdAt || new Date().toISOString()),
    updatedAt: String(row?.updatedAt || new Date().toISOString()),
  };
}

function buildCategoryOptions(
  customCategories: CustomSupplierCategory[],
  extraNames: Iterable<string> = []
): CategoryOption[] {
  const customByKey = new Map(customCategories.map((c) => [normalizeCategoryKey(c.name), c]));
  const options: CategoryOption[] = DEFAULT_SUPPLIER_CATEGORIES.map((name) => ({
    name,
    isCustom: false,
  }));
  const seen = new Set(options.map((o) => normalizeCategoryKey(o.name)));

  for (const c of customCategories) {
    const key = normalizeCategoryKey(c.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    options.push({ name: c.name, isCustom: true });
  }

  for (const raw of extraNames) {
    const name = String(raw || "").trim();
    const key = normalizeCategoryKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    options.push({ name, isCustom: customByKey.has(key) });
  }

  return options;
}

function supplierMissingDetails(s: SupplierRecord) {
  return !s.email || !s.phone || (!s.vatNumber && !s.registrationNumber);
}

function supplierSubline(s: SupplierRecord) {
  const parts = [s.vatNumber, s.registrationNumber].filter(Boolean);
  return parts.length ? parts.join(" · ") : "";
}

function paginateList<T>(items: T[], page: number, pageSize = PAGE_SIZE) {
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize) || 1);
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    page: safePage,
    totalPages,
    totalItems,
  };
}

function paginationBtn(disabled: boolean): React.CSSProperties {
  return { ...ghostBtn, opacity: disabled ? 0.45 : 1, cursor: disabled ? "not-allowed" : "pointer" };
}

function TablePagination({
  page,
  totalPages,
  onPageChange,
  visible = true,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  visible?: boolean;
}) {
  if (!visible) return null;
  const onFirst = page <= 1;
  const onLast = page >= totalPages;
  return (
    <div style={paginationWrap}>
      <button type="button" style={paginationBtn(onFirst)} disabled={onFirst} onClick={() => onPageChange(page - 1)}>
        Previous
      </button>
      <span style={{ fontWeight: 800, fontSize: 13, color: ACCOUNTING_INK, minWidth: 100, textAlign: "center" }}>
        Page {page} of {totalPages}
      </span>
      <button type="button" style={paginationBtn(onLast)} disabled={onLast} onClick={() => onPageChange(page + 1)}>
        Next
      </button>
    </div>
  );
}

function CustomCategoryBadge() {
  return <span style={customBadgeStyle}>Custom</span>;
}

function StatusPill({ status }: { status: SupplierStatus }) {
  const active = status === "Active";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "4px 10px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 800,
        background: active ? "#dcfce7" : "#f1f5f9",
        color: active ? "#166534" : "#64748b",
        border: active ? "1px solid #86efac" : "1px solid #e2e8f0",
      }}
    >
      {status}
    </span>
  );
}

const emptySupplierForm = (): Omit<SupplierRecord, "id" | "createdAt" | "updatedAt" | "spend"> & {
  spend?: SupplierSpendSnapshot;
} => ({
  name: "",
  category: "Other",
  contactPerson: "",
  email: "",
  phone: "",
  vatNumber: "",
  registrationNumber: "",
  bankName: "",
  accountNumber: "",
  branchCode: "",
  paymentTerms: "30 days",
  notes: "",
  status: "Active",
  recurring: false,
  autoMatchRule: "",
});

export default function AccountingSuppliers({ schoolId = "" }: Props) {
  const sid = String(schoolId || "default-school").trim() || "default-school";

  const [suppliers, setSuppliers] = useState<SupplierRecord[]>([]);
  const [customCategories, setCustomCategories] = useState<CustomSupplierCategory[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [serverPage, setServerPage] = useState(1);
  const [serverTotalPages, setServerTotalPages] = useState(1);
  const [serverTotalItems, setServerTotalItems] = useState(0);

  const [activeTab, setActiveTab] = useState<TabId>("suppliers");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");

  const [suppliersPage, setSuppliersPage] = useState(1);
  const [spendPage, setSpendPage] = useState(1);
  const [recurringPage, setRecurringPage] = useState(1);

  const [supplierModalOpen, setSupplierModalOpen] = useState(false);
  const [editingSupplierId, setEditingSupplierId] = useState<string | null>(null);
  const [supplierForm, setSupplierForm] = useState(emptySupplierForm());

  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [categoryForm, setCategoryForm] = useState({ name: "", notes: "" });
  const [categoryError, setCategoryError] = useState("");

  const [manageCategoriesOpen, setManageCategoriesOpen] = useState(false);
  const [spendFocusId, setSpendFocusId] = useState<string | null>(null);
  const [toast, setToast] = useState("");

  const reloadSuppliers = useCallback(async () => {
    if (!sid) return;
    setLoading(true);
    try {
      const statusParam =
        statusFilter === "Active" ? "Active" : statusFilter === "Disabled" ? "Inactive" : "";
      const res = await fetchSuppliers(sid, {
        search: search.trim() || undefined,
        status: statusParam || undefined,
        page: suppliersPage,
        pageSize: PAGE_SIZE,
      });
      setSuppliers(res.suppliers.map(apiSupplierToRecord));
      setServerPage(res.page);
      setServerTotalPages(res.totalPages);
      setServerTotalItems(res.totalItems);
    } catch {
      setSuppliers([]);
    } finally {
      setLoading(false);
      setHydrated(true);
    }
  }, [sid, search, statusFilter, suppliersPage]);

  useEffect(() => {
    setCustomCategories(loadCustomCategories(sid));
    void reloadSuppliers();
  }, [sid, reloadSuppliers]);

  useEffect(() => {
    if (!hydrated) return;
    saveCustomCategories(sid, customCategories);
  }, [sid, customCategories, hydrated]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(t);
  }, [toast]);

  const categoryOptions = useMemo(
    () => buildCategoryOptions(customCategories, suppliers.map((s) => s.category)),
    [customCategories, suppliers]
  );

  const filteredSuppliers = useMemo(() => {
    return suppliers.filter((s) => {
      if (categoryFilter && s.category !== categoryFilter) return false;
      return true;
    });
  }, [suppliers, categoryFilter]);

  const recurringSuppliers = useMemo(
    () => suppliers.filter((s) => s.recurring),
    [suppliers]
  );

  const stats = useMemo(() => {
    const active = suppliers.filter((s) => s.status === "Active");
    const monthlySpend = active.reduce((sum, s) => sum + (s.spend?.thisMonth || 0), 0);
    const outstanding = suppliers.reduce((sum, s) => sum + (s.spend?.outstandingBalance || 0), 0);
    const recurring = suppliers.filter((s) => s.recurring && s.status === "Active").length;
    const missing = suppliers.filter(supplierMissingDetails).length;
    return {
      total: suppliers.length,
      active: active.length,
      monthlySpend,
      outstanding,
      recurring,
      missing,
    };
  }, [suppliers]);

  const suppliersPaginated = useMemo(
    () => ({
      items: filteredSuppliers,
      page: serverPage,
      totalPages: serverTotalPages,
      totalItems: serverTotalItems,
    }),
    [filteredSuppliers, serverPage, serverTotalPages, serverTotalItems]
  );

  const spendRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return suppliers
      .filter((s) => {
        if (categoryFilter && s.category !== categoryFilter) return false;
        if (!q) return true;
        return s.name.toLowerCase().includes(q) || s.category.toLowerCase().includes(q);
      })
      .sort((a, b) => b.spend.yearToDate - a.spend.yearToDate);
  }, [suppliers, search, categoryFilter]);

  const spendPaginated = useMemo(() => paginateList(spendRows, spendPage), [spendRows, spendPage]);

  const recurringPaginated = useMemo(
    () => paginateList(recurringSuppliers, recurringPage),
    [recurringSuppliers, recurringPage]
  );

  useEffect(() => {
    setSuppliersPage(1);
  }, [search, categoryFilter, statusFilter, activeTab]);

  useEffect(() => {
    setSpendPage(1);
  }, [search, categoryFilter, activeTab]);

  const openAddSupplier = () => {
    setEditingSupplierId(null);
    setSupplierForm(emptySupplierForm());
    setSupplierModalOpen(true);
  };

  const openEditSupplier = (s: SupplierRecord) => {
    setEditingSupplierId(s.id);
    setSupplierForm({
      name: s.name,
      category: s.category,
      contactPerson: s.contactPerson,
      email: s.email,
      phone: s.phone,
      vatNumber: s.vatNumber,
      registrationNumber: s.registrationNumber,
      bankName: s.bankName,
      accountNumber: s.accountNumber,
      branchCode: s.branchCode,
      paymentTerms: s.paymentTerms,
      notes: s.notes,
      status: s.status,
      recurring: s.recurring,
      autoMatchRule: s.autoMatchRule,
    });
    setSupplierModalOpen(true);
  };

  const saveSupplier = async () => {
    const name = supplierForm.name.trim();
    if (!name) {
      setToast("Supplier name is required.");
      return;
    }
    try {
      if (editingSupplierId) {
        await updateSupplier(sid, editingSupplierId, {
          supplierName: name,
          contactPerson: supplierForm.contactPerson,
          email: supplierForm.email,
          phone: supplierForm.phone,
          vatNumber: supplierForm.vatNumber,
          address: supplierForm.notes,
          status: supplierForm.status === "Disabled" ? "Inactive" : "Active",
        });
        setToast("Supplier updated.");
      } else {
        await createSupplier(sid, {
          supplierName: name,
          contactPerson: supplierForm.contactPerson,
          email: supplierForm.email,
          phone: supplierForm.phone,
          vatNumber: supplierForm.vatNumber,
          address: supplierForm.notes,
          status: supplierForm.status === "Disabled" ? "Inactive" : "Active",
        });
        setToast("Supplier added.");
      }
      setSupplierModalOpen(false);
      await reloadSuppliers();
    } catch (e: unknown) {
      setToast(e instanceof Error ? e.message : "Save failed.");
    }
  };

  const toggleSupplierStatus = async (id: string) => {
    const row = suppliers.find((s) => s.id === id);
    if (!row) return;
    const next = row.status === "Active" ? "Inactive" : "Active";
    try {
      await updateSupplier(sid, id, { status: next });
      await reloadSuppliers();
    } catch (e: unknown) {
      setToast(e instanceof Error ? e.message : "Status update failed.");
    }
  };

  const viewSpend = (s: SupplierRecord) => {
    setSpendFocusId(s.id);
    setSearch(s.name);
    setActiveTab("spend");
    setToast(`Showing spend for ${s.name}`);
  };

  const saveCategory = () => {
    const name = categoryForm.name.trim();
    setCategoryError("");
    if (!name) {
      setCategoryError("Category name is required.");
      return;
    }
    if (categoryNameExists(name, customCategories)) {
      setCategoryError("This category already exists (duplicate names are not allowed).");
      return;
    }
    setCustomCategories((prev) => [
      ...prev,
      { id: uid("cat"), name, notes: categoryForm.notes.trim() || undefined, createdAt: new Date().toISOString() },
    ]);
    setCategoryForm({ name: "", notes: "" });
    setCategoryModalOpen(false);
    setToast(`Category "${name}" added.`);
  };

  const deleteCustomCategory = (id: string) => {
    const cat = customCategories.find((c) => c.id === id);
    if (!cat) return;
    const inUse = suppliers.some((s) => normalizeCategoryKey(s.category) === normalizeCategoryKey(cat.name));
    if (inUse) {
      setToast(`Cannot delete "${cat.name}" — it is assigned to one or more suppliers.`);
      return;
    }
    setCustomCategories((prev) => prev.filter((c) => c.id !== id));
    setToast(`Category "${cat.name}" removed.`);
  };

  const categoryRows = useMemo(() => {
    const usage = new Map<string, number>();
    for (const s of suppliers) {
      usage.set(s.category, (usage.get(s.category) || 0) + 1);
    }
    const defaults = DEFAULT_SUPPLIER_CATEGORIES.map((name) => ({
      id: `default-${normalizeCategoryKey(name)}`,
      name,
      isCustom: false,
      notes: "",
      supplierCount: usage.get(name) || 0,
    }));
    const customs = customCategories.map((c) => ({
      id: c.id,
      name: c.name,
      isCustom: true,
      notes: c.notes || "",
      supplierCount: usage.get(c.name) || 0,
    }));
    return [...defaults, ...customs];
  }, [suppliers, customCategories]);

  const tabStyle = (id: TabId): React.CSSProperties => ({
    padding: "10px 16px",
    borderRadius: 10,
    border: activeTab === id ? `2px solid ${ACCOUNTING_GOLD}` : "1px solid #e2e8f0",
    background: activeTab === id ? ACCOUNTING_INK : "#fff",
    color: activeTab === id ? ACCOUNTING_GOLD : ACCOUNTING_INK,
    fontWeight: 800,
    cursor: "pointer",
    fontSize: 13,
  });

  return (
    <div style={accountingPageWrap}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 16,
          borderBottom: `2px solid ${ACCOUNTING_GOLD}`,
          paddingBottom: 20,
          marginBottom: 24,
        }}
      >
        <div>
          <h1 style={accountingTitle}>Suppliers</h1>
          <p style={accountingSubtitle}>
            Manage supplier profiles, categories, payment terms, and school purchase history.
          </p>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <button type="button" style={goldBtn} onClick={openAddSupplier}>
            Add Supplier
          </button>
          <button
            type="button"
            style={outlineBtn}
            onClick={() => {
              setCategoryForm({ name: "", notes: "" });
              setCategoryError("");
              setCategoryModalOpen(true);
            }}
          >
            Add Supplier Category
          </button>
          <button type="button" style={outlineBtn} onClick={() => setManageCategoriesOpen(true)}>
            Manage Categories
          </button>
        </div>
      </div>

      {toast ? (
        <div
          style={{
            marginBottom: 16,
            padding: "12px 16px",
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

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
          gap: 14,
          marginBottom: 24,
        }}
      >
        {[
          { label: "Total Suppliers", value: String(stats.total) },
          { label: "Active Suppliers", value: String(stats.active) },
          { label: "Monthly Spend", value: formatMoney(stats.monthlySpend) },
          { label: "Outstanding Supplier Balances", value: formatMoney(stats.outstanding) },
          { label: "Recurring Suppliers", value: String(stats.recurring) },
          { label: "Missing Details", value: String(stats.missing) },
        ].map((card) => (
          <div key={card.label} style={accountingCard}>
            <div style={accountingCardLabel}>{card.label}</div>
            <div style={accountingCardValue}>{card.value}</div>
          </div>
        ))}
      </div>

      <div
        style={{
          marginBottom: 16,
          padding: "12px 16px",
          borderRadius: 10,
          background: "rgba(17,24,39,0.04)",
          border: "1px dashed #cbd5e1",
          fontSize: 13,
          fontWeight: 600,
          color: "#64748b",
        }}
      >
        Approved expenses will automatically update supplier spend once connected.
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        {(
          [
            ["suppliers", "Suppliers"],
            ["categories", "Categories"],
            ["recurring", "Recurring Suppliers"],
            ["spend", "Supplier Spend"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" style={tabStyle(id)} onClick={() => setActiveTab(id)}>
            {label}
          </button>
        ))}
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          marginBottom: 16,
          alignItems: "flex-end",
        }}
      >
        <label style={{ flex: "1 1 200px", fontWeight: 700, fontSize: 13 }}>
          Search
          <input
            style={fieldStyle}
            placeholder="Name, email, category…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label style={{ minWidth: 160, fontWeight: 700, fontSize: 13 }}>
          Category
          <select style={fieldStyle} value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="">All categories</option>
            {categoryOptions.map((o) => (
              <option key={o.name} value={o.name}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        {activeTab === "suppliers" ? (
          <label style={{ minWidth: 140, fontWeight: 700, fontSize: 13 }}>
            Status
            <select style={fieldStyle} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              {["All", "Active", "Disabled"].map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {activeTab === "suppliers" ? (
        <div style={{ border: `2px solid ${ACCOUNTING_GOLD}`, borderRadius: 14, overflow: "hidden", background: "#fff" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Supplier", "Category", "Contact Person", "Email", "Phone", "Payment Terms", "Status", "Actions"].map(
                  (h) => (
                    <th key={h} style={th}>
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {suppliersPaginated.items.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ ...td, textAlign: "center", color: "#64748b", padding: 28 }}>
                    No suppliers match your filters.
                  </td>
                </tr>
              ) : (
                suppliersPaginated.items.map((s) => (
                  <tr key={s.id}>
                    <td style={td}>
                      <div style={{ fontWeight: 900, color: ACCOUNTING_INK }}>{s.name}</div>
                      {supplierSubline(s) ? (
                        <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>{supplierSubline(s)}</div>
                      ) : null}
                    </td>
                    <td style={td}>{s.category}</td>
                    <td style={td}>{s.contactPerson || "—"}</td>
                    <td style={td}>{s.email || "—"}</td>
                    <td style={td}>{s.phone || "—"}</td>
                    <td style={td}>{s.paymentTerms || "—"}</td>
                    <td style={td}>
                      <StatusPill status={s.status} />
                    </td>
                    <td style={td}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        <button type="button" style={ghostBtn} onClick={() => openEditSupplier(s)}>
                          Edit
                        </button>
                        <button type="button" style={ghostBtn} onClick={() => toggleSupplierStatus(s.id)}>
                          {s.status === "Active" ? "Disable" : "Enable"}
                        </button>
                        <button type="button" style={ghostBtn} onClick={() => viewSpend(s)}>
                          View Spend
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <TablePagination
            page={suppliersPaginated.page}
            totalPages={suppliersPaginated.totalPages}
            onPageChange={setSuppliersPage}
            visible={filteredSuppliers.length > PAGE_SIZE}
          />
        </div>
      ) : null}

      {activeTab === "categories" ? (
        <div style={{ border: `2px solid ${ACCOUNTING_GOLD}`, borderRadius: 14, overflow: "hidden", background: "#fff" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Category", "Type", "Suppliers", "Notes"].map((h) => (
                  <th key={h} style={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {categoryRows.map((row) => (
                <tr key={row.id}>
                  <td style={td}>
                    <span style={{ fontWeight: 800 }}>{row.name}</span>
                    {row.isCustom ? <CustomCategoryBadge /> : null}
                  </td>
                  <td style={td}>{row.isCustom ? "Custom" : "Default"}</td>
                  <td style={td}>{row.supplierCount}</td>
                  <td style={td}>{row.notes || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {activeTab === "recurring" ? (
        <div style={{ border: `2px solid ${ACCOUNTING_GOLD}`, borderRadius: 14, overflow: "hidden", background: "#fff" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Supplier", "Category", "Avg Monthly Spend", "Last Payment", "Auto-match Rule", "Status", "Actions"].map(
                  (h) => (
                    <th key={h} style={th}>
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {recurringPaginated.items.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ ...td, textAlign: "center", color: "#64748b", padding: 28 }}>
                    No recurring suppliers configured.
                  </td>
                </tr>
              ) : (
                recurringPaginated.items.map((s) => (
                  <tr key={s.id}>
                    <td style={td}>
                      <div style={{ fontWeight: 900 }}>{s.name}</div>
                      {supplierSubline(s) ? (
                        <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>{supplierSubline(s)}</div>
                      ) : null}
                    </td>
                    <td style={td}>{s.category}</td>
                    <td style={td}>{formatMoney(s.spend.averageMonthlySpend)}</td>
                    <td style={td}>{s.spend.lastPaymentDate || "—"}</td>
                    <td style={td}>{s.autoMatchRule || "—"}</td>
                    <td style={td}>
                      <StatusPill status={s.status} />
                    </td>
                    <td style={td}>
                      <button type="button" style={ghostBtn} onClick={() => viewSpend(s)}>
                        View Spend
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <TablePagination
            page={recurringPaginated.page}
            totalPages={recurringPaginated.totalPages}
            onPageChange={setRecurringPage}
            visible={recurringSuppliers.length > PAGE_SIZE}
          />
        </div>
      ) : null}

      {activeTab === "spend" ? (
        <div style={{ border: `2px solid ${ACCOUNTING_GOLD}`, borderRadius: 14, overflow: "hidden", background: "#fff" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Supplier", "Category", "This Month", "Last Month", "Year To Date", "Last Transaction", "Actions"].map(
                  (h) => (
                    <th key={h} style={th}>
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {spendPaginated.items.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ ...td, textAlign: "center", color: "#64748b", padding: 28 }}>
                    No spend records to display.
                  </td>
                </tr>
              ) : (
                spendPaginated.items.map((s) => (
                  <tr
                    key={s.id}
                    style={
                      spendFocusId === s.id
                        ? { background: "rgba(212,175,55,0.12)" }
                        : undefined
                    }
                  >
                    <td style={td}>
                      <div style={{ fontWeight: 900 }}>{s.name}</div>
                      {supplierSubline(s) ? (
                        <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>{supplierSubline(s)}</div>
                      ) : null}
                    </td>
                    <td style={td}>{s.category}</td>
                    <td style={td}>{formatMoney(s.spend.thisMonth)}</td>
                    <td style={td}>{formatMoney(s.spend.lastMonth)}</td>
                    <td style={td}>{formatMoney(s.spend.yearToDate)}</td>
                    <td style={td}>{s.spend.lastTransactionDate || "—"}</td>
                    <td style={td}>
                      <button type="button" style={ghostBtn} onClick={() => openEditSupplier(s)}>
                        Edit
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <TablePagination
            page={spendPaginated.page}
            totalPages={spendPaginated.totalPages}
            onPageChange={setSpendPage}
            visible={spendRows.length > PAGE_SIZE}
          />
        </div>
      ) : null}

      {supplierModalOpen ? (
        <div style={modalOverlay} role="dialog" aria-modal="true">
          <div style={{ ...modalPanel, width: "min(640px, 100%)" }}>
            <div style={modalHeader}>{editingSupplierId ? "Edit Supplier" : "Add Supplier"}</div>
            <div style={{ display: "grid", gap: 12 }}>
              <label>
                Supplier Name *
                <input
                  style={fieldStyle}
                  value={supplierForm.name}
                  onChange={(e) => setSupplierForm((f) => ({ ...f, name: e.target.value }))}
                />
              </label>
              <label>
                Supplier Category
                <select
                  style={fieldStyle}
                  value={supplierForm.category}
                  onChange={(e) => setSupplierForm((f) => ({ ...f, category: e.target.value }))}
                >
                  {categoryOptions.map((o) => (
                    <option key={o.name} value={o.name}>
                      {o.name}
                      {o.isCustom ? " (Custom)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label>
                  Contact Person
                  <input
                    style={fieldStyle}
                    value={supplierForm.contactPerson}
                    onChange={(e) => setSupplierForm((f) => ({ ...f, contactPerson: e.target.value }))}
                  />
                </label>
                <label>
                  Payment Terms
                  <input
                    style={fieldStyle}
                    value={supplierForm.paymentTerms}
                    onChange={(e) => setSupplierForm((f) => ({ ...f, paymentTerms: e.target.value }))}
                  />
                </label>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label>
                  Email
                  <input
                    style={fieldStyle}
                    value={supplierForm.email}
                    onChange={(e) => setSupplierForm((f) => ({ ...f, email: e.target.value }))}
                  />
                </label>
                <label>
                  Phone
                  <input
                    style={fieldStyle}
                    value={supplierForm.phone}
                    onChange={(e) => setSupplierForm((f) => ({ ...f, phone: e.target.value }))}
                  />
                </label>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label>
                  VAT Number
                  <input
                    style={fieldStyle}
                    value={supplierForm.vatNumber}
                    onChange={(e) => setSupplierForm((f) => ({ ...f, vatNumber: e.target.value }))}
                  />
                </label>
                <label>
                  Registration Number
                  <input
                    style={fieldStyle}
                    value={supplierForm.registrationNumber}
                    onChange={(e) => setSupplierForm((f) => ({ ...f, registrationNumber: e.target.value }))}
                  />
                </label>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                <label>
                  Bank Name
                  <input
                    style={fieldStyle}
                    value={supplierForm.bankName}
                    onChange={(e) => setSupplierForm((f) => ({ ...f, bankName: e.target.value }))}
                  />
                </label>
                <label>
                  Account Number
                  <input
                    style={fieldStyle}
                    value={supplierForm.accountNumber}
                    onChange={(e) => setSupplierForm((f) => ({ ...f, accountNumber: e.target.value }))}
                  />
                </label>
                <label>
                  Branch Code
                  <input
                    style={fieldStyle}
                    value={supplierForm.branchCode}
                    onChange={(e) => setSupplierForm((f) => ({ ...f, branchCode: e.target.value }))}
                  />
                </label>
              </div>
              <label>
                Notes
                <textarea
                  style={{ ...fieldStyle, minHeight: 72, resize: "vertical" }}
                  value={supplierForm.notes}
                  onChange={(e) => setSupplierForm((f) => ({ ...f, notes: e.target.value }))}
                />
              </label>
              <label>
                Status
                <select
                  style={fieldStyle}
                  value={supplierForm.status}
                  onChange={(e) =>
                    setSupplierForm((f) => ({
                      ...f,
                      status: e.target.value === "Disabled" ? "Disabled" : "Active",
                    }))
                  }
                >
                  <option value="Active">Active</option>
                  <option value="Disabled">Disabled</option>
                </select>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700 }}>
                <input
                  type="checkbox"
                  checked={supplierForm.recurring}
                  onChange={(e) => setSupplierForm((f) => ({ ...f, recurring: e.target.checked }))}
                />
                Recurring supplier
              </label>
              {supplierForm.recurring ? (
                <label>
                  Auto-match Rule
                  <input
                    style={fieldStyle}
                    placeholder="e.g. Contains ESKOM"
                    value={supplierForm.autoMatchRule}
                    onChange={(e) => setSupplierForm((f) => ({ ...f, autoMatchRule: e.target.value }))}
                  />
                </label>
              ) : null}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "flex-end" }}>
              <button type="button" style={outlineBtn} onClick={() => setSupplierModalOpen(false)}>
                Cancel
              </button>
              <button type="button" style={goldBtn} onClick={saveSupplier}>
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {categoryModalOpen ? (
        <div style={modalOverlay} role="dialog" aria-modal="true">
          <div style={modalPanel}>
            <div style={modalHeader}>Add Supplier Category</div>
            <label>
              Category Name *
              <input
                style={fieldStyle}
                value={categoryForm.name}
                onChange={(e) => setCategoryForm((f) => ({ ...f, name: e.target.value }))}
              />
            </label>
            <label>
              Notes
              <textarea
                style={{ ...fieldStyle, minHeight: 72, resize: "vertical" }}
                value={categoryForm.notes}
                onChange={(e) => setCategoryForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </label>
            {categoryError ? (
              <p style={{ color: "#b91c1c", fontWeight: 700, fontSize: 13, marginTop: 12 }}>{categoryError}</p>
            ) : null}
            <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "flex-end" }}>
              <button
                type="button"
                style={outlineBtn}
                onClick={() => {
                  setCategoryModalOpen(false);
                  setCategoryError("");
                }}
              >
                Cancel
              </button>
              <button type="button" style={goldBtn} onClick={saveCategory}>
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {manageCategoriesOpen ? (
        <div style={modalOverlay} role="dialog" aria-modal="true">
          <div style={{ ...modalPanel, width: "min(640px, 100%)" }}>
            <div style={modalHeader}>Manage Categories</div>
            <p style={{ fontSize: 13, color: "#64748b", marginBottom: 16, fontWeight: 600 }}>
              Default categories cannot be deleted. Custom categories can only be removed when not used by any supplier.
            </p>
            <div style={{ maxHeight: 360, overflow: "auto", border: "1px solid #e2e8f0", borderRadius: 10 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ ...th, position: "sticky", top: 0 }}>Category</th>
                    <th style={{ ...th, position: "sticky", top: 0 }}>In use</th>
                    <th style={{ ...th, position: "sticky", top: 0 }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {categoryRows.map((row) => (
                    <tr key={row.id}>
                      <td style={td}>
                        <span style={{ fontWeight: 800 }}>{row.name}</span>
                        {row.isCustom ? <CustomCategoryBadge /> : null}
                      </td>
                      <td style={td}>{row.supplierCount}</td>
                      <td style={td}>
                        {row.isCustom ? (
                          <button
                            type="button"
                            style={ghostBtn}
                            disabled={row.supplierCount > 0}
                            onClick={() => deleteCustomCategory(row.id)}
                          >
                            Delete
                          </button>
                        ) : (
                          <span style={{ color: "#94a3b8", fontSize: 12 }}>Protected</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20 }}>
              <button type="button" style={goldBtn} onClick={() => setManageCategoriesOpen(false)}>
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
