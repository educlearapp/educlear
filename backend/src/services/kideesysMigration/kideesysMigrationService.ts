import fs from "fs";
import path from "path";
import { prisma } from "../../prisma";
import {
  classifyKideesysUploadFiles,
  type ClassifiedKideesysUploads,
} from "../kideesysMigrationValidate";
import type { DaSilvaIngestPaths } from "../daSilvaMigration/daSilvaMigrationService";
import {
  commitDaSilvaMigration,
  loadDaSilvaStaging,
  previewDaSilvaMigration,
  rollbackDaSilvaMigration,
  saveDaSilvaStaging,
} from "../daSilvaMigration/daSilvaMigrationService";
import {
  buildKideesysMigrationPreview,
  createKideesysProjectId,
  type KideesysMigrationPreview,
} from "./kideesysBundleBuilder";
import {
  auditKideesysMigrationHealth,
  KideesysMigrationGateError,
  type KideesysMigrationHealthAudit,
} from "./kideesysBillingReconciliation";

const STAGING_ROOT = path.join(process.cwd(), "uploads", "migration-staging");

function previewPath(schoolId: string, projectId: string): string {
  return path.join(STAGING_ROOT, schoolId, `kideesys-${projectId}.preview.json`);
}

function reportPath(schoolId: string, projectId: string): string {
  return path.join(STAGING_ROOT, schoolId, `kideesys-${projectId}.report.json`);
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function copyUploadedFiles(
  schoolId: string,
  projectId: string,
  classified: ClassifiedKideesysUploads
): DaSilvaIngestPaths {
  const uploadRoot = path.join(STAGING_ROOT, schoolId, projectId, "uploads");
  const classDir = path.join(uploadRoot, "05_class_list");
  fs.mkdirSync(classDir, { recursive: true });

  for (const f of classified.classListFiles) {
    fs.copyFileSync(f.path, path.join(classDir, f.originalname));
  }

  const singles: Array<[Express.Multer.File, string]> = [
    [classified.contactList!, "04_contact_list.xls"],
    [classified.employees!, "06_employees.xls"],
    [classified.billingPlan!, "03_billing_plan.xls"],
    [classified.ageAnalysis!, "02_age_analysis.xls"],
    [classified.transactions!, "01_transactions.xls"],
  ];

  for (const [file, destName] of singles) {
    const dest = path.join(uploadRoot, destName);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(file.path, dest);
  }

  return {
    classListDir: classDir,
    contactList: path.join(uploadRoot, "04_contact_list.xls"),
    employees: path.join(uploadRoot, "06_employees.xls"),
    billingPlan: path.join(uploadRoot, "03_billing_plan.xls"),
    ageAnalysis: path.join(uploadRoot, "02_age_analysis.xls"),
    transactions: path.join(uploadRoot, "01_transactions.xls"),
  };
}

export function saveKideesysPreview(preview: KideesysMigrationPreview): void {
  ensureDir(path.join(STAGING_ROOT, preview.schoolId));
  fs.writeFileSync(previewPath(preview.schoolId, preview.projectId), JSON.stringify(preview, null, 2));
}

export function loadKideesysPreview(
  schoolId: string,
  projectId: string
): KideesysMigrationPreview | null {
  const file = previewPath(schoolId, projectId);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as KideesysMigrationPreview;
}

export async function validateKideesysPortalUploads(opts: {
  schoolId: string;
  projectId: string;
  files: Express.Multer.File[];
}): Promise<KideesysMigrationPreview> {
  const school = await prisma.school.findUnique({
    where: { id: opts.schoolId },
    select: { id: true, name: true },
  });
  if (!school) throw new Error("School not found");

  const classified = classifyKideesysUploadFiles(opts.files);
  const missing: string[] = [];
  if (!classified.classListFiles.length) missing.push("05_class_list (Grade_*.xls)");
  if (!classified.contactList) missing.push("04_contact_list");
  if (!classified.employees) missing.push("06_employees");
  if (!classified.billingPlan) missing.push("03_billing_plan");
  if (!classified.ageAnalysis) missing.push("02_age_analysis");
  if (!classified.transactions) missing.push("01_transactions");
  if (missing.length) {
    throw new Error(`Missing Kid-e-Sys export file(s): ${missing.join("; ")}`);
  }

  const paths = copyUploadedFiles(opts.schoolId, opts.projectId, classified);
  const preview = buildKideesysMigrationPreview({
    schoolId: opts.schoolId,
    projectId: opts.projectId,
    paths,
  });

  await saveDaSilvaStaging(preview.bundle);
  saveKideesysPreview(preview);

  return preview;
}

export async function getKideesysStagingSummary(
  schoolId: string,
  projectId: string
): Promise<KideesysMigrationPreview | null> {
  const preview = loadKideesysPreview(schoolId, projectId);
  if (preview) return preview;
  const bundle = loadDaSilvaStaging(schoolId, projectId);
  if (!bundle) return null;
  return buildKideesysMigrationPreview({
    schoolId,
    projectId,
    paths: {
      classListDir: path.join(STAGING_ROOT, schoolId, projectId, "uploads", "05_class_list"),
      contactList: path.join(STAGING_ROOT, schoolId, projectId, "uploads", "04_contact_list.xls"),
      employees: path.join(STAGING_ROOT, schoolId, projectId, "uploads", "06_employees.xls"),
      billingPlan: path.join(STAGING_ROOT, schoolId, projectId, "uploads", "03_billing_plan.xls"),
      ageAnalysis: path.join(STAGING_ROOT, schoolId, projectId, "uploads", "02_age_analysis.xls"),
      transactions: path.join(STAGING_ROOT, schoolId, projectId, "uploads", "01_transactions.xls"),
    },
  });
}

export async function approveKideesysImport(opts: {
  schoolId: string;
  projectId: string;
  confirmToken: string;
}): Promise<{ approved: boolean; preview: KideesysMigrationPreview }> {
  const preview = loadKideesysPreview(opts.schoolId, opts.projectId);
  if (!preview) throw new Error("Staging not found — upload and validate first");
  if (preview.confirmToken !== opts.confirmToken) {
    throw new Error("Confirm token mismatch — re-run validation");
  }
  if (!preview.canApply) {
    throw new Error("Cannot approve while blocking errors remain");
  }
  return { approved: true, preview };
}

export async function applyKideesysImport(opts: {
  schoolId: string;
  projectId: string;
  confirmToken: string;
}): Promise<{
  success: boolean;
  imported: Record<string, number>;
  report: KideesysMigrationPostImportReport;
}> {
  const approved = await approveKideesysImport(opts);

  let result: Awaited<ReturnType<typeof commitDaSilvaMigration>>;
  try {
    result = await commitDaSilvaMigration({
      schoolId: opts.schoolId,
      projectId: opts.projectId,
      confirmToken: approved.preview.bundle.confirmToken,
    });
  } catch (e) {
    if (e instanceof KideesysMigrationGateError) {
      const failedReport: KideesysMigrationPostImportReport = {
        projectId: opts.projectId,
        schoolId: opts.schoolId,
        importedAt: new Date().toISOString(),
        imported: {},
        activeLearnersInDb: 0,
        historicalLearnersInDb: 0,
        reconciliation: approved.preview.bundle.reconciliation.totals,
        balanceVarianceCount: approved.preview.balanceValidation.varianceCount,
        billingHealth: e.audit,
        success: false,
      };
      ensureDir(path.join(STAGING_ROOT, opts.schoolId));
      fs.writeFileSync(
        reportPath(opts.schoolId, opts.projectId),
        JSON.stringify(failedReport, null, 2)
      );
      throw new Error(e.message);
    }
    throw e;
  }

  const activeDb = await prisma.learner.count({
    where: { schoolId: opts.schoolId, enrollmentStatus: "ACTIVE" },
  });
  const historicalDb = await prisma.learner.count({
    where: { schoolId: opts.schoolId, enrollmentStatus: "HISTORICAL" },
  });

  const billingHealth = await auditKideesysMigrationHealth(
    opts.schoolId,
    approved.preview.bundle
  );

  const report: KideesysMigrationPostImportReport = {
    projectId: opts.projectId,
    schoolId: opts.schoolId,
    importedAt: new Date().toISOString(),
    imported: result.imported,
    activeLearnersInDb: activeDb,
    historicalLearnersInDb: historicalDb,
    reconciliation: approved.preview.bundle.reconciliation.totals,
    balanceVarianceCount: approved.preview.balanceValidation.varianceCount,
    billingHealth,
    success: true,
  };

  ensureDir(path.join(STAGING_ROOT, opts.schoolId));
  fs.writeFileSync(reportPath(opts.schoolId, opts.projectId), JSON.stringify(report, null, 2));

  return { success: true, imported: result.imported, report };
}

export type KideesysMigrationPostImportReport = {
  projectId: string;
  schoolId: string;
  importedAt: string;
  imported: Record<string, number>;
  activeLearnersInDb: number;
  historicalLearnersInDb: number;
  reconciliation: {
    totalLearners: number;
    totalParents: number;
    totalClasses: number;
    totalInvoices: number;
    totalPayments: number;
    totalInvoiceAmount: number;
    totalPaymentAmount: number;
    totalOutstandingBalance: number;
  };
  balanceVarianceCount: number;
  billingHealth?: KideesysMigrationHealthAudit;
  success: boolean;
};

export function loadKideesysPostImportReport(
  schoolId: string,
  projectId: string
): KideesysMigrationPostImportReport | null {
  const file = reportPath(schoolId, projectId);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as KideesysMigrationPostImportReport;
}

export async function purgeSchoolForKideesysReimport(schoolId: string): Promise<{
  success: boolean;
  prismaRemoved: Record<string, number>;
  jsonStores: Array<{ file: string; action: string; detail: string }>;
  stagingCleared: boolean;
}> {
  const { purgeImportedSchoolData, clearJsonStoresForSchools } = await import(
    "../schoolImportPurge"
  );

  const prismaRemoved = await purgeImportedSchoolData(schoolId);
  const jsonStores = clearJsonStoresForSchools([schoolId]);

  const stagingDir = path.join(STAGING_ROOT, schoolId);
  let stagingCleared = false;
  if (fs.existsSync(stagingDir)) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    stagingCleared = true;
  }

  return { success: true, prismaRemoved, jsonStores, stagingCleared };
}

export async function rollbackKideesysImport(opts: {
  schoolId: string;
  projectId: string;
}): Promise<{ success: boolean; removed: Record<string, number> }> {
  return rollbackDaSilvaMigration(opts);
}

export { createKideesysProjectId };
