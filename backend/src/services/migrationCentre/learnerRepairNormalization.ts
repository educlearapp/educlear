import { normalizeClassroomInput } from "../../utils/classroomNormalization";

/** Person-name normalization for learner repair matching. */
export function normLearnerPersonText(value: string): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[''`´]/g, "")
    .replace(/[-–—]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[.,;:!?]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .trim();
}

/** Collapse spaces — Jordan-Leigh → jordanleigh. */
export function normLearnerCompactName(value: string): string {
  return normLearnerPersonText(value).replace(/\s+/g, "");
}

export function normLearnerSurname(value: string): string {
  return normLearnerPersonText(value)
    .replace(/\b(van|der|de|du|le|da|den|di)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normLearnerFullName(firstName: string, lastName: string): string {
  return normLearnerPersonText(`${firstName} ${lastName}`.trim());
}

export function normLearnerFullNameFromString(fullName: string): string {
  return normLearnerPersonText(fullName);
}

/** Preprocess SASAMS class labels before classroom normalization. */
export function preprocessLearnerRepairClassName(raw: string): string {
  let t = String(raw || "")
    .trim()
    .replace(/\s+/g, " ");
  if (!t) return t;

  const dup4 = t.match(/^(\d{2})\1$/);
  if (dup4) return `Grade ${parseInt(dup4[1], 10)}`;

  t = t.replace(/^grade\s+0+(\d)/i, "Grade $1");

  const repeatGradeDigits = t.match(/^grade\s*0*(\d{1,2})0+\1\s*$/i);
  if (repeatGradeDigits) return `Grade ${parseInt(repeatGradeDigits[1], 10)}`;

  const glued = t.match(/^grade\s*0*(\d{1,2})0*([a-z])\s*$/i);
  if (glued) return `Grade ${parseInt(glued[1], 10)}${glued[2].toUpperCase()}`;

  return t;
}

export function normLearnerRepairClass(
  value: string | null | undefined,
  gradeHint?: string | null
): string {
  const preprocessed = preprocessLearnerRepairClassName(String(value || ""));
  const norm = normalizeClassroomInput(preprocessed, gradeHint || undefined);
  return norm.matchKey || normLearnerPersonText(preprocessed);
}

export function normLearnerId(value: string | null | undefined): string {
  return String(value || "")
    .replace(/\D/g, "")
    .trim();
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);

  for (let j = 0; j <= b.length; j += 1) prev[j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j];
  }

  return prev[b.length];
}

/** Similarity in [0, 1] on compact normalized names. */
export function learnerNameSimilarityRatio(a: string, b: string): number {
  const x = normLearnerCompactName(a);
  const y = normLearnerCompactName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const maxLen = Math.max(x.length, y.length);
  if (!maxLen) return 1;
  return 1 - levenshteinDistance(x, y) / maxLen;
}

export const LEARNER_REPAIR_FUZZY_MIN_RATIO = 0.9;

export function firstNamesCompatible(importFirst: string, dbFirst: string): boolean {
  const a = normLearnerCompactName(importFirst);
  const b = normLearnerCompactName(dbFirst);
  if (!a || !b) return false;
  if (a === b) return true;
  return a.startsWith(b) || b.startsWith(a);
}

export function surnamesCompatible(importSurname: string, dbSurname: string): boolean {
  const a = normLearnerSurname(importSurname);
  const b = normLearnerSurname(dbSurname);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) >= 4;
  const aTokens = a.split(/\s+/);
  const bTokens = b.split(/\s+/);
  if (aTokens.some((t) => bTokens.includes(t) && t.length >= 4)) return true;
  return false;
}
