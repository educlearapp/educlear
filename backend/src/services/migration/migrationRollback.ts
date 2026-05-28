import fs from "fs";
import path from "path";
import { rollbackMigrationBatch, MigrationRollbackError } from "./core/rollbackMigrationBatch";
import { restoreMigrationSchoolBackup } from "./migrationSchoolBackup";
import { migrationSchoolBackupsDir } from "./migrationProjectPaths";
import type { MigrationRollbackResult } from "./migrationTypes";

export type MigrationRollbackInput = {
  schoolId: string;
  projectId: string;
  batchId?: string;
  backupFilename?: string;
  restoreFromBackup?: boolean;
};

export async function runMigrationRollback(
  input: MigrationRollbackInput
): Promise<MigrationRollbackResult> {
  let batchRolledBack = false;
  let backupRestored = false;
  const messages: string[] = [];

  if (input.batchId) {
    try {
      await rollbackMigrationBatch({
        batchId: input.batchId,
        targetSchoolId: input.schoolId,
        confirmationText: "CONFIRM",
      });
      batchRolledBack = true;
      messages.push(`Rolled back import batch ${input.batchId}`);
    } catch (e) {
      if (e instanceof MigrationRollbackError) {
        messages.push(`Batch rollback: ${e.message}`);
      } else {
        throw e;
      }
    }
  }

  if (input.restoreFromBackup) {
    const backupPath = resolveProjectBackupPath(
      input.schoolId,
      input.projectId,
      input.backupFilename
    );
    if (!backupPath) {
      throw new Error(
        `No backup found for project ${input.projectId} under ${migrationSchoolBackupsDir(input.schoolId)}`
      );
    }
    await restoreMigrationSchoolBackup(backupPath);
    backupRestored = true;
    messages.push(`Restored school data from ${path.basename(backupPath)}`);
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

function resolveProjectBackupPath(
  schoolId: string,
  projectId: string,
  backupFilename?: string
): string | null {
  const dir = migrationSchoolBackupsDir(schoolId);
  if (!fs.existsSync(dir)) return null;

  if (backupFilename) {
    const full = path.join(dir, backupFilename);
    return fs.existsSync(full) ? full : null;
  }

  const candidates = fs
    .readdirSync(dir)
    .filter((f) => f.includes(projectId) && f.endsWith(".json"))
    .sort()
    .reverse();

  if (candidates.length === 0) return null;
  return path.join(dir, candidates[0]);
}
