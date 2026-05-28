import assert from "assert";
import {
  correctKidESysContactListLeadingOPhone,
  normalizeKidESysContactListSheet,
} from "./kideesysContactListNormalization";

function testLeadingOPhoneHelper(): void {
  assert.deepStrictEqual(correctKidESysContactListLeadingOPhone("O726265905"), {
    value: "0726265905",
    corrected: true,
    from: "O726265905",
    to: "0726265905",
  });
  assert.deepStrictEqual(correctKidESysContactListLeadingOPhone("0726265905"), {
    value: "0726265905",
    corrected: false,
  });
  assert.deepStrictEqual(correctKidESysContactListLeadingOPhone("Mother"), {
    value: "Mother",
    corrected: false,
  });
  assert.deepStrictEqual(correctKidESysContactListLeadingOPhone("O72 626 5905"), {
    value: "O72 626 5905",
    corrected: false,
  });
  assert.deepStrictEqual(correctKidESysContactListLeadingOPhone("o726265905"), {
    value: "o726265905",
    corrected: false,
  });
}

function testDoesNotAlterParentNames(): void {
  const matrix = [
    ["Creche 2026"],
    [],
    ["Father - OCONNOR JOHN"],
    ["Child A", "Cell No", "0726111222"],
    ["Email", "john@example.com"],
  ];
  const parsed = normalizeKidESysContactListSheet(matrix, "contact_list.xls");
  assert.ok(parsed);
  assert.strictEqual(parsed.rows[0]["Parent Name"], "OCONNOR JOHN");
  assert.strictEqual(parsed.rows[0]["Cell No"], "0726111222");
  assert.strictEqual(parsed.parseIssues, undefined);
}

testLeadingOPhoneHelper();
testDoesNotAlterParentNames();
console.log("kideesysContactListNormalization.test.ts: ok");
