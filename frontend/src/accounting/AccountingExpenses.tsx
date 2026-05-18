import React, { useEffect, useMemo, useState } from "react";
import { postExpenseApprovalJournal } from "./accountingJournalEngine";
import {
  acceptExpenseCandidate,
  addManualApprovedExpense,
  ignoreExpenseCandidate,
  loadApprovedExpenses,
  loadExpenseCandidates,
  loadLegacyRecurringRules,
  migrateLegacyExpenseStores,
  reviewQueueFromCandidates,
  saveApprovedExpenses,
  updateExpenseCandidate,
  type AccountingExpenseCandidate,
  LEGACY_EXPENSES_STORAGE_PREFIX,
} from "./accountingExpenseStorage";
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

export const DEFAULT_EXPENSE_CATEGORIES = [
  "Electricity",
  "Water",
  "Rent / Bond",
  "Salaries",
  "Fuel",
  "Repairs & Maintenance",
  "Stationery",
  "Food / Tuckshop",
  "Insurance",
  "Marketing",
  "Bank Charges",
  "SARS / UIF",
  "Other",
] as const;

/** Default list — also used by BankStatementImport. */
export const EXPENSE_CATEGORIES = DEFAULT_EXPENSE_CATEGORIES;

export type ExpenseCategory = string;

type CustomExpenseCategory = {
  id: string;
  name: string;
  type: "Expense" | "Income";
  notes?: string;
  createdAt: string;
};

type CategoryOption = { name: string; isCustom: boolean };

const CUSTOM_CATEGORIES_STORAGE_PREFIX = "educlearAccountingExpenseCategories:";

type TabId = "review" | "approved" | "recurring" | "manual";

type ReviewCandidate = {
  id: string;
  date: string;
  supplier: string;
  description: string;
  amount: number;
  suggestedCategory: ExpenseCategory;
  confidence: "high" | "medium" | "low";
  status: "Pending" | "Category updated";
  source: "bank" | "sample";
  bankImportId?: string;
  bankTransactionId?: string;
  reference?: string;
  fingerprint?: string;
};

type ApprovedExpense = {
  id: string;
  date: string;
  supplier: string;
  category: ExpenseCategory;
  description: string;
  amount: number;
  source: "Bank Import" | "Manual" | "Sample";
  approvedBy: string;
  reference?: string;
  notes?: string;
  approvedAt: string;
};

/** Category-first expense labels — shared across tables, cards, and modals. */
export type ExpenseDisplayFields = {
  category: string;
  supplier: string;
  description?: string;
};

export function formatExpenseSecondaryLine(supplier: string, description?: string) {
  const s = String(supplier || "").trim();
  const d = String(description || "").trim();
  if (s && d) return `${s} — ${d}`;
  return s || d || "—";
}

export function ExpenseCategoryPrimary({
  category,
  supplier,
  description,
  compact = false,
}: ExpenseDisplayFields & { compact?: boolean }) {
  return (
    <div>
      <div style={{ fontWeight: 800, fontSize: compact ? 13 : 14, color: ACCOUNTING_INK }}>{category || "Other"}</div>
      <div style={{ fontSize: 12, color: "#64748b", marginTop: 2, lineHeight: 1.35 }}>
        {formatExpenseSecondaryLine(supplier, description)}
      </div>
    </div>
  );
}

type RecurringRule = {
  id: string;
  supplierContains: string;
  category: ExpenseCategory;
  autoApprove: boolean;
  active: boolean;
};

type Props = {
  schoolId?: string;
  approvedBy?: string;
};

const EXPENSE_CANDIDATES_UPDATED = "educlear-expense-candidates-updated";
const PAGE_SIZE = 10;

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
  width: "min(480px, 100%)",
  maxHeight: "90vh",
  overflow: "auto",
  boxShadow: "0 24px 60px rgba(0,0,0,0.25)",
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

function customCategoriesStorageKey(schoolId: string) {
  return CUSTOM_CATEGORIES_STORAGE_PREFIX + schoolId;
}

function loadCustomCategories(schoolId: string): CustomExpenseCategory[] {
  try {
    const raw = localStorage.getItem(customCategoriesStorageKey(schoolId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row: Record<string, unknown>) => ({
        id: String(row?.id || uid("cat")),
        name: String(row?.name || "").trim(),
        type: row?.type === "Income" ? ("Income" as const) : ("Expense" as const),
        notes: String(row?.notes || "").trim() || undefined,
        createdAt: String(row?.createdAt || new Date().toISOString()),
      }))
      .filter((row) => row.name);
  } catch {
    return [];
  }
}

function saveCustomCategories(schoolId: string, rows: CustomExpenseCategory[]) {
  try {
    localStorage.setItem(customCategoriesStorageKey(schoolId), JSON.stringify(rows));
  } catch {
    /* ignore quota errors */
  }
}

function normalizeCategoryKey(name: string) {
  return String(name || "").trim().toLowerCase();
}

function categoryNameExists(name: string, customCategories: CustomExpenseCategory[]) {
  const key = normalizeCategoryKey(name);
  if (!key) return true;
  if (DEFAULT_EXPENSE_CATEGORIES.some((d) => normalizeCategoryKey(d) === key)) return true;
  return customCategories.some((c) => normalizeCategoryKey(c.name) === key);
}

function buildCategoryOptions(
  customCategories: CustomExpenseCategory[],
  extraNames: Iterable<string> = []
): CategoryOption[] {
  const customByKey = new Map(customCategories.map((c) => [normalizeCategoryKey(c.name), c]));
  const options: CategoryOption[] = DEFAULT_EXPENSE_CATEGORIES.map((name) => ({
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

function CategorySelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: CategoryOption[];
}) {
  return (
    <select style={fieldStyle} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((opt) => (
        <option key={opt.name} value={opt.name}>
          {opt.isCustom ? `${opt.name} · Custom` : opt.name}
        </option>
      ))}
    </select>
  );
}

function CustomCategoryBadge() {
  return <span style={customBadgeStyle}>Custom</span>;
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

const paginationWrap: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 12,
  padding: "14px 16px",
  borderTop: `1px solid ${ACCOUNTING_GOLD}`,
  background: "#faf8f0",
};

const paginationBtn = (disabled: boolean): React.CSSProperties => ({
  ...ghostBtn,
  opacity: disabled ? 0.45 : 1,
  cursor: disabled ? "not-allowed" : "pointer",
});

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
      <button
        type="button"
        style={paginationBtn(onFirst)}
        disabled={onFirst}
        onClick={() => onPageChange(page - 1)}
      >
        Previous
      </button>
      <span style={{ fontWeight: 800, fontSize: 13, color: ACCOUNTING_INK, minWidth: 100, textAlign: "center" }}>
        Page {page} of {totalPages}
      </span>
      <button
        type="button"
        style={paginationBtn(onLast)}
        disabled={onLast}
        onClick={() => onPageChange(page + 1)}
      >
        Next
      </button>
    </div>
  );
}

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

const goldBtn: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 8,
  border: "1px solid #b89329",
  background: "linear-gradient(135deg, #f7d56a, #d4af37)",
  color: ACCOUNTING_INK,
  fontWeight: 800,
  fontSize: 12,
  cursor: "pointer",
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
  borderRadius: 8,
  border: "1px solid #cbd5e1",
  fontWeight: 600,
  fontSize: 14,
};

const tabBtn = (active: boolean): React.CSSProperties => ({
  padding: "10px 16px",
  borderRadius: 10,
  border: active ? `2px solid ${ACCOUNTING_GOLD}` : "1px solid #e2e8f0",
  background: active ? ACCOUNTING_INK : "#fff",
  color: active ? ACCOUNTING_GOLD : ACCOUNTING_INK,
  fontWeight: 800,
  fontSize: 13,
  cursor: "pointer",
});

function formatMoney(value: number) {
  const n = Number.isFinite(value) ? value : 0;
  return `R ${n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function currentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function isInCurrentMonth(dateIso: string) {
  const key = currentMonthKey();
  return String(dateIso || "").slice(0, 7) === key;
}

function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function defaultRecurringRules(): RecurringRule[] {



  return [];



}

function candidateToReviewRow(c: AccountingExpenseCandidate): ReviewCandidate {
  return {
    id: c.id,
    date: c.date,
    supplier: c.supplier,
    description: c.description,
    amount: c.amount,
    suggestedCategory: c.category,
    confidence: c.confidence,
    status: c.status === "Category updated" ? "Category updated" : "Pending",
    source: "bank",
    bankImportId: c.importId,
    bankTransactionId: c.transactionId,
    reference: c.reference,
    fingerprint: c.fingerprint,
  };
}

function reloadBankReviewQueue(schoolId: string, sampleRows: ReviewCandidate[]) {
  const bankRows = reviewQueueFromCandidates(loadExpenseCandidates(schoolId)).map(candidateToReviewRow);
  return [...bankRows, ...sampleRows.filter((r) => r.source === "sample")];
}

function saveRecurringRules(schoolId: string, rules: RecurringRule[]) {
  try {
    localStorage.setItem(
      LEGACY_EXPENSES_STORAGE_PREFIX + schoolId,
      JSON.stringify({ recurringRules: rules })
    );
  } catch {
    /* ignore */
  }
}

function suggestCategoryFromRules(
  supplier: string,
  description: string,
  rules: RecurringRule[]
): ExpenseCategory | null {
  const hay = `${supplier} ${description}`.toUpperCase();
  for (const rule of rules.filter((r) => r.active)) {
    const needle = rule.supplierContains.trim().toUpperCase();
    if (needle && hay.includes(needle)) return rule.category;
  }
  return null;
}

export default function AccountingExpenses({ schoolId = "default", approvedBy = "Finance User" }: Props) {
  const [tab, setTab] = useState<TabId>("review");
  const [reviewQueue, setReviewQueue] = useState<ReviewCandidate[]>([]);
  const [approved, setApproved] = useState<ApprovedExpense[]>([]);
  const [recurringRules, setRecurringRules] = useState<RecurringRule[]>(defaultRecurringRules);
  const [hydrated, setHydrated] = useState(false);
  const [sampleRows, setSampleRows] = useState<ReviewCandidate[]>([]);

  const [categoryModal, setCategoryModal] = useState<{
    candidate: ReviewCandidate;
    newCategory: ExpenseCategory;
    supplier: string;
    description: string;
    notes: string;
  } | null>(null);

  const [editApprovedModal, setEditApprovedModal] = useState<ApprovedExpense | null>(null);

  const [manualForm, setManualForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    category: "Other" as ExpenseCategory,
    supplier: "",
    description: "",
    amount: "",
    reference: "",
    notes: "",
  });

  const [ruleForm, setRuleForm] = useState({
    supplierContains: "",
    category: "Other" as ExpenseCategory,
    autoApprove: false,
    active: true,
  });

  const [customCategories, setCustomCategories] = useState<CustomExpenseCategory[]>([]);
  const [addCategoryOpen, setAddCategoryOpen] = useState(false);
  const [manageCategoriesOpen, setManageCategoriesOpen] = useState(false);
  const [addCategoryForm, setAddCategoryForm] = useState({
    name: "",
    type: "Expense" as "Expense" | "Income",
    notes: "",
  });
  const [addCategoryError, setAddCategoryError] = useState("");
  const [manageCategoryError, setManageCategoryError] = useState("");

  const [reviewPage, setReviewPage] = useState(1);
  const [approvedPage, setApprovedPage] = useState(1);
  const [recurringPage, setRecurringPage] = useState(1);

  const reviewPaged = useMemo(() => paginateList(reviewQueue, reviewPage), [reviewQueue, reviewPage]);
  const approvedPaged = useMemo(() => paginateList(approved, approvedPage), [approved, approvedPage]);
  const recurringPaged = useMemo(
    () => paginateList(recurringRules, recurringPage),
    [recurringRules, recurringPage]
  );
  const showRecurringPagination = recurringRules.length > PAGE_SIZE;

  const usedCategoryNames = useMemo(() => {
    const names = new Set<string>();
    for (const row of reviewQueue) {
      if (row.suggestedCategory) names.add(row.suggestedCategory);
    }
    for (const row of approved) {
      if (row.category) names.add(row.category);
    }
    for (const row of recurringRules) {
      if (row.category) names.add(row.category);
    }
    return names;
  }, [reviewQueue, approved, recurringRules]);

  const categoryOptions = useMemo(
    () => buildCategoryOptions(customCategories, usedCategoryNames),
    [customCategories, usedCategoryNames]
  );

  useEffect(() => {
    setCustomCategories(loadCustomCategories(schoolId));
  }, [schoolId]);

  useEffect(() => {
    if (reviewPage > reviewPaged.totalPages) setReviewPage(reviewPaged.totalPages);
  }, [reviewPage, reviewPaged.totalPages]);

  useEffect(() => {
    if (approvedPage > approvedPaged.totalPages) setApprovedPage(approvedPaged.totalPages);
  }, [approvedPage, approvedPaged.totalPages]);

  useEffect(() => {
    if (recurringPage > recurringPaged.totalPages) setRecurringPage(recurringPaged.totalPages);
  }, [recurringPage, recurringPaged.totalPages]);

  useEffect(() => {
    migrateLegacyExpenseStores(schoolId);

    const bankCandidates = loadExpenseCandidates(schoolId);
    const approvedRows = loadApprovedExpenses(schoolId).map((row) => ({
      ...row,
      description: String(row.description || row.reference || "").trim(),
    })) as ApprovedExpense[];

    const legacyRules = loadLegacyRecurringRules(schoolId) as RecurringRule[];
    const rules = legacyRules.length ? legacyRules : defaultRecurringRules();

    const bankReview = reviewQueueFromCandidates(bankCandidates).map(candidateToReviewRow);
    const hasRealData = bankReview.length > 0 || approvedRows.length > 0;

    if (!hasRealData) {
      setSampleRows([]);
      setReviewQueue([]);
      setApproved([]);
    } else {
      setSampleRows([]);
      setReviewQueue(bankReview);
      setApproved(approvedRows);
    }

    setRecurringRules(rules);
    setHydrated(true);
  }, [schoolId]);

  useEffect(() => {
    if (!hydrated) return;
    saveRecurringRules(schoolId, recurringRules);
  }, [recurringRules, hydrated, schoolId]);

  useEffect(() => {
    if (!hydrated) return;
    const refreshFromStorage = () => {
      setReviewQueue(reloadBankReviewQueue(schoolId, sampleRows));
      setApproved(
        loadApprovedExpenses(schoolId).map((row) => ({
          ...row,
          description: String(row.description || row.reference || "").trim(),
        })) as ApprovedExpense[]
      );
    };
    window.addEventListener(EXPENSE_CANDIDATES_UPDATED, refreshFromStorage);
    return () => window.removeEventListener(EXPENSE_CANDIDATES_UPDATED, refreshFromStorage);
  }, [hydrated, schoolId, sampleRows]);

  const stats = useMemo(() => {
    const approvedThisMonth = approved.filter((a) => isInCurrentMonth(a.date));
    const totalThisMonth = approvedThisMonth.reduce((s, a) => s + a.amount, 0);
    const unmatchedBank = reviewQueue.filter(
      (r) => r.source === "bank" && (r.confidence === "low" || r.status === "Pending")
    ).length;

    return {
      pendingReview: reviewQueue.length,
      approvedThisMonth: approvedThisMonth.length,
      totalThisMonth,
      unmatchedBank,
      recurringSuppliers: recurringRules.filter((r) => r.active).length,
      overBudgetCategories: 0,
    };
  }, [reviewQueue, approved, recurringRules]);

  const triggerExpenseAutoJournal = (expense: {
    id: string;
    date: string;
    category: string;
    amount: number;
    reference?: string;
  }) => {
    postExpenseApprovalJournal({
      schoolId,
      sourceId: expense.id,
      amount: expense.amount,
      date: expense.date,
      category: expense.category,
      reference: expense.reference,
      createdBy: approvedBy,
    });
  };

  const acceptCandidate = (candidate: ReviewCandidate) => {
    if (candidate.source === "bank") {
      const { approved: nextApproved, candidates } = acceptExpenseCandidate(
        schoolId,
        candidate.id,
        approvedBy
      );
      const latest = nextApproved[0];
      if (latest) {
        triggerExpenseAutoJournal(latest);
      }
      setApproved(
        nextApproved.map((row) => ({
          ...row,
          description: String(row.description || row.reference || "").trim(),
        })) as ApprovedExpense[]
      );
      setReviewQueue([
        ...reviewQueueFromCandidates(candidates).map(candidateToReviewRow),
        ...sampleRows,
      ]);
      setTab("approved");
      return;
    }

    const expense: ApprovedExpense = {
      id: uid("approved"),
      date: candidate.date,
      supplier: candidate.supplier,
      category: candidate.suggestedCategory,
      description: candidate.description,
      amount: candidate.amount,
      source: candidate.source === "sample" ? "Sample" : "Manual",
      approvedBy,
      reference: candidate.reference,
      approvedAt: new Date().toISOString(),
    };
    const nextApproved = addManualApprovedExpense(schoolId, expense);
    triggerExpenseAutoJournal(expense);
    setApproved(
      nextApproved.map((row) => ({
        ...row,
        description: String(row.description || row.reference || "").trim(),
      })) as ApprovedExpense[]
    );
    setReviewQueue((prev) => prev.filter((r) => r.id !== candidate.id));
    setSampleRows((prev) => prev.filter((r) => r.id !== candidate.id));
    setTab("approved");
  };

  const ignoreCandidate = (candidate: ReviewCandidate) => {
    if (candidate.source === "bank") {
      const next = ignoreExpenseCandidate(schoolId, candidate.id);
      setReviewQueue([
        ...reviewQueueFromCandidates(next).map(candidateToReviewRow),
        ...sampleRows,
      ]);
      return;
    }
    setReviewQueue((prev) => prev.filter((r) => r.id !== candidate.id));
    setSampleRows((prev) => prev.filter((r) => r.id !== candidate.id));
  };

  const openCategoryModal = (candidate: ReviewCandidate) => {
    setCategoryModal({
      candidate,
      newCategory: candidate.suggestedCategory,
      supplier: candidate.supplier,
      description: candidate.description,
      notes: "",
    });
  };

  const saveCategoryChange = () => {
    if (!categoryModal) return;
    const { candidate, newCategory, supplier, description, notes } = categoryModal;
    if (candidate.source === "bank") {
      const next = updateExpenseCandidate(schoolId, candidate.id, {
        category: newCategory,
        supplier: supplier.trim() || candidate.supplier,
        description: description.trim() || candidate.description,
        notes: notes.trim(),
        status: "Category updated",
      });
      setReviewQueue([
        ...reviewQueueFromCandidates(next).map(candidateToReviewRow),
        ...sampleRows,
      ]);
    } else {
      setReviewQueue((prev) =>
        prev.map((r) =>
          r.id === candidate.id
            ? {
                ...r,
                suggestedCategory: newCategory,
                supplier: supplier.trim() || r.supplier,
                description: description.trim() || r.description,
                status: "Category updated",
              }
            : r
        )
      );
      setSampleRows((prev) =>
        prev.map((r) =>
          r.id === candidate.id
            ? {
                ...r,
                suggestedCategory: newCategory,
                supplier: supplier.trim() || r.supplier,
                description: description.trim() || r.description,
                status: "Category updated",
              }
            : r
        )
      );
    }
    setCategoryModal(null);
  };

  const openEditApproved = (expense: ApprovedExpense) => {
    setEditApprovedModal(expense);
  };

  const saveEditApproved = () => {
    if (!editApprovedModal) return;
    const next = loadApprovedExpenses(schoolId).map((row) =>
      row.id === editApprovedModal.id
        ? {
            ...editApprovedModal,
            supplier: editApprovedModal.supplier.trim() || row.supplier,
            description: editApprovedModal.description.trim(),
            notes: editApprovedModal.notes?.trim() || undefined,
          }
        : row
    );
    saveApprovedExpenses(schoolId, next);
    setApproved(
      next.map((row) => ({
        ...row,
        description: String(row.description || row.reference || "").trim(),
      })) as ApprovedExpense[]
    );
    setEditApprovedModal(null);
  };

  const saveManualExpense = () => {
    const amount = Number(manualForm.amount);
    if (!manualForm.supplier.trim() || !amount || amount <= 0) return;

    const expense: ApprovedExpense = {
      id: uid("approved"),
      date: manualForm.date,
      supplier: manualForm.supplier.trim(),
      category: manualForm.category,
      description: manualForm.description.trim(),
      amount,
      source: "Manual",
      approvedBy,
      reference: manualForm.reference.trim() || undefined,
      notes: manualForm.notes.trim() || undefined,
      approvedAt: new Date().toISOString(),
    };

    const nextApproved = addManualApprovedExpense(schoolId, expense);
    triggerExpenseAutoJournal(expense);
    setApproved(
      nextApproved.map((row) => ({
        ...row,
        description: String(row.description || row.reference || "").trim(),
      })) as ApprovedExpense[]
    );
    setManualForm({
      date: new Date().toISOString().slice(0, 10),
      category: "Other",
      supplier: "",
      description: "",
      amount: "",
      reference: "",
      notes: "",
    });
    setTab("approved");
  };

  const addRecurringRule = () => {
    if (!ruleForm.supplierContains.trim()) return;
    const rule: RecurringRule = {
      id: uid("rule"),
      supplierContains: ruleForm.supplierContains.trim(),
      category: ruleForm.category,
      autoApprove: ruleForm.autoApprove,
      active: ruleForm.active,
    };
    setRecurringRules((prev) => [...prev, rule]);
    setRuleForm({ supplierContains: "", category: "Other", autoApprove: false, active: true });
  };

  const toggleRule = (id: string, field: "active" | "autoApprove") => {
    setRecurringRules((prev) =>
      prev.map((r) => (r.id === id ? { ...r, [field]: !r[field] } : r))
    );
  };

  const deleteRule = (id: string) => {
    setRecurringRules((prev) => prev.filter((r) => r.id !== id));
  };

  const openAddCategoryModal = () => {
    setAddCategoryForm({ name: "", type: "Expense", notes: "" });
    setAddCategoryError("");
    setAddCategoryOpen(true);
  };

  const saveNewCategory = () => {
    const name = addCategoryForm.name.trim();
    if (!name) {
      setAddCategoryError("Category name is required.");
      return;
    }
    if (categoryNameExists(name, customCategories)) {
      setAddCategoryError("This category already exists.");
      return;
    }
    const next: CustomExpenseCategory[] = [
      ...customCategories,
      {
        id: uid("cat"),
        name,
        type: addCategoryForm.type,
        notes: addCategoryForm.notes.trim() || undefined,
        createdAt: new Date().toISOString(),
      },
    ];
    setCustomCategories(next);
    saveCustomCategories(schoolId, next);
    setAddCategoryOpen(false);
    setAddCategoryForm({ name: "", type: "Expense", notes: "" });
    setAddCategoryError("");
  };

  const isCategoryInUse = (name: string) => {
    const key = normalizeCategoryKey(name);
    for (const row of reviewQueue) {
      if (normalizeCategoryKey(row.suggestedCategory) === key) return true;
    }
    for (const row of approved) {
      if (normalizeCategoryKey(row.category) === key) return true;
    }
    for (const row of recurringRules) {
      if (normalizeCategoryKey(row.category) === key) return true;
    }
    return false;
  };

  const removeCustomCategory = (id: string) => {
    const target = customCategories.find((c) => c.id === id);
    if (!target) return;
    if (isCategoryInUse(target.name)) {
      setManageCategoryError(`"${target.name}" is in use and cannot be removed.`);
      return;
    }
    const next = customCategories.filter((c) => c.id !== id);
    setCustomCategories(next);
    saveCustomCategories(schoolId, next);
    setManageCategoryError("");
  };

  const confidenceBadge = (c: ReviewCandidate["confidence"]) => {
    const bg = c === "high" ? "#ecfdf5" : c === "medium" ? "#fffbeb" : "#fef2f2";
    const color = c === "high" ? "#047857" : c === "medium" ? "#b45309" : "#b91c1c";
    return (
      <span style={{ padding: "4px 8px", borderRadius: 6, background: bg, color, fontWeight: 800, fontSize: 11 }}>
        {c}
      </span>
    );
  };

  if (!hydrated) {
    return (
      <div style={accountingPageWrap}>
        <p style={accountingSubtitle}>Loading expenses…</p>
      </div>
    );
  }

  return (
    <div style={accountingPageWrap}>
      <div style={{ borderBottom: `2px solid ${ACCOUNTING_GOLD}`, paddingBottom: 18, marginBottom: 24 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div>
            <h1 style={accountingTitle}>Expenses</h1>
            <p style={{ ...accountingSubtitle, margin: 0 }}>
              Review, classify, and approve school expenses from banking and manual captures. Accepted
              banking expense candidates are now sent here from Accounting → Banking.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              style={ghostBtn}
              onClick={() => {
                setManageCategoryError("");
                setManageCategoriesOpen(true);
              }}
            >
              Manage categories
            </button>
            <button type="button" style={goldBtn} onClick={openAddCategoryModal}>
              + Add Category
            </button>
          </div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
          gap: 14,
          marginBottom: 20,
        }}
      >
        {[
          { label: "Pending Review", value: String(stats.pendingReview) },
          { label: "Approved This Month", value: String(stats.approvedThisMonth) },
          { label: "Total Expenses This Month", value: formatMoney(stats.totalThisMonth) },
          { label: "Unmatched Bank Lines", value: String(stats.unmatchedBank) },
          { label: "Recurring Suppliers", value: String(stats.recurringSuppliers) },
          { label: "Over Budget Categories", value: String(stats.overBudgetCategories) },
        ].map((card) => (
          <div key={card.label} style={accountingCard}>
            <div style={accountingCardLabel}>{card.label}</div>
            <div style={{ ...accountingCardValue, fontSize: 22 }}>{card.value}</div>
          </div>
        ))}
      </div>

      <div
        style={{
          marginBottom: 20,
          padding: 14,
          borderRadius: 10,
          background: ACCOUNTING_INK,
          color: ACCOUNTING_GOLD,
          fontWeight: 700,
          fontSize: 13,
        }}
      >
        Approved expenses will feed Accounting → Budget actual spend automatically.
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
        {(
          [
            ["review", "Review Queue"],
            ["approved", "Approved Expenses"],
            ["recurring", "Recurring Rules"],
            ["manual", "Manual Expense"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" style={tabBtn(tab === id)} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === "review" && (
        <div style={{ overflowX: "auto", borderRadius: 12, border: `1px solid ${ACCOUNTING_GOLD}` }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 960, background: "#fff" }}>
            <thead>
              <tr>
                {["Date", "Category", "Amount", "Confidence", "Status", "Actions"].map((h) => (
                  <th key={h} style={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {reviewQueue.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ ...td, textAlign: "center", color: "#64748b", padding: 24 }}>
                    No expense candidates in the review queue.
                  </td>
                </tr>
              ) : (
                reviewPaged.items.map((row) => (
                  <tr key={row.id}>
                    <td style={td}>{row.date}</td>
                    <td style={td}>
                      <ExpenseCategoryPrimary
                        category={row.suggestedCategory}
                        supplier={row.supplier}
                        description={row.description}
                      />
                    </td>
                    <td style={td}>{formatMoney(row.amount)}</td>
                    <td style={td}>{confidenceBadge(row.confidence)}</td>
                    <td style={td}>{row.status}</td>
                    <td style={td}>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button type="button" style={goldBtn} onClick={() => acceptCandidate(row)}>
                          Accept
                        </button>
                        <button type="button" style={ghostBtn} onClick={() => openCategoryModal(row)}>
                          Edit
                        </button>
                        <button type="button" style={ghostBtn} onClick={() => ignoreCandidate(row)}>
                          Ignore
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <TablePagination
            page={reviewPaged.page}
            totalPages={reviewPaged.totalPages}
            onPageChange={setReviewPage}
          />
        </div>
      )}

      {tab === "approved" && (
        <div style={{ overflowX: "auto", borderRadius: 12, border: `1px solid ${ACCOUNTING_GOLD}` }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900, background: "#fff" }}>
            <thead>
              <tr>
                {["Date", "Category", "Amount", "Source", "Approved By", "Actions"].map((h) => (
                  <th key={h} style={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {approved.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ ...td, textAlign: "center", color: "#64748b", padding: 24 }}>
                    No approved expenses yet. Accept items from the Review Queue or add a manual expense.
                  </td>
                </tr>
              ) : (
                approvedPaged.items.map((row) => (
                  <tr key={row.id}>
                    <td style={td}>{row.date}</td>
                    <td style={td}>
                      <ExpenseCategoryPrimary
                        category={row.category}
                        supplier={row.supplier}
                        description={row.description}
                      />
                    </td>
                    <td style={td}>{formatMoney(row.amount)}</td>
                    <td style={td}>{row.source}</td>
                    <td style={td}>{row.approvedBy}</td>
                    <td style={td}>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button type="button" style={ghostBtn} onClick={() => openEditApproved(row)}>
                          Edit
                        </button>
                        <button
                          type="button"
                          style={ghostBtn}
                          onClick={() => setApproved((prev) => prev.filter((a) => a.id !== row.id))}
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <TablePagination
            page={approvedPaged.page}
            totalPages={approvedPaged.totalPages}
            onPageChange={setApprovedPage}
          />
        </div>
      )}

      {tab === "recurring" && (
        <div style={{ display: "grid", gap: 20 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
              gap: 12,
              padding: 16,
              borderRadius: 12,
              border: `1px solid ${ACCOUNTING_GOLD}`,
              background: "#faf8f0",
            }}
          >
            <label>
              Supplier contains
              <input
                style={fieldStyle}
                value={ruleForm.supplierContains}
                onChange={(e) => setRuleForm((f) => ({ ...f, supplierContains: e.target.value }))}
                placeholder="e.g. ESKOM"
              />
            </label>
            <label>
              Category
              <CategorySelect
                value={ruleForm.category}
                onChange={(category) => setRuleForm((f) => ({ ...f, category }))}
                options={categoryOptions}
              />
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 22 }}>
              <input
                type="checkbox"
                checked={ruleForm.autoApprove}
                onChange={(e) => setRuleForm((f) => ({ ...f, autoApprove: e.target.checked }))}
              />
              Auto-approve
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 22 }}>
              <input
                type="checkbox"
                checked={ruleForm.active}
                onChange={(e) => setRuleForm((f) => ({ ...f, active: e.target.checked }))}
              />
              Active
            </label>
            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <button type="button" style={goldBtn} onClick={addRecurringRule}>
                Add rule
              </button>
            </div>
          </div>

          <div style={{ overflowX: "auto", borderRadius: 12, border: `1px solid ${ACCOUNTING_GOLD}` }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720, background: "#fff" }}>
              <thead>
                <tr>
                  {["Supplier contains", "Category", "Auto-approve", "Active", "Actions"].map((h) => (
                    <th key={h} style={th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recurringPaged.items.map((rule) => (
                  <tr key={rule.id}>
                    <td style={td}>{rule.supplierContains}</td>
                    <td style={td}>{rule.category}</td>
                    <td style={td}>
                      <input
                        type="checkbox"
                        checked={rule.autoApprove}
                        onChange={() => toggleRule(rule.id, "autoApprove")}
                      />
                    </td>
                    <td style={td}>
                      <input type="checkbox" checked={rule.active} onChange={() => toggleRule(rule.id, "active")} />
                    </td>
                    <td style={td}>
                      <button type="button" style={ghostBtn} onClick={() => deleteRule(rule.id)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <TablePagination
              page={recurringPaged.page}
              totalPages={recurringPaged.totalPages}
              onPageChange={setRecurringPage}
              visible={showRecurringPagination}
            />
          </div>
        </div>
      )}

      {tab === "manual" && (
        <div
          style={{
            maxWidth: 520,
            display: "grid",
            gap: 14,
            padding: 20,
            borderRadius: 12,
            border: `2px solid ${ACCOUNTING_GOLD}`,
            background: "linear-gradient(180deg, #fff 0%, #faf8f0 100%)",
          }}
        >
          <label>
            Date
            <input
              type="date"
              style={fieldStyle}
              value={manualForm.date}
              onChange={(e) => setManualForm((f) => ({ ...f, date: e.target.value }))}
            />
          </label>
          <label>
            Category
            <CategorySelect
              value={manualForm.category}
              onChange={(category) => setManualForm((f) => ({ ...f, category }))}
              options={categoryOptions}
            />
          </label>
          <label>
            Supplier
            <input
              style={fieldStyle}
              value={manualForm.supplier}
              onChange={(e) => setManualForm((f) => ({ ...f, supplier: e.target.value }))}
              placeholder="e.g. ESKOM Holdings"
            />
          </label>
          <label>
            Description
            <input
              style={fieldStyle}
              value={manualForm.description}
              onChange={(e) => setManualForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="e.g. Electricity — main campus"
            />
          </label>
          <label>
            Amount (R)
            <input
              type="number"
              min={0}
              step="0.01"
              style={fieldStyle}
              value={manualForm.amount}
              onChange={(e) => setManualForm((f) => ({ ...f, amount: e.target.value }))}
            />
          </label>
          <label>
            Reference
            <input
              style={fieldStyle}
              value={manualForm.reference}
              onChange={(e) => setManualForm((f) => ({ ...f, reference: e.target.value }))}
            />
          </label>
          <label>
            Notes
            <textarea
              style={{ ...fieldStyle, minHeight: 72 }}
              value={manualForm.notes}
              onChange={(e) => setManualForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </label>
          <button type="button" style={{ ...goldBtn, alignSelf: "flex-start" }} onClick={saveManualExpense}>
            Save Expense
          </button>
        </div>
      )}

      {categoryModal ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.55)",
            zIndex: 6000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
          onClick={() => setCategoryModal(null)}
        >
          <div
            style={{
              background: "#fff",
              border: `2px solid ${ACCOUNTING_GOLD}`,
              borderRadius: 14,
              padding: 24,
              width: "min(440px, 100%)",
              boxShadow: "0 24px 60px rgba(0,0,0,0.25)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ margin: "0 0 16px", fontSize: 20, fontWeight: 900, color: ACCOUNTING_INK }}>
              Edit expense (review)
            </h2>
            <label style={{ display: "block", marginBottom: 12 }}>
              Category
              <CategorySelect
                value={categoryModal.newCategory}
                onChange={(newCategory) =>
                  setCategoryModal((m) => (m ? { ...m, newCategory } : m))
                }
                options={categoryOptions}
              />
            </label>
            <label style={{ display: "block", marginBottom: 12 }}>
              Supplier
              <input
                style={fieldStyle}
                value={categoryModal.supplier}
                onChange={(e) => setCategoryModal((m) => (m ? { ...m, supplier: e.target.value } : m))}
              />
            </label>
            <label style={{ display: "block", marginBottom: 12 }}>
              Description
              <input
                style={fieldStyle}
                value={categoryModal.description}
                onChange={(e) => setCategoryModal((m) => (m ? { ...m, description: e.target.value } : m))}
              />
            </label>
            <label style={{ display: "block", marginBottom: 16 }}>
              Notes
              <textarea
                style={{ ...fieldStyle, minHeight: 64 }}
                value={categoryModal.notes}
                onChange={(e) => setCategoryModal((m) => (m ? { ...m, notes: e.target.value } : m))}
                placeholder="Internal note (optional, not shown in table)"
              />
            </label>
            <div style={{ display: "flex", gap: 10 }}>
              <button type="button" style={goldBtn} onClick={saveCategoryChange}>
                Save
              </button>
              <button type="button" style={ghostBtn} onClick={() => setCategoryModal(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editApprovedModal ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.55)",
            zIndex: 6000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
          onClick={() => setEditApprovedModal(null)}
        >
          <div
            style={{
              background: "#fff",
              border: `2px solid ${ACCOUNTING_GOLD}`,
              borderRadius: 14,
              padding: 24,
              width: "min(440px, 100%)",
              boxShadow: "0 24px 60px rgba(0,0,0,0.25)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ margin: "0 0 16px", fontSize: 20, fontWeight: 900, color: ACCOUNTING_INK }}>
              Edit approved expense
            </h2>
            <label style={{ display: "block", marginBottom: 12 }}>
              Category
              <CategorySelect
                value={editApprovedModal.category}
                onChange={(category) =>
                  setEditApprovedModal((m) => (m ? { ...m, category } : m))
                }
                options={categoryOptions}
              />
            </label>
            <label style={{ display: "block", marginBottom: 12 }}>
              Supplier
              <input
                style={fieldStyle}
                value={editApprovedModal.supplier}
                onChange={(e) =>
                  setEditApprovedModal((m) => (m ? { ...m, supplier: e.target.value } : m))
                }
              />
            </label>
            <label style={{ display: "block", marginBottom: 12 }}>
              Description
              <input
                style={fieldStyle}
                value={editApprovedModal.description}
                onChange={(e) =>
                  setEditApprovedModal((m) => (m ? { ...m, description: e.target.value } : m))
                }
              />
            </label>
            <label style={{ display: "block", marginBottom: 16 }}>
              Notes
              <textarea
                style={{ ...fieldStyle, minHeight: 64 }}
                value={editApprovedModal.notes || ""}
                onChange={(e) =>
                  setEditApprovedModal((m) => (m ? { ...m, notes: e.target.value } : m))
                }
              />
            </label>
            <div style={{ display: "flex", gap: 10 }}>
              <button type="button" style={goldBtn} onClick={saveEditApproved}>
                Save
              </button>
              <button type="button" style={ghostBtn} onClick={() => setEditApprovedModal(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {addCategoryOpen ? (
        <div style={modalOverlay} onClick={() => setAddCategoryOpen(false)}>
          <div style={modalPanel} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ margin: "0 0 16px", fontSize: 20, fontWeight: 900, color: ACCOUNTING_INK }}>
              Add category
            </h2>
            {addCategoryError ? (
              <p style={{ margin: "0 0 12px", color: "#b91c1c", fontWeight: 700, fontSize: 13 }}>{addCategoryError}</p>
            ) : null}
            <label style={{ display: "block", marginBottom: 12 }}>
              Category name
              <input
                style={fieldStyle}
                value={addCategoryForm.name}
                onChange={(e) => setAddCategoryForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Sports Equipment"
              />
            </label>
            <label style={{ display: "block", marginBottom: 12 }}>
              Type
              <select
                style={fieldStyle}
                value={addCategoryForm.type}
                onChange={(e) =>
                  setAddCategoryForm((f) => ({
                    ...f,
                    type: e.target.value === "Income" ? "Income" : "Expense",
                  }))
                }
              >
                <option value="Expense">Expense</option>
                <option value="Income">Income</option>
              </select>
            </label>
            <label style={{ display: "block", marginBottom: 16 }}>
              Notes
              <textarea
                style={{ ...fieldStyle, minHeight: 72 }}
                value={addCategoryForm.notes}
                onChange={(e) => setAddCategoryForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Optional description for your team"
              />
            </label>
            <div style={{ display: "flex", gap: 10 }}>
              <button type="button" style={goldBtn} onClick={saveNewCategory}>
                Save
              </button>
              <button type="button" style={ghostBtn} onClick={() => setAddCategoryOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {manageCategoriesOpen ? (
        <div style={modalOverlay} onClick={() => setManageCategoriesOpen(false)}>
          <div style={{ ...modalPanel, width: "min(560px, 100%)" }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ margin: "0 0 8px", fontSize: 20, fontWeight: 900, color: ACCOUNTING_INK }}>
              Expense categories
            </h2>
            <p style={{ margin: "0 0 16px", fontSize: 13, color: "#64748b", fontWeight: 600 }}>
              Default categories cannot be removed. Custom categories can be removed only when not used.
            </p>
            {manageCategoryError ? (
              <p style={{ margin: "0 0 12px", color: "#b91c1c", fontWeight: 700, fontSize: 13 }}>{manageCategoryError}</p>
            ) : null}
            <h3 style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 900, color: ACCOUNTING_INK }}>Default</h3>
            <ul style={{ margin: "0 0 20px", padding: 0, listStyle: "none" }}>
              {DEFAULT_EXPENSE_CATEGORIES.map((name) => (
                <li
                  key={name}
                  style={{
                    padding: "8px 0",
                    borderBottom: "1px solid #f1f5f9",
                    fontWeight: 700,
                    fontSize: 13,
                    color: ACCOUNTING_INK,
                  }}
                >
                  {name}
                </li>
              ))}
            </ul>
            <h3 style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 900, color: ACCOUNTING_INK }}>Custom</h3>
            {customCategories.length === 0 ? (
              <p style={{ margin: "0 0 16px", fontSize: 13, color: "#64748b" }}>No custom categories yet.</p>
            ) : (
              <ul style={{ margin: "0 0 16px", padding: 0, listStyle: "none" }}>
                {customCategories.map((cat) => {
                  const inUse = isCategoryInUse(cat.name);
                  return (
                    <li
                      key={cat.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 10,
                        padding: "10px 0",
                        borderBottom: "1px solid #f1f5f9",
                      }}
                    >
                      <div>
                        <span style={{ fontWeight: 800, fontSize: 13, color: ACCOUNTING_INK }}>{cat.name}</span>
                        <CustomCategoryBadge />
                        <span style={{ display: "block", fontSize: 12, color: "#64748b", marginTop: 2 }}>
                          {cat.type}
                          {cat.notes ? ` · ${cat.notes}` : ""}
                          {inUse ? " · In use" : ""}
                        </span>
                      </div>
                      <button
                        type="button"
                        style={{ ...ghostBtn, opacity: inUse ? 0.45 : 1 }}
                        disabled={inUse}
                        onClick={() => removeCustomCategory(cat.id)}
                      >
                        Remove
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                type="button"
                style={goldBtn}
                onClick={() => {
                  setManageCategoriesOpen(false);
                  openAddCategoryModal();
                }}
              >
                + Add Category
              </button>
              <button type="button" style={ghostBtn} onClick={() => setManageCategoriesOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
