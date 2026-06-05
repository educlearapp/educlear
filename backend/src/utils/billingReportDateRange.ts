export type TransactionListDateSelection =
  | "Today"
  | "This Month"
  | "Last Month"
  | "Custom Dates";

export type ResolvedDateRange = {
  fromDate: string;
  toDate: string;
  selection: TransactionListDateSelection | "Custom";
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Calendar ISO date (YYYY-MM-DD) in local timezone — avoids UTC day-shift on boundaries. */
export function calendarIsoToday(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA");
}

/** Parse YYYY-MM-DD from a date or ISO timestamp without timezone conversion. */
export function parseCalendarIsoDate(dateRaw: string | undefined | null): string | null {
  const raw = String(dateRaw || "").trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1970 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function ledgerEntryCalendarDate(entry: {
  date?: string;
  createdAt?: string;
}): string {
  return (
    parseCalendarIsoDate(entry.date) ||
    parseCalendarIsoDate(entry.createdAt) ||
    ""
  );
}

export function dateInInclusiveRange(
  dateRaw: string | undefined | null,
  fromDate: string,
  toDate: string
): boolean {
  const iso = parseCalendarIsoDate(dateRaw);
  if (!iso) return false;
  return iso >= fromDate && iso <= toDate;
}

function firstDayOfMonth(year: number, monthIndex: number): string {
  return `${year}-${pad2(monthIndex + 1)}-01`;
}

function lastDayOfMonth(year: number, monthIndex: number): string {
  const last = new Date(year, monthIndex + 1, 0);
  return `${last.getFullYear()}-${pad2(last.getMonth() + 1)}-${pad2(last.getDate())}`;
}

export function resolveTransactionListDateRange(
  selection: TransactionListDateSelection,
  customFrom?: string,
  customTo?: string,
  now: Date = new Date()
): ResolvedDateRange {
  const today = calendarIsoToday(now);

  if (selection === "Today") {
    return { fromDate: today, toDate: today, selection: "Today" };
  }

  if (selection === "This Month") {
    return {
      fromDate: firstDayOfMonth(now.getFullYear(), now.getMonth()),
      toDate: today,
      selection: "This Month",
    };
  }

  if (selection === "Last Month") {
    const monthIndex = now.getMonth() - 1;
    const year = monthIndex < 0 ? now.getFullYear() - 1 : now.getFullYear();
    const adjustedMonth = monthIndex < 0 ? 11 : monthIndex;
    return {
      fromDate: firstDayOfMonth(year, adjustedMonth),
      toDate: lastDayOfMonth(year, adjustedMonth),
      selection: "Last Month",
    };
  }

  const fromDate = parseCalendarIsoDate(customFrom || "") || "";
  const toDate = parseCalendarIsoDate(customTo || "") || "";
  return { fromDate, toDate, selection: "Custom" };
}
