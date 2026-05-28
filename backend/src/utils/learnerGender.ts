/**
 * Normalize learner gender for storage/API (Male / Female) and stats (isMale / isFemale).
 * Handles Kid-e-Sys, SA-SAMS, and legacy single-letter values (M, F).
 */
export function normalizeLearnerGender(
  raw: string | null | undefined
): "Male" | "Female" | null {
  const v = String(raw || "").trim();
  if (!v) return null;
  const lower = v.toLowerCase();
  if (
    lower === "m" ||
    lower === "male" ||
    lower === "boy" ||
    lower === "boys" ||
    lower === "man"
  ) {
    return "Male";
  }
  if (
    lower === "f" ||
    lower === "female" ||
    lower === "girl" ||
    lower === "girls" ||
    lower === "woman"
  ) {
    return "Female";
  }
  if (lower.startsWith("m")) return "Male";
  if (lower.startsWith("f")) return "Female";
  return null;
}

/** True when value is a 13-digit South African ID number (digits only). */
export function isValidSouthAfricanIdNumber(idNumber: string | null | undefined): boolean {
  const clean = String(idNumber || "").replace(/\D/g, "");
  return clean.length === 13;
}

/** Infer gender from SA ID sequence digits (7–10): 0000–4999 female, 5000–9999 male. */
export function inferGenderFromSouthAfricanId(
  idNumber: string | null | undefined
): "Male" | "Female" | null {
  if (!isValidSouthAfricanIdNumber(idNumber)) return null;
  const clean = String(idNumber || "").replace(/\D/g, "");
  const seq = parseInt(clean.slice(6, 10), 10);
  if (!Number.isFinite(seq)) return null;
  return seq >= 5000 ? "Male" : "Female";
}

export function resolveLearnerGender(opts: {
  gender?: string | null;
  idNumber?: string | null;
}): "Male" | "Female" | null {
  return normalizeLearnerGender(opts.gender) || inferGenderFromSouthAfricanId(opts.idNumber);
}

export function isMaleGender(raw: string | null | undefined): boolean {
  return normalizeLearnerGender(raw) === "Male";
}

export function isFemaleGender(raw: string | null | undefined): boolean {
  return normalizeLearnerGender(raw) === "Female";
}
