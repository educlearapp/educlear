"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adamAdapter = void 0;
exports.adamAdapter = {
    source: "adam",
    async detect(_files) {
        // TODO: Detect ADAM export formats.
        return false;
    },
    async parse(_files) {
        // TODO: Parse ADAM exports.
        return null;
    },
    async map(_data) {
        // TODO: Map ADAM data to EduClear entities.
        return null;
    },
    async validate(_mapped) {
        // TODO: Validate ADAM mapped payload.
        return null;
    },
    async stage(_validated) {
        // TODO: Stage ADAM migration bundle.
        return null;
    },
};
