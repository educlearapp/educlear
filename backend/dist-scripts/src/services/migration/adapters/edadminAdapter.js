"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.edadminAdapter = void 0;
exports.edadminAdapter = {
    source: "edadmin",
    async detect(_files) {
        // TODO: Detect Ed-admin export formats.
        return false;
    },
    async parse(_files) {
        // TODO: Parse Ed-admin exports.
        return null;
    },
    async map(_data) {
        // TODO: Map Ed-admin data to EduClear entities.
        return null;
    },
    async validate(_mapped) {
        // TODO: Validate Ed-admin mapped payload.
        return null;
    },
    async stage(_validated) {
        // TODO: Stage Ed-admin migration bundle.
        return null;
    },
};
