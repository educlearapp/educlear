/**
 * Attendance reason codes for Weekly Period / Subject Register display.
 * LearnerAttendance.reason remains free-text — no migration required.
 * Codes are resolved from explicit tokens (S, SN, …) or known synonyms.
 */

export type AttendanceReasonCodeDef = {
  code: string;
  label: string;
  synonyms: string[];
};

/** Canonical EduClear register codes (extendable via schoolCatalog override). */
export const DEFAULT_ATTENDANCE_REASON_CODES: AttendanceReasonCodeDef[] = [
  { code: "P", label: "Present", synonyms: ["present"] },
  { code: "A", label: "Absent", synonyms: ["absent"] },
  { code: "S", label: "Sick", synonyms: ["sick", "illness", "ill"] },
  { code: "SN", label: "Sick Bay", synonyms: ["sick bay", "sickbay", "sick-bay"] },
  { code: "L", label: "Late", synonyms: ["late"] },
  { code: "E", label: "Excused", synonyms: ["excused"] },
  {
    code: "O",
    label: "Official School Activity",
    synonyms: ["official", "official school activity", "official activity", "school activity"],
  },
  {
    code: "F",
    label: "Family Responsibility",
    synonyms: ["family", "family responsibility", "family resp"],
  },
];

export const REGISTER_SYSTEM_CODES: AttendanceReasonCodeDef[] = [
  { code: "NC", label: "Not Captured", synonyms: [] },
  { code: "NS", label: "Not Scheduled", synonyms: [] },
];

export type ResolvedRegisterDisplay = {
  /** Code shown in the register cell (P, A, S, SN, …). */
  abbrev: string;
  /** Human label for the code. */
  label: string;
  /** True when a teacher reason code/synonym drove the display (not only status default). */
  fromReasonCode: boolean;
  /** Remaining teacher note after extracting a leading code, else full free-text note. */
  teacherNote: string | null;
  /** Original reason string preserved. */
  reason: string | null;
};

function normalizeSpace(raw: string): string {
  return String(raw || "")
    .trim()
    .replace(/\s+/g, " ");
}

function catalogByCode(catalog: AttendanceReasonCodeDef[]): Map<string, AttendanceReasonCodeDef> {
  const map = new Map<string, AttendanceReasonCodeDef>();
  for (const item of catalog) map.set(item.code.toUpperCase(), item);
  return map;
}

/** Longer codes first so SN wins over S. */
function sortedCodes(catalog: AttendanceReasonCodeDef[]): AttendanceReasonCodeDef[] {
  return [...catalog].sort((a, b) => b.code.length - a.code.length || a.code.localeCompare(b.code));
}

/**
 * Resolve display code for a captured mark.
 * Does not alter attendance status calculations — display only.
 */
export function resolveRegisterDisplay(opts: {
  status: "PRESENT" | "ABSENT" | "LATE" | "EXCUSED" | "NOT_CAPTURED" | "NOT_SCHEDULED" | string;
  reason?: string | null;
  schoolCatalog?: AttendanceReasonCodeDef[] | null;
}): ResolvedRegisterDisplay {
  const status = String(opts.status || "").toUpperCase();
  const reasonRaw = opts.reason == null ? null : String(opts.reason);
  const reason = reasonRaw == null ? null : normalizeSpace(reasonRaw) || null;
  const catalog = [
    ...(opts.schoolCatalog?.length ? opts.schoolCatalog : DEFAULT_ATTENDANCE_REASON_CODES),
  ];
  const byCode = catalogByCode(catalog);

  if (status === "NOT_CAPTURED") {
    return { abbrev: "NC", label: "Not Captured", fromReasonCode: false, teacherNote: null, reason };
  }
  if (status === "NOT_SCHEDULED") {
    return { abbrev: "NS", label: "Not Scheduled", fromReasonCode: false, teacherNote: null, reason };
  }

  const statusDefault: Record<string, { abbrev: string; label: string }> = {
    PRESENT: { abbrev: "P", label: "Present" },
    ABSENT: { abbrev: "A", label: "Absent" },
    LATE: { abbrev: "L", label: "Late" },
    EXCUSED: { abbrev: "E", label: "Excused" },
  };
  const fallback = statusDefault[status] || { abbrev: "A", label: "Absent" };

  if (!reason) {
    return {
      abbrev: fallback.abbrev,
      label: byCode.get(fallback.abbrev)?.label || fallback.label,
      fromReasonCode: false,
      teacherNote: null,
      reason: null,
    };
  }

  // 1) Leading explicit code token: "SN - Parent called" / "S: flu"
  for (const def of sortedCodes(catalog)) {
    const re = new RegExp(`^${escapeRegExp(def.code)}(?:\\b|[\\s:;\\-–—]|$)(.*)`, "i");
    const m = reason.match(re);
    if (!m) continue;
    const rest = normalizeSpace(m[1] || "").replace(/^[:;\-–—]+\s*/, "").trim();
    // Avoid matching single-letter "S" inside "Sick" handled by synonyms below —
    // only accept letter codes when followed by separator/end OR exact code-only.
    const exactOrSeparated =
      reason.toUpperCase() === def.code.toUpperCase() ||
      new RegExp(`^${escapeRegExp(def.code)}(?:\\s|[:;\\-–—]|$)`, "i").test(reason);
    if (!exactOrSeparated) continue;
    return {
      abbrev: def.code,
      label: def.label,
      fromReasonCode: true,
      teacherNote: rest || null,
      reason,
    };
  }

  // 2) Synonym match (whole reason or leading phrase)
  const lower = reason.toLowerCase();
  for (const def of sortedCodes(catalog)) {
    for (const syn of def.synonyms) {
      const s = syn.toLowerCase();
      if (!s) continue;
      if (lower === s) {
        return { abbrev: def.code, label: def.label, fromReasonCode: true, teacherNote: null, reason };
      }
      if (lower.startsWith(s + " ") || lower.startsWith(s + ":") || lower.startsWith(s + "-") || lower.startsWith(s + "–")) {
        const rest = normalizeSpace(reason.slice(s.length)).replace(/^[:;\-–—]+\s*/, "").trim();
        return {
          abbrev: def.code,
          label: def.label,
          fromReasonCode: true,
          teacherNote: rest || null,
          reason,
        };
      }
    }
  }

  // 3) Free-text note without recognisable code — keep status mark, preserve note
  return {
    abbrev: fallback.abbrev,
    label: byCode.get(fallback.abbrev)?.label || fallback.label,
    fromReasonCode: false,
    teacherNote: reason,
    reason,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Build legend: full catalog + system codes, optionally filtered/extended by codes used. */
export function buildAttendanceReasonLegend(opts?: {
  schoolCatalog?: AttendanceReasonCodeDef[] | null;
  usedAbbrevs?: Iterable<string> | null;
}): Array<{ abbrev: string; label: string }> {
  const catalog = opts?.schoolCatalog?.length ? opts.schoolCatalog : DEFAULT_ATTENDANCE_REASON_CODES;
  const used = new Set(
    [...(opts?.usedAbbrevs || [])].map((c) => String(c || "").trim().toUpperCase()).filter(Boolean)
  );
  const byCode = new Map<string, string>();
  for (const item of [...catalog, ...REGISTER_SYSTEM_CODES]) {
    byCode.set(item.code.toUpperCase(), item.label);
  }
  // Always show the full standard legend for professional registers
  const ordered = [...catalog, ...REGISTER_SYSTEM_CODES];
  const out: Array<{ abbrev: string; label: string }> = [];
  const seen = new Set<string>();
  for (const item of ordered) {
    const key = item.code.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ abbrev: item.code, label: item.label });
  }
  // Append any unexpected used codes
  for (const code of used) {
    if (seen.has(code)) continue;
    seen.add(code);
    out.push({ abbrev: code, label: byCode.get(code) || code });
  }
  return out;
}

export function formatReasonDetailLines(opts: {
  abbrev: string;
  label: string;
  teacherNote?: string | null;
  captureTimeDisplay?: string | null;
}): string[] {
  const lines = [`${opts.abbrev} – ${opts.label}`];
  const note = normalizeSpace(opts.teacherNote || "");
  if (note) lines.push(note);
  const captured = normalizeSpace(opts.captureTimeDisplay || "");
  if (captured && captured !== "—") lines.push(`Captured ${captured}`);
  return lines;
}
