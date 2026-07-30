-- EduClock Build 2: campus + entrance management foundation (no clock events, no polygon yet).

CREATE TABLE IF NOT EXISTS "EduClockCampus" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "timezone" TEXT NOT NULL DEFAULT 'Africa/Johannesburg',
  "toleranceMetres" INTEGER NOT NULL DEFAULT 4,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "perimeterStatus" TEXT NOT NULL DEFAULT 'NOT_DRAWN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EduClockCampus_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "EduClockEntrance" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "campusId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "latitude" DECIMAL(10,7),
  "longitude" DECIMAL(10,7),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EduClockEntrance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "EduClockCampus_schoolId_name_key"
  ON "EduClockCampus"("schoolId", "name");
CREATE INDEX IF NOT EXISTS "EduClockCampus_schoolId_idx"
  ON "EduClockCampus"("schoolId");
CREATE INDEX IF NOT EXISTS "EduClockCampus_schoolId_isActive_idx"
  ON "EduClockCampus"("schoolId", "isActive");

CREATE UNIQUE INDEX IF NOT EXISTS "EduClockEntrance_campusId_name_key"
  ON "EduClockEntrance"("campusId", "name");
CREATE INDEX IF NOT EXISTS "EduClockEntrance_schoolId_idx"
  ON "EduClockEntrance"("schoolId");
CREATE INDEX IF NOT EXISTS "EduClockEntrance_campusId_idx"
  ON "EduClockEntrance"("campusId");
CREATE INDEX IF NOT EXISTS "EduClockEntrance_schoolId_isActive_idx"
  ON "EduClockEntrance"("schoolId", "isActive");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'EduClockCampus_schoolId_fkey'
  ) THEN
    ALTER TABLE "EduClockCampus"
      ADD CONSTRAINT "EduClockCampus_schoolId_fkey"
      FOREIGN KEY ("schoolId") REFERENCES "School"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'EduClockEntrance_schoolId_fkey'
  ) THEN
    ALTER TABLE "EduClockEntrance"
      ADD CONSTRAINT "EduClockEntrance_schoolId_fkey"
      FOREIGN KEY ("schoolId") REFERENCES "School"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'EduClockEntrance_campusId_fkey'
  ) THEN
    ALTER TABLE "EduClockEntrance"
      ADD CONSTRAINT "EduClockEntrance_campusId_fkey"
      FOREIGN KEY ("campusId") REFERENCES "EduClockCampus"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
