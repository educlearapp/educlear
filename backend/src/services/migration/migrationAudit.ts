import fs from "fs";
import path from "path";
import { prisma } from "../../prisma";
import { getImportBatch } from "./core/migrationImportBatchStore";
import { migrationProjectAuditsDir } from "./migrationProjectPaths";
import type {
  MigrationDryRunResult,
  MigrationPostImportAudit,
  MigrationValidationReport,
} from "./migrationTypes";
import type { MigrationApplyResult } from "./types/MigrationApply";

export function writeMigrationAuditJson(
  schoolId: string,
  projectId: string,
  basename: string,
  payload: unknown
): string {
  const dir = migrationProjectAuditsDir(schoolId, projectId);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, basename);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
  return filePath;
}

export function writeDryRunAudit(result: MigrationDryRunResult): string {
  return writeMigrationAuditJson(
    result.schoolId,
    result.projectId,
    `dry-run-${result.dryRunId}.json`,
    result
  );
}

export function writeValidationAudit(report: MigrationValidationReport): string {
  return writeMigrationAuditJson(
    report.schoolId,
    report.projectId,
    `validation-${Date.now()}.json`,
    report
  );
}

export async function buildPostImportAudit(input: {
  schoolId: string;
  projectId: string;
  batchId: string;
  apply: MigrationApplyResult;
}): Promise<MigrationPostImportAudit> {
  const batch = getImportBatch(input.batchId);
  const [learnerCount, parentCount, familyAccountCount] = await Promise.all([
    prisma.learner.count({ where: { schoolId: input.schoolId } }),
    prisma.parent.count({ where: { schoolId: input.schoolId } }),
    prisma.familyAccount.count({ where: { schoolId: input.schoolId } }),
  ]);

  const ledgerPath = path.join(
    process.cwd(),
    "data",
    "billing-ledger.json"
  );
  let ledgerEntryCount = 0;
  if (fs.existsSync(ledgerPath)) {
    try {
      const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8")) as {
        entries?: Array<{ schoolId?: string }>;
      };
      ledgerEntryCount = (ledger.entries ?? []).filter(
        (e) => e.schoolId === input.schoolId
      ).length;
    } catch {
      ledgerEntryCount = 0;
    }
  }

  const skippedDuplicates =
    (input.apply.skippedCounts?.learners ?? 0) +
    (input.apply.skippedCounts?.parents ?? 0) +
    (input.apply.transactionOutcomes?.duplicateSkipped ?? 0);

  const audit: MigrationPostImportAudit = {
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

  writeMigrationAuditJson(
    input.schoolId,
    input.projectId,
    `post-import-${input.batchId}.json`,
    audit
  );

  return audit;
}
