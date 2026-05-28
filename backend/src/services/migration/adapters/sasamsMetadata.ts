import type { MigrationFileCategory } from "../types/MigrationFile";
import type { MigrationTargetField } from "../types/MigrationTargetField";

/** Read-only SA-SAMS Adapter v1 metadata — no registry or live import side effects. */
export const SASAMS_ADAPTER_VERSION = "1";

export type SASAMSSupportedExport = {
  exportKey: string;
  label: string;
  description: string;
  typicalCategories: MigrationFileCategory[];
};

export const SASAMS_SUPPORTED_EXPORTS: SASAMSSupportedExport[] = [
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

export const SASAMS_SUPPORTED_FILES = [
  "Learner register",
  "Class list",
  "Parent/contact list",
  "Administrative register",
  "Educator listings (advisory only)",
] as const;

export const SASAMS_SUPPORTED_CATEGORIES: MigrationFileCategory[] = ["learners", "parents"];

export const SASAMS_CONFIDENCE_RULES = {
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
} as const;

export const SASAMS_KNOWN_LIMITATIONS = [
  "No single canonical SA-SAMS spreadsheet layout — exports differ by province, report, and school configuration.",
  "Adapter v1 does not parse, map, validate, or stage live imports; legacy migration routes are unchanged.",
  "Billing and transaction exports are not claimed or auto-detected in v1.",
  "Ambiguous headers (e.g. Parent, Contact, Register) require manual review.",
  "Educator and staff exports are recognised in filenames only — not mapped in v1.",
] as const;

/** Conservative SA-SAMS column label → EduClear target field aliases. */
export const SASAMS_KNOWN_ALIASES: Partial<Record<MigrationTargetField, string[]>> = {
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

export const SASAMS_UPLOAD_GUIDANCE =
  "Upload SA-SAMS exports or related school administration spreadsheets. EduClear will recognise common SA-SAMS terminology and suggest mappings conservatively.";

export const SASAMS_SUGGESTED_UPLOADS = [
  "Learner register",
  "Class list",
  "Parent/contact list",
  "Administrative register",
] as const;

export const SASAMS_ADAPTER_METADATA = {
  adapterId: "sasams-adapter-v1",
  version: SASAMS_ADAPTER_VERSION,
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
  supportedFiles: [...SASAMS_SUPPORTED_FILES],
  supportedCategories: [...SASAMS_SUPPORTED_CATEGORIES],
  supportedExports: [...SASAMS_SUPPORTED_EXPORTS],
  confidenceRules: { ...SASAMS_CONFIDENCE_RULES },
  knownAliases: { ...SASAMS_KNOWN_ALIASES },
  knownLimitations: [...SASAMS_KNOWN_LIMITATIONS],
  uploadGuidance: SASAMS_UPLOAD_GUIDANCE,
  suggestedUploads: [...SASAMS_SUGGESTED_UPLOADS],
} as const;
