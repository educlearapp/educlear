"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildColumnMappingsForPreviews = buildColumnMappingsForPreviews;
exports.mergeMappingsPreferExisting = mergeMappingsPreferExisting;
const suggestColumnMappings_1 = require("./core/suggestColumnMappings");
const migrationFileDetector_1 = require("./migrationFileDetector");
const CRITICAL_BY_GROUP = {
    learners: ["firstName", "lastName", "fullName"],
    parents: ["parentName"],
    accounts: ["accountNumber"],
    transaction_history: ["transactionDate", "amount"],
    invoices: ["amount", "transactionDate"],
    payments: ["amount", "transactionDate"],
};
function mappingConfidenceThreshold() {
    return 80;
}
function buildColumnMappingsForPreviews(previews, sourceSystem, dataGroupsByFileId) {
    const ordered = (0, migrationFileDetector_1.sortFilesByImportPriority)(previews.map((p) => ({
        preview: p,
        dataGroup: dataGroupsByFileId.get(p.fileId) ?? "unknown",
        sourceSystem,
    })));
    const suggestions = [];
    const effective = [];
    const reports = [];
    for (const { preview, dataGroup } of ordered) {
        const category = String(preview.category || "unknown");
        const systemId = sourceSystem === "generic-csv" ? "generic-excel-csv" : sourceSystem;
        const suggestion = (0, suggestColumnMappings_1.suggestColumnMappings)({
            fileId: preview.fileId,
            filename: preview.filename,
            category,
            columns: preview.columns ?? [],
            systemId: systemId === "unknown" ? undefined : systemId,
        });
        suggestions.push(suggestion);
        const mapped = suggestion.mappings
            .filter((m) => m.suggestedTarget && m.confidence >= mappingConfidenceThreshold())
            .map((m) => ({
            sourceColumn: m.sourceColumn,
            targetField: m.suggestedTarget,
        }));
        effective.push({
            fileId: preview.fileId,
            mappings: mapped,
        });
        const critical = CRITICAL_BY_GROUP[dataGroup] ?? [];
        const mappedTargets = new Set(mapped.map((m) => m.targetField));
        const missingTargets = critical.filter((t) => !mappedTargets.has(t));
        reports.push({
            fileId: preview.fileId,
            filename: preview.filename,
            dataGroup,
            mapped,
            missingTargets,
            unmappedColumns: suggestion.unmappedColumns,
        });
    }
    return { suggestions, effective, reports };
}
/** Never overwrite: only fill empty target slots from lower-priority files. */
function mergeMappingsPreferExisting(primary, secondary) {
    const byFile = new Map(primary.map((m) => [m.fileId, { ...m, mappings: [...m.mappings] }]));
    for (const file of secondary) {
        const existing = byFile.get(file.fileId);
        if (!existing) {
            byFile.set(file.fileId, file);
            continue;
        }
        const targets = new Set(existing.mappings.map((m) => m.targetField));
        for (const m of file.mappings) {
            if (!targets.has(m.targetField)) {
                existing.mappings.push(m);
                targets.add(m.targetField);
            }
        }
    }
    return [...byFile.values()];
}
