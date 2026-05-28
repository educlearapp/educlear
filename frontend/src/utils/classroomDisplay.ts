/** Canonical classroom labels for registration/profile UI. */
export function formatClassroomLabel(raw: string | null | undefined): string {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (/^pre-?\s*school\s+creche$/i.test(value)) return "Creche";
  if (/^creche$/i.test(value)) return "Creche";
  return value;
}

export function resolveLearnerClassroomLabel(learner: {
  className?: string | null;
  classroomName?: string | null;
  classroom?: string | { name?: string } | null;
  grade?: string | null;
} | null | undefined): string {
  if (!learner) return "";
  const classroomField = learner.classroom;
  const classroomString =
    typeof classroomField === "string"
      ? classroomField.trim()
      : typeof classroomField === "object" && classroomField
        ? String(classroomField.name || "").trim()
        : "";
  const raw = String(
    learner.className || learner.classroomName || classroomString || learner.grade || ""
  ).trim();
  return formatClassroomLabel(raw);
}
