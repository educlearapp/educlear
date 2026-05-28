import type { MigrationAdapter } from "../types/MigrationAdapter";
import { adamAdapter } from "./adamAdapter";
import { d6Adapter } from "./d6Adapter";
import { edadminAdapter } from "./edadminAdapter";
import { edupacAdapter } from "./edupacAdapter";
import { genericExcelAdapter } from "./genericExcelAdapter";
import { genericCsvAdapter } from "./genericCsvAdapter";
import { kideesysAdapter } from "./kideesysAdapter";
import { sasamsAdapter } from "./sasamsAdapter";

/** Registered source adapters for the universal migration framework. */
export const MIGRATION_ADAPTERS: MigrationAdapter[] = [
  kideesysAdapter,
  sasamsAdapter,
  d6Adapter,
  adamAdapter,
  edadminAdapter,
  edupacAdapter,
  genericExcelAdapter,
  genericCsvAdapter,
];

export {
  adamAdapter,
  d6Adapter,
  edadminAdapter,
  edupacAdapter,
  genericExcelAdapter,
  genericCsvAdapter,
  kideesysAdapter,
  sasamsAdapter,
};
export {
  KIDEESYS_ADAPTER_METADATA,
  KIDEESYS_CONFIDENCE_RULES,
  KIDEESYS_SUPPORTED_EXPORTS,
} from "./kideesysMetadata";
export {
  normalizeKidESysColumn,
  normalizeKidESysColumns,
  kidESysNormalizationConfidence,
} from "./kideesysNormalization";
export { detectKidESysExports, evaluateKidESysDetection } from "./kideesysDetection";
export {
  isKidESysClassListTitleCell,
  isKidESysLearnerClassListLayout,
  normalizeKidESysLearnerClassListSheet,
} from "./kideesysLearnerClassListNormalization";
export {
  isKidESysContactListLayout,
  isKidESysContactListExportFilename,
  normalizeKidESysContactListSheet,
} from "./kideesysContactListNormalization";
export {
  SASAMS_ADAPTER_METADATA,
  SASAMS_CONFIDENCE_RULES,
  SASAMS_SUPPORTED_EXPORTS,
  SASAMS_UPLOAD_GUIDANCE,
  SASAMS_SUGGESTED_UPLOADS,
} from "./sasamsMetadata";
export {
  normalizeSASAMSColumn,
  normalizeSASAMSColumns,
  sasamsNormalizationConfidence,
  isAmbiguousSASAMSColumn,
  isSASAMSAdministrativeColumn,
} from "./sasamsNormalization";
export { detectSASAMSExports, evaluateSASAMSDetection } from "./sasamsDetection";
export {
  GENERIC_EXCEL_ADAPTER_METADATA,
  GENERIC_EXCEL_CONFIDENCE_RULES,
  GENERIC_EXCEL_UPLOAD_GUIDANCE,
} from "./genericExcelMetadata";
export {
  normalizeGenericExcelColumn,
  normalizeGenericExcelColumns,
  genericExcelNormalizationConfidence,
  isAmbiguousGenericExcelColumn,
  countGenericExcelHeaderGroups,
} from "./genericExcelNormalization";
export {
  detectGenericExcelExports,
  evaluateGenericExcelDetection,
  isGenericSpreadsheetFilename,
} from "./genericExcelDetection";
