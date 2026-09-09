/** Typed Lists & Registers catalogue — Phase 1 roster reports + unimplemented stubs. */

export type ListRegisterKind =
  | "roster"
  | "class-roster"
  | "contact"
  | "address"
  | "age"
  | "birthday"
  | "unimplemented";

export type ListRegisterColumnId =
  | "accountNo"
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
  | "cellphone"
  | "alternate"
  | "email"
  | "address";

export type ListRegisterSortId =
  | "surname"
  | "name"
  | "classroom"
  | "grade"
  | "dob"
  | "birthday"
  | "guardian"
  | "learner";

export type ListRegisterFilterId = "classroom" | "grade" | "month" | "hasAddress";

export type ListRegisterGroupBy = "none" | "classroom" | "birthdayMonth";

export type ListRegisterDef = {
  id: string;
  label: string;
  entity: "learner";
  kind: ListRegisterKind;
  dataSource: "registrations.learners" | "none";
  columns: ListRegisterColumnId[];
  filters: ListRegisterFilterId[];
  sorts: ListRegisterSortId[];
  groupBy: ListRegisterGroupBy;
  exportCsv: boolean;
  exportExcel: boolean;
  exportPdf: boolean;
  implemented: boolean;
};

export const PHASE1_LIST_REGISTER_DEFS: ListRegisterDef[] = [
  {
    id: "child-list",
    label: "Child List",
    entity: "learner",
    kind: "roster",
    dataSource: "registrations.learners",
    columns: ["accountNo", "surname", "name", "grade", "classroom", "status"],
    filters: ["classroom", "grade"],
    sorts: ["surname", "name", "classroom", "grade"],
    groupBy: "none",
    exportCsv: true,
    exportExcel: false,
    exportPdf: false,
    implemented: true,
  },
  {
    id: "class-list",
    label: "Class List",
    entity: "learner",
    kind: "class-roster",
    dataSource: "registrations.learners",
    columns: ["accountNo", "surname", "name", "grade", "status"],
    filters: ["classroom"],
    sorts: ["surname", "name"],
    groupBy: "classroom",
    exportCsv: true,
    exportExcel: false,
    exportPdf: false,
    implemented: true,
  },
  {
    id: "contact-list",
    label: "Contact List",
    entity: "learner",
    kind: "contact",
    dataSource: "registrations.learners",
    columns: [
      "accountNo",
      "learner",
      "grade",
      "classroom",
      "guardian",
      "relationship",
      "cellphone",
      "alternate",
      "email",
    ],
    filters: ["classroom"],
    sorts: ["learner", "guardian"],
    groupBy: "none",
    exportCsv: true,
    exportExcel: false,
    exportPdf: false,
    implemented: true,
  },
  {
    id: "address-list",
    label: "Address List",
    entity: "learner",
    kind: "address",
    dataSource: "registrations.learners",
    columns: ["accountNo", "learner", "grade", "classroom", "guardian", "address"],
    filters: ["hasAddress"],
    sorts: ["learner", "classroom"],
    groupBy: "none",
    exportCsv: true,
    exportExcel: false,
    exportPdf: false,
    implemented: true,
  },
  {
    id: "age-list",
    label: "Age List",
    entity: "learner",
    kind: "age",
    dataSource: "registrations.learners",
    columns: ["accountNo", "surname", "name", "dob", "age", "grade", "classroom"],
    filters: ["classroom"],
    sorts: ["dob", "surname", "classroom"],
    groupBy: "none",
    exportCsv: true,
    exportExcel: false,
    exportPdf: false,
    implemented: true,
  },
  {
    id: "birthday-child-list",
    label: "Birthday Child List",
    entity: "learner",
    kind: "birthday",
    dataSource: "registrations.learners",
    columns: ["accountNo", "surname", "name", "birthday", "grade", "classroom"],
    filters: ["month"],
    sorts: ["birthday", "surname"],
    groupBy: "birthdayMonth",
    exportCsv: true,
    exportExcel: false,
    exportPdf: false,
    implemented: true,
  },
];

/** Catalogue titles that remain visible but are not yet implemented (Phase 1). */
export const UNIMPLEMENTED_LIST_REGISTER_LABELS: string[] = [
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
];

export function unimplementedListRegisterDef(label: string): ListRegisterDef {
  return {
    id: `unimplemented:${label}`,
    label,
    entity: "learner",
    kind: "unimplemented",
    dataSource: "none",
    columns: [],
    filters: [],
    sorts: [],
    groupBy: "none",
    exportCsv: false,
    exportExcel: false,
    exportPdf: false,
    implemented: false,
  };
}

export function getListRegisterDefById(id: string): ListRegisterDef | null {
  const phase1 = PHASE1_LIST_REGISTER_DEFS.find((d) => d.id === id);
  if (phase1) return phase1;
  if (id.startsWith("unimplemented:")) {
    return unimplementedListRegisterDef(id.slice("unimplemented:".length));
  }
  return null;
}

export function getListRegisterDefByLabel(label: string): ListRegisterDef | null {
  const phase1 = PHASE1_LIST_REGISTER_DEFS.find((d) => d.label === label);
  if (phase1) return phase1;
  if (UNIMPLEMENTED_LIST_REGISTER_LABELS.includes(label)) {
    return unimplementedListRegisterDef(label);
  }
  return null;
}

export const COLUMN_LABELS: Record<ListRegisterColumnId, string> = {
  accountNo: "Account No",
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
  cellphone: "Cellphone",
  alternate: "Alternate Contact",
  email: "Email",
  address: "Address",
};

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
