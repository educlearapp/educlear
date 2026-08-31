-- Additive school organisation lifecycle. Separate from SchoolSubscription.status.
-- Existing School rows inherit DEFAULT ACTIVE. No other tables are modified.

CREATE TYPE "SchoolLifecycleStatus" AS ENUM ('ACTIVE', 'TRIAL', 'INACTIVE', 'ARCHIVED');

ALTER TABLE "School" ADD COLUMN "lifecycleStatus" "SchoolLifecycleStatus" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "School" ADD COLUMN "lifecycleChangedAt" TIMESTAMP(3);
ALTER TABLE "School" ADD COLUMN "lifecycleChangedByUserId" TEXT;
ALTER TABLE "School" ADD COLUMN "lifecycleChangedByEmail" TEXT;

CREATE INDEX "School_lifecycleStatus_idx" ON "School"("lifecycleStatus");
