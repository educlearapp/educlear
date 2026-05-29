"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeMigrationAuditJson = writeMigrationAuditJson;
exports.writeDryRunAudit = writeDryRunAudit;
exports.writeValidationAudit = writeValidationAudit;
exports.buildPostImportAudit = buildPostImportAudit;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const prisma_1 = require("../../prisma");
const migrationImportBatchStore_1 = require("./core/migrationImportBatchStore");
const migrationProjectPaths_1 = require("./migrationProjectPaths");
function writeMigrationAuditJson(schoolId, projectId, basename, payload) {
    const dir = (0, migrationProjectPaths_1.migrationProjectAuditsDir)(schoolId, projectId);
    fs_1.default.mkdirSync(dir, { recursive: true });
    const filePath = path_1.default.join(dir, basename);
    fs_1.default.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
    return filePath;
}
function writeDryRunAudit(result) {
    return writeMigrationAuditJson(result.schoolId, result.projectId, `dry-run-${result.dryRunId}.json`, result);
}
function writeValidationAudit(report) {
    return writeMigrationAuditJson(report.schoolId, report.projectId, `validation-${Date.now()}.json`, report);
}
async function buildPostImportAudit(input) {
    const batch = (0, migrationImportBatchStore_1.getImportBatch)(input.batchId);
    const [learnerCount, parentCount, familyAccountCount] = await Promise.all([
        prisma_1.prisma.learner.count({ where: { schoolId: input.schoolId } }),
        prisma_1.prisma.parent.count({ where: { schoolId: input.schoolId } }),
        prisma_1.prisma.familyAccount.count({ where: { schoolId: input.schoolId } }),
    ]);
    const ledgerPath = path_1.default.join(process.cwd(), "data", "billing-ledger.json");
    let ledgerEntryCount = 0;
    if (fs_1.default.existsSync(ledgerPath)) {
        try {
            const ledger = JSON.parse(fs_1.default.readFileSync(ledgerPath, "utf8"));
            ledgerEntryCount = (ledger.entries ?? []).filter((e) => e.schoolId === input.schoolId).length;
        }
        catch {
            ledgerEntryCount = 0;
        }
    }
    const skippedDuplicates = (input.apply.skippedCounts?.learners ?? 0) +
        (input.apply.skippedCounts?.parents ?? 0) +
        (input.apply.transactionOutcomes?.duplicateSkipped ?? 0);
    const audit = {
        projectId: input.projectId,
        schoolId: input.schoolId,
        batchId: input.batchId,
        generatedAt: new Date().toISOString(),
        applyCounts: input.apply.createdCounts,
        learnerCount,
        parentCount,
        familyAccountCount,
        ledgerEntryCount,
        duplicateRunSafe: skippedDuplicates > 0 || batch?.status === "completed",
        checks: [
            {
                id: "learners_present",
                label: "Learners in database",
                passed: learnerCount > 0,
                detail: `${learnerCount} learners`,
            },
            {
                id: "parents_present",
                label: "Parents in database",
                passed: parentCount > 0,
                detail: `${parentCount} parents`,
            },
            {
                id: "accounts_present",
                label: "Family accounts",
                passed: familyAccountCount > 0,
                detail: `${familyAccountCount} accounts`,
            },
            {
                id: "batch_completed",
                label: "Import batch completed",
                passed: batch?.status === "completed",
                detail: batch?.status ?? "unknown",
            },
        ],
    };
    writeMigrationAuditJson(input.schoolId, input.projectId, `post-import-${input.batchId}.json`, audit);
    return audit;
}
