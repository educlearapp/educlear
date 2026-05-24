-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "CommunicationChannel" AS ENUM ('sms', 'email', 'whatsapp', 'push', 'in_app');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "CommunicationMessageStatus" AS ENUM ('queued', 'sending', 'sent', 'failed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "CommunicationCategory" AS ENUM ('invoice_ready', 'statement_ready', 'attendance_absent', 'attendance_late', 'incident_created', 'homework_added', 'assessment_notice', 'exam_notice', 'parent_message', 'teacher_reply', 'onboarding_invite', 'marketing_campaign', 'payment_reminder', 'school_notice', 'document_shared');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "SchoolCommunicationProfile" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "smtp" JSONB,
    "smsProvider" JSONB,
    "whatsappProvider" JSONB,
    "pushProvider" JSONB,
    "senderDisplayName" TEXT NOT NULL DEFAULT '',
    "replyToEmail" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolCommunicationProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CommunicationCampaign" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "CommunicationCategory" NOT NULL,
    "metadata" JSONB,
    "createdBy" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunicationCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CommunicationTemplate" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT,
    "templateKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subjectTemplate" TEXT NOT NULL DEFAULT '',
    "bodyTemplate" TEXT NOT NULL,
    "defaultChannel" "CommunicationChannel",
    "variableHints" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunicationTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CommunicationMessage" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "campaignId" TEXT,
    "learnerId" TEXT,
    "parentId" TEXT,
    "category" "CommunicationCategory" NOT NULL,
    "channel" "CommunicationChannel" NOT NULL,
    "templateKey" TEXT,
    "subject" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL,
    "variables" JSONB,
    "recipient" TEXT,
    "status" "CommunicationMessageStatus" NOT NULL DEFAULT 'queued',
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sendingAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "error" TEXT,
    "providerResponse" JSONB,
    "createdBy" TEXT NOT NULL DEFAULT '',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "parentNotificationId" TEXT,

    CONSTRAINT "CommunicationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CommunicationRecipient" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'to',
    "address" TEXT NOT NULL,

    CONSTRAINT "CommunicationRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CommunicationLog" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunicationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PushSubscription" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "parentId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "keys" JSONB,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "SchoolCommunicationProfile_schoolId_key" ON "SchoolCommunicationProfile"("schoolId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CommunicationCampaign_schoolId_createdAt_idx" ON "CommunicationCampaign"("schoolId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CommunicationTemplate_schoolId_templateKey_idx" ON "CommunicationTemplate"("schoolId", "templateKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CommunicationTemplate_templateKey_idx" ON "CommunicationTemplate"("templateKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CommunicationMessage_schoolId_status_idx" ON "CommunicationMessage"("schoolId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CommunicationMessage_schoolId_category_idx" ON "CommunicationMessage"("schoolId", "category");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CommunicationMessage_schoolId_channel_idx" ON "CommunicationMessage"("schoolId", "channel");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CommunicationMessage_queuedAt_idx" ON "CommunicationMessage"("queuedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CommunicationMessage_parentId_idx" ON "CommunicationMessage"("parentId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CommunicationRecipient_messageId_idx" ON "CommunicationRecipient"("messageId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CommunicationLog_schoolId_createdAt_idx" ON "CommunicationLog"("schoolId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CommunicationLog_messageId_createdAt_idx" ON "CommunicationLog"("messageId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PushSubscription_schoolId_parentId_idx" ON "PushSubscription"("schoolId", "parentId");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SchoolCommunicationProfile_schoolId_fkey') THEN
    ALTER TABLE "SchoolCommunicationProfile" ADD CONSTRAINT "SchoolCommunicationProfile_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommunicationCampaign_schoolId_fkey') THEN
    ALTER TABLE "CommunicationCampaign" ADD CONSTRAINT "CommunicationCampaign_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommunicationTemplate_schoolId_fkey') THEN
    ALTER TABLE "CommunicationTemplate" ADD CONSTRAINT "CommunicationTemplate_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommunicationMessage_schoolId_fkey') THEN
    ALTER TABLE "CommunicationMessage" ADD CONSTRAINT "CommunicationMessage_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommunicationMessage_campaignId_fkey') THEN
    ALTER TABLE "CommunicationMessage" ADD CONSTRAINT "CommunicationMessage_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "CommunicationCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommunicationMessage_parentId_fkey') THEN
    ALTER TABLE "CommunicationMessage" ADD CONSTRAINT "CommunicationMessage_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Parent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommunicationMessage_learnerId_fkey') THEN
    ALTER TABLE "CommunicationMessage" ADD CONSTRAINT "CommunicationMessage_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "Learner"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ParentNotification FK deferred to 20260520120000_align_live_schema (table created there)

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommunicationRecipient_messageId_fkey') THEN
    ALTER TABLE "CommunicationRecipient" ADD CONSTRAINT "CommunicationRecipient_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "CommunicationMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommunicationLog_schoolId_fkey') THEN
    ALTER TABLE "CommunicationLog" ADD CONSTRAINT "CommunicationLog_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommunicationLog_messageId_fkey') THEN
    ALTER TABLE "CommunicationLog" ADD CONSTRAINT "CommunicationLog_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "CommunicationMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PushSubscription_schoolId_fkey') THEN
    ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PushSubscription_parentId_fkey') THEN
    ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Parent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
