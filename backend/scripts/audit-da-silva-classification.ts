/**
 * Da Silva learner classification audit (child.csv source of truth).
 *
 * Usage:
 *   npx tsx scripts/audit-da-silva-classification.ts [schoolId] [csvDirOrZip]
 *   npx tsx scripts/audit-da-silva-classification.ts [schoolId] [csvDirOrZip] --apply
 *
 * Environment:
 *   KIDESYS_CSV_SOURCE — Kid-e-Sys export folder or ZIP
 *   KIDESYS_SCHOOL_ID  — school id when omitted
 *
 * Writes:
 *   audit-da-silva-classification.json
 *   audit-da-silva-classification.txt
 */
import "dotenv/config";

import fs from "fs";
import path from "path";

import { PrismaClient } from "@prisma/client";

import { classifyKidESysChildRow } from "../src/services/daSilvaMigration/kideesysCsv/kideesysChildClassifier";
import {
  loadKidESysCsvBundle,
  parseCsvFile,
  pickCsvField,
} from "../src/services/daSilvaMigration/kideesysCsv/kideesysCsvParser";
import { reclassifyKidESysLearnerEnrollment } from "../src/services/daSilvaMigration/kideesysCsv/reclassifyKidESysLearnerEnrollment";
import { readSchoolLedger } from "../src/utils/billingLedgerStore";
import { readSchoolKidesysHistory } from "../src/utils/kidesysTransactionHistoryStore";
import { isFemaleGender, isMaleGender, normalizeLearnerGender } from "../src/utils/learnerGender";

const prisma = new PrismaClient();
const args = process.argv.slice(2).filter((a) => a !== "--apply" && a !== "--json");
const apply = process.argv.includes("--apply");
const jsonOut = process.argv.includes("--json");

async function resolveSchoolId(hint: string): Promise<string> {
  const id = String(hint || process.env.KIDESYS_SCHOOL_ID || "").trim();
  if (id) {
    const school = await prisma.school.findUnique({ where: { id }, select: { id: true, name: true } });
    if (school) return school.id;
  }
  const recent = await prisma.learner.groupBy({
    by: ["schoolId"],
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
    take: 1,
  });
  if (!recent.length) throw new Error("No schoolId provided and no learners in database");
  return recent[0].schoolId;
}

function isNoClassroom(className: string | null | undefined): boolean {
  const c = String(className || "").trim();
  if (!c) return true;
  return /no classroom/i.test(c);
}

async function main(): Promise<void> {
  const schoolId = await resolveSchoolId(args[0] || "");
  const sourcePath =
    String(args[1] || process.env.KIDESYS_CSV_SOURCE || "").trim() ||
    "/Users/dasilvaacademy/Desktop";

  const bundle = loadKidESysCsvBundle(sourcePath);
  const childRows = parseCsvFile(bundle.filesFound.child);

  const csvProof = {
    headers: bundle.headersByFile.child,
    columnMeanings: {
      child_id: "Stable Kid-e-Sys learner key",
      account_no: "Billing account reference",
      child_active: 'Enrolment flag: "Yes" = active, "No" = historical',
      child_name: "First name",
      child_surname: "Surname",
      child_id_no: "SA ID (optional; used for gender inference)",
      classroom: 'Class label or "No Classroom" for inactive',
      enrollment_date: "Enrolment date (not date of birth)",
    },
    totalRows: childRows.length,
    childActiveYes: 0,
    childActiveNo: 0,
    noClassroom: 0,
    classifiedActive: 0,
    classifiedHistorical: 0,
  };

  for (const row of childRows) {
    const active = pickCsvField(row, ["child_active"]).toLowerCase();
    if (active === "yes") csvProof.childActiveYes += 1;
    if (active === "no") csvProof.childActiveNo += 1;
    if (isNoClassroom(pickCsvField(row, ["classroom"]))) csvProof.noClassroom += 1;
    const tier = classifyKidESysChildRow(row).enrollmentStatus;
    if (tier === "ACTIVE") csvProof.classifiedActive += 1;
    else csvProof.classifiedHistorical += 1;
  }

  let reclassifyResult: Awaited<ReturnType<typeof reclassifyKidESysLearnerEnrollment>> | null = null;
  if (apply) {
    reclassifyResult = await reclassifyKidESysLearnerEnrollment({
      prisma,
      schoolId,
      sourcePath,
      dryRun: false,
      sasamsDesktopRoot: fs.existsSync(path.join(sourcePath, "sasams"))
        ? sourcePath
        : path.join(process.env.HOME || "", "Desktop"),
    });
  }

  const learners = await prisma.learner.findMany({
    where: { schoolId },
    select: {
      id: true,
      enrollmentStatus: true,
      gender: true,
      className: true,
      firstName: true,
      lastName: true,
      birthDate: true,
      idNumber: true,
      homeLanguage: true,
      citizenship: true,
      familyAccountId: true,
    },
  });

  const active = learners.filter((l) => l.enrollmentStatus === "ACTIVE");
  const inactive = learners.filter((l) => l.enrollmentStatus === "HISTORICAL");
  const noClassroomCount = learners.filter((l) => isNoClassroom(l.className)).length;
  const activeWithClass = active.filter((l) => !isNoClassroom(l.className));

  const boys = active.filter((l) => isMaleGender(l.gender)).length;
  const girls = active.filter((l) => isFemaleGender(l.gender)).length;

  const classroomSet = new Set(
    activeWithClass.map((l) => String(l.className || "").trim()).filter(Boolean)
  );
  const avgClassSize =
    classroomSet.size > 0 ? Math.round(activeWithClass.length / classroomSet.size) : 0;

  const profileFields = [
    "firstName",
    "lastName",
    "idNumber",
    "birthDate",
    "gender",
    "className",
    "homeLanguage",
    "citizenship",
  ] as const;
  const profileCoverage: Record<string, number> = {};
  for (const field of profileFields) {
    profileCoverage[field] = active.filter((l) => {
      const v = l[field];
      if (v == null) return false;
      if (typeof v === "string") return Boolean(v.trim());
      return true;
    }).length;
  }

  const ledger = readSchoolLedger(schoolId);
  const history = readSchoolKidesysHistory(schoolId);
  const accountsWithInvoice = new Set<string>();
  const accountsWithPayment = new Set<string>();
  for (const row of ledger) {
    const ref = String(row.accountNo || row.accountRef || "").trim();
    if (!ref) continue;
    if (row.type === "invoice" || row.kind === "invoice") accountsWithInvoice.add(ref);
    if (row.type === "payment" || row.kind === "payment") accountsWithPayment.add(ref);
  }
  for (const row of history) {
    const ref = String(row.accountNo || "").trim();
    if (!ref) continue;
    if (row.kind === "invoice") accountsWithInvoice.add(ref);
    if (row.kind === "payment") accountsWithPayment.add(ref);
  }

  const familyAccounts = await prisma.familyAccount.findMany({
    where: { schoolId },
    select: { accountRef: true },
  });
  const totalAccounts = familyAccounts.length;

  const genderNormalized = learners.filter((l) => normalizeLearnerGender(l.gender)).length;

  const report = {
    schoolId,
    auditedAt: new Date().toISOString(),
    sourcePath,
    apply,
    csvProof,
    reclassify: reclassifyResult,
    totals: {
      learners: learners.length,
      active: active.length,
      inactive: inactive.length,
      noClassroom: noClassroomCount,
      boys,
      girls,
      activeClassrooms: classroomSet.size,
      averageClassroomSize: avgClassSize,
      genderNormalized,
    },
    profileCoverage: {
      activeLearners: active.length,
      fields: profileCoverage,
    },
    statements: {
      familyAccounts: totalAccounts,
      accountsWithLastInvoice: accountsWithInvoice.size,
      accountsWithLastPayment: accountsWithPayment.size,
      ledgerRows: ledger.length,
      historyRows: history.length,
    },
    gate: {
      csvDbCountMatch:
        (reclassifyResult?.resolvedMapped ?? 0) === csvProof.totalRows,
      csvDbDelta: learners.length - csvProof.totalRows,
      csvMapped: reclassifyResult?.resolvedMapped ?? 0,
      boysGirlsNonZero: boys > 0 && girls > 0,
      activeRealistic: active.length > 0 && active.length < learners.length,
      activeNearCsv: Math.abs(active.length - csvProof.classifiedActive) <= 5,
      pass:
        (reclassifyResult?.resolvedMapped ?? 0) === csvProof.totalRows &&
        boys > 0 &&
        girls > 0 &&
        Math.abs(active.length - csvProof.classifiedActive) <= 5,
    },
  };

  const jsonPath = path.join(process.cwd(), "audit-da-silva-classification.json");
  const txtPath = path.join(process.cwd(), "audit-da-silva-classification.txt");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  const lines = [
    "Da Silva learner classification audit",
    "====================================",
    `School:     ${schoolId}`,
    `Source:     ${sourcePath}`,
    `Applied:    ${apply ? "yes" : "no (pass --apply to reclassify DB)"}`,
    "",
    "child.csv proof",
    `  headers:    ${csvProof.headers.join(", ")}`,
    `  rows:       ${csvProof.totalRows}`,
    `  active Yes: ${csvProof.childActiveYes}`,
    `  active No:  ${csvProof.childActiveNo}`,
    `  No Classroom: ${csvProof.noClassroom}`,
    `  classified ACTIVE: ${csvProof.classifiedActive}`,
    `  classified HISTORICAL: ${csvProof.classifiedHistorical}`,
    "",
    "Database (after apply)",
    `  total learners:     ${report.totals.learners}`,
    `  active:             ${report.totals.active}`,
    `  inactive:           ${report.totals.inactive}`,
    `  No Classroom:       ${report.totals.noClassroom}`,
    `  boys (active):      ${report.totals.boys}`,
    `  girls (active):     ${report.totals.girls}`,
    `  active classrooms:  ${report.totals.activeClassrooms}`,
    `  avg class size:     ${report.totals.averageClassroomSize}`,
    "",
    "Profile coverage (active)",
    ...Object.entries(profileCoverage).map(([k, v]) => `  ${k}: ${v}/${active.length}`),
    "",
    "Statements / billing preserved",
    `  family accounts:      ${report.statements.familyAccounts}`,
    `  w/ invoice signal:   ${report.statements.accountsWithLastInvoice}`,
    `  w/ payment signal:   ${report.statements.accountsWithLastPayment}`,
    `  ledger rows:          ${report.statements.ledgerRows}`,
    `  history rows:         ${report.statements.historyRows}`,
    "",
    "Gate",
    `  CSV vs DB count:     ${report.gate.csvDbCountMatch ? "OK" : "MISMATCH"} (delta ${report.gate.csvDbDelta})`,
    `  boys/girls non-zero: ${report.gate.boysGirlsNonZero}`,
    `  active realistic:    ${report.gate.activeRealistic}`,
    `  active ~ csv:        ${report.gate.activeNearCsv}`,
    `  AUDIT:               ${report.gate.pass ? "PASS" : "FAIL"}`,
  ];
  fs.writeFileSync(txtPath, lines.join("\n"));

  if (jsonOut) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(lines.join("\n"));
    console.log(`\nWrote ${jsonPath}`);
    console.log(`Wrote ${txtPath}`);
  }

  if (!report.gate.pass) {
    process.exit(apply ? 1 : 0);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
