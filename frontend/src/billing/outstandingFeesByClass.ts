/**
 * Outstanding Accounts grouped by current class.
 *
 * Balances are FamilyAccount-level and are never split between learners. Each account is
 * attributed to exactly one group:
 *   - the single class shared by all its ACTIVE classed learners;
 *   - "Multiple classes" when its learners are in more than one class;
 *   - "Unassigned" when no ACTIVE member learner has a class.
 * Group totals therefore add up exactly to the overall outstanding total.
 * In a single-class view, multi-class accounts linked to that class are listed separately
 * ("shared") and excluded from the class total.
 */
import { summarizeFilteredOutstanding } from "./outstandingAccountsFilters";

export const ALL_CLASSES_VALUE = "all";
export const MULTIPLE_CLASSES_VALUE = "__multiple_classes__";
export const UNASSIGNED_VALUE = "__unassigned__";
export const ALL_CLASSES_LABEL = "All Classes";
export const MULTIPLE_CLASSES_LABEL = "Multiple classes";
export const UNASSIGNED_LABEL = "Unassigned";

export type OutstandingClassRow = {
  memberLearnerIds?: string[];
  classLabels?: string[];
  classes?: string[];
  outstandingBalance: number;
};

export type OutstandingClassGroupKind = "class" | "multiple" | "unassigned";

export type OutstandingTotals = {
  totalOutstanding: number;
  outstandingAccountCount: number;
  learnersAffected: number;
};

export type OutstandingClassGroup<T> = OutstandingTotals & {
  value: string;
  label: string;
  kind: OutstandingClassGroupKind;
  rows: T[];
};

export type OutstandingClassView<T> = {
  selection: string;
  selectionLabel: string;
  isAllClasses: boolean;
  groups: OutstandingClassGroup<T>[];
  /** Single-class view only: multi-class accounts linked to the class, excluded from its total. */
  sharedRows: T[];
  sharedTotals: OutstandingTotals;
  /** Totals of the grouped rows (excludes sharedRows). */
  totals: OutstandingTotals;
};

export function compareClassLabels(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }) || a.localeCompare(b);
}

/** Canonical labels from the API; falls back to raw labels from an older backend response. */
export function rowClassLabels(row: OutstandingClassRow): string[] {
  const source = Array.isArray(row.classLabels) ? row.classLabels : row.classes || [];
  const set = new Set<string>();
  for (const v of source) {
    const s = String(v || "").trim();
    if (s) set.add(s);
  }
  return Array.from(set).sort(compareClassLabels);
}

export function accountClassGroupValue(row: OutstandingClassRow): string {
  const labels = rowClassLabels(row);
  if (labels.length === 1) return labels[0];
  if (labels.length > 1) return MULTIPLE_CLASSES_VALUE;
  return UNASSIGNED_VALUE;
}

export function classSelectionLabel(selection: string): string {
  if (!selection || selection === ALL_CLASSES_VALUE) return ALL_CLASSES_LABEL;
  if (selection === MULTIPLE_CLASSES_VALUE) return MULTIPLE_CLASSES_LABEL;
  if (selection === UNASSIGNED_VALUE) return UNASSIGNED_LABEL;
  return selection;
}

function groupKind(value: string): OutstandingClassGroupKind {
  if (value === MULTIPLE_CLASSES_VALUE) return "multiple";
  if (value === UNASSIGNED_VALUE) return "unassigned";
  return "class";
}

function makeGroup<T extends OutstandingClassRow>(value: string, rows: T[]): OutstandingClassGroup<T> {
  return {
    value,
    label: classSelectionLabel(value),
    kind: groupKind(value),
    rows,
    ...summarizeFilteredOutstanding(rows),
  };
}

function groupOrder(a: OutstandingClassGroup<unknown>, b: OutstandingClassGroup<unknown>): number {
  const rank = (g: OutstandingClassGroup<unknown>) => (g.kind === "class" ? 0 : g.kind === "multiple" ? 1 : 2);
  return rank(a) - rank(b) || compareClassLabels(a.label, b.label);
}

/** Non-empty groups: classes in natural name order, then Multiple classes, then Unassigned. Row order preserved. */
export function groupOutstandingByClass<T extends OutstandingClassRow>(rows: T[]): OutstandingClassGroup<T>[] {
  const byValue = new Map<string, T[]>();
  for (const row of rows || []) {
    const value = accountClassGroupValue(row);
    const list = byValue.get(value) || [];
    list.push(row);
    byValue.set(value, list);
  }
  return Array.from(byValue.entries())
    .map(([value, list]) => makeGroup(value, list))
    .sort(groupOrder);
}

export function buildOutstandingClassView<T extends OutstandingClassRow>(
  rows: T[],
  selection: string
): OutstandingClassView<T> {
  const sel = String(selection || "").trim() || ALL_CLASSES_VALUE;
  const all = groupOutstandingByClass(rows);
  const isAllClasses = sel === ALL_CLASSES_VALUE;

  let groups: OutstandingClassGroup<T>[];
  let sharedRows: T[] = [];
  if (isAllClasses) {
    groups = all;
  } else {
    groups = [all.find((g) => g.value === sel) || makeGroup<T>(sel, [])];
    if (groupKind(sel) === "class") {
      sharedRows = (rows || []).filter((row) => {
        const labels = rowClassLabels(row);
        return labels.length > 1 && labels.includes(sel);
      });
    }
  }

  return {
    selection: sel,
    selectionLabel: classSelectionLabel(sel),
    isAllClasses,
    groups,
    sharedRows,
    sharedTotals: summarizeFilteredOutstanding(sharedRows),
    totals: summarizeFilteredOutstanding(groups.flatMap((g) => g.rows)),
  };
}

/** Dropdown options: every known class (including empty ones), then Multiple classes / Unassigned when present. */
export function buildClassSelectOptions(
  classOptions: string[],
  rows: OutstandingClassRow[]
): { value: string; label: string }[] {
  const labels = new Set<string>();
  for (const c of classOptions || []) {
    const s = String(c || "").trim();
    if (s) labels.add(s);
  }
  let hasMultiple = false;
  let hasUnassigned = false;
  for (const row of rows || []) {
    const value = accountClassGroupValue(row);
    if (value === MULTIPLE_CLASSES_VALUE) hasMultiple = true;
    else if (value === UNASSIGNED_VALUE) hasUnassigned = true;
    for (const l of rowClassLabels(row)) labels.add(l);
  }
  const options = [{ value: ALL_CLASSES_VALUE, label: ALL_CLASSES_LABEL }];
  for (const l of Array.from(labels).sort(compareClassLabels)) options.push({ value: l, label: l });
  if (hasMultiple) options.push({ value: MULTIPLE_CLASSES_VALUE, label: MULTIPLE_CLASSES_LABEL });
  if (hasUnassigned) options.push({ value: UNASSIGNED_VALUE, label: UNASSIGNED_LABEL });
  return options;
}

function cents(value: number): number {
  return Math.round((Number(value) || 0) * 100);
}

/**
 * All Classes must reconcile to the ungrouped total of the same rows: sum of class totals ==
 * overall total, and every account appears in exactly one group.
 */
export function reconcileClassView(
  view: OutstandingClassView<OutstandingClassRow>,
  expected: OutstandingTotals
): { ok: boolean; groupsTotal: number; expectedTotal: number; groupedAccounts: number; expectedAccounts: number } {
  const groupsCents = view.groups.reduce((s, g) => s + cents(g.totalOutstanding), 0);
  const groupedAccounts = view.groups.reduce((s, g) => s + g.outstandingAccountCount, 0);
  return {
    ok:
      groupsCents === cents(expected.totalOutstanding) &&
      cents(view.totals.totalOutstanding) === cents(expected.totalOutstanding) &&
      groupedAccounts === expected.outstandingAccountCount,
    groupsTotal: groupsCents / 100,
    expectedTotal: cents(expected.totalOutstanding) / 100,
    groupedAccounts,
    expectedAccounts: expected.outstandingAccountCount,
  };
}

function slugPart(value: string, fallback: string): string {
  const cleaned = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return cleaned || fallback;
}

function localYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function buildOutstandingFeesFileName(input: {
  schoolName: string;
  selectionLabel: string;
  date: Date;
  extension: "xlsx" | "pdf";
}): string {
  const school = slugPart(input.schoolName, "School");
  const cls = slugPart(input.selectionLabel, "All-Classes");
  return `Outstanding-Fees-${school}-${cls}-${localYmd(input.date)}.${input.extension}`;
}
