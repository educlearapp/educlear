"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.edupacAdapter = void 0;
exports.edupacAdapter = {
    source: "edupac",
    async detect(_files) {
        // TODO: Detect Edupac export formats.
        return false;
    },
    async parse(_files) {
        // TODO: Parse Edupac exports.
        return null;
    },
    async map(_data) {
        // TODO: Map Edupac data to EduClear entities.
        return null;
    },
    async validate(_mapped) {
        // TODO: Validate Edupac mapped payload.
        return null;
    },
    async stage(_validated) {
        // TODO: Stage Edupac migration bundle.
        return null;
    },
};
