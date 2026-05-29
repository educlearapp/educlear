"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.d6Adapter = void 0;
exports.d6Adapter = {
    source: "d6",
    async detect(_files) {
        // TODO: Detect d6 school management exports.
        return false;
    },
    async parse(_files) {
        // TODO: Parse d6 exports.
        return null;
    },
    async map(_data) {
        // TODO: Map d6 data to EduClear entities.
        return null;
    },
    async validate(_mapped) {
        // TODO: Validate d6 mapped payload.
        return null;
    },
    async stage(_validated) {
        // TODO: Stage d6 migration bundle.
        return null;
    },
};
