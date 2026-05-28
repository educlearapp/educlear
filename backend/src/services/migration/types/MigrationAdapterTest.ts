/** Per-check outcome for the adapter test harness (read-only, no live DB writes). */
export type MigrationAdapterTestStatus = "pass" | "warning" | "fail" | "not_supported";

export type MigrationAdapterTestCheckId =
  | "adapter_exists"
  | "expected_files_present"
  | "required_fields_mapped"
  | "preview_available"
  | "full_validation_available"
  | "readiness_template_available"
  | "template_mappings_available"
  | "transaction_readiness_available"
  | "kideesys_naming_detected"
  | "kideesys_columns_recognized"
  | "kideesys_readiness_compatibility"
  | "kideesys_normalization_confidence"
  | "generic_spreadsheet_readable"
  | "generic_headers_detected"
  | "generic_fields_recognized"
  | "generic_ambiguous_fields_review"
  | "generic_mapping_confidence"
  | "sasams_naming_detected"
  | "sasams_columns_recognized"
  | "sasams_readiness_compatibility"
  | "sasams_normalization_confidence"
  | "sasams_administrative_identifiers";

export type MigrationAdapterTestCheck = {
  id: MigrationAdapterTestCheckId;
  label: string;
  status: MigrationAdapterTestStatus;
  message: string;
  details?: string;
};

export type MigrationAdapterTestRecommendation = "ready" | "partial" | "needs_research";

export type MigrationAdapterTestResult = {
  systemId: string;
  testedAt: string;
  overallStatus: MigrationAdapterTestStatus;
  recommendation: MigrationAdapterTestRecommendation;
  checks: MigrationAdapterTestCheck[];
  passed: MigrationAdapterTestCheck[];
  warnings: MigrationAdapterTestCheck[];
  failed: MigrationAdapterTestCheck[];
  notSupported: MigrationAdapterTestCheck[];
};
