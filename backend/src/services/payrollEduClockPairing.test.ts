/**
 * Pairing + period intersection unit tests.
 * Run: npx tsc && node dist/services/payrollEduClockPairing.test.js
 */
import type { EduClockEvent } from "@prisma/client";
import {
  computePayrollPeriodBounds,
  fullShiftMinutes,
  minutesBetween,
  pairEffectiveEventsForEmployee,
} from "./payrollEduClockPairing";
import type { EffectiveClockEvent } from "./payrollEduClockCorrectionResolution";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function eff(
  id: string,
  type: "CLOCK_IN" | "CLOCK_OUT",
  iso: string,
  employeeId = "emp1"
): EffectiveClockEvent {
  const effective = {
    id,
    schoolId: "s1",
    employeeId,
    employeeNumberSnapshot: "E1",
    userId: "u1",
    eventType: type,
    occurredAtUtc: new Date(iso),
    schoolLocalDate: "2026-08-01",
    schoolLocalTime: "08:00:00",
    timezone: "Africa/Johannesburg",
    source: "STAFF_MOBILE",
    createdAt: new Date(iso),
    createdByUserId: "u1",
    note: null,
    correctedFromEventId: null,
    isManualCorrection: false,
    metadata: null,
  } as EduClockEvent;
  return { effective, correctionMeta: null, rootEventId: id };
}

function main() {
  // Same-day
  {
    const period = computePayrollPeriodBounds(2026, 8);
    const r = pairEffectiveEventsForEmployee(
      "emp1",
      [eff("in", "CLOCK_IN", "2026-08-03T06:00:00.000Z"), eff("out", "CLOCK_OUT", "2026-08-03T14:00:00.000Z")],
      period
    );
    assert(r.pairs.length === 1, "one pair");
    assert(r.workedMinutes === 8 * 60, `expected 480 got ${r.workedMinutes}`);
    assert(r.pairs[0]!.includedMinutes === r.workedMinutes, "pair=line");
  }

  // Multiple shifts
  {
    const period = computePayrollPeriodBounds(2026, 8);
    const r = pairEffectiveEventsForEmployee(
      "emp1",
      [
        eff("i1", "CLOCK_IN", "2026-08-03T06:00:00.000Z"),
        eff("o1", "CLOCK_OUT", "2026-08-03T10:00:00.000Z"),
        eff("i2", "CLOCK_IN", "2026-08-03T11:00:00.000Z"),
        eff("o2", "CLOCK_OUT", "2026-08-03T15:00:00.000Z"),
      ],
      period
    );
    assert(r.pairs.length === 2, "two pairs");
    assert(r.workedMinutes === 8 * 60, "480 minutes");
    const sum = r.pairs.reduce((s, p) => s + p.includedMinutes, 0);
    assert(sum === r.workedMinutes, "sum pairs");
  }

  // Overnight within month
  {
    const period = computePayrollPeriodBounds(2026, 8);
    const r = pairEffectiveEventsForEmployee(
      "emp1",
      [
        eff("i", "CLOCK_IN", "2026-08-03T20:00:00.000Z"),
        eff("o", "CLOCK_OUT", "2026-08-04T04:00:00.000Z"),
      ],
      period
    );
    assert(r.pairs.length === 1, "overnight pair");
    assert(r.workedMinutes === 8 * 60, "480 overnight");
  }

  // Missing clock out
  {
    const period = computePayrollPeriodBounds(2026, 8);
    const r = pairEffectiveEventsForEmployee(
      "emp1",
      [eff("i", "CLOCK_IN", "2026-08-03T06:00:00.000Z")],
      period
    );
    assert(r.pairs.length === 0, "no pair");
    assert(r.warnings.some((w) => w.code === "MISSING_CLOCK_OUT"), "missing out");
  }

  // Missing clock in
  {
    const period = computePayrollPeriodBounds(2026, 8);
    const r = pairEffectiveEventsForEmployee(
      "emp1",
      [eff("o", "CLOCK_OUT", "2026-08-03T14:00:00.000Z")],
      period
    );
    assert(r.pairs.length === 0, "no pair");
    assert(r.warnings.some((w) => w.code === "MISSING_CLOCK_IN"), "missing in");
  }

  // Month-end split — shift 31 Aug 22:00 → 1 Sep 06:00 Johannesburg
  // Local Aug 31 22:00 = 20:00 UTC; Sep 1 06:00 = 04:00 UTC
  // Period Aug: start Jul 31 22:00 UTC, end Aug 31 22:00 UTC
  {
    const aug = computePayrollPeriodBounds(2026, 8);
    const sep = computePayrollPeriodBounds(2026, 9);
    const inUtc = "2026-08-31T20:00:00.000Z";
    const outUtc = "2026-09-01T04:00:00.000Z";
    const full = fullShiftMinutes(new Date(inUtc), new Date(outUtc));
    assert(full === 8 * 60, `full ${full}`);

    const rAug = pairEffectiveEventsForEmployee(
      "emp1",
      [eff("i", "CLOCK_IN", inUtc), eff("o", "CLOCK_OUT", outUtc)],
      aug
    );
    const rSep = pairEffectiveEventsForEmployee(
      "emp1",
      [eff("i", "CLOCK_IN", inUtc), eff("o", "CLOCK_OUT", outUtc)],
      sep
    );
    assert(rAug.pairs.length === 1 && rSep.pairs.length === 1, "both periods have pair");
    assert(rAug.pairs[0]!.crossesPeriodEnd === true, "aug crosses end");
    assert(rSep.pairs[0]!.crossesPeriodStart === true, "sep crosses start");
    const combined = rAug.workedMinutes + rSep.workedMinutes;
    assert(combined === full, `split ${rAug.workedMinutes}+${rSep.workedMinutes}=${combined} != ${full}`);
    assert(rAug.workedMinutes === minutesBetween(new Date(inUtc), aug.periodEndUtc), "aug portion");
    assert(rSep.workedMinutes === minutesBetween(sep.periodStartUtc, new Date(outUtc)), "sep portion");
  }

  // Year-end split Dec 31 → Jan 1
  {
    const dec = computePayrollPeriodBounds(2026, 12);
    const jan = computePayrollPeriodBounds(2027, 1);
    const inUtc = "2026-12-31T20:00:00.000Z";
    const outUtc = "2027-01-01T04:00:00.000Z";
    const full = fullShiftMinutes(new Date(inUtc), new Date(outUtc));
    const rDec = pairEffectiveEventsForEmployee(
      "emp1",
      [eff("i", "CLOCK_IN", inUtc), eff("o", "CLOCK_OUT", outUtc)],
      dec
    );
    const rJan = pairEffectiveEventsForEmployee(
      "emp1",
      [eff("i", "CLOCK_IN", inUtc), eff("o", "CLOCK_OUT", outUtc)],
      jan
    );
    assert(rDec.workedMinutes + rJan.workedMinutes === full, "year-end split");
  }

  // Duplicate clock-in sequence
  {
    const period = computePayrollPeriodBounds(2026, 8);
    const r = pairEffectiveEventsForEmployee(
      "emp1",
      [
        eff("i1", "CLOCK_IN", "2026-08-03T06:00:00.000Z"),
        eff("i2", "CLOCK_IN", "2026-08-03T07:00:00.000Z"),
        eff("o", "CLOCK_OUT", "2026-08-03T14:00:00.000Z"),
      ],
      period
    );
    assert(r.warnings.some((w) => w.code === "DUPLICATE_CLOCK_IN_SEQUENCE"), "dup in");
  }

  console.log("payrollEduClockPairing.test.ts: OK");
}

main();
