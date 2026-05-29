import { normalizeClassroomInput } from "../../utils/classroomNormalization";
import { normalizeMatchText } from "../../utils/kideesysSpreadsheet";
import { pickLearnerGenderForWrite } from "../../utils/learnerGender";

function digitsOnly(value: string | null | undefined): string {
  return String(value || "")
    .replace(/\D/g, "")
    .trim();
}

/** Write SA ID only when live learner has none and import has a valid ID. */
export function pickIdNumberForWrite(
  existing: string | null | undefined,
  imported: string | null | undefined
): string | undefined {
  if (String(existing ?? "").trim()) return undefined;
  const inc = String(imported ?? "").trim();
  if (digitsOnly(inc).length < 6) return undefined;
  return inc;
}

/** Write class when blank, or when normalized keys differ (import is trusted class-list source). */
export function pickClassNameForWrite(
  existing: string | null | undefined,
  imported: string | null | undefined,
  grade?: string | null
): string | undefined {
  const importedRaw = String(
    imported || ""
  ).trim();
  if (!importedRaw) return undefined;

  const incNorm = normalizeClassroomInput(importedRaw, grade ?? undefined);
  const importedName = incNorm.classroomName || importedRaw;
  if (!importedName) return undefined;

  const cur = String(existing ?? "").trim();
  if (!cur) return importedName;

  const existNorm = normalizeClassroomInput(cur, grade ?? undefined);
  const existKey = existNorm.matchKey || normalizeMatchText(cur);
  const incKey = incNorm.matchKey || normalizeMatchText(importedName);
  if (existKey && incKey && existKey !== incKey) return importedName;

  return undefined;
}

export type LearnerRepairWritePatch = {
  gender?: "Male" | "Female";
  idNumber?: string;
  className?: string;
};

export function buildLearnerRepairWritePatch(opts: {
  existingGender: string | null | undefined;
  existingIdNumber: string | null | undefined;
  existingClassName: string | null | undefined;
  grade?: string | null;
  importedGender: string | null | undefined;
  importedIdNumber: string | null | undefined;
  importedClassName: string | null | undefined;
}): LearnerRepairWritePatch {
  const patch: LearnerRepairWritePatch = {};

  const gender = pickLearnerGenderForWrite({
    existingGender: opts.existingGender,
    gender: opts.importedGender,
    idNumber: opts.importedIdNumber ?? opts.existingIdNumber,
  });
  if (gender) patch.gender = gender;

  const idNumber = pickIdNumberForWrite(opts.existingIdNumber, opts.importedIdNumber);
  if (idNumber) patch.idNumber = idNumber;

  const className = pickClassNameForWrite(
    opts.existingClassName,
    opts.importedClassName,
    opts.grade
  );
  if (className) patch.className = className;

  return patch;
}

export function learnerRepairPatchHasChanges(patch: LearnerRepairWritePatch): boolean {
  return Boolean(patch.gender || patch.idNumber || patch.className);
}

export function describeLearnerRepairAction(opts: {
  ambiguous: boolean;
  matched: boolean;
  patch: LearnerRepairWritePatch;
}): string {
  if (opts.ambiguous) return "Skip — ambiguous";
  if (!opts.matched) return "Skip — no match";
  if (!learnerRepairPatchHasChanges(opts.patch)) return "Skip — no change";

  const parts: string[] = [];
  if (opts.patch.gender) parts.push("gender");
  if (opts.patch.idNumber) parts.push("ID number");
  if (opts.patch.className) parts.push("class");
  return `Update ${parts.join(", ")}`;
}
