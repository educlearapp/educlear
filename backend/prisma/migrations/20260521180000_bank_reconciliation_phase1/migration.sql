-- AlterEnum
ALTER TYPE "BankTransactionMatchStatus" ADD VALUE IF NOT EXISTS 'accepted';
ALTER TYPE "BankTransactionMatchStatus" ADD VALUE IF NOT EXISTS 'rejected';

-- AlterTable
ALTER TABLE "BankStatementImport" ADD COLUMN "bankName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "BankStatementImport" ADD COLUMN "uploadedBy" TEXT NOT NULL DEFAULT '';
ALTER TABLE "BankStatementImport" ADD COLUMN "totalRows" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "BankStatementImport" ADD COLUMN "matchedRows" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "BankStatementImport" ADD COLUMN "unmatchedRows" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "BankStatementImport" ADD COLUMN "duplicateRows" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "BankStatementImport" ADD COLUMN "totalAmountImported" DOUBLE PRECISION NOT NULL DEFAULT 0;
