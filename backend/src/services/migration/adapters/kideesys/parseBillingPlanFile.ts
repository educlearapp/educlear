import {
  isNumericIndexCell,
  learnerMatchKey,
  normalizeMatchText,
  parseAmount,
  parseClassTitle,
  parseKideesysSpreadsheetFile,
} from "../../../../utils/kideesysSpreadsheet";
import { normalizeClassroomInput } from "../../../../utils/classroomNormalization";

export type ParsedBillingPlanItem = {
  fullName: string;
  className: string;
  matchKey: string;
  feeDescription: string;
  amount: number;
};

function rowText(row: string[], index: number): string {
  return String(row[index] ?? "").trim();
}

function canonicalClassMatchKey(className: string): string {
  const norm = normalizeClassroomInput(className);
  return norm.matchKey || normalizeMatchText(className);
}

function buildLearnerMatchKey(fullName: string, className: string): string {
  return `${normalizeMatchText(fullName)}|${canonicalClassMatchKey(className)}`;
}

function isClassSectionTitle(value: string): boolean {
  const v = String(value || "").trim().replace(/\s+/g, " ");
  if (!v) return false;
  if (/total$/i.test(v)) return false;
  if (/^\d+(\.\d+)?$/.test(v)) return false;
  if (/^creche(\s+20\d{2})?$/i.test(v)) return true;
  const withoutYear = v.replace(/\s+20\d{2}\s*$/i, "").trim();
  if (/^grade\s+\d{1,2}$/i.test(withoutYear)) return false;
  return /^grade\b/i.test(withoutYear);
}

export function parseBillingPlanFile(filePath: string): ParsedBillingPlanItem[] {
  const sheet = parseKideesysSpreadsheetFile(filePath);
  let className = "";
  let lastLearnerName = "";
  const items: ParsedBillingPlanItem[] = [];

  const pushItem = (fullName: string, feeDescription: string, amount: number) => {
    if (!fullName || !className || !amount) return;
    items.push({
      fullName,
      className,
      matchKey: buildLearnerMatchKey(fullName, className),
      feeDescription,
      amount,
    });
  };

  for (const row of sheet.rows) {
    const c0 = rowText(row, 0);
    const c1 = rowText(row, 1);
    const c2 = rowText(row, 2);
    const c3 = rowText(row, 3);

    if (isClassSectionTitle(c0)) {
      className = parseClassTitle(c0).className;
      lastLearnerName = "";
      continue;
    }
    if (!className) continue;

    if (isNumericIndexCell(c0) && c1) {
      if (/total$/i.test(c1)) continue;
      lastLearnerName = c1;
      const amount = parseAmount(c3);
      if (c2 && amount) pushItem(c1, c2, amount);
      continue;
    }

    if (lastLearnerName && c1 && parseAmount(c2)) {
      pushItem(lastLearnerName, c1, parseAmount(c2));
      continue;
    }

    if (lastLearnerName && c2 && parseAmount(c3)) {
      pushItem(lastLearnerName, c2, parseAmount(c3));
    }
  }

  return items.filter((item) => learnerMatchKey(item.fullName, item.className));
}
