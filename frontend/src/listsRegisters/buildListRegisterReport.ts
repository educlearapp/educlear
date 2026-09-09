import { calculateLearnerAge, normaliseDateForInput } from "../learner/learnerIdentity";
import { resolveVisibleAccountNo } from "../billing/billingAccountRef";
import {
  pickAlternateContact,
  rankDisplayParentsForLearner,
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

export type ListRegisterRow = Record<ListRegisterColumnId | "learnerId" | "_dobIso" | "_birthdayKey" | "_month", string>;

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
  hasAddress: "all" | "yes";
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

function formatBirthdayDisplay(iso: string): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "—";
  const [, m, d] = iso.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(d)} ${months[Number(m) - 1]}`;
}

function buildBaseRow(l: ListRegisterLearnerInput): ListRegisterRow {
  const dobIso = learnerDobIso(l);
  const month = dobIso ? String(Number(dobIso.slice(5, 7))) : "";
  const birthdayKey = dobIso ? `${dobIso.slice(5, 7)}-${dobIso.slice(8, 10)}` : "99-99";
  const ranked = rankDisplayParentsForLearner((l.parents || []) as any[]);
  const guardianName = ranked ? `${ranked.firstName} ${ranked.surname}`.trim() : "";
  const age =
    dobIso
      ? calculateLearnerAge(dobIso)
      : String(l.age || "").trim() && String(l.age).trim() !== "-"
        ? String(l.age).trim()
        : "—";

  return {
    learnerId: String(l.id || ""),
    accountNo: learnerVisibleAccountNo(l),
    surname: learnerSurname(l) || "—",
    name: learnerFirstName(l) || "—",
    learner: `${learnerSurname(l)} ${learnerFirstName(l)}`.trim() || "—",
    grade: learnerGrade(l) || "—",
    classroom: learnerClassroom(l) || "—",
    status: learnerStatus(l),
    dob: dobIso || "—",
    age: age === "-" ? "—" : age,
    birthday: formatBirthdayDisplay(dobIso),
    guardian: guardianName || "—",
    relationship: ranked?.relationship || "—",
    cellphone: ranked?.cellNo || "—",
    alternate: pickAlternateContact(ranked || {}) || "—",
    email: ranked?.email || "—",
    address: ranked ? String((l.parents || []).find((p) => String(p.id) === ranked.id)?.homeAddress || "").trim() || "—" : "—",
    _dobIso: dobIso,
    _birthdayKey: birthdayKey,
    _month: month,
  };
}

/** Fix address from ranked parent homeAddress on the parent object itself. */
function buildRow(l: ListRegisterLearnerInput): ListRegisterRow {
  const row = buildBaseRow(l);
  const ranked = rankDisplayParentsForLearner((l.parents || []) as any[]);
  if (ranked) {
    const parent = (l.parents || []).find((p) => String(p.id || "") === ranked.id);
    const addr = String(parent?.homeAddress || "").trim();
    row.address = addr || "—";
    row.alternate = pickAlternateContact({
      workNo: ranked.workNo,
      homeNo: ranked.homeNo || String(parent?.homeNo || ""),
    }) || "—";
  }
  return row;
}

function cmpStr(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
}

function sortRows(rows: ListRegisterRow[], sort: ListRegisterSortId): ListRegisterRow[] {
  const copy = [...rows];
  copy.sort((a, b) => {
    switch (sort) {
      case "name":
        return cmpStr(a.name, b.name) || cmpStr(a.surname, b.surname);
      case "classroom":
        return cmpStr(a.classroom, b.classroom) || cmpStr(a.surname, b.surname);
      case "grade":
        return cmpStr(a.grade, b.grade) || cmpStr(a.surname, b.surname);
      case "dob": {
        const da = a._dobIso || "9999-99-99";
        const db = b._dobIso || "9999-99-99";
        return da.localeCompare(db) || cmpStr(a.surname, b.surname);
      }
      case "birthday":
        return a._birthdayKey.localeCompare(b._birthdayKey) || cmpStr(a.surname, b.surname);
      case "guardian":
        return cmpStr(a.guardian, b.guardian) || cmpStr(a.learner, b.learner);
      case "learner":
        return cmpStr(a.learner, b.learner);
      case "surname":
      default:
        return cmpStr(a.surname, b.surname) || cmpStr(a.name, b.name);
    }
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
    if (def.filters.includes("hasAddress") && controls.hasAddress === "yes") {
      if (!row.address || row.address === "—") return false;
    }
    return true;
  });
}

export function buildListRegisterRows(
  learners: ListRegisterLearnerInput[],
  def: ListRegisterDef,
  controls: ListRegisterControls
): { rows: ListRegisterRow[]; sections: ListRegisterSection[] } {
  if (!def.implemented) return { rows: [], sections: [] };

  let rows = learners.map(buildRow);
  rows = applyListRegisterFilters(rows, def, controls);
  const sort = def.sorts.includes(controls.sort) ? controls.sort : def.sorts[0] || "surname";
  rows = sortRows(rows, sort);

  if (def.groupBy === "classroom" && controls.classroom === "all") {
    const byClass = new Map<string, ListRegisterRow[]>();
    for (const row of rows) {
      const key = row.classroom && row.classroom !== "—" ? row.classroom : "(No classroom)";
      if (!byClass.has(key)) byClass.set(key, []);
      byClass.get(key)!.push(row);
    }
    const sections = Array.from(byClass.entries())
      .sort((a, b) => cmpStr(a[0], b[0]))
      .map(([key, sectionRows]) => ({
        key,
        label: key,
        count: sectionRows.length,
        rows: sectionRows,
      }));
    return { rows, sections };
  }

  if (def.groupBy === "birthdayMonth" && controls.month === "all") {
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
    const sections = Array.from(byMonth.entries())
      .sort((a, b) => Number(a[0] || 99) - Number(b[0] || 99))
      .map(([key, sectionRows]) => ({
        key,
        label: key === "0" ? "Unknown birthday" : monthNames[Number(key)] || key,
        count: sectionRows.length,
        rows: sectionRows,
      }));
    return { rows, sections };
  }

  return {
    rows,
    sections: [{ key: "all", label: def.label, count: rows.length, rows }],
  };
}

export function uniqueClassroomOptions(learners: ListRegisterLearnerInput[]): string[] {
  const set = new Set<string>();
  for (const l of learners) {
    const c = learnerClassroom(l);
    if (c) set.add(c);
  }
  return Array.from(set).sort((a, b) => cmpStr(a, b));
}

export function uniqueGradeOptions(learners: ListRegisterLearnerInput[]): string[] {
  const set = new Set<string>();
  for (const l of learners) {
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

  const useSections = def.groupBy !== "none" && sections.length > 0;
  if (useSections && (def.groupBy === "classroom" || def.groupBy === "birthdayMonth")) {
    for (const section of sections) {
      lines.push([section.label, `Count: ${section.count}`].map(escape).join(","));
      lines.push(cols.map((c) => escape(COLUMN_LABELS[c])).join(","));
      for (const row of section.rows) {
        lines.push(cols.map((c) => escape(row[c])).join(","));
      }
      lines.push("");
    }
  } else {
    const rows = sections[0]?.rows || [];
    lines.push(cols.map((c) => escape(COLUMN_LABELS[c])).join(","));
    for (const row of rows) {
      lines.push(cols.map((c) => escape(row[c])).join(","));
    }
  }
  return lines.join("\n");
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
