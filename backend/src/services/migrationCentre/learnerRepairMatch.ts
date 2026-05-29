import { normalizeClassroomInput } from "../../utils/classroomNormalization";
import { normalizeMatchText } from "../../utils/kideesysSpreadsheet";
import {
  buildLearnerMatchIndexes,
  type DbLearnerForParentMatch,
} from "../daSilvaMigration/daSilvaParentLearnerMatching";
import type { SasamsParsedLearner } from "../daSilvaMigration/sasamsParsers";

export type LearnerRepairMatchResult = {
  learnerId: string | null;
  strategy: string | null;
  ambiguous: boolean;
};

function normId(value: string | null | undefined): string {
  return String(value || "")
    .replace(/\D/g, "")
    .trim();
}

function normClass(value: string | null | undefined): string {
  const norm = normalizeClassroomInput(String(value || ""));
  return norm.matchKey || normalizeMatchText(String(value || ""));
}

function pickUnique(candidates: string[]): { id: string | null; ambiguous: boolean } {
  const unique = [...new Set(candidates)];
  if (unique.length === 1) return { id: unique[0], ambiguous: false };
  if (unique.length === 0) return { id: null, ambiguous: false };
  return { id: null, ambiguous: true };
}

/** Match priority: 1 ID number, 2 admission number, 3 name + surname, 4 classroom. */
export function matchImportedLearnerToLive(
  imported: SasamsParsedLearner,
  indexes: ReturnType<typeof buildLearnerMatchIndexes>
): LearnerRepairMatchResult {
  const tryPick = (
    ids: string[],
    strategy: string
  ): LearnerRepairMatchResult | null => {
    const hit = pickUnique(ids);
    if (hit.id || hit.ambiguous) {
      return { learnerId: hit.id, strategy, ambiguous: hit.ambiguous };
    }
    return null;
  };

  const idn = normId(imported.idNumber);
  if (idn.length >= 6) {
    const hit = tryPick(indexes.byIdNumber.get(idn) || [], "id_number");
    if (hit) return hit;
  }

  const adm = normId(imported.admissionNo || imported.sasamsLearnerNo);
  if (adm) {
    const hit = tryPick(indexes.byAdmission.get(adm) || [], "admission_number");
    if (hit) return hit;
  }

  const fn = normalizeMatchText(imported.firstName);
  const ln = normalizeMatchText(imported.lastName);
  if (fn && ln) {
    const nameKey = `${ln}|${fn}`;
    const hit = tryPick(indexes.byNameOnly.get(nameKey) || [], "name_surname");
    if (hit) return hit;
  }

  const cls = normClass(imported.canonicalClassName || imported.className);
  if (fn && ln && cls) {
    const classKey = `${fn}|${ln}|${cls}`;
    const hit = tryPick(indexes.byNameClass.get(classKey) || [], "name_surname_classroom");
    if (hit) return hit;
    const altKey = `${normalizeMatchText(imported.firstName)}|${normalizeMatchText(imported.lastName)}|${cls}`;
    const altHit = tryPick(indexes.byNameClass.get(altKey) || [], "name_surname_classroom");
    if (altHit) return altHit;
  }

  return { learnerId: null, strategy: null, ambiguous: false };
}

export function buildLearnerRepairIndexes(learners: DbLearnerForParentMatch[]) {
  return buildLearnerMatchIndexes(learners);
}
