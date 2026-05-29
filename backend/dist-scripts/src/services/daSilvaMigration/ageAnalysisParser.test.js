"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const assert_1 = __importDefault(require("assert"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const ageAnalysisParser_1 = require("./ageAnalysisParser");
const parsers_1 = require("./parsers");
function testWithIndexColumn() {
    const matrix = [
        ["Bad Debt"],
        ["Account", "", "Balance", "", "Current", "30 Days", "60 Days", "90 Days", "120 Days"],
        ["1", "ALI002", "Alizain Ali", "7000.0", "3300.0", "3000.0", "3000.0", "3700.0", "-6000.0"],
        ["2", "MAO002", "Amogelang Maapoga\nOnkgopotse Leago Maapoga", "7200.0", "5800.0", "0.0", "1400.0", "0.0", "0.0"],
    ];
    const result = (0, ageAnalysisParser_1.parseAgeAnalysisSheet)({ name: "Report", rows: matrix });
    assert_1.default.strictEqual(result.accounts.length, 2);
    assert_1.default.strictEqual(result.accounts[0].accountNo, "ALI002");
    assert_1.default.strictEqual(result.accounts[0].balance, 7000);
    assert_1.default.strictEqual(result.accounts[0].current, 3300);
    assert_1.default.strictEqual(result.accounts[1].accountNo, "MAO002");
    assert_1.default.strictEqual(result.accounts[1].learnerNames?.length, 2);
    assert_1.default.ok(result.audit.accountNumbersParsed === 2);
    assert_1.default.ok(result.audit.sampleAccountNumbers.includes("ALI002"));
}
function testWithoutIndexColumn() {
    const matrix = [
        ["Bad Debt"],
        ["Account", "", "Balance", "", "Current", "30 Days"],
        ["ALI002", "Alizain Ali", "7000.0", "3300.0", "3000.0"],
        ["MAO002", "Amogelang Maapoga", "7200.0", "5800.0", "0.0"],
    ];
    const result = (0, ageAnalysisParser_1.parseAgeAnalysisSheet)({ name: "Report", rows: matrix });
    assert_1.default.strictEqual(result.accounts.length, 2, "expected accounts without index column");
    assert_1.default.strictEqual(result.accounts[0].accountNo, "ALI002");
    assert_1.default.strictEqual(result.accounts[1].accountNo, "MAO002");
}
function testStagingSampleIfPresent() {
    const sample = path_1.default.resolve(__dirname, "../../../storage/migration-staging/1779725506201-911019628-account_list__age_analysis_.xls");
    if (!fs_1.default.existsSync(sample))
        return;
    const beforeLegacy = 0;
    const parsed = (0, parsers_1.parseAgeAnalysisFileWithAudit)(sample);
    assert_1.default.ok(parsed.accounts.length > 300, `expected many accounts, got ${parsed.accounts.length}`);
    const ali = parsed.accounts.find((a) => a.accountNo === "ALI002");
    const mao = parsed.accounts.find((a) => a.accountNo === "MAO002");
    assert_1.default.ok(ali && ali.balance === 7000, "ALI002 balance");
    assert_1.default.ok(mao && mao.balance === 7200, "MAO002 balance");
    assert_1.default.ok(parsed.audit.accountNumbersParsed > 300);
    console.log(`staging sample: rows=${parsed.audit.ageAnalysisRowsParsed} accounts=${parsed.audit.accountNumbersParsed} (legacy would be ${beforeLegacy})`);
}
testWithIndexColumn();
testWithoutIndexColumn();
testStagingSampleIfPresent();
console.log("ageAnalysisParser.test.ts: ok");
