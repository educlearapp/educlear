-- CreateEnum
CREATE TYPE "SchoolEventLifecycle" AS ENUM ('DRAFT', 'PUBLISHED', 'CANCELLED', 'ARCHIVED');

-- AlterEnum ParentNotificationType (additive; ignore if already present)
DO $$ BEGIN
  ALTER TYPE "ParentNotificationType" ADD VALUE 'SCHOOL_EVENT';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "SchoolEvent" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "grade" TEXT,
    "className" TEXT,
    "learnerId" TEXT,
    "createdBy" TEXT NOT NULL DEFAULT '',
    "createdByTeacherId" TEXT,
    "lifecycleStatus" "SchoolEventLifecycle" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "archivedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SchoolEventAuditLog" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorEmail" TEXT NOT NULL DEFAULT '',
    "action" TEXT NOT NULL,
    "previousLifecycle" TEXT,
    "newLifecycle" TEXT,
    "previousTargeting" JSONB,
    "newTargeting" JSONB,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolEventAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SchoolEvent_schoolId_lifecycleStatus_startsAt_idx" ON "SchoolEvent"("schoolId", "lifecycleStatus", "startsAt");
CREATE INDEX IF NOT EXISTS "SchoolEvent_schoolId_startsAt_id_idx" ON "SchoolEvent"("schoolId", "startsAt", "id");
CREATE INDEX IF NOT EXISTS "SchoolEvent_schoolId_grade_idx" ON "SchoolEvent"("schoolId", "grade");
CREATE INDEX IF NOT EXISTS "SchoolEvent_schoolId_className_idx" ON "SchoolEvent"("schoolId", "className");
CREATE INDEX IF NOT EXISTS "SchoolEvent_schoolId_learnerId_idx" ON "SchoolEvent"("schoolId", "learnerId");
CREATE INDEX IF NOT EXISTS "SchoolEvent_schoolId_createdByTeacherId_idx" ON "SchoolEvent"("schoolId", "createdByTeacherId");
CREATE INDEX IF NOT EXISTS "SchoolEventAuditLog_schoolId_eventId_createdAt_idx" ON "SchoolEventAuditLog"("schoolId", "eventId", "createdAt");
CREATE INDEX IF NOT EXISTS "SchoolEventAuditLog_schoolId_createdAt_idx" ON "SchoolEventAuditLog"("schoolId", "createdAt");

ALTER TABLE "SchoolEvent" ADD CONSTRAINT "SchoolEvent_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SchoolEventAuditLog" ADD CONSTRAINT "SchoolEventAuditLog_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SchoolEventAuditLog" ADD CONSTRAINT "SchoolEventAuditLog_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "SchoolEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
