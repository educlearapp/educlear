/**
 * Source-agnostic parent/guardian column detection.
 */

export type ParentSemanticKind =
  | "parentFullName"
  | "parentFirstName"
  | "parentSurname"
  | "motherName"
  | "fatherName"
  | "guardianName"
  | "idNumber"
  | "email"
  | "cellNo"
  | "relationship"
  | "learnerId"
  | "learnerName"
  | "admissionNo"
  | "accountRef";

type Role = "generic" | "mother" | "father" | "guardian";

const RULES: Array<{ kind: ParentSemanticKind; role?: Role; patterns: RegExp[] }> = [
  {
    kind: "motherName",
    role: "mother",
    patterns: [/^mother$/i, /^mother\s*(full\s*)?name$/i, /^mom$/i, /^mother\s*full/i],
  },
  {
    kind: "fatherName",
    role: "father",
    patterns: [/^father$/i, /^father\s*(full\s*)?name$/i, /^dad$/i, /^father\s*full/i],
  },
  {
    kind: "guardianName",
    role: "guardian",
    patterns: [/^guardian$/i, /^guardian\s*(full\s*)?name$/i, /^caregiver$/i, /^responsible\s*person$/i],
  },
  {
    kind: "parentFullName",
    role: "generic",
    patterns: [/^parent$/i, /^parent\s*(full\s*)?name$/i, /^account\s*holder$/i],
  },
  {
    kind: "parentFirstName",
    patterns: [/^parent\s*first/i, /^guardian\s*first/i, /^mother\s*first/i, /^father\s*first/i],
  },
  {
    kind: "parentSurname",
    patterns: [/^parent\s*sur/i, /^guardian\s*sur/i, /^mother\s*sur/i, /^father\s*sur/i, /^surname$/i],
  },
  {
    kind: "idNumber",
    patterns: [
      /^(parent|mother|father|guardian)?\s*(sa\s*)?id(\s*number)?$/i,
      /^parent\s*id/i,
      /^id\s*number$/i,
      /^passport$/i,
      /^identity/i,
      /^sa\s*id/i,
    ],
  },
  {
    kind: "email",
    patterns: [/^(parent|mother|father|guardian)?\s*e-?mail/i, /^email$/i],
  },
  {
    kind: "cellNo",
    patterns: [
      /^(parent|mother|father|guardian)?\s*(cell|mobile|cellphone|phone)/i,
      /^cellphone$/i,
      /^mobile$/i,
      /^parent\s*cell/i,
    ],
  },
  { kind: "relationship", patterns: [/^relationship$/i, /^relation$/i] },
  { kind: "learnerId", patterns: [/^learner\s*id$/i, /^learner\s*id\s*number$/i] },
  {
    kind: "admissionNo",
    patterns: [/^admission/i, /^learner\s*number/i, /^learner\s*no/i, /^learner\s*admission/i],
  },
  { kind: "learnerName", patterns: [/^learner$/i, /^learner\s*name$/i, /^student$/i] },
  { kind: "accountRef", patterns: [/^account/i, /^family\s*account/i] },
];

export function detectParentColumnKind(header: string): ParentSemanticKind | null {
  const h = String(header || "").trim();
  if (!h) return null;
  for (const rule of RULES) {
    for (const re of rule.patterns) {
      if (re.test(h)) return rule.kind;
    }
  }
  const c = h.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (["mother", "mothername"].includes(c)) return "motherName";
  if (["father", "fathername"].includes(c)) return "fatherName";
  if (["guardian", "guardianname", "caregiver"].includes(c)) return "guardianName";
  if (["parent", "parentname", "accountholder"].includes(c)) return "parentFullName";
  if (["email", "parentemail"].includes(c)) return "email";
  if (["cell", "cellphone", "mobile", "parentcell"].includes(c)) return "cellNo";
  return null;
}

export function mapParentColumns(
  columns: string[]
): Partial<Record<ParentSemanticKind, string>> {
  const out: Partial<Record<ParentSemanticKind, string>> = {};
  for (const col of columns) {
    const kind = detectParentColumnKind(col);
    if (kind && !out[kind]) out[kind] = col;
  }
  return out;
}

export function splitPersonName(full: string): { firstName: string; surname: string } {
  const t = String(full || "").trim().replace(/\s+/g, " ");
  if (!t) return { firstName: "", surname: "" };
  const parts = t.split(" ");
  if (parts.length === 1) return { firstName: parts[0]!, surname: "" };
  return { firstName: parts[0]!, surname: parts.slice(1).join(" ") };
}
