-- Additive EduClock staff self-reported absence.
-- Does not alter EduClockEvent, open shifts, exceptions, GPS, or payroll tables.

CREATE TYPE "EduClockAbsenceReason" AS ENUM (
  'SICK',
  'FAMILY_RESPONSIBILITY',
  'EMERGENCY',
  'MEDICAL_APPOINTMENT',
  'APPROVED_LEAVE',
  'UNPAID_LEAVE',
  'TRAINING_OFFICIAL_DUTY',
  'OTHER'
);

CREATE TYPE "EduClockAbsenceApprovalStatus" AS ENUM (
  'REPORTED',
  'AUTHORISED',
  'UNAUTHORISED',
  'CANCELLED'
);

CREATE TYPE "EduClockAbsenceSource" AS ENUM ('STAFF_SELF_REPORT');

CREATE TABLE "EduClockStaffAbsence" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "employeeNumberSnapshot" TEXT NOT NULL,
  "schoolLocalDate" TEXT NOT NULL,
  "timezone" TEXT NOT NULL DEFAULT 'Africa/Johannesburg',
  "reason" "EduClockAbsenceReason" NOT NULL,
  "note" TEXT,
  "source" "EduClockAbsenceSource" NOT NULL DEFAULT 'STAFF_SELF_REPORT',
  "approvalStatus" "EduClockAbsenceApprovalStatus" NOT NULL DEFAULT 'REPORTED',
  "reportedAtUtc" TIMESTAMP(3) NOT NULL,
  "reportedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "cancelledAtUtc" TIMESTAMP(3),
  "cancelledByUserId" TEXT,
  "cancelNote" TEXT,
  CONSTRAINT "EduClockStaffAbsence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EduClockStaffAbsence_schoolId_employeeId_schoolLocalDate_key"
  ON "EduClockStaffAbsence"("schoolId", "employeeId", "schoolLocalDate");

CREATE INDEX "EduClockStaffAbsence_schoolId_schoolLocalDate_idx"
  ON "EduClockStaffAbsence"("schoolId", "schoolLocalDate");

CREATE INDEX "EduClockStaffAbsence_schoolId_approvalStatus_idx"
  ON "EduClockStaffAbsence"("schoolId", "approvalStatus");

ALTER TABLE "EduClockStaffAbsence"
  ADD CONSTRAINT "EduClockStaffAbsence_schoolId_fkey"
  FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EduClockStaffAbsence"
  ADD CONSTRAINT "EduClockStaffAbsence_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
