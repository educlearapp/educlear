import assert from "assert";
import fs from "fs";
import path from "path";
import { readMigrationSpreadsheetMatrix } from "../../../utils/migrationLearnerFileParser";
import { detectKidESysExports } from "./kideesysDetection";
import { extractKideesysReportTable } from "./kideesysReportTableExtraction";

function testAgeAnalysisSynthetic(): void {
  const matrix = [
    ["Bad Debt"],
    ["Account", "", "Balance", "", "Current", "30 Days", "60 Days", "90 Days", "120 Days"],
    ["1", "ALI002", "Alizain Ali", "7000.0", "3300.0", "3000.0", "3000.0", "3700.0", "-6000.0"],
    ["2", "MAO002", "Amogelang Maapoga", "7200.0", "5800.0", "0.0", "1400.0", "0.0", "0.0"],
  ];
  const parsed = extractKideesysReportTable(matrix, "account_list_(age_analysis).xls");
  assert.ok(parsed, "expected extraction");
  assert.ok(parsed.headers.includes("Account"), `headers: ${parsed.headers.join(",")}`);
  assert.ok(parsed.headers.includes("Balance"), `headers: ${parsed.headers.join(",")}`);
  assert.strictEqual(parsed.rows[0]["Account"], "ALI002");
  assert.strictEqual(parsed.rows[0]["Account Name"], "Alizain Ali");
  assert.strictEqual(parsed.rows[0]["Balance"], "7000.0");
}

function testTransactionSynthetic(): void {
  const matrix = [
    ["Invoice"],
    ["1 January 2023 to 23 May 2026"],
    [],
    ["1", "Invoice 42225", "2023/01/03", "MOT004", "Gofentseone Pico", "", "1600.0"],
    ["2", "Invoice 42226", "2023/01/03", "MAN010", "Nhlulo Xihluke Manabe", "", "5000.0"],
    ["3", "Invoice 42227", "2023/01/03", "BOI004", "Olaotse Boikanyo", "3250.0"],
  ];
  const parsed = extractKideesysReportTable(matrix, "transaction_list.xls");
  assert.ok(parsed, "expected extraction");
  assert.deepStrictEqual(
    parsed.headers.slice(0, 4),
    ["#", "Reference", "Date", "Account"]
  );
  assert.strictEqual(parsed.rows[0]["Reference"], "Invoice 42225");
  assert.strictEqual(parsed.rows[0]["Date"], "2023/01/03");
  assert.strictEqual(parsed.rows[0]["Amount"], "1600.0");
  assert.strictEqual(parsed.rows[2]["Notes"], "");
  assert.strictEqual(parsed.rows[2]["Amount"], "3250.0");
}

function testSiblingAccountsHeaderlessSynthetic(): void {
  const matrix = [
    ["Sibling Accounts"],
    [],
    ["Account ALI002"],
    ["Alizain Ali"],
    ["Zahra Ali"],
    [],
    ["Account MAO002"],
    ["1", "Amogelang Maapoga"],
    ["2", "Palesa Maapoga"],
  ];
  const parsed = extractKideesysReportTable(matrix, "sibling_accounts.xls");
  assert.ok(parsed, "expected sibling accounts extraction");
  assert.ok(detectKidESysExports(["sibling_accounts.xls"]), "expected Kid-e-Sys detection");
  assert.deepStrictEqual(parsed.headers, ["Account", "Account Name", "Learner Name"]);
  assert.strictEqual(parsed.rows.length, 4);
  assert.strictEqual(parsed.rows[0]["Account"], "ALI002");
  assert.strictEqual(parsed.rows[1]["Account"], "ALI002");
  assert.strictEqual(parsed.rows[0]["Learner Name"], "Alizain Ali");
  assert.strictEqual(parsed.rows[1]["Learner Name"], "Zahra Ali");
  assert.strictEqual(parsed.rows[0]["Account Name"], "Alizain Ali / Zahra Ali");
  assert.strictEqual(parsed.rows[2]["Account"], "MAO002");
  assert.strictEqual(parsed.rows[3]["Account"], "MAO002");
  assert.strictEqual(parsed.rows[2]["Learner Name"], "Amogelang Maapoga");
  assert.strictEqual(parsed.rows[3]["Learner Name"], "Palesa Maapoga");
}

function testContactListLeadingOPhoneCorrection(): void {
  const matrix = [
    ["Creche 2026"],
    [],
    ["Father - TEST PARENT"],
    ["Learner One", "Cell No", "O726265905"],
    ["Work No", "O112223344"],
    ["Home No", ""],
    ["Email", "parent@example.com"],
  ];
  const parsed = extractKideesysReportTable(matrix, "contact_list.xls");
  assert.ok(parsed, "expected contact list extraction");
  assert.strictEqual(parsed.rows[0]["Cell No"], "0726265905");
  assert.strictEqual(parsed.rows[0]["Work No"], "0112223344");
  assert.strictEqual(parsed.rows[0]["Parent Name"], "TEST PARENT");
  assert.strictEqual(parsed.rows[0]["Email"], "parent@example.com");
  assert.ok(parsed.parseIssues?.length === 1, "expected one parse info issue");
  assert.match(
    parsed.parseIssues![0].message,
    /auto-corrected from O726265905 to 0726265905/i
  );
}

function testContactListSynthetic(): void {
  const matrix = [
    ["Creche 2026"],
    [],
    ["Father - MAHLARE PHILLIP", "", "", "Father - MANARE DOREEN"],
    ["Atang Mothotse", "Cell No", "0725709043", "0795813938"],
    ["Work No", "", "", ""],
    ["Home No", "", "", ""],
    ["Email", "", "MAHLARE6@GMAIL.COM", "MANAREDOREEN95@GMAIL.COM"],
  ];
  const parsed = extractKideesysReportTable(matrix, "contact_list.xls");
  assert.ok(parsed, "expected contact list extraction");
  assert.ok(parsed.headers.includes("Parent Name"), `headers: ${parsed.headers.join(",")}`);
  assert.ok(parsed.headers.includes("Relationship"), `headers: ${parsed.headers.join(",")}`);
  assert.ok(parsed.headers.includes("Cell No"), `headers: ${parsed.headers.join(",")}`);
  assert.strictEqual(parsed.rows[0]["Learner Name"], "Atang Mothotse");
  assert.strictEqual(parsed.rows[0]["Parent Name"], "MAHLARE PHILLIP");
  assert.strictEqual(parsed.rows[0]["Relationship"], "Father");
  assert.strictEqual(parsed.rows[0]["Cell No"], "0725709043");
  assert.strictEqual(parsed.rows[0]["Email"], "MAHLARE6@GMAIL.COM");
  assert.strictEqual(parsed.rows[1]["Parent Name"], "MANARE DOREEN");
  assert.strictEqual(parsed.rows[1]["Cell No"], "0795813938");
  assert.strictEqual(parsed.rows[1]["Email"], "MANAREDOREEN95@GMAIL.COM");
}

function testClassListSynthetic(): void {
  const matrix = [
    ["Grade 1A 2026", ""],
    ["1", "Aiden Jacques Du Plessis"],
    ["2", "Amogelang Letoloto Raborife"],
  ];
  const parsed = extractKideesysReportTable(matrix, "Grade_1A.xls");
  assert.ok(parsed);
  assert.deepStrictEqual(parsed.headers, ["fullName", "status", "classroom"]);
  assert.strictEqual(parsed.rows[0].fullName, "Aiden Jacques Du Plessis");
  assert.strictEqual(parsed.rows[0].status, "ACTIVE");
}

function testStagingSamplesIfPresent(): void {
  const samples: Array<{ file: string; expectHeader: string }> = [
    {
      file: "storage/migration-staging/1779725506201-911019628-account_list__age_analysis_.xls",
      expectHeader: "Balance",
    },
    {
      file: "storage/migration-staging/1779725512020-103360156-transaction_list.xls",
      expectHeader: "Amount",
    },
    {
      file: "storage/migration-staging/1779725495809-268731050-contact_list.xls",
      expectHeader: "Parent Name",
    },
  ];
  for (const sample of samples) {
    const full = path.resolve(__dirname, "../../../..", sample.file);
    if (!fs.existsSync(full)) continue;
    const matrix = readMigrationSpreadsheetMatrix(fs.readFileSync(full), path.basename(full));
    const parsed = extractKideesysReportTable(matrix, path.basename(full));
    assert.ok(parsed, `expected parse for ${sample.file}`);
    assert.ok(
      parsed.headers.includes(sample.expectHeader),
      `${sample.file} headers: ${parsed.headers.join(",")}`
    );
    assert.ok(parsed.rows.length > 0, `${sample.file} should have rows`);
  }
}

testAgeAnalysisSynthetic();
testTransactionSynthetic();
testSiblingAccountsHeaderlessSynthetic();
testContactListLeadingOPhoneCorrection();
testContactListSynthetic();
testClassListSynthetic();
testStagingSamplesIfPresent();
console.log("kideesysReportTableExtraction.test.ts: ok");
