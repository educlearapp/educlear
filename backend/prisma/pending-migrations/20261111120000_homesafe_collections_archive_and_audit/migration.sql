-- PENDING / NOT APPLIED — additive only. Owner approval required before prisma migrate.
-- Soft-delete/archive + optional mutation audit for HomeSafe Collections V2.

ALTER TABLE "HomeSafeCollectionGroup"
  ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastMutatedByUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "lastMutatedAt" TIMESTAMP(3);

ALTER TABLE "HomeSafeCollectionSession"
  ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastMutatedByUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "lastMutatedAt" TIMESTAMP(3);

ALTER TABLE "HomeSafeCollectionRegisterRow"
  ADD COLUMN IF NOT EXISTS "lastMutatedByUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "lastMutatedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "HomeSafeCollectionGroup_schoolId_archivedAt_idx"
  ON "HomeSafeCollectionGroup"("schoolId", "archivedAt");

CREATE INDEX IF NOT EXISTS "HomeSafeCollectionSession_schoolId_archivedAt_idx"
  ON "HomeSafeCollectionSession"("schoolId", "archivedAt");
