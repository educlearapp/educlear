-- AlterTable (production-safe: table may be absent until restore migration runs)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'SchoolEmailSettings'
  ) THEN
    ALTER TABLE "SchoolEmailSettings"
      ADD COLUMN IF NOT EXISTS "testEmailPassedAt" TIMESTAMP(3);
  END IF;
END $$;
