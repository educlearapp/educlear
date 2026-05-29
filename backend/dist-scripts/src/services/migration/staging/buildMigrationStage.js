"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EMPTY_TRANSACTION_READINESS = void 0;
exports.enrichKidESysTransactionDateMappings = enrichKidESysTransactionDateMappings;
exports.buildMigrationStage = buildMigrationStage;
exports.migrationTargetCategory = migrationTargetCategory;
const crypto_1 = require("crypto");
const computeTransactionReadiness_1 = require("../core/computeTransactionReadiness");
const MigrationTargetField_1 = require("../types/MigrationTargetField");
const EMPTY_TRANSACTION_READINESS = {
    historicalOnlyTransactions: 0,
    eligibleActiveTransactions: 0,
    blockedTransactions: 0,
    unmatchedTransactions: 0,
};
exports.EMPTY_TRANSACTION_READINESS = EMPTY_TRANSACTION_READINESS;
const LEARNER_FIELDS = new Set(MigrationTargetField_1.LEARNER_TARGET_FIELDS);
const PARENT_FIELDS = new Set(MigrationTargetField_1.PARENT_TARGET_FIELDS);
const BILLING_FIELDS = new Set(MigrationTargetField_1.BILLING_TARGET_FIELDS);
const TRANSACTION_FIELDS = new Set(MigrationTargetField_1.TRANSACTION_TARGET_FIELDS);
/** Ensure transaction_list Date column maps when present (Kid-e-Sys export header). */
function enrichKidESysTransactionDateMappings(previews, mappings) {
    const previewByFileId = new Map(previews.map((p) => [p.fileId, p]));
    return mappings.map((fileMappings) => {
        const preview = previewByFileId.get(fileMappings.fileId);
        if (!preview || String(preview.category || "").trim() !== "transactions") {
            return fileMappings;
        }
        const existing = fileMappings.mappings ?? [];
        if (existing.some((m) => String(m.targetField || "").trim() === "transactionDate")) {
            return fileMappings;
        }
        const dateColumn = (preview.columns ?? []).find((col) => String(col || "").trim().toLowerCase() === "date");
        if (!dateColumn)
            return fileMappings;
        return {
            ...fileMappings,
            mappings: [
                ...existing,
                { sourceColumn: dateColumn, targetField: "transactionDate" },
            ],
        };
    });
}
function computeStagedCounts(previews) {
    const counts = {
        learners: 0,
        parents: 0,
        billingAccounts: 0,
        transactions: 0,
        staff: 0,
        historical: 0,
    };
    for (const preview of previews) {
        const rowCount = Math.max(0, Number(preview.rowCount) || 0);
        if (rowCount === 0)
            continue;
        const category = String(preview.category || "").trim();
        switch (category) {
            case "learners":
                counts.learners += rowCount;
                break;
            case "parents":
                counts.parents += rowCount;
                break;
            case "billing":
                counts.billingAccounts += rowCount;
                break;
            case "transactions":
                counts.transactions += rowCount;
                break;
            case "staff":
                counts.staff += rowCount;
                break;
            case "historical":
                counts.historical += rowCount;
                break;
            default:
                break;
        }
    }
    return counts;
}
function collectWarnings(previews, issues) {
    const seen = new Set();
    const warnings = [];
    const push = (msg) => {
        const trimmed = msg.trim();
        if (!trimmed || seen.has(trimmed))
            return;
        seen.add(trimmed);
        warnings.push(trimmed);
    };
    for (const preview of previews) {
        for (const w of preview.warnings ?? []) {
            push(`${preview.filename}: ${w}`);
        }
    }
    for (const issue of issues ?? []) {
        if (issue.severity === "warning") {
            push(`${issue.filename} (row ${issue.rowNumber}): ${issue.message}`);
        }
    }
    return warnings;
}
function normalizeCutoverDate(raw) {
    const s = String(raw || "").trim();
    if (!s)
        return undefined;
    const d = new Date(s);
    if (Number.isNaN(d.getTime()))
        return undefined;
    return d.toISOString().slice(0, 10);
}
function buildMigrationStage(input) {
    const sourceSystem = String(input.sourceSystem || "").trim() || "unknown";
    const previews = input.previews ?? [];
    const mappings = input.mappings ?? [];
    const validationSummary = input.validationSummary;
    const cutoverDate = normalizeCutoverDate(input.cutoverDate);
    const rowsByFileId = input.rowsByFileId ??
        new Map(previews.map((p) => [p.fileId, p.sampleRows ?? []]));
    const effectiveMappings = enrichKidESysTransactionDateMappings(previews, mappings);
    const stagedCounts = computeStagedCounts(previews);
    const transactionReadiness = (0, computeTransactionReadiness_1.computeTransactionReadiness)({
        previews,
        mappings: effectiveMappings,
        rowsByFileId,
        cutoverDate,
    });
    const warnings = collectWarnings(previews, input.issues);
    if (transactionReadiness.historicalOnlyTransactions > 0) {
        warnings.push("Historical learner transactions are preserved for history only and will not affect active head count or new billing.");
    }
    return {
        stageId: (0, crypto_1.randomUUID)(),
        createdAt: new Date().toISOString(),
        sourceSystem,
        ...(cutoverDate ? { cutoverDate } : {}),
        files: previews.map((p) => {
            const pathValue = String(p.path || "").trim();
            return {
                fileId: p.fileId,
                filename: p.filename,
                category: p.category,
                rowCount: Math.max(0, Number(p.rowCount) || 0),
                ...(pathValue ? { path: pathValue } : {}),
            };
        }),
        mappings: effectiveMappings,
        validationSummary,
        stagedCounts,
        transactionReadiness,
        warnings,
        canApply: validationSummary.canProceed,
    };
}
/** Classify a mapped target field (for tests / tooling). */
function migrationTargetCategory(field) {
    if (LEARNER_FIELDS.has(field))
        return "learner";
    if (PARENT_FIELDS.has(field))
        return "parent";
    if (BILLING_FIELDS.has(field))
        return "billing";
    if (TRANSACTION_FIELDS.has(field))
        return "transaction";
    return "other";
}
