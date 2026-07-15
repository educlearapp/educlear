-- CreateEnum
CREATE TYPE "HomeSafeEventType" AS ENUM ('DISMISSED');

-- CreateEnum
CREATE TYPE "HomeSafeCollectionMethod" AS ENUM ('PARENT', 'TRANSPORT');

-- CreateTable
CREATE TABLE "HomeSafeEvent" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "eventType" "HomeSafeEventType" NOT NULL DEFAULT 'DISMISSED',
    "collectionMethod" "HomeSafeCollectionMethod" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "schoolLocalDate" TEXT NOT NULL,
    "schoolLocalTime" TEXT NOT NULL,
    "learnerNameSnapshot" TEXT NOT NULL,
    "classroomSnapshot" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomeSafeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HomeSafeEvent_schoolId_learnerId_schoolLocalDate_key" ON "HomeSafeEvent"("schoolId", "learnerId", "schoolLocalDate");

-- CreateIndex
CREATE INDEX "HomeSafeEvent_schoolId_schoolLocalDate_idx" ON "HomeSafeEvent"("schoolId", "schoolLocalDate");

-- CreateIndex
CREATE INDEX "HomeSafeEvent_schoolId_learnerId_idx" ON "HomeSafeEvent"("schoolId", "learnerId");

-- CreateIndex
CREATE INDEX "HomeSafeEvent_teacherId_idx" ON "HomeSafeEvent"("teacherId");

-- AddForeignKey
ALTER TABLE "HomeSafeEvent" ADD CONSTRAINT "HomeSafeEvent_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HomeSafeEvent" ADD CONSTRAINT "HomeSafeEvent_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "Learner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HomeSafeEvent" ADD CONSTRAINT "HomeSafeEvent_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
