"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALL_MIGRATION_TARGET_FIELDS = exports.TRANSACTION_TARGET_FIELDS = exports.BILLING_TARGET_FIELDS = exports.PARENT_TARGET_FIELDS = exports.LEARNER_TARGET_FIELDS = void 0;
exports.LEARNER_TARGET_FIELDS = [
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
];
exports.PARENT_TARGET_FIELDS = [
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
];
exports.BILLING_TARGET_FIELDS = [
    "accountNumber",
    "accountName",
    "openingBalance",
    "currentBalance",
    "feeAmount",
    "billingPlan",
];
exports.TRANSACTION_TARGET_FIELDS = [
    "transactionDate",
    "transactionType",
    "reference",
    "description",
    "debit",
    "credit",
    "amount",
    "balance",
];
exports.ALL_MIGRATION_TARGET_FIELDS = [
    ...exports.LEARNER_TARGET_FIELDS,
    ...exports.PARENT_TARGET_FIELDS,
    ...exports.BILLING_TARGET_FIELDS,
    ...exports.TRANSACTION_TARGET_FIELDS,
];
