/**
 * Payroll run lock / finalize / reopen — backend-authoritative FINALIZED guard.
 */
import { PayrollRunStatus, type PayrollRun, type Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { writePayrollAudit } from "./payrollAuditLog";

export class PayrollLockError extends Error {
  status: number;
  code: string;
  constructor(code: string, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export async function lockPayrollRunForUpdate(
  tx: Prisma.TransactionClient,
  payrollRunId: string,
  schoolId: string
): Promise<PayrollRun> {
  const rows = await tx.$queryRaw<PayrollRun[]>`
    SELECT * FROM "PayrollRun"
    WHERE id = ${payrollRunId} AND "schoolId" = ${schoolId}
    FOR UPDATE
  `;
  const run = rows[0];
  if (!run) {
    throw new PayrollLockError("PAYROLL_RUN_NOT_FOUND", 404, "Payroll run not found for this school");
  }
  return run;
}

export function assertPayrollRunMutable(run: Pick<PayrollRun, "status" | "id">): void {
  if (run.status === PayrollRunStatus.FINALIZED) {
    throw new PayrollLockError(
      "PAYROLL_RUN_FINALIZED",
      409,
      "This payroll run is finalized and cannot be changed"
    );
  }
}

export async function finalizePayrollRun(input: {
  schoolId: string;
  payrollRunId: string;
  actorUserId: string;
  note?: string | null;
}): Promise<PayrollRun> {
  return prisma.$transaction(async (tx) => {
    const run = await lockPayrollRunForUpdate(tx, input.payrollRunId, input.schoolId);
    if (run.status === PayrollRunStatus.FINALIZED) {
      throw new PayrollLockError("PAYROLL_RUN_FINALIZED", 409, "Payroll run is already finalized");
    }
    if (run.status === PayrollRunStatus.CANCELLED) {
      throw new PayrollLockError("PAYROLL_RUN_CANCELLED", 409, "Cancelled payroll runs cannot be finalized");
    }

    // Block finalize when confirmed import has BLOCKED lines, or worked time without PRE link.
    const confirmed = await tx.payrollEduClockImport.findFirst({
      where: { payrollRunId: run.id, status: "CONFIRMED" },
      include: { lines: true },
    });
    if (confirmed) {
      const blocked = confirmed.lines.filter((l) => l.status === "BLOCKED");
      if (blocked.length > 0) {
        throw new PayrollLockError(
          "PAYROLL_IMPORT_BLOCKED_LINES",
          409,
          `Cannot finalize: ${blocked.length} blocked EduClock import line(s) remain`
        );
      }
      const linesNeedingLink = confirmed.lines.filter((l) => l.workedMinutes > 0);
      for (const line of linesNeedingLink) {
        const preRow = await tx.payrollRunEmployee.findFirst({
          where: {
            payrollRunId: run.id,
            employeeId: line.employeeId,
            eduClockImportLineId: line.id,
          },
        });
        if (!preRow) {
          throw new PayrollLockError(
            "PAYROLL_IMPORT_UNLINKED",
            409,
            `Cannot finalize: employee ${line.employeeId} import line is not safely linked to PayrollRunEmployee`
          );
        }
      }
    }

    const updated = await tx.payrollRun.update({
      where: { id: run.id },
      data: {
        status: PayrollRunStatus.FINALIZED,
        finalizedAt: new Date(),
        notes: input.note != null && String(input.note).trim() ? String(input.note).trim() : run.notes,
      },
    });

    await writePayrollAudit(tx, {
      schoolId: input.schoolId,
      payrollRunId: run.id,
      action: "PAYROLL_RUN_FINALIZED",
      actorUserId: input.actorUserId,
      reason: input.note ? String(input.note).trim() : null,
      previousState: { status: run.status },
      newState: { status: updated.status, finalizedAt: updated.finalizedAt },
    });

    return updated;
  });
}

export async function reopenPayrollRun(input: {
  schoolId: string;
  payrollRunId: string;
  actorUserId: string;
  reason: string;
}): Promise<PayrollRun> {
  const reason = String(input.reason || "").trim();
  if (!reason) {
    throw new PayrollLockError("REOPEN_REASON_REQUIRED", 400, "A non-empty reason is required to reopen");
  }

  return prisma.$transaction(async (tx) => {
    const run = await lockPayrollRunForUpdate(tx, input.payrollRunId, input.schoolId);
    if (run.status !== PayrollRunStatus.FINALIZED) {
      throw new PayrollLockError("PAYROLL_RUN_NOT_FINALIZED", 409, "Only finalized payroll runs can be reopened");
    }

    const updated = await tx.payrollRun.update({
      where: { id: run.id },
      data: {
        status: PayrollRunStatus.DRAFT,
        finalizedAt: null,
      },
    });

    await writePayrollAudit(tx, {
      schoolId: input.schoolId,
      payrollRunId: run.id,
      action: "PAYROLL_RUN_REOPENED",
      actorUserId: input.actorUserId,
      reason,
      previousState: { status: run.status, finalizedAt: run.finalizedAt },
      newState: { status: updated.status },
    });

    return updated;
  });
}
