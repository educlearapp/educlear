-- CreateTable
CREATE TABLE "SchoolSmsSettings" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'WinSMS',
    "apiKeyEncrypted" TEXT NOT NULL DEFAULT '',
    "connectionStatus" TEXT NOT NULL DEFAULT 'not_configured',
    "creditBalance" DOUBLE PRECISION,
    "creditBalanceCheckedAt" TIMESTAMP(3),
    "connectionTestedAt" TIMESTAMP(3),
    "lastConnectionError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolSmsSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SchoolSmsSettings_schoolId_key" ON "SchoolSmsSettings"("schoolId");

-- AddForeignKey
ALTER TABLE "SchoolSmsSettings" ADD CONSTRAINT "SchoolSmsSettings_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
