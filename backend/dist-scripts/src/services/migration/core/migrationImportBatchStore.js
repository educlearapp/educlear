"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.hydrateImportBatch = hydrateImportBatch;
exports.createMigrationImportBatch = createMigrationImportBatch;
exports.updateImportBatch = updateImportBatch;
exports.updateMigrationImportBatch = updateMigrationImportBatch;
exports.getImportBatch = getImportBatch;
exports.getMigrationImportBatch = getMigrationImportBatch;
exports.listImportBatches = listImportBatches;
exports.listImportBatchSummaries = listImportBatchSummaries;
exports.getImportBatchReportRows = getImportBatchReportRows;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = require("crypto");
const BATCHES_DIR = path_1.default.join(process.cwd(), "storage", "migration-import-batches");
function ensureBatchesDir() {
    if (!fs_1.default.existsSync(BATCHES_DIR)) {
        fs_1.default.mkdirSync(BATCHES_DIR, { recursive: true });
    }
}
function sanitizeBatchId(id) {
    const trimmed = String(id || "").trim();
    if (!trimmed)
        return null;
    if (trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\"))
        return null;
    if (!/^[a-zA-Z0-9_-]+$/.test(trimmed))
        return null;
    return trimmed;
}
function batchFilePath(id) {
    const safe = sanitizeBatchId(id);
    if (!safe)
        throw new Error("Invalid batch id");
    const resolved = path_1.default.resolve(BATCHES_DIR, `${safe}.json`);
    if (!resolved.startsWith(path_1.default.resolve(BATCHES_DIR) + path_1.default.sep)) {
        throw new Error("Invalid batch path");
    }
    return resolved;
}
function emptyCounts() {
    return {
        learners: 0,
        parents: 0,
        employees: 0,
        billingAccounts: 0,
        transactions: 0,
        classrooms: 0,
        parentLearnerLinks: 0,
    };
}
/** Normalize legacy batches that only stored counts/report on `result`. */
function hydrateImportBatch(raw) {
    const result = raw.result;
    return {
        ...raw,
        createdCounts: raw.createdCounts ?? result?.createdCounts ?? emptyCounts(),
        skippedCounts: raw.skippedCounts ?? result?.skippedCounts ?? emptyCounts(),
        failedCounts: raw.failedCounts ?? result?.failedCounts ?? emptyCounts(),
        reportRows: raw.reportRows ?? result?.report ?? [],
        completedAt: raw.completedAt ?? result?.appliedAt,
    };
}
function createMigrationImportBatch(partial) {
    ensureBatchesDir();
    const batchId = partial.batchId?.trim() || (0, crypto_1.randomUUID)();
    const safeId = sanitizeBatchId(batchId);
    if (!safeId)
        throw new Error("Invalid batch id");
    const filePath = batchFilePath(safeId);
    if (fs_1.default.existsSync(filePath)) {
        throw new Error("Import batch id already exists");
    }
    const batch = {
        batchId: safeId,
        stageId: partial.stageId,
        targetSchoolId: partial.targetSchoolId,
        targetSchoolName: partial.targetSchoolName,
        sourceSystem: partial.sourceSystem,
        status: partial.status ?? "pending",
        createdAt: new Date().toISOString(),
        stagedCounts: partial.stagedCounts,
        createdCounts: partial.createdCounts,
        skippedCounts: partial.skippedCounts,
        failedCounts: partial.failedCounts,
        reportRows: partial.reportRows,
    };
    writeBatchFile(batch);
    return batch;
}
function writeBatchFile(batch) {
    const filePath = batchFilePath(batch.batchId);
    const tmpPath = `${filePath}.${process.pid}.tmp`;
    fs_1.default.writeFileSync(tmpPath, JSON.stringify(batch, null, 2), "utf8");
    fs_1.default.renameSync(tmpPath, filePath);
}
function updateImportBatch(batchId, patch) {
    const existing = getImportBatch(batchId);
    if (!existing)
        throw new Error("Import batch not found");
    const merged = { ...existing, ...patch, batchId: existing.batchId };
    writeBatchFile(merged);
    return merged;
}
/** Full-document replace (used by apply flow). */
function updateMigrationImportBatch(batch) {
    writeBatchFile(batch);
    return hydrateImportBatch(batch);
}
function getImportBatch(batchId) {
    ensureBatchesDir();
    const safeId = sanitizeBatchId(batchId);
    if (!safeId)
        return null;
    const filePath = batchFilePath(safeId);
    if (!fs_1.default.existsSync(filePath))
        return null;
    try {
        const raw = JSON.parse(fs_1.default.readFileSync(filePath, "utf8"));
        return hydrateImportBatch(raw);
    }
    catch {
        return null;
    }
}
function getMigrationImportBatch(batchId) {
    return getImportBatch(batchId);
}
function listImportBatches() {
    ensureBatchesDir();
    const files = fs_1.default
        .readdirSync(BATCHES_DIR)
        .filter((name) => name.endsWith(".json") && !name.includes(".tmp"));
    const batches = [];
    for (const file of files) {
        const id = file.replace(/\.json$/, "");
        const batch = getImportBatch(id);
        if (batch)
            batches.push(batch);
    }
    batches.sort((a, b) => {
        const ta = new Date(a.createdAt).getTime();
        const tb = new Date(b.createdAt).getTime();
        return tb - ta;
    });
    return batches;
}
function listImportBatchSummaries() {
    return listImportBatches().map((batch) => {
        const hydrated = hydrateImportBatch(batch);
        const reportRows = hydrated.reportRows ?? [];
        const hasCreatedTransactions = reportRows.some((row) => row.status === "created" && row.entityType === "transaction");
        return {
            batchId: hydrated.batchId,
            stageId: hydrated.stageId,
            targetSchoolId: hydrated.targetSchoolId,
            targetSchoolName: hydrated.targetSchoolName,
            status: hydrated.status,
            createdAt: hydrated.createdAt,
            completedAt: hydrated.completedAt,
            rolledBackAt: hydrated.rolledBackAt,
            createdCounts: hydrated.createdCounts ?? emptyCounts(),
            skippedCounts: hydrated.skippedCounts ?? emptyCounts(),
            failedCounts: hydrated.failedCounts ?? emptyCounts(),
            hasCreatedTransactions,
        };
    });
}
function getImportBatchReportRows(batchId) {
    const batch = getImportBatch(batchId);
    return batch?.reportRows ?? [];
}
