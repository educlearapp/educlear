import type { SasamsParsedLearner } from "../daSilvaMigration/sasamsParsers";
import {
  normLearnerFullName,
  normLearnerId,
  normLearnerPersonText,
  normLearnerRepairClass,
} from "./learnerRepairNormalization";

function importRowScore(row: SasamsParsedLearner): number {
  let score = 0;
  if (String(row.gender || "").trim()) score += 4;
  if (normLearnerId(row.idNumber).length >= 6) score += 3;
  if (normLearnerId(row.admissionNo || row.sasamsLearnerNo)) score += 2;
  if (String(row.canonicalClassName || row.className || "").trim()) score += 1;
  return score;
}

/** Dedupe key priority: SA ID → admission → normalized name + surname + class. */
export function dedupeKeyForImportedLearner(row: SasamsParsedLearner): string {
  const idn = normLearnerId(row.idNumber);
  if (idn.length >= 6) return `id:${idn}`;

  const adm = normLearnerId(row.admissionNo || row.sasamsLearnerNo);
  if (adm) return `adm:${adm}`;

  const fn = normLearnerPersonText(row.firstName);
  const ln = normLearnerPersonText(row.lastName);
  const cls = normLearnerRepairClass(
    row.canonicalClassName || row.className,
    row.grade || null
  );
  if (fn && ln && cls) return `name:${fn}|${ln}|${cls}`;

  const full = normLearnerFullName(row.firstName, row.lastName);
  if (full && cls) return `full:${full}|${cls}`;

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
