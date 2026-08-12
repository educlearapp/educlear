/**
 * Semantic academic field detection — source-agnostic column synonyms.
 */

export type AcademicSemanticKind =
  | "grade"
  | "classroom"
  | "group"
  | "subject"
  | "subjectCode"
  | "teacherName"
  | "teacherEmail"
  | "academicYear"
  | "learnerId"
  | "learnerName"
  | "admissionNo";

const RULES: Array<{ kind: AcademicSemanticKind; patterns: RegExp[] }> = [
  {
    kind: "grade",
    patterns: [
      /^grade$/i,
      /^grade\s*(level|name|code)?$/i,
      /^year\s*group$/i,
      /^year$/i,
      /^form$/i,
      /^gr$/i,
      /^grade_name$/i,
    ],
  },
  {
    kind: "classroom",
    patterns: [
      /^class$/i,
      /^class\s*name$/i,
      /^classroom$/i,
      /^register(\s*class)?$/i,
      /^homeroom$/i,
      /^form\s*class$/i,
      /^register$/i,
      /^section$/i,
      /^stream$/i,
      /^class_?code$/i,
    ],
  },
  {
    kind: "group",
    patterns: [
      /^group$/i,
      /^group\s*name$/i,
      /^academic\s*group$/i,
      /^intervention\s*group$/i,
      /^activity\s*group$/i,
    ],
  },
  {
    kind: "subject",
    patterns: [
      /^subject$/i,
      /^subject\s*name$/i,
      /^course$/i,
      /^course\s*name$/i,
      /^learning\s*area$/i,
      /^subjects?$/i,
    ],
  },
  {
    kind: "subjectCode",
    patterns: [/^subject\s*code$/i, /^course\s*code$/i],
  },
  {
    kind: "teacherName",
    patterns: [
      /^teacher$/i,
      /^educator$/i,
      /^class\s*teacher$/i,
      /^tutor$/i,
      /^teacher\s*name$/i,
    ],
  },
  {
    kind: "teacherEmail",
    patterns: [/^teacher\s*email$/i, /^educator\s*email$/i],
  },
  {
    kind: "academicYear",
    patterns: [
      /^academic\s*year$/i,
      /^school\s*year$/i,
      /^year\s*(20\d{2})?$/i,
      /^enrol(l)?ment\s*year$/i,
    ],
  },
  {
    kind: "learnerId",
    patterns: [/^id\s*number$/i, /^learner\s*id$/i, /^sa\s*id$/i, /^idnumber$/i],
  },
  {
    kind: "admissionNo",
    patterns: [/^admission/i, /^learner\s*number$/i, /^learner\s*no/i],
  },
  {
    kind: "learnerName",
    patterns: [/^learner$/i, /^learner\s*name$/i, /^full\s*name$/i, /^name$/i, /^student$/i],
  },
];

export function detectAcademicColumnKind(header: string): AcademicSemanticKind | null {
  const h = String(header || "").trim();
  if (!h) return null;
  for (const rule of RULES) {
    for (const re of rule.patterns) {
      if (re.test(h)) return rule.kind;
    }
  }
  const compact = h.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (["grade", "gradename", "gradelevel", "yeargroup"].includes(compact)) return "grade";
  if (["class", "classname", "classroom", "registerclass", "homeroom", "formclass"].includes(compact))
    return "classroom";
  if (["subject", "subjectname", "coursename", "learningarea"].includes(compact)) return "subject";
  if (["group", "groupname"].includes(compact)) return "group";
  if (["academicyear", "schoolyear"].includes(compact)) return "academicYear";
  return null;
}

export function mapAcademicColumns(
  columns: string[]
): Partial<Record<AcademicSemanticKind, string>> {
  const out: Partial<Record<AcademicSemanticKind, string>> = {};
  for (const col of columns) {
    const kind = detectAcademicColumnKind(col);
    if (kind && !out[kind]) out[kind] = col;
  }
  return out;
}
