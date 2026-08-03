/**
 * EduClock event pairing + period intersection for payroll.
 * Pair table is authoritative for includedMinutes (stored once per pair).
 */
import type { EduClockEvent, EduClockEventType } from "@prisma/client";
import {
  type CorrectionMetaSnapshot,
  type EffectiveClockEvent,
} from "./payrollEduClockCorrectionResolution";
import { DEFAULT_SCHOOL_TIMEZONE } from "../utils/schoolLocalTime";

export const EDUCLOCK_PAYROLL_CALC_VERSION = "educlock-payroll-v1";

export type PeriodBounds = {
  periodStartUtc: Date;
  periodEndUtc: Date;
  schoolTimezone: string;
  payrollMonth: number;
  payrollYear: number;
};

export type PairingWarningCode =
  | "MISSING_CLOCK_OUT"
  | "MISSING_CLOCK_IN"
  | "INVALID_EVENT_SEQUENCE"
  | "DUPLICATE_CLOCK_IN_SEQUENCE"
  | "DUPLICATE_CLOCK_OUT_SEQUENCE"
  | "ZERO_DURATION_PAIR"
  | "OUTSIDE_PERIOD"
  | "CORRECTION_BLOCKED"
  | "OVERTIME_RULES_NOT_CONFIGURED"
  | "MISSING_EMPLOYEE_NUMBER"
  | "DUPLICATE_EMPLOYEE_NUMBER"
  | "INACTIVE_EMPLOYEE"
  | "PAYROLL_RUN_EMPLOYEE_MISSING"
  | "NO_LINKED_USER";

export type ComputedPair = {
  pairKey: string;
  employeeId: string;
  clockIn: EffectiveClockEvent;
  clockOut: EffectiveClockEvent;
  clockInUtc: Date;
  clockOutUtc: Date;
  intervalStartUtc: Date;
  intervalEndUtc: Date;
  includedMinutes: number;
  crossesPeriodStart: boolean;
  crossesPeriodEnd: boolean;
};

export type EmployeePairingResult = {
  employeeId: string;
  pairs: ComputedPair[];
  workedMinutes: number;
  warnings: { code: PairingWarningCode; detail: string }[];
  unmatchedIns: EffectiveClockEvent[];
  unmatchedOuts: EffectiveClockEvent[];
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Half-open [periodStartUtc, periodEndUtc) for a calendar month in school TZ.
 * Africa/Johannesburg is fixed UTC+2 (no DST).
 */
export function computePayrollPeriodBounds(
  payrollYear: number,
  payrollMonth: number,
  schoolTimezone: string = DEFAULT_SCHOOL_TIMEZONE
): PeriodBounds {
  if (!Number.isInteger(payrollYear) || !Number.isInteger(payrollMonth) || payrollMonth < 1 || payrollMonth > 12) {
    throw new Error("Invalid payroll month/year");
  }
  const tz = schoolTimezone || DEFAULT_SCHOOL_TIMEZONE;
  // Johannesburg / fixed +02:00 — EduClear school default.
  const offset = tz === "Africa/Johannesburg" || tz === DEFAULT_SCHOOL_TIMEZONE ? "+02:00" : "+02:00";
  const start = new Date(`${payrollYear}-${pad2(payrollMonth)}-01T00:00:00${offset}`);
  const endMonth = payrollMonth === 12 ? 1 : payrollMonth + 1;
  const endYear = payrollMonth === 12 ? payrollYear + 1 : payrollYear;
  const end = new Date(`${endYear}-${pad2(endMonth)}-01T00:00:00${offset}`);
  return {
    periodStartUtc: start,
    periodEndUtc: end,
    schoolTimezone: tz,
    payrollMonth,
    payrollYear,
  };
}

/** Intersection of [aStart, aEnd) with [bStart, bEnd); null if empty. */
export function intersectHalfOpen(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date
): { start: Date; end: Date } | null {
  const startMs = Math.max(aStart.getTime(), bStart.getTime());
  const endMs = Math.min(aEnd.getTime(), bEnd.getTime());
  if (endMs <= startMs) return null;
  return { start: new Date(startMs), end: new Date(endMs) };
}

export function minutesBetween(start: Date, end: Date): number {
  return Math.floor((end.getTime() - start.getTime()) / 60000);
}

/**
 * Pair effective CLOCK_IN → next CLOCK_OUT chronologically.
 * Does not invent clock-outs. Supports multi-shift and overnight.
 */
export function pairEffectiveEventsForEmployee(
  employeeId: string,
  effectiveEvents: EffectiveClockEvent[],
  period: PeriodBounds
): EmployeePairingResult {
  const warnings: { code: PairingWarningCode; detail: string }[] = [];
  const sorted = [...effectiveEvents].sort((a, b) => {
    const t = a.effective.occurredAtUtc.getTime() - b.effective.occurredAtUtc.getTime();
    if (t !== 0) return t;
    return a.effective.id.localeCompare(b.effective.id);
  });

  const pairs: ComputedPair[] = [];
  const unmatchedIns: EffectiveClockEvent[] = [];
  const unmatchedOuts: EffectiveClockEvent[] = [];
  let openIn: EffectiveClockEvent | null = null;
  let pairIndex = 0;

  for (const ev of sorted) {
    const type = ev.effective.eventType as EduClockEventType;
    if (type === "CLOCK_IN") {
      if (openIn) {
        warnings.push({
          code: "DUPLICATE_CLOCK_IN_SEQUENCE",
          detail: `Clock In ${ev.effective.id} while open ${openIn.effective.id}`,
        });
        unmatchedIns.push(openIn);
        warnings.push({
          code: "MISSING_CLOCK_OUT",
          detail: `Unclosed Clock In ${openIn.effective.id}`,
        });
      }
      openIn = ev;
    } else if (type === "CLOCK_OUT") {
      if (!openIn) {
        warnings.push({
          code: "MISSING_CLOCK_IN",
          detail: `Clock Out ${ev.effective.id} without prior Clock In`,
        });
        warnings.push({
          code: "DUPLICATE_CLOCK_OUT_SEQUENCE",
          detail: `Orphan Clock Out ${ev.effective.id}`,
        });
        unmatchedOuts.push(ev);
        continue;
      }
      const inUtc = openIn.effective.occurredAtUtc;
      const outUtc = ev.effective.occurredAtUtc;
      if (outUtc.getTime() <= inUtc.getTime()) {
        warnings.push({
          code: "INVALID_EVENT_SEQUENCE",
          detail: `Clock Out ${ev.effective.id} not after Clock In ${openIn.effective.id}`,
        });
        unmatchedIns.push(openIn);
        unmatchedOuts.push(ev);
        openIn = null;
        continue;
      }

      const intersection = intersectHalfOpen(
        inUtc,
        outUtc,
        period.periodStartUtc,
        period.periodEndUtc
      );
      if (!intersection) {
        // Entirely outside this period — not a warning for this import; just skip payable
        openIn = null;
        continue;
      }

      const includedMinutes = minutesBetween(intersection.start, intersection.end);
      if (includedMinutes <= 0) {
        warnings.push({
          code: "ZERO_DURATION_PAIR",
          detail: `Pair ${openIn.effective.id}/${ev.effective.id} has zero minutes in period`,
        });
        openIn = null;
        continue;
      }

      pairIndex += 1;
      const pairKey = `${employeeId}:${pairIndex}:${openIn.effective.id}:${ev.effective.id}`;
      pairs.push({
        pairKey,
        employeeId,
        clockIn: openIn,
        clockOut: ev,
        clockInUtc: inUtc,
        clockOutUtc: outUtc,
        intervalStartUtc: intersection.start,
        intervalEndUtc: intersection.end,
        includedMinutes,
        crossesPeriodStart: inUtc.getTime() < period.periodStartUtc.getTime(),
        crossesPeriodEnd: outUtc.getTime() > period.periodEndUtc.getTime(),
      });
      openIn = null;
    }
  }

  if (openIn) {
    unmatchedIns.push(openIn);
    warnings.push({
      code: "MISSING_CLOCK_OUT",
      detail: `Unclosed Clock In ${openIn.effective.id}`,
    });
  }

  const workedMinutes = pairs.reduce((s, p) => s + p.includedMinutes, 0);
  return {
    employeeId,
    pairs,
    workedMinutes,
    warnings,
    unmatchedIns,
    unmatchedOuts,
  };
}

export type HashablePair = {
  pairKey: string;
  employeeId: string;
  clockInEventId: string;
  clockOutEventId: string;
  intervalStartUtc: string;
  intervalEndUtc: string;
  includedMinutes: number;
};

export type HashableLine = {
  employeeId: string;
  workedMinutes: number;
  status: string;
  warningCodes: string[];
  sourcePairCount: number;
};

export function buildPreviewCanonicalPayload(input: {
  sourceCalculationVersion: string;
  schoolId: string;
  payrollMonth: number;
  payrollYear: number;
  schoolTimezone: string;
  periodStartUtc: string;
  periodEndUtc: string;
  payrollRunId: string | null;
  pairs: HashablePair[];
  lines: HashableLine[];
  preflightCodes: string[];
}): unknown {
  const pairs = [...input.pairs].sort((a, b) => a.pairKey.localeCompare(b.pairKey));
  const lines = [...input.lines].sort((a, b) => a.employeeId.localeCompare(b.employeeId));
  return {
    sourceCalculationVersion: input.sourceCalculationVersion,
    schoolId: input.schoolId,
    payrollMonth: input.payrollMonth,
    payrollYear: input.payrollYear,
    schoolTimezone: input.schoolTimezone,
    periodStartUtc: input.periodStartUtc,
    periodEndUtc: input.periodEndUtc,
    payrollRunId: input.payrollRunId,
    pairs,
    lines: lines.map((l) => ({
      ...l,
      warningCodes: [...l.warningCodes].sort(),
    })),
    preflightCodes: [...input.preflightCodes].sort(),
  };
}

export function correctionMetaForEvent(
  ev: EffectiveClockEvent
): CorrectionMetaSnapshot | null {
  return ev.correctionMeta;
}

/** Full shift duration minutes before period split (for reconciliation tests). */
export function fullShiftMinutes(clockInUtc: Date, clockOutUtc: Date): number {
  return minutesBetween(clockInUtc, clockOutUtc);
}

export type { EduClockEvent };
