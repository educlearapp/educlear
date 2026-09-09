/**
 * Client-side filters for Outstanding Accounts (Phase 1).
 */
export type OutstandingBalanceRangeKey =
  | "all"
  | "0.01-1000"
  | "1000.01-3000"
  | "3000.01-5000"
  | "5000.01-10000"
  | "above-10000";

export type OutstandingDaysOverdueKey =
  | "all"
  | "1-30"
  | "31-60"
  | "61-90"
  | "90-plus"
  | "unknown";

export type OutstandingAccountFilterRow = {
  accountNumber: string;
  accountRef: string;
  learnerNames: string[];
  grades: string[];
  classes: string[];
  outstandingBalance: number;
  parentGuardianName: string | null;
  primaryCellphone: string | null;
  alternateContact: string | null;
  email: string | null;
  daysOverdue: number | null;
};

export const OUTSTANDING_BALANCE_RANGES: { key: OutstandingBalanceRangeKey; label: string }[] = [
  { key: "all", label: "All Outstanding" },
  { key: "0.01-1000", label: "R0.01 – R1,000" },
  { key: "1000.01-3000", label: "R1,000.01 – R3,000" },
  { key: "3000.01-5000", label: "R3,000.01 – R5,000" },
  { key: "5000.01-10000", label: "R5,000.01 – R10,000" },
  { key: "above-10000", label: "Above R10,000" },
];

export const OUTSTANDING_DAYS_OVERDUE_OPTIONS: {
  key: OutstandingDaysOverdueKey;
  label: string;
}[] = [
  { key: "all", label: "All" },
  { key: "1-30", label: "1–30 days" },
  { key: "31-60", label: "31–60 days" },
  { key: "61-90", label: "61–90 days" },
  { key: "90-plus", label: "90+ days" },
  { key: "unknown", label: "Unknown" },
];

export function matchesBalanceRange(
  balance: number,
  range: OutstandingBalanceRangeKey
): boolean {
  const b = Number(balance) || 0;
  if (range === "all") return b > 0;
  if (range === "0.01-1000") return b >= 0.01 && b <= 1000;
  if (range === "1000.01-3000") return b > 1000 && b <= 3000;
  if (range === "3000.01-5000") return b > 3000 && b <= 5000;
  if (range === "5000.01-10000") return b > 5000 && b <= 10000;
  if (range === "above-10000") return b > 10000;
  return true;
}

export function matchesDaysOverdue(
  daysOverdue: number | null | undefined,
  key: OutstandingDaysOverdueKey
): boolean {
  if (key === "all") return true;
  if (key === "unknown") return daysOverdue == null || !Number.isFinite(Number(daysOverdue));
  const d = Number(daysOverdue);
  if (!Number.isFinite(d)) return false;
  if (key === "1-30") return d >= 1 && d <= 30;
  if (key === "31-60") return d >= 31 && d <= 60;
  if (key === "61-90") return d >= 61 && d <= 90;
  if (key === "90-plus") return d >= 90;
  return true;
}

export function outstandingSearchBlob(row: OutstandingAccountFilterRow): string {
  return [
    ...(row.learnerNames || []),
    row.parentGuardianName || "",
    row.accountNumber || "",
    row.accountRef || "",
    row.primaryCellphone || "",
    row.alternateContact || "",
    row.email || "",
  ]
    .join(" ")
    .toLowerCase();
}

export function filterOutstandingAccounts<T extends OutstandingAccountFilterRow>(
  rows: T[],
  opts: {
    search: string;
    grade: string;
    className: string;
    balanceRange: OutstandingBalanceRangeKey;
    daysOverdue: OutstandingDaysOverdueKey;
  }
): T[] {
  const q = String(opts.search || "").trim().toLowerCase();
  const grade = String(opts.grade || "").trim();
  const className = String(opts.className || "").trim();

  return (rows || []).filter((row) => {
    if (!matchesBalanceRange(row.outstandingBalance, opts.balanceRange)) return false;
    if (!matchesDaysOverdue(row.daysOverdue, opts.daysOverdue)) return false;
    if (grade && grade !== "all") {
      const grades = row.grades || [];
      if (!grades.some((g) => String(g).trim() === grade)) return false;
    }
    if (className && className !== "all") {
      const classes = row.classes || [];
      if (!classes.some((c) => String(c).trim() === className)) return false;
    }
    if (q && !outstandingSearchBlob(row).includes(q)) return false;
    return true;
  });
}

export function summarizeFilteredOutstanding(
  rows: Array<{ outstandingBalance: number; memberLearnerIds?: string[] }>
): { totalOutstanding: number; outstandingAccountCount: number; learnersAffected: number } {
  const learnerIds = new Set<string>();
  let total = 0;
  for (const row of rows) {
    total += Math.round((Number(row.outstandingBalance) || 0) * 100) / 100;
    for (const id of row.memberLearnerIds || []) {
      const lid = String(id || "").trim();
      if (lid) learnerIds.add(lid);
    }
  }
  return {
    totalOutstanding: Math.round(total * 100) / 100,
    outstandingAccountCount: rows.length,
    learnersAffected: learnerIds.size,
  };
}
