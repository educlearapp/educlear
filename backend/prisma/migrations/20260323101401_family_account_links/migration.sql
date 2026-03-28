-- AlterTable
ALTER TABLE "Learner" ADD COLUMN     "familyAccountId" TEXT;

-- AlterTable
ALTER TABLE "Parent" ADD COLUMN     "familyAccountId" TEXT;

-- CreateTable
CREATE TABLE "FamilyAccount" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "accountRef" TEXT NOT NULL,
    "familyName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FamilyAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FamilyAccount_accountRef_key" ON "FamilyAccount"("accountRef");

-- CreateIndex
CREATE INDEX "FamilyAccount_schoolId_idx" ON "FamilyAccount"("schoolId");

-- CreateIndex
CREATE INDEX "FamilyAccount_schoolId_familyName_idx" ON "FamilyAccount"("schoolId", "familyName");

-- AddForeignKey
ALTER TABLE "Parent" ADD CONSTRAINT "Parent_familyAccountId_fkey" FOREIGN KEY ("familyAccountId") REFERENCES "FamilyAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FamilyAccount" ADD CONSTRAINT "FamilyAccount_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Learner" ADD CONSTRAINT "Learner_familyAccountId_fkey" FOREIGN KEY ("familyAccountId") REFERENCES "FamilyAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
