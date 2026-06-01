-- CreateTable
CREATE TABLE IF NOT EXISTS "UserRbacMeta" (
    "userId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL DEFAULT '',
    "surname" TEXT NOT NULL DEFAULT '',
    "appRole" TEXT NOT NULL DEFAULT 'Viewer',
    "permissions" JSONB NOT NULL,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "UserRbacMeta_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "UserRbacMeta_schoolId_idx" ON "UserRbacMeta"("schoolId");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UserRbacMeta_userId_fkey') THEN
    ALTER TABLE "UserRbacMeta" ADD CONSTRAINT "UserRbacMeta_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
