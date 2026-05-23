import fs from "fs";
import path from "path";
import { prisma } from "../prisma";
import type { DaSilvaMigrationBundle } from "./daSilvaMigration/daSilvaMigrationService";
import { previewDaSilvaMigration } from "./daSilvaMigration/daSilvaMigrationService";
import type {
  MigrationIssue,
  MigrationLearnerInputRow,
  MigrationValidationReport,
} from "./migrationService";
import { buildConfirmToken, saveMigrationStaging } from "./migrationService";

export type ClassifiedKideesysUploads = {
  classListFiles: Express.Multer.File[];
  contactList?: Express.Multer.File;
  employees?: Express.Multer.File;
  billingPlan?: Express.Multer.File;
  ageAnalysis?: Express.Multer.File;
  transactions?: Express.Multer.File;
  unclassified: Express.Multer.File[];
};

function normalizeFileName(name: string): string {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_");
}

function isClassListFile(name: string): boolean {
  const n = normalizeFileName(name);
  return (
    /^grade[_-]/.test(n) ||
    n.includes("class_list") ||
    n.includes("classlist") ||
    (/^grade\s*\d/.test(n) && n.endsWith(".xls"))
  );
}

function scoreTransactionFile(name: string): number {
  const n = normalizeFileName(name);
  if (!n.includes("transaction")) return -1;
  if (n.includes("backup")) return 1;
  return 10;
}

/** Classify Kid-e-Sys .xls uploads by filename heuristics (Da Silva export layout). */
export function classifyKideesysUploadFiles(files: Express.Multer.File[]): ClassifiedKideesysUploads {
  const result: ClassifiedKideesysUploads = {
    classListFiles: [],
    unclassified: [],
  };

  let bestTransaction: { file: Express.Multer.File; score: number } | null = null;

  for (const file of files) {
    const n = normalizeFileName(file.originalname || file.filename || "");
    if (!n.endsWith(".xls")) {
      result.unclassified.push(file);
      continue;
    }

    if (isClassListFile(n)) {
      result.classListFiles.push(file);
      continue;
    }

    if (n.includes("employee")) {
      result.employees = file;
      continue;
    }

    if (n.includes("contact_list") && !n.includes("employee")) {
      result.contactList = file;
      continue;
    }

    if (n.includes("billing_plan") || n.includes("billingplan")) {
      result.billingPlan = file;
      continue;
    }

    if (n.includes("age_analysis") || (n.includes("account_list") && n.includes("age"))) {
      result.ageAnalysis = file;
      continue;
    }

    const txScore = scoreTransactionFile(n);
    if (txScore >= 0) {
      if (!bestTransaction || txScore > bestTransaction.score) {
        bestTransaction = { file, score: txScore };
      }
      continue;
    }

    result.unclassified.push(file);
  }

  if (bestTransaction) {
    result.transactions = bestTransaction.file;
  }

  // Remaining .xls files are treated as class list exports (e.g. creche.xls).
  const remainingXls = result.unclassified.filter((f) =>
    normalizeFileName(f.originalname || "").endsWith(".xls")
  );
  if (remainingXls.length) {
    result.classListFiles.push(...remainingXls);
    result.unclassified = result.unclassified.filter((f) => !remainingXls.includes(f));
  }

  return result;
}

function missingKideesysSlots(classified: ClassifiedKideesysUploads): string[] {
  const missing: string[] = [];
  if (!classified.classListFiles.length) missing.push("05_class_list (Grade_*.xls class exports)");
  if (!classified.contactList) missing.push("04_contact_list (contact_list.xls)");
  if (!classified.employees) missing.push("06_employees (employee_contact_list.xls)");
  if (!classified.billingPlan) missing.push("03_billing_plan (billing_plan_summary_by_child.xls)");
  if (!classified.ageAnalysis) missing.push("02_age_analysis (account_list age analysis .xls)");
  if (!classified.transactions) missing.push("01_transactions (transaction_list.xls)");
  return missing;
}

function copyUploadedFiles(
  schoolId: string,
  projectId: string,
  classified: ClassifiedKideesysUploads
): {
  classListDir: string;
  contactList: string;
  employees: string;
  billingPlan: string;
  ageAnalysis: string;
  transactions: string;
} {
  const uploadRoot = path.join(
    process.cwd(),
    "uploads",
    "migration-staging",
    schoolId,
    projectId,
    "uploads"
  );
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

function bundleToLearnerRows(bundle: DaSilvaMigrationBundle): MigrationLearnerInputRow[] {
  return bundle.learners.map((learner, index) => ({
    rowIndex: index + 1,
    firstName: learner.firstName,
    lastName: learner.lastName,
    grade: learner.canonicalClassName.replace(/[^0-9]/g, "") || "",
    className: learner.className || learner.canonicalClassName,
    admissionNo: learner.accountNo || undefined,
    parentFirstName: learner.parents[0]?.firstName,
    parentSurname: learner.parents[0]?.surname,
    parentMobile: learner.parents[0]?.cellNo,
    parentEmail: learner.parents[0]?.email,
    relation: learner.parents[0]?.relation,
  }));
}

function bundleToValidationReport(
  bundle: DaSilvaMigrationBundle,
  schoolName: string
): MigrationValidationReport {
  const issues: MigrationIssue[] = bundle.countValidation.errors.map((err, i) => ({
    id: `kideesys-count-${i + 1}`,
    issue: err,
    severity: "error" as const,
    record: "Count validation",
    suggestedFix: "Ensure class, contact, and billing exports cover the same learners",
    status: "open" as const,
    category: "learner" as const,
  }));

  const varianceCount = bundle.reconciliation.rows.filter((r) => Math.abs(r.variance) > 0.01).length;
  if (varianceCount > 0) {
    issues.push({
      id: "kideesys-reconciliation-info",
      issue: `${varianceCount} account(s) differ between age analysis and imported ledger (review before final import)`,
      severity: "warning",
      record: "Reconciliation",
      suggestedFix: "Review variance report — count validation passed; ledger reconciliation is informational for staging",
      status: "open",
      category: "learner",
    });
  }

  const blockingErrorCount = bundle.countValidation.errors.length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;
  const learnerRows = bundleToLearnerRows(bundle);

  const normalizationPreview = bundle.classrooms.map((classroom) => ({
    matchKey: classroom.className.toLowerCase(),
    originalName: classroom.className,
    canonicalName: classroom.className,
    normalizedName: classroom.className,
    rawLabels: [classroom.className],
    detectedGrade: classroom.className.replace(/[^0-9]/g, "") || "",
    detectedClassLetter: classroom.className.replace(/[^A-Za-z]/g, "") || "",
    detectedYear: classroom.year,
    importYear: classroom.year,
    learnerCount: learnerRows.filter(
      (r) => r.className.toLowerCase() === classroom.className.toLowerCase()
    ).length,
    teacherEmail: "",
    teacherName: "",
    warnings: [] as string[],
    needsConfirmation: false,
  }));

  return {
    projectId: bundle.projectId,
    schoolId: bundle.schoolId,
    schoolName,
    source: "kideesys",
    rowCount: learnerRows.length,
    learnerCount: learnerRows.length,
    parentLinkCount: learnerRows.filter(
      (r) => r.parentMobile || r.parentIdNumber || (r.parentFirstName && r.parentSurname)
    ).length,
    classroomGroupCount: bundle.classrooms.length,
    duplicateClassrooms: [],
    duplicateLearners: [],
    missingParents: [],
    teacherAssignmentWarnings: [],
    normalizationPreview,
    issues,
    mappings: [],
    canImport: bundle.canImport,
    blockingErrorCount,
    warningCount,
  };
}

export type KideesysValidationResult = {
  projectId: string;
  report: MigrationValidationReport;
  confirmToken: string;
  daSilvaConfirmToken: string;
  stagedRows: MigrationLearnerInputRow[];
  countValidation: DaSilvaMigrationBundle["countValidation"];
  summary: DaSilvaMigrationBundle["reconciliation"]["totals"];
};

export async function validateKideesysMigrationUploads(opts: {
  schoolId: string;
  projectId: string;
  files: Express.Multer.File[];
}): Promise<KideesysValidationResult> {
  const school = await prisma.school.findUnique({
    where: { id: opts.schoolId },
    select: { id: true, name: true },
  });
  if (!school) throw new Error("School not found");

  const classified = classifyKideesysUploadFiles(opts.files);
  const missing = missingKideesysSlots(classified);
  if (missing.length) {
    throw new Error(
      `Missing Kid-e-Sys export file(s): ${missing.join("; ")}. Upload all six export groups before validating.`
    );
  }

  const paths = copyUploadedFiles(opts.schoolId, opts.projectId, classified);
  const bundle = await previewDaSilvaMigration({
    schoolId: opts.schoolId,
    projectId: opts.projectId,
    paths,
  });

  const report = bundleToValidationReport(bundle, school.name);
  const stagedRows = bundleToLearnerRows(bundle);
  const confirmToken = buildConfirmToken(opts.projectId, report);

  await saveMigrationStaging({
    projectId: opts.projectId,
    schoolId: opts.schoolId,
    source: "kideesys",
    categories: ["learners", "parents", "parentRelationships", "classes"],
    createdAt: new Date().toISOString(),
    rows: stagedRows,
    validation: report,
  });

  return {
    projectId: opts.projectId,
    report,
    confirmToken,
    daSilvaConfirmToken: bundle.confirmToken,
    stagedRows,
    countValidation: bundle.countValidation,
    summary: bundle.reconciliation.totals,
  };
}
