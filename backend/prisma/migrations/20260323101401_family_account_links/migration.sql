-- AlterTable
ALTER TABLE "Learner" ADD COLUMN IF NOT EXISTS     "familyAccountId" TEXT;

-- AlterTable
ALTER TABLE "Parent" ADD COLUMN IF NOT EXISTS     "familyAccountId" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "FamilyAccount" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "accountRef" TEXT NOT NULL,
    "familyName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FamilyAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "FamilyAccount_accountRef_key" ON "FamilyAccount"("accountRef");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FamilyAccount_schoolId_idx" ON "FamilyAccount"("schoolId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FamilyAccount_schoolId_familyName_idx" ON "FamilyAccount"("schoolId", "familyName");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Parent_familyAccountId_fkey') THEN
    ALTER TABLE "Parent" ADD CONSTRAINT "Parent_familyAccountId_fkey" FOREIGN KEY ("familyAccountId") REFERENCES "FamilyAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FamilyAccount_schoolId_fkey') THEN
    ALTER TABLE "FamilyAccount" ADD CONSTRAINT "FamilyAccount_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Learner_familyAccountId_fkey') THEN
    ALTER TABLE "Learner" ADD CONSTRAINT "Learner_familyAccountId_fkey" FOREIGN KEY ("familyAccountId") REFERENCES "FamilyAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
