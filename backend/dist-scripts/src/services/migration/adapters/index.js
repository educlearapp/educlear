"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isGenericSpreadsheetFilename = exports.evaluateGenericExcelDetection = exports.detectGenericExcelExports = exports.countGenericExcelHeaderGroups = exports.isAmbiguousGenericExcelColumn = exports.genericExcelNormalizationConfidence = exports.normalizeGenericExcelColumns = exports.normalizeGenericExcelColumn = exports.GENERIC_EXCEL_UPLOAD_GUIDANCE = exports.GENERIC_EXCEL_CONFIDENCE_RULES = exports.GENERIC_EXCEL_ADAPTER_METADATA = exports.evaluateSASAMSDetection = exports.detectSASAMSExports = exports.isSASAMSAdministrativeColumn = exports.isAmbiguousSASAMSColumn = exports.sasamsNormalizationConfidence = exports.normalizeSASAMSColumns = exports.normalizeSASAMSColumn = exports.SASAMS_SUGGESTED_UPLOADS = exports.SASAMS_UPLOAD_GUIDANCE = exports.SASAMS_SUPPORTED_EXPORTS = exports.SASAMS_CONFIDENCE_RULES = exports.SASAMS_ADAPTER_METADATA = exports.normalizeKidESysContactListSheet = exports.isKidESysContactListExportFilename = exports.isKidESysContactListLayout = exports.normalizeKidESysLearnerClassListSheet = exports.isKidESysLearnerClassListLayout = exports.isKidESysClassListTitleCell = exports.evaluateKidESysDetection = exports.detectKidESysExports = exports.kidESysNormalizationConfidence = exports.normalizeKidESysColumns = exports.normalizeKidESysColumn = exports.KIDEESYS_SUPPORTED_EXPORTS = exports.KIDEESYS_CONFIDENCE_RULES = exports.KIDEESYS_ADAPTER_METADATA = exports.sasamsAdapter = exports.kideesysAdapter = exports.genericCsvAdapter = exports.genericExcelAdapter = exports.edupacAdapter = exports.edadminAdapter = exports.d6Adapter = exports.adamAdapter = exports.MIGRATION_ADAPTERS = void 0;
const adamAdapter_1 = require("./adamAdapter");
Object.defineProperty(exports, "adamAdapter", { enumerable: true, get: function () { return adamAdapter_1.adamAdapter; } });
const d6Adapter_1 = require("./d6Adapter");
Object.defineProperty(exports, "d6Adapter", { enumerable: true, get: function () { return d6Adapter_1.d6Adapter; } });
const edadminAdapter_1 = require("./edadminAdapter");
Object.defineProperty(exports, "edadminAdapter", { enumerable: true, get: function () { return edadminAdapter_1.edadminAdapter; } });
const edupacAdapter_1 = require("./edupacAdapter");
Object.defineProperty(exports, "edupacAdapter", { enumerable: true, get: function () { return edupacAdapter_1.edupacAdapter; } });
const genericExcelAdapter_1 = require("./genericExcelAdapter");
Object.defineProperty(exports, "genericExcelAdapter", { enumerable: true, get: function () { return genericExcelAdapter_1.genericExcelAdapter; } });
const genericCsvAdapter_1 = require("./genericCsvAdapter");
Object.defineProperty(exports, "genericCsvAdapter", { enumerable: true, get: function () { return genericCsvAdapter_1.genericCsvAdapter; } });
const kideesysAdapter_1 = require("./kideesysAdapter");
Object.defineProperty(exports, "kideesysAdapter", { enumerable: true, get: function () { return kideesysAdapter_1.kideesysAdapter; } });
const sasamsAdapter_1 = require("./sasamsAdapter");
Object.defineProperty(exports, "sasamsAdapter", { enumerable: true, get: function () { return sasamsAdapter_1.sasamsAdapter; } });
/** Registered source adapters for the universal migration framework. */
exports.MIGRATION_ADAPTERS = [
    kideesysAdapter_1.kideesysAdapter,
    sasamsAdapter_1.sasamsAdapter,
    d6Adapter_1.d6Adapter,
    adamAdapter_1.adamAdapter,
    edadminAdapter_1.edadminAdapter,
    edupacAdapter_1.edupacAdapter,
    genericExcelAdapter_1.genericExcelAdapter,
    genericCsvAdapter_1.genericCsvAdapter,
];
var kideesysMetadata_1 = require("./kideesysMetadata");
Object.defineProperty(exports, "KIDEESYS_ADAPTER_METADATA", { enumerable: true, get: function () { return kideesysMetadata_1.KIDEESYS_ADAPTER_METADATA; } });
Object.defineProperty(exports, "KIDEESYS_CONFIDENCE_RULES", { enumerable: true, get: function () { return kideesysMetadata_1.KIDEESYS_CONFIDENCE_RULES; } });
Object.defineProperty(exports, "KIDEESYS_SUPPORTED_EXPORTS", { enumerable: true, get: function () { return kideesysMetadata_1.KIDEESYS_SUPPORTED_EXPORTS; } });
var kideesysNormalization_1 = require("./kideesysNormalization");
Object.defineProperty(exports, "normalizeKidESysColumn", { enumerable: true, get: function () { return kideesysNormalization_1.normalizeKidESysColumn; } });
Object.defineProperty(exports, "normalizeKidESysColumns", { enumerable: true, get: function () { return kideesysNormalization_1.normalizeKidESysColumns; } });
Object.defineProperty(exports, "kidESysNormalizationConfidence", { enumerable: true, get: function () { return kideesysNormalization_1.kidESysNormalizationConfidence; } });
var kideesysDetection_1 = require("./kideesysDetection");
Object.defineProperty(exports, "detectKidESysExports", { enumerable: true, get: function () { return kideesysDetection_1.detectKidESysExports; } });
Object.defineProperty(exports, "evaluateKidESysDetection", { enumerable: true, get: function () { return kideesysDetection_1.evaluateKidESysDetection; } });
var kideesysLearnerClassListNormalization_1 = require("./kideesysLearnerClassListNormalization");
Object.defineProperty(exports, "isKidESysClassListTitleCell", { enumerable: true, get: function () { return kideesysLearnerClassListNormalization_1.isKidESysClassListTitleCell; } });
Object.defineProperty(exports, "isKidESysLearnerClassListLayout", { enumerable: true, get: function () { return kideesysLearnerClassListNormalization_1.isKidESysLearnerClassListLayout; } });
Object.defineProperty(exports, "normalizeKidESysLearnerClassListSheet", { enumerable: true, get: function () { return kideesysLearnerClassListNormalization_1.normalizeKidESysLearnerClassListSheet; } });
var kideesysContactListNormalization_1 = require("./kideesysContactListNormalization");
Object.defineProperty(exports, "isKidESysContactListLayout", { enumerable: true, get: function () { return kideesysContactListNormalization_1.isKidESysContactListLayout; } });
Object.defineProperty(exports, "isKidESysContactListExportFilename", { enumerable: true, get: function () { return kideesysContactListNormalization_1.isKidESysContactListExportFilename; } });
Object.defineProperty(exports, "normalizeKidESysContactListSheet", { enumerable: true, get: function () { return kideesysContactListNormalization_1.normalizeKidESysContactListSheet; } });
var sasamsMetadata_1 = require("./sasamsMetadata");
Object.defineProperty(exports, "SASAMS_ADAPTER_METADATA", { enumerable: true, get: function () { return sasamsMetadata_1.SASAMS_ADAPTER_METADATA; } });
Object.defineProperty(exports, "SASAMS_CONFIDENCE_RULES", { enumerable: true, get: function () { return sasamsMetadata_1.SASAMS_CONFIDENCE_RULES; } });
Object.defineProperty(exports, "SASAMS_SUPPORTED_EXPORTS", { enumerable: true, get: function () { return sasamsMetadata_1.SASAMS_SUPPORTED_EXPORTS; } });
Object.defineProperty(exports, "SASAMS_UPLOAD_GUIDANCE", { enumerable: true, get: function () { return sasamsMetadata_1.SASAMS_UPLOAD_GUIDANCE; } });
Object.defineProperty(exports, "SASAMS_SUGGESTED_UPLOADS", { enumerable: true, get: function () { return sasamsMetadata_1.SASAMS_SUGGESTED_UPLOADS; } });
var sasamsNormalization_1 = require("./sasamsNormalization");
Object.defineProperty(exports, "normalizeSASAMSColumn", { enumerable: true, get: function () { return sasamsNormalization_1.normalizeSASAMSColumn; } });
Object.defineProperty(exports, "normalizeSASAMSColumns", { enumerable: true, get: function () { return sasamsNormalization_1.normalizeSASAMSColumns; } });
Object.defineProperty(exports, "sasamsNormalizationConfidence", { enumerable: true, get: function () { return sasamsNormalization_1.sasamsNormalizationConfidence; } });
Object.defineProperty(exports, "isAmbiguousSASAMSColumn", { enumerable: true, get: function () { return sasamsNormalization_1.isAmbiguousSASAMSColumn; } });
Object.defineProperty(exports, "isSASAMSAdministrativeColumn", { enumerable: true, get: function () { return sasamsNormalization_1.isSASAMSAdministrativeColumn; } });
var sasamsDetection_1 = require("./sasamsDetection");
Object.defineProperty(exports, "detectSASAMSExports", { enumerable: true, get: function () { return sasamsDetection_1.detectSASAMSExports; } });
Object.defineProperty(exports, "evaluateSASAMSDetection", { enumerable: true, get: function () { return sasamsDetection_1.evaluateSASAMSDetection; } });
var genericExcelMetadata_1 = require("./genericExcelMetadata");
Object.defineProperty(exports, "GENERIC_EXCEL_ADAPTER_METADATA", { enumerable: true, get: function () { return genericExcelMetadata_1.GENERIC_EXCEL_ADAPTER_METADATA; } });
Object.defineProperty(exports, "GENERIC_EXCEL_CONFIDENCE_RULES", { enumerable: true, get: function () { return genericExcelMetadata_1.GENERIC_EXCEL_CONFIDENCE_RULES; } });
Object.defineProperty(exports, "GENERIC_EXCEL_UPLOAD_GUIDANCE", { enumerable: true, get: function () { return genericExcelMetadata_1.GENERIC_EXCEL_UPLOAD_GUIDANCE; } });
var genericExcelNormalization_1 = require("./genericExcelNormalization");
Object.defineProperty(exports, "normalizeGenericExcelColumn", { enumerable: true, get: function () { return genericExcelNormalization_1.normalizeGenericExcelColumn; } });
Object.defineProperty(exports, "normalizeGenericExcelColumns", { enumerable: true, get: function () { return genericExcelNormalization_1.normalizeGenericExcelColumns; } });
Object.defineProperty(exports, "genericExcelNormalizationConfidence", { enumerable: true, get: function () { return genericExcelNormalization_1.genericExcelNormalizationConfidence; } });
Object.defineProperty(exports, "isAmbiguousGenericExcelColumn", { enumerable: true, get: function () { return genericExcelNormalization_1.isAmbiguousGenericExcelColumn; } });
Object.defineProperty(exports, "countGenericExcelHeaderGroups", { enumerable: true, get: function () { return genericExcelNormalization_1.countGenericExcelHeaderGroups; } });
var genericExcelDetection_1 = require("./genericExcelDetection");
Object.defineProperty(exports, "detectGenericExcelExports", { enumerable: true, get: function () { return genericExcelDetection_1.detectGenericExcelExports; } });
Object.defineProperty(exports, "evaluateGenericExcelDetection", { enumerable: true, get: function () { return genericExcelDetection_1.evaluateGenericExcelDetection; } });
Object.defineProperty(exports, "isGenericSpreadsheetFilename", { enumerable: true, get: function () { return genericExcelDetection_1.isGenericSpreadsheetFilename; } });
