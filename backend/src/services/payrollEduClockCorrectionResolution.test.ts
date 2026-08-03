/**
 * EduClock correction resolution unit tests.
 * Run: npx tsc && node dist/services/payrollEduClockCorrectionResolution.test.js
 */
import type { EduClockEvent } from "@prisma/client";
import { resolveEffectiveClockEvents } from "./payrollEduClockCorrectionResolution";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function ev(partial: Partial<EduClockEvent> & Pick<EduClockEvent, "id" | "employeeId" | "eventType" | "occurredAtUtc">): EduClockEvent {
  return {
    schoolId: "school1",
    userId: "user1",
    employeeNumberSnapshot: "E1",
    schoolLocalDate: "2026-08-01",
    schoolLocalTime: "08:00:00",
    timezone: "Africa/Johannesburg",
    source: "STAFF_MOBILE",
    createdAt: new Date("2026-08-01T06:00:00.000Z"),
    createdByUserId: "owner1",
    note: null,
    correctedFromEventId: null,
    isManualCorrection: false,
    metadata: null,
    latitude: null,
    longitude: null,
    accuracyMetres: null,
    matchedEntranceId: null,
    distanceMetres: null,
    validationVersion: null,
    ...partial,
  } as EduClockEvent;
}

function main() {
  // Normal uncorrected
  {
    const a = ev({
      id: "in1",
      employeeId: "emp1",
      eventType: "CLOCK_IN",
      occurredAtUtc: new Date("2026-08-01T06:00:00.000Z"),
    });
    const b = ev({
      id: "out1",
      employeeId: "emp1",
      eventType: "CLOCK_OUT",
      occurredAtUtc: new Date("2026-08-01T14:00:00.000Z"),
    });
    const r = resolveEffectiveClockEvents([a, b], "school1");
    assert(r.effectiveByEmployee.get("emp1")!.length === 2, "two effective");
    assert(!r.excludedEventIds.has("in1"), "in not excluded");
  }

  // Correction replaces original
  {
    const original = ev({
      id: "orig-in",
      employeeId: "emp1",
      eventType: "CLOCK_IN",
      occurredAtUtc: new Date("2026-08-01T06:00:00.000Z"),
    });
    const correction = ev({
      id: "corr-in",
      employeeId: "emp1",
      eventType: "CLOCK_IN",
      occurredAtUtc: new Date("2026-08-01T06:15:00.000Z"),
      isManualCorrection: true,
      source: "OWNER_MANUAL",
      correctedFromEventId: "orig-in",
      createdByUserId: "owner1",
      metadata: { action: "CORRECT_TIME", reason: "Owner-approved correction" },
      createdAt: new Date("2026-08-01T10:00:00.000Z"),
    });
    const out = ev({
      id: "out1",
      employeeId: "emp1",
      eventType: "CLOCK_OUT",
      occurredAtUtc: new Date("2026-08-01T14:00:00.000Z"),
    });
    const r = resolveEffectiveClockEvents([original, correction, out], "school1");
    const list = r.effectiveByEmployee.get("emp1")!;
    assert(list.some((x) => x.effective.id === "corr-in"), "correction effective");
    assert(!list.some((x) => x.effective.id === "orig-in"), "original not effective");
    assert(r.excludedEventIds.has("orig-in"), "original excluded");
    const meta = list.find((x) => x.effective.id === "corr-in")!.correctionMeta!;
    assert(meta.approvalPolicy === "OWNER_IMMEDIATE_APPROVAL", "approval policy");
    assert(meta.originalEventId === "orig-in", "original id");
    assert(meta.chainEventIds.includes("orig-in") && meta.chainEventIds.includes("corr-in"), "chain");
  }

  // Cycle blocked
  {
    const a = ev({
      id: "a",
      employeeId: "emp1",
      eventType: "CLOCK_IN",
      occurredAtUtc: new Date("2026-08-01T06:00:00.000Z"),
      isManualCorrection: true,
      correctedFromEventId: "b",
      createdByUserId: "owner1",
      metadata: { action: "CORRECT_TIME", reason: "x" },
    });
    const b = ev({
      id: "b",
      employeeId: "emp1",
      eventType: "CLOCK_IN",
      occurredAtUtc: new Date("2026-08-01T06:10:00.000Z"),
      isManualCorrection: true,
      correctedFromEventId: "a",
      createdByUserId: "owner1",
      metadata: { action: "CORRECT_TIME", reason: "x" },
    });
    const r = resolveEffectiveClockEvents([a, b], "school1");
    assert(r.issues.some((i) => i.code === "CORRECTION_CYCLE"), "cycle issue");
  }

  // Cross-employee blocked
  {
    const orig = ev({
      id: "o",
      employeeId: "emp1",
      eventType: "CLOCK_IN",
      occurredAtUtc: new Date("2026-08-01T06:00:00.000Z"),
    });
    const corr = ev({
      id: "c",
      employeeId: "emp2",
      eventType: "CLOCK_IN",
      occurredAtUtc: new Date("2026-08-01T06:05:00.000Z"),
      isManualCorrection: true,
      correctedFromEventId: "o",
      createdByUserId: "owner1",
      metadata: { action: "CORRECT_TIME", reason: "x" },
    });
    const r = resolveEffectiveClockEvents([orig, corr], "school1");
    assert(r.issues.some((i) => i.code === "CORRECTION_CROSS_EMPLOYEE"), "cross employee");
  }

  // Cross-school blocked
  {
    const orig = ev({
      id: "o2",
      schoolId: "school2",
      employeeId: "emp1",
      eventType: "CLOCK_IN",
      occurredAtUtc: new Date("2026-08-01T06:00:00.000Z"),
    });
    const corr = ev({
      id: "c2",
      employeeId: "emp1",
      eventType: "CLOCK_IN",
      occurredAtUtc: new Date("2026-08-01T06:05:00.000Z"),
      isManualCorrection: true,
      correctedFromEventId: "o2",
      createdByUserId: "owner1",
      metadata: { action: "CORRECT_TIME", reason: "x" },
    });
    const r = resolveEffectiveClockEvents([orig, corr], "school1");
    assert(
      r.issues.some((i) => i.code === "CORRECTION_CROSS_SCHOOL" || i.code === "CORRECTION_MISSING_ANCESTOR"),
      "cross school or missing ancestor"
    );
  }

  // Ambiguous terminals blocked
  {
    const orig = ev({
      id: "root",
      employeeId: "emp1",
      eventType: "CLOCK_IN",
      occurredAtUtc: new Date("2026-08-01T06:00:00.000Z"),
    });
    const c1 = ev({
      id: "t1",
      employeeId: "emp1",
      eventType: "CLOCK_IN",
      occurredAtUtc: new Date("2026-08-01T06:05:00.000Z"),
      isManualCorrection: true,
      correctedFromEventId: "root",
      createdByUserId: "owner1",
      metadata: { action: "CORRECT_TIME", reason: "a" },
    });
    const c2 = ev({
      id: "t2",
      employeeId: "emp1",
      eventType: "CLOCK_IN",
      occurredAtUtc: new Date("2026-08-01T06:06:00.000Z"),
      isManualCorrection: true,
      correctedFromEventId: "root",
      createdByUserId: "owner1",
      metadata: { action: "CORRECT_TIME", reason: "b" },
    });
    const r = resolveEffectiveClockEvents([orig, c1, c2], "school1");
    assert(r.issues.some((i) => i.code === "CORRECTION_AMBIGUOUS_TERMINAL"), "ambiguous");
    assert(!r.effectiveByEmployee.get("emp1")?.some((x) => x.effective.id === "t1"), "no t1");
    assert(!r.effectiveByEmployee.get("emp1")?.some((x) => x.effective.id === "t2"), "no t2");
  }

  // Unrelated employee unaffected
  {
    const a = ev({
      id: "e1in",
      employeeId: "emp1",
      eventType: "CLOCK_IN",
      occurredAtUtc: new Date("2026-08-01T06:00:00.000Z"),
    });
    const aOut = ev({
      id: "e1out",
      employeeId: "emp1",
      eventType: "CLOCK_OUT",
      occurredAtUtc: new Date("2026-08-01T14:00:00.000Z"),
    });
    const bad = ev({
      id: "bad",
      employeeId: "emp2",
      eventType: "CLOCK_IN",
      occurredAtUtc: new Date("2026-08-01T06:00:00.000Z"),
      isManualCorrection: true,
      correctedFromEventId: "missing",
      createdByUserId: "owner1",
      metadata: { action: "CORRECT_TIME", reason: "x" },
    });
    const r = resolveEffectiveClockEvents([a, aOut, bad], "school1");
    assert(r.effectiveByEmployee.get("emp1")!.length === 2, "emp1 intact");
    assert(r.issues.some((i) => i.code === "CORRECTION_MISSING_ANCESTOR"), "missing ancestor on emp2");
  }

  console.log("payrollEduClockCorrectionResolution.test.ts: OK");
}

main();
