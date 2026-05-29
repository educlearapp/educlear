"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sasamsAdapter = exports.SASAMS_ADAPTER_METADATA = void 0;
const sasamsDetection_1 = require("./sasamsDetection");
const sasamsMetadata_1 = require("./sasamsMetadata");
Object.defineProperty(exports, "SASAMS_ADAPTER_METADATA", { enumerable: true, get: function () { return sasamsMetadata_1.SASAMS_ADAPTER_METADATA; } });
/**
 * SA-SAMS Adapter v1 — detection and normalization for Universal Migration.
 * Da Silva staged import uses `sasamsParsers.ts` + phased scripts (SA-SAMS base, Kid-e-Sys billing).
 */
exports.sasamsAdapter = {
    source: "sasams",
    async detect(files) {
        const filenames = (files || []).map((f) => String(f).trim()).filter(Boolean);
        if (filenames.length === 0)
            return false;
        return (0, sasamsDetection_1.detectSASAMSExports)(filenames);
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
