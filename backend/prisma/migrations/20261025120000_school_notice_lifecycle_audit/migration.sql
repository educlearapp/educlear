-- CreateEnum
CREATE TYPE "SchoolNoticeLifecycle" AS ENUM ('DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED');

-- AlterTable SchoolNotice: additive lifecycle fields (backward compatible)
ALTER TABLE "SchoolNotice" ADD COLUMN IF NOT EXISTS "unpublishedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "lifecycleStatus" "SchoolNoticeLifecycle" NOT NULL DEFAULT 'PUBLISHED',
ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill lifecycle from legacy isDraft without changing visibility semantics
UPDATE "SchoolNotice" SET "lifecycleStatus" = 'DRAFT' WHERE "isDraft" = true;
UPDATE "SchoolNotice" SET "lifecycleStatus" = 'PUBLISHED', "isDraft" = false WHERE "isDraft" = false AND "lifecycleStatus" = 'PUBLISHED';

-- CreateTable
CREATE TABLE IF NOT EXISTS "SchoolNoticeAuditLog" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "noticeId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorEmail" TEXT NOT NULL DEFAULT '',
    "action" TEXT NOT NULL,
    "previousLifecycle" TEXT,
    "newLifecycle" TEXT,
    "previousTargeting" JSONB,
    "newTargeting" JSONB,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolNoticeAuditLog_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX IF NOT EXISTS "SchoolNotice_schoolId_lifecycleStatus_publishedAt_idx" ON "SchoolNotice"("schoolId", "lifecycleStatus", "publishedAt");
CREATE INDEX IF NOT EXISTS "SchoolNoticeAuditLog_schoolId_noticeId_createdAt_idx" ON "SchoolNoticeAuditLog"("schoolId", "noticeId", "createdAt");
CREATE INDEX IF NOT EXISTS "SchoolNoticeAuditLog_schoolId_createdAt_idx" ON "SchoolNoticeAuditLog"("schoolId", "createdAt");

-- FKs
ALTER TABLE "SchoolNoticeAuditLog" ADD CONSTRAINT "SchoolNoticeAuditLog_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SchoolNoticeAuditLog" ADD CONSTRAINT "SchoolNoticeAuditLog_noticeId_fkey" FOREIGN KEY ("noticeId") REFERENCES "SchoolNotice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
