-- Additive durable bulk statement-email job tables.
-- Non-destructive: creates enums/tables/indexes only.

CREATE TYPE "BulkStatementEmailJobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETE', 'PARTIAL', 'FAILED', 'CANCELLED');

CREATE TYPE "BulkStatementEmailRecipientStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED', 'SKIPPED');

CREATE TABLE "BulkStatementEmailJob" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL DEFAULT '',
    "subject" TEXT NOT NULL,
    "htmlBody" TEXT NOT NULL,
    "messagePlain" TEXT NOT NULL DEFAULT '',
    "statementPeriod" TEXT NOT NULL DEFAULT 'All Time',
    "filterSnapshot" JSONB,
    "status" "BulkStatementEmailJobStatus" NOT NULL DEFAULT 'PENDING',
    "totalRecipients" INTEGER NOT NULL DEFAULT 0,
    "pendingCount" INTEGER NOT NULL DEFAULT 0,
    "sendingCount" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BulkStatementEmailJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BulkStatementEmailRecipient" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "accountNo" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL DEFAULT '',
    "learnerName" TEXT NOT NULL DEFAULT '',
    "parentId" TEXT NOT NULL DEFAULT '',
    "contactName" TEXT NOT NULL DEFAULT '',
    "relationship" TEXT NOT NULL DEFAULT '',
    "normalizedEmail" TEXT NOT NULL,
    "displayEmail" TEXT NOT NULL DEFAULT '',
    "recipientKey" TEXT NOT NULL,
    "status" "BulkStatementEmailRecipientStatus" NOT NULL DEFAULT 'PENDING',
    "failureReason" TEXT,
    "providerMessageId" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "sendingLeaseUntil" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BulkStatementEmailRecipient_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BulkStatementEmailJob_schoolId_createdAt_idx" ON "BulkStatementEmailJob"("schoolId", "createdAt");
CREATE INDEX "BulkStatementEmailJob_schoolId_status_idx" ON "BulkStatementEmailJob"("schoolId", "status");
CREATE INDEX "BulkStatementEmailJob_status_updatedAt_idx" ON "BulkStatementEmailJob"("status", "updatedAt");

CREATE UNIQUE INDEX "BulkStatementEmailRecipient_jobId_recipientKey_key" ON "BulkStatementEmailRecipient"("jobId", "recipientKey");
CREATE INDEX "BulkStatementEmailRecipient_jobId_status_idx" ON "BulkStatementEmailRecipient"("jobId", "status");
CREATE INDEX "BulkStatementEmailRecipient_schoolId_status_idx" ON "BulkStatementEmailRecipient"("schoolId", "status");
CREATE INDEX "BulkStatementEmailRecipient_status_sendingLeaseUntil_idx" ON "BulkStatementEmailRecipient"("status", "sendingLeaseUntil");

ALTER TABLE "BulkStatementEmailJob"
  ADD CONSTRAINT "BulkStatementEmailJob_schoolId_fkey"
  FOREIGN KEY ("schoolId") REFERENCES "School"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BulkStatementEmailRecipient"
  ADD CONSTRAINT "BulkStatementEmailRecipient_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "BulkStatementEmailJob"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BulkStatementEmailRecipient"
  ADD CONSTRAINT "BulkStatementEmailRecipient_schoolId_fkey"
  FOREIGN KEY ("schoolId") REFERENCES "School"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
