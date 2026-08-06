/**
 * Unit tests for Weekly Period / Subject Register calculation and mode rules.
 * Run: npx ts-node --transpile-only src/services/weeklyPeriodSubjectRegisterService.unit.test.ts
 */
import assert from "assert";
import {
  computeSessionPercentage,
  mondayFridayOfWeek,
  resolveWeeklyDisplayMode,
  LEGACY_SUBJECT_NOTICE,
  SUBJECT_NOT_RECORDED_LABEL,
} from "./weeklyPeriodSubjectRegisterService";
import {
  normalizeAttendanceSessionKey,
  subjectSlotPeriodKey,
  parseSubjectSlotIdFromPeriod,
  PERIOD_REGISTER_COLUMNS,
  INTERVENTION_SESSION,
} from "../utils/attendanceSessionKeys";
import { periodLabel } from "../utils/attendancePeriods";
import {
  buildAttendanceReasonLegend,
  resolveRegisterDisplay,
} from "../utils/attendanceReasonCodes";

function testMondayFridayHeadings() {
  const w = mondayFridayOfWeek("2026-08-05"); // Wednesday
  assert.strictEqual(w.weekStart, "2026-08-03");
  assert.strictEqual(w.weekEnd, "2026-08-07");
  assert.deepStrictEqual(w.dates, [
    "2026-08-03",
    "2026-08-04",
    "2026-08-05",
    "2026-08-06",
    "2026-08-07",
  ]);
  assert.strictEqual(PERIOD_REGISTER_COLUMNS.length, 8);
  assert.strictEqual(PERIOD_REGISTER_COLUMNS[7], "PERIOD_8");
  assert.ok(!(PERIOD_REGISTER_COLUMNS as readonly string[]).includes(INTERVENTION_SESSION));
}

function testPeriodEightAndInterventionLabels() {
  assert.strictEqual(periodLabel("PERIOD_8"), "Period 8");
  assert.strictEqual(periodLabel(INTERVENTION_SESSION), "Intervention");
  assert.notStrictEqual(periodLabel(INTERVENTION_SESSION), "Period 9");
}

function testAutomaticDisplayMode() {
  assert.strictEqual(
    resolveWeeklyDisplayMode({ requested: "Automatic", classroomMode: "PERIODS" }),
    "PERIODS"
  );
  assert.strictEqual(
    resolveWeeklyDisplayMode({ requested: "Automatic", classroomMode: "SUBJECTS" }),
    "SUBJECTS"
  );
  assert.strictEqual(
    resolveWeeklyDisplayMode({ requested: "Periods", classroomMode: "SUBJECTS" }),
    "PERIODS"
  );
  assert.strictEqual(
    resolveWeeklyDisplayMode({ requested: "Subjects", classroomMode: "PERIODS" }),
    "SUBJECTS"
  );
  assert.strictEqual(
    resolveWeeklyDisplayMode({ requested: "Automatic", classroomMode: null }),
    "PERIODS"
  );
}

function testMixedStatusesAndNotCapturedNotPresent() {
  const pct = computeSessionPercentage({
    present: 2,
    late: 1,
    absent: 1,
    excused: 1,
    notCaptured: 10, // ignored in denominator
  });
  // eligible = 2+1+1+1 = 5; attended = 2+1 = 3 → 60%
  assert.strictEqual(pct.eligible, 5);
  assert.strictEqual(pct.attended, 3);
  assert.strictEqual(pct.percentage, 60);
}

function testNotScheduledExcludedViaEligibleOnly() {
  // Caller excludes NS from counts passed in — percentage uses only captured statuses.
  const pct = computeSessionPercentage({
    present: 1,
    late: 0,
    absent: 0,
    excused: 0,
    notCaptured: 0,
  });
  assert.strictEqual(pct.percentage, 100);
}

function testNoEligibleSessionsNullPercentage() {
  const pct = computeSessionPercentage({
    present: 0,
    late: 0,
    absent: 0,
    excused: 0,
    notCaptured: 5,
  });
  assert.strictEqual(pct.eligible, 0);
  assert.strictEqual(pct.percentage, null);
}

function testExcusedInDenominatorNotAttended() {
  const pct = computeSessionPercentage({
    present: 1,
    late: 0,
    absent: 0,
    excused: 1,
    notCaptured: 0,
  });
  assert.strictEqual(pct.eligible, 2);
  assert.strictEqual(pct.attended, 1);
  assert.strictEqual(pct.percentage, 50);
}

function testSessionKeys() {
  assert.strictEqual(normalizeAttendanceSessionKey("PERIOD_3"), "PERIOD_3");
  assert.strictEqual(normalizeAttendanceSessionKey("PERIOD_8"), "PERIOD_8");
  assert.strictEqual(normalizeAttendanceSessionKey("INTERVENTION"), "INTERVENTION");
  assert.strictEqual(normalizeAttendanceSessionKey("daily"), "DAILY");
  const key = subjectSlotPeriodKey("slot123");
  assert.strictEqual(key, "SLOT_slot123");
  assert.strictEqual(parseSubjectSlotIdFromPeriod(key), "slot123");
  assert.strictEqual(normalizeAttendanceSessionKey(key), key);
  assert.strictEqual(normalizeAttendanceSessionKey("BOGUS"), null);
  assert.strictEqual(normalizeAttendanceSessionKey("PERIOD_9"), null);
}

function testLegacyLabels() {
  assert.ok(LEGACY_SUBJECT_NOTICE.includes("before subject tracking"));
  assert.strictEqual(SUBJECT_NOT_RECORDED_LABEL, "Subject not recorded");
}

function testReasonCodeResolutionWired() {
  const sn = resolveRegisterDisplay({ status: "ABSENT", reason: "SN - note" });
  assert.strictEqual(sn.abbrev, "SN");
  const legend = buildAttendanceReasonLegend({ usedAbbrevs: ["SN"] });
  assert.ok(legend.some((l) => l.abbrev === "SN"));
  assert.ok(legend.some((l) => l.abbrev === "S"));
}

function run() {
  testMondayFridayHeadings();
  testPeriodEightAndInterventionLabels();
  testAutomaticDisplayMode();
  testMixedStatusesAndNotCapturedNotPresent();
  testNotScheduledExcludedViaEligibleOnly();
  testNoEligibleSessionsNullPercentage();
  testExcusedInDenominatorNotAttended();
  testSessionKeys();
  testLegacyLabels();
  testReasonCodeResolutionWired();
  console.log("weeklyPeriodSubjectRegisterService.unit.test.ts: OK");
}

run();
