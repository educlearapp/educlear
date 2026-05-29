"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runMigrationRollback = runMigrationRollback;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const rollbackMigrationBatch_1 = require("./core/rollbackMigrationBatch");
const migrationSchoolBackup_1 = require("./migrationSchoolBackup");
const migrationProjectPaths_1 = require("./migrationProjectPaths");
async function runMigrationRollback(input) {
    let batchRolledBack = false;
    let backupRestored = false;
    const messages = [];
    if (input.batchId) {
        try {
            await (0, rollbackMigrationBatch_1.rollbackMigrationBatch)({
                batchId: input.batchId,
                targetSchoolId: input.schoolId,
                confirmationText: "CONFIRM",
            });
            batchRolledBack = true;
            messages.push(`Rolled back import batch ${input.batchId}`);
        }
        catch (e) {
            if (e instanceof rollbackMigrationBatch_1.MigrationRollbackError) {
                messages.push(`Batch rollback: ${e.message}`);
            }
            else {
                throw e;
            }
        }
    }
    if (input.restoreFromBackup) {
        const backupPath = resolveProjectBackupPath(input.schoolId, input.projectId, input.backupFilename);
        if (!backupPath) {
            throw new Error(`No backup found for project ${input.projectId} under ${(0, migrationProjectPaths_1.migrationSchoolBackupsDir)(input.schoolId)}`);
        }
        await (0, migrationSchoolBackup_1.restoreMigrationSchoolBackup)(backupPath);
        backupRestored = true;
        messages.push(`Restored school data from ${path_1.default.basename(backupPath)}`);
    }
    return {
        projectId: input.projectId,
        schoolId: input.schoolId,
        batchId: input.batchId,
        backupRestored,
        batchRolledBack,
        message: messages.join("; ") || "No rollback actions performed",
    };
}
function resolveProjectBackupPath(schoolId, projectId, backupFilename) {
    const dir = (0, migrationProjectPaths_1.migrationSchoolBackupsDir)(schoolId);
    if (!fs_1.default.existsSync(dir))
        return null;
    if (backupFilename) {
        const full = path_1.default.join(dir, backupFilename);
        return fs_1.default.existsSync(full) ? full : null;
    }
    const candidates = fs_1.default
        .readdirSync(dir)
        .filter((f) => f.includes(projectId) && f.endsWith(".json"))
        .sort()
        .reverse();
    if (candidates.length === 0)
        return null;
    return path_1.default.join(dir, candidates[0]);
}
