"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const assert_1 = __importDefault(require("assert"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const migrationLearnerFileParser_1 = require("../../../utils/migrationLearnerFileParser");
const kideesysLearnerClassListNormalization_1 = require("./kideesysLearnerClassListNormalization");
const SAMPLE = path_1.default.resolve(__dirname, "../../../../uploads/migration-staging/cmpideqeq0000108xb6ouv9zi/kideesys-mpksdsua-p5rbjh/uploads/05_class_list/Grade_1A.xls");
function testSyntheticLayout() {
    const matrix = [
        ["Grade 1A 2026", ""],
        ["1", "Aiden Jacques Du Plessis"],
        ["2", "Amogelang Letoloto Raborife"],
    ];
    assert_1.default.strictEqual((0, kideesysLearnerClassListNormalization_1.isKidESysLearnerClassListLayout)(matrix), true);
    const parsed = (0, kideesysLearnerClassListNormalization_1.normalizeKidESysLearnerClassListSheet)(matrix, "Grade_1A.xls");
    assert_1.default.ok(parsed);
    assert_1.default.deepStrictEqual(parsed.headers, ["fullName", "classroom"]);
    assert_1.default.strictEqual(parsed.rows.length, 2);
    assert_1.default.strictEqual(parsed.rows[0].fullName, "Aiden Jacques Du Plessis");
    assert_1.default.strictEqual(parsed.rows[0].classroom, "Grade 1A");
}
function testStandardHeaderSheetNotNormalized() {
    const matrix = [
        ["Learner Name", "Grade", "Class"],
        ["Jane Doe", "5", "5A"],
    ];
    assert_1.default.strictEqual((0, kideesysLearnerClassListNormalization_1.isKidESysLearnerClassListLayout)(matrix), false);
    assert_1.default.strictEqual((0, kideesysLearnerClassListNormalization_1.normalizeKidESysLearnerClassListSheet)(matrix, "learners.csv"), null);
}
function testGrade1AFileIfPresent() {
    if (!fs_1.default.existsSync(SAMPLE))
        return;
    const buffer = fs_1.default.readFileSync(SAMPLE);
    const parsed = (0, migrationLearnerFileParser_1.parseMigrationLearnerFileBuffer)(buffer, "Grade_1A.xls");
    assert_1.default.ok(parsed.headers.includes("fullName"), `headers: ${parsed.headers.join(",")}`);
    assert_1.default.ok(parsed.rows.length > 0, "expected learner rows");
    const first = parsed.rows[0].fullName;
    assert_1.default.ok(first && first.length > 3, `first learner: ${first}`);
    assert_1.default.ok(parsed.rows.some((r) => /du\s*plessis/i.test(r.fullName)), "expected Du Plessis in list");
}
testSyntheticLayout();
testStandardHeaderSheetNotNormalized();
testGrade1AFileIfPresent();
console.log("kideesysLearnerClassListNormalization.test.ts: ok");
