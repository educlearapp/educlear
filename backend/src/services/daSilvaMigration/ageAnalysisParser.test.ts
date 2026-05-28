import assert from "assert";
import fs from "fs";
import path from "path";
import { parseKideesysSpreadsheetFile } from "../../utils/kideesysSpreadsheet";
import { parseAgeAnalysisSheet } from "./ageAnalysisParser";
import { parseAgeAnalysisFile, parseAgeAnalysisFileWithAudit } from "./parsers";

function testWithIndexColumn(): void {
  const matrix = [
    ["Bad Debt"],
    ["Account", "", "Balance", "", "Current", "30 Days", "60 Days", "90 Days", "120 Days"],
    ["1", "ALI002", "Alizain Ali", "7000.0", "3300.0", "3000.0", "3000.0", "3700.0", "-6000.0"],
    ["2", "MAO002", "Amogelang Maapoga\nOnkgopotse Leago Maapoga", "7200.0", "5800.0", "0.0", "1400.0", "0.0", "0.0"],
  ];
  const result = parseAgeAnalysisSheet({ name: "Report", rows: matrix });
  assert.strictEqual(result.accounts.length, 2);
  assert.strictEqual(result.accounts[0].accountNo, "ALI002");
  assert.strictEqual(result.accounts[0].balance, 7000);
  assert.strictEqual(result.accounts[0].current, 3300);
  assert.strictEqual(result.accounts[1].accountNo, "MAO002");
  assert.strictEqual(result.accounts[1].learnerNames?.length, 2);
  assert.ok(result.audit.accountNumbersParsed === 2);
  assert.ok(result.audit.sampleAccountNumbers.includes("ALI002"));
}

function testWithoutIndexColumn(): void {
  const matrix = [
    ["Bad Debt"],
    ["Account", "", "Balance", "", "Current", "30 Days"],
    ["ALI002", "Alizain Ali", "7000.0", "3300.0", "3000.0"],
    ["MAO002", "Amogelang Maapoga", "7200.0", "5800.0", "0.0"],
  ];
  const result = parseAgeAnalysisSheet({ name: "Report", rows: matrix });
  assert.strictEqual(result.accounts.length, 2, "expected accounts without index column");
  assert.strictEqual(result.accounts[0].accountNo, "ALI002");
  assert.strictEqual(result.accounts[1].accountNo, "MAO002");
}

function testStagingSampleIfPresent(): void {
  const sample = path.resolve(
    __dirname,
    "../../../storage/migration-staging/1779725506201-911019628-account_list__age_analysis_.xls"
  );
  if (!fs.existsSync(sample)) return;
  const beforeLegacy = 0;
  const parsed = parseAgeAnalysisFileWithAudit(sample);
  assert.ok(parsed.accounts.length > 300, `expected many accounts, got ${parsed.accounts.length}`);
  const ali = parsed.accounts.find((a) => a.accountNo === "ALI002");
  const mao = parsed.accounts.find((a) => a.accountNo === "MAO002");
  assert.ok(ali && ali.balance === 7000, "ALI002 balance");
  assert.ok(mao && mao.balance === 7200, "MAO002 balance");
  assert.ok(parsed.audit.accountNumbersParsed > 300);
  console.log(
    `staging sample: rows=${parsed.audit.ageAnalysisRowsParsed} accounts=${parsed.audit.accountNumbersParsed} (legacy would be ${beforeLegacy})`
  );
}

testWithIndexColumn();
testWithoutIndexColumn();
testStagingSampleIfPresent();
console.log("ageAnalysisParser.test.ts: ok");
