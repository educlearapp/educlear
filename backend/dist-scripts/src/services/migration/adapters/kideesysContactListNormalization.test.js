"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const assert_1 = __importDefault(require("assert"));
const kideesysContactListNormalization_1 = require("./kideesysContactListNormalization");
function testLeadingOPhoneHelper() {
    assert_1.default.deepStrictEqual((0, kideesysContactListNormalization_1.correctKidESysContactListLeadingOPhone)("O726265905"), {
        value: "0726265905",
        corrected: true,
        from: "O726265905",
        to: "0726265905",
    });
    assert_1.default.deepStrictEqual((0, kideesysContactListNormalization_1.correctKidESysContactListLeadingOPhone)("0726265905"), {
        value: "0726265905",
        corrected: false,
    });
    assert_1.default.deepStrictEqual((0, kideesysContactListNormalization_1.correctKidESysContactListLeadingOPhone)("Mother"), {
        value: "Mother",
        corrected: false,
    });
    assert_1.default.deepStrictEqual((0, kideesysContactListNormalization_1.correctKidESysContactListLeadingOPhone)("O72 626 5905"), {
        value: "O72 626 5905",
        corrected: false,
    });
    assert_1.default.deepStrictEqual((0, kideesysContactListNormalization_1.correctKidESysContactListLeadingOPhone)("o726265905"), {
        value: "o726265905",
        corrected: false,
    });
}
function testDoesNotAlterParentNames() {
    const matrix = [
        ["Creche 2026"],
        [],
        ["Father - OCONNOR JOHN"],
        ["Child A", "Cell No", "0726111222"],
        ["Email", "john@example.com"],
    ];
    const parsed = (0, kideesysContactListNormalization_1.normalizeKidESysContactListSheet)(matrix, "contact_list.xls");
    assert_1.default.ok(parsed);
    assert_1.default.strictEqual(parsed.rows[0]["Parent Name"], "OCONNOR JOHN");
    assert_1.default.strictEqual(parsed.rows[0]["Cell No"], "0726111222");
    assert_1.default.strictEqual(parsed.parseIssues, undefined);
}
testLeadingOPhoneHelper();
testDoesNotAlterParentNames();
console.log("kideesysContactListNormalization.test.ts: ok");
