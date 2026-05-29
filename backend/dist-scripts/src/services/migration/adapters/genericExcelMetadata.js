"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GENERIC_EXCEL_ADAPTER_METADATA = exports.GENERIC_EXCEL_UPLOAD_GUIDANCE = exports.GENERIC_EXCEL_KNOWN_LIMITATIONS = exports.GENERIC_EXCEL_CONFIDENCE_RULES = exports.GENERIC_EXCEL_AMBIGUOUS_ALIASES = exports.GENERIC_EXCEL_ALIAS_GROUPS = exports.GENERIC_EXCEL_SUPPORTED_CATEGORIES = exports.GENERIC_EXCEL_SUGGESTED_FILE_TYPES = exports.GENERIC_EXCEL_SUPPORTED_FILE_TYPES = exports.GENERIC_EXCEL_ADAPTER_VERSION = void 0;
/** Read-only Generic Excel/CSV Adapter v1 metadata — no live import side effects. */
exports.GENERIC_EXCEL_ADAPTER_VERSION = "1";
exports.GENERIC_EXCEL_SUPPORTED_FILE_TYPES = ["csv", "xls", "xlsx"];
exports.GENERIC_EXCEL_SUGGESTED_FILE_TYPES = [
    "Learner list",
    "Parent/contact list",
    "Account/balance list",
    "Transaction/payment list",
];
exports.GENERIC_EXCEL_SUPPORTED_CATEGORIES = [
    "learners",
    "parents",
    "billing",
    "transactions",
];
exports.GENERIC_EXCEL_ALIAS_GROUPS = {
    fullName: ["Learner", "Student", "Child", "Pupil", "Name", "Full Name"],
    firstName: ["First Name", "First"],
    lastName: ["Surname", "Last Name"],
    grade: ["Grade", "Year", "Form"],
    classroom: ["Class", "Classroom", "Register"],
    gender: ["Gender", "Sex"],
    dateOfBirth: ["Date of Birth", "DOB", "Birth Date"],
    idNumber: ["ID Number", "Identity Number"],
    status: ["Status", "Enrolment"],
    parentName: ["Parent", "Guardian", "Mother", "Father", "Contact"],
    parentEmail: ["Email", "E-mail"],
    parentPhone: ["Cellphone", "Cell", "Mobile", "Phone", "Tel"],
    address: ["Address", "Street"],
    accountNumber: ["Account", "Account Number", "Family Account"],
    currentBalance: ["Balance", "Outstanding", "Amount Due"],
    feeAmount: ["Fees", "Monthly Fee"],
    transactionDate: ["Date", "Transaction Date"],
    transactionType: ["Type", "Transaction Type"],
    reference: ["Reference", "Receipt", "Invoice"],
    description: ["Description", "Details"],
    debit: ["Debit"],
    credit: ["Credit", "Paid", "Payment"],
    amount: ["Amount"],
    balance: ["Balance", "Running Balance"],
};
exports.GENERIC_EXCEL_AMBIGUOUS_ALIASES = [
    "name",
    "contact",
    "type",
    "date",
    "class",
    "balance",
    "amount",
    "paid",
    "payment",
];
exports.GENERIC_EXCEL_CONFIDENCE_RULES = {
    /** Minimum distinct header groups for column-assisted detect pass. */
    minHeaderGroups: 1,
    /** Minimum share of preview columns that map via generic normalization. */
    minNormalizedColumnRatio: 0.15,
    /** Minimum mapped columns (absolute) for field recognition pass. */
    minNormalizedColumnCount: 1,
    /** Suggestion confidence for ambiguous aliases (manual review expected). */
    ambiguousMappingConfidence: 75,
    /** Suggestion confidence for confident exact aliases. */
    confidentMappingConfidence: 82,
    /** Minimum mapping confidence ratio for adapter test pass. */
    minMappingConfidenceRatio: 0.2,
};
exports.GENERIC_EXCEL_KNOWN_LIMITATIONS = [
    "No single canonical export layout — every school uses different column names.",
    "Ambiguous headers (e.g. Name, Contact, Type) cannot be auto-mapped with high confidence.",
    "Multi-sheet workbooks may require splitting into separate uploads.",
    "Merged cells, title rows, and blank header rows reduce preview quality.",
    "Parse, map, validate, and stage are not enabled in adapter v1.",
    "Legacy per-system migration routes are unchanged.",
];
exports.GENERIC_EXCEL_UPLOAD_GUIDANCE = "Upload any CSV/XLS/XLSX files. EduClear will detect columns and suggest mappings, but ambiguous fields must be reviewed manually.";
exports.GENERIC_EXCEL_ADAPTER_METADATA = {
    adapterId: "generic-excel-adapter-v1",
    version: exports.GENERIC_EXCEL_ADAPTER_VERSION,
    source: "generic-excel",
    capabilities: {
        detection: true,
        normalization: true,
        readiness: true,
        ambiguityWarnings: true,
        parse: false,
        map: false,
        validate: false,
        stage: false,
    },
    supportedFileTypes: [...exports.GENERIC_EXCEL_SUPPORTED_FILE_TYPES],
    suggestedFileTypes: [...exports.GENERIC_EXCEL_SUGGESTED_FILE_TYPES],
    supportedCategories: [...exports.GENERIC_EXCEL_SUPPORTED_CATEGORIES],
    aliasGroups: { ...exports.GENERIC_EXCEL_ALIAS_GROUPS },
    ambiguousAliases: [...exports.GENERIC_EXCEL_AMBIGUOUS_ALIASES],
    confidenceRules: { ...exports.GENERIC_EXCEL_CONFIDENCE_RULES },
    knownLimitations: [...exports.GENERIC_EXCEL_KNOWN_LIMITATIONS],
    uploadGuidance: exports.GENERIC_EXCEL_UPLOAD_GUIDANCE,
};
