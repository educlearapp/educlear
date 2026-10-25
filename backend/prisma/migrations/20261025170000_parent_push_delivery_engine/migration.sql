-- Phase 4B: extend ParentPushDelivery for claim/retry/quiet-hours and ownership

ALTER TABLE "ParentPushDelivery" ADD COLUMN IF NOT EXISTS "parentId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ParentPushDelivery" ADD COLUMN IF NOT EXISTS "externalSent" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ParentPushDelivery" ADD COLUMN IF NOT EXISTS "attemptCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ParentPushDelivery" ADD COLUMN IF NOT EXISTS "nextAttemptAt" TIMESTAMP(3);
ALTER TABLE "ParentPushDelivery" ADD COLUMN IF NOT EXISTS "claimedAt" TIMESTAMP(3);
ALTER TABLE "ParentPushDelivery" ADD COLUMN IF NOT EXISTS "claimedBy" TEXT;
ALTER TABLE "ParentPushDelivery" ADD COLUMN IF NOT EXISTS "sentAt" TIMESTAMP(3);
ALTER TABLE "ParentPushDelivery" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill parentId from subscription where possible
UPDATE "ParentPushDelivery" d
SET "parentId" = s."parentId"
FROM "PushSubscription" s
WHERE d."subscriptionId" = s."id" AND (d."parentId" IS NULL OR d."parentId" = '');

CREATE INDEX IF NOT EXISTS "ParentPushDelivery_schoolId_parentId_idx" ON "ParentPushDelivery"("schoolId", "parentId");
CREATE INDEX IF NOT EXISTS "ParentPushDelivery_status_nextAttemptAt_idx" ON "ParentPushDelivery"("status", "nextAttemptAt");
