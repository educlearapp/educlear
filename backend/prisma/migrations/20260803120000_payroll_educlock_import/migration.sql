-- Additive EduClock → Payroll import snapshot tables (Checkpoint B).
-- Preview is never persisted. Partial unique: one CONFIRMED import per PayrollRun.

CREATE TYPE "PayrollEduClockImportStatus" AS ENUM ('CONFIRMED', 'SUPERSEDED');
CREATE TYPE "PayrollEduClockImportLineStatus" AS ENUM ('READY', 'WARNING', 'BLOCKED');
CREATE TYPE "PayrollEduClockImportEventRole" AS ENUM ('CLOCK_IN', 'CLOCK_OUT');
CREATE TYPE "PayrollAuditAction" AS ENUM (
  'EDUCLOCK_IMPORT_CONFIRMED',
  'EDUCLOCK_IMPORT_RECALCULATED',
  'EDUCLOCK_IMPORT_SUPERSEDED',
  'PAYROLL_RUN_FINALIZED',
  'PAYROLL_RUN_REOPENED'
);

ALTER TABLE "PayrollRunEmployee"
  ADD COLUMN IF NOT EXISTS "eduClockImportLineId" TEXT,
  ADD COLUMN IF NOT EXISTS "verifiedWorkedMinutes" INTEGER,
  ADD COLUMN IF NOT EXISTS "importedOvertimeMinutes" INTEGER,
  ADD COLUMN IF NOT EXISTS "timeImportStatus" TEXT;

CREATE TABLE "PayrollEduClockImport" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "payrollRunId" TEXT NOT NULL,
  "payrollMonth" INTEGER NOT NULL,
  "payrollYear" INTEGER NOT NULL,
  "periodStartUtc" TIMESTAMP(3) NOT NULL,
  "periodEndUtc" TIMESTAMP(3) NOT NULL,
  "schoolTimezone" TEXT NOT NULL DEFAULT 'Africa/Johannesburg',
  "status" "PayrollEduClockImportStatus" NOT NULL,
  "importedByUserId" TEXT NOT NULL,
  "confirmedAt" TIMESTAMP(3) NOT NULL,
  "sourceCalculationVersion" TEXT NOT NULL,
  "previewHash" TEXT NOT NULL,
  "confirmationKey" TEXT NOT NULL,
  "totalEmployees" INTEGER NOT NULL DEFAULT 0,
  "totalWorkedMinutes" INTEGER NOT NULL DEFAULT 0,
  "totalWarningCount" INTEGER NOT NULL DEFAULT 0,
  "supersedesImportId" TEXT,
  "recalculateReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PayrollEduClockImport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PayrollEduClockImport_confirmationKey_key"
  ON "PayrollEduClockImport"("confirmationKey");
CREATE INDEX "PayrollEduClockImport_schoolId_payrollYear_payrollMonth_idx"
  ON "PayrollEduClockImport"("schoolId", "payrollYear", "payrollMonth");
CREATE INDEX "PayrollEduClockImport_payrollRunId_status_idx"
  ON "PayrollEduClockImport"("payrollRunId", "status");
CREATE INDEX "PayrollEduClockImport_supersedesImportId_idx"
  ON "PayrollEduClockImport"("supersedesImportId");

-- Exactly one CONFIRMED import per payroll run.
CREATE UNIQUE INDEX "PayrollEduClockImport_payrollRunId_confirmed_uidx"
  ON "PayrollEduClockImport"("payrollRunId")
  WHERE "status" = 'CONFIRMED';

CREATE TABLE "PayrollEduClockImportLine" (
  "id" TEXT NOT NULL,
  "importId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "employeeNumberSnapshot" TEXT,
  "employeeNameSnapshot" TEXT NOT NULL,
  "workedMinutes" INTEGER NOT NULL DEFAULT 0,
  "ordinaryMinutes" INTEGER,
  "overtimeMinutes" INTEGER,
  "status" "PayrollEduClockImportLineStatus" NOT NULL,
  "warningCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "warningDetails" JSONB,
  "sourcePairCount" INTEGER NOT NULL DEFAULT 0,
  "existingManualOvertimeHoursSnapshot" DECIMAL(12,2),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PayrollEduClockImportLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PayrollEduClockImportLine_importId_employeeId_key"
  ON "PayrollEduClockImportLine"("importId", "employeeId");
CREATE INDEX "PayrollEduClockImportLine_importId_idx"
  ON "PayrollEduClockImportLine"("importId");
CREATE INDEX "PayrollEduClockImportLine_employeeId_idx"
  ON "PayrollEduClockImportLine"("employeeId");

CREATE TABLE "PayrollEduClockImportPair" (
  "id" TEXT NOT NULL,
  "importId" TEXT NOT NULL,
  "importLineId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "pairKey" TEXT NOT NULL,
  "clockInEventId" TEXT NOT NULL,
  "clockOutEventId" TEXT NOT NULL,
  "clockInUtc" TIMESTAMP(3) NOT NULL,
  "clockOutUtc" TIMESTAMP(3) NOT NULL,
  "intervalStartUtc" TIMESTAMP(3) NOT NULL,
  "intervalEndUtc" TIMESTAMP(3) NOT NULL,
  "includedMinutes" INTEGER NOT NULL,
  "crossesPeriodStart" BOOLEAN NOT NULL DEFAULT false,
  "crossesPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PayrollEduClockImportPair_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PayrollEduClockImportPair_importId_pairKey_key"
  ON "PayrollEduClockImportPair"("importId", "pairKey");
CREATE UNIQUE INDEX "PayrollEduClockImportPair_importId_clockInEventId_key"
  ON "PayrollEduClockImportPair"("importId", "clockInEventId");
CREATE UNIQUE INDEX "PayrollEduClockImportPair_importId_clockOutEventId_key"
  ON "PayrollEduClockImportPair"("importId", "clockOutEventId");
CREATE INDEX "PayrollEduClockImportPair_importLineId_idx"
  ON "PayrollEduClockImportPair"("importLineId");
CREATE INDEX "PayrollEduClockImportPair_employeeId_idx"
  ON "PayrollEduClockImportPair"("employeeId");

CREATE TABLE "PayrollEduClockImportEvent" (
  "id" TEXT NOT NULL,
  "importId" TEXT NOT NULL,
  "importLineId" TEXT NOT NULL,
  "importPairId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "eduClockEventId" TEXT NOT NULL,
  "effectiveEventId" TEXT NOT NULL,
  "eventType" "EduClockEventType" NOT NULL,
  "occurredAtUtc" TIMESTAMP(3) NOT NULL,
  "sourceRole" "PayrollEduClockImportEventRole" NOT NULL,
  "correctionMeta" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PayrollEduClockImportEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PayrollEduClockImportEvent_importId_eduClockEventId_key"
  ON "PayrollEduClockImportEvent"("importId", "eduClockEventId");
CREATE UNIQUE INDEX "PayrollEduClockImportEvent_importId_effectiveEventId_key"
  ON "PayrollEduClockImportEvent"("importId", "effectiveEventId");
CREATE INDEX "PayrollEduClockImportEvent_importPairId_idx"
  ON "PayrollEduClockImportEvent"("importPairId");
CREATE INDEX "PayrollEduClockImportEvent_importLineId_idx"
  ON "PayrollEduClockImportEvent"("importLineId");
CREATE INDEX "PayrollEduClockImportEvent_employeeId_idx"
  ON "PayrollEduClockImportEvent"("employeeId");

CREATE TABLE "PayrollAuditLog" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "payrollRunId" TEXT NOT NULL,
  "importId" TEXT,
  "action" "PayrollAuditAction" NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "reason" TEXT,
  "previousState" JSONB,
  "newState" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PayrollAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PayrollAuditLog_schoolId_createdAt_idx"
  ON "PayrollAuditLog"("schoolId", "createdAt");
CREATE INDEX "PayrollAuditLog_payrollRunId_createdAt_idx"
  ON "PayrollAuditLog"("payrollRunId", "createdAt");
CREATE INDEX "PayrollAuditLog_importId_idx"
  ON "PayrollAuditLog"("importId");
CREATE INDEX "PayrollAuditLog_action_idx"
  ON "PayrollAuditLog"("action");

-- Foreign keys
ALTER TABLE "PayrollEduClockImport"
  ADD CONSTRAINT "PayrollEduClockImport_schoolId_fkey"
  FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PayrollEduClockImport"
  ADD CONSTRAINT "PayrollEduClockImport_payrollRunId_fkey"
  FOREIGN KEY ("payrollRunId") REFERENCES "PayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PayrollEduClockImport"
  ADD CONSTRAINT "PayrollEduClockImport_supersedesImportId_fkey"
  FOREIGN KEY ("supersedesImportId") REFERENCES "PayrollEduClockImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PayrollEduClockImportLine"
  ADD CONSTRAINT "PayrollEduClockImportLine_importId_fkey"
  FOREIGN KEY ("importId") REFERENCES "PayrollEduClockImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PayrollEduClockImportLine"
  ADD CONSTRAINT "PayrollEduClockImportLine_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PayrollEduClockImportPair"
  ADD CONSTRAINT "PayrollEduClockImportPair_importId_fkey"
  FOREIGN KEY ("importId") REFERENCES "PayrollEduClockImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PayrollEduClockImportPair"
  ADD CONSTRAINT "PayrollEduClockImportPair_importLineId_fkey"
  FOREIGN KEY ("importLineId") REFERENCES "PayrollEduClockImportLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PayrollEduClockImportPair"
  ADD CONSTRAINT "PayrollEduClockImportPair_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PayrollEduClockImportEvent"
  ADD CONSTRAINT "PayrollEduClockImportEvent_importId_fkey"
  FOREIGN KEY ("importId") REFERENCES "PayrollEduClockImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PayrollEduClockImportEvent"
  ADD CONSTRAINT "PayrollEduClockImportEvent_importLineId_fkey"
  FOREIGN KEY ("importLineId") REFERENCES "PayrollEduClockImportLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PayrollEduClockImportEvent"
  ADD CONSTRAINT "PayrollEduClockImportEvent_importPairId_fkey"
  FOREIGN KEY ("importPairId") REFERENCES "PayrollEduClockImportPair"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PayrollEduClockImportEvent"
  ADD CONSTRAINT "PayrollEduClockImportEvent_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PayrollAuditLog"
  ADD CONSTRAINT "PayrollAuditLog_schoolId_fkey"
  FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PayrollAuditLog"
  ADD CONSTRAINT "PayrollAuditLog_payrollRunId_fkey"
  FOREIGN KEY ("payrollRunId") REFERENCES "PayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PayrollAuditLog"
  ADD CONSTRAINT "PayrollAuditLog_importId_fkey"
  FOREIGN KEY ("importId") REFERENCES "PayrollEduClockImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PayrollRunEmployee"
  ADD CONSTRAINT "PayrollRunEmployee_eduClockImportLineId_fkey"
  FOREIGN KEY ("eduClockImportLineId") REFERENCES "PayrollEduClockImportLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS "PayrollRunEmployee_eduClockImportLineId_key"
  ON "PayrollRunEmployee"("eduClockImportLineId");
