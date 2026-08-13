/**
 * EduClock attendance duration rules — unit tests (no DB).
 * Run: npx tsc && node dist/services/educlockAttendanceDuration.test.js
 */
import assert from "node:assert/strict";
import {
  durationBetweenClockEvents,
  formatWorkedDurationMs,
  isHistoricalMissingClockOut,
  resolveOpenShiftWorkedDuration,
  shouldSurfaceMissingClockOutOnDate,
} from "./educlockAttendanceDuration";

const now = new Date("2026-08-13T09:34:00+02:00");
const today = "2026-08-13";

// Documents the production symptom if duration were wrongly computed as now - clockIn.
const caseAIn = new Date("2026-08-11T07:27:00+02:00");
const caseBIn = new Date("2026-08-11T06:53:00+02:00");
assert.equal(formatWorkedDurationMs(now.getTime() - caseAIn.getTime()), "50h 7m");
assert.equal(formatWorkedDurationMs(now.getTime() - caseBIn.getTime()), "50h 41m");

// Case A — historical missing clock-out must be incomplete, not 50h 7m.
assert.equal(
  resolveOpenShiftWorkedDuration({
    clockOutAtUtc: null,
    openedAtUtc: caseAIn,
    openShiftSchoolLocalDate: "2026-08-11",
    todaySchoolLocalDate: today,
    nowUtc: now,
  }),
  null
);

// Case B — historical missing clock-out must be incomplete, not 50h 41m.
assert.equal(
  resolveOpenShiftWorkedDuration({
    clockOutAtUtc: null,
    openedAtUtc: caseBIn,
    openShiftSchoolLocalDate: "2026-08-11",
    todaySchoolLocalDate: today,
    nowUtc: now,
  }),
  null
);

// EMPTEST01 before correction
const empIn = new Date("2026-08-12T07:18:00+02:00");
assert.equal(
  resolveOpenShiftWorkedDuration({
    clockOutAtUtc: null,
    openedAtUtc: empIn,
    openShiftSchoolLocalDate: "2026-08-12",
    todaySchoolLocalDate: today,
    nowUtc: now,
  }),
  null
);
assert.equal(isHistoricalMissingClockOut({
  openShiftSchoolLocalDate: "2026-08-12",
  todaySchoolLocalDate: today,
}), true);

// EMPTEST01 after correction to 15:00 → 7h 42m
const empOut = new Date("2026-08-12T15:00:00+02:00");
assert.equal(durationBetweenClockEvents(empIn, empOut), "7h 42m");

// Jemmah synthetic: 2026-08-12 07:18 → 16:00 Africa/Johannesburg = 8h 42m
const jemmahOut = new Date("2026-08-12T16:00:00+02:00");
assert.equal(durationBetweenClockEvents(empIn, jemmahOut), "8h 42m");

// Same-day live open shift still shows live duration
const liveIn = new Date("2026-08-13T07:18:00+02:00");
assert.equal(
  resolveOpenShiftWorkedDuration({
    clockOutAtUtc: null,
    openedAtUtc: liveIn,
    openShiftSchoolLocalDate: today,
    todaySchoolLocalDate: today,
    nowUtc: now,
  }),
  "2h 16m"
);

// Surface stale missing-clock-out on affected date and today, not on unrelated dates
assert.equal(
  shouldSurfaceMissingClockOutOnDate({
    openShiftSchoolLocalDate: "2026-08-12",
    viewedSchoolLocalDate: "2026-08-12",
    todaySchoolLocalDate: today,
  }),
  true
);
assert.equal(
  shouldSurfaceMissingClockOutOnDate({
    openShiftSchoolLocalDate: "2026-08-12",
    viewedSchoolLocalDate: today,
    todaySchoolLocalDate: today,
  }),
  true
);
assert.equal(
  shouldSurfaceMissingClockOutOnDate({
    openShiftSchoolLocalDate: "2026-08-12",
    viewedSchoolLocalDate: "2026-08-10",
    todaySchoolLocalDate: today,
  }),
  false
);
assert.equal(
  shouldSurfaceMissingClockOutOnDate({
    openShiftSchoolLocalDate: today,
    viewedSchoolLocalDate: today,
    todaySchoolLocalDate: today,
  }),
  false
);

console.log("educlockAttendanceDuration.test.ts: OK");
