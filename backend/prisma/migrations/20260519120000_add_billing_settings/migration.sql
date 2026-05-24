-- CreateTable
CREATE TABLE IF NOT EXISTS "BillingSettings" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "settings" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "BillingSettings_schoolId_key" ON "BillingSettings"("schoolId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BillingSettings_schoolId_idx" ON "BillingSettings"("schoolId");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BillingSettings_schoolId_fkey') THEN
    ALTER TABLE "BillingSettings" ADD CONSTRAINT "BillingSettings_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
