-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ParentMessageSenderType" AS ENUM ('PARENT', 'TEACHER', 'ADMIN');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ParentNotificationType" AS ENUM ('INVOICE_READY', 'STATEMENT_READY', 'TEACHER_MESSAGE', 'INCIDENT', 'HOMEWORK', 'ASSESSMENT', 'EXAM', 'SCHOOL_NOTICE', 'DOCUMENT', 'ONBOARDING');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ParentOnboardingStatus" AS ENUM ('INVITED', 'OPENED', 'REGISTERED', 'LINKED', 'ACTIVE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ParentOutreachChannel" AS ENUM ('SMS', 'EMAIL', 'WHATSAPP');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ParentOutreachStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ParentTeacherThreadStatus" AS ENUM ('OPEN', 'CLOSED', 'ARCHIVED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "SchoolNoticeType" AS ENUM ('SCHOOL', 'GRADE', 'CLASS', 'ASSESSMENT', 'EXAM');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- DropForeignKey (production-safe: skip when legacy tables were never created on live DBs)
ALTER TABLE IF EXISTS "BillingDocumentRun" DROP CONSTRAINT IF EXISTS "BillingDocumentRun_schoolId_fkey";
ALTER TABLE IF EXISTS "BillingDocumentRunItem" DROP CONSTRAINT IF EXISTS "BillingDocumentRunItem_accountId_fkey";
ALTER TABLE IF EXISTS "BillingDocumentRunItem" DROP CONSTRAINT IF EXISTS "BillingDocumentRunItem_learnerId_fkey";
ALTER TABLE IF EXISTS "BillingDocumentRunItem" DROP CONSTRAINT IF EXISTS "BillingDocumentRunItem_parentId_fkey";
ALTER TABLE IF EXISTS "BillingDocumentRunItem" DROP CONSTRAINT IF EXISTS "BillingDocumentRunItem_runId_fkey";
ALTER TABLE IF EXISTS "BillingDocumentRunItem" DROP CONSTRAINT IF EXISTS "BillingDocumentRunItem_schoolId_fkey";
ALTER TABLE IF EXISTS "Homework" DROP CONSTRAINT IF EXISTS "Homework_schoolId_fkey";
ALTER TABLE IF EXISTS "Invoice" DROP CONSTRAINT IF EXISTS "Invoice_familyAccountId_fkey";
ALTER TABLE IF EXISTS "Invoice" DROP CONSTRAINT IF EXISTS "Invoice_invoiceRunId_fkey";
ALTER TABLE IF EXISTS "Invoice" DROP CONSTRAINT IF EXISTS "Invoice_learnerId_fkey";
ALTER TABLE IF EXISTS "Invoice" DROP CONSTRAINT IF EXISTS "Invoice_parentId_fkey";
ALTER TABLE IF EXISTS "Invoice" DROP CONSTRAINT IF EXISTS "Invoice_schoolId_fkey";
ALTER TABLE IF EXISTS "InvoiceLine" DROP CONSTRAINT IF EXISTS "InvoiceLine_invoiceId_fkey";
ALTER TABLE IF EXISTS "InvoiceRun" DROP CONSTRAINT IF EXISTS "InvoiceRun_schoolId_fkey";
ALTER TABLE IF EXISTS "LateFineRun" DROP CONSTRAINT IF EXISTS "LateFineRun_invoiceRunId_fkey";
ALTER TABLE IF EXISTS "LateFineRun" DROP CONSTRAINT IF EXISTS "LateFineRun_schoolId_fkey";
ALTER TABLE IF EXISTS "LateFineRunItem" DROP CONSTRAINT IF EXISTS "LateFineRunItem_familyAccountId_fkey";
ALTER TABLE IF EXISTS "LateFineRunItem" DROP CONSTRAINT IF EXISTS "LateFineRunItem_invoiceId_fkey";
ALTER TABLE IF EXISTS "LateFineRunItem" DROP CONSTRAINT IF EXISTS "LateFineRunItem_lateFineRunId_fkey";
ALTER TABLE IF EXISTS "LateFineRunItem" DROP CONSTRAINT IF EXISTS "LateFineRunItem_parentId_fkey";
ALTER TABLE IF EXISTS "LateFineRunItem" DROP CONSTRAINT IF EXISTS "LateFineRunItem_schoolId_fkey";
ALTER TABLE IF EXISTS "LearnerBillingPlan" DROP CONSTRAINT IF EXISTS "LearnerBillingPlan_learnerId_fkey";
ALTER TABLE IF EXISTS "LearnerBillingPlan" DROP CONSTRAINT IF EXISTS "LearnerBillingPlan_schoolId_fkey";
ALTER TABLE IF EXISTS "LearnerBillingPlanItem" DROP CONSTRAINT IF EXISTS "LearnerBillingPlanItem_billingPlanId_fkey";
ALTER TABLE IF EXISTS "LearnerBillingPlanItem" DROP CONSTRAINT IF EXISTS "LearnerBillingPlanItem_feeStructureId_fkey";
ALTER TABLE IF EXISTS "LearnerBillingPlanItem" DROP CONSTRAINT IF EXISTS "LearnerBillingPlanItem_schoolId_fkey";
ALTER TABLE IF EXISTS "MessageReply" DROP CONSTRAINT IF EXISTS "MessageReply_threadId_fkey";
ALTER TABLE IF EXISTS "MessageThread" DROP CONSTRAINT IF EXISTS "MessageThread_learnerId_fkey";
ALTER TABLE IF EXISTS "MessageThread" DROP CONSTRAINT IF EXISTS "MessageThread_parentId_fkey";
ALTER TABLE IF EXISTS "MessageThread" DROP CONSTRAINT IF EXISTS "MessageThread_schoolId_fkey";
ALTER TABLE IF EXISTS "MessageThread" DROP CONSTRAINT IF EXISTS "MessageThread_teacherId_fkey";
ALTER TABLE IF EXISTS "Notice" DROP CONSTRAINT IF EXISTS "Notice_schoolId_fkey";
ALTER TABLE IF EXISTS "ParentUser" DROP CONSTRAINT IF EXISTS "ParentUser_parentId_fkey";
ALTER TABLE IF EXISTS "Payment" DROP CONSTRAINT IF EXISTS "Payment_parentId_fkey";
ALTER TABLE IF EXISTS "Payment" DROP CONSTRAINT IF EXISTS "Payment_schoolId_fkey";
ALTER TABLE IF EXISTS "Project" DROP CONSTRAINT IF EXISTS "Project_schoolId_fkey";
ALTER TABLE IF EXISTS "SchoolEmailSettings" DROP CONSTRAINT IF EXISTS "SchoolEmailSettings_schoolId_fkey";
ALTER TABLE IF EXISTS "TuckshopMenu" DROP CONSTRAINT IF EXISTS "TuckshopMenu_schoolId_fkey";

-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS     "fullName" TEXT;

-- DropTable (production-safe: IF EXISTS — no data loss when tables already absent)
DROP TABLE IF EXISTS "BillingDocumentRunItem";
DROP TABLE IF EXISTS "BillingDocumentRun";
DROP TABLE IF EXISTS "Homework";
DROP TABLE IF EXISTS "InvoiceLine";
DROP TABLE IF EXISTS "Invoice";
DROP TABLE IF EXISTS "InvoiceRun";
DROP TABLE IF EXISTS "LateFineRunItem";
DROP TABLE IF EXISTS "LateFineRun";
DROP TABLE IF EXISTS "LearnerBillingPlanItem";
DROP TABLE IF EXISTS "LearnerBillingPlan";
DROP TABLE IF EXISTS "MessageReply";
DROP TABLE IF EXISTS "MessageThread";
DROP TABLE IF EXISTS "Notice";
DROP TABLE IF EXISTS "ParentUser";
DROP TABLE IF EXISTS "Payment";
DROP TABLE IF EXISTS "Project";
DROP TABLE IF EXISTS "SchoolEmailSettings";
DROP TABLE IF EXISTS "TuckshopMenu";

-- CreateTable
CREATE TABLE IF NOT EXISTS "Classroom" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "minAgeMonths" INTEGER,
    "maxAgeMonths" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "teacherEmail" TEXT NOT NULL DEFAULT '',
    "teacherName" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "Classroom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "HomeworkPost" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "learnerId" TEXT,
    "grade" TEXT,
    "className" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "dueDate" TIMESTAMP(3),
    "attachments" JSONB,
    "createdBy" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HomeworkPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "LearnerIncident" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'General',
    "subject" TEXT NOT NULL DEFAULT 'General',
    "summary" TEXT NOT NULL,
    "parentVisible" BOOLEAN NOT NULL DEFAULT true,
    "internalNotes" TEXT,
    "incidentDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearnerIncident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "LearnerReport" (
    "id" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "overallAverage" DOUBLE PRECISION,
    "attendancePercent" DOUBLE PRECISION,
    "classTeacherRemark" TEXT,
    "principalRemark" TEXT,
    "pdfUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearnerReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "LearnerResult" (
    "id" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "classroomId" TEXT,
    "term" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "mark" DOUBLE PRECISION NOT NULL,
    "percentage" DOUBLE PRECISION,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearnerResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ParentDocument" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "grade" TEXT,
    "className" TEXT,
    "learnerId" TEXT,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParentDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ParentNotification" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "parentId" TEXT NOT NULL,
    "learnerId" TEXT,
    "type" "ParentNotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParentNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ParentOnboarding" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "parentId" TEXT NOT NULL,
    "status" "ParentOnboardingStatus" NOT NULL DEFAULT 'INVITED',
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openedAt" TIMESTAMP(3),
    "registeredAt" TIMESTAMP(3),
    "linkedAt" TIMESTAMP(3),
    "activeAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ParentOnboarding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ParentOutreachQueue" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "parentId" TEXT NOT NULL,
    "channel" "ParentOutreachChannel" NOT NULL,
    "recipient" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "status" "ParentOutreachStatus" NOT NULL DEFAULT 'QUEUED',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "ParentOutreachQueue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ParentTeacherMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "senderType" "ParentMessageSenderType" NOT NULL,
    "senderName" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL,
    "attachments" JSONB,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParentTeacherMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ParentTeacherThread" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "parentId" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "classroomId" TEXT,
    "teacherId" TEXT,
    "teacherName" TEXT NOT NULL DEFAULT '',
    "teacherEmail" TEXT NOT NULL DEFAULT '',
    "status" "ParentTeacherThreadStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ParentTeacherThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "SchoolNotice" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "noticeType" "SchoolNoticeType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "grade" TEXT,
    "className" TEXT,
    "learnerId" TEXT,
    "attachments" JSONB,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolNotice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Classroom_schoolId_idx" ON "Classroom"("schoolId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Classroom_schoolId_name_key" ON "Classroom"("schoolId" ASC, "name" ASC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "HomeworkPost_learnerId_idx" ON "HomeworkPost"("learnerId" ASC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "HomeworkPost_schoolId_className_idx" ON "HomeworkPost"("schoolId" ASC, "className" ASC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "HomeworkPost_schoolId_grade_idx" ON "HomeworkPost"("schoolId" ASC, "grade" ASC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LearnerIncident_learnerId_idx" ON "LearnerIncident"("learnerId" ASC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LearnerIncident_schoolId_learnerId_idx" ON "LearnerIncident"("schoolId" ASC, "learnerId" ASC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ParentDocument_schoolId_grade_idx" ON "ParentDocument"("schoolId" ASC, "grade" ASC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ParentDocument_schoolId_idx" ON "ParentDocument"("schoolId" ASC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ParentNotification_parentId_createdAt_idx" ON "ParentNotification"("parentId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ParentNotification_schoolId_parentId_idx" ON "ParentNotification"("schoolId" ASC, "parentId" ASC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ParentNotification_schoolId_parentId_isRead_idx" ON "ParentNotification"("schoolId" ASC, "parentId" ASC, "isRead" ASC);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ParentOnboarding_parentId_key" ON "ParentOnboarding"("parentId" ASC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ParentOnboarding_schoolId_status_idx" ON "ParentOnboarding"("schoolId" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ParentOutreachQueue_parentId_idx" ON "ParentOutreachQueue"("parentId" ASC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ParentOutreachQueue_schoolId_status_idx" ON "ParentOutreachQueue"("schoolId" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ParentTeacherMessage_schoolId_idx" ON "ParentTeacherMessage"("schoolId" ASC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ParentTeacherMessage_threadId_createdAt_idx" ON "ParentTeacherMessage"("threadId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ParentTeacherThread_learnerId_idx" ON "ParentTeacherThread"("learnerId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ParentTeacherThread_schoolId_parentId_learnerId_key" ON "ParentTeacherThread"("schoolId" ASC, "parentId" ASC, "learnerId" ASC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ParentTeacherThread_schoolId_teacherEmail_idx" ON "ParentTeacherThread"("schoolId" ASC, "teacherEmail" ASC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SchoolNotice_schoolId_className_idx" ON "SchoolNotice"("schoolId" ASC, "className" ASC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SchoolNotice_schoolId_grade_idx" ON "SchoolNotice"("schoolId" ASC, "grade" ASC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SchoolNotice_schoolId_noticeType_idx" ON "SchoolNotice"("schoolId" ASC, "noticeType" ASC);

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Classroom_schoolId_fkey') THEN
    ALTER TABLE "Classroom" ADD CONSTRAINT "Classroom_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HomeworkPost_learnerId_fkey') THEN
    ALTER TABLE "HomeworkPost" ADD CONSTRAINT "HomeworkPost_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "Learner"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HomeworkPost_schoolId_fkey') THEN
    ALTER TABLE "HomeworkPost" ADD CONSTRAINT "HomeworkPost_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LearnerIncident_learnerId_fkey') THEN
    ALTER TABLE "LearnerIncident" ADD CONSTRAINT "LearnerIncident_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "Learner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LearnerIncident_schoolId_fkey') THEN
    ALTER TABLE "LearnerIncident" ADD CONSTRAINT "LearnerIncident_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LearnerReport_learnerId_fkey') THEN
    ALTER TABLE "LearnerReport" ADD CONSTRAINT "LearnerReport_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "Learner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LearnerReport_schoolId_fkey') THEN
    ALTER TABLE "LearnerReport" ADD CONSTRAINT "LearnerReport_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LearnerResult_learnerId_fkey') THEN
    ALTER TABLE "LearnerResult" ADD CONSTRAINT "LearnerResult_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "Learner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LearnerResult_schoolId_fkey') THEN
    ALTER TABLE "LearnerResult" ADD CONSTRAINT "LearnerResult_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ParentDocument_schoolId_fkey') THEN
    ALTER TABLE "ParentDocument" ADD CONSTRAINT "ParentDocument_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ParentNotification_learnerId_fkey') THEN
    ALTER TABLE "ParentNotification" ADD CONSTRAINT "ParentNotification_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "Learner"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ParentNotification_parentId_fkey') THEN
    ALTER TABLE "ParentNotification" ADD CONSTRAINT "ParentNotification_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Parent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ParentNotification_schoolId_fkey') THEN
    ALTER TABLE "ParentNotification" ADD CONSTRAINT "ParentNotification_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ParentOnboarding_parentId_fkey') THEN
    ALTER TABLE "ParentOnboarding" ADD CONSTRAINT "ParentOnboarding_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Parent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ParentOnboarding_schoolId_fkey') THEN
    ALTER TABLE "ParentOnboarding" ADD CONSTRAINT "ParentOnboarding_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ParentOutreachQueue_parentId_fkey') THEN
    ALTER TABLE "ParentOutreachQueue" ADD CONSTRAINT "ParentOutreachQueue_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Parent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ParentOutreachQueue_schoolId_fkey') THEN
    ALTER TABLE "ParentOutreachQueue" ADD CONSTRAINT "ParentOutreachQueue_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ParentTeacherMessage_threadId_fkey') THEN
    ALTER TABLE "ParentTeacherMessage" ADD CONSTRAINT "ParentTeacherMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "ParentTeacherThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ParentTeacherThread_classroomId_fkey') THEN
    ALTER TABLE "ParentTeacherThread" ADD CONSTRAINT "ParentTeacherThread_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ParentTeacherThread_learnerId_fkey') THEN
    ALTER TABLE "ParentTeacherThread" ADD CONSTRAINT "ParentTeacherThread_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "Learner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ParentTeacherThread_parentId_fkey') THEN
    ALTER TABLE "ParentTeacherThread" ADD CONSTRAINT "ParentTeacherThread_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Parent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ParentTeacherThread_schoolId_fkey') THEN
    ALTER TABLE "ParentTeacherThread" ADD CONSTRAINT "ParentTeacherThread_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SchoolNotice_schoolId_fkey') THEN
    ALTER TABLE "SchoolNotice" ADD CONSTRAINT "SchoolNotice_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Deferred from 20260520083305_communication_engine (ParentNotification did not exist yet)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommunicationMessage_parentNotificationId_fkey') THEN
    ALTER TABLE "CommunicationMessage" ADD CONSTRAINT "CommunicationMessage_parentNotificationId_fkey" FOREIGN KEY ("parentNotificationId") REFERENCES "ParentNotification"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
