import * as XLSX from "xlsx";
import {
  buildOutstandingFeesFileName,
  rowClassLabels,
  type OutstandingClassGroup,
  type OutstandingClassRow,
  type OutstandingClassView,
} from "./outstandingFeesByClass";

export type OutstandingFeesExportRow = OutstandingClassRow & {
  learnerNames: string[];
  accountNumber: string;
  parentGuardianName: string | null;
  daysOverdue: number | null;
};

export type OutstandingFeesExportMeta = {
  schoolName: string;
  generatedAt: Date;
  /** Human-readable description of active search/grade/balance/overdue filters, if any. */
  filtersNote?: string;
};

type Cell = string | number | null;

const MONEY_FORMAT = '"R" #,##0.00';
const DETAIL_HEADER = ["Class", "Learner(s)", "Account No", "Parent / Guardian", "Days Overdue", "Outstanding"];
const MONEY_COL_DETAIL = 5;

const INVALID_SHEET_CHARS = /[\\/?*[\]:]/g;

/** Excel-safe, unique (case-insensitive) sheet name: ≤31 chars, no \ / ? * [ ] :, no edge apostrophes. */
export function safeSheetName(raw: string, used: Set<string>): string {
  let base = String(raw || "")
    .replace(INVALID_SHEET_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^'+|'+$/g, "")
    .trim();
  if (!base) base = "Sheet";
  if (base.toLowerCase() === "history") base = `${base} (class)`;
  base = base.slice(0, 31).trim();
  let name = base;
  let n = 2;
  while (used.has(name.toLowerCase())) {
    const suffix = ` (${n})`;
    name = `${base.slice(0, 31 - suffix.length).trim()}${suffix}`;
    n += 1;
  }
  used.add(name.toLowerCase());
  return name;
}

function generatedLabel(date: Date): string {
  return date.toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" });
}

function metaRows(meta: OutstandingFeesExportMeta, classLabel: string): Cell[][] {
  const rows: Cell[][] = [
    ["EduClear"],
    ["School", meta.schoolName || "School"],
    ["Report", "Outstanding Fees Report"],
    ["Class", classLabel],
    ["Generated", generatedLabel(meta.generatedAt)],
  ];
  if (meta.filtersNote) rows.push(["Filters", meta.filtersNote]);
  rows.push([]);
  return rows;
}

function classCell(row: OutstandingFeesExportRow, group: OutstandingClassGroup<OutstandingFeesExportRow> | null): string {
  const labels = rowClassLabels(row);
  if (group && group.kind === "class") return group.label;
  return labels.length ? labels.join(", ") : group ? group.label : "";
}

function detailRow(row: OutstandingFeesExportRow, group: OutstandingClassGroup<OutstandingFeesExportRow> | null): Cell[] {
  return [
    classCell(row, group),
    (row.learnerNames || []).filter(Boolean).join(", "),
    row.accountNumber || "",
    row.parentGuardianName || "",
    row.daysOverdue != null && Number.isFinite(row.daysOverdue) ? row.daysOverdue : "Unknown",
    Math.round((Number(row.outstandingBalance) || 0) * 100) / 100,
  ];
}

function groupDetailRows(group: OutstandingClassGroup<OutstandingFeesExportRow>): Cell[][] {
  return [
    [`Class: ${group.label}`],
    [...DETAIL_HEADER],
    ...group.rows.map((row) => detailRow(row, group)),
    [
      "Class Total",
      `${group.outstandingAccountCount} account(s) · ${group.learnersAffected} learner(s)`,
      "",
      "",
      "",
      group.totalOutstanding,
    ],
  ];
}

function sharedRowsBlock(view: OutstandingClassView<OutstandingFeesExportRow>): Cell[][] {
  if (!view.sharedRows.length) return [];
  return [
    [],
    ["Also linked to this class (shared family accounts)"],
    [
      "These accounts have learners in more than one class. Their balances are counted once under " +
        "\"Multiple classes\" and are NOT included in the Class Total above.",
    ],
    [...DETAIL_HEADER],
    ...view.sharedRows.map((row) => detailRow(row, null)),
    ["Shared (not in Class Total)", `${view.sharedTotals.outstandingAccountCount} account(s)`, "", "", "", view.sharedTotals.totalOutstanding],
  ];
}

function buildSheet(rows: Cell[][], moneyCols: Set<number>, firstMoneyRow: number): XLSX.WorkSheet {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  for (let r = firstMoneyRow; r < rows.length; r++) {
    for (const c of moneyCols) {
      const ref = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[ref];
      if (cell && cell.t === "n") cell.z = MONEY_FORMAT;
    }
  }
  sheet["!cols"] = [{ wch: 30 }, { wch: 44 }, { wch: 22 }, { wch: 36 }, { wch: 13 }, { wch: 16 }];
  return sheet;
}

export function buildOutstandingFeesWorkbook(
  view: OutstandingClassView<OutstandingFeesExportRow>,
  meta: OutstandingFeesExportMeta
): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  const used = new Set<string>();
  const head = metaRows(meta, view.selectionLabel);

  if (view.isAllClasses) {
    const summary: Cell[][] = [
      ...head,
      ["Class", "Accounts", "Learners", "Outstanding Total"],
      ...view.groups.map((g) => [g.label, g.outstandingAccountCount, g.learnersAffected, g.totalOutstanding]),
      [],
      ["Grand Total", view.totals.outstandingAccountCount, view.totals.learnersAffected, view.totals.totalOutstanding],
    ];
    XLSX.utils.book_append_sheet(workbook, buildSheet(summary, new Set([3]), head.length), safeSheetName("Summary", used));
    for (const group of view.groups) {
      const groupHead = metaRows(meta, group.label);
      const rows = [...groupHead, ...groupDetailRows(group)];
      XLSX.utils.book_append_sheet(
        workbook,
        buildSheet(rows, new Set([MONEY_COL_DETAIL]), groupHead.length),
        safeSheetName(group.label, used)
      );
    }
    return workbook;
  }

  const group = view.groups[0];
  const rows: Cell[][] = [...head, ...groupDetailRows(group), ...sharedRowsBlock(view)];
  XLSX.utils.book_append_sheet(
    workbook,
    buildSheet(rows, new Set([MONEY_COL_DETAIL]), head.length),
    safeSheetName(group.label, used)
  );
  return workbook;
}

export function downloadOutstandingFeesExcel(
  view: OutstandingClassView<OutstandingFeesExportRow>,
  meta: OutstandingFeesExportMeta
): string {
  const workbook = buildOutstandingFeesWorkbook(view, meta);
  const filename = buildOutstandingFeesFileName({
    schoolName: meta.schoolName,
    selectionLabel: view.selectionLabel,
    date: meta.generatedAt,
    extension: "xlsx",
  });
  const array = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  const blob = new Blob([array], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
  return filename;
}
