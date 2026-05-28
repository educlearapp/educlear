export type MigrationTargetField =
  | "firstName"
  | "lastName"
  | "fullName"
  | "grade"
  | "classroom"
  | "gender"
  | "dateOfBirth"
  | "idNumber"
  | "learnerNumber"
  | "admissionDate"
  | "status"
  | "parentName"
  | "parentEmail"
  | "parentPhone"
  | "relationship"
  | "address"
  | "accountNumber"
  | "accountName"
  | "openingBalance"
  | "currentBalance"
  | "feeAmount"
  | "billingPlan"
  | "transactionDate"
  | "transactionType"
  | "reference"
  | "description"
  | "debit"
  | "credit"
  | "amount"
  | "balance";

export const MIGRATION_TARGET_FIELD_LABELS: Record<MigrationTargetField, string> = {
  firstName: "First name",
  lastName: "Last name",
  fullName: "Full name",
  grade: "Grade",
  classroom: "Classroom",
  gender: "Gender",
  dateOfBirth: "Date of birth",
  idNumber: "ID number",
  learnerNumber: "Learner / admission number",
  admissionDate: "Admission date",
  status: "Status",
  parentName: "Parent name",
  parentEmail: "Parent email",
  parentPhone: "Parent phone",
  relationship: "Relationship",
  address: "Address",
  accountNumber: "Account number",
  accountName: "Account name",
  openingBalance: "Opening balance",
  currentBalance: "Current balance",
  feeAmount: "Fee amount",
  billingPlan: "Billing plan",
  transactionDate: "Transaction date",
  transactionType: "Transaction type",
  reference: "Reference",
  description: "Description",
  debit: "Debit",
  credit: "Credit",
  amount: "Amount",
  balance: "Balance",
};

export const MIGRATION_TARGET_FIELD_GROUPS: {
  label: string;
  fields: MigrationTargetField[];
}[] = [
  {
    label: "Learner",
    fields: [
      "firstName",
      "lastName",
      "fullName",
      "grade",
      "classroom",
      "gender",
      "dateOfBirth",
      "idNumber",
      "learnerNumber",
      "admissionDate",
      "status",
    ],
  },
  {
    label: "Parent",
    fields: ["parentName", "parentEmail", "parentPhone", "relationship", "address"],
  },
  {
    label: "Billing",
    fields: [
      "accountNumber",
      "accountName",
      "openingBalance",
      "currentBalance",
      "feeAmount",
      "billingPlan",
    ],
  },
  {
    label: "Transactions",
    fields: [
      "transactionDate",
      "transactionType",
      "reference",
      "description",
      "debit",
      "credit",
      "amount",
      "balance",
    ],
  },
];

export const ALL_MIGRATION_TARGET_FIELDS: MigrationTargetField[] =
  MIGRATION_TARGET_FIELD_GROUPS.flatMap((g) => g.fields);

export const MAPPED_CONFIDENCE_THRESHOLD = 80;
