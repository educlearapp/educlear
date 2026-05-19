-- CreateTable
CREATE TABLE "BillingSettings" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "settings" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillingSettings_schoolId_key" ON "BillingSettings"("schoolId");

-- CreateIndex
CREATE INDEX "BillingSettings_schoolId_idx" ON "BillingSettings"("schoolId");

-- AddForeignKey
ALTER TABLE "BillingSettings" ADD CONSTRAINT "BillingSettings_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
