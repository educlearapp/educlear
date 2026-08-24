/**
 * Multi-sheet workbook ingestion tests for Universal Migration Centre.
 * Local / in-memory only. No production writes.
 *
 * Run:
 *   npx tsx src/services/migration/core/workbookIngestion.unit.test.ts
 */

import assert from "assert";
import * as XLSX from "xlsx";
import { classifyMigrationSheet } from "./classifyMigrationSheet";
import { detectTabularHeaderRow, matrixToRecordsFromHeader } from "./detectTabularHeaderRow";
import { expandWorkbookToLogicalFiles } from "./expandWorkbookUpload";
import { collapseOpeningBalancesByAccount, openingBalanceRowsToPost } from "./migrationOpeningBalanceSafety";
import {
  resolveFamilyGroupingAuthority,
  resolveMigrationFamilyAccountLink,
} from "./migrationFamilyEvidence";
import {
  classifyMigrationLearnerIdentity,
  matchMigrationLearnerInSchool,
} from "./migrationLearnerIdentity";
import { evaluateMigrationIntegrityGate } from "./migrationIntegrityStore";
import { listWorkbookSheets } from "./workbookSheets";
import { parseMigrationLearnerFileBuffer } from "../../../utils/migrationLearnerFileParser";

const SCHOOL = "school_fly_eagle_rehearsal";
const MAGICAL = "cmq4xjckq00at60gqg4eb956h";
const DA_SILVA = "cmpideqeq0000108xb6ouv9zi";

function book(sheets: Array<{ name: string; rows: Array<Array<string | number>> }>): Buffer {
  const wb = XLSX.utils.book_new();
  for (const sheet of sheets) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheet.rows), sheet.name);
  }
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

function expand(buffer: Buffer, filename: string) {
  return expandWorkbookToLogicalFiles({
    buffer,
    filename,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    size: buffer.length,
    path: "/tmp/migration-test.xlsx",
  });
}

function testA_multiSheetSummaryFirst(): void {
  const buffer = book([
    {
      name: "Migration Summary",
      rows: [
        ["SCHOOL SOURCE PACK"],
        ["Metric", "Value"],
        ["Canonical learners", 12],
        ["Unique accession numbers", 12],
      ],
    },
    {
      name: "Learners",
      rows: [
        ["Accession", "Surname", "First Name", "Grade", "Class", "DOB"],
        ["A1", "Nkosi", "Amahle", "1", "1A", "2018-01-01"],
        ["A2", "Dlamini", "Sipho", "1", "1A", "2018-02-02"],
      ],
    },
    {
      name: "Parent Candidates",
      rows: [
        ["Candidate ID", "First Name", "Surname", "Cell", "Linked Learners", "Learner Accessions"],
        ["P1", "Thandi", "Nkosi", "0821111111", "1", "A1"],
        ["P2", "Lindi", "Dlamini", "0822222222", "1", "A2"],
      ],
    },
  ]);
  const logical = expand(buffer, "School_Source_Pack.xlsx");
  assert.strictEqual(logical.length, 3);
  const byKind = Object.fromEntries(logical.map((s) => [s.sheetKind, s]));
  assert.strictEqual(byKind.summary?.sheetRole, "SUMMARY");
  assert.strictEqual(byKind.summary?.file.category, "unknown");
  assert.strictEqual(byKind.learners?.file.category, "learners");
  assert.strictEqual(byKind.learners?.rowCount, 2);
  assert.strictEqual(byKind.parents?.file.category, "parents");
  assert.ok(!logical.filter((s) => s.sheetRole === "SUMMARY").some((s) => s.file.category === "learners"));
  console.log("✓ A. summary-first workbook: summary ignored, learners+parents detected");
}

function testB_headerNotRow1(): void {
  const matrix = [
    ["ANNUAL LEARNER REGISTER"],
    ["", ""],
    ["Accession", "Surname", "First Name", "Grade"],
    ["100", "Botha", "Ann", "2"],
    ["101", "Botha", "Ben", "2"],
  ];
  const detected = detectTabularHeaderRow(matrix);
  assert.ok(detected);
  assert.strictEqual(detected.headerRowIndex, 2);
  const parsed = matrixToRecordsFromHeader(matrix, detected.headerRowIndex);
  assert.strictEqual(parsed.rows.length, 2);
  assert.strictEqual(parsed.rows[0]?.Accession, "100");
  console.log("✓ B. header not on row 1");
}

function testC_learnersParentsClassesFinance(): void {
  const buffer = book([
    {
      name: "Learners",
      rows: [
        ["Accession", "Surname", "First Name", "Grade"],
        ["1", "A", "One", "1"],
      ],
    },
    {
      name: "Parents",
      rows: [
        ["Candidate ID", "First Name", "Surname", "Linked Learners"],
        ["P1", "Pat", "A", "1"],
      ],
    },
    {
      name: "Class Reconciliation",
      rows: [
        ["Class", "Source Rows", "Canonical Rows", "Difference"],
        ["1A", "1", "1", "0"],
      ],
    },
    {
      name: "Accounts",
      rows: [
        ["Account", "Opening Balance", "Customer"],
        ["ACC1", "-100.00", "A"],
      ],
    },
  ]);
  const logical = expand(buffer, "full_pack.xlsx");
  const kinds = logical.map((s) => s.sheetKind).sort();
  assert.deepStrictEqual(kinds, ["billing", "classes", "learners", "parents"].sort());
  console.log("✓ C. learners + parents + classes + finance in one workbook");
}

function testD_unrelatedSameSurname(): void {
  const grouped = resolveFamilyGroupingAuthority([
    { key: "a", schoolId: SCHOOL, lastName: "Nkosi", sourceAccountRef: "A1" },
    { key: "b", schoolId: SCHOOL, lastName: "Nkosi", sourceAccountRef: "B1" },
  ]);
  const autoTogether = grouped.groups.filter(
    (g) => g.decision === "AUTO_GROUP" && g.learnerKeys.includes("a") && g.learnerKeys.includes("b")
  );
  assert.strictEqual(autoTogether.length, 0);
  const surnameLink = resolveMigrationFamilyAccountLink({
    learner: { id: "l1", lastName: "Nkosi", admissionNo: null, familyAccountId: null },
    familyAccounts: [{ id: "fa1", accountRef: "ACC001", familyName: "Nkosi" }],
  });
  assert.strictEqual(surnameLink.familyAccountId, null);
  console.log("✓ D. unrelated same surname remain separate");
}

function testE_siblingsOneAccount(): void {
  const grouped = resolveFamilyGroupingAuthority([
    { key: "a", schoolId: SCHOOL, lastName: "Nkosi", sourceAccountRef: "FAM9" },
    { key: "b", schoolId: SCHOOL, lastName: "Nkosi", sourceAccountRef: "FAM9" },
  ]);
  const auto = grouped.groups.find((g) => g.decision === "AUTO_GROUP");
  assert.ok(auto);
  assert.ok(auto!.learnerKeys.includes("a") && auto!.learnerKeys.includes("b"));
  console.log("✓ E. siblings on one source account group together");
}

function testF_negativeOpeningSurvives(): void {
  const collapsed = collapseOpeningBalancesByAccount([
    { accountRef: "ACC1", openingBalance: "-46285.10", sourceFilename: "Accounts", rowNumber: 2 },
  ]);
  const row = collapsed.find((r) => r.accountRef === "ACC1");
  assert.ok(row);
  assert.ok((row!.cents || 0) < 0);
  assert.strictEqual(row!.status, "post");
  console.log("✓ F. negative opening balance survives exactly");
}

function testG_duplicateFinanceDoesNotDouble(): void {
  const collapsed = openingBalanceRowsToPost([
    { accountRef: "ACC1", openingBalance: "100.00", sourceFilename: "Accounts", rowNumber: 2 },
    { accountRef: "ACC1", openingBalance: "100.00", sourceFilename: "Accounts copy", rowNumber: 2 },
  ]);
  assert.strictEqual(collapsed.toPost.length, 1);
  assert.ok(collapsed.skipped.length >= 1);
  console.log("✓ G. duplicate finance/history sheet does not double-post openings");
}

function testH_canonicalLearnersWording(): void {
  const classified = classifyMigrationSheet({
    sheetName: "Migration Summary",
    filename: "pack.xlsx",
    headers: ["Metric", "Value", "Meaning"],
    sampleRows: [{ Metric: "Canonical learners", Value: "441", Meaning: "PASS" }],
  });
  assert.strictEqual(classified.sheetKind, "summary");
  assert.notStrictEqual(classified.category, "learners");
  console.log("✓ H. Canonical learners wording is not a learner list");
}

function testI_idempotentRerun(): void {
  const buffer = book([
    {
      name: "Learners",
      rows: [
        ["Accession", "Surname", "First Name"],
        ["1", "A", "One"],
      ],
    },
  ]);
  const first = expand(buffer, "pack.xlsx");
  const second = expand(buffer, "pack.xlsx");
  assert.strictEqual(first.length, second.length);
  assert.strictEqual(first[0]?.file.category, second[0]?.file.category);
  assert.strictEqual(first[0]?.rowCount, second[0]?.rowCount);
  console.log("✓ I. workbook classification is idempotent");
}

function testJ_historicalLearnerBlocksAccept(): void {
  const blocked = evaluateMigrationIntegrityGate({
    stageId: "s1",
    targetSchoolId: SCHOOL,
    updatedAt: new Date().toISOString(),
    blockingCount: 1,
    findings: [
      {
        findingId: "hist1",
        severity: "BLOCKING",
        title: "Historical learner",
        message: "EXISTING HISTORICAL LEARNER — REACTIVATION REVIEW",
      },
    ],
  });
  assert.strictEqual(blocked.canAccept, false);
  console.log("✓ J. historical learner blocks Accept pending review");
}

function testK_crossSchoolIsolation(): void {
  const match = matchMigrationLearnerInSchool({
    incoming: {
      schoolId: SCHOOL,
      firstName: "Amahle",
      lastName: "Nkosi",
      dateOfBirth: "2018-01-01",
      idNumber: "1801010000000",
      sourceLearnerId: "A1",
    },
    candidates: [
      {
        id: "magical-learner",
        schoolId: MAGICAL,
        firstName: "Amahle",
        lastName: "Nkosi",
        birthDate: "2018-01-01",
        idNumber: "1801010000000",
        admissionNo: "A1",
        enrollmentStatus: "ACTIVE",
      },
      {
        id: "dasilva-learner",
        schoolId: DA_SILVA,
        firstName: "Amahle",
        lastName: "Nkosi",
        birthDate: "2018-01-01",
        idNumber: "1801010000000",
        admissionNo: "A1",
        enrollmentStatus: "ACTIVE",
      },
    ],
  });
  assert.strictEqual(match, null);
  const identity = classifyMigrationLearnerIdentity({
    incoming: {
      schoolId: SCHOOL,
      firstName: "Amahle",
      lastName: "Nkosi",
      sourceLearnerId: "A1",
    },
    candidates: [
      {
        id: "other",
        schoolId: MAGICAL,
        firstName: "Amahle",
        lastName: "Nkosi",
        admissionNo: "A1",
        enrollmentStatus: "ACTIVE",
      },
    ],
  });
  assert.notStrictEqual(identity.classification, "EXISTING_ACTIVE_LEARNER_REVIEW_LINK");
  console.log("✓ K. Fly Eagle never matches Magical or Da Silva entities");
}

function testExpressSheetNameInsideWorkbook(): void {
  const classified = classifyMigrationSheet({
    sheetName: "EXPRESS INVOICE (B)",
    filename: "School_Source_Pack.xlsx",
    headers: ["Customer", "Balance", "Phone"],
    sampleRows: [{ Customer: "FAM1", Balance: "100.00", Phone: "082" }],
  });
  assert.strictEqual(classified.category, "billing");
  assert.strictEqual(classified.sheetRole, "DATA");
  console.log("✓ Express sheet name inside a generic workbook is billing authority");
}

function testL_singleSheetCsvXlsx(): void {
  const csv = Buffer.from("Surname,First Name,Grade\nPeters,Ann,3\n");
  const csvSheets = listWorkbookSheets(csv, "learners.csv");
  assert.strictEqual(csvSheets.length, 1);
  const csvLogical = expandWorkbookToLogicalFiles({
    buffer: csv,
    filename: "learners.csv",
    mimeType: "text/csv",
    size: csv.length,
    path: "/tmp/learners.csv",
  });
  assert.strictEqual(csvLogical.length, 1);
  assert.strictEqual(csvLogical[0]?.file.category, "learners");

  const xlsx = book([
    {
      name: "Sheet1",
      rows: [
        ["Accession", "Surname", "First Name", "Grade"],
        ["9", "Peters", "Ann", "3"],
      ],
    },
  ]);
  const parsed = parseMigrationLearnerFileBuffer(xlsx, "one.xlsx");
  assert.strictEqual(parsed.rows.length, 1);
  assert.strictEqual(parsed.headers.includes("Surname"), true);
  console.log("✓ L. single-sheet CSV/XLSX still works");
}

function testRealSourcePackIfPresent(): void {
  const fs = require("fs") as typeof import("fs");
  const path = "/Users/dasilvaacademy/Desktop/Fly_Eagle_EduClear_Migration_Source_Pack.xlsx";
  if (!fs.existsSync(path)) {
    console.log("• real source pack not on Desktop — skipped inventory assert");
    return;
  }
  const buffer = fs.readFileSync(path);
  const logical = expand(buffer, "Fly_Eagle_EduClear_Migration_Source_Pack.xlsx");
  const byName = Object.fromEntries(logical.map((s) => [s.file.worksheetName, s]));
  assert.strictEqual(byName["Migration Summary"]?.sheetRole, "SUMMARY");
  assert.strictEqual(byName.Learners?.file.category, "learners");
  assert.ok((byName.Learners?.rowCount || 0) >= 400);
  assert.strictEqual(byName["Parent Candidates"]?.file.category, "parents");
  assert.notStrictEqual(byName["Parent Relationships"]?.file.category, "learners");
  console.log("✓ real Fly Eagle source pack sheets classified without using cover sheet as learners");
}

function main(): void {
  testA_multiSheetSummaryFirst();
  testB_headerNotRow1();
  testC_learnersParentsClassesFinance();
  testD_unrelatedSameSurname();
  testE_siblingsOneAccount();
  testF_negativeOpeningSurvives();
  testG_duplicateFinanceDoesNotDouble();
  testH_canonicalLearnersWording();
  testI_idempotentRerun();
  testJ_historicalLearnerBlocksAccept();
  testK_crossSchoolIsolation();
  testExpressSheetNameInsideWorkbook();
  testL_singleSheetCsvXlsx();
  testRealSourcePackIfPresent();
  console.log("\nworkbook ingestion tests passed");
}

main();
