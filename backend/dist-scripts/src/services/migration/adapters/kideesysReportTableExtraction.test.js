"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const assert_1 = __importDefault(require("assert"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const migrationLearnerFileParser_1 = require("../../../utils/migrationLearnerFileParser");
const kideesysReportTableExtraction_1 = require("./kideesysReportTableExtraction");
function testAgeAnalysisSynthetic() {
    const matrix = [
        ["Bad Debt"],
        ["Account", "", "Balance", "", "Current", "30 Days", "60 Days", "90 Days", "120 Days"],
        ["1", "ALI002", "Alizain Ali", "7000.0", "3300.0", "3000.0", "3000.0", "3700.0", "-6000.0"],
        ["2", "MAO002", "Amogelang Maapoga", "7200.0", "5800.0", "0.0", "1400.0", "0.0", "0.0"],
    ];
    const parsed = (0, kideesysReportTableExtraction_1.extractKideesysReportTable)(matrix, "account_list_(age_analysis).xls");
    assert_1.default.ok(parsed, "expected extraction");
    assert_1.default.ok(parsed.headers.includes("Account"), `headers: ${parsed.headers.join(",")}`);
    assert_1.default.ok(parsed.headers.includes("Balance"), `headers: ${parsed.headers.join(",")}`);
    assert_1.default.strictEqual(parsed.rows[0]["Account"], "ALI002");
    assert_1.default.strictEqual(parsed.rows[0]["Account Name"], "Alizain Ali");
    assert_1.default.strictEqual(parsed.rows[0]["Balance"], "7000.0");
}
function testTransactionSynthetic() {
    const matrix = [
        ["Invoice"],
        ["1 January 2023 to 23 May 2026"],
        [],
        ["1", "Invoice 42225", "2023/01/03", "MOT004", "Gofentseone Pico", "", "1600.0"],
        ["2", "Invoice 42226", "2023/01/03", "MAN010", "Nhlulo Xihluke Manabe", "", "5000.0"],
    ];
    const parsed = (0, kideesysReportTableExtraction_1.extractKideesysReportTable)(matrix, "transaction_list.xls");
    assert_1.default.ok(parsed, "expected extraction");
    assert_1.default.deepStrictEqual(parsed.headers.slice(0, 4), ["#", "Reference", "Date", "Account"]);
    assert_1.default.strictEqual(parsed.rows[0]["Reference"], "Invoice 42225");
    assert_1.default.strictEqual(parsed.rows[0]["Date"], "2023/01/03");
    assert_1.default.strictEqual(parsed.rows[0]["Amount"], "1600.0");
}
function testContactListLeadingOPhoneCorrection() {
    const matrix = [
        ["Creche 2026"],
        [],
        ["Father - TEST PARENT"],
        ["Learner One", "Cell No", "O726265905"],
        ["Work No", "O112223344"],
        ["Home No", ""],
        ["Email", "parent@example.com"],
    ];
    const parsed = (0, kideesysReportTableExtraction_1.extractKideesysReportTable)(matrix, "contact_list.xls");
    assert_1.default.ok(parsed, "expected contact list extraction");
    assert_1.default.strictEqual(parsed.rows[0]["Cell No"], "0726265905");
    assert_1.default.strictEqual(parsed.rows[0]["Work No"], "0112223344");
    assert_1.default.strictEqual(parsed.rows[0]["Parent Name"], "TEST PARENT");
    assert_1.default.strictEqual(parsed.rows[0]["Email"], "parent@example.com");
    assert_1.default.ok(parsed.parseIssues?.length === 1, "expected one parse info issue");
    assert_1.default.match(parsed.parseIssues[0].message, /auto-corrected from O726265905 to 0726265905/i);
}
function testContactListSynthetic() {
    const matrix = [
        ["Creche 2026"],
        [],
        ["Father - MAHLARE PHILLIP", "", "", "Father - MANARE DOREEN"],
        ["Atang Mothotse", "Cell No", "0725709043", "0795813938"],
        ["Work No", "", "", ""],
        ["Home No", "", "", ""],
        ["Email", "", "MAHLARE6@GMAIL.COM", "MANAREDOREEN95@GMAIL.COM"],
    ];
    const parsed = (0, kideesysReportTableExtraction_1.extractKideesysReportTable)(matrix, "contact_list.xls");
    assert_1.default.ok(parsed, "expected contact list extraction");
    assert_1.default.ok(parsed.headers.includes("Parent Name"), `headers: ${parsed.headers.join(",")}`);
    assert_1.default.ok(parsed.headers.includes("Relationship"), `headers: ${parsed.headers.join(",")}`);
    assert_1.default.ok(parsed.headers.includes("Cell No"), `headers: ${parsed.headers.join(",")}`);
    assert_1.default.strictEqual(parsed.rows[0]["Learner Name"], "Atang Mothotse");
    assert_1.default.strictEqual(parsed.rows[0]["Parent Name"], "MAHLARE PHILLIP");
    assert_1.default.strictEqual(parsed.rows[0]["Relationship"], "Father");
    assert_1.default.strictEqual(parsed.rows[0]["Cell No"], "0725709043");
    assert_1.default.strictEqual(parsed.rows[0]["Email"], "MAHLARE6@GMAIL.COM");
    assert_1.default.strictEqual(parsed.rows[1]["Parent Name"], "MANARE DOREEN");
    assert_1.default.strictEqual(parsed.rows[1]["Cell No"], "0795813938");
    assert_1.default.strictEqual(parsed.rows[1]["Email"], "MANAREDOREEN95@GMAIL.COM");
}
function testClassListSynthetic() {
    const matrix = [
        ["Grade 1A 2026", ""],
        ["1", "Aiden Jacques Du Plessis"],
        ["2", "Amogelang Letoloto Raborife"],
    ];
    const parsed = (0, kideesysReportTableExtraction_1.extractKideesysReportTable)(matrix, "Grade_1A.xls");
    assert_1.default.ok(parsed);
    assert_1.default.deepStrictEqual(parsed.headers, ["fullName", "classroom"]);
    assert_1.default.strictEqual(parsed.rows[0].fullName, "Aiden Jacques Du Plessis");
}
function testStagingSamplesIfPresent() {
    const samples = [
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
        const full = path_1.default.resolve(__dirname, "../../../..", sample.file);
        if (!fs_1.default.existsSync(full))
            continue;
        const matrix = (0, migrationLearnerFileParser_1.readMigrationSpreadsheetMatrix)(fs_1.default.readFileSync(full), path_1.default.basename(full));
        const parsed = (0, kideesysReportTableExtraction_1.extractKideesysReportTable)(matrix, path_1.default.basename(full));
        assert_1.default.ok(parsed, `expected parse for ${sample.file}`);
        assert_1.default.ok(parsed.headers.includes(sample.expectHeader), `${sample.file} headers: ${parsed.headers.join(",")}`);
        assert_1.default.ok(parsed.rows.length > 0, `${sample.file} should have rows`);
    }
}
testAgeAnalysisSynthetic();
testTransactionSynthetic();
testContactListLeadingOPhoneCorrection();
testContactListSynthetic();
testClassListSynthetic();
testStagingSamplesIfPresent();
console.log("kideesysReportTableExtraction.test.ts: ok");
