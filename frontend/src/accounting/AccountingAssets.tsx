import React, { useEffect, useMemo, useState } from "react";
import {
  type AssetRecord,
  computeAssetDepreciation,
  loadAssets,
  persistAssets,
} from "./accountingAssetStorage";
import {
  ACCOUNTING_GOLD,
  ACCOUNTING_INK,
  accountingCard,
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

export type { AssetRecord } from "./accountingAssetStorage";
export { computeAssetDepreciation } from "./accountingAssetStorage";

export const DEFAULT_ASSET_CATEGORIES = [
  "Buildings",
  "Land",
  "Buses",
  "Vehicles",
  "Computers",
  "iPads / Tablets",
  "Furniture",
  "Tables",
  "Chairs",
  "Projectors",
  "Smartboards",
  "Sports Equipment",
  "Kitchen Equipment",
  "Security Equipment",
  "Office Equipment",
  "Other",
] as const;

type AssetStatus = AssetRecord["status"];
type DepreciationMethod = AssetRecord["depreciationMethod"];
type TabId = "register" | "categories" | "depreciation" | "maintenance" | "disposal";

export type MaintenanceRecord = {
  id: string;
  assetId: string;
  assetName: string;
  date: string;
  description: string;
  cost: number;
  supplier: string;
  nextServiceDate: string;
  status: "Scheduled" | "Completed" | "Overdue";
  createdAt: string;
};

type CustomAssetCategory = {
  id: string;
  name: string;
  notes?: string;
  createdAt: string;
};

type CategoryOption = { name: string; isCustom: boolean };

type Props = {
  schoolId?: string;
};

const CUSTOM_CATEGORIES_STORAGE_PREFIX = "educlearAccountingAssetCategories:";
const MAINTENANCE_STORAGE_PREFIX = "educlearAccountingAssetMaintenance:";
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
  width: "min(620px, 100%)",
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

const tabBar: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
  marginBottom: 20,
  borderBottom: `2px solid ${ACCOUNTING_GOLD}`,
  paddingBottom: 4,
};

const assetsSummaryGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(185px, 1fr))",
  gap: 16,
  marginBottom: 24,
  alignItems: "stretch",
};

const assetsSummaryCard: React.CSSProperties = {
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

const assetsSummaryLabel: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 800,
  color: "#64748b",
  textTransform: "uppercase",
  letterSpacing: "0.07em",
  lineHeight: 1.25,
  marginBottom: 8,
};

const assetsSummaryValueWrap: React.CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  justifyContent: "flex-end",
  maxWidth: "100%",
  minHeight: 0,
};

const assetsSummaryValue: React.CSSProperties = {
  fontSize: "clamp(1.35rem, 1.6vw, 2rem)",
  lineHeight: 1.1,
  fontWeight: 700,
  letterSpacing: "-0.02em",
  fontVariantNumeric: "tabular-nums",
  color: ACCOUNTING_INK,
  maxWidth: "100%",
  overflowWrap: "anywhere",
  wordBreak: "normal",
  whiteSpace: "normal",
};

function uid(prefix = "ast") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatMoney(value: number) {
  const n = Number.isFinite(value) ? value : 0;
  return `R ${n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function customCategoriesStorageKey(schoolId: string) {
  return CUSTOM_CATEGORIES_STORAGE_PREFIX + schoolId;
}

function maintenanceStorageKey(schoolId: string) {
  return MAINTENANCE_STORAGE_PREFIX + schoolId;
}

function normalizeCategoryKey(name: string) {
  return String(name || "").trim().toLowerCase();
}

function parseIsoDate(value: string) {
  const d = new Date(`${String(value || "").slice(0, 10)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function categoryNameExists(name: string, customCategories: CustomAssetCategory[]) {
  const key = normalizeCategoryKey(name);
  if (!key) return true;
  if (DEFAULT_ASSET_CATEGORIES.some((d) => normalizeCategoryKey(d) === key)) return true;
  return customCategories.some((c) => normalizeCategoryKey(c.name) === key);
}

function isDefaultCategory(name: string) {
  const key = normalizeCategoryKey(name);
  return DEFAULT_ASSET_CATEGORIES.some((d) => normalizeCategoryKey(d) === key);
}

function loadCustomCategories(schoolId: string): CustomAssetCategory[] {
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

function saveCustomCategories(schoolId: string, rows: CustomAssetCategory[]) {
  try {
    localStorage.setItem(customCategoriesStorageKey(schoolId), JSON.stringify(rows));
  } catch {
    /* ignore */
  }
}

function loadMaintenance(schoolId: string): MaintenanceRecord[] {
  try {
    const raw = localStorage.getItem(maintenanceStorageKey(schoolId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((row: Record<string, unknown>) => ({
      id: String(row?.id || uid("mnt")),
      assetId: String(row?.assetId || "").trim(),
      assetName: String(row?.assetName || "").trim(),
      date: String(row?.date || "").slice(0, 10),
      description: String(row?.description || "").trim(),
      cost: Math.max(0, Number(row?.cost) || 0),
      supplier: String(row?.supplier || "").trim(),
      nextServiceDate: String(row?.nextServiceDate || "").slice(0, 10),
      status:
        row?.status === "Scheduled" || row?.status === "Overdue"
          ? (row.status as MaintenanceRecord["status"])
          : "Completed",
      createdAt: String(row?.createdAt || new Date().toISOString()),
    }));
  } catch {
    return [];
  }
}

function persistMaintenance(schoolId: string, rows: MaintenanceRecord[]) {
  try {
    localStorage.setItem(maintenanceStorageKey(schoolId), JSON.stringify(rows));
  } catch {
    /* ignore */
  }
}

function buildCategoryOptions(
  customCategories: CustomAssetCategory[],
  extraNames: Iterable<string> = []
): CategoryOption[] {
  const customByKey = new Map(customCategories.map((c) => [normalizeCategoryKey(c.name), c]));
  const options: CategoryOption[] = DEFAULT_ASSET_CATEGORIES.map((name) => ({
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
  if (!visible || totalPages <= 1) return null;
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

function StatusPill({ status }: { status: AssetStatus }) {
  const styles: Record<AssetStatus, { bg: string; color: string; border: string }> = {
    Active: { bg: "#dcfce7", color: "#166534", border: "#86efac" },
    "Under Maintenance": { bg: "#fef3c7", color: "#92400e", border: "#fcd34d" },
    Disposed: { bg: "#f1f5f9", color: "#64748b", border: "#e2e8f0" },
  };
  const s = styles[status] || styles.Active;
  return (
    <span
      style={{
        display: "inline-block",
        padding: "4px 10px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 800,
        background: s.bg,
        color: s.color,
        border: `1px solid ${s.border}`,
      }}
    >
      {status}
    </span>
  );
}

function AssetNameCell({ asset }: { asset: AssetRecord }) {
  const sub = [asset.serialNumber, asset.notes].filter(Boolean).join(" · ");
  return (
    <div>
      <div style={{ fontWeight: 900, color: ACCOUNTING_INK }}>{asset.name}</div>
      {sub ? (
        <div style={{ fontSize: 12, color: "#64748b", marginTop: 2, lineHeight: 1.35 }}>{sub}</div>
      ) : null}
    </div>
  );
}

const emptyAssetForm = (): Omit<AssetRecord, "id" | "createdAt" | "updatedAt" | "depreciationYearsApplied"> => ({
  name: "",
  category: "Other",
  assetNumber: "",
  serialNumber: "",
  purchaseDate: new Date().toISOString().slice(0, 10),
  purchaseCost: 0,
  depreciationMethod: "Straight Line",
  usefulLifeYears: 5,
  currentBookValue: 0,
  location: "",
  assignedTo: "",
  supplier: "",
  warrantyExpiry: "",
  notes: "",
  status: "Active",
  disposalDate: "",
  disposalAmount: 0,
  disposalReason: "",
  disposalNotes: "",
});

export default function AccountingAssets({ schoolId = "" }: Props) {
  const sid = String(schoolId || "default-school").trim() || "default-school";

  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [customCategories, setCustomCategories] = useState<CustomAssetCategory[]>([]);
  const [maintenance, setMaintenance] = useState<MaintenanceRecord[]>([]);
  const [hydrated, setHydrated] = useState(false);

  const [activeTab, setActiveTab] = useState<TabId>("register");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");

  const [registerPage, setRegisterPage] = useState(1);
  const [depreciationPage, setDepreciationPage] = useState(1);
  const [maintenancePage, setMaintenancePage] = useState(1);
  const [disposalPage, setDisposalPage] = useState(1);

  const [assetModalOpen, setAssetModalOpen] = useState(false);
  const [editingAssetId, setEditingAssetId] = useState<string | null>(null);
  const [assetForm, setAssetForm] = useState(emptyAssetForm());

  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [categoryForm, setCategoryForm] = useState({ name: "", notes: "" });
  const [categoryError, setCategoryError] = useState("");
  const [manageCategoriesOpen, setManageCategoriesOpen] = useState(false);

  const [maintenanceModalOpen, setMaintenanceModalOpen] = useState(false);
  const [maintenanceForm, setMaintenanceForm] = useState({
    assetId: "",
    date: new Date().toISOString().slice(0, 10),
    description: "",
    cost: 0,
    supplier: "",
    nextServiceDate: "",
    status: "Completed" as MaintenanceRecord["status"],
  });

  const [disposalModalOpen, setDisposalModalOpen] = useState(false);
  const [disposalAssetId, setDisposalAssetId] = useState<string | null>(null);
  const [disposalForm, setDisposalForm] = useState({
    disposalDate: new Date().toISOString().slice(0, 10),
    disposalAmount: 0,
    disposalReason: "",
    disposalNotes: "",
  });

  const [toast, setToast] = useState("");

  useEffect(() => {
    const stored = loadAssets(sid);
    setAssets(stored.length ? stored : []);
    setCustomCategories(loadCustomCategories(sid));
    setMaintenance(loadMaintenance(sid));
    setHydrated(true);
  }, [sid]);

  useEffect(() => {
    if (!hydrated) return;
    persistAssets(sid, assets);
  }, [sid, assets, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    saveCustomCategories(sid, customCategories);
  }, [sid, customCategories, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    persistMaintenance(sid, maintenance);
  }, [sid, maintenance, hydrated]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(t);
  }, [toast]);

  const categoryOptions = useMemo(
    () => buildCategoryOptions(customCategories, assets.map((a) => a.category)),
    [customCategories, assets]
  );

  const assetsWithDepreciation = useMemo(
    () =>
      assets.map((a) => ({
        asset: a,
        dep: computeAssetDepreciation(a),
      })),
    [assets]
  );

  const stats = useMemo(() => {
    const active = assetsWithDepreciation.filter(({ asset }) => asset.status !== "Disposed");
    const totalCost = assets.reduce((s, a) => s + a.purchaseCost, 0);
    const bookValue = assetsWithDepreciation.reduce((s, { dep }) => s + dep.bookValue, 0);
    const depreciationThisYear = active.reduce((s, { dep }) => s + dep.depreciationThisYear, 0);
    const vehicles = assets.filter((a) => {
      const c = normalizeCategoryKey(a.category);
      return c === "buses" || c === "vehicles";
    }).length;
    const devices = assets.filter((a) => {
      const c = normalizeCategoryKey(a.category);
      return c === "computers" || c === "ipads / tablets";
    }).length;
    return {
      totalAssets: assets.length,
      totalCost,
      bookValue,
      depreciationThisYear,
      vehicles,
      devices,
    };
  }, [assets, assetsWithDepreciation]);

  const matchesSearch = (a: AssetRecord) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      a.name.toLowerCase().includes(q) ||
      a.category.toLowerCase().includes(q) ||
      a.serialNumber.toLowerCase().includes(q) ||
      a.location.toLowerCase().includes(q) ||
      a.assetNumber.toLowerCase().includes(q)
    );
  };

  const matchesFilters = (a: AssetRecord) => {
    if (categoryFilter && a.category !== categoryFilter) return false;
    if (statusFilter !== "All" && a.status !== statusFilter) return false;
    return true;
  };

  const filteredRegister = useMemo(
    () => assetsWithDepreciation.filter(({ asset }) => matchesSearch(asset) && matchesFilters(asset)),
    [assetsWithDepreciation, search, categoryFilter, statusFilter]
  );

  const filteredDepreciation = useMemo(
    () =>
      assetsWithDepreciation.filter(
        ({ asset }) => matchesSearch(asset) && matchesFilters(asset) && asset.depreciationMethod !== "None"
      ),
    [assetsWithDepreciation, search, categoryFilter, statusFilter]
  );

  const filteredMaintenance = useMemo(() => {
    const q = search.trim().toLowerCase();
    return maintenance.filter((m) => {
      if (categoryFilter) {
        const asset = assets.find((a) => a.id === m.assetId);
        if (asset && asset.category !== categoryFilter) return false;
      }
      if (!q) return true;
      return (
        m.assetName.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q) ||
        m.supplier.toLowerCase().includes(q)
      );
    });
  }, [maintenance, assets, search, categoryFilter]);

  const filteredDisposal = useMemo(
    () =>
      assetsWithDepreciation.filter(
        ({ asset }) => asset.status === "Disposed" && matchesSearch(asset) && matchesFilters(asset)
      ),
    [assetsWithDepreciation, search, categoryFilter, statusFilter]
  );

  const registerPaginated = useMemo(
    () => paginateList(filteredRegister, registerPage),
    [filteredRegister, registerPage]
  );
  const depreciationPaginated = useMemo(
    () => paginateList(filteredDepreciation, depreciationPage),
    [filteredDepreciation, depreciationPage]
  );
  const maintenancePaginated = useMemo(
    () => paginateList(filteredMaintenance, maintenancePage),
    [filteredMaintenance, maintenancePage]
  );
  const disposalPaginated = useMemo(
    () => paginateList(filteredDisposal, disposalPage),
    [filteredDisposal, disposalPage]
  );

  useEffect(() => {
    setRegisterPage(1);
    setDepreciationPage(1);
    setMaintenancePage(1);
    setDisposalPage(1);
  }, [search, categoryFilter, statusFilter, activeTab]);

  const openAddAsset = () => {
    setEditingAssetId(null);
    setAssetForm(emptyAssetForm());
    setAssetModalOpen(true);
  };

  const openEditAsset = (a: AssetRecord) => {
    const dep = computeAssetDepreciation(a);
    setEditingAssetId(a.id);
    setAssetForm({
      name: a.name,
      category: a.category,
      assetNumber: a.assetNumber,
      serialNumber: a.serialNumber,
      purchaseDate: a.purchaseDate,
      purchaseCost: a.purchaseCost,
      depreciationMethod: a.depreciationMethod,
      usefulLifeYears: a.usefulLifeYears,
      currentBookValue: dep.bookValue,
      location: a.location,
      assignedTo: a.assignedTo,
      supplier: a.supplier,
      warrantyExpiry: a.warrantyExpiry,
      notes: a.notes,
      status: a.status,
      disposalDate: a.disposalDate,
      disposalAmount: a.disposalAmount,
      disposalReason: a.disposalReason,
      disposalNotes: a.disposalNotes,
    });
    setAssetModalOpen(true);
  };

  const saveAsset = () => {
    const name = assetForm.name.trim();
    if (!name) {
      setToast("Asset name is required.");
      return;
    }
    const now = new Date().toISOString();
    const draft: AssetRecord = {
      id: editingAssetId || uid(),
      ...assetForm,
      name,
      purchaseCost: Math.max(0, Number(assetForm.purchaseCost) || 0),
      usefulLifeYears: Math.max(0, Number(assetForm.usefulLifeYears) || 0),
      depreciationYearsApplied: editingAssetId
        ? assets.find((a) => a.id === editingAssetId)?.depreciationYearsApplied || []
        : [],
      createdAt: editingAssetId ? assets.find((a) => a.id === editingAssetId)?.createdAt || now : now,
      updatedAt: now,
    };
    const dep = computeAssetDepreciation(draft);
    const row: AssetRecord = { ...draft, currentBookValue: dep.bookValue };

    if (editingAssetId) {
      setAssets((prev) => prev.map((a) => (a.id === editingAssetId ? row : a)));
      setToast("Asset updated.");
    } else {
      setAssets((prev) => [row, ...prev]);
      setToast("Asset added.");
    }
    setAssetModalOpen(false);
  };

  const runDepreciation = () => {
    const year = new Date().getFullYear();
    let count = 0;
    setAssets((prev) =>
      prev.map((a) => {
        if (a.status === "Disposed" || a.depreciationMethod === "None") return a;
        if ((a.depreciationYearsApplied || []).includes(year)) return a;
        const dep = computeAssetDepreciation(a);
        if (dep.bookValue <= 0) return a;
        count += 1;
        const updated: AssetRecord = {
          ...a,
          depreciationYearsApplied: [...(a.depreciationYearsApplied || []), year],
          updatedAt: new Date().toISOString(),
        };
        const nextDep = computeAssetDepreciation(updated);
        return { ...updated, currentBookValue: nextDep.bookValue };
      })
    );
    setToast(
      count
        ? `Depreciation run applied for ${year} on ${count} asset(s).`
        : `No assets eligible for depreciation run in ${year}.`
    );
  };

  const saveCategory = () => {
    const name = categoryForm.name.trim();
    setCategoryError("");
    if (!name) {
      setCategoryError("Category name is required.");
      return;
    }
    if (categoryNameExists(name, customCategories)) {
      setCategoryError("Category already exists.");
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
    if (isDefaultCategory(cat.name)) {
      setToast("Default categories cannot be deleted.");
      return;
    }
    const inUse = assets.some((a) => a.category === cat.name);
    if (inUse) {
      setToast("Category is in use by assets and cannot be deleted.");
      return;
    }
    setCustomCategories((prev) => prev.filter((c) => c.id !== id));
    setToast("Custom category removed.");
  };

  const openMaintenanceModal = (assetId = "") => {
    setMaintenanceForm({
      assetId: assetId || assets[0]?.id || "",
      date: new Date().toISOString().slice(0, 10),
      description: "",
      cost: 0,
      supplier: "",
      nextServiceDate: "",
      status: "Completed",
    });
    setMaintenanceModalOpen(true);
  };

  const saveMaintenance = () => {
    const asset = assets.find((a) => a.id === maintenanceForm.assetId);
    if (!asset) {
      setToast("Select an asset for this maintenance record.");
      return;
    }
    if (!maintenanceForm.description.trim()) {
      setToast("Description is required.");
      return;
    }
    const row: MaintenanceRecord = {
      id: uid("mnt"),
      assetId: asset.id,
      assetName: asset.name,
      date: maintenanceForm.date,
      description: maintenanceForm.description.trim(),
      cost: Math.max(0, Number(maintenanceForm.cost) || 0),
      supplier: maintenanceForm.supplier.trim(),
      nextServiceDate: maintenanceForm.nextServiceDate,
      status: maintenanceForm.status,
      createdAt: new Date().toISOString(),
    };
    setMaintenance((prev) => [row, ...prev]);
    if (asset.status === "Active") {
      setAssets((prev) =>
        prev.map((a) => (a.id === asset.id ? { ...a, status: "Under Maintenance", updatedAt: new Date().toISOString() } : a))
      );
    }
    setMaintenanceModalOpen(false);
    setToast("Maintenance record added.");
  };

  const openDisposalModal = (assetId: string) => {
    const a = assets.find((x) => x.id === assetId);
    setDisposalAssetId(assetId);
    setDisposalForm({
      disposalDate: a?.disposalDate || new Date().toISOString().slice(0, 10),
      disposalAmount: a?.disposalAmount || 0,
      disposalReason: a?.disposalReason || "",
      disposalNotes: a?.disposalNotes || "",
    });
    setDisposalModalOpen(true);
  };

  const saveDisposal = () => {
    if (!disposalAssetId) return;
    const now = new Date().toISOString();
    setAssets((prev) =>
      prev.map((a) =>
        a.id === disposalAssetId
          ? {
              ...a,
              status: "Disposed",
              disposalDate: disposalForm.disposalDate,
              disposalAmount: Math.max(0, Number(disposalForm.disposalAmount) || 0),
              disposalReason: disposalForm.disposalReason.trim(),
              disposalNotes: disposalForm.disposalNotes.trim(),
              updatedAt: now,
            }
          : a
      )
    );
    setDisposalModalOpen(false);
    setToast("Asset marked as disposed.");
  };

  const exportAssetRegister = (format: "pdf" | "csv") => {
    const active = assets.filter((a) => a.status !== "Disposed");
    if (!active.length) {
      setToast("No active assets to export.");
      return;
    }
    const payload = payloadFromTable(
      resolveExportBranding(),
      "Assets Register",
      `As at ${new Date().toLocaleDateString("en-ZA")}`,
      new Date().toLocaleString("en-ZA"),
      {
        columns: ["Asset", "Category", "Purchase date", "Cost", "Net book", "Location", "Status"],
        rows: active.map((a) => [
          a.name,
          a.category,
          a.purchaseDate || "—",
          formatExportMoney(a.purchaseCost),
          formatExportMoney(a.currentBookValue || 0),
          a.location || "—",
          a.status || "Active",
        ]),
      },
      [{ label: "Active assets", value: String(active.length) }]
    );
    if (format === "pdf") {
      if (!exportPayloadPdf(payload)) setToast("Pop-up blocked. Allow pop-ups to export.");
    } else {
      exportPayloadCsv(payload);
    }
  };

  const tabStyle = (id: TabId): React.CSSProperties => ({
    padding: "10px 16px",
    border: "none",
    borderBottom: activeTab === id ? `3px solid ${ACCOUNTING_GOLD}` : "3px solid transparent",
    background: activeTab === id ? "rgba(212,175,55,0.12)" : "transparent",
    color: activeTab === id ? ACCOUNTING_INK : "#64748b",
    fontWeight: activeTab === id ? 900 : 700,
    cursor: "pointer",
    fontSize: 14,
    borderRadius: "8px 8px 0 0",
  });

  return (
    <div style={accountingPageWrap}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 16, marginBottom: 24 }}>
        <div>
          <h1 style={accountingTitle}>Assets</h1>
          <p style={accountingSubtitle}>
            Manage school buildings, vehicles, furniture, devices, and fixed assets.
          </p>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-start" }}>
          <button type="button" style={goldBtn} onClick={openAddAsset}>
            Add Asset
          </button>
          <button type="button" style={outlineBtn} onClick={() => setCategoryModalOpen(true)}>
            Add Category
          </button>
          <button type="button" style={outlineBtn} onClick={runDepreciation}>
            Depreciation Run
          </button>
          <button type="button" style={outlineBtn} onClick={() => exportAssetRegister("pdf")}>
            Export Asset Register (PDF)
          </button>
          <button type="button" style={outlineBtn} onClick={() => exportAssetRegister("csv")}>
            Export Asset Register (CSV)
          </button>
        </div>
      </div>

      {toast ? (
        <div
          style={{
            marginBottom: 16,
            padding: "12px 16px",
            borderRadius: 10,
            background: ACCOUNTING_INK,
            color: ACCOUNTING_GOLD,
            fontWeight: 800,
            fontSize: 14,
          }}
        >
          {toast}
        </div>
      ) : null}

      <div style={assetsSummaryGrid}>
        {[
          { label: "Total Assets", value: String(stats.totalAssets) },
          { label: "Total Cost", value: formatMoney(stats.totalCost) },
          { label: "Book Value", value: formatMoney(stats.bookValue) },
          { label: "Depreciation This Year", value: formatMoney(stats.depreciationThisYear) },
          { label: "Vehicles", value: String(stats.vehicles) },
          { label: "Devices", value: String(stats.devices) },
        ].map((card) => (
          <div key={card.label} style={assetsSummaryCard}>
            <div style={assetsSummaryLabel}>{card.label}</div>
            <div style={assetsSummaryValueWrap}>
              <div style={assetsSummaryValue}>{card.value}</div>
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          marginBottom: 20,
          padding: "12px 16px",
          borderRadius: 10,
          border: `1px dashed ${ACCOUNTING_GOLD}`,
          background: "rgba(212,175,55,0.06)",
          color: "#64748b",
          fontSize: 13,
          fontWeight: 600,
          lineHeight: 1.5,
        }}
      >
        Asset depreciation feeds Financial Statements automatically. Disposed assets remain available for audit
        history.
      </div>

      <div style={tabBar}>
        {(
          [
            ["register", "Asset Register"],
            ["categories", "Categories"],
            ["depreciation", "Depreciation"],
            ["maintenance", "Maintenance"],
            ["disposal", "Disposal"],
          ] as [TabId, string][]
        ).map(([id, label]) => (
          <button key={id} type="button" style={tabStyle(id)} onClick={() => setActiveTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {(activeTab === "register" || activeTab === "depreciation" || activeTab === "maintenance" || activeTab === "disposal") && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
          <input
            style={{ ...fieldStyle, marginTop: 0, flex: "1 1 200px", maxWidth: 320 }}
            placeholder="Search name, category, serial, location…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            style={{ ...fieldStyle, marginTop: 0, flex: "0 1 180px" }}
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            <option value="">All categories</option>
            {categoryOptions.map((o) => (
              <option key={o.name} value={o.name}>
                {o.name}
              </option>
            ))}
          </select>
          {activeTab === "register" || activeTab === "disposal" ? (
            <select
              style={{ ...fieldStyle, marginTop: 0, flex: "0 1 160px" }}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="All">All statuses</option>
              <option value="Active">Active</option>
              <option value="Under Maintenance">Under Maintenance</option>
              <option value="Disposed">Disposed</option>
            </select>
          ) : null}
        </div>
      )}

      {activeTab === "register" && (
        <div style={{ ...accountingCard, padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Asset Name", "Category", "Asset No", "Purchase Date", "Cost", "Book Value", "Location", "Status", "Actions"].map(
                  (h) => (
                    <th key={h} style={th}>
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {registerPaginated.items.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ ...td, textAlign: "center", color: "#64748b", padding: 28 }}>
                    No assets match your filters.
                  </td>
                </tr>
              ) : (
                registerPaginated.items.map(({ asset, dep }) => (
                  <tr key={asset.id}>
                    <td style={td}>
                      <AssetNameCell asset={asset} />
                    </td>
                    <td style={td}>{asset.category}</td>
                    <td style={td}>{asset.assetNumber || "—"}</td>
                    <td style={td}>{asset.purchaseDate || "—"}</td>
                    <td style={td}>{formatMoney(asset.purchaseCost)}</td>
                    <td style={td}>{formatMoney(dep.bookValue)}</td>
                    <td style={td}>{asset.location || "—"}</td>
                    <td style={td}>
                      <StatusPill status={asset.status} />
                    </td>
                    <td style={td}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        <button type="button" style={ghostBtn} onClick={() => openEditAsset(asset)}>
                          Edit
                        </button>
                        {asset.status !== "Disposed" ? (
                          <button type="button" style={ghostBtn} onClick={() => openDisposalModal(asset.id)}>
                            Dispose
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <TablePagination
            page={registerPaginated.page}
            totalPages={registerPaginated.totalPages}
            onPageChange={setRegisterPage}
            visible={registerPaginated.totalItems > PAGE_SIZE}
          />
        </div>
      )}

      {activeTab === "categories" && (
        <div style={{ display: "grid", gap: 16 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button type="button" style={goldBtn} onClick={() => setCategoryModalOpen(true)}>
              Add Category
            </button>
            <button type="button" style={outlineBtn} onClick={() => setManageCategoriesOpen((v) => !v)}>
              {manageCategoriesOpen ? "Hide" : "Manage"} custom categories
            </button>
          </div>
          <div style={{ ...accountingCard, padding: 0, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Category", "Type", "Notes", ""].map((h) => (
                    <th key={h || "act"} style={th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {categoryOptions.map((o) => (
                  <tr key={o.name}>
                    <td style={{ ...td, fontWeight: 800 }}>{o.name}</td>
                    <td style={td}>{o.isCustom ? <CustomCategoryBadge /> : "Default"}</td>
                    <td style={td}>
                      {o.isCustom
                        ? customCategories.find((c) => c.name === o.name)?.notes || "—"
                        : "Built-in category"}
                    </td>
                    <td style={td}>
                      {o.isCustom && manageCategoriesOpen ? (
                        <button
                          type="button"
                          style={ghostBtn}
                          onClick={() => {
                            const cat = customCategories.find((c) => c.name === o.name);
                            if (cat) deleteCustomCategory(cat.id);
                          }}
                        >
                          Delete
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === "depreciation" && (
        <div style={{ ...accountingCard, padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {[
                  "Asset",
                  "Category",
                  "Cost",
                  "Useful Life",
                  "Accumulated Depreciation",
                  "Current Book Value",
                  "Annual Depreciation",
                  "Status",
                ].map((h) => (
                  <th key={h} style={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {depreciationPaginated.items.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ ...td, textAlign: "center", color: "#64748b", padding: 28 }}>
                    No depreciable assets found.
                  </td>
                </tr>
              ) : (
                depreciationPaginated.items.map(({ asset, dep }) => (
                  <tr key={asset.id}>
                    <td style={td}>
                      <AssetNameCell asset={asset} />
                    </td>
                    <td style={td}>{asset.category}</td>
                    <td style={td}>{formatMoney(asset.purchaseCost)}</td>
                    <td style={td}>{asset.usefulLifeYears ? `${asset.usefulLifeYears} yrs` : "—"}</td>
                    <td style={td}>{formatMoney(dep.accumulatedDepreciation)}</td>
                    <td style={td}>{formatMoney(dep.bookValue)}</td>
                    <td style={td}>{formatMoney(dep.annualDepreciation)}</td>
                    <td style={td}>
                      <StatusPill status={asset.status} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <TablePagination
            page={depreciationPaginated.page}
            totalPages={depreciationPaginated.totalPages}
            onPageChange={setDepreciationPage}
            visible={depreciationPaginated.totalItems > PAGE_SIZE}
          />
        </div>
      )}

      {activeTab === "maintenance" && (
        <div style={{ display: "grid", gap: 12 }}>
          <button type="button" style={goldBtn} onClick={() => openMaintenanceModal()}>
            Add maintenance record
          </button>
          <div style={{ ...accountingCard, padding: 0, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Asset", "Date", "Description", "Cost", "Supplier", "Next Service", "Status"].map((h) => (
                    <th key={h} style={th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {maintenancePaginated.items.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ ...td, textAlign: "center", color: "#64748b", padding: 28 }}>
                      No maintenance records yet.
                    </td>
                  </tr>
                ) : (
                  maintenancePaginated.items.map((m) => (
                    <tr key={m.id}>
                      <td style={{ ...td, fontWeight: 800 }}>{m.assetName}</td>
                      <td style={td}>{m.date}</td>
                      <td style={td}>{m.description}</td>
                      <td style={td}>{formatMoney(m.cost)}</td>
                      <td style={td}>{m.supplier || "—"}</td>
                      <td style={td}>{m.nextServiceDate || "—"}</td>
                      <td style={td}>{m.status}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            <TablePagination
              page={maintenancePaginated.page}
              totalPages={maintenancePaginated.totalPages}
              onPageChange={setMaintenancePage}
              visible={maintenancePaginated.totalItems > PAGE_SIZE}
            />
          </div>
        </div>
      )}

      {activeTab === "disposal" && (
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ ...accountingCard, padding: 0, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Asset", "Disposal Date", "Amount", "Reason", "Notes", "Actions"].map((h) => (
                    <th key={h} style={th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {disposalPaginated.items.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ ...td, textAlign: "center", color: "#64748b", padding: 28 }}>
                      No disposed assets yet. Mark an asset disposed from the register or below.
                    </td>
                  </tr>
                ) : (
                  disposalPaginated.items.map(({ asset }) => (
                    <tr key={asset.id}>
                      <td style={td}>
                        <AssetNameCell asset={asset} />
                      </td>
                      <td style={td}>{asset.disposalDate || "—"}</td>
                      <td style={td}>{formatMoney(asset.disposalAmount)}</td>
                      <td style={td}>{asset.disposalReason || "—"}</td>
                      <td style={td}>{asset.disposalNotes || "—"}</td>
                      <td style={td}>
                        <button type="button" style={ghostBtn} onClick={() => openEditAsset(asset)}>
                          View
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            <TablePagination
              page={disposalPaginated.page}
              totalPages={disposalPaginated.totalPages}
              onPageChange={setDisposalPage}
              visible={disposalPaginated.totalItems > PAGE_SIZE}
            />
          </div>
          <div style={accountingCard}>
            <p style={{ margin: "0 0 12px", fontWeight: 700, color: "#64748b" }}>
              Select an active asset to record disposal (asset remains in register with Disposed status).
            </p>
            <select
              style={fieldStyle}
              value={disposalAssetId || ""}
              onChange={(e) => setDisposalAssetId(e.target.value || null)}
            >
              <option value="">Select asset…</option>
              {assets
                .filter((a) => a.status !== "Disposed")
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.assetNumber || a.id})
                  </option>
                ))}
            </select>
            <button
              type="button"
              style={{ ...outlineBtn, marginTop: 12 }}
              disabled={!disposalAssetId}
              onClick={() => disposalAssetId && openDisposalModal(disposalAssetId)}
            >
              Mark as disposed
            </button>
          </div>
        </div>
      )}

      {assetModalOpen && (
        <div style={modalOverlay} onClick={() => setAssetModalOpen(false)}>
          <div style={modalPanel} onClick={(e) => e.stopPropagation()}>
            <div style={modalHeader}>{editingAssetId ? "Edit Asset" : "Add Asset"}</div>
            <div style={{ display: "grid", gap: 12 }}>
              <label>
                Asset Name *
                <input
                  style={fieldStyle}
                  value={assetForm.name}
                  onChange={(e) => setAssetForm((f) => ({ ...f, name: e.target.value }))}
                />
              </label>
              <label>
                Category
                <select
                  style={fieldStyle}
                  value={assetForm.category}
                  onChange={(e) => setAssetForm((f) => ({ ...f, category: e.target.value }))}
                >
                  {categoryOptions.map((o) => (
                    <option key={o.name} value={o.name}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label>
                  Asset Number
                  <input
                    style={fieldStyle}
                    value={assetForm.assetNumber}
                    onChange={(e) => setAssetForm((f) => ({ ...f, assetNumber: e.target.value }))}
                  />
                </label>
                <label>
                  Serial Number
                  <input
                    style={fieldStyle}
                    value={assetForm.serialNumber}
                    onChange={(e) => setAssetForm((f) => ({ ...f, serialNumber: e.target.value }))}
                  />
                </label>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label>
                  Purchase Date
                  <input
                    type="date"
                    style={fieldStyle}
                    value={assetForm.purchaseDate}
                    onChange={(e) => setAssetForm((f) => ({ ...f, purchaseDate: e.target.value }))}
                  />
                </label>
                <label>
                  Purchase Cost (R)
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    style={fieldStyle}
                    value={assetForm.purchaseCost || ""}
                    onChange={(e) => setAssetForm((f) => ({ ...f, purchaseCost: Number(e.target.value) || 0 }))}
                  />
                </label>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label>
                  Depreciation Method
                  <select
                    style={fieldStyle}
                    value={assetForm.depreciationMethod}
                    onChange={(e) =>
                      setAssetForm((f) => ({
                        ...f,
                        depreciationMethod: e.target.value as DepreciationMethod,
                      }))
                    }
                  >
                    <option value="Straight Line">Straight Line</option>
                    <option value="None">None</option>
                  </select>
                </label>
                <label>
                  Useful Life (Years)
                  <input
                    type="number"
                    min={0}
                    style={fieldStyle}
                    value={assetForm.usefulLifeYears || ""}
                    onChange={(e) => setAssetForm((f) => ({ ...f, usefulLifeYears: Number(e.target.value) || 0 }))}
                  />
                </label>
              </div>
              <label>
                Current Book Value (R)
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  style={fieldStyle}
                  value={assetForm.currentBookValue || ""}
                  onChange={(e) => setAssetForm((f) => ({ ...f, currentBookValue: Number(e.target.value) || 0 }))}
                />
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label>
                  Location
                  <input
                    style={fieldStyle}
                    value={assetForm.location}
                    onChange={(e) => setAssetForm((f) => ({ ...f, location: e.target.value }))}
                  />
                </label>
                <label>
                  Assigned To
                  <input
                    style={fieldStyle}
                    value={assetForm.assignedTo}
                    onChange={(e) => setAssetForm((f) => ({ ...f, assignedTo: e.target.value }))}
                  />
                </label>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label>
                  Supplier
                  <input
                    style={fieldStyle}
                    value={assetForm.supplier}
                    onChange={(e) => setAssetForm((f) => ({ ...f, supplier: e.target.value }))}
                  />
                </label>
                <label>
                  Warranty Expiry
                  <input
                    type="date"
                    style={fieldStyle}
                    value={assetForm.warrantyExpiry}
                    onChange={(e) => setAssetForm((f) => ({ ...f, warrantyExpiry: e.target.value }))}
                  />
                </label>
              </div>
              <label>
                Notes
                <textarea
                  style={{ ...fieldStyle, minHeight: 72, resize: "vertical" }}
                  value={assetForm.notes}
                  onChange={(e) => setAssetForm((f) => ({ ...f, notes: e.target.value }))}
                />
              </label>
              <label>
                Status
                <select
                  style={fieldStyle}
                  value={assetForm.status}
                  onChange={(e) => setAssetForm((f) => ({ ...f, status: e.target.value as AssetStatus }))}
                >
                  <option value="Active">Active</option>
                  <option value="Under Maintenance">Under Maintenance</option>
                  <option value="Disposed">Disposed</option>
                </select>
              </label>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "flex-end" }}>
              <button type="button" style={ghostBtn} onClick={() => setAssetModalOpen(false)}>
                Cancel
              </button>
              <button type="button" style={goldBtn} onClick={saveAsset}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {categoryModalOpen && (
        <div style={modalOverlay} onClick={() => setCategoryModalOpen(false)}>
          <div style={modalPanel} onClick={(e) => e.stopPropagation()}>
            <div style={modalHeader}>Add Category</div>
            <label>
              Category name *
              <input
                style={fieldStyle}
                value={categoryForm.name}
                onChange={(e) => setCategoryForm((f) => ({ ...f, name: e.target.value }))}
              />
            </label>
            {categoryError ? (
              <p style={{ color: "#b91c1c", fontWeight: 700, marginTop: 8 }}>{categoryError}</p>
            ) : null}
            <label>
              Notes
              <textarea
                style={{ ...fieldStyle, minHeight: 64 }}
                value={categoryForm.notes}
                onChange={(e) => setCategoryForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </label>
            <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "flex-end" }}>
              <button type="button" style={ghostBtn} onClick={() => setCategoryModalOpen(false)}>
                Cancel
              </button>
              <button type="button" style={goldBtn} onClick={saveCategory}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {maintenanceModalOpen && (
        <div style={modalOverlay} onClick={() => setMaintenanceModalOpen(false)}>
          <div style={{ ...modalPanel, width: "min(520px, 100%)" }} onClick={(e) => e.stopPropagation()}>
            <div style={modalHeader}>Add Maintenance</div>
            <div style={{ display: "grid", gap: 12 }}>
              <label>
                Asset *
                <select
                  style={fieldStyle}
                  value={maintenanceForm.assetId}
                  onChange={(e) => setMaintenanceForm((f) => ({ ...f, assetId: e.target.value }))}
                >
                  <option value="">Select asset…</option>
                  {assets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Date
                <input
                  type="date"
                  style={fieldStyle}
                  value={maintenanceForm.date}
                  onChange={(e) => setMaintenanceForm((f) => ({ ...f, date: e.target.value }))}
                />
              </label>
              <label>
                Description *
                <textarea
                  style={{ ...fieldStyle, minHeight: 64 }}
                  value={maintenanceForm.description}
                  onChange={(e) => setMaintenanceForm((f) => ({ ...f, description: e.target.value }))}
                />
              </label>
              <label>
                Cost (R)
                <input
                  type="number"
                  min={0}
                  style={fieldStyle}
                  value={maintenanceForm.cost || ""}
                  onChange={(e) => setMaintenanceForm((f) => ({ ...f, cost: Number(e.target.value) || 0 }))}
                />
              </label>
              <label>
                Supplier
                <input
                  style={fieldStyle}
                  value={maintenanceForm.supplier}
                  onChange={(e) => setMaintenanceForm((f) => ({ ...f, supplier: e.target.value }))}
                />
              </label>
              <label>
                Next Service Date
                <input
                  type="date"
                  style={fieldStyle}
                  value={maintenanceForm.nextServiceDate}
                  onChange={(e) => setMaintenanceForm((f) => ({ ...f, nextServiceDate: e.target.value }))}
                />
              </label>
              <label>
                Status
                <select
                  style={fieldStyle}
                  value={maintenanceForm.status}
                  onChange={(e) =>
                    setMaintenanceForm((f) => ({
                      ...f,
                      status: e.target.value as MaintenanceRecord["status"],
                    }))
                  }
                >
                  <option value="Scheduled">Scheduled</option>
                  <option value="Completed">Completed</option>
                  <option value="Overdue">Overdue</option>
                </select>
              </label>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "flex-end" }}>
              <button type="button" style={ghostBtn} onClick={() => setMaintenanceModalOpen(false)}>
                Cancel
              </button>
              <button type="button" style={goldBtn} onClick={saveMaintenance}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {disposalModalOpen && (
        <div style={modalOverlay} onClick={() => setDisposalModalOpen(false)}>
          <div style={modalPanel} onClick={(e) => e.stopPropagation()}>
            <div style={modalHeader}>Dispose Asset</div>
            <div style={{ display: "grid", gap: 12 }}>
              <label>
                Disposal Date
                <input
                  type="date"
                  style={fieldStyle}
                  value={disposalForm.disposalDate}
                  onChange={(e) => setDisposalForm((f) => ({ ...f, disposalDate: e.target.value }))}
                />
              </label>
              <label>
                Disposal Amount (R)
                <input
                  type="number"
                  min={0}
                  style={fieldStyle}
                  value={disposalForm.disposalAmount || ""}
                  onChange={(e) => setDisposalForm((f) => ({ ...f, disposalAmount: Number(e.target.value) || 0 }))}
                />
              </label>
              <label>
                Reason
                <input
                  style={fieldStyle}
                  value={disposalForm.disposalReason}
                  onChange={(e) => setDisposalForm((f) => ({ ...f, disposalReason: e.target.value }))}
                />
              </label>
              <label>
                Notes
                <textarea
                  style={{ ...fieldStyle, minHeight: 64 }}
                  value={disposalForm.disposalNotes}
                  onChange={(e) => setDisposalForm((f) => ({ ...f, disposalNotes: e.target.value }))}
                />
              </label>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "flex-end" }}>
              <button type="button" style={ghostBtn} onClick={() => setDisposalModalOpen(false)}>
                Cancel
              </button>
              <button type="button" style={goldBtn} onClick={saveDisposal}>
                Confirm disposal
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
