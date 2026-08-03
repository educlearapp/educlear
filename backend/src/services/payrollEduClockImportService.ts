/**
 * EduClock → Payroll import: read-only preview, atomic confirm, atomic recalculate.
 */
import crypto from "crypto";
import {
  Prisma,
  type Employee,
  type PayrollEduClockImport,
  type PayrollRun,
} from "@prisma/client";
import { prisma } from "../prisma";
import { DEFAULT_SCHOOL_TIMEZONE } from "../utils/schoolLocalTime";
import {
  resolveEffectiveClockEvents,
  type CorrectionResolutionIssue,
} from "./payrollEduClockCorrectionResolution";
import {
  EDUCLOCK_PAYROLL_CALC_VERSION,
  buildPreviewCanonicalPayload,
  computePayrollPeriodBounds,
  pairEffectiveEventsForEmployee,
  type ComputedPair,
  type PairingWarningCode,
  type PeriodBounds,
} from "./payrollEduClockPairing";
import { assertPayrollRunMutable, lockPayrollRunForUpdate, PayrollLockError } from "./payrollRunLockService";
import { writePayrollAudit } from "./payrollAuditLog";

export { EDUCLOCK_PAYROLL_CALC_VERSION };

export class PayrollEduClockImportError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(code: string, status: number, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function sha256Hex(payload: unknown): string {
  return crypto.createHash("sha256").update(stableStringify(payload)).digest("hex");
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) out[k] = sortKeys(obj[k]);
    return out;
  }
  return value;
}

export function buildConfirmationKey(input: {
  schoolId: string;
  payrollRunId: string;
  previewHash: string;
  sourceCalculationVersion: string;
}): string {
  return sha256Hex(
    [
      input.schoolId,
      input.payrollRunId,
      input.previewHash,
      input.sourceCalculationVersion,
      "CONFIRM",
    ].join("|")
  );
}

export function buildRecalculationKey(input: {
  schoolId: string;
  payrollRunId: string;
  previousConfirmedImportId: string;
  previewHash: string;
  sourceCalculationVersion: string;
}): string {
  return sha256Hex(
    [
      input.schoolId,
      input.payrollRunId,
      input.previousConfirmedImportId,
      input.previewHash,
      input.sourceCalculationVersion,
      "RECALCULATE",
    ].join("|")
  );
}

function employeeDisplayName(emp: Pick<Employee, "fullName" | "firstName" | "lastName">): string {
  const full = String(emp.fullName || "").trim();
  if (full) return full;
  return `${emp.firstName || ""} ${emp.lastName || ""}`.trim() || emp.firstName;
}

export type PreviewLine = {
  employeeId: string;
  employeeNumberSnapshot: string | null;
  employeeNameSnapshot: string;
  workedMinutes: number;
  ordinaryMinutes: null;
  overtimeMinutes: null;
  status: "READY" | "WARNING" | "BLOCKED";
  warningCodes: string[];
  warningDetails: unknown;
  sourcePairCount: number;
  existingManualOvertimeHoursSnapshot: number | null;
  pairs: Array<{
    pairKey: string;
    clockInEventId: string;
    clockOutEventId: string;
    clockInUtc: string;
    clockOutUtc: string;
    intervalStartUtc: string;
    intervalEndUtc: string;
    includedMinutes: number;
    crossesPeriodStart: boolean;
    crossesPeriodEnd: boolean;
    clockInCorrectionMeta: unknown;
    clockOutCorrectionMeta: unknown;
  }>;
};

export type PreviewResult = {
  payrollRunId: string | null;
  confirmable: boolean;
  payrollMonth: number;
  payrollYear: number;
  periodStartUtc: string;
  periodEndUtc: string;
  schoolTimezone: string;
  previewHash: string;
  calculationVersion: string;
  schoolId: string;
  totalEmployees: number;
  totalWorkedMinutes: number;
  totalWarningCount: number;
  lines: PreviewLine[];
  preflight: {
    codes: string[];
    details: unknown[];
    correctionIssues: CorrectionResolutionIssue[];
  };
  configGaps: string[];
};

async function loadSchoolTimezone(_schoolId: string): Promise<string> {
  return DEFAULT_SCHOOL_TIMEZONE;
}

function escalateStatus(
  codes: string[]
): "READY" | "WARNING" | "BLOCKED" {
  const blocked = new Set([
    "CORRECTION_CYCLE",
    "CORRECTION_CROSS_EMPLOYEE",
    "CORRECTION_CROSS_SCHOOL",
    "CORRECTION_INCOMPATIBLE_TYPE",
    "CORRECTION_AMBIGUOUS_TERMINAL",
    "CORRECTION_MISSING_ANCESTOR",
    "CORRECTION_ACTOR_UNPROVEN",
    "CORRECTION_BLOCKED",
    "INVALID_EVENT_SEQUENCE",
  ]);
  if (codes.some((c) => blocked.has(c))) return "BLOCKED";
  if (codes.length > 0) return "WARNING";
  return "READY";
}

export async function previewEduClockImport(input: {
  schoolId: string;
  payrollMonth?: number;
  payrollYear?: number;
  payrollRunId?: string | null;
}): Promise<PreviewResult> {
  const schoolId = String(input.schoolId || "").trim();
  if (!schoolId) {
    throw new PayrollEduClockImportError("SCHOOL_REQUIRED", 400, "schoolId required");
  }

  let payrollRunId: string | null = input.payrollRunId ? String(input.payrollRunId).trim() : null;
  let month = input.payrollMonth;
  let year = input.payrollYear;
  let run: PayrollRun | null = null;

  if (payrollRunId) {
    run = await prisma.payrollRun.findFirst({
      where: { id: payrollRunId, schoolId },
    });
    if (!run) {
      throw new PayrollEduClockImportError("PAYROLL_RUN_NOT_FOUND", 404, "Payroll run not found for this school");
    }
    month = run.payrollMonth;
    year = run.payrollYear;
  }

  if (!Number.isInteger(month) || !Number.isInteger(year)) {
    throw new PayrollEduClockImportError("PERIOD_REQUIRED", 400, "payrollMonth and payrollYear are required");
  }

  const schoolTimezone = await loadSchoolTimezone(schoolId);
  const period = computePayrollPeriodBounds(year!, month!, schoolTimezone);

  // Expand load window slightly so overnight shifts crossing boundaries are available
  const loadStart = new Date(period.periodStartUtc.getTime() - 48 * 3600 * 1000);
  const loadEnd = new Date(period.periodEndUtc.getTime() + 48 * 3600 * 1000);

  const employees = await prisma.employee.findMany({
    where: { schoolId },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }],
  });

  const events = await prisma.eduClockEvent.findMany({
    where: {
      schoolId,
      occurredAtUtc: { gte: loadStart, lt: loadEnd },
    },
  });

  // Also load correction ancestors/descendants referenced but outside window
  const relatedIds = new Set<string>();
  for (const e of events) {
    if (e.correctedFromEventId) relatedIds.add(e.correctedFromEventId);
  }
  if (relatedIds.size) {
    const extra = await prisma.eduClockEvent.findMany({
      where: { schoolId, id: { in: [...relatedIds] } },
    });
    const have = new Set(events.map((e) => e.id));
    for (const e of extra) if (!have.has(e.id)) events.push(e);
  }

  const resolution = resolveEffectiveClockEvents(events, schoolId);

  // Preflight: duplicate employee numbers
  const numberMap = new Map<string, string[]>();
  for (const emp of employees) {
    const n = String(emp.employeeNumber || "").trim();
    if (!n) continue;
    const list = numberMap.get(n) || [];
    list.push(emp.id);
    numberMap.set(n, list);
  }
  const duplicateNumbers = new Set(
    [...numberMap.entries()].filter(([, ids]) => ids.length > 1).flatMap(([, ids]) => ids)
  );

  const preflightCodes: string[] = ["OVERTIME_RULES_NOT_CONFIGURED"];
  const preflightDetails: unknown[] = [
    { code: "OVERTIME_RULES_NOT_CONFIGURED", detail: "No overtime thresholds configured; overtimeMinutes left null" },
  ];
  for (const issue of resolution.issues) {
    preflightCodes.push(issue.code);
    preflightDetails.push(issue);
  }

  // Events for unknown employees
  const empIds = new Set(employees.map((e) => e.id));
  for (const e of events) {
    if (!empIds.has(e.employeeId)) {
      preflightCodes.push("ORPHAN_EVENT_EMPLOYEE");
      preflightDetails.push({ code: "ORPHAN_EVENT_EMPLOYEE", eventId: e.id, employeeId: e.employeeId });
    }
    if (e.schoolId !== schoolId) {
      preflightCodes.push("EVENT_WRONG_SCHOOL");
      preflightDetails.push({ code: "EVENT_WRONG_SCHOOL", eventId: e.id });
    }
  }

  const lines: PreviewLine[] = [];
  const hashPairs: Parameters<typeof buildPreviewCanonicalPayload>[0]["pairs"] = [];
  const hashLines: Parameters<typeof buildPreviewCanonicalPayload>[0]["lines"] = [];

  const employeesWithEffective = new Set(resolution.effectiveByEmployee.keys());
  const employeesToProcess = new Map<string, Employee>();
  for (const emp of employees) employeesToProcess.set(emp.id, emp);
  for (const id of employeesWithEffective) {
    if (!employeesToProcess.has(id)) {
      // orphan — skip payable but already preflighted
    }
  }

  for (const emp of employees) {
    const effective = resolution.effectiveByEmployee.get(emp.id) || [];
    const pairing = pairEffectiveEventsForEmployee(emp.id, effective, period);
    const codes = new Set<string>(pairing.warnings.map((w) => w.code));

    // Attach correction issues for this employee
    for (const issue of resolution.issues) {
      const ev = events.find((e) => e.id === issue.eventId);
      if (ev?.employeeId === emp.id || issue.eventId === emp.id) {
        codes.add(issue.code);
        codes.add("CORRECTION_BLOCKED");
      }
    }

    codes.add("OVERTIME_RULES_NOT_CONFIGURED");
    if (!String(emp.employeeNumber || "").trim()) codes.add("MISSING_EMPLOYEE_NUMBER");
    if (duplicateNumbers.has(emp.id)) codes.add("DUPLICATE_EMPLOYEE_NUMBER");
    if (!emp.isActive && (pairing.pairs.length > 0 || effective.length > 0)) codes.add("INACTIVE_EMPLOYEE");
    if (!emp.userId) codes.add("NO_LINKED_USER");

    // Skip employees with no events and no warnings of interest? Include those with any effective/activity or always list with events only
    if (effective.length === 0 && pairing.pairs.length === 0 && pairing.warnings.length === 0) {
      continue;
    }

    const status = escalateStatus([...codes]);
    const warningCodes = [...codes].sort();
    const line: PreviewLine = {
      employeeId: emp.id,
      employeeNumberSnapshot: String(emp.employeeNumber || "").trim() || null,
      employeeNameSnapshot: employeeDisplayName(emp),
      workedMinutes: pairing.workedMinutes,
      ordinaryMinutes: null,
      overtimeMinutes: null,
      status,
      warningCodes,
      warningDetails: {
        pairingWarnings: pairing.warnings,
        manualOvertimeHours: Number(emp.overtimeHours || 0),
        note: "Verified worked hours only; contractual ordinary hours not classified",
      },
      sourcePairCount: pairing.pairs.length,
      existingManualOvertimeHoursSnapshot: Number(emp.overtimeHours || 0),
      pairs: pairing.pairs.map((p) => serializePair(p)),
    };
    lines.push(line);

    for (const p of pairing.pairs) {
      hashPairs.push({
        pairKey: p.pairKey,
        employeeId: p.employeeId,
        clockInEventId: p.clockIn.effective.id,
        clockOutEventId: p.clockOut.effective.id,
        intervalStartUtc: p.intervalStartUtc.toISOString(),
        intervalEndUtc: p.intervalEndUtc.toISOString(),
        includedMinutes: p.includedMinutes,
      });
    }
    hashLines.push({
      employeeId: emp.id,
      workedMinutes: pairing.workedMinutes,
      status,
      warningCodes,
      sourcePairCount: pairing.pairs.length,
    });
  }

  lines.sort((a, b) => a.employeeId.localeCompare(b.employeeId));

  const totalWorkedMinutes = lines.reduce((s, l) => s + l.workedMinutes, 0);
  const totalWarningCount = lines.reduce(
    (s, l) => s + (l.status === "READY" ? 0 : 1),
    0
  );

  // Reconcile pair→line
  for (const line of lines) {
    const sum = line.pairs.reduce((s, p) => s + p.includedMinutes, 0);
    if (sum !== line.workedMinutes) {
      throw new PayrollEduClockImportError(
        "RECONCILE_FAILED",
        500,
        `Line ${line.employeeId} workedMinutes ${line.workedMinutes} != pair sum ${sum}`
      );
    }
  }

  const canonical = buildPreviewCanonicalPayload({
    sourceCalculationVersion: EDUCLOCK_PAYROLL_CALC_VERSION,
    schoolId,
    payrollMonth: month!,
    payrollYear: year!,
    schoolTimezone: period.schoolTimezone,
    periodStartUtc: period.periodStartUtc.toISOString(),
    periodEndUtc: period.periodEndUtc.toISOString(),
    payrollRunId,
    pairs: hashPairs,
    lines: hashLines,
    preflightCodes: [...new Set(preflightCodes)],
  });

  const previewHash = sha256Hex(canonical);
  const confirmable = Boolean(payrollRunId);

  return {
    payrollRunId,
    confirmable,
    payrollMonth: month!,
    payrollYear: year!,
    periodStartUtc: period.periodStartUtc.toISOString(),
    periodEndUtc: period.periodEndUtc.toISOString(),
    schoolTimezone: period.schoolTimezone,
    previewHash,
    calculationVersion: EDUCLOCK_PAYROLL_CALC_VERSION,
    schoolId,
    totalEmployees: lines.length,
    totalWorkedMinutes,
    totalWarningCount,
    lines,
    preflight: {
      codes: [...new Set(preflightCodes)].sort(),
      details: preflightDetails,
      correctionIssues: resolution.issues,
    },
    configGaps: ["OVERTIME_RULES_NOT_CONFIGURED", "ORDINARY_HOURS_RULES_NOT_CONFIGURED"],
  };
}

function serializePair(p: ComputedPair) {
  return {
    pairKey: p.pairKey,
    clockInEventId: p.clockIn.effective.id,
    clockOutEventId: p.clockOut.effective.id,
    clockInUtc: p.clockInUtc.toISOString(),
    clockOutUtc: p.clockOutUtc.toISOString(),
    intervalStartUtc: p.intervalStartUtc.toISOString(),
    intervalEndUtc: p.intervalEndUtc.toISOString(),
    includedMinutes: p.includedMinutes,
    crossesPeriodStart: p.crossesPeriodStart,
    crossesPeriodEnd: p.crossesPeriodEnd,
    clockInCorrectionMeta: p.clockIn.correctionMeta,
    clockOutCorrectionMeta: p.clockOut.correctionMeta,
  };
}

async function persistImportFromPreview(
  tx: Prisma.TransactionClient,
  input: {
    preview: PreviewResult;
    schoolId: string;
    payrollRunId: string;
    actorUserId: string;
    confirmationKey: string;
    supersedesImportId?: string | null;
    recalculateReason?: string | null;
    status?: "CONFIRMED";
  }
): Promise<PayrollEduClockImport> {
  const preview = input.preview;
  if (!preview.confirmable || preview.payrollRunId !== input.payrollRunId) {
    throw new PayrollEduClockImportError("PREVIEW_NOT_CONFIRMABLE", 400, "Preview is not confirmable for this run");
  }

  const imp = await tx.payrollEduClockImport.create({
    data: {
      schoolId: input.schoolId,
      payrollRunId: input.payrollRunId,
      payrollMonth: preview.payrollMonth,
      payrollYear: preview.payrollYear,
      periodStartUtc: new Date(preview.periodStartUtc),
      periodEndUtc: new Date(preview.periodEndUtc),
      schoolTimezone: preview.schoolTimezone,
      status: "CONFIRMED",
      importedByUserId: input.actorUserId,
      confirmedAt: new Date(),
      sourceCalculationVersion: preview.calculationVersion,
      previewHash: preview.previewHash,
      confirmationKey: input.confirmationKey,
      totalEmployees: preview.totalEmployees,
      totalWorkedMinutes: preview.totalWorkedMinutes,
      totalWarningCount: preview.totalWarningCount,
      supersedesImportId: input.supersedesImportId || null,
      recalculateReason: input.recalculateReason || null,
    },
  });

  for (const line of preview.lines) {
    const createdLine = await tx.payrollEduClockImportLine.create({
      data: {
        importId: imp.id,
        employeeId: line.employeeId,
        employeeNumberSnapshot: line.employeeNumberSnapshot,
        employeeNameSnapshot: line.employeeNameSnapshot,
        workedMinutes: line.workedMinutes,
        ordinaryMinutes: null,
        overtimeMinutes: null,
        status: line.status,
        warningCodes: line.warningCodes,
        warningDetails: line.warningDetails as object,
        sourcePairCount: line.sourcePairCount,
        existingManualOvertimeHoursSnapshot: line.existingManualOvertimeHoursSnapshot,
      },
    });

    for (const pair of line.pairs) {
      const createdPair = await tx.payrollEduClockImportPair.create({
        data: {
          importId: imp.id,
          importLineId: createdLine.id,
          employeeId: line.employeeId,
          pairKey: pair.pairKey,
          clockInEventId: pair.clockInEventId,
          clockOutEventId: pair.clockOutEventId,
          clockInUtc: new Date(pair.clockInUtc),
          clockOutUtc: new Date(pair.clockOutUtc),
          intervalStartUtc: new Date(pair.intervalStartUtc),
          intervalEndUtc: new Date(pair.intervalEndUtc),
          includedMinutes: pair.includedMinutes,
          crossesPeriodStart: pair.crossesPeriodStart,
          crossesPeriodEnd: pair.crossesPeriodEnd,
        },
      });

      await tx.payrollEduClockImportEvent.create({
        data: {
          importId: imp.id,
          importLineId: createdLine.id,
          importPairId: createdPair.id,
          employeeId: line.employeeId,
          eduClockEventId: pair.clockInEventId,
          effectiveEventId: pair.clockInEventId,
          eventType: "CLOCK_IN",
          occurredAtUtc: new Date(pair.clockInUtc),
          sourceRole: "CLOCK_IN",
          correctionMeta: (pair.clockInCorrectionMeta as object) || undefined,
        },
      });
      await tx.payrollEduClockImportEvent.create({
        data: {
          importId: imp.id,
          importLineId: createdLine.id,
          importPairId: createdPair.id,
          employeeId: line.employeeId,
          eduClockEventId: pair.clockOutEventId,
          effectiveEventId: pair.clockOutEventId,
          eventType: "CLOCK_OUT",
          occurredAtUtc: new Date(pair.clockOutUtc),
          sourceRole: "CLOCK_OUT",
          correctionMeta: (pair.clockOutCorrectionMeta as object) || undefined,
        },
      });
    }

    // Link PayrollRunEmployee additive fields only — never fabricate monetary snapshot
    const pre = await tx.payrollRunEmployee.findFirst({
      where: { payrollRunId: input.payrollRunId, employeeId: line.employeeId },
    });
    if (pre) {
      // Verify run school via parent (already locked)
      await tx.payrollRunEmployee.update({
        where: { id: pre.id },
        data: {
          eduClockImportLineId: createdLine.id,
          verifiedWorkedMinutes: line.workedMinutes,
          importedOvertimeMinutes: null,
          timeImportStatus: line.status,
        },
      });
    } else {
      // Do not create zero-value PRE — mark warning on line
      const codes = Array.from(new Set([...line.warningCodes, "PAYROLL_RUN_EMPLOYEE_MISSING"]));
      const status = escalateStatus(codes);
      await tx.payrollEduClockImportLine.update({
        where: { id: createdLine.id },
        data: {
          warningCodes: codes,
          status,
          warningDetails: {
            ...(typeof line.warningDetails === "object" && line.warningDetails
              ? (line.warningDetails as object)
              : {}),
            payrollRunEmployeeMissing: true,
          },
        },
      });
    }
  }

  // Reconcile persisted totals
  const persistedLines = await tx.payrollEduClockImportLine.findMany({ where: { importId: imp.id } });
  const persistedPairs = await tx.payrollEduClockImportPair.findMany({ where: { importId: imp.id } });
  const lineSum = persistedLines.reduce((s, l) => s + l.workedMinutes, 0);
  const pairSum = persistedPairs.reduce((s, p) => s + p.includedMinutes, 0);
  if (lineSum !== pairSum || lineSum !== imp.totalWorkedMinutes) {
    // Allow totalWorkedMinutes mismatch only if lines were escalated? Prefer fix import totals from pairs
    await tx.payrollEduClockImport.update({
      where: { id: imp.id },
      data: {
        totalWorkedMinutes: pairSum,
        totalEmployees: persistedLines.length,
        totalWarningCount: persistedLines.filter((l) => l.status !== "READY").length,
      },
    });
  }

  return tx.payrollEduClockImport.findUniqueOrThrow({ where: { id: imp.id } });
}

export async function confirmEduClockImport(input: {
  schoolId: string;
  payrollRunId: string;
  previewHash: string;
  actorUserId: string;
}): Promise<{ import: PayrollEduClockImport; idempotent: boolean }> {
  const schoolId = String(input.schoolId).trim();
  const payrollRunId = String(input.payrollRunId).trim();
  const previewHash = String(input.previewHash).trim();
  if (!schoolId || !payrollRunId || !previewHash) {
    throw new PayrollEduClockImportError("CONFIRM_INPUT_INVALID", 400, "schoolId, payrollRunId and previewHash are required");
  }

  const confirmationKey = buildConfirmationKey({
    schoolId,
    payrollRunId,
    previewHash,
    sourceCalculationVersion: EDUCLOCK_PAYROLL_CALC_VERSION,
  });

  // Fast idempotent path
  const existingByKey = await prisma.payrollEduClockImport.findUnique({
    where: { confirmationKey },
  });
  if (existingByKey && existingByKey.schoolId === schoolId && existingByKey.payrollRunId === payrollRunId) {
    return { import: existingByKey, idempotent: true };
  }

  try {
    const created = await prisma.$transaction(
      async (tx) => {
        const run = await lockPayrollRunForUpdate(tx, payrollRunId, schoolId);
        assertPayrollRunMutable(run);

        const again = await tx.payrollEduClockImport.findUnique({ where: { confirmationKey } });
        if (again) return { import: again, idempotent: true as const };

        const confirmed = await tx.payrollEduClockImport.findFirst({
          where: { payrollRunId, status: "CONFIRMED" },
        });
        if (confirmed) {
          throw new PayrollEduClockImportError(
            "IMPORT_ALREADY_CONFIRMED",
            409,
            "This payroll run already has a confirmed EduClock import; use recalculate",
            { existingImportId: confirmed.id }
          );
        }

        const preview = await previewEduClockImport({
          schoolId,
          payrollRunId,
        });
        if (!preview.confirmable || preview.payrollRunId !== payrollRunId) {
          throw new PayrollEduClockImportError("PREVIEW_NOT_CONFIRMABLE", 400, "Run-bound preview required");
        }
        if (preview.schoolId !== schoolId) {
          throw new PayrollEduClockImportError("SCHOOL_MISMATCH", 403, "Preview school mismatch");
        }
        if (preview.payrollMonth !== run.payrollMonth || preview.payrollYear !== run.payrollYear) {
          throw new PayrollEduClockImportError("PERIOD_MISMATCH", 409, "Preview period does not match payroll run");
        }
        if (preview.previewHash !== previewHash) {
          throw new PayrollEduClockImportError("STALE_PREVIEW", 409, "Preview hash is stale; request a fresh run-bound preview");
        }

        const imp = await persistImportFromPreview(tx, {
          preview,
          schoolId,
          payrollRunId,
          actorUserId: input.actorUserId,
          confirmationKey,
        });

        await writePayrollAudit(tx, {
          schoolId,
          payrollRunId,
          importId: imp.id,
          action: "EDUCLOCK_IMPORT_CONFIRMED",
          actorUserId: input.actorUserId,
          previousState: { status: null },
          newState: {
            importId: imp.id,
            previewHash: imp.previewHash,
            totalWorkedMinutes: imp.totalWorkedMinutes,
          },
        });

        return { import: imp, idempotent: false as const };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
    return created;
  } catch (err: any) {
    // Concurrent identical confirm — unique violation on confirmationKey or partial unique
    if (err?.code === "P2002" || String(err?.message || "").includes("PayrollEduClockImport_payrollRunId_confirmed")) {
      const again = await prisma.payrollEduClockImport.findUnique({ where: { confirmationKey } });
      if (again) return { import: again, idempotent: true };
      const confirmed = await prisma.payrollEduClockImport.findFirst({
        where: { payrollRunId, status: "CONFIRMED" },
      });
      if (confirmed && confirmed.previewHash === previewHash) {
        return { import: confirmed, idempotent: true };
      }
      throw new PayrollEduClockImportError(
        "IMPORT_ALREADY_CONFIRMED",
        409,
        "This payroll run already has a confirmed EduClock import; use recalculate"
      );
    }
    if (err instanceof PayrollEduClockImportError || err instanceof PayrollLockError) throw err;
    throw err;
  }
}

export async function recalculateEduClockImport(input: {
  schoolId: string;
  payrollRunId: string;
  previousConfirmedImportId: string;
  previewHash: string;
  actorUserId: string;
  reason: string;
}): Promise<
  | { outcome: "NO_CHANGES"; import: PayrollEduClockImport }
  | { outcome: "RECALCULATED"; import: PayrollEduClockImport; supersededImportId: string; idempotent: boolean }
> {
  const schoolId = String(input.schoolId).trim();
  const payrollRunId = String(input.payrollRunId).trim();
  const previousConfirmedImportId = String(input.previousConfirmedImportId).trim();
  const previewHash = String(input.previewHash).trim();
  const reason = String(input.reason || "").trim();
  if (!reason) {
    throw new PayrollEduClockImportError("RECALC_REASON_REQUIRED", 400, "A non-empty reason is required");
  }
  if (!schoolId || !payrollRunId || !previousConfirmedImportId || !previewHash) {
    throw new PayrollEduClockImportError("RECALC_INPUT_INVALID", 400, "Missing required recalculation fields");
  }

  const confirmationKey = buildRecalculationKey({
    schoolId,
    payrollRunId,
    previousConfirmedImportId,
    previewHash,
    sourceCalculationVersion: EDUCLOCK_PAYROLL_CALC_VERSION,
  });

  const existingByKey = await prisma.payrollEduClockImport.findUnique({
    where: { confirmationKey },
  });
  if (existingByKey) {
    return {
      outcome: "RECALCULATED",
      import: existingByKey,
      supersededImportId: previousConfirmedImportId,
      idempotent: true,
    };
  }

  try {
    return await prisma.$transaction(
      async (tx) => {
        const run = await lockPayrollRunForUpdate(tx, payrollRunId, schoolId);
        assertPayrollRunMutable(run);

        const again = await tx.payrollEduClockImport.findUnique({ where: { confirmationKey } });
        if (again) {
          return {
            outcome: "RECALCULATED" as const,
            import: again,
            supersededImportId: previousConfirmedImportId,
            idempotent: true,
          };
        }

        const current = await tx.payrollEduClockImport.findFirst({
          where: { payrollRunId, status: "CONFIRMED" },
        });
        if (!current) {
          throw new PayrollEduClockImportError("NO_CONFIRMED_IMPORT", 404, "No confirmed import to recalculate");
        }
        if (current.id !== previousConfirmedImportId) {
          throw new PayrollEduClockImportError(
            "OUTDATED_IMPORT_ID",
            409,
            "previousConfirmedImportId is outdated",
            { currentImportId: current.id }
          );
        }

        // Lock current import row
        await tx.$queryRaw`
          SELECT id FROM "PayrollEduClockImport" WHERE id = ${current.id} FOR UPDATE
        `;

        const preview = await previewEduClockImport({ schoolId, payrollRunId });
        if (!preview.confirmable || preview.payrollRunId !== payrollRunId) {
          throw new PayrollEduClockImportError("PREVIEW_NOT_CONFIRMABLE", 400, "Run-bound preview required");
        }
        if (preview.previewHash !== previewHash) {
          throw new PayrollEduClockImportError("STALE_PREVIEW", 409, "Preview hash is stale; request a fresh run-bound preview");
        }

        if (preview.previewHash === current.previewHash) {
          return { outcome: "NO_CHANGES" as const, import: current };
        }

        await tx.payrollEduClockImport.update({
          where: { id: current.id },
          data: { status: "SUPERSEDED" },
        });

        // Clear prior additive links before attaching new ones
        await tx.payrollRunEmployee.updateMany({
          where: { payrollRunId, eduClockImportLineId: { not: null } },
          data: {
            eduClockImportLineId: null,
            verifiedWorkedMinutes: null,
            importedOvertimeMinutes: null,
            timeImportStatus: null,
          },
        });

        const imp = await persistImportFromPreview(tx, {
          preview,
          schoolId,
          payrollRunId,
          actorUserId: input.actorUserId,
          confirmationKey,
          supersedesImportId: current.id,
          recalculateReason: reason,
        });

        await writePayrollAudit(tx, {
          schoolId,
          payrollRunId,
          importId: current.id,
          action: "EDUCLOCK_IMPORT_SUPERSEDED",
          actorUserId: input.actorUserId,
          reason,
          previousState: { status: "CONFIRMED", importId: current.id },
          newState: { status: "SUPERSEDED", replacedBy: imp.id },
        });
        await writePayrollAudit(tx, {
          schoolId,
          payrollRunId,
          importId: imp.id,
          action: "EDUCLOCK_IMPORT_RECALCULATED",
          actorUserId: input.actorUserId,
          reason,
          previousState: { importId: current.id, previewHash: current.previewHash },
          newState: { importId: imp.id, previewHash: imp.previewHash },
        });

        return {
          outcome: "RECALCULATED" as const,
          import: imp,
          supersededImportId: current.id,
          idempotent: false,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  } catch (err: any) {
    if (err?.code === "P2002") {
      const again = await prisma.payrollEduClockImport.findUnique({ where: { confirmationKey } });
      if (again) {
        return {
          outcome: "RECALCULATED",
          import: again,
          supersededImportId: previousConfirmedImportId,
          idempotent: true,
        };
      }
    }
    if (err instanceof PayrollEduClockImportError || err instanceof PayrollLockError) throw err;
    throw err;
  }
}

export async function getCurrentEduClockImport(input: {
  schoolId: string;
  payrollRunId?: string;
  payrollMonth?: number;
  payrollYear?: number;
}) {
  if (input.payrollRunId) {
    return prisma.payrollEduClockImport.findFirst({
      where: {
        schoolId: input.schoolId,
        payrollRunId: input.payrollRunId,
        status: "CONFIRMED",
      },
      include: {
        lines: { include: { pairs: true, events: true } },
      },
    });
  }
  if (input.payrollMonth && input.payrollYear) {
    return prisma.payrollEduClockImport.findFirst({
      where: {
        schoolId: input.schoolId,
        payrollMonth: input.payrollMonth,
        payrollYear: input.payrollYear,
        status: "CONFIRMED",
      },
      orderBy: { confirmedAt: "desc" },
      include: {
        lines: { include: { pairs: true, events: true } },
      },
    });
  }
  throw new PayrollEduClockImportError("LOOKUP_INPUT_INVALID", 400, "payrollRunId or month/year required");
}
