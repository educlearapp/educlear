"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.genericExcelAdapter = exports.GENERIC_EXCEL_ADAPTER_METADATA = void 0;
const genericExcelDetection_1 = require("./genericExcelDetection");
const genericExcelMetadata_1 = require("./genericExcelMetadata");
Object.defineProperty(exports, "GENERIC_EXCEL_ADAPTER_METADATA", { enumerable: true, get: function () { return genericExcelMetadata_1.GENERIC_EXCEL_ADAPTER_METADATA; } });
/**
 * Generic Excel/CSV Adapter v1 — detection and normalization only.
 * Legacy migration routes and live apply logic are unchanged.
 */
exports.genericExcelAdapter = {
    source: "generic-excel",
    async detect(files) {
        const filenames = (files || []).map((f) => String(f).trim()).filter(Boolean);
        if (filenames.length === 0)
            return false;
        return (0, genericExcelDetection_1.detectGenericExcelExports)(filenames);
    },
    async parse(_files) {
        return null;
    },
    async map(_data) {
        return null;
    },
    async validate(_mapped) {
        return null;
    },
    async stage(_validated) {
        return null;
    },
};
