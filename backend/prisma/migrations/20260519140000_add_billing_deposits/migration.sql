-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "DepositStatus" AS ENUM ('ACTIVE', 'PARTIALLY_ALLOCATED', 'FULLY_ALLOCATED', 'REFUNDED', 'VOID');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "BillingDeposit" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "depositNumber" TEXT NOT NULL,
    "familyAccountId" TEXT,
    "learnerId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "remainingBalance" DOUBLE PRECISION NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "depositDate" TIMESTAMP(3) NOT NULL,
    "status" "DepositStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingDeposit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "BillingDepositAllocation" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "depositId" TEXT NOT NULL,
    "ledgerInvoiceId" TEXT NOT NULL,
    "invoiceReference" TEXT,
    "invoiceDate" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingDepositAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "BillingDepositHistoryEntry" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "depositId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "amount" DOUBLE PRECISION,
    "description" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingDepositHistoryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "BillingDeposit_schoolId_depositNumber_key" ON "BillingDeposit"("schoolId", "depositNumber");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BillingDeposit_schoolId_idx" ON "BillingDeposit"("schoolId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BillingDeposit_schoolId_status_idx" ON "BillingDeposit"("schoolId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BillingDeposit_schoolId_learnerId_idx" ON "BillingDeposit"("schoolId", "learnerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BillingDeposit_schoolId_depositDate_idx" ON "BillingDeposit"("schoolId", "depositDate");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BillingDepositAllocation_schoolId_idx" ON "BillingDepositAllocation"("schoolId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BillingDepositAllocation_depositId_idx" ON "BillingDepositAllocation"("depositId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BillingDepositAllocation_schoolId_ledgerInvoiceId_idx" ON "BillingDepositAllocation"("schoolId", "ledgerInvoiceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BillingDepositHistoryEntry_depositId_idx" ON "BillingDepositHistoryEntry"("depositId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BillingDepositHistoryEntry_schoolId_idx" ON "BillingDepositHistoryEntry"("schoolId");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BillingDeposit_schoolId_fkey') THEN
    ALTER TABLE "BillingDeposit" ADD CONSTRAINT "BillingDeposit_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BillingDeposit_learnerId_fkey') THEN
    ALTER TABLE "BillingDeposit" ADD CONSTRAINT "BillingDeposit_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "Learner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BillingDeposit_familyAccountId_fkey') THEN
    ALTER TABLE "BillingDeposit" ADD CONSTRAINT "BillingDeposit_familyAccountId_fkey" FOREIGN KEY ("familyAccountId") REFERENCES "FamilyAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BillingDepositAllocation_depositId_fkey') THEN
    ALTER TABLE "BillingDepositAllocation" ADD CONSTRAINT "BillingDepositAllocation_depositId_fkey" FOREIGN KEY ("depositId") REFERENCES "BillingDeposit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BillingDepositHistoryEntry_depositId_fkey') THEN
    ALTER TABLE "BillingDepositHistoryEntry" ADD CONSTRAINT "BillingDepositHistoryEntry_depositId_fkey" FOREIGN KEY ("depositId") REFERENCES "BillingDeposit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
