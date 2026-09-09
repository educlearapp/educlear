import { calculateLearnerAge, normaliseDateForInput } from "../learner/learnerIdentity";
import { resolveVisibleAccountNo } from "../billing/billingAccountRef";
import {
  listRankedDisplayParentsForLearner,
  pickAlternateContact,
  type RankedDisplayParent,
} from "./displayContactRanking";
import type {
  ListRegisterColumnId,
  ListRegisterDef,
  ListRegisterFilterId,
  ListRegisterSortId,
} from "./listRegisterCatalog";
import { COLUMN_LABELS } from "./listRegisterCatalog";

export type ListRegisterLearnerInput = {
  id?: string;
  firstName?: string;
  name?: string;
  surname?: string;
  lastName?: string;
  grade?: string;
  classroom?: string;
  className?: string;
  classroomName?: string;
  status?: string;
  childStatus?: string;
  enrollmentStatus?: string;
  admissionNo?: string | null;
  admissionNumber?: string | null;
  accountNo?: string;
  accountNumber?: string;
  accountRef?: string;
  eduClearAccountNo?: string | null;
  birthDate?: unknown;
  dateOfBirth?: unknown;
  dob?: unknown;
  age?: string;
  parents?: Array<Record<string, unknown>>;
};

export type ListRegisterRow = Record<
  ListRegisterColumnId | "learnerId" | "parentId" | "_dobIso" | "_birthdayKey" | "_month" | "_ageYears" | "_gradeHint",
  string
>;

export type ListRegisterSection = {
  key: string;
  label: string;
  count: number;
  rows: ListRegisterRow[];
};

export type ListRegisterControls = {
  classroom: string; // "all" | classroom name
  grade: string; // "all" | grade
  month: string; // "all" | "1".."12"
  hasAddress: "all" | "yes" | "no";
  sort: ListRegisterSortId;
};

export function dash(value: unknown): string {
  const s = String(value ?? "").trim();
  return s || "—";
}

export function learnerFirstName(l: ListRegisterLearnerInput): string {
  return String(l.firstName || l.name || "").trim();
}

export function learnerSurname(l: ListRegisterLearnerInput): string {
  return String(l.surname || l.lastName || "").trim();
}

export function learnerClassroom(l: ListRegisterLearnerInput): string {
  return String(l.classroom || l.className || l.classroomName || "").trim();
}

export function learnerGrade(l: ListRegisterLearnerInput): string {
  return String(l.grade || "").trim();
}

export function learnerStatus(l: ListRegisterLearnerInput): string {
  return String(l.status || l.childStatus || l.enrollmentStatus || "").trim() || "—";
}

export function learnerAdmissionNo(l: ListRegisterLearnerInput): string {
  return String(l.admissionNo || l.admissionNumber || "").trim() || "—";
}

export function learnerVisibleAccountNo(l: ListRegisterLearnerInput): string {
  return (
    resolveVisibleAccountNo({
      eduClearAccountNo: l.eduClearAccountNo,
      accountRef: l.accountRef,
      accountNo: l.accountNo || l.accountNumber,
    }) || "—"
  );
}

export function learnerDobIso(l: ListRegisterLearnerInput): string {
  return normaliseDateForInput(l.birthDate || l.dateOfBirth || l.dob);
}

/** Active roster only — historical excluded by default for all Phase 1 reports. */
export function isActiveListRegisterLearner(l: ListRegisterLearnerInput): boolean {
  const enrollment = String(l.enrollmentStatus || "").trim().toUpperCase();
  if (enrollment === "HISTORICAL") return false;
  const child = String(l.childStatus || l.status || "").trim().toLowerCase();
  if (child === "historical") return false;
  return true;
}

function formatBirthdayDisplay(iso: string): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "—";
  const [, m, d] = iso.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(d)} ${months[Number(m) - 1]}`;
}

function ageFromDob(dobIso: string): { display: string; years: number } {
  if (!dobIso) return { display: "—", years: -1 };
  const raw = calculateLearnerAge(dobIso);
  if (!raw || raw === "-") return { display: "—", years: -1 };
  const yearsMatch = raw.match(/^(\d+)\s+years?/);
  const monthsOnly = raw.match(/^(\d+)\s+months?/);
  let years = -1;
  if (yearsMatch) years = Number(yearsMatch[1]);
  else if (monthsOnly) years = 0;
  return { display: raw === "-" ? "—" : raw, years };
}

function emptyMeta(dobIso: string): Pick<ListRegisterRow, "_dobIso" | "_birthdayKey" | "_month" | "_ageYears" | "_gradeHint"> {
  const month = dobIso ? String(Number(dobIso.slice(5, 7))) : "";
  const birthdayKey = dobIso ? `${dobIso.slice(5, 7)}-${dobIso.slice(8, 10)}` : "99-99";
  const age = ageFromDob(dobIso);
  return {
    _dobIso: dobIso,
    _birthdayKey: birthdayKey,
    _month: month,
    _ageYears: String(age.years),
    _gradeHint: "",
  };
}

function baseLearnerFields(l: ListRegisterLearnerInput): ListRegisterRow {
  const dobIso = learnerDobIso(l);
  const age = ageFromDob(dobIso);
  return {
    learnerId: String(l.id || ""),
    parentId: "",
    accountNo: learnerVisibleAccountNo(l),
    admissionNo: learnerAdmissionNo(l),
    surname: learnerSurname(l) || "—",
    name: learnerFirstName(l) || "—",
    learner: `${learnerSurname(l)} ${learnerFirstName(l)}`.trim() || "—",
    grade: learnerGrade(l) || "—",
    classroom: learnerClassroom(l) || "—",
    status: learnerStatus(l),
    dob: dobIso || "—",
    age: age.display,
    birthday: formatBirthdayDisplay(dobIso),
    guardian: "—",
    relationship: "—",
    primary: "—",
    paying: "—",
    cellphone: "—",
    alternate: "—",
    email: "—",
    address: "—",
    ...emptyMeta(dobIso),
    _gradeHint: learnerGrade(l) || "",
    _ageYears: String(age.years),
  };
}

function applyParentContact(row: ListRegisterRow, parent: RankedDisplayParent | null): ListRegisterRow {
  if (!parent) return row;
  return {
    ...row,
    parentId: parent.id,
    guardian: `${parent.firstName} ${parent.surname}`.trim() || "—",
    relationship: parent.relationship || "—",
    primary: parent.isPrimary ? "Yes" : "",
    paying: parent.isPayingPerson ? "Yes" : "",
    cellphone: parent.cellNo || "—",
    alternate: pickAlternateContact(parent) || "—",
    email: parent.email || "—",
    address: parent.homeAddress || "—",
  };
}

function buildLearnerRow(l: ListRegisterLearnerInput): ListRegisterRow {
  return baseLearnerFields(l);
}

/** Contact List: one row per linked parent/guardian (or one empty-contact row if none). */
function buildContactRows(l: ListRegisterLearnerInput): ListRegisterRow[] {
  const base = baseLearnerFields(l);
  const ranked = listRankedDisplayParentsForLearner((l.parents || []) as any[]);
  if (!ranked.length) return [base];
  return ranked.map((p) => applyParentContact({ ...base }, p));
}

function normalizeAddressKey(address: string): string {
  return address.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Address List: one row per unique populated linked address; missing → one honest — row. */
function buildAddressRows(l: ListRegisterLearnerInput): ListRegisterRow[] {
  const base = baseLearnerFields(l);
  const ranked = listRankedDisplayParentsForLearner((l.parents || []) as any[]);
  const seen = new Map<string, ListRegisterRow>();
  for (const p of ranked) {
    const addr = String(p.homeAddress || "").trim();
    if (!addr) continue;
    const key = normalizeAddressKey(addr);
    if (seen.has(key)) continue;
    seen.set(key, applyParentContact({ ...base, address: addr }, p));
  }
  if (!seen.size) return [{ ...base, address: "—" }];
  return Array.from(seen.values());
}

function expandRows(learners: ListRegisterLearnerInput[], def: ListRegisterDef): ListRegisterRow[] {
  const active = learners.filter(isActiveListRegisterLearner);
  const out: ListRegisterRow[] = [];
  for (const l of active) {
    if (def.kind === "contact") out.push(...buildContactRows(l));
    else if (def.kind === "address") out.push(...buildAddressRows(l));
    else out.push(buildLearnerRow(l));
  }
  return out;
}

function cmpStr(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
}

function contactPriority(row: ListRegisterRow): number {
  return (row.primary === "Yes" ? 2 : 0) + (row.paying === "Yes" ? 1 : 0);
}

function sortRows(rows: ListRegisterRow[], sort: ListRegisterSortId, def: ListRegisterDef): ListRegisterRow[] {
  const copy = [...rows];
  copy.sort((a, b) => {
    let primary = 0;
    switch (sort) {
      case "name":
        primary = cmpStr(a.name, b.name) || cmpStr(a.surname, b.surname);
        break;
      case "classroom":
        primary = cmpStr(a.classroom, b.classroom) || cmpStr(a.surname, b.surname) || cmpStr(a.name, b.name);
        break;
      case "grade":
        primary = cmpStr(a.grade, b.grade) || cmpStr(a.surname, b.surname) || cmpStr(a.name, b.name);
        break;
      case "dob": {
        const da = a._dobIso || "9999-99-99";
        const db = b._dobIso || "9999-99-99";
        primary = da.localeCompare(db) || cmpStr(a.surname, b.surname);
        break;
      }
      case "age": {
        const ya = Number(a._ageYears);
        const yb = Number(b._ageYears);
        const sa = Number.isFinite(ya) && ya >= 0 ? ya : -1;
        const sb = Number.isFinite(yb) && yb >= 0 ? yb : -1;
        // Older first; missing ages last
        if (sa < 0 && sb < 0) primary = 0;
        else if (sa < 0) primary = 1;
        else if (sb < 0) primary = -1;
        else primary = sb - sa || (a._dobIso || "").localeCompare(b._dobIso || "");
        primary = primary || cmpStr(a.surname, b.surname);
        break;
      }
      case "birthday":
        primary = a._birthdayKey.localeCompare(b._birthdayKey) || cmpStr(a.surname, b.surname);
        break;
      case "guardian":
        primary = cmpStr(a.guardian, b.guardian) || cmpStr(a.surname, b.surname) || cmpStr(a.name, b.name);
        break;
      case "learner":
        primary = cmpStr(a.learner, b.learner);
        break;
      case "surname":
      default:
        primary = cmpStr(a.surname, b.surname) || cmpStr(a.name, b.name);
        break;
    }

    // Contact List / Address List: within the same learner, primary → paying → remaining
    if ((def.kind === "contact" || def.kind === "address") && a.learnerId && a.learnerId === b.learnerId) {
      return (
        contactPriority(b) - contactPriority(a) ||
        cmpStr(a.parentId, b.parentId) ||
        primary
      );
    }

    return primary;
  });
  return copy;
}

export function applyListRegisterFilters(
  rows: ListRegisterRow[],
  def: ListRegisterDef,
  controls: ListRegisterControls
): ListRegisterRow[] {
  return rows.filter((row) => {
    if (def.filters.includes("classroom") && controls.classroom !== "all") {
      if (row.classroom !== controls.classroom) return false;
    }
    if (def.filters.includes("grade") && controls.grade !== "all") {
      if (row.grade !== controls.grade) return false;
    }
    if (def.filters.includes("month") && controls.month !== "all") {
      if (row._month !== controls.month) return false;
    }
    if (def.filters.includes("hasAddress")) {
      const has = Boolean(row.address && row.address !== "—");
      if (controls.hasAddress === "yes" && !has) return false;
      if (controls.hasAddress === "no" && has) return false;
    }
    return true;
  });
}

function sectionGradeHint(rows: ListRegisterRow[]): string {
  const grades = new Set(rows.map((r) => r._gradeHint || (r.grade !== "—" ? r.grade : "")).filter(Boolean));
  if (grades.size === 1) return Array.from(grades)[0];
  return "";
}

function buildClassroomSections(rows: ListRegisterRow[], def: ListRegisterDef): ListRegisterSection[] {
  const byClass = new Map<string, ListRegisterRow[]>();
  for (const row of rows) {
    const key = row.classroom && row.classroom !== "—" ? row.classroom : "(No classroom)";
    if (!byClass.has(key)) byClass.set(key, []);
    byClass.get(key)!.push(row);
  }
  return Array.from(byClass.entries())
    .sort((a, b) => cmpStr(a[0], b[0]))
    .map(([key, sectionRows]) => {
      const gradeHint = sectionGradeHint(sectionRows);
      const label =
        def.kind === "class-roster" && gradeHint && !key.toLowerCase().includes(gradeHint.toLowerCase())
          ? `${key} · ${gradeHint}`
          : key;
      return {
        key,
        label,
        count: sectionRows.length,
        rows: sectionRows,
      };
    });
}

function buildBirthdayMonthSections(rows: ListRegisterRow[]): ListRegisterSection[] {
  const monthNames = [
    "",
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const byMonth = new Map<string, ListRegisterRow[]>();
  for (const row of rows) {
    const m = row._month || "0";
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m)!.push(row);
  }
  return Array.from(byMonth.entries())
    .sort((a, b) => Number(a[0] || 99) - Number(b[0] || 99))
    .map(([key, sectionRows]) => ({
      key,
      label: key === "0" ? "Unknown birthday" : monthNames[Number(key)] || key,
      count: sectionRows.length,
      rows: sectionRows,
    }));
}

export function buildListRegisterRows(
  learners: ListRegisterLearnerInput[],
  def: ListRegisterDef,
  controls: ListRegisterControls
): { rows: ListRegisterRow[]; sections: ListRegisterSection[] } {
  if (!def.implemented) return { rows: [], sections: [] };

  let rows = expandRows(learners, def);
  rows = applyListRegisterFilters(rows, def, controls);
  const sort = def.sorts.includes(controls.sort) ? controls.sort : def.sorts[0] || "surname";
  rows = sortRows(rows, sort, def);

  // Class List + Contact List: always section by classroom (incl. single-class filter)
  if (def.groupBy === "classroom") {
    const sections = buildClassroomSections(rows, def);
    return { rows, sections };
  }

  if (def.groupBy === "birthdayMonth" && controls.month === "all") {
    return { rows, sections: buildBirthdayMonthSections(rows) };
  }

  return {
    rows,
    sections: [{ key: "all", label: def.label, count: rows.length, rows }],
  };
}

export function uniqueClassroomOptions(learners: ListRegisterLearnerInput[]): string[] {
  const set = new Set<string>();
  for (const l of learners.filter(isActiveListRegisterLearner)) {
    const c = learnerClassroom(l);
    if (c) set.add(c);
  }
  return Array.from(set).sort((a, b) => cmpStr(a, b));
}

export function uniqueGradeOptions(learners: ListRegisterLearnerInput[]): string[] {
  const set = new Set<string>();
  for (const l of learners.filter(isActiveListRegisterLearner)) {
    const g = learnerGrade(l);
    if (g) set.add(g);
  }
  return Array.from(set).sort((a, b) => cmpStr(a, b));
}

export function buildListRegisterCsv(
  def: ListRegisterDef,
  sections: ListRegisterSection[],
  schoolName: string
): string {
  const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const cols = def.columns;
  const lines: string[] = [
    ["Report", def.label].map(escape).join(","),
    ["School", schoolName].map(escape).join(","),
    "",
  ];

  const useSections =
    def.groupBy !== "none" &&
    sections.length > 0 &&
    !(sections.length === 1 && sections[0].key === "all" && def.groupBy === "birthdayMonth");

  if (useSections && (def.groupBy === "classroom" || (def.groupBy === "birthdayMonth" && sections[0]?.key !== "all"))) {
    for (const section of sections) {
      lines.push([section.label, `Count: ${section.count}`].map(escape).join(","));
      lines.push(cols.map((c) => escape(COLUMN_LABELS[c])).join(","));
      for (const row of section.rows) {
        lines.push(cols.map((c) => escape(row[c])).join(","));
      }
      lines.push("");
    }
  } else {
    const rows = sections.flatMap((s) => s.rows);
    lines.push(cols.map((c) => escape(COLUMN_LABELS[c])).join(","));
    for (const row of rows) {
      lines.push(cols.map((c) => escape(row[c])).join(","));
    }
  }
  return lines.join("\n");
}

/** Flatten section rows in view order — must match CSV data rows for reconciliation. */
export function flattenListRegisterViewRows(sections: ListRegisterSection[]): ListRegisterRow[] {
  return sections.flatMap((s) => s.rows);
}

export function downloadListRegisterCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function isFilterEnabled(def: ListRegisterDef, id: ListRegisterFilterId): boolean {
  return def.filters.includes(id);
}
