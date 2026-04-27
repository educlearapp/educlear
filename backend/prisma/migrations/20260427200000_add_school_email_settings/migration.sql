-- CreateTable
CREATE TABLE "SchoolEmailSettings" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "provider" TEXT,
    "smtpHost" TEXT NOT NULL,
    "smtpPort" INTEGER NOT NULL DEFAULT 587,
    "smtpSecure" BOOLEAN NOT NULL DEFAULT false,
    "smtpUser" TEXT NOT NULL,
    "smtpPass" TEXT NOT NULL,
    "smtpFrom" TEXT,
    "replyTo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolEmailSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SchoolEmailSettings_schoolId_key" ON "SchoolEmailSettings"("schoolId");

-- AddForeignKey
ALTER TABLE "SchoolEmailSettings" ADD CONSTRAINT "SchoolEmailSettings_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

