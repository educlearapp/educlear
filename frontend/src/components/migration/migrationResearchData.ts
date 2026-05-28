export type MigrationResearchRow = {
  system: string;
  learners: string;
  parents: string;
  billing: string;
  transactions: string;
  exportType: string;
  difficulty: string;
  adapterStatus: string;
};

/** Preloaded research matrix — adapter keys align with backend `source` ids where applicable. */
export const MIGRATION_RESEARCH_ROWS: MigrationResearchRow[] = [
  {
    system: "Kid-e-Sys",
    learners: "Class lists",
    parents: "Contact list",
    billing: "Billing plan",
    transactions: "Transaction history",
    exportType: "XLS bundle",
    difficulty: "High",
    adapterStatus: "Stub",
  },
  {
    system: "SA-SAMS",
    learners: "Learner register",
    parents: "Guardian data",
    billing: "Fee structures",
    transactions: "Receipts",
    exportType: "Reports / exports",
    difficulty: "Medium",
    adapterStatus: "Stub",
  },
  {
    system: "d6",
    learners: "Learner export",
    parents: "Family contacts",
    billing: "Accounts",
    transactions: "Ledger",
    exportType: "System export",
    difficulty: "Medium",
    adapterStatus: "Stub",
  },
  {
    system: "ADAM",
    learners: "Pupil data",
    parents: "Contacts",
    billing: "Fees",
    transactions: "Payments",
    exportType: "Export files",
    difficulty: "Medium",
    adapterStatus: "Stub",
  },
  {
    system: "Ed-admin",
    learners: "Student lists",
    parents: "Parent records",
    billing: "Billing module",
    transactions: "Financial history",
    exportType: "Module export",
    difficulty: "High",
    adapterStatus: "Stub",
  },
  {
    system: "Edupac",
    learners: "Learners",
    parents: "Parents",
    billing: "Billing",
    transactions: "Transactions",
    exportType: "Spreadsheet / export",
    difficulty: "Medium",
    adapterStatus: "Stub",
  },
  {
    system: "Generic Excel/CSV",
    learners: "Configurable columns",
    parents: "Configurable columns",
    billing: "Optional sheets",
    transactions: "Optional sheets",
    exportType: "Excel / CSV",
    difficulty: "Low–Medium",
    adapterStatus: "Stub",
  },
];
