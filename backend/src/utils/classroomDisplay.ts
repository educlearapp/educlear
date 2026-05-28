/** Canonical classroom labels for API responses (display only). */
export function formatClassroomLabel(raw: string | null | undefined): string {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (/^pre-?\s*school\s+creche$/i.test(value)) return "Creche";
  if (/^creche$/i.test(value)) return "Creche";
  return value;
}

export function resolveLearnerClassroomLabel(learner: {
  className?: string | null;
  grade?: string | null;
}): string {
  const raw = String(learner.className || learner.grade || "").trim();
  return formatClassroomLabel(raw);
}
