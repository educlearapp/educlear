"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveMigrationAdapterSource = resolveMigrationAdapterSource;
exports.getMigrationAdapterForSystem = getMigrationAdapterForSystem;
const adapters_1 = require("../adapters");
/** Registry systemId → adapter `source` key when they differ. */
const SYSTEM_ID_TO_ADAPTER_SOURCE = {
    "generic-excel-csv": "generic-excel",
};
function resolveMigrationAdapterSource(systemId) {
    const trimmed = String(systemId || "").trim();
    return SYSTEM_ID_TO_ADAPTER_SOURCE[trimmed] ?? trimmed;
}
function getMigrationAdapterForSystem(systemId) {
    const source = resolveMigrationAdapterSource(systemId);
    return adapters_1.MIGRATION_ADAPTERS.find((adapter) => adapter.source === source);
}
