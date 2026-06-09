-- AlterTable
ALTER TABLE "LearnerAttendance" ADD COLUMN "period" TEXT NOT NULL DEFAULT 'DAILY';

-- DropIndex
DROP INDEX "LearnerAttendance_schoolId_learnerId_date_key";

-- DropIndex
DROP INDEX "LearnerAttendance_schoolId_className_date_idx";

-- CreateIndex
CREATE UNIQUE INDEX "LearnerAttendance_schoolId_learnerId_date_period_key" ON "LearnerAttendance"("schoolId", "learnerId", "date", "period");

-- CreateIndex
CREATE INDEX "LearnerAttendance_schoolId_className_date_period_idx" ON "LearnerAttendance"("schoolId", "className", "date", "period");
