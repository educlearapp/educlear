"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SASAMS_ADAPTER_METADATA = exports.SASAMS_SUGGESTED_UPLOADS = exports.SASAMS_UPLOAD_GUIDANCE = exports.SASAMS_KNOWN_ALIASES = exports.SASAMS_KNOWN_LIMITATIONS = exports.SASAMS_CONFIDENCE_RULES = exports.SASAMS_SUPPORTED_CATEGORIES = exports.SASAMS_SUPPORTED_FILES = exports.SASAMS_SUPPORTED_EXPORTS = exports.SASAMS_ADAPTER_VERSION = void 0;
/** Read-only SA-SAMS Adapter v1 metadata — no registry or live import side effects. */
exports.SASAMS_ADAPTER_VERSION = "1";
exports.SASAMS_SUPPORTED_EXPORTS = [
    {
        exportKey: "learner-register",
        label: "Learner register",
        description: "Pupil listing with names, grade, class, and admission identifiers (layout varies by province).",
        typicalCategories: ["learners"],
    },
    {
        exportKey: "class-list",
        label: "Class list",
        description: "Per-grade or per-class learner roster exports.",
        typicalCategories: ["learners"],
    },
    {
        exportKey: "parent-contact",
        label: "Parent / contact list",
        description: "Guardian and contact details linked to learners.",
        typicalCategories: ["parents"],
    },
    {
        exportKey: "administrative-register",
        label: "Administrative register",
        description: "EMIS, admission, and register fields when included in school administration exports.",
        typicalCategories: ["learners"],
    },
];
exports.SASAMS_SUPPORTED_FILES = [
    "Learner register",
    "Class list",
    "Parent/contact list",
    "Administrative register",
    "Educator listings (advisory only)",
];
exports.SASAMS_SUPPORTED_CATEGORIES = ["learners", "parents"];
exports.SASAMS_CONFIDENCE_RULES = {
    /** Minimum filename signal score before `detect()` may return true (filenames only). */
    minFilenameScore: 4,
    /** Minimum distinct header groups (learner/parent/administrative) for column-assisted confidence. */
    minHeaderGroups: 2,
    /** Minimum share of preview columns that map via `normalizeSASAMSColumn`. */
    minNormalizedColumnRatio: 0.2,
    /** Minimum mapped columns (absolute) for column recognition pass. */
    minNormalizedColumnCount: 2,
    /** Strong SA-SAMS alias suggestion confidence (upper bound). */
    confidentMappingConfidence: 92,
    /** Ambiguous SA-SAMS alias suggestion confidence (upper bound). */
    ambiguousMappingConfidence: 80,
    /** Strong SA-SAMS alias suggestion confidence (lower bound). */
    confidentMappingConfidenceMin: 85,
    /** Ambiguous SA-SAMS alias suggestion confidence (lower bound). */
    ambiguousMappingConfidenceMin: 75,
};
exports.SASAMS_KNOWN_LIMITATIONS = [
    "No single canonical SA-SAMS spreadsheet layout — exports differ by province, report, and school configuration.",
    "Adapter v1 does not parse, map, validate, or stage live imports; legacy migration routes are unchanged.",
    "Billing and transaction exports are not claimed or auto-detected in v1.",
    "Ambiguous headers (e.g. Parent, Contact, Register) require manual review.",
    "Educator and staff exports are recognised in filenames only — not mapped in v1.",
];
/** Conservative SA-SAMS column label → EduClear target field aliases. */
exports.SASAMS_KNOWN_ALIASES = {
    fullName: ["Learner Name", "Student Name", "Pupil Name"],
    learnerNumber: ["Admission Number", "Register Number", "Learner Number"],
    grade: ["Grade", "Year", "Form"],
    classroom: ["Class", "Class Name"],
    gender: ["Gender", "Sex"],
    parentName: ["Guardian", "Parent Name", "Mother", "Father"],
    parentPhone: ["Cell", "Mobile", "Telephone"],
    admissionDate: ["Admission Date", "Date of Admission"],
    idNumber: ["EMIS", "EMIS Number"],
};
exports.SASAMS_UPLOAD_GUIDANCE = "Upload SA-SAMS exports or related school administration spreadsheets. EduClear will recognise common SA-SAMS terminology and suggest mappings conservatively.";
exports.SASAMS_SUGGESTED_UPLOADS = [
    "Learner register",
    "Class list",
    "Parent/contact list",
    "Administrative register",
];
exports.SASAMS_ADAPTER_METADATA = {
    adapterId: "sasams-adapter-v1",
    version: exports.SASAMS_ADAPTER_VERSION,
    source: "sasams",
    capabilities: {
        detection: true,
        normalization: true,
        administrativeIdentifiers: true,
        readiness: true,
        parse: false,
        map: false,
        validate: false,
        stage: false,
    },
    supportedFiles: [...exports.SASAMS_SUPPORTED_FILES],
    supportedCategories: [...exports.SASAMS_SUPPORTED_CATEGORIES],
    supportedExports: [...exports.SASAMS_SUPPORTED_EXPORTS],
    confidenceRules: { ...exports.SASAMS_CONFIDENCE_RULES },
    knownAliases: { ...exports.SASAMS_KNOWN_ALIASES },
    knownLimitations: [...exports.SASAMS_KNOWN_LIMITATIONS],
    uploadGuidance: exports.SASAMS_UPLOAD_GUIDANCE,
    suggestedUploads: [...exports.SASAMS_SUGGESTED_UPLOADS],
};
