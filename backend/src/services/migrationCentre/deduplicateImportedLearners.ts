import { normalizeMatchText } from "../../utils/kideesysSpreadsheet";
import { normalizeClassroomInput } from "../../utils/classroomNormalization";
import type { SasamsParsedLearner } from "../daSilvaMigration/sasamsParsers";

function normId(value: string | null | undefined): string {
  return String(value || "")
    .replace(/\D/g, "")
    .trim();
}

function normClass(value: string | null | undefined): string {
  const norm = normalizeClassroomInput(String(value || ""));
  return norm.matchKey || normalizeMatchText(String(value || ""));
}

function importRowScore(row: SasamsParsedLearner): number {
  let score = 0;
  if (String(row.gender || "").trim()) score += 4;
  if (normId(row.idNumber).length >= 6) score += 3;
  if (normId(row.admissionNo || row.sasamsLearnerNo)) score += 2;
  if (String(row.canonicalClassName || row.className || "").trim()) score += 1;
  return score;
}

/** Dedupe key priority: SA ID → admission → normalized name + surname + class. */
export function dedupeKeyForImportedLearner(row: SasamsParsedLearner): string {
  const idn = normId(row.idNumber);
  if (idn.length >= 6) return `id:${idn}`;

  const adm = normId(row.admissionNo || row.sasamsLearnerNo);
  if (adm) return `adm:${adm}`;

  const fn = normalizeMatchText(row.firstName);
  const ln = normalizeMatchText(row.lastName);
  const cls = normClass(row.canonicalClassName || row.className);
  if (fn && ln && cls) return `name:${fn}|${ln}|${cls}`;

  return `mk:${row.matchKey}`;
}

/** Combine class lists; keep the richest row per dedupe key. */
export function deduplicateImportedLearners(rows: SasamsParsedLearner[]): SasamsParsedLearner[] {
  const byKey = new Map<string, SasamsParsedLearner>();

  for (const row of rows) {
    const key = dedupeKeyForImportedLearner(row);
    const existing = byKey.get(key);
    if (!existing || importRowScore(row) > importRowScore(existing)) {
      byKey.set(key, row);
    }
  }

  return [...byKey.values()];
}
