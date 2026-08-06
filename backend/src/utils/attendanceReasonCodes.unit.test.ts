/**
 * Attendance reason code resolution for weekly register display.
 * Run: npx ts-node --transpile-only src/utils/attendanceReasonCodes.unit.test.ts
 */
import assert from "assert";
import {
  buildAttendanceReasonLegend,
  formatReasonDetailLines,
  resolveRegisterDisplay,
} from "./attendanceReasonCodes";

function testStatusDefaults() {
  assert.strictEqual(resolveRegisterDisplay({ status: "PRESENT" }).abbrev, "P");
  assert.strictEqual(resolveRegisterDisplay({ status: "ABSENT" }).abbrev, "A");
  assert.strictEqual(resolveRegisterDisplay({ status: "LATE" }).abbrev, "L");
  assert.strictEqual(resolveRegisterDisplay({ status: "EXCUSED" }).abbrev, "E");
  assert.strictEqual(resolveRegisterDisplay({ status: "NOT_CAPTURED" }).abbrev, "NC");
  assert.strictEqual(resolveRegisterDisplay({ status: "NOT_SCHEDULED" }).abbrev, "NS");
}

function testExplicitReasonCodes() {
  const sick = resolveRegisterDisplay({ status: "ABSENT", reason: "S" });
  assert.strictEqual(sick.abbrev, "S");
  assert.strictEqual(sick.label, "Sick");
  assert.strictEqual(sick.fromReasonCode, true);
  assert.strictEqual(sick.teacherNote, null);

  const sn = resolveRegisterDisplay({ status: "ABSENT", reason: "SN - sent to sick bay" });
  assert.strictEqual(sn.abbrev, "SN");
  assert.strictEqual(sn.label, "Sick Bay");
  assert.strictEqual(sn.teacherNote, "sent to sick bay");
  assert.strictEqual(sn.reason, "SN - sent to sick bay");

  const official = resolveRegisterDisplay({ status: "EXCUSED", reason: "O: choir festival" });
  assert.strictEqual(official.abbrev, "O");
  assert.strictEqual(official.teacherNote, "choir festival");

  const family = resolveRegisterDisplay({ status: "ABSENT", reason: "F" });
  assert.strictEqual(family.abbrev, "F");
  assert.strictEqual(family.label, "Family Responsibility");
}

function testSynonyms() {
  const sick = resolveRegisterDisplay({ status: "ABSENT", reason: "Sick" });
  assert.strictEqual(sick.abbrev, "S");
  assert.strictEqual(sick.fromReasonCode, true);

  const bay = resolveRegisterDisplay({ status: "ABSENT", reason: "Sick Bay" });
  assert.strictEqual(bay.abbrev, "SN");

  const lateNote = resolveRegisterDisplay({ status: "LATE", reason: "Late - traffic" });
  assert.strictEqual(lateNote.abbrev, "L");
  assert.strictEqual(lateNote.teacherNote, "traffic");
}

function testFreeTextPreservedWithoutInventingCode() {
  const r = resolveRegisterDisplay({ status: "ABSENT", reason: "Parent phoned school" });
  assert.strictEqual(r.abbrev, "A");
  assert.strictEqual(r.fromReasonCode, false);
  assert.strictEqual(r.teacherNote, "Parent phoned school");
  assert.strictEqual(r.reason, "Parent phoned school");
}

function testReasonNeverDiscarded() {
  const r = resolveRegisterDisplay({ status: "ABSENT", reason: "SN - Parent phoned school." });
  assert.ok(r.reason?.includes("Parent phoned"));
  assert.strictEqual(r.abbrev, "SN");
}

function testLegend() {
  const legend = buildAttendanceReasonLegend({ usedAbbrevs: ["S", "SN", "P"] });
  const codes = legend.map((l) => l.abbrev);
  assert.ok(codes.includes("P"));
  assert.ok(codes.includes("A"));
  assert.ok(codes.includes("S"));
  assert.ok(codes.includes("SN"));
  assert.ok(codes.includes("L"));
  assert.ok(codes.includes("E"));
  assert.ok(codes.includes("O"));
  assert.ok(codes.includes("F"));
  assert.ok(codes.includes("NC"));
  assert.ok(codes.includes("NS"));
  assert.ok(!codes.includes("Period 9"));
}

function testDetailLines() {
  const lines = formatReasonDetailLines({
    abbrev: "S",
    label: "Sick",
    teacherNote: "Parent phoned school.",
    captureTimeDisplay: "07:18",
  });
  assert.deepStrictEqual(lines, ["S – Sick", "Parent phoned school.", "Captured 07:18"]);
}

function run() {
  testStatusDefaults();
  testExplicitReasonCodes();
  testSynonyms();
  testFreeTextPreservedWithoutInventingCode();
  testReasonNeverDiscarded();
  testLegend();
  testDetailLines();
  console.log("attendanceReasonCodes.unit.test.ts: OK");
}

run();
