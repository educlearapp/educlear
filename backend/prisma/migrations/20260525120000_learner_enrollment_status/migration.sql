-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'LearnerEnrollmentStatus'
      AND n.nspname = current_schema()
  ) THEN
    CREATE TYPE "LearnerEnrollmentStatus" AS ENUM ('ACTIVE', 'HISTORICAL');
  END IF;
END
$$;

-- AlterTable
ALTER TABLE "Learner"
  ADD COLUMN IF NOT EXISTS "enrollmentStatus" "LearnerEnrollmentStatus";

ALTER TABLE "Learner"
  ALTER COLUMN "enrollmentStatus" SET DEFAULT 'ACTIVE';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'Learner'
      AND column_name = 'enrollmentStatus'
      AND is_nullable = 'YES'
  ) THEN
    UPDATE "Learner"
    SET "enrollmentStatus" = 'ACTIVE'
    WHERE "enrollmentStatus" IS NULL;

    ALTER TABLE "Learner"
      ALTER COLUMN "enrollmentStatus" SET NOT NULL;
  END IF;
END
$$;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Learner_schoolId_enrollmentStatus_idx"
  ON "Learner"("schoolId", "enrollmentStatus");
