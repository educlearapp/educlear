/**
 * Lists & Registers catalogue V3 — every visible title is implemented or
 * blocked_missing_data (learner attendance remains in attendanceReportCatalog).
 */

import { isLearnerAttendanceRegister } from "../attendance/attendanceReportCatalog";

export type ListRegisterStatus = "implemented" | "blocked_missing_data";

export type ListRegisterEntity =
  | "learner"
  | "employee"
  | "parent"
  | "incident"
  | "group-member"
  | "worksheet";

export type ListRegisterKind =
  | "roster"
  | "class-roster"
  | "contact"
  | "address"
  | "age"
  | "birthday"
  | "birthday-employee"
  | "birthday-parent"
  | "allergies"
  | "employee-contact"
  | "block-sheet"
  | "child-extra"
  | "group-list"
  | "incident-list"
  | "employee-attendance"
  | "employee-attendance-time"
  | "blocked"
  | "learner-attendance";

export type ListRegisterDataSource =
  | "registrations.learners"
  | "listsRegisters.employees"
  | "listsRegisters.groups"
  | "listsRegisters.incidents"
  | "listsRegisters.employeeAttendance"
  | "worksheet.blank"
  | "attendance.learner"
  | "none";

export type ListRegisterColumnId =
  | "accountNo"
  | "admissionNo"
  | "surname"
  | "name"
  | "learner"
  | "grade"
  | "classroom"
  | "status"
  | "dob"
  | "age"
  | "birthday"
  | "guardian"
  | "relationship"
  | "primary"
  | "paying"
  | "cellphone"
  | "alternate"
  | "email"
  | "address"
  | "gender"
  | "idNumber"
  | "parent1Contact"
  | "parent2Contact"
  | "enrolmentDate"
  | "allergies"
  | "medicalAlert"
  | "linkedLearners"
  | "employeeNo"
  | "department"
  | "jobTitle"
  | "groupName"
  | "incidentDate"
  | "incidentType"
  | "subject"
  | "summary"
  | "createdBy"
  | "date"
  | "clockIn"
  | "clockOut"
  | "attendanceStatus";

export type ListRegisterSortId =
  | "surname"
  | "name"
  | "classroom"
  | "grade"
  | "dob"
  | "age"
  | "birthday"
  | "guardian"
  | "learner"
  | "department"
  | "employeeNo"
  | "groupName"
  | "incidentDate"
  | "date";

export type ListRegisterFilterId =
  | "classroom"
  | "grade"
  | "month"
  | "hasAddress"
  | "group"
  | "department"
  | "dateWindow";

export type ListRegisterGroupBy = "none" | "classroom" | "birthdayMonth" | "groupName";

export type ListRegisterAttendanceWindow = "weekly" | "monthly";

export type ListRegisterDef = {
  id: string;
  label: string;
  entity: ListRegisterEntity;
  kind: ListRegisterKind;
  dataSource: ListRegisterDataSource;
  status: ListRegisterStatus;
  blockedReason?: string;
  columns: ListRegisterColumnId[];
  filters: ListRegisterFilterId[];
  sorts: ListRegisterSortId[];
  groupBy: ListRegisterGroupBy;
  rowGrain:
    | "learner"
    | "learner-contact"
    | "learner-address"
    | "employee"
    | "parent"
    | "group-member"
    | "incident"
    | "worksheet-block"
    | "employee-attendance-day";
  exportCsv: boolean;
  exportExcel: boolean;
  exportPdf: boolean;
  /** Derived convenience — true only when status === "implemented". */
  implemented: boolean;
  /** Block Sheet printable block count. */
  blockCount?: 5 | 10 | 20;
  /** Child List (N Extra Fields) — count of Kid-e-Sys-aligned profile extras. */
  extraFieldCount?: 3 | 6;
  /** Employee attendance window / weekends / times. */
  attendanceWindow?: ListRegisterAttendanceWindow;
  includeWeekends?: boolean;
  includeTimes?: boolean;
};

function def(
  partial: Omit<ListRegisterDef, "implemented" | "status"> & {
    status?: ListRegisterStatus;
    blockedReason?: string;
  }
): ListRegisterDef {
  const status = partial.status ?? "implemented";
  return {
    ...partial,
    status,
    implemented: status === "implemented",
    blockedReason: status === "blocked_missing_data" ? partial.blockedReason : undefined,
  };
}

const CHILD_LIST_COLUMNS: ListRegisterColumnId[] = [
  "surname",
  "name",
  "grade",
  "classroom",
  "admissionNo",
  "accountNo",
  "status",
];

/**
 * Kid-e-Sys "Child List Extra Fields" were real data columns, not blank worksheets.
 * 3 Extra → Age, Birth Date, Gender.
 * 6 Extra → those + Parent 1/2 Contact + Enrolment Date (Learner.admissionDate).
 */
function childListThreeExtraColumns(): ListRegisterColumnId[] {
  return [...CHILD_LIST_COLUMNS, "age", "dob", "gender"];
}

function childListSixExtraColumns(): ListRegisterColumnId[] {
  return [
    ...CHILD_LIST_COLUMNS,
    "age",
    "dob",
    "gender",
    "parent1Contact",
    "parent2Contact",
    "enrolmentDate",
  ];
}

function employeeAttendanceDef(opts: {
  id: string;
  label: string;
  kind: "employee-attendance" | "employee-attendance-time";
  attendanceWindow: ListRegisterAttendanceWindow;
  includeWeekends: boolean;
  includeTimes: boolean;
}): ListRegisterDef {
  const columns: ListRegisterColumnId[] = opts.includeTimes
    ? ["employeeNo", "surname", "name", "department", "jobTitle", "date", "attendanceStatus", "clockIn", "clockOut"]
    : ["employeeNo", "surname", "name", "department", "jobTitle", "date", "attendanceStatus"];
  return def({
    id: opts.id,
    label: opts.label,
    entity: "employee",
    kind: opts.kind,
    dataSource: "listsRegisters.employeeAttendance",
    columns,
    filters: ["dateWindow"],
    sorts: ["date", "surname", "name"],
    groupBy: "none",
    rowGrain: "employee-attendance-day",
    exportCsv: true,
    exportExcel: false,
    exportPdf: false,
    attendanceWindow: opts.attendanceWindow,
    includeWeekends: opts.includeWeekends,
    includeTimes: opts.includeTimes,
  });
}

/** Phase 1 roster reports (subset of COMPLETE_LIST_REGISTER_DEFS). */
export const PHASE1_LIST_REGISTER_DEFS: ListRegisterDef[] = [
  def({
    id: "child-list",
    label: "Child List",
    entity: "learner",
    kind: "roster",
    dataSource: "registrations.learners",
    columns: CHILD_LIST_COLUMNS,
    filters: ["classroom", "grade"],
    sorts: ["surname", "name", "grade", "classroom"],
    groupBy: "none",
    rowGrain: "learner",
    exportCsv: true,
    exportExcel: false,
    exportPdf: false,
  }),
  def({
    id: "class-list",
    label: "Class List",
    entity: "learner",
    kind: "class-roster",
    dataSource: "registrations.learners",
    columns: ["surname", "name", "admissionNo", "accountNo", "status"],
    filters: ["classroom"],
    sorts: ["surname", "name"],
    groupBy: "classroom",
    rowGrain: "learner",
    exportCsv: true,
    exportExcel: false,
    exportPdf: false,
  }),
  def({
    id: "contact-list",
    label: "Contact List",
    entity: "learner",
    kind: "contact",
    dataSource: "registrations.learners",
    columns: [
      "surname",
      "name",
      "grade",
      "classroom",
      "guardian",
      "relationship",
      "primary",
      "paying",
      "cellphone",
      "alternate",
      "email",
      "accountNo",
    ],
    filters: ["classroom"],
    sorts: ["surname", "name", "guardian"],
    groupBy: "classroom",
    rowGrain: "learner-contact",
    exportCsv: true,
    exportExcel: false,
    exportPdf: false,
  }),
  def({
    id: "address-list",
    label: "Address List",
    entity: "learner",
    kind: "address",
    dataSource: "registrations.learners",
    columns: ["learner", "grade", "classroom", "guardian", "address", "accountNo"],
    filters: ["classroom", "hasAddress"],
    sorts: ["learner", "classroom"],
    groupBy: "none",
    rowGrain: "learner-address",
    exportCsv: true,
    exportExcel: false,
    exportPdf: false,
  }),
  def({
    id: "age-list",
    label: "Age List",
    entity: "learner",
    kind: "age",
    dataSource: "registrations.learners",
    columns: ["surname", "name", "dob", "age", "grade", "classroom", "accountNo"],
    filters: ["classroom", "grade"],
    sorts: ["age", "dob", "surname", "classroom"],
    groupBy: "none",
    rowGrain: "learner",
    exportCsv: true,
    exportExcel: false,
    exportPdf: false,
  }),
  def({
    id: "birthday-child-list",
    label: "Birthday Child List",
    entity: "learner",
    kind: "birthday",
    dataSource: "registrations.learners",
    columns: ["surname", "name", "birthday", "age", "grade", "classroom", "accountNo"],
    filters: ["month"],
    sorts: ["birthday", "surname"],
    groupBy: "birthdayMonth",
    rowGrain: "learner",
    exportCsv: true,
    exportExcel: false,
    exportPdf: false,
  }),
];

const BLOCKED_DEFS: ListRegisterDef[] = [
  def({
    id: "future-enrolled-list",
    label: "Future Enrolled List",
    entity: "learner",
    kind: "blocked",
    dataSource: "none",
    status: "blocked_missing_data",
    blockedReason:
      "Future enrolment is not currently recorded separately from active and historical enrolments.",
    columns: [],
    filters: [],
    sorts: [],
    groupBy: "none",
    rowGrain: "learner",
    exportCsv: false,
    exportExcel: false,
    exportPdf: false,
  }),
];

const V3_IMPLEMENTED_DEFS: ListRegisterDef[] = [
  def({
    id: "allergies-list",
    label: "Allergies List",
    entity: "learner",
    kind: "allergies",
    dataSource: "registrations.learners",
    columns: ["surname", "name", "grade", "classroom", "allergies", "medicalAlert"],
    filters: ["classroom", "grade"],
    sorts: ["surname", "name"],
    groupBy: "none",
    rowGrain: "learner",
    exportCsv: true,
    exportExcel: false,
    exportPdf: false,
  }),
  def({
    id: "birthday-employee-list",
    label: "Birthday Employee List",
    entity: "employee",
    kind: "birthday-employee",
    dataSource: "listsRegisters.employees",
    columns: ["surname", "name", "employeeNo", "birthday", "age", "department", "jobTitle"],
    filters: ["month"],
    sorts: ["birthday", "surname"],
    groupBy: "birthdayMonth",
    rowGrain: "employee",
    exportCsv: true,
    exportExcel: false,
    exportPdf: false,
  }),
  def({
    id: "birthday-parent-list",
    label: "Birthday Parent List",
    entity: "parent",
    kind: "birthday-parent",
    dataSource: "registrations.learners",
    columns: ["surname", "name", "birthday", "age", "cellphone", "email", "linkedLearners"],
    filters: ["month"],
    sorts: ["birthday", "surname"],
    groupBy: "birthdayMonth",
    rowGrain: "parent",
    exportCsv: true,
    exportExcel: false,
    exportPdf: false,
  }),
  def({
    id: "block-sheet-5",
    label: "Block Sheet (5 Blocks)",
    entity: "worksheet",
    kind: "block-sheet",
    dataSource: "worksheet.blank",
    columns: [],
    filters: [],
    sorts: [],
    groupBy: "none",
    rowGrain: "worksheet-block",
    exportCsv: false,
    exportExcel: false,
    exportPdf: false,
    blockCount: 5,
  }),
  def({
    id: "block-sheet-10",
    label: "Block Sheet (10 Blocks)",
    entity: "worksheet",
    kind: "block-sheet",
    dataSource: "worksheet.blank",
    columns: [],
    filters: [],
    sorts: [],
    groupBy: "none",
    rowGrain: "worksheet-block",
    exportCsv: false,
    exportExcel: false,
    exportPdf: false,
    blockCount: 10,
  }),
  def({
    id: "block-sheet-20",
    label: "Block Sheet (20 Blocks)",
    entity: "worksheet",
    kind: "block-sheet",
    dataSource: "worksheet.blank",
    columns: [],
    filters: [],
    sorts: [],
    groupBy: "none",
    rowGrain: "worksheet-block",
    exportCsv: false,
    exportExcel: false,
    exportPdf: false,
    blockCount: 20,
  }),
  def({
    id: "child-list-3-extra",
    label: "Child List (3 Extra Fields)",
    entity: "learner",
    kind: "child-extra",
    dataSource: "registrations.learners",
    columns: childListThreeExtraColumns(),
    filters: ["classroom", "grade"],
    sorts: ["surname", "name", "grade", "classroom"],
    groupBy: "none",
    rowGrain: "learner",
    exportCsv: true,
    exportExcel: false,
    exportPdf: false,
    extraFieldCount: 3,
  }),
  def({
    id: "child-list-6-extra",
    label: "Child List (6 Extra Fields)",
    entity: "learner",
    kind: "child-extra",
    dataSource: "registrations.learners",
    columns: childListSixExtraColumns(),
    filters: ["classroom", "grade"],
    sorts: ["surname", "name", "grade", "classroom"],
    groupBy: "none",
    rowGrain: "learner",
    exportCsv: true,
    exportExcel: false,
    exportPdf: false,
    extraFieldCount: 6,
  }),
  employeeAttendanceDef({
    id: "employee-attendance-monthly",
    label: "Employee Attendance Register (Monthly)",
    kind: "employee-attendance",
    attendanceWindow: "monthly",
    includeWeekends: false,
    includeTimes: false,
  }),
  employeeAttendanceDef({
    id: "employee-attendance-monthly-weekends",
    label: "Employee Attendance Register (Monthly) (Weekends)",
    kind: "employee-attendance",
    attendanceWindow: "monthly",
    includeWeekends: true,
    includeTimes: false,
  }),
  employeeAttendanceDef({
    id: "employee-attendance-weekly",
    label: "Employee Attendance Register (Weekly)",
    kind: "employee-attendance",
    attendanceWindow: "weekly",
    includeWeekends: false,
    includeTimes: false,
  }),
  employeeAttendanceDef({
    id: "employee-attendance-weekly-weekends",
    label: "Employee Attendance Register (Weekly) (Weekends)",
    kind: "employee-attendance",
    attendanceWindow: "weekly",
    includeWeekends: true,
    includeTimes: false,
  }),
  employeeAttendanceDef({
    id: "employee-attendance-time-weekly",
    label: "Employee Attendance Time Register (Weekly)",
    kind: "employee-attendance-time",
    attendanceWindow: "weekly",
    includeWeekends: false,
    includeTimes: true,
  }),
  employeeAttendanceDef({
    id: "employee-attendance-time-weekly-weekends",
    label: "Employee Attendance Time Register (Weekly) (Weekends)",
    kind: "employee-attendance-time",
    attendanceWindow: "weekly",
    includeWeekends: true,
    includeTimes: true,
  }),
  def({
    id: "employee-contact-list",
    label: "Employee Contact List",
    entity: "employee",
    kind: "employee-contact",
    dataSource: "listsRegisters.employees",
    columns: [
      "employeeNo",
      "surname",
      "name",
      "department",
      "jobTitle",
      "cellphone",
      "email",
      "address",
    ],
    filters: ["department"],
    sorts: ["surname", "name", "department", "employeeNo"],
    groupBy: "none",
    rowGrain: "employee",
    exportCsv: true,
    exportExcel: false,
    exportPdf: false,
  }),
  def({
    id: "group-list",
    label: "Group List",
    entity: "group-member",
    kind: "group-list",
    dataSource: "listsRegisters.groups",
    columns: ["groupName", "surname", "name", "grade", "classroom"],
    filters: ["group"],
    sorts: ["groupName", "surname", "name"],
    groupBy: "groupName",
    rowGrain: "group-member",
    exportCsv: true,
    exportExcel: false,
    exportPdf: false,
  }),
  def({
    id: "incident-list",
    label: "Incident List",
    entity: "incident",
    kind: "incident-list",
    dataSource: "listsRegisters.incidents",
    columns: [
      "incidentDate",
      "learner",
      "grade",
      "classroom",
      "incidentType",
      "subject",
      "summary",
      "createdBy",
    ],
    filters: ["classroom"],
    sorts: ["incidentDate", "learner", "classroom"],
    groupBy: "none",
    rowGrain: "incident",
    exportCsv: true,
    exportExcel: false,
    exportPdf: false,
  }),
];

/**
 * All non-attendance catalogue defs (Phase 1 + V3 implemented + blocked).
 * Order matches historical UNIMPLEMENTED insertion order for non-phase1 items,
 * with Phase 1 first.
 */
export const COMPLETE_LIST_REGISTER_DEFS: ListRegisterDef[] = [
  ...PHASE1_LIST_REGISTER_DEFS,
  ...[
    "Allergies List",
    "Birthday Employee List",
    "Birthday Parent List",
    "Block Sheet (5 Blocks)",
    "Block Sheet (10 Blocks)",
    "Block Sheet (20 Blocks)",
    "Child List (3 Extra Fields)",
    "Child List (6 Extra Fields)",
    "Employee Attendance Register (Monthly)",
    "Employee Attendance Register (Monthly) (Weekends)",
    "Employee Attendance Register (Weekly)",
    "Employee Attendance Register (Weekly) (Weekends)",
    "Employee Attendance Time Register (Weekly)",
    "Employee Attendance Time Register (Weekly) (Weekends)",
    "Employee Contact List",
    "Future Enrolled List",
    "Group List",
    "Incident List",
  ].map((label) => {
    const found = [...V3_IMPLEMENTED_DEFS, ...BLOCKED_DEFS].find((d) => d.label === label);
    if (!found) throw new Error(`Missing list/register def for ${label}`);
    return found;
  }),
];

/** Learner attendance titles preserved via attendanceReportCatalog. */
export const LEARNER_ATTENDANCE_CATALOGUE_LABELS: string[] = [
  "Attendance List",
  "Attendance Register (Daily)",
  "Attendance Register (Monthly)",
  "Attendance Register (Monthly) (Weekends)",
  "Attendance Register (Weekly)",
  "Attendance Register (Weekly) (Weekends)",
];

/**
 * Exact visible catalogue order (phase1 + attendance + remaining), matching
 * prior SchoolDashboard LIST_REGISTER_ITEMS.
 */
export const LIST_REGISTER_CATALOGUE_LABELS: string[] = [
  ...PHASE1_LIST_REGISTER_DEFS.map((d) => d.label),
  ...LEARNER_ATTENDANCE_CATALOGUE_LABELS,
  ...COMPLETE_LIST_REGISTER_DEFS.slice(PHASE1_LIST_REGISTER_DEFS.length).map((d) => d.label),
];

/** @deprecated Use COMPLETE_LIST_REGISTER_DEFS blocked entries. */
export const UNIMPLEMENTED_LIST_REGISTER_LABELS: string[] = COMPLETE_LIST_REGISTER_DEFS.filter(
  (d) => d.status === "blocked_missing_data"
).map((d) => d.label);

export function blockedListRegisterDef(label: string, reason: string): ListRegisterDef {
  return def({
    id: `blocked:${label}`,
    label,
    entity: "learner",
    kind: "blocked",
    dataSource: "none",
    status: "blocked_missing_data",
    blockedReason: reason,
    columns: [],
    filters: [],
    sorts: [],
    groupBy: "none",
    rowGrain: "learner",
    exportCsv: false,
    exportExcel: false,
    exportPdf: false,
  });
}

/** @deprecated Prefer blockedListRegisterDef. */
export function unimplementedListRegisterDef(label: string): ListRegisterDef {
  return blockedListRegisterDef(
    label,
    "Required authoritative data does not exist for this catalogue title."
  );
}

export function getListRegisterDefById(id: string): ListRegisterDef | null {
  const found = COMPLETE_LIST_REGISTER_DEFS.find((d) => d.id === id);
  if (found) return found;
  if (id.startsWith("blocked:") || id.startsWith("unimplemented:")) {
    const label = id.includes(":") ? id.slice(id.indexOf(":") + 1) : id;
    const byLabel = getListRegisterDefByLabel(label);
    if (byLabel) return byLabel;
  }
  return null;
}

export function getListRegisterDefByLabel(label: string): ListRegisterDef | null {
  const trimmed = String(label || "").trim();
  if (!trimmed) return null;
  const found = COMPLETE_LIST_REGISTER_DEFS.find((d) => d.label === trimmed);
  if (found) return found;
  if (isLearnerAttendanceRegister(trimmed)) {
    return def({
      id: `learner-attendance:${trimmed}`,
      label: trimmed,
      entity: "learner",
      kind: "learner-attendance",
      dataSource: "attendance.learner",
      columns: [],
      filters: ["dateWindow"],
      sorts: [],
      groupBy: "none",
      rowGrain: "learner",
      exportCsv: true,
      exportExcel: true,
      exportPdf: true,
    });
  }
  return null;
}

export type CatalogueIntegrityResult = {
  label: string;
  resolution: "implemented" | "blocked_missing_data" | "learner-attendance";
  def: ListRegisterDef | null;
};

/** Every visible catalogue label must resolve to implemented, blocked, or learner-attendance. */
export function catalogueIntegrity(): CatalogueIntegrityResult[] {
  return LIST_REGISTER_CATALOGUE_LABELS.map((label) => {
    if (isLearnerAttendanceRegister(label)) {
      return { label, resolution: "learner-attendance" as const, def: getListRegisterDefByLabel(label) };
    }
    const d = getListRegisterDefByLabel(label);
    if (!d) {
      throw new Error(`Catalogue integrity: unresolved title "${label}"`);
    }
    if (d.status === "blocked_missing_data") {
      if (!d.blockedReason) {
        throw new Error(`Catalogue integrity: blocked title "${label}" missing blockedReason`);
      }
      return { label, resolution: "blocked_missing_data", def: d };
    }
    if (d.status === "implemented" && d.implemented) {
      return { label, resolution: "implemented", def: d };
    }
    throw new Error(`Catalogue integrity: title "${label}" is neither implemented nor blocked`);
  });
}

export const COLUMN_LABELS: Record<ListRegisterColumnId, string> = {
  accountNo: "Account No",
  admissionNo: "Admission No",
  surname: "Surname",
  name: "Name",
  learner: "Learner",
  grade: "Grade",
  classroom: "Classroom",
  status: "Status",
  dob: "DOB",
  age: "Age",
  birthday: "Birthday",
  guardian: "Guardian",
  relationship: "Relationship",
  primary: "Primary",
  paying: "Paying",
  cellphone: "Cellphone",
  alternate: "Alternate Contact",
  email: "Email",
  address: "Address",
  gender: "Gender",
  idNumber: "ID Number",
  parent1Contact: "Parent 1 Contact",
  parent2Contact: "Parent 2 Contact",
  enrolmentDate: "Enrolment Date",
  allergies: "Allergies",
  medicalAlert: "Medical Alert",
  linkedLearners: "Linked Learner(s)",
  employeeNo: "Employee No",
  department: "Department",
  jobTitle: "Job Title",
  groupName: "Group",
  incidentDate: "Incident Date",
  incidentType: "Type",
  subject: "Subject",
  summary: "Summary",
  createdBy: "Recorded By",
  date: "Date",
  clockIn: "Clock In",
  clockOut: "Clock Out",
  attendanceStatus: "Status",
};

export function resolveColumnLabel(col: ListRegisterColumnId, _extraFieldLabels?: string[]): string {
  return COLUMN_LABELS[col] || col;
}

export const MONTH_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "All months" },
  { value: "1", label: "January" },
  { value: "2", label: "February" },
  { value: "3", label: "March" },
  { value: "4", label: "April" },
  { value: "5", label: "May" },
  { value: "6", label: "June" },
  { value: "7", label: "July" },
  { value: "8", label: "August" },
  { value: "9", label: "September" },
  { value: "10", label: "October" },
  { value: "11", label: "November" },
  { value: "12", label: "December" },
];

export function needsListsRegistersApi(def: ListRegisterDef | null | undefined): boolean {
  if (!def || !def.implemented) return false;
  return (
    def.dataSource === "listsRegisters.employees" ||
    def.dataSource === "listsRegisters.groups" ||
    def.dataSource === "listsRegisters.incidents" ||
    def.dataSource === "listsRegisters.employeeAttendance"
  );
}

export function isEmployeeAttendanceRegister(label: string): boolean {
  const d = COMPLETE_LIST_REGISTER_DEFS.find((x) => x.label === label);
  return Boolean(
    d &&
      (d.kind === "employee-attendance" || d.kind === "employee-attendance-time") &&
      d.implemented
  );
}
