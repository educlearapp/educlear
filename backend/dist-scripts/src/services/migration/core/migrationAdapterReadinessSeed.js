"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MIGRATION_ADAPTER_READINESS_SEED = void 0;
const MigrationAdapterReadinessTemplate_1 = require("../types/MigrationAdapterReadinessTemplate");
const REVIEWED_AT = "2026-05-25T00:00:00.000Z";
const VERSION = "1.0.0";
const ACCEPTED = [...MigrationAdapterReadinessTemplate_1.MIGRATION_READINESS_ACCEPTED_TYPES];
function learnersFile(required = true) {
    return {
        fileKey: "learners",
        label: "Learners / class list",
        description: "Spreadsheet or export listing pupils with name and grade or class. Filename hints: learner, student, class list.",
        required,
        acceptedTypes: ACCEPTED,
        category: "learners",
    };
}
function parentsFile(required = true) {
    return {
        fileKey: "parents",
        label: "Parents / contacts",
        description: "Guardian or contact export with at least a contact name. Filename hints: parent, guardian, contact.",
        required,
        acceptedTypes: ACCEPTED,
        category: "parents",
    };
}
function billingFile(required = false) {
    return {
        fileKey: "billing",
        label: "Billing / accounts",
        description: "Fee or account balances if available. Filename hints: billing, fee, age analysis. Optional until adapter is signed off.",
        required,
        acceptedTypes: ACCEPTED,
        category: "billing",
    };
}
function transactionsFile(required = false) {
    return {
        fileKey: "transactions",
        label: "Transactions / payments",
        description: "Payment or ledger history if available. Filename hints: transaction, payment, receipt. Optional until adapter is signed off.",
        required,
        acceptedTypes: ACCEPTED,
        category: "transactions",
    };
}
const BASE_REQUIRED_FIELDS = [
    {
        fieldKey: "learner-name",
        label: "Learner name",
        targetField: "fullName",
        required: true,
        category: "learners",
        aliases: ["learner", "student", "pupil", "child", "name", "full name"],
    },
    {
        fieldKey: "grade-or-class",
        label: "Grade or class",
        targetField: "grade",
        required: true,
        category: "learners",
        aliases: ["grade", "year", "form", "class", "classroom"],
    },
    {
        fieldKey: "parent-name",
        label: "Parent / guardian name",
        targetField: "parentName",
        required: true,
        category: "parents",
        aliases: ["parent", "guardian", "contact", "mother", "father"],
    },
];
const BASE_OPTIONAL_FIELDS = [
    {
        fieldKey: "learner-status",
        label: "Learner status",
        targetField: "status",
        required: false,
        category: "learners",
        aliases: ["status", "active", "enrolment", "enrollment"],
    },
    {
        fieldKey: "classroom",
        label: "Classroom",
        targetField: "classroom",
        required: false,
        category: "learners",
        aliases: ["class", "classroom", "register class"],
    },
    {
        fieldKey: "parent-email",
        label: "Parent email",
        targetField: "parentEmail",
        required: false,
        category: "parents",
        aliases: ["email", "e-mail"],
    },
    {
        fieldKey: "parent-phone",
        label: "Parent phone",
        targetField: "parentPhone",
        required: false,
        category: "parents",
        aliases: ["phone", "mobile", "cell", "tel"],
    },
    {
        fieldKey: "account-number",
        label: "Account number",
        targetField: "accountNumber",
        required: false,
        category: "billing",
        aliases: ["account", "account no", "debtor"],
    },
    {
        fieldKey: "account-name",
        label: "Account name",
        targetField: "accountName",
        required: false,
        category: "billing",
        aliases: ["account name", "debtor name"],
    },
    {
        fieldKey: "balance",
        label: "Balance",
        targetField: "currentBalance",
        required: false,
        category: "billing",
        aliases: ["balance", "outstanding", "amount owing"],
    },
    {
        fieldKey: "transaction-date",
        label: "Transaction date",
        targetField: "transactionDate",
        required: false,
        category: "transactions",
        aliases: ["date", "transaction date", "posted"],
    },
    {
        fieldKey: "transaction-type",
        label: "Transaction type",
        targetField: "transactionType",
        required: false,
        category: "transactions",
        aliases: ["type", "transaction type"],
    },
    {
        fieldKey: "reference",
        label: "Reference",
        targetField: "reference",
        required: false,
        category: "transactions",
        aliases: ["reference", "ref", "receipt"],
    },
    {
        fieldKey: "amount",
        label: "Amount",
        targetField: "amount",
        required: false,
        category: "transactions",
        aliases: ["amount", "debit", "credit", "value"],
    },
    {
        fieldKey: "transaction-account-link",
        label: "Account / learner link",
        targetField: "accountNumber",
        required: false,
        category: "transactions",
        aliases: ["account", "learner", "student", "debtor"],
    },
];
function buildTemplate(systemId, systemName, notes) {
    return {
        templateId: `readiness-${systemId}`,
        systemId,
        systemName,
        version: VERSION,
        requiredFiles: [
            learnersFile(true),
            parentsFile(true),
            billingFile(false),
            transactionsFile(false),
        ],
        requiredFields: BASE_REQUIRED_FIELDS.map((f) => ({ ...f })),
        optionalFields: BASE_OPTIONAL_FIELDS.map((f) => ({ ...f })),
        notes,
        lastReviewedAt: REVIEWED_AT,
    };
}
/** Conservative pre-import readiness templates — generic file/field expectations only. */
exports.MIGRATION_ADAPTER_READINESS_SEED = [
    buildTemplate("kideesys", "Kid-e-Sys", "Multi-file XLS bundles are common. Billing and transaction files are optional in this template until export layouts are formally signed off. Legacy Kid-e-Sys import paths remain unchanged."),
    buildTemplate("sasams", "SA-SAMS", "Upload SA-SAMS exports or related school administration spreadsheets. EduClear will recognise common SA-SAMS terminology and suggest mappings conservatively. Suggested uploads: learner register, class list, parent/contact list, administrative register. Billing and transactions are optional in v1."),
    buildTemplate("d6", "d6", "Module-specific exports expected. Billing and transactions are optional until d6 export patterns are documented."),
    buildTemplate("adam", "ADAM", "Pupil and contact exports expected; fee/ledger files optional until ADAM adapter research is complete."),
    buildTemplate("edadmin", "Ed-admin", "Per-module exports may be supplied separately. Billing and transactions optional until Ed-admin layouts are signed off."),
    buildTemplate("edupac", "Edupac", "Spreadsheet-oriented exports; column names vary by school. Billing and transactions optional."),
    buildTemplate("staffroom", "Staffroom", "No formal export specification yet. Learners and contacts are the minimum safe expectation; billing and transactions optional."),
    buildTemplate("cemis", "CEMIS", "Provincial MIS — access and export mechanisms under research. Learners and contacts only; billing and transactions optional."),
    buildTemplate("sims", "SIMS", "Export pathways not yet documented for EduClear. Conservative learners + contacts minimum; billing and transactions optional."),
    buildTemplate("isams", "iSAMS", "API or export options may apply. Learners and contacts minimum; billing and transactions optional until integration is scoped."),
    buildTemplate("generic-excel-csv", "Generic Excel/CSV", "Upload any CSV/XLS/XLSX files. EduClear will detect columns and suggest mappings, but ambiguous fields must be reviewed manually. Suggested uploads: learner list, parent/contact list, account/balance list, transaction/payment list. Billing and transactions optional."),
];
