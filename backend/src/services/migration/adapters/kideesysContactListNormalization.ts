import type {
  MigrationParseIssue,
  ParsedMigrationLearnerTable,
} from "../../../utils/migrationLearnerFileParser";
import { parseClassTitle } from "../../../utils/kideesysSpreadsheet";
import { isKidESysClassListTitleCell } from "./kideesysLearnerClassListNormalization";

const CONTACT_LIST_PHONE_FIELDS = ["Cell No", "Work No", "Home No"] as const;

/**
 * Kid-e-Sys contact exports sometimes use capital O instead of leading 0 on mobiles.
 * Only the first character is corrected when the value is O + digits only.
 */
export function correctKidESysContactListLeadingOPhone(raw: string): {
  value: string;
  corrected: boolean;
  from?: string;
  to?: string;
} {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return { value: trimmed, corrected: false };
  const m = trimmed.match(/^O(\d+)$/);
  if (!m) return { value: trimmed, corrected: false };
  const to = `0${m[1]}`;
  return { value: to, corrected: true, from: trimmed, to };
}

function applyContactListPhoneCorrection(
  raw: string,
  field: (typeof CONTACT_LIST_PHONE_FIELDS)[number],
  rowNumber: number,
  state: {
    first: { from: string; to: string; field: string; rowNumber: number } | null;
    count: number;
  }
): string {
  const result = correctKidESysContactListLeadingOPhone(raw);
  if (!result.corrected || !result.from || !result.to) return result.value;
  state.count += 1;
  if (!state.first) {
    state.first = { from: result.from, to: result.to, field, rowNumber };
  }
  return result.value;
}

const CONTACT_LIST_HEADERS = [
  "Learner Name",
  "Classroom",
  "Relationship",
  "Parent Name",
  "Cell No",
  "Work No",
  "Home No",
  "Email",
] as const;

function rowText(row: string[], index: number): string {
  return String(row[index] ?? "").trim();
}

function filenameHaystack(filename: string): string {
  const leaf = String(filename || "")
    .trim()
    .split(/[/\\]/)
    .pop();
  const base = String(leaf || "").replace(/\.[^.]+$/i, "");
  return `${base}${filename}`.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function isKidESysEmployeeContactExport(filename: string): boolean {
  return filenameHaystack(filename).includes("employee");
}

export function isKidESysContactListExportFilename(filename: string): boolean {
  const haystack = filenameHaystack(filename);
  return haystack.includes("contactlist") && !haystack.includes("employee");
}

type ParsedParentHeader = {
  relationship: string;
  parentName: string;
};

function parseParentHeaderCell(value: string): ParsedParentHeader | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const m = raw.match(/^(Father|Mother|Guardian|Step\s*Father|Step\s*Mother)\s*-\s*(.+)$/i);
  if (!m) return null;
  return {
    relationship: m[1].trim(),
    parentName: m[2].trim(),
  };
}

function looksLikeLearnerName(value: string): boolean {
  const v = String(value || "").trim();
  if (v.length < 2) return false;
  if (/^(cell|work|home)\s*no$/i.test(v)) return false;
  if (/^(father|mother|guardian)\b/i.test(v)) return false;
  if (/^\d+(\.\d+)?$/.test(v)) return false;
  return /[a-z]/i.test(v);
}

function findLabelColumn(row: string[], label: string): number | null {
  for (let i = 0; i < row.length; i++) {
    if (rowText(row, i) === label) return i;
  }
  return null;
}

function parentHeaderColumns(row: string[]): number[] {
  const cols: number[] = [];
  for (let i = 0; i < row.length; i++) {
    if (parseParentHeaderCell(rowText(row, i))) cols.push(i);
  }
  return cols;
}

function phoneValueColumns(row: string[], labelCol: number): number[] {
  const cols: number[] = [];
  for (let i = labelCol + 1; i < row.length; i++) {
    const v = rowText(row, i);
    if (v) cols.push(i);
  }
  return cols;
}

function detailValueColumns(row: string[], labelCol: number, phoneCols: number[]): number[] {
  const fromLabel = phoneValueColumns(row, labelCol);
  if (fromLabel.length >= phoneCols.length) return fromLabel.slice(0, phoneCols.length);

  const fromSparse: number[] = [];
  for (const col of phoneCols) {
    const v = rowText(row, col);
    if (v) fromSparse.push(col);
  }
  if (fromSparse.length > 0) return fromSparse;

  return fromLabel;
}

function countContactListBlocks(matrix: string[][]): number {
  let count = 0;
  for (const row of matrix) {
    const labelCol = findLabelColumn(row, "Cell No");
    if (labelCol === null) continue;
    const learnerCol = labelCol > 0 ? labelCol - 1 : 0;
    const learnerName = rowText(row, learnerCol);
    if (!looksLikeLearnerName(learnerName)) continue;
    count += 1;
  }
  return count;
}

/** Kid-e-Sys contact_list.xls uses class title rows and parent blocks, not a flat header row. */
export function isKidESysContactListLayout(matrix: string[][]): boolean {
  if (!matrix.length) return false;
  return countContactListBlocks(matrix) >= 1;
}

function resolveClassroomByRow(matrix: string[][]): string[] {
  let className = "";
  return matrix.map((row) => {
    const c0 = rowText(row, 0);
    if (isKidESysClassListTitleCell(c0)) {
      className = parseClassTitle(c0).className || c0;
    }
    return className;
  });
}

type ContactParent = ParsedParentHeader & {
  cellNo: string;
  workNo: string;
  homeNo: string;
  email: string;
};

/**
 * Flatten Kid-e-Sys contact_list report blocks into tabular preview rows (one row per parent).
 */
export function normalizeKidESysContactListSheet(
  matrix: string[][],
  fileName: string
): ParsedMigrationLearnerTable | null {
  if (!matrix.length) return null;
  if (isKidESysEmployeeContactExport(fileName)) return null;
  if (!isKidESysContactListLayout(matrix)) return null;

  const classByRow = resolveClassroomByRow(matrix);
  const rows: Record<string, string>[] = [];
  const phoneCorrectionState: {
    first: { from: string; to: string; field: string; rowNumber: number } | null;
    count: number;
  } = { first: null, count: 0 };
  let dataRowNumber = 0;

  for (let i = 0; i < matrix.length; i++) {
    const row = matrix[i];
    const cellLabelCol = findLabelColumn(row, "Cell No");
    if (cellLabelCol === null) continue;

    const learnerCol = cellLabelCol > 0 ? cellLabelCol - 1 : 0;
    const learnerName = rowText(row, learnerCol);
    if (!looksLikeLearnerName(learnerName)) continue;

    const classroom = classByRow[i];
    if (!classroom) continue;

    const phoneCols = phoneValueColumns(row, cellLabelCol);
    const parents: ContactParent[] = [];

    for (let j = i - 1; j >= Math.max(0, i - 8); j--) {
      const headerCols = parentHeaderColumns(matrix[j] || []);
      if (headerCols.length === 0) continue;
      for (const col of headerCols) {
        const parsed = parseParentHeaderCell(rowText(matrix[j], col));
        if (parsed) {
          parents.push({ ...parsed, cellNo: "", workNo: "", homeNo: "", email: "" });
        }
      }
      break;
    }

    for (let p = 0; p < parents.length && p < phoneCols.length; p++) {
      parents[p].cellNo = applyContactListPhoneCorrection(
        rowText(row, phoneCols[p]),
        "Cell No",
        dataRowNumber + 1,
        phoneCorrectionState
      );
    }

    for (let j = i + 1; j < Math.min(matrix.length, i + 6); j++) {
      const next = matrix[j];
      for (const label of ["Work No", "Home No", "Email"] as const) {
        const labelCol = findLabelColumn(next, label);
        if (labelCol === null) continue;
        const valueCols = detailValueColumns(next, labelCol, phoneCols);
        for (let p = 0; p < parents.length && p < valueCols.length; p++) {
          const value = rowText(next, valueCols[p]);
          if (label === "Work No") {
            parents[p].workNo = applyContactListPhoneCorrection(
              value,
              "Work No",
              dataRowNumber + 1,
              phoneCorrectionState
            );
          }
          if (label === "Home No") {
            parents[p].homeNo = applyContactListPhoneCorrection(
              value,
              "Home No",
              dataRowNumber + 1,
              phoneCorrectionState
            );
          }
          if (label === "Email") parents[p].email = value;
        }
      }
    }

    for (const parent of parents) {
      if (!parent.parentName && !parent.cellNo && !parent.email) continue;
      dataRowNumber += 1;
      rows.push({
        "Learner Name": learnerName,
        Classroom: classroom,
        Relationship: parent.relationship,
        "Parent Name": parent.parentName,
        "Cell No": parent.cellNo,
        "Work No": parent.workNo,
        "Home No": parent.homeNo,
        Email: parent.email,
      });
    }
  }

  if (rows.length === 0) return null;

  const parseIssues: MigrationParseIssue[] = [];
  if (phoneCorrectionState.first) {
    const { from, to, field, rowNumber } = phoneCorrectionState.first;
    const extra =
      phoneCorrectionState.count > 1
        ? ` (${phoneCorrectionState.count - 1} other contact-list phone(s) also corrected).`
        : "";
    parseIssues.push({
      severity: "info",
      field: "parentPhone",
      rowNumber,
      message: `Phone was auto-corrected from ${from} to ${to} (${field} on Kid-e-Sys contact list).${extra}`,
    });
  }

  return {
    headers: [...CONTACT_LIST_HEADERS],
    rows,
    fileName,
    parseIssues: parseIssues.length > 0 ? parseIssues : undefined,
  };
}
