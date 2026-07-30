-- EduClock Build 3: immutable clock events, one-open-shift guard, lifecycle exceptions.
-- Cutoff rule (documented): Missing Clock Out = open shift whose schoolLocalDate < today
-- in Africa/Johannesburg (or school timezone). No auto clock-out. No GPS enforcement.

CREATE TYPE "EduClockEventType" AS ENUM ('CLOCK_IN', 'CLOCK_OUT');
CREATE TYPE "EduClockEventSource" AS ENUM ('STAFF_MOBILE', 'OWNER_MANUAL', 'SYSTEM');
CREATE TYPE "EduClockExceptionType" AS ENUM (
  'MISSING_CLOCK_OUT',
  'DUPLICATE_CLOCK_ATTEMPT',
  'INVALID_EVENT_SEQUENCE',
  'MANUAL_CORRECTION',
  'ACTIVATION_BLOCKED'
);
CREATE TYPE "EduClockExceptionStatus" AS ENUM ('OPEN', 'RESOLVED');

CREATE TABLE "EduClockEvent" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "employeeNumberSnapshot" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "eventType" "EduClockEventType" NOT NULL,
  "occurredAtUtc" TIMESTAMP(3) NOT NULL,
  "schoolLocalDate" TEXT NOT NULL,
  "schoolLocalTime" TEXT NOT NULL,
  "timezone" TEXT NOT NULL DEFAULT 'Africa/Johannesburg',
  "source" "EduClockEventSource" NOT NULL DEFAULT 'STAFF_MOBILE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" TEXT NOT NULL,
  "note" TEXT,
  "correctedFromEventId" TEXT,
  "isManualCorrection" BOOLEAN NOT NULL DEFAULT false,
  "metadata" JSONB,
  "latitude" DECIMAL(10,7),
  "longitude" DECIMAL(10,7),
  "accuracyMetres" DECIMAL(10,2),
  CONSTRAINT "EduClockEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EduClockOpenShift" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "clockInEventId" TEXT NOT NULL,
  "schoolLocalDate" TEXT NOT NULL,
  "openedAtUtc" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EduClockOpenShift_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EduClockException" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "employeeNumberSnapshot" TEXT,
  "schoolLocalDate" TEXT NOT NULL,
  "exceptionType" "EduClockExceptionType" NOT NULL,
  "details" TEXT NOT NULL,
  "status" "EduClockExceptionStatus" NOT NULL DEFAULT 'OPEN',
  "relatedEventId" TEXT,
  "resolvedByUserId" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EduClockException_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EduClockIdempotencyKey" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "eventId" TEXT,
  "response" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EduClockIdempotencyKey_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EduClockEvent_schoolId_schoolLocalDate_idx" ON "EduClockEvent"("schoolId", "schoolLocalDate");
CREATE INDEX "EduClockEvent_schoolId_employeeId_occurredAtUtc_idx" ON "EduClockEvent"("schoolId", "employeeId", "occurredAtUtc");
CREATE INDEX "EduClockEvent_employeeId_occurredAtUtc_idx" ON "EduClockEvent"("employeeId", "occurredAtUtc");
CREATE INDEX "EduClockEvent_correctedFromEventId_idx" ON "EduClockEvent"("correctedFromEventId");

CREATE UNIQUE INDEX "EduClockOpenShift_clockInEventId_key" ON "EduClockOpenShift"("clockInEventId");
CREATE UNIQUE INDEX "EduClockOpenShift_schoolId_employeeId_key" ON "EduClockOpenShift"("schoolId", "employeeId");
CREATE INDEX "EduClockOpenShift_schoolId_schoolLocalDate_idx" ON "EduClockOpenShift"("schoolId", "schoolLocalDate");

CREATE INDEX "EduClockException_schoolId_schoolLocalDate_idx" ON "EduClockException"("schoolId", "schoolLocalDate");
CREATE INDEX "EduClockException_schoolId_status_idx" ON "EduClockException"("schoolId", "status");
CREATE INDEX "EduClockException_employeeId_schoolLocalDate_idx" ON "EduClockException"("employeeId", "schoolLocalDate");

CREATE UNIQUE INDEX "EduClockIdempotencyKey_schoolId_userId_operation_key_key"
  ON "EduClockIdempotencyKey"("schoolId", "userId", "operation", "key");
CREATE INDEX "EduClockIdempotencyKey_createdAt_idx" ON "EduClockIdempotencyKey"("createdAt");

ALTER TABLE "EduClockEvent"
  ADD CONSTRAINT "EduClockEvent_schoolId_fkey"
  FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EduClockEvent"
  ADD CONSTRAINT "EduClockEvent_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EduClockEvent"
  ADD CONSTRAINT "EduClockEvent_correctedFromEventId_fkey"
  FOREIGN KEY ("correctedFromEventId") REFERENCES "EduClockEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EduClockOpenShift"
  ADD CONSTRAINT "EduClockOpenShift_schoolId_fkey"
  FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EduClockOpenShift"
  ADD CONSTRAINT "EduClockOpenShift_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EduClockOpenShift"
  ADD CONSTRAINT "EduClockOpenShift_clockInEventId_fkey"
  FOREIGN KEY ("clockInEventId") REFERENCES "EduClockEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EduClockException"
  ADD CONSTRAINT "EduClockException_schoolId_fkey"
  FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EduClockException"
  ADD CONSTRAINT "EduClockException_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EduClockException"
  ADD CONSTRAINT "EduClockException_relatedEventId_fkey"
  FOREIGN KEY ("relatedEventId") REFERENCES "EduClockEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EduClockIdempotencyKey"
  ADD CONSTRAINT "EduClockIdempotencyKey_schoolId_fkey"
  FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
