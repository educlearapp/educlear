"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.kideesysAdapter = exports.KIDEESYS_ADAPTER_METADATA = void 0;
const kideesysDetection_1 = require("./kideesysDetection");
const kideesysMetadata_1 = require("./kideesysMetadata");
Object.defineProperty(exports, "KIDEESYS_ADAPTER_METADATA", { enumerable: true, get: function () { return kideesysMetadata_1.KIDEESYS_ADAPTER_METADATA; } });
/**
 * Kid-e-Sys Adapter v1 — detection and normalization only.
 * Legacy Kid-e-Sys migration routes and services are unchanged.
 */
exports.kideesysAdapter = {
    source: "kideesys",
    async detect(files) {
        const filenames = (files || []).map((f) => String(f).trim()).filter(Boolean);
        if (filenames.length === 0)
            return false;
        return (0, kideesysDetection_1.detectKidESysExports)(filenames);
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
