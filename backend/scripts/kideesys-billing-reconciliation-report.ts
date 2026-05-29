/**
 * Kid-e-Sys billing match + second-pass reconciliation report (dry-run).
 *
 * Usage:
 *   npx tsx scripts/kideesys-billing-reconciliation-report.ts [schoolId] [projectId]
 */
import "dotenv/config";

import fs from "fs";
import path from "path";

import { prisma } from "../src/prisma";
import { formatKideesysBillingReconciliationReportText } from "../src/services/daSilvaMigration/daSilvaKideesysBillingReconciliationReport";
import { matchKideesysBillingAccountsWithSecondPass } from "../src/services/daSilvaMigration/daSilvaKideesysBillingMatch";
import {
  DA_SILVA_BILLING_MATCH_MIN_MATCHED,
  discoverBillingSecondPassPaths,
} from "../src/services/daSilvaMigration/daSilvaMigrationStrategy";
import { resolveDaSilvaStagedPaths } from "../src/services/daSilvaMigration/daSilvaStagedPaths";
import {
  buildLearnerMatchKey,
  parseAgeAnalysisFileWithAudit,
  parseBillingPlanFile,
  parseContactListFile,
  parseTransactionListFile,
} from "../src/services/daSilvaMigration/parsers";
import {
  parseSasamsClassListDirectory,
  sasamsLearnersToParsedLearners,
} from "../src/services/daSilvaMigration/sasamsParsers";
import { DA_SILVA_FINAL_IMPORT_EXPECTED } from "../src/services/daSilvaMigration/daSilvaFinalImportGate";

const schoolIdArg = process.argv[2] || "";
const projectIdArg = process.argv[3] || "";

async function resolveSchoolId(): Promise<{ id: string; name: string }> {
  const hint = schoolIdArg.trim();
  const school =
    (hint
      ? await prisma.school.findUnique({ where: { id: hint }, select: { id: true, name: true } })
      : null) ||
    (await prisma.school.findFirst({
      where: { name: DA_SILVA_FINAL_IMPORT_EXPECTED.schoolName },
      select: { id: true, name: true },
    }));
  if (!school) throw new Error("School not found — pass schoolId");
  return school;
}

async function resolveProjectId(schoolId: string): Promise<string> {
  if (projectIdArg) return projectIdArg;
  const stagingRoot = path.join(process.cwd(), "uploads", "migration-staging", schoolId);
  if (!fs.existsSync(stagingRoot)) throw new Error(`No staging folder for school ${schoolId}`);
  const manifests = fs
    .readdirSync(stagingRoot)
    .filter((f) => f.startsWith("dasilva-") && f.endsWith(".manifest.json"))
    .map((f) => ({ file: f, mtime: fs.statSync(path.join(stagingRoot, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (!manifests.length) throw new Error("No Da Silva manifest — pass projectId");
  const raw = JSON.parse(
    fs.readFileSync(path.join(stagingRoot, manifests[0].file), "utf8")
  ) as { projectId?: string };
  return String(raw.projectId || "").trim() || manifests[0].file.replace(/^dasilva-/, "").replace(/\.manifest\.json$/, "");
}

function findStagedFile(schoolId: string, relativeName: string): string {
  const root = path.join(process.cwd(), "uploads", "migration-staging", schoolId);
  const matches: string[] = [];
  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.name.toLowerCase() === relativeName.toLowerCase()) matches.push(p);
    }
  };
  walk(root);
  matches.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  if (!matches.length) throw new Error(`Staged file not found: ${relativeName} under ${root}`);
  return matches[0];
}

async function main(): Promise<void> {
  const school = await resolveSchoolId();
  const projectId = await resolveProjectId(school.id);
  const ageAnalysis = findStagedFile(school.id, "age_analysis.xls");
  const billingPlan = findStagedFile(school.id, "billing_plan_summary.xls");
  const transactionsPath = findStagedFile(school.id, "transaction_list.xls");
  const sasamsClassLists = path.join(
    path.dirname(ageAnalysis),
    "..",
    "sasams",
    "class_lists"
  );
  const classListDir = fs.existsSync(sasamsClassLists)
    ? sasamsClassLists
    : path.dirname(findStagedFile(school.id, "1A.xls"));
  const staged = {
    ...resolveDaSilvaStagedPaths(school.id, projectId),
    classListDir,
    ageAnalysis,
    billingPlan,
    transactions: transactionsPath,
  };

  const ageParsed = parseAgeAnalysisFileWithAudit(staged.ageAnalysis);
  if (!ageParsed.accounts.length || ageParsed.audit.headerRowIndex === null) {
    console.error("Age analysis parser failure: no accounts or header row detected");
    process.exit(1);
  }

  const { learners: sasamsClassLearners } = parseSasamsClassListDirectory(staged.classListDir);
  const classListLearners = sasamsLearnersToParsedLearners(sasamsClassLearners);

  const dbLearners = await prisma.learner.findMany({
    where: { schoolId: school.id },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      className: true,
      idNumber: true,
      admissionNo: true,
    },
  });

  const dbForMatch =
    dbLearners.length > 0
      ? dbLearners.map((l) => ({
          id: l.id,
          firstName: l.firstName,
          lastName: l.lastName,
          className: l.className,
          matchKey: buildLearnerMatchKey(`${l.firstName} ${l.lastName}`, l.className || ""),
          idNumber: l.idNumber,
          admissionNo: l.admissionNo,
        }))
      : classListLearners.map((l) => ({
          id: l.matchKey,
          firstName: l.firstName,
          lastName: l.lastName,
          className: l.className,
          matchKey: l.matchKey,
          idNumber: l.idNumber,
          admissionNo: l.admissionNo,
        }));

  if (!dbForMatch.length) {
    console.error("No DB learners and no SA-SAMS class-list learners for billing match");
    process.exit(1);
  }

  const secondPassPaths = discoverBillingSecondPassPaths(staged.ageAnalysis);
  const billingPlanItems =
    (secondPassPaths.billingPlan && fs.existsSync(secondPassPaths.billingPlan)
      ? parseBillingPlanFile(secondPassPaths.billingPlan)
      : null) ||
    (fs.existsSync(staged.billingPlan) ? parseBillingPlanFile(staged.billingPlan) : []);

  let transactionParseErrors: string[] = [];
  let transactions: ReturnType<typeof parseTransactionListFile> = [];
  const txnPath =
    secondPassPaths.transactions && fs.existsSync(secondPassPaths.transactions)
      ? secondPassPaths.transactions
      : fs.existsSync(staged.transactions)
        ? staged.transactions
        : "";
  if (txnPath) {
    try {
      transactions = parseTransactionListFile(txnPath);
    } catch (e: unknown) {
      transactionParseErrors.push(e instanceof Error ? e.message : "Transaction parse failed");
    }
  }

  let contacts: ReturnType<typeof parseContactListFile> = [];
  try {
    const contactPath =
      secondPassPaths.contactList && fs.existsSync(secondPassPaths.contactList)
        ? secondPassPaths.contactList
        : findStagedFile(school.id, "contact_list.xls");
    contacts = parseContactListFile(contactPath);
  } catch {
    contacts = [];
  }

  const { audit, report } = matchKideesysBillingAccountsWithSecondPass({
    accounts: ageParsed.accounts,
    dbLearners: dbForMatch,
    classListLearners,
    mergedFamilyAccountNos: [],
    billingPlanItems,
    transactions,
    contacts,
  });

  const txtPath = path.join(process.cwd(), "kideesys-billing-reconciliation-report.txt");
  const jsonPath = path.join(process.cwd(), "kideesys-billing-reconciliation-report.json");
  const text = formatKideesysBillingReconciliationReportText(report, school.name);
  fs.writeFileSync(txtPath, text);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  console.log(text);
  console.log(`\nWrote ${txtPath}`);
  console.log(`Wrote ${jsonPath}`);

  const matched = audit.matched.filter((r) => r.learnerId).length;
  const validationOk =
    matched >= DA_SILVA_BILLING_MATCH_MIN_MATCHED &&
    transactionParseErrors.length === 0 &&
    ageParsed.audit.headerRowIndex !== null;

  console.log(
    JSON.stringify(
      {
        schoolId: school.id,
        projectId,
        totalAccounts: report.totalAccounts,
        firstPassMatched: report.firstPassMatched,
        secondPassAutoMatched: report.secondPassAutoMatched,
        totalMatched: matched,
        stillUnmatched: report.stillUnmatched,
        manualReview: report.manualReviewRequired.length,
        validationPassed: validationOk,
        transactionParseErrors,
      },
      null,
      2
    )
  );

  if (!validationOk) process.exit(1);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
