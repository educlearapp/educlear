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
import { resolveColumnLabel } from "./listRegisterCatalog";

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

export type ListRegisterEmployeeInput = {
  id?: string;
  employeeNumber?: string | null;
  firstName?: string;
  lastName?: string;
  surname?: string;
  fullName?: string | null;
  dateOfBirth?: unknown;
  birthDate?: unknown;
  mobileNumber?: string | null;
  email?: string | null;
  physicalAddress?: string | null;
  jobTitle?: string | null;
  department?: string | null;
  isActive?: boolean;
};

export type ListRegisterGroupMemberInput = {
  groupId?: string;
  groupName?: string;
  learnerId?: string;
  surname?: string;
  lastName?: string;
  name?: string;
  firstName?: string;
  grade?: string;
  classroom?: string;
  className?: string;
};

export type ListRegisterIncidentInput = {
  id?: string;
  incidentDate?: unknown;
  type?: string;
  subject?: string;
  summary?: string;
  createdBy?: string;
  learnerId?: string;
  learnerName?: string;
  surname?: string;
  name?: string;
  grade?: string;
  classroom?: string;
  className?: string;
};

export type ListRegisterEmployeeAttendanceInput = {
  employeeId?: string;
  employeeNumber?: string | null;
  firstName?: string;
  lastName?: string;
  surname?: string;
  department?: string | null;
  jobTitle?: string | null;
  date?: string;
  status?: string;
  clockIn?: string | null;
  clockOut?: string | null;
};

export type ListRegisterBuildInput = {
  learners?: ListRegisterLearnerInput[];
  employees?: ListRegisterEmployeeInput[];
  groupMembers?: ListRegisterGroupMemberInput[];
  incidents?: ListRegisterIncidentInput[];
  employeeAttendance?: ListRegisterEmployeeAttendanceInput[];
  /** Labels for Extra Field 1..N (Child List extra-field worksheets). */
  extraFieldLabels?: string[];
};

export type ListRegisterRow = Record<string, string>;

export type ListRegisterSection = {
  key: string;
  label: string;
  count: number;
  rows: ListRegisterRow[];
  /** Block sheets: number of blank writing lines per block. */
  blockLines?: number;
  blockCount?: number;
};

export type ListRegisterControls = {
  classroom: string; // "all" | classroom name
  grade: string; // "all" | grade
  month: string; // "all" | "1".."12"
  hasAddress: "all" | "yes" | "no";
  sort: ListRegisterSortId;
  group?: string; // "all" | group name
  department?: string; // "all" | department
  anchorDate?: string; // YYYY-MM-DD for dateWindow filters
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

function blankExtras(count: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 1; i <= count; i++) out[`extra${i}`] = "";
  return out;
}

function baseLearnerFields(l: ListRegisterLearnerInput, extraFieldCount = 0): ListRegisterRow {
  const dobIso = learnerDobIso(l);
  const age = ageFromDob(dobIso);
  return {
    learnerId: String(l.id || ""),
    parentId: "",
    employeeId: "",
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
    employeeNo: "—",
    department: "—",
    jobTitle: "—",
    groupName: "—",
    incidentDate: "—",
    incidentType: "—",
    subject: "—",
    summary: "—",
    createdBy: "—",
    date: "—",
    clockIn: "—",
    clockOut: "—",
    attendanceStatus: "—",
    ...blankExtras(Math.max(extraFieldCount, 6)),
    ...emptyMeta(dobIso),
    _gradeHint: learnerGrade(l) || "",
    _ageYears: String(age.years),
    _entity: "learner",
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

function buildLearnerRow(l: ListRegisterLearnerInput, extraFieldCount = 0): ListRegisterRow {
  return baseLearnerFields(l, extraFieldCount);
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

function expandLearnerRows(learners: ListRegisterLearnerInput[], def: ListRegisterDef): ListRegisterRow[] {
  const active = learners.filter(isActiveListRegisterLearner);
  const extra = def.extraFieldCount || 0;
  const out: ListRegisterRow[] = [];
  for (const l of active) {
    if (def.kind === "contact") out.push(...buildContactRows(l));
    else if (def.kind === "address") out.push(...buildAddressRows(l));
    else out.push(buildLearnerRow(l, extra));
  }
  return out;
}

function employeeSurname(e: ListRegisterEmployeeInput): string {
  return String(e.lastName || e.surname || "").trim();
}

function employeeFirstName(e: ListRegisterEmployeeInput): string {
  return String(e.firstName || "").trim();
}

function employeeDobIso(e: ListRegisterEmployeeInput): string {
  return normaliseDateForInput(e.dateOfBirth || e.birthDate);
}

function buildEmployeeRow(e: ListRegisterEmployeeInput): ListRegisterRow {
  const dobIso = employeeDobIso(e);
  const age = ageFromDob(dobIso);
  const surname = employeeSurname(e);
  const name = employeeFirstName(e);
  return {
    learnerId: "",
    parentId: "",
    employeeId: String(e.id || ""),
    accountNo: "—",
    admissionNo: "—",
    surname: surname || "—",
    name: name || "—",
    learner: "—",
    grade: "—",
    classroom: "—",
    status: e.isActive === false ? "Inactive" : "Active",
    dob: dobIso || "—",
    age: age.display,
    birthday: formatBirthdayDisplay(dobIso),
    guardian: "—",
    relationship: "—",
    primary: "—",
    paying: "—",
    cellphone: dash(e.mobileNumber),
    alternate: "—",
    email: dash(e.email),
    address: dash(e.physicalAddress),
    employeeNo: dash(e.employeeNumber),
    department: dash(e.department),
    jobTitle: dash(e.jobTitle),
    groupName: "—",
    incidentDate: "—",
    incidentType: "—",
    subject: "—",
    summary: "—",
    createdBy: "—",
    date: "—",
    clockIn: "—",
    clockOut: "—",
    attendanceStatus: "—",
    ...blankExtras(6),
    ...emptyMeta(dobIso),
    _ageYears: String(age.years),
    _entity: "employee",
  };
}

function expandEmployeeRows(employees: ListRegisterEmployeeInput[], def: ListRegisterDef): ListRegisterRow[] {
  const active = employees.filter((e) => e.isActive !== false);
  if (def.kind === "birthday-employee") {
    return active.map(buildEmployeeRow);
  }
  return active.map(buildEmployeeRow);
}

function buildGroupMemberRow(m: ListRegisterGroupMemberInput): ListRegisterRow {
  const surname = String(m.surname || m.lastName || "").trim();
  const name = String(m.name || m.firstName || "").trim();
  const classroom = String(m.classroom || m.className || "").trim();
  return {
    learnerId: String(m.learnerId || ""),
    parentId: "",
    employeeId: "",
    accountNo: "—",
    admissionNo: "—",
    surname: surname || "—",
    name: name || "—",
    learner: `${surname} ${name}`.trim() || "—",
    grade: dash(m.grade),
    classroom: classroom || "—",
    status: "—",
    dob: "—",
    age: "—",
    birthday: "—",
    guardian: "—",
    relationship: "—",
    primary: "—",
    paying: "—",
    cellphone: "—",
    alternate: "—",
    email: "—",
    address: "—",
    employeeNo: "—",
    department: "—",
    jobTitle: "—",
    groupName: dash(m.groupName),
    incidentDate: "—",
    incidentType: "—",
    subject: "—",
    summary: "—",
    createdBy: "—",
    date: "—",
    clockIn: "—",
    clockOut: "—",
    attendanceStatus: "—",
    ...blankExtras(6),
    ...emptyMeta(""),
    _groupId: String(m.groupId || ""),
    _entity: "group-member",
  };
}

function buildIncidentRow(inc: ListRegisterIncidentInput): ListRegisterRow {
  const iso = normaliseDateForInput(inc.incidentDate);
  const learnerName = String(inc.learnerName || "").trim();
  let surname = String(inc.surname || "").trim();
  let name = String(inc.name || "").trim();
  if ((!surname || !name) && learnerName) {
    const parts = learnerName.split(/\s+/);
    if (!surname && parts.length) surname = parts[parts.length - 1];
    if (!name && parts.length > 1) name = parts.slice(0, -1).join(" ");
    else if (!name) name = learnerName;
  }
  const classroom = String(inc.classroom || inc.className || "").trim();
  return {
    learnerId: String(inc.learnerId || ""),
    parentId: "",
    employeeId: "",
    accountNo: "—",
    admissionNo: "—",
    surname: surname || "—",
    name: name || "—",
    learner: learnerName || `${surname} ${name}`.trim() || "—",
    grade: dash(inc.grade),
    classroom: classroom || "—",
    status: "—",
    dob: "—",
    age: "—",
    birthday: "—",
    guardian: "—",
    relationship: "—",
    primary: "—",
    paying: "—",
    cellphone: "—",
    alternate: "—",
    email: "—",
    address: "—",
    employeeNo: "—",
    department: "—",
    jobTitle: "—",
    groupName: "—",
    incidentDate: iso || dash(inc.incidentDate),
    incidentType: dash(inc.type),
    subject: dash(inc.subject),
    summary: dash(inc.summary),
    createdBy: dash(inc.createdBy),
    date: iso || "—",
    clockIn: "—",
    clockOut: "—",
    attendanceStatus: "—",
    ...blankExtras(6),
    ...emptyMeta(""),
    _incidentId: String(inc.id || ""),
    _sortDate: iso || "9999-99-99",
    _entity: "incident",
  };
}

function buildEmployeeAttendanceRow(r: ListRegisterEmployeeAttendanceInput): ListRegisterRow {
  const surname = String(r.lastName || r.surname || "").trim();
  const name = String(r.firstName || "").trim();
  const date = String(r.date || "").trim();
  return {
    learnerId: "",
    parentId: "",
    employeeId: String(r.employeeId || ""),
    accountNo: "—",
    admissionNo: "—",
    surname: surname || "—",
    name: name || "—",
    learner: "—",
    grade: "—",
    classroom: "—",
    status: "—",
    dob: "—",
    age: "—",
    birthday: "—",
    guardian: "—",
    relationship: "—",
    primary: "—",
    paying: "—",
    cellphone: "—",
    alternate: "—",
    email: "—",
    address: "—",
    employeeNo: dash(r.employeeNumber),
    department: dash(r.department),
    jobTitle: dash(r.jobTitle),
    groupName: "—",
    incidentDate: "—",
    incidentType: "—",
    subject: "—",
    summary: "—",
    createdBy: "—",
    date: date || "—",
    clockIn: dash(r.clockIn),
    clockOut: dash(r.clockOut),
    attendanceStatus: dash(r.status),
    ...blankExtras(6),
    ...emptyMeta(""),
    _sortDate: date || "9999-99-99",
    _entity: "employee",
  };
}

function buildBlockSheetSections(def: ListRegisterDef): ListRegisterSection[] {
  const n = def.blockCount || 5;
  return Array.from({ length: n }, (_, i) => ({
    key: `block-${i + 1}`,
    label: `Block ${i + 1}`,
    count: 0,
    rows: [],
    blockLines: 8,
    blockCount: n,
  }));
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
        if (sa < 0 && sb < 0) primary = 0;
        else if (sa < 0) primary = 1;
        else if (sb < 0) primary = -1;
        else primary = sb - sa || (a._dobIso || "").localeCompare(b._dobIso || "");
        primary = primary || cmpStr(a.surname, b.surname);
        break;
      }
      case "birthday":
        primary = (a._birthdayKey || "99-99").localeCompare(b._birthdayKey || "99-99") || cmpStr(a.surname, b.surname);
        break;
      case "guardian":
        primary = cmpStr(a.guardian, b.guardian) || cmpStr(a.surname, b.surname) || cmpStr(a.name, b.name);
        break;
      case "learner":
        primary = cmpStr(a.learner, b.learner);
        break;
      case "department":
        primary = cmpStr(a.department, b.department) || cmpStr(a.surname, b.surname) || cmpStr(a.name, b.name);
        break;
      case "employeeNo":
        primary = cmpStr(a.employeeNo, b.employeeNo) || cmpStr(a.surname, b.surname);
        break;
      case "groupName":
        primary = cmpStr(a.groupName, b.groupName) || cmpStr(a.surname, b.surname) || cmpStr(a.name, b.name);
        break;
      case "incidentDate":
      case "date":
        primary =
          (a._sortDate || a.date || "9999-99-99").localeCompare(b._sortDate || b.date || "9999-99-99") ||
          cmpStr(a.surname, b.surname) ||
          cmpStr(a.name, b.name);
        break;
      case "surname":
      default:
        primary = cmpStr(a.surname, b.surname) || cmpStr(a.name, b.name);
        break;
    }

    if ((def.kind === "contact" || def.kind === "address") && a.learnerId && a.learnerId === b.learnerId) {
      return contactPriority(b) - contactPriority(a) || cmpStr(a.parentId, b.parentId) || primary;
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
    if (def.filters.includes("group") && controls.group && controls.group !== "all") {
      if (row.groupName !== controls.group) return false;
    }
    if (def.filters.includes("department") && controls.department && controls.department !== "all") {
      if (row.department !== controls.department) return false;
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

function buildGroupNameSections(rows: ListRegisterRow[]): ListRegisterSection[] {
  const byGroup = new Map<string, ListRegisterRow[]>();
  for (const row of rows) {
    const key = row.groupName && row.groupName !== "—" ? row.groupName : "(No group)";
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key)!.push(row);
  }
  return Array.from(byGroup.entries())
    .sort((a, b) => cmpStr(a[0], b[0]))
    .map(([key, sectionRows]) => ({
      key,
      label: key,
      count: sectionRows.length,
      rows: sectionRows,
    }));
}

/**
 * Conceptual guard for tests: employee-entity reports must not be treated as
 * learner rosters. The builder ignores learners for employee kinds; this assert
 * fails when a caller attempts a learner-only dataset for an employee report.
 */
export function assertEmployeeDatasetNotLearners(
  def: ListRegisterDef,
  input: ListRegisterBuildInput
): void {
  if (def.entity !== "employee") return;
  const hasEmployeeData =
    (Array.isArray(input.employees) && input.employees.length > 0) ||
    (Array.isArray(input.employeeAttendance) && input.employeeAttendance.length > 0);
  const hasLearners = Array.isArray(input.learners) && input.learners.length > 0;
  if (hasLearners && !hasEmployeeData) {
    throw new Error(
      `Employee report "${def.label}" cannot be built from a learner-only dataset`
    );
  }
}

export function buildListRegisterReport(
  def: ListRegisterDef,
  controls: ListRegisterControls,
  input: ListRegisterBuildInput = {}
): { rows: ListRegisterRow[]; sections: ListRegisterSection[]; implemented: boolean } {
  if (def.status === "blocked_missing_data" || !def.implemented || def.kind === "blocked") {
    return { rows: [], sections: [], implemented: false };
  }

  if (def.kind === "learner-attendance") {
    return { rows: [], sections: [], implemented: true };
  }

  if (def.kind === "block-sheet") {
    const sections = buildBlockSheetSections(def);
    return { rows: [], sections, implemented: true };
  }

  let rows: ListRegisterRow[] = [];

  if (def.entity === "learner" || def.kind === "child-extra") {
    rows = expandLearnerRows(input.learners || [], def);
  } else if (def.kind === "birthday-employee" || def.kind === "employee-contact") {
    rows = expandEmployeeRows(input.employees || [], def);
  } else if (def.kind === "group-list") {
    rows = (input.groupMembers || []).map(buildGroupMemberRow);
  } else if (def.kind === "incident-list") {
    rows = (input.incidents || []).map(buildIncidentRow);
  } else if (def.kind === "employee-attendance" || def.kind === "employee-attendance-time") {
    rows = (input.employeeAttendance || []).map(buildEmployeeAttendanceRow);
  } else {
    rows = expandLearnerRows(input.learners || [], def);
  }

  rows = applyListRegisterFilters(rows, def, controls);
  const sort = def.sorts.includes(controls.sort) ? controls.sort : def.sorts[0] || "surname";
  rows = sortRows(rows, sort, def);

  if (def.groupBy === "classroom") {
    return { rows, sections: buildClassroomSections(rows, def), implemented: true };
  }
  if (def.groupBy === "birthdayMonth" && controls.month === "all") {
    return { rows, sections: buildBirthdayMonthSections(rows), implemented: true };
  }
  if (def.groupBy === "groupName") {
    return { rows, sections: buildGroupNameSections(rows), implemented: true };
  }

  return {
    rows,
    sections: [{ key: "all", label: def.label, count: rows.length, rows }],
    implemented: true,
  };
}

/** Phase-1 compatible learner-only entry point. */
export function buildListRegisterRows(
  learners: ListRegisterLearnerInput[],
  def: ListRegisterDef,
  controls: ListRegisterControls,
  options?: Omit<ListRegisterBuildInput, "learners">
): { rows: ListRegisterRow[]; sections: ListRegisterSection[] } {
  const result = buildListRegisterReport(def, controls, { learners, ...options });
  return { rows: result.rows, sections: result.sections };
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

export function uniqueDepartmentOptions(employees: ListRegisterEmployeeInput[]): string[] {
  const set = new Set<string>();
  for (const e of employees.filter((x) => x.isActive !== false)) {
    const d = String(e.department || "").trim();
    if (d) set.add(d);
  }
  return Array.from(set).sort((a, b) => cmpStr(a, b));
}

export function uniqueGroupOptions(members: ListRegisterGroupMemberInput[]): string[] {
  const set = new Set<string>();
  for (const m of members) {
    const g = String(m.groupName || "").trim();
    if (g) set.add(g);
  }
  return Array.from(set).sort((a, b) => cmpStr(a, b));
}

export function buildListRegisterCsv(
  def: ListRegisterDef,
  sections: ListRegisterSection[],
  schoolName: string,
  extraFieldLabels?: string[]
): string {
  if (!def.exportCsv || def.kind === "block-sheet" || def.status === "blocked_missing_data") {
    return "";
  }
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

  const header = cols.map((c) => escape(resolveColumnLabel(c, extraFieldLabels))).join(",");

  if (useSections && (def.groupBy === "classroom" || def.groupBy === "groupName" || (def.groupBy === "birthdayMonth" && sections[0]?.key !== "all"))) {
    for (const section of sections) {
      lines.push([section.label, `Count: ${section.count}`].map(escape).join(","));
      lines.push(header);
      for (const row of section.rows) {
        lines.push(cols.map((c) => escape(row[c])).join(","));
      }
      lines.push("");
    }
  } else {
    const rows = sections.flatMap((s) => s.rows);
    lines.push(header);
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
