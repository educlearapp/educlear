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

export function resolveLearnerGenderForStats(learner: {
  gender?: string | null;
  Gender?: string | null;
  sex?: string | null;
  idNumber?: string | null;
  idNo?: string | null;
}): "Male" | "Female" | null {
  return (
    normalizeLearnerGender(learner.gender) ||
    normalizeLearnerGender(learner.Gender) ||
    normalizeLearnerGender(learner.sex) ||
    inferGenderFromSouthAfricanId(learner.idNumber || learner.idNo) ||
    null
  );
}

/** Client-side gender normalization (matches backend learnerGender.ts). */
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

export function isMaleGender(raw: string | null | undefined): boolean {
  return normalizeLearnerGender(raw) === "Male";
}

export function isFemaleGender(raw: string | null | undefined): boolean {
  return normalizeLearnerGender(raw) === "Female";
}

export function isMaleLearnerForStats(learner: Parameters<typeof resolveLearnerGenderForStats>[0]): boolean {
  return resolveLearnerGenderForStats(learner) === "Male";
}

export function isFemaleLearnerForStats(learner: Parameters<typeof resolveLearnerGenderForStats>[0]): boolean {
  return resolveLearnerGenderForStats(learner) === "Female";
}

export function isActiveEnrollment(learner: {
  enrollmentStatus?: string | null;
  status?: string | null;
  childStatus?: string | null;
  enrolled?: boolean | null;
  isEnrolled?: boolean | null;
}): boolean {
  if (learner.isEnrolled === true || learner.enrolled === true) return true;

  const tier = String(learner.enrollmentStatus || "").toUpperCase();
  if (tier === "HISTORICAL") return false;
  if (tier === "ACTIVE") return true;

  const status = String(learner.status || learner.childStatus || "").toLowerCase();
  if (/historical|inactive|withdrawn|unenrolled|former|archived/.test(status)) return false;
  return status === "enrolled" || status === "active";
}
