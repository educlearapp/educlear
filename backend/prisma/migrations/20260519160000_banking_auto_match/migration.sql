-- AlterEnum
ALTER TYPE "BankTransactionMatchStatus" ADD VALUE IF NOT EXISTS 'suggested';

-- AlterTable
ALTER TABLE "BankTransaction" ADD COLUMN "suggestedAccountId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "BankTransaction" ADD COLUMN "confidenceScore" INTEGER NOT NULL DEFAULT 0;
