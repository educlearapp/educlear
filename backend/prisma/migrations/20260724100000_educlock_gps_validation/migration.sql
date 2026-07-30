-- EduClock Build 4 Checkpoint 1: GPS entrance radius + accepted-event GPS fields + rejected attempt audit.
-- Additive only. Historical Build 3 EduClockEvent rows remain valid (new columns nullable).
-- Does not alter campus toleranceMetres (reserved for future polygon perimeter).

-- 1) Entrance allowed radius (default 5 m, owner range 1–25)
ALTER TABLE "EduClockEntrance"
  ADD COLUMN IF NOT EXISTS "allowedRadiusMetres" INTEGER NOT NULL DEFAULT 5;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'EduClockEntrance_allowedRadiusMetres_check'
  ) THEN
    ALTER TABLE "EduClockEntrance"
      ADD CONSTRAINT "EduClockEntrance_allowedRadiusMetres_check"
      CHECK ("allowedRadiusMetres" >= 1 AND "allowedRadiusMetres" <= 25);
  END IF;
END $$;

-- 2) Accepted clock events: matched entrance + distance + validation version
ALTER TABLE "EduClockEvent"
  ADD COLUMN IF NOT EXISTS "matchedEntranceId" TEXT,
  ADD COLUMN IF NOT EXISTS "distanceMetres" DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS "validationVersion" TEXT;

CREATE INDEX IF NOT EXISTS "EduClockEvent_matchedEntranceId_idx"
  ON "EduClockEvent"("matchedEntranceId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'EduClockEvent_matchedEntranceId_fkey'
  ) THEN
    ALTER TABLE "EduClockEvent"
      ADD CONSTRAINT "EduClockEvent_matchedEntranceId_fkey"
      FOREIGN KEY ("matchedEntranceId") REFERENCES "EduClockEntrance"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 3) Rejected GPS attempts — never become attendance / EduClockEvent rows
CREATE TABLE IF NOT EXISTS "EduClockGpsAttempt" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "attemptType" "EduClockEventType" NOT NULL,
  "occurredAtUtc" TIMESTAMP(3) NOT NULL,
  "latitude" DECIMAL(10,7),
  "longitude" DECIMAL(10,7),
  "accuracyMetres" DECIMAL(10,2),
  "nearestEntranceId" TEXT,
  "distanceMetres" DECIMAL(10,2),
  "rejectionCode" TEXT NOT NULL,
  "rejectionReason" TEXT NOT NULL,
  "deviceMetadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EduClockGpsAttempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "EduClockGpsAttempt_schoolId_occurredAtUtc_idx"
  ON "EduClockGpsAttempt"("schoolId", "occurredAtUtc");
CREATE INDEX IF NOT EXISTS "EduClockGpsAttempt_schoolId_employeeId_occurredAtUtc_idx"
  ON "EduClockGpsAttempt"("schoolId", "employeeId", "occurredAtUtc");
CREATE INDEX IF NOT EXISTS "EduClockGpsAttempt_nearestEntranceId_idx"
  ON "EduClockGpsAttempt"("nearestEntranceId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'EduClockGpsAttempt_schoolId_fkey'
  ) THEN
    ALTER TABLE "EduClockGpsAttempt"
      ADD CONSTRAINT "EduClockGpsAttempt_schoolId_fkey"
      FOREIGN KEY ("schoolId") REFERENCES "School"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'EduClockGpsAttempt_employeeId_fkey'
  ) THEN
    ALTER TABLE "EduClockGpsAttempt"
      ADD CONSTRAINT "EduClockGpsAttempt_employeeId_fkey"
      FOREIGN KEY ("employeeId") REFERENCES "Employee"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'EduClockGpsAttempt_nearestEntranceId_fkey'
  ) THEN
    ALTER TABLE "EduClockGpsAttempt"
      ADD CONSTRAINT "EduClockGpsAttempt_nearestEntranceId_fkey"
      FOREIGN KEY ("nearestEntranceId") REFERENCES "EduClockEntrance"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
