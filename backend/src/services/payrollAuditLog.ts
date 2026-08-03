import type { PayrollAuditAction, Prisma } from "@prisma/client";

export async function writePayrollAudit(
  tx: Prisma.TransactionClient,
  input: {
    schoolId: string;
    payrollRunId: string;
    importId?: string | null;
    action: PayrollAuditAction;
    actorUserId: string;
    reason?: string | null;
    previousState?: unknown;
    newState?: unknown;
  }
) {
  await tx.payrollAuditLog.create({
    data: {
      schoolId: input.schoolId,
      payrollRunId: input.payrollRunId,
      importId: input.importId || null,
      action: input.action,
      actorUserId: input.actorUserId,
      reason: input.reason || null,
      previousState: input.previousState === undefined ? undefined : (input.previousState as object),
      newState: input.newState === undefined ? undefined : (input.newState as object),
    },
  });
}
