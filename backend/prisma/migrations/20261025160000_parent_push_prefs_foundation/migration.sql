-- Phase 4A: extend PushSubscription + parent notification preferences + delivery ledger (no live send)

ALTER TABLE "PushSubscription" ADD COLUMN IF NOT EXISTS "deviceLabel" TEXT;
ALTER TABLE "PushSubscription" ADD COLUMN IF NOT EXISTS "enabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "PushSubscription" ADD COLUMN IF NOT EXISTS "lastSeenAt" TIMESTAMP(3);
ALTER TABLE "PushSubscription" ADD COLUMN IF NOT EXISTS "lastSuccessAt" TIMESTAMP(3);
ALTER TABLE "PushSubscription" ADD COLUMN IF NOT EXISTS "failCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PushSubscription" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "PushSubscription_schoolId_parentId_enabled_idx" ON "PushSubscription"("schoolId", "parentId", "enabled");

CREATE TABLE IF NOT EXISTS "ParentNotificationPreference" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "parentId" TEXT NOT NULL,
    "pushEnabled" BOOLEAN NOT NULL DEFAULT false,
    "pushTeacherMessages" BOOLEAN NOT NULL DEFAULT true,
    "pushAnnouncements" BOOLEAN NOT NULL DEFAULT true,
    "pushEvents" BOOLEAN NOT NULL DEFAULT true,
    "soundEnabled" BOOLEAN NOT NULL DEFAULT false,
    "quietHoursStart" TEXT,
    "quietHoursEnd" TEXT,
    "lockScreenPreview" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParentNotificationPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ParentNotificationPreference_parentId_key" ON "ParentNotificationPreference"("parentId");
CREATE INDEX IF NOT EXISTS "ParentNotificationPreference_schoolId_idx" ON "ParentNotificationPreference"("schoolId");

ALTER TABLE "ParentNotificationPreference" DROP CONSTRAINT IF EXISTS "ParentNotificationPreference_schoolId_fkey";
ALTER TABLE "ParentNotificationPreference" ADD CONSTRAINT "ParentNotificationPreference_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ParentNotificationPreference" DROP CONSTRAINT IF EXISTS "ParentNotificationPreference_parentId_fkey";
ALTER TABLE "ParentNotificationPreference" ADD CONSTRAINT "ParentNotificationPreference_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Parent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "ParentPushDelivery" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "parentNotificationId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attemptedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParentPushDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ParentPushDelivery_parentNotificationId_subscriptionId_key" ON "ParentPushDelivery"("parentNotificationId", "subscriptionId");
CREATE INDEX IF NOT EXISTS "ParentPushDelivery_schoolId_status_idx" ON "ParentPushDelivery"("schoolId", "status");
CREATE INDEX IF NOT EXISTS "ParentPushDelivery_subscriptionId_idx" ON "ParentPushDelivery"("subscriptionId");

ALTER TABLE "ParentPushDelivery" DROP CONSTRAINT IF EXISTS "ParentPushDelivery_subscriptionId_fkey";
ALTER TABLE "ParentPushDelivery" ADD CONSTRAINT "ParentPushDelivery_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "PushSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
