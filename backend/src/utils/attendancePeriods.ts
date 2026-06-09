import { AttendanceStatus, Prisma } from "@prisma/client";
import { prisma } from "../prisma";

export const ATTENDANCE_PERIODS = [
  "DAILY",
  "PERIOD_1",
  "PERIOD_2",
  "PERIOD_3",
  "PERIOD_4",
  "PERIOD_5",
  "PERIOD_6",
  "PERIOD_7",
  "AFTERCARE",
] as const;

export type AttendancePeriod = (typeof ATTENDANCE_PERIODS)[number];

const PERIOD_LABELS: Record<AttendancePeriod, string> = {
  DAILY: "Daily",
  PERIOD_1: "Period 1",
  PERIOD_2: "Period 2",
  PERIOD_3: "Period 3",
  PERIOD_4: "Period 4",
  PERIOD_5: "Period 5",
  PERIOD_6: "Period 6",
  PERIOD_7: "Period 7",
  AFTERCARE: "Aftercare",
};

export const STATUS_LABEL: Record<AttendanceStatus, string> = {
  PRESENT: "Present",
  ABSENT: "Absent",
  LATE: "Late",
  EXCUSED: "Excused",
};

const STATUS_VALUE: Record<string, AttendanceStatus> = {
  present: "PRESENT",
  absent: "ABSENT",
  late: "LATE",
  excused: "EXCUSED",
};

export function normalizeAttendancePeriod(input?: unknown): AttendancePeriod | null {
  const raw = String(input ?? "").trim().toUpperCase();
  if (!raw || raw === "DAILY") return "DAILY";
  if ((ATTENDANCE_PERIODS as readonly string[]).includes(raw)) {
    return raw as AttendancePeriod;
  }
  return null;
}

export function periodLabel(period: string): string {
  return PERIOD_LABELS[period as AttendancePeriod] || period;
}

export function statusFromLabel(raw: unknown): AttendanceStatus | null {
  const key = String(raw || "").trim().toLowerCase();
  return STATUS_VALUE[key] || null;
}

export function labelFromStatus(status: AttendanceStatus): string {
  return STATUS_LABEL[status];
}

export function parseDateOnly(raw: string): Date | null {
  const value = String(raw || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

type MarkInput = {
  learnerId?: unknown;
  status?: unknown;
  arrived?: unknown;
  left?: unknown;
  reason?: unknown;
};

export type AttendanceSummary = {
  total: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
  saved: number;
};

export function summarizeAttendanceRows(
  rows: { status: AttendanceStatus }[],
  totalLearners: number
): AttendanceSummary {
  return {
    total: totalLearners,
    present: rows.filter((r) => r.status === "PRESENT").length,
    absent: rows.filter((r) => r.status === "ABSENT").length,
    late: rows.filter((r) => r.status === "LATE").length,
    excused: rows.filter((r) => r.status === "EXCUSED").length,
    saved: rows.length,
  };
}

export async function bulkUpsertAttendance(opts: {
  schoolId: string;
  className: string;
  date: Date;
  period: AttendancePeriod;
  marks: MarkInput[];
  createdBy: string;
  allowedLearnerIds: Set<string>;
  totalLearners: number;
}): Promise<{ saved: number; summary: AttendanceSummary }> {
  const { schoolId, className, date, period, marks, createdBy, allowedLearnerIds, totalLearners } =
    opts;

  const ops: Prisma.PrismaPromise<unknown>[] = [];
  let saved = 0;

  for (const mark of marks) {
    const learnerId = String(mark?.learnerId || "").trim();
    if (!learnerId || !allowedLearnerIds.has(learnerId)) continue;
    const status = statusFromLabel(mark?.status);
    if (!status) continue;

    const data = {
      schoolId,
      learnerId,
      className,
      date,
      period,
      status,
      arrivedAt: mark?.arrived ? String(mark.arrived).trim() || null : null,
      leftAt: mark?.left ? String(mark.left).trim() || null : null,
      reason: mark?.reason ? String(mark.reason).trim() || null : null,
      createdBy,
    };

    ops.push(
      prisma.learnerAttendance.upsert({
        where: {
          schoolId_learnerId_date_period: {
            schoolId,
            learnerId,
            date,
            period,
          },
        },
        create: data,
        update: {
          className,
          status: data.status,
          arrivedAt: data.arrivedAt,
          leftAt: data.leftAt,
          reason: data.reason,
          createdBy: data.createdBy || undefined,
        },
      })
    );
    saved += 1;
  }

  if (!ops.length) {
    throw new Error("NO_VALID_MARKS");
  }

  await prisma.$transaction(ops);

  const rows = await prisma.learnerAttendance.findMany({
    where: {
      schoolId,
      date,
      period,
      learnerId: { in: [...allowedLearnerIds] },
    },
  });

  return {
    saved,
    summary: summarizeAttendanceRows(rows, totalLearners),
  };
}
