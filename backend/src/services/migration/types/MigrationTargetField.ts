/** EduClear standard import target fields (Universal Migration Framework). */
export type LearnerTargetField =
  | "firstName"
  | "lastName"
  | "fullName"
  | "nickname"
  | "grade"
  | "classroom"
  | "gender"
  | "dateOfBirth"
  | "idNumber"
  | "learnerNumber"
  | "admissionDate"
  | "status"
  | "homeLanguage"
  | "citizenship"
  | "notes";

export type ParentTargetField =
  | "parentName"
  | "parentFirstName"
  | "parentSurname"
  | "parentIdNumber"
  | "parentEmail"
  | "parentPhone"
  | "parentWorkPhone"
  | "relationship"
  | "address"
  | "employer"
  | "parentNotes";

export type BillingTargetField =
  | "accountNumber"
  | "accountName"
  | "openingBalance"
  | "currentBalance"
  | "feeAmount"
  | "billingPlan";

export type TransactionTargetField =
  | "transactionDate"
  | "transactionType"
  | "reference"
  | "description"
  | "debit"
  | "credit"
  | "amount"
  | "balance";

export type MigrationTargetField =
  | LearnerTargetField
  | ParentTargetField
  | BillingTargetField
  | TransactionTargetField;

export const LEARNER_TARGET_FIELDS: readonly LearnerTargetField[] = [
  "firstName",
  "lastName",
  "fullName",
  "nickname",
  "grade",
  "classroom",
  "gender",
  "dateOfBirth",
  "idNumber",
  "learnerNumber",
  "admissionDate",
  "status",
  "homeLanguage",
  "citizenship",
  "notes",
] as const;

export const PARENT_TARGET_FIELDS: readonly ParentTargetField[] = [
  "parentName",
  "parentFirstName",
  "parentSurname",
  "parentIdNumber",
  "parentEmail",
  "parentPhone",
  "parentWorkPhone",
  "relationship",
  "address",
  "employer",
  "parentNotes",
] as const;

export const BILLING_TARGET_FIELDS: readonly BillingTargetField[] = [
  "accountNumber",
  "accountName",
  "openingBalance",
  "currentBalance",
  "feeAmount",
  "billingPlan",
] as const;

export const TRANSACTION_TARGET_FIELDS: readonly TransactionTargetField[] = [
  "transactionDate",
  "transactionType",
  "reference",
  "description",
  "debit",
  "credit",
  "amount",
  "balance",
] as const;

export const ALL_MIGRATION_TARGET_FIELDS: readonly MigrationTargetField[] = [
  ...LEARNER_TARGET_FIELDS,
  ...PARENT_TARGET_FIELDS,
  ...BILLING_TARGET_FIELDS,
  ...TRANSACTION_TARGET_FIELDS,
] as const;
