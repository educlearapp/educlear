/**
 * Concurrency-safe APP-{intakeYear}-{NNNNNN} allocation via AdmissionApplicationCounter.
 * Preserves OA-03B format; uses atomic INSERT…ON CONFLICT for concurrent safety.
 */
import type { Prisma } from "@prisma/client";

export function formatApplicationNumber(intakeYear: number, sequence: number): string {
  const year = Number(intakeYear);
  const seq = Number(sequence);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new Error("Invalid intakeYear for application number");
  }
  if (!Number.isInteger(seq) || seq < 1) {
    throw new Error("Invalid sequence for application number");
  }
  return `APP-${year}-${String(seq).padStart(6, "0")}`;
}

export function parseApplicationNumber(
  value: string
): { intakeYear: number; sequence: number } | null {
  const m = /^APP-(\d{4})-(\d{6})$/.exec(String(value || "").trim());
  if (!m) return null;
  return { intakeYear: Number(m[1]), sequence: Number(m[2]) };
}

type Tx = Prisma.TransactionClient;

/**
 * Atomically allocates the next application number for (schoolId, intakeYear).
 * Must be called inside a Prisma interactive transaction.
 *
 * Counter.nextValue = next free sequence. After allocation, nextValue is incremented.
 */
export async function allocateApplicationNumber(
  tx: Tx,
  schoolId: string,
  intakeYear: number
): Promise<string> {
  const sid = String(schoolId || "").trim();
  const year = Number(intakeYear);
  if (!sid) throw new Error("schoolId required");
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new Error("intakeYear required");
  }

  // Atomic upsert: insert starts at nextValue=2 (issued 1); conflict increments.
  const rows = await tx.$queryRaw<Array<{ nextValue: number }>>`
    INSERT INTO "AdmissionApplicationCounter" ("schoolId", "intakeYear", "nextValue", "createdAt", "updatedAt")
    VALUES (${sid}, ${year}, 2, NOW(), NOW())
    ON CONFLICT ("schoolId", "intakeYear")
    DO UPDATE SET
      "nextValue" = "AdmissionApplicationCounter"."nextValue" + 1,
      "updatedAt" = NOW()
    RETURNING "nextValue"
  `;

  const nextValue = Number(rows[0]?.nextValue);
  if (!Number.isInteger(nextValue) || nextValue < 2) {
    throw new Error("Failed to allocate application number");
  }
  const allocated = nextValue - 1;
  return formatApplicationNumber(year, allocated);
}

/**
 * Issue a number once onto an application row. If already set, returns existing (idempotent).
 */
export async function ensureApplicationNumber(
  tx: Tx,
  application: { id: string; schoolId: string; intakeYear: number; applicationNumber: string | null }
): Promise<string> {
  if (application.applicationNumber) {
    return application.applicationNumber;
  }
  const number = await allocateApplicationNumber(tx, application.schoolId, application.intakeYear);
  await tx.admissionApplication.update({
    where: { id: application.id },
    data: { applicationNumber: number },
  });
  return number;
}
