/**
 * Lists & Registers employee attendance helpers (pure).
 * Run: npx tsx src/services/listsRegistersEmployeeAttendance.test.ts
 */
import assert from "assert";
import {
  buildListsRegistersEmployeeAttendanceRows,
  computeListsRegistersAttendanceDateRange,
  resolveEmployeeAttendanceDayStatus,
} from "./listsRegistersEmployeeAttendance";

function testWeeklyWeekdaysOnly() {
  // Anchor Wednesday 2026-07-22 → Mon 20 – Fri 24
  const range = computeListsRegistersAttendanceDateRange("weekly", "2026-07-22", false);
  assert.equal(range.startDate, "2026-07-20");
  assert.equal(range.endDate, "2026-07-24");
  assert.deepEqual(range.dates, [
    "2026-07-20",
    "2026-07-21",
    "2026-07-22",
    "2026-07-23",
    "2026-07-24",
  ]);
  assert.equal(range.dates.includes("2026-07-25"), false);
  assert.equal(range.dates.includes("2026-07-26"), false);
  console.log("✓ weekly without weekends → Mon–Fri");
}

function testWeeklyWithWeekends() {
  const range = computeListsRegistersAttendanceDateRange("weekly", "2026-07-22", true);
  assert.equal(range.startDate, "2026-07-20");
  assert.equal(range.endDate, "2026-07-26");
  assert.equal(range.dates.length, 7);
  assert.ok(range.dates.includes("2026-07-25"));
  assert.ok(range.dates.includes("2026-07-26"));
  console.log("✓ weekly with weekends → Mon–Sun");
}

function testWeeklyFromSundayAnchor() {
  // Sunday 2026-07-26 belongs to week starting Mon 20
  const range = computeListsRegistersAttendanceDateRange("weekly", "2026-07-26", false);
  assert.equal(range.startDate, "2026-07-20");
  assert.equal(range.endDate, "2026-07-24");
  console.log("✓ Sunday anchor still resolves prior Monday week");
}

function testMonthlyWeekdayFilter() {
  const noWeekend = computeListsRegistersAttendanceDateRange("monthly", "2026-02-15", false);
  assert.equal(noWeekend.startDate, "2026-02-01");
  assert.equal(noWeekend.endDate, "2026-02-28");
  assert.equal(noWeekend.dates.includes("2026-02-01"), false); // Sunday
  assert.equal(noWeekend.dates.includes("2026-02-07"), false); // Saturday
  assert.ok(noWeekend.dates.includes("2026-02-02")); // Monday

  const withWeekend = computeListsRegistersAttendanceDateRange("monthly", "2026-02-15", true);
  assert.equal(withWeekend.dates.length, 28);
  assert.ok(withWeekend.dates.includes("2026-02-01"));
  assert.ok(withWeekend.dates.includes("2026-02-07"));
  console.log("✓ monthly weekend filtering");
}

function testStatusResolution() {
  assert.equal(
    resolveEmployeeAttendanceDayStatus({ hasAbsence: true, hasClockIn: true }),
    "Absent"
  );
  assert.equal(
    resolveEmployeeAttendanceDayStatus({ hasAbsence: false, hasClockIn: true }),
    "Present"
  );
  assert.equal(
    resolveEmployeeAttendanceDayStatus({ hasAbsence: false, hasClockIn: false }),
    "Not Clocked In"
  );
  console.log("✓ status: Absent / Present / Not Clocked In");
}

function testEmployeeShapedRowsNotLearner() {
  const rows = buildListsRegistersEmployeeAttendanceRows({
    employees: [
      {
        id: "emp-1",
        employeeNumber: "E001",
        firstName: "Ada",
        lastName: "Ng",
        department: "Admin",
        jobTitle: "Clerk",
      },
      {
        id: "emp-2",
        employeeNumber: "E002",
        firstName: "Ben",
        lastName: "Adams",
        department: null,
        jobTitle: null,
      },
    ],
    dates: ["2026-07-20", "2026-07-21"],
    events: [
      {
        employeeId: "emp-1",
        eventType: "CLOCK_IN",
        schoolLocalDate: "2026-07-20",
        schoolLocalTime: "07:55",
        occurredAtUtc: new Date("2026-07-20T05:55:00.000Z"),
      },
      {
        employeeId: "emp-1",
        eventType: "CLOCK_OUT",
        schoolLocalDate: "2026-07-20",
        schoolLocalTime: "16:10",
        occurredAtUtc: new Date("2026-07-20T14:10:00.000Z"),
      },
    ],
    absences: [{ employeeId: "emp-2", schoolLocalDate: "2026-07-21" }],
    includeTimes: true,
  });

  assert.equal(rows.length, 4);
  // Sort: date then surname — Adams before Ng on same date
  assert.equal(rows[0].date, "2026-07-20");
  assert.equal(rows[0].lastName, "Adams");
  assert.equal(rows[0].status, "Not Clocked In");
  assert.equal(rows[1].lastName, "Ng");
  assert.equal(rows[1].status, "Present");
  assert.equal(rows[1].clockIn, "07:55");
  assert.equal(rows[1].clockOut, "16:10");
  assert.equal(rows[2].date, "2026-07-21");
  assert.equal(rows[2].lastName, "Adams");
  assert.equal(rows[2].status, "Absent");
  assert.equal(rows[3].lastName, "Ng");
  assert.equal(rows[3].status, "Not Clocked In");

  for (const row of rows) {
    assert.ok("employeeId" in row);
    assert.ok("employeeNumber" in row);
    assert.ok("firstName" in row);
    assert.ok("lastName" in row);
    assert.ok("department" in row);
    assert.ok("jobTitle" in row);
    assert.equal("grade" in row, false);
    assert.equal("classroom" in row, false);
    assert.equal("surname" in row, false);
    assert.equal("learnerId" in row, false);
  }
  console.log("✓ rows are employee-shaped (no learner fields)");
}

function testIncludeTimesFalseClearsTimes() {
  const rows = buildListsRegistersEmployeeAttendanceRows({
    employees: [
      {
        id: "emp-1",
        employeeNumber: "E001",
        firstName: "Ada",
        lastName: "Ng",
        department: null,
        jobTitle: null,
      },
    ],
    dates: ["2026-07-20"],
    events: [
      {
        employeeId: "emp-1",
        eventType: "CLOCK_IN",
        schoolLocalDate: "2026-07-20",
        schoolLocalTime: "07:55",
        occurredAtUtc: new Date("2026-07-20T05:55:00.000Z"),
      },
    ],
    absences: [],
    includeTimes: false,
  });
  assert.equal(rows[0].status, "Present");
  assert.equal(rows[0].clockIn, null);
  assert.equal(rows[0].clockOut, null);
  console.log("✓ includeTimes=false omits clock times");
}

function testInvalidAnchor() {
  assert.throws(
    () => computeListsRegistersAttendanceDateRange("weekly", "not-a-date", false),
    /anchorDate/
  );
  console.log("✓ invalid anchorDate throws");
}

testWeeklyWeekdaysOnly();
testWeeklyWithWeekends();
testWeeklyFromSundayAnchor();
testMonthlyWeekdayFilter();
testStatusResolution();
testEmployeeShapedRowsNotLearner();
testIncludeTimesFalseClearsTimes();
testInvalidAnchor();
console.log("\nAll listsRegistersEmployeeAttendance tests passed.");
