-- CreateEnum
CREATE TYPE "LearnerEnrollmentStatus" AS ENUM ('ACTIVE', 'HISTORICAL');

-- AlterTable
ALTER TABLE "Learner" ADD COLUMN "enrollmentStatus" "LearnerEnrollmentStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateIndex
CREATE INDEX "Learner_schoolId_enrollmentStatus_idx" ON "Learner"("schoolId", "enrollmentStatus");
