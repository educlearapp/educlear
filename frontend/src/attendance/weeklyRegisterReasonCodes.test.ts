/**
 * Frontend helpers for weekly register reason-code display.
 * Run: npx --yes tsx src/attendance/weeklyRegisterReasonCodes.test.ts
 */
import assert from "assert";
import {
  formatWeeklyCellDetailLines,
  weeklyCellTone,
  type WeeklyRegisterCell,
} from "./weeklyPeriodSubjectRegisterTypes";

const cell: WeeklyRegisterCell = {
  columnKey: "x",
  status: "ABSENT",
  abbrev: "S",
  label: "Sick",
  reason: "S - Parent phoned school.",
  fromReasonCode: true,
  teacherNote: "Parent phoned school.",
  captureTime: "2026-08-04T05:18:00.000Z",
};

assert.deepStrictEqual(formatWeeklyCellDetailLines(cell, "07:18"), [
  "S – Sick",
  "Parent phoned school.",
  "Captured 07:18",
]);
assert.strictEqual(weeklyCellTone("SN"), "absent");
assert.strictEqual(weeklyCellTone("P"), "present");
assert.strictEqual(weeklyCellTone("L"), "late");
assert.strictEqual(weeklyCellTone("O"), "excused");
console.log("weeklyRegisterReasonCodes.test.ts: OK");
