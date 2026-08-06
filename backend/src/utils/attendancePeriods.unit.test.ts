/**
 * Attendance session keys: Period 8 + Intervention (backward compatible).
 * Run: npx ts-node --transpile-only src/utils/attendancePeriods.unit.test.ts
 */
import assert from "assert";
import {
  ATTENDANCE_PERIODS,
  normalizeAttendancePeriod,
  periodLabel,
} from "./attendancePeriods";
import {
  INTERVENTION_SESSION,
  PERIOD_REGISTER_COLUMNS,
  isNonSubjectClassicSession,
  normalizeAttendanceSessionKey,
} from "./attendanceSessionKeys";

function testPeriodListIncludesNewSessions() {
  assert.ok(ATTENDANCE_PERIODS.includes("PERIOD_8"));
  assert.ok(ATTENDANCE_PERIODS.includes("INTERVENTION"));
  assert.ok(ATTENDANCE_PERIODS.includes("PERIOD_7"));
  assert.ok(ATTENDANCE_PERIODS.includes("AFTERCARE"));
  assert.ok(ATTENDANCE_PERIODS.includes("DAILY"));
  // Existing Period 1–7 unchanged and ordered before Period 8
  const p1 = ATTENDANCE_PERIODS.indexOf("PERIOD_1");
  const p7 = ATTENDANCE_PERIODS.indexOf("PERIOD_7");
  const p8 = ATTENDANCE_PERIODS.indexOf("PERIOD_8");
  const intervention = ATTENDANCE_PERIODS.indexOf("INTERVENTION");
  assert.ok(p1 >= 0 && p7 === p1 + 6);
  assert.ok(p8 === p7 + 1);
  assert.ok(intervention === p8 + 1);
}

function testLabels() {
  assert.strictEqual(periodLabel("PERIOD_8"), "Period 8");
  assert.strictEqual(periodLabel("INTERVENTION"), "Intervention");
  assert.strictEqual(periodLabel("PERIOD_7"), "Period 7");
  assert.notStrictEqual(periodLabel("INTERVENTION"), "Period 9");
  assert.notStrictEqual(periodLabel(INTERVENTION_SESSION), "Period 9");
}

function testNormalizeClassicPeriods() {
  assert.strictEqual(normalizeAttendancePeriod("PERIOD_8"), "PERIOD_8");
  assert.strictEqual(normalizeAttendancePeriod("intervention"), "INTERVENTION");
  assert.strictEqual(normalizeAttendancePeriod("PERIOD_1"), "PERIOD_1");
  assert.strictEqual(normalizeAttendancePeriod("DAILY"), "DAILY");
  assert.strictEqual(normalizeAttendancePeriod("bogus"), null);
  assert.strictEqual(normalizeAttendancePeriod("PERIOD_9"), null);
}

function testNormalizeSessionKeys() {
  assert.strictEqual(normalizeAttendanceSessionKey("PERIOD_8"), "PERIOD_8");
  assert.strictEqual(normalizeAttendanceSessionKey("INTERVENTION"), "INTERVENTION");
  assert.strictEqual(normalizeAttendanceSessionKey("PERIOD_3"), "PERIOD_3");
  assert.strictEqual(normalizeAttendanceSessionKey("SLOT_abc"), "SLOT_abc");
  assert.strictEqual(normalizeAttendanceSessionKey("PERIOD_9"), null);
}

function testWeeklyRegisterColumns() {
  assert.strictEqual(PERIOD_REGISTER_COLUMNS.length, 8);
  assert.deepStrictEqual([...PERIOD_REGISTER_COLUMNS], [
    "PERIOD_1",
    "PERIOD_2",
    "PERIOD_3",
    "PERIOD_4",
    "PERIOD_5",
    "PERIOD_6",
    "PERIOD_7",
    "PERIOD_8",
  ]);
  assert.ok(!(PERIOD_REGISTER_COLUMNS as readonly string[]).includes("INTERVENTION"));
  assert.ok(!(PERIOD_REGISTER_COLUMNS as readonly string[]).includes("AFTERCARE"));
  assert.ok(!(PERIOD_REGISTER_COLUMNS as readonly string[]).includes("DAILY"));
}

function testInterventionNotSubjectClassic() {
  assert.strictEqual(isNonSubjectClassicSession("DAILY"), true);
  assert.strictEqual(isNonSubjectClassicSession("AFTERCARE"), true);
  assert.strictEqual(isNonSubjectClassicSession("INTERVENTION"), true);
  assert.strictEqual(isNonSubjectClassicSession("PERIOD_8"), false);
  assert.strictEqual(isNonSubjectClassicSession("PERIOD_1"), false);
}

function run() {
  testPeriodListIncludesNewSessions();
  testLabels();
  testNormalizeClassicPeriods();
  testNormalizeSessionKeys();
  testWeeklyRegisterColumns();
  testInterventionNotSubjectClassic();
  console.log("attendancePeriods.unit.test.ts: OK");
}

run();
