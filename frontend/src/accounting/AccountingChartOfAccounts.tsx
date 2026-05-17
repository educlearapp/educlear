import React, { useCallback, useEffect, useMemo, useState } from "react";
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
  dispatchCoaUpdated,
  ensureRequiredPayrollCoa,
  getPayrollCoaReadiness,
  REQUIRED_PAYROLL_COA,
} from "./accountingPayrollCoa";

export type AccountType = "Assets" | "Liabilities" | "Equity" | "Income" | "Expenses";

export type ChartAccount = {
  id: string;
  code: string;
  name: string;
  group: string;
  type: AccountType;
  description: string;
  linkedModule: string;
  active: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

type CoaStore = {
  accounts: ChartAccount[];
  customGroups: string[];
};

type Props = {
  schoolId?: string;
};

const COA_STORAGE_PREFIX = "educlearAccountingCOA:";
const PAGE_SIZE = 10;

const ACCOUNT_TYPES: AccountType[] = ["Assets", "Liabilities", "Equity", "Income", "Expenses"];

const TYPE_BASE_CODE: Record<AccountType, number> = {
  Assets: 1000,
  Liabilities: 2000,
  Equity: 3000,
  Income: 4000,
  Expenses: 5000,
};

const DEFAULT_GROUPS: Record<AccountType, string[]> = {
  Assets: ["Current Assets", "Fixed Assets"],
  Liabilities: ["Current Liabilities"],
  Equity: ["Equity"],
  Income: ["Operating Income"],
  Expenses: ["Operating Expenses"],
};

const LINKED_MODULES = [
  "Billing",
  "Expenses",
  "Banking",
  "Payroll",
  "Suppliers",
  "Budget",
  "Financial Statements",
  "",
] as const;

type DefaultSeed = {
  code: string;
  name: string;
  group: string;
  type: AccountType;
  linkedModule: string;
  description?: string;
};

export const DEFAULT_SCHOOL_COA: DefaultSeed[] = [
  { code: "1000", name: "Bank Account", group: "Current Assets", type: "Assets", linkedModule: "Banking" },
  { code: "1010", name: "Petty Cash", group: "Current Assets", type: "Assets", linkedModule: "Banking" },
  { code: "1100", name: "Accounts Receivable", group: "Current Assets", type: "Assets", linkedModule: "Billing" },
  { code: "1500", name: "Fixed Assets", group: "Fixed Assets", type: "Assets", linkedModule: "" },
  { code: "2000", name: "Accounts Payable", group: "Current Liabilities", type: "Liabilities", linkedModule: "Suppliers" },
  { code: "2100", name: "Payroll Liabilities", group: "Current Liabilities", type: "Liabilities", linkedModule: "Payroll" },
  { code: "2200", name: "Tax Liabilities", group: "Current Liabilities", type: "Liabilities", linkedModule: "" },
  { code: "3000", name: "Retained Earnings", group: "Equity", type: "Equity", linkedModule: "Financial Statements" },
  { code: "3100", name: "Owner Equity", group: "Equity", type: "Equity", linkedModule: "" },
  { code: "4000", name: "School Fees", group: "Operating Income", type: "Income", linkedModule: "Billing" },
  { code: "4010", name: "Registration Fees", group: "Operating Income", type: "Income", linkedModule: "Billing" },
  { code: "4020", name: "Transport Income", group: "Operating Income", type: "Income", linkedModule: "Billing" },
  { code: "4030", name: "Aftercare Income", group: "Operating Income", type: "Income", linkedModule: "Billing" },
  { code: "4040", name: "Tuckshop Income", group: "Operating Income", type: "Income", linkedModule: "Billing" },
  { code: "4900", name: "Other Income", group: "Operating Income", type: "Income", linkedModule: "Financial Statements" },
  { code: "5000", name: "Salaries Expense", group: "Operating Expenses", type: "Expenses", linkedModule: "Payroll" },
  { code: "5100", name: "Electricity", group: "Operating Expenses", type: "Expenses", linkedModule: "Expenses" },
  { code: "5110", name: "Water", group: "Operating Expenses", type: "Expenses", linkedModule: "Expenses" },
  { code: "5120", name: "Fuel", group: "Operating Expenses", type: "Expenses", linkedModule: "Expenses" },
  { code: "5200", name: "Repairs & Maintenance", group: "Operating Expenses", type: "Expenses", linkedModule: "Expenses" },
  { code: "5300", name: "Stationery", group: "Operating Expenses", type: "Expenses", linkedModule: "Expenses" },
  { code: "5400", name: "Food / Tuckshop", group: "Operating Expenses", type: "Expenses", linkedModule: "Expenses" },
  { code: "5500", name: "Insurance", group: "Operating Expenses", type: "Expenses", linkedModule: "Expenses" },
  { code: "5600", name: "Marketing", group: "Operating Expenses", type: "Expenses", linkedModule: "Budget" },
  { code: "5700", name: "Bank Charges", group: "Operating Expenses", type: "Expenses", linkedModule: "Banking" },
  { code: "5800", name: "SARS / UIF", group: "Operating Expenses", type: "Expenses", linkedModule: "Payroll" },
  { code: "5900", name: "Other Expenses", group: "Operating Expenses", type: "Expenses", linkedModule: "Expenses" },
];

function storageKey(schoolId: string) {
  return `${COA_STORAGE_PREFIX}${schoolId}`;
}

function emptyStore(): CoaStore {
  return { accounts: [], customGroups: [] };
}

function loadStore(schoolId: string): CoaStore {
  if (!schoolId) return emptyStore();
  try {
    const raw = localStorage.getItem(storageKey(schoolId));
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return { accounts: parsed as ChartAccount[], customGroups: [] };
    }
    return {
      accounts: Array.isArray(parsed?.accounts) ? parsed.accounts : [],
      customGroups: Array.isArray(parsed?.customGroups) ? parsed.customGroups : [],
    };
  } catch {
    return emptyStore();
  }
}

function saveStore(schoolId: string, store: CoaStore) {
  if (!schoolId) return;
  localStorage.setItem(storageKey(schoolId), JSON.stringify(store));
  dispatchCoaUpdated(schoolId);
}

function seedToAccount(seed: DefaultSeed, now: string): ChartAccount {
  return {
    id: `coa-${seed.code}-${seed.name.replace(/\s+/g, "-").toLowerCase()}`,
    code: seed.code,
    name: seed.name,
    group: seed.group,
    type: seed.type,
    description: seed.description || `Default ${seed.type} account for ${seed.name}.`,
    linkedModule: seed.linkedModule,
    active: true,
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  };
}

function accountExists(accounts: ChartAccount[], seed: DefaultSeed) {
  const code = seed.code.trim();
  const name = seed.name.trim().toLowerCase();
  return accounts.some(
    (a) => a.code === code || (a.name.trim().toLowerCase() === name && a.type === seed.type)
  );
}

export function importDefaultCoa(accounts: ChartAccount[]): ChartAccount[] {
  const now = new Date().toISOString();
  let next = [...accounts];
  for (const seed of DEFAULT_SCHOOL_COA) {
    if (!accountExists(next, seed)) {
      next.push(seedToAccount(seed, now));
    }
  }
  return ensureRequiredPayrollCoa(next).accounts;
}

/** Repair missing payroll GL accounts for a school (additive, no duplicates). */
export function repairPayrollCoaForSchool(schoolId: string): { added: string[]; accounts: ChartAccount[] } {
  if (!schoolId) return { added: [], accounts: [] };
  const store = loadStore(schoolId);
  const { accounts, added } = ensureRequiredPayrollCoa(store.accounts);
  if (added.length) {
    saveStore(schoolId, { ...store, accounts });
  }
  return { added, accounts };
}

function nextAccountCode(type: AccountType, accounts: ChartAccount[]): string {
  const base = TYPE_BASE_CODE[type];
  const ceiling = base + 999;
  let max = base - 1;
  for (const a of accounts) {
    if (a.type !== type) continue;
    const n = parseInt(String(a.code).replace(/\D/g, ""), 10);
    if (!Number.isNaN(n) && n >= base && n <= ceiling && n > max) max = n;
  }
  const next = max < base ? base : max + 10;
  if (next > ceiling) return String(ceiling);
  return String(next);
}

function isBankAccount(account: ChartAccount) {
  const n = account.name.toLowerCase();
  return n.includes("bank") && account.type === "Assets";
}

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
  fontSize: 14,
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
  boxShadow: "0 24px 60px rgba(0,0,0,0.25)",
};

const thStyle: React.CSSProperties = {
  padding: "12px 14px",
  textAlign: "left",
  fontSize: 11,
  fontWeight: 900,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  color: "#64748b",
  borderBottom: `2px solid ${ACCOUNTING_GOLD}`,
};

const tdStyle: React.CSSProperties = {
  padding: "12px 14px",
  borderBottom: "1px solid #f1f5f9",
  fontSize: 14,
  fontWeight: 600,
  color: ACCOUNTING_INK,
};

type AccountForm = {
  name: string;
  code: string;
  group: string;
  type: AccountType;
  description: string;
  linkedModule: string;
  active: boolean;
};

const emptyForm = (type: AccountType = "Expenses"): AccountForm => ({
  name: "",
  code: "",
  group: DEFAULT_GROUPS[type][0] || type,
  type,
  description: "",
  linkedModule: "",
  active: true,
});

export default function AccountingChartOfAccounts({ schoolId = "" }: Props) {
  const [store, setStore] = useState<CoaStore>(() => loadStore(schoolId));
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("All");
  const [statusView, setStatusView] = useState<"active" | "inactive" | "all">("active");
  const [page, setPage] = useState(1);
  const [groupedView, setGroupedView] = useState(true);
  const [expandedTypes, setExpandedTypes] = useState<Record<AccountType, boolean>>({
    Assets: true,
    Liabilities: true,
    Equity: true,
    Income: true,
    Expenses: true,
  });
  const [accountModal, setAccountModal] = useState<"add" | "edit" | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<AccountForm>(emptyForm());
  const [groupModal, setGroupModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [toast, setToast] = useState("");

  const persist = useCallback(
    (next: CoaStore) => {
      setStore(next);
      saveStore(schoolId, next);
    },
    [schoolId]
  );

  useEffect(() => {
    if (!schoolId) {
      setStore(emptyStore());
      setPage(1);
      return;
    }
    const loaded = loadStore(schoolId);
    const { accounts, added } = ensureRequiredPayrollCoa(loaded.accounts);
    if (added.length) {
      const next = { ...loaded, accounts };
      saveStore(schoolId, next);
      setStore(next);
    } else {
      setStore(loaded);
    }
    setPage(1);
  }, [schoolId]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(t);
  }, [toast]);

  const accounts = store.accounts;

  const allGroups = useMemo(() => {
    const fromAccounts = new Set(accounts.map((a) => a.group).filter(Boolean));
    const defaults = ACCOUNT_TYPES.flatMap((t) => DEFAULT_GROUPS[t]);
    const custom = store.customGroups || [];
    return Array.from(new Set([...defaults, ...custom, ...fromAccounts])).sort();
  }, [accounts, store.customGroups]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return accounts
      .filter((a) => {
        if (statusView === "active" && !a.active) return false;
        if (statusView === "inactive" && a.active) return false;
        if (typeFilter !== "All" && a.type !== typeFilter) return false;
        if (!q) return true;
        return (
          a.code.toLowerCase().includes(q) ||
          a.name.toLowerCase().includes(q) ||
          a.group.toLowerCase().includes(q) ||
          a.type.toLowerCase().includes(q) ||
          (a.linkedModule || "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const typeOrder = ACCOUNT_TYPES.indexOf(a.type) - ACCOUNT_TYPES.indexOf(b.type);
        if (typeOrder !== 0) return typeOrder;
        return a.code.localeCompare(b.code, undefined, { numeric: true });
      });
  }, [accounts, search, typeFilter, statusView]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const summary = useMemo(() => {
    const active = accounts.filter((a) => a.active);
    return {
      total: accounts.length,
      active: active.length,
      income: accounts.filter((a) => a.type === "Income").length,
      expense: accounts.filter((a) => a.type === "Expenses").length,
      bank: accounts.filter(isBankAccount).length,
      custom: accounts.filter((a) => !a.isDefault).length,
    };
  }, [accounts]);

  const payrollCoaStatus = useMemo(() => getPayrollCoaReadiness(accounts), [accounts]);

  const openAddAccount = () => {
    const type: AccountType = typeFilter !== "All" ? (typeFilter as AccountType) : "Expenses";
    const code = nextAccountCode(type, accounts);
    setForm({ ...emptyForm(type), code });
    setEditingId(null);
    setAccountModal("add");
  };

  const openEditAccount = (account: ChartAccount) => {
    setForm({
      name: account.name,
      code: account.code,
      group: account.group,
      type: account.type,
      description: account.description,
      linkedModule: account.linkedModule,
      active: account.active,
    });
    setEditingId(account.id);
    setAccountModal("edit");
  };

  const handleSaveAccount = () => {
    const name = form.name.trim();
    const code = form.code.trim();
    const group = form.group.trim();
    if (!name || !code || !group) {
      setToast("Account name, code, and group are required.");
      return;
    }
    const duplicateCode = accounts.some((a) => a.code === code && a.id !== editingId);
    if (duplicateCode) {
      setToast("Account code already exists.");
      return;
    }
    const now = new Date().toISOString();
    if (accountModal === "edit" && editingId) {
      persist({
        ...store,
        accounts: accounts.map((a) =>
          a.id === editingId
            ? {
                ...a,
                name,
                code,
                group,
                type: form.type,
                description: form.description.trim(),
                linkedModule: form.linkedModule,
                active: form.active,
                updatedAt: now,
              }
            : a
        ),
      });
      setToast("Account updated.");
    } else {
      const account: ChartAccount = {
        id: `coa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        code,
        name,
        group,
        type: form.type,
        description: form.description.trim(),
        linkedModule: form.linkedModule,
        active: form.active,
        isDefault: false,
        createdAt: now,
        updatedAt: now,
      };
      persist({ ...store, accounts: [...accounts, account] });
      setToast("Account added.");
    }
    setAccountModal(null);
    setEditingId(null);
  };

  const handleDeleteAccount = (id: string) => {
    const target = accounts.find((a) => a.id === id);
    if (!target) return;
    if (target.isDefault) {
      if (!window.confirm(`Deactivate default account "${target.name}" instead of deleting?`)) return;
      persist({
        ...store,
        accounts: accounts.map((a) => (a.id === id ? { ...a, active: false, updatedAt: new Date().toISOString() } : a)),
      });
      setToast("Default account deactivated.");
      return;
    }
    if (!window.confirm(`Remove account "${target.name}"?`)) return;
    persist({ ...store, accounts: accounts.filter((a) => a.id !== id) });
    setToast("Account removed.");
  };

  const handleImportDefault = () => {
    const before = accounts.length;
    const afterDefaults = importDefaultCoa(accounts);
    const payrollRepair = ensureRequiredPayrollCoa(afterDefaults);
    const merged = payrollRepair.accounts;
    const added = merged.length - before;
    persist({ ...store, accounts: merged });
    if (added === 0 && payrollRepair.added.length === 0) {
      setToast("Default school COA is up to date — all accounts present, including payroll.");
    } else if (payrollRepair.added.length > 0) {
      setToast(
        `Imported ${added} account(s). Repaired payroll: ${payrollRepair.added.join("; ")}.`
      );
    } else {
      setToast(`Imported ${added} default account(s).`);
    }
  };

  const handleAddGroup = () => {
    const name = newGroupName.trim();
    if (!name) {
      setToast("Enter a group name.");
      return;
    }
    if (allGroups.some((g) => g.toLowerCase() === name.toLowerCase())) {
      setToast("Group already exists.");
      return;
    }
    persist({ ...store, customGroups: [...(store.customGroups || []), name] });
    setNewGroupName("");
    setGroupModal(false);
    setToast(`Group "${name}" added.`);
  };

  const autoCodeForType = (type: AccountType) => {
    setForm((f) => ({ ...f, type, code: nextAccountCode(type, accounts), group: f.group || DEFAULT_GROUPS[type][0] }));
  };

  const toggleTypeSection = (type: AccountType) => {
    setExpandedTypes((prev) => ({ ...prev, [type]: !prev[type] }));
  };

  const renderAccountTable = (rows: ChartAccount[], showActions = true) => (
    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
      <thead>
        <tr style={{ background: "rgba(212,175,55,0.12)" }}>
          {["Account Code", "Account Name", "Group", "Type", "Status", "Linked Modules", ...(showActions ? ["Actions"] : [])].map(
            (h) => (
              <th key={h} style={thStyle}>
                {h}
              </th>
            )
          )}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={showActions ? 7 : 6} style={{ ...tdStyle, textAlign: "center", color: "#64748b" }}>
              No accounts in this section.
            </td>
          </tr>
        ) : (
          rows.map((row) => (
            <tr key={row.id}>
              <td style={{ ...tdStyle, fontWeight: 900, fontFamily: "ui-monospace, monospace" }}>{row.code}</td>
              <td style={{ ...tdStyle, fontWeight: 800 }}>{row.name}</td>
              <td style={tdStyle}>{row.group}</td>
              <td style={tdStyle}>{row.type}</td>
              <td style={tdStyle}>
                <span
                  style={{
                    padding: "4px 10px",
                    borderRadius: 999,
                    fontSize: 12,
                    fontWeight: 800,
                    background: row.active ? "rgba(34,197,94,0.12)" : "rgba(148,163,184,0.2)",
                    color: row.active ? "#15803d" : "#64748b",
                  }}
                >
                  {row.active ? "Active" : "Inactive"}
                </span>
              </td>
              <td style={tdStyle}>{row.linkedModule || "—"}</td>
              {showActions ? (
                <td style={tdStyle}>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button type="button" style={ghostBtn} onClick={() => openEditAccount(row)}>
                      Edit
                    </button>
                    <button type="button" style={{ ...ghostBtn, color: "#b91c1c" }} onClick={() => handleDeleteAccount(row.id)}>
                      {row.isDefault ? "Deactivate" : "Remove"}
                    </button>
                  </div>
                </td>
              ) : null}
            </tr>
          ))
        )}
      </tbody>
    </table>
  );

  return (
    <div style={accountingPageWrap}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 16, marginBottom: 24 }}>
        <div>
          <h1 style={accountingTitle}>Chart of Accounts</h1>
          <p style={accountingSubtitle}>Manage accounting account structures used across EduClear Accounting.</p>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-start" }}>
          <button type="button" style={goldBtn} onClick={openAddAccount}>
            Add Account
          </button>
          <button type="button" style={outlineBtn} onClick={() => setGroupModal(true)}>
            Add Account Group
          </button>
          <button type="button" style={outlineBtn} onClick={handleImportDefault}>
            Import Default School COA
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
          marginBottom: 20,
          padding: "14px 18px",
          borderRadius: 12,
          border: `2px solid ${payrollCoaStatus.ready ? "#22c55e" : "#ef4444"}`,
          background: payrollCoaStatus.ready ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.08)",
        }}
      >
        <div style={{ fontWeight: 900, fontSize: 15, color: payrollCoaStatus.ready ? "#15803d" : "#b91c1c" }}>
          Payroll posting {payrollCoaStatus.ready ? "ready" : "blocked — missing accounts"}
        </div>
        <div style={{ marginTop: 8, fontWeight: 600, fontSize: 13, color: ACCOUNTING_INK, lineHeight: 1.55 }}>
          {payrollCoaStatus.ready ? (
            <>
              All required payroll accounts are present:{" "}
              {REQUIRED_PAYROLL_COA.map((s) => `${s.code} ${s.name}`).join(" · ")}.
            </>
          ) : (
            <>
              Missing: {payrollCoaStatus.missing.join(", ")}. Use <strong>Import Default School COA</strong> to
              add defaults and repair payroll accounts without duplicating existing codes or names.
            </>
          )}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
          gap: 14,
          marginBottom: 24,
        }}
      >
        {[
          { label: "Total Accounts", value: summary.total },
          { label: "Active Accounts", value: summary.active },
          { label: "Income Accounts", value: summary.income },
          { label: "Expense Accounts", value: summary.expense },
          { label: "Bank Accounts", value: summary.bank },
          { label: "Custom Accounts", value: summary.custom },
        ].map((card) => (
          <div key={card.label} style={accountingCard}>
            <div style={accountingCardLabel}>{card.label}</div>
            <div style={accountingCardValue}>{card.value}</div>
          </div>
        ))}
      </div>

      <div
        style={{
          ...accountingCard,
          marginBottom: 20,
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          alignItems: "center",
        }}
      >
        <input
          style={{ ...fieldStyle, flex: "1 1 220px", maxWidth: 360 }}
          placeholder="Search code, name, group, module…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <select
          style={{ ...fieldStyle, flex: "0 1 180px" }}
          value={typeFilter}
          onChange={(e) => {
            setTypeFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="All">All</option>
          {ACCOUNT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          style={{ ...fieldStyle, flex: "0 1 160px" }}
          value={statusView}
          onChange={(e) => {
            setStatusView(e.target.value as "active" | "inactive" | "all");
            setPage(1);
          }}
        >
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">Active &amp; Inactive</option>
        </select>
        <button
          type="button"
          style={ghostBtn}
          onClick={() => setGroupedView((v) => !v)}
        >
          {groupedView ? "List view" : "Grouped view"}
        </button>
      </div>

      {groupedView ? (
        <div style={{ display: "grid", gap: 14, marginBottom: 24 }}>
          {ACCOUNT_TYPES.map((type) => {
            const sectionRows = filtered.filter((a) => a.type === type);
            if (typeFilter !== "All" && typeFilter !== type) return null;
            return (
              <div key={type} style={accountingCard}>
                <button
                  type="button"
                  onClick={() => toggleTypeSection(type)}
                  style={{
                    width: "100%",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    padding: 0,
                    marginBottom: expandedTypes[type] ? 16 : 0,
                  }}
                >
                  <span style={{ fontSize: 18, fontWeight: 900, color: ACCOUNTING_INK }}>{type}</span>
                  <span style={{ fontWeight: 800, color: ACCOUNTING_GOLD }}>
                    {sectionRows.length} account(s) {expandedTypes[type] ? "▾" : "▸"}
                  </span>
                </button>
                {expandedTypes[type] ? renderAccountTable(sectionRows) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      <div style={accountingCard}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: ACCOUNTING_INK }}>
            {groupedView ? "All accounts (paginated)" : "Accounts"}
          </h2>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#64748b" }}>
            {filtered.length} result(s)
          </span>
        </div>
        {renderAccountTable(pageRows)}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: 16,
            marginTop: 20,
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            style={ghostBtn}
            disabled={safePage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </button>
          <span style={{ fontWeight: 800, fontSize: 14 }}>
            Page {safePage} of {totalPages}
          </span>
          <button
            type="button"
            style={ghostBtn}
            disabled={safePage >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Next
          </button>
        </div>
      </div>

      <div style={{ ...accountingCard, marginTop: 20 }}>
        <p style={{ margin: 0, fontWeight: 700, color: ACCOUNTING_INK, lineHeight: 1.6 }}>
          Chart of Accounts forms the foundation for all accounting postings and reports.
        </p>
        <p style={{ margin: "12px 0 0", color: "#64748b", fontWeight: 600, fontSize: 14, lineHeight: 1.6 }}>
          Automatic account posting integration will be connected across Banking, Expenses, Payroll, Billing, and
          Financial Statements.
        </p>
      </div>

      {accountModal ? (
        <div style={overlay} onClick={() => setAccountModal(null)}>
          <div style={modalPanel} onClick={(e) => e.stopPropagation()}>
            <div style={{ padding: "20px 24px", borderBottom: `1px solid ${ACCOUNTING_GOLD}`, background: ACCOUNTING_INK, color: ACCOUNTING_GOLD }}>
              <div style={{ fontWeight: 900, fontSize: 18 }}>{accountModal === "add" ? "Add Account" : "Edit Account"}</div>
            </div>
            <div style={{ padding: 24, display: "grid", gap: 14 }}>
              <label>
                Account Name
                <input style={fieldStyle} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              </label>
              <label>
                Account Code
                <div style={{ display: "flex", gap: 8 }}>
                  <input style={fieldStyle} value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} />
                  {accountModal === "add" ? (
                    <button type="button" style={ghostBtn} onClick={() => setForm((f) => ({ ...f, code: nextAccountCode(f.type, accounts) }))}>
                      Auto
                    </button>
                  ) : null}
                </div>
              </label>
              <label>
                Type
                <select
                  style={fieldStyle}
                  value={form.type}
                  onChange={(e) => autoCodeForType(e.target.value as AccountType)}
                  disabled={accountModal === "edit"}
                >
                  {ACCOUNT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Group
                <select style={fieldStyle} value={form.group} onChange={(e) => setForm((f) => ({ ...f, group: e.target.value }))}>
                  {allGroups.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Description
                <textarea
                  style={{ ...fieldStyle, minHeight: 72, resize: "vertical" }}
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                />
              </label>
              <label>
                Linked Module
                <select
                  style={fieldStyle}
                  value={form.linkedModule}
                  onChange={(e) => setForm((f) => ({ ...f, linkedModule: e.target.value }))}
                >
                  <option value="">— None —</option>
                  {LINKED_MODULES.filter(Boolean).map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 700 }}>
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
                />
                Active account
              </label>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button type="button" style={ghostBtn} onClick={() => setAccountModal(null)}>
                  Cancel
                </button>
                <button type="button" style={goldBtn} onClick={handleSaveAccount}>
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {groupModal ? (
        <div style={overlay} onClick={() => setGroupModal(false)}>
          <div style={modalPanel} onClick={(e) => e.stopPropagation()}>
            <div style={{ padding: "20px 24px", borderBottom: `1px solid ${ACCOUNTING_GOLD}`, background: ACCOUNTING_INK, color: ACCOUNTING_GOLD }}>
              <div style={{ fontWeight: 900, fontSize: 18 }}>Add Account Group</div>
            </div>
            <div style={{ padding: 24, display: "grid", gap: 14 }}>
              <label>
                Group name
                <input
                  style={fieldStyle}
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="e.g. Capital Expenditure"
                />
              </label>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button type="button" style={ghostBtn} onClick={() => setGroupModal(false)}>
                  Cancel
                </button>
                <button type="button" style={goldBtn} onClick={handleAddGroup}>
                  Add group
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
