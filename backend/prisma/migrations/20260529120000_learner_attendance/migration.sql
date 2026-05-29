-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'LATE', 'EXCUSED');

-- CreateTable
CREATE TABLE "LearnerAttendance" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "className" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "arrivedAt" TEXT,
    "leftAt" TEXT,
    "reason" TEXT,
    "createdBy" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearnerAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LearnerAttendance_schoolId_className_date_idx" ON "LearnerAttendance"("schoolId", "className", "date");

-- CreateIndex
CREATE INDEX "LearnerAttendance_schoolId_date_idx" ON "LearnerAttendance"("schoolId", "date");

-- CreateIndex
CREATE INDEX "LearnerAttendance_learnerId_idx" ON "LearnerAttendance"("learnerId");

-- CreateIndex
CREATE UNIQUE INDEX "LearnerAttendance_schoolId_learnerId_date_key" ON "LearnerAttendance"("schoolId", "learnerId", "date");

-- AddForeignKey
ALTER TABLE "LearnerAttendance" ADD CONSTRAINT "LearnerAttendance_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearnerAttendance" ADD CONSTRAINT "LearnerAttendance_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "Learner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
