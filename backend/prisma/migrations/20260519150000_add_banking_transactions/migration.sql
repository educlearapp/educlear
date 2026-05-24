-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "BankTransactionMatchStatus" AS ENUM ('imported', 'matched', 'unmatched', 'duplicate', 'ready_to_post');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "BankStatementImport" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankStatementImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "BankTransaction" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "reference" TEXT NOT NULL DEFAULT '',
    "moneyIn" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "moneyOut" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "direction" TEXT NOT NULL,
    "transactionType" TEXT NOT NULL DEFAULT 'payment',
    "suggestedAccountNo" TEXT NOT NULL DEFAULT '',
    "suggestedLearnerId" TEXT NOT NULL DEFAULT '',
    "suggestedLearnerName" TEXT NOT NULL DEFAULT '',
    "matchConfidence" TEXT NOT NULL DEFAULT 'none',
    "matchReason" TEXT NOT NULL DEFAULT '',
    "reviewStatus" TEXT NOT NULL DEFAULT 'pending',
    "matchStatus" "BankTransactionMatchStatus" NOT NULL DEFAULT 'imported',
    "expenseCategory" TEXT NOT NULL DEFAULT '',
    "suggestedSupplierName" TEXT NOT NULL DEFAULT '',
    "supplierId" TEXT NOT NULL DEFAULT '',
    "expenseNotes" TEXT NOT NULL DEFAULT '',
    "postedPaymentId" TEXT,
    "fingerprint" TEXT NOT NULL,
    "rawRow" JSONB,
    "isDuplicate" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BankStatementImport_schoolId_idx" ON "BankStatementImport"("schoolId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BankStatementImport_schoolId_importedAt_idx" ON "BankStatementImport"("schoolId", "importedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BankTransaction_schoolId_idx" ON "BankTransaction"("schoolId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BankTransaction_schoolId_fingerprint_idx" ON "BankTransaction"("schoolId", "fingerprint");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BankTransaction_schoolId_matchStatus_idx" ON "BankTransaction"("schoolId", "matchStatus");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BankTransaction_importId_idx" ON "BankTransaction"("importId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BankTransaction_importId_matchStatus_idx" ON "BankTransaction"("importId", "matchStatus");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BankStatementImport_schoolId_fkey') THEN
    ALTER TABLE "BankStatementImport" ADD CONSTRAINT "BankStatementImport_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BankTransaction_schoolId_fkey') THEN
    ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BankTransaction_importId_fkey') THEN
    ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_importId_fkey" FOREIGN KEY ("importId") REFERENCES "BankStatementImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
