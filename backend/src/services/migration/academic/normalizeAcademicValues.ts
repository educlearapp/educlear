/**
 * Safe grade + subject normalization (evidence-based; no blind merges).
 */

export type GradeNormalizeResult = {
  proposedLabel: string;
  normalizeKey: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  matchState: "AUTO_MATCH" | "REVIEW_REQUIRED" | "UNRESOLVED";
  warnings: string[];
};

const WORD_NUM: Record<string, string> = {
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  ten: "10",
  eleven: "11",
  twelve: "12",
};

export function normalizeGradeLabel(raw: string): GradeNormalizeResult {
  const warnings: string[] = [];
  const t = String(raw || "").trim().replace(/\s+/g, " ");
  if (!t) {
    return {
      proposedLabel: "",
      normalizeKey: "",
      confidence: "LOW",
      matchState: "UNRESOLVED",
      warnings: ["Empty grade"],
    };
  }

  const lower = t.toLowerCase();

  // Ambiguous reception variants
  if (/^(rr|r\/r|grade\s*rr)$/i.test(t)) {
    return {
      proposedLabel: t,
      normalizeKey: "rr",
      confidence: "LOW",
      matchState: "REVIEW_REQUIRED",
      warnings: ["R vs RR is ambiguous — confirm Grade R mapping."],
    };
  }
  if (/^(grade\s*)?0$/i.test(t) || /^gr\s*0$/i.test(t)) {
    return {
      proposedLabel: t,
      normalizeKey: "grade0",
      confidence: "LOW",
      matchState: "REVIEW_REQUIRED",
      warnings: ["Grade 0 vs Grade R cannot be proven equivalent without school context."],
    };
  }

  // Grade R / Reception (Reception left as-is unless school opts in elsewhere)
  if (/^(grade\s*)?r$/i.test(t) || /^gr\s*r$/i.test(t) || /^g\s*r$/i.test(t)) {
    return {
      proposedLabel: "Grade R",
      normalizeKey: "grader",
      confidence: "HIGH",
      matchState: "AUTO_MATCH",
      warnings,
    };
  }
  if (/^reception$/i.test(t)) {
    return {
      proposedLabel: "Reception",
      normalizeKey: "reception",
      confidence: "MEDIUM",
      matchState: "REVIEW_REQUIRED",
      warnings: ["Reception may mean Grade R — confirm before merging."],
    };
  }

  // Year N international ambiguity
  const yearOnly = lower.match(/^year\s*(\d{1,2})$/);
  if (yearOnly) {
    return {
      proposedLabel: t,
      normalizeKey: `year${yearOnly[1]}`,
      confidence: "MEDIUM",
      matchState: "REVIEW_REQUIRED",
      warnings: ["Year numbering may be international — confirm equivalence to Grade."],
    };
  }

  let num: string | null = null;
  const gr = t.match(/^(?:grade|gr|g)\s*(\d{1,2})\b/i);
  if (gr) num = gr[1];
  if (!num) {
    const word = t.match(/^grade\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i);
    if (word) num = WORD_NUM[word[1].toLowerCase()] || null;
  }
  if (!num && /^\d{1,2}$/.test(t)) num = t;

  if (num) {
    const n = parseInt(num, 10);
    if (n >= 0 && n <= 12) {
      return {
        proposedLabel: `Grade ${n}`,
        normalizeKey: `grade${n}`,
        confidence: "HIGH",
        matchState: "AUTO_MATCH",
        warnings,
      };
    }
  }

  return {
    proposedLabel: t,
    normalizeKey: lower.replace(/[^a-z0-9]/g, ""),
    confidence: "LOW",
    matchState: "REVIEW_REQUIRED",
    warnings: ["Unrecognized grade format — needs review."],
  };
}

export type SubjectNormalizeResult = {
  proposedName: string;
  normalizeKey: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  matchState: "AUTO_MATCH" | "REVIEW_REQUIRED";
  warnings: string[];
  possibleDuplicateKey: string | null;
};

/** Conservative subject aliases — only clear curriculum equivalents. */
const SUBJECT_ALIASES: Array<{ key: string; name: string; aliases: string[] }> = [
  { key: "mathematics", name: "Mathematics", aliases: ["math", "maths", "mathematics"] },
  {
    key: "englishhl",
    name: "English Home Language",
    aliases: ["english hl", "english home language", "eng hl"],
  },
  {
    key: "english",
    name: "English",
    aliases: ["english"],
  },
  {
    key: "lifeskills",
    name: "Life Skills",
    aliases: ["life skills", "lifeskills"],
  },
  {
    key: "naturalsciences",
    name: "Natural Sciences",
    aliases: ["natural science", "natural sciences", "ns"],
  },
  {
    key: "afrikaansfal",
    name: "Afrikaans First Additional Language",
    aliases: ["afrikaans fal", "afr fal"],
  },
];

export function normalizeSubjectName(raw: string): SubjectNormalizeResult {
  const t = String(raw || "").trim().replace(/\s+/g, " ");
  if (!t) {
    return {
      proposedName: "",
      normalizeKey: "",
      confidence: "LOW",
      matchState: "REVIEW_REQUIRED",
      warnings: ["Empty subject"],
      possibleDuplicateKey: null,
    };
  }
  const compact = t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

  for (const row of SUBJECT_ALIASES) {
    if (row.aliases.some((a) => a === compact)) {
      // Do not collapse bare "English" into English HL
      if (row.key === "english" && /hl|home language/i.test(t)) continue;
      return {
        proposedName: row.name,
        normalizeKey: row.key,
        confidence: row.key === "english" ? "MEDIUM" : "HIGH",
        matchState: row.key === "english" ? "REVIEW_REQUIRED" : "AUTO_MATCH",
        warnings:
          row.key === "english"
            ? ["‘English’ may be HL or FAL — confirm before merging."]
            : [],
        possibleDuplicateKey: row.key,
      };
    }
  }

  return {
    proposedName: t.replace(/\b\w/g, (c) => c.toUpperCase()),
    normalizeKey: compact.replace(/\s+/g, ""),
    confidence: "MEDIUM",
    matchState: "REVIEW_REQUIRED",
    warnings: [],
    possibleDuplicateKey: null,
  };
}

/** Foundation Phase example subjects used in EduClear SUBJECTS mode tests — not hard-coded requirements. */
export const FOUNDATION_PHASE_EXAMPLE_SUBJECTS = [
  "English",
  "Mathematics",
  "Life Skills",
] as const;
