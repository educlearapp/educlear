-- CreateEnum
CREATE TYPE "BankTransactionMatchStatus" AS ENUM ('imported', 'matched', 'unmatched', 'duplicate', 'ready_to_post');

-- CreateTable
CREATE TABLE "BankStatementImport" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankStatementImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankTransaction" (
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
CREATE INDEX "BankStatementImport_schoolId_idx" ON "BankStatementImport"("schoolId");

-- CreateIndex
CREATE INDEX "BankStatementImport_schoolId_importedAt_idx" ON "BankStatementImport"("schoolId", "importedAt");

-- CreateIndex
CREATE INDEX "BankTransaction_schoolId_idx" ON "BankTransaction"("schoolId");

-- CreateIndex
CREATE INDEX "BankTransaction_schoolId_fingerprint_idx" ON "BankTransaction"("schoolId", "fingerprint");

-- CreateIndex
CREATE INDEX "BankTransaction_schoolId_matchStatus_idx" ON "BankTransaction"("schoolId", "matchStatus");

-- CreateIndex
CREATE INDEX "BankTransaction_importId_idx" ON "BankTransaction"("importId");

-- CreateIndex
CREATE INDEX "BankTransaction_importId_matchStatus_idx" ON "BankTransaction"("importId", "matchStatus");

-- AddForeignKey
ALTER TABLE "BankStatementImport" ADD CONSTRAINT "BankStatementImport_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_importId_fkey" FOREIGN KEY ("importId") REFERENCES "BankStatementImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
