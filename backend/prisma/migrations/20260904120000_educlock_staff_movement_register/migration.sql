-- Additive EduClock staff movement register (v1).
-- Does not alter EduClockEvent, EduClockOpenShift, EduClockStaffAbsence, GPS, or payroll tables.

CREATE TYPE "EduClockMovementReason" AS ENUM (
  'SCHOOL_BUSINESS',
  'MEETING',
  'COLLECT_DELIVER',
  'PERSONAL',
  'MEDICAL',
  'BANK_ERRAND',
  'EMERGENCY',
  'TRAINING_OFFICIAL_DUTY',
  'OTHER'
);

CREATE TYPE "EduClockMovementStatus" AS ENUM (
  'OPEN',
  'RETURNED',
  'CANCELLED'
);

CREATE TYPE "EduClockMovementSource" AS ENUM (
  'STAFF_SELF_REPORT',
  'OWNER_MANUAL'
);

CREATE TABLE "EduClockStaffMovement" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "employeeNumberSnapshot" TEXT NOT NULL,
  "openShiftId" TEXT,
  "schoolLocalDate" TEXT NOT NULL,
  "timezone" TEXT NOT NULL DEFAULT 'Africa/Johannesburg',
  "status" "EduClockMovementStatus" NOT NULL DEFAULT 'OPEN',
  "source" "EduClockMovementSource" NOT NULL DEFAULT 'STAFF_SELF_REPORT',
  "reason" "EduClockMovementReason" NOT NULL,
  "destination" TEXT,
  "note" TEXT,
  "departedAtUtc" TIMESTAMP(3) NOT NULL,
  "departedByUserId" TEXT NOT NULL,
  "returnedAtUtc" TIMESTAMP(3),
  "returnedByUserId" TEXT,
  "durationAwayMs" INTEGER,
  "departLatitude" DECIMAL(10,7),
  "departLongitude" DECIMAL(10,7),
  "departAccuracyMetres" DECIMAL(10,2),
  "returnLatitude" DECIMAL(10,7),
  "returnLongitude" DECIMAL(10,7),
  "returnAccuracyMetres" DECIMAL(10,2),
  "cancelledAtUtc" TIMESTAMP(3),
  "cancelledByUserId" TEXT,
  "cancelNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EduClockStaffMovement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EduClockStaffMovement_schoolId_schoolLocalDate_idx"
  ON "EduClockStaffMovement"("schoolId", "schoolLocalDate");

CREATE INDEX "EduClockStaffMovement_schoolId_employeeId_departedAtUtc_idx"
  ON "EduClockStaffMovement"("schoolId", "employeeId", "departedAtUtc");

CREATE INDEX "EduClockStaffMovement_schoolId_status_idx"
  ON "EduClockStaffMovement"("schoolId", "status");

CREATE INDEX "EduClockStaffMovement_schoolId_reason_idx"
  ON "EduClockStaffMovement"("schoolId", "reason");

ALTER TABLE "EduClockStaffMovement"
  ADD CONSTRAINT "EduClockStaffMovement_schoolId_fkey"
  FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EduClockStaffMovement"
  ADD CONSTRAINT "EduClockStaffMovement_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "EduClockOpenMovement" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "movementId" TEXT NOT NULL,
  "schoolLocalDate" TEXT NOT NULL,
  "departedAtUtc" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EduClockOpenMovement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EduClockOpenMovement_movementId_key"
  ON "EduClockOpenMovement"("movementId");

CREATE UNIQUE INDEX "EduClockOpenMovement_schoolId_employeeId_key"
  ON "EduClockOpenMovement"("schoolId", "employeeId");

CREATE INDEX "EduClockOpenMovement_schoolId_schoolLocalDate_idx"
  ON "EduClockOpenMovement"("schoolId", "schoolLocalDate");

ALTER TABLE "EduClockOpenMovement"
  ADD CONSTRAINT "EduClockOpenMovement_schoolId_fkey"
  FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EduClockOpenMovement"
  ADD CONSTRAINT "EduClockOpenMovement_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EduClockOpenMovement"
  ADD CONSTRAINT "EduClockOpenMovement_movementId_fkey"
  FOREIGN KEY ("movementId") REFERENCES "EduClockStaffMovement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
