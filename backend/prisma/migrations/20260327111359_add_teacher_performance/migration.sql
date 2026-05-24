-- CreateTable
CREATE TABLE IF NOT EXISTS "TeacherPerformance" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "teacherName" TEXT NOT NULL,
    "teacherEmail" TEXT,
    "month" TEXT NOT NULL,
    "learnerResults" DOUBLE PRECISION NOT NULL,
    "classroomManagement" DOUBLE PRECISION NOT NULL,
    "teachingQuality" DOUBLE PRECISION NOT NULL,
    "administration" DOUBLE PRECISION NOT NULL,
    "professionalConduct" DOUBLE PRECISION NOT NULL,
    "finalScore" DOUBLE PRECISION NOT NULL,
    "performanceLevel" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeacherPerformance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TeacherPerformance_schoolId_idx" ON "TeacherPerformance"("schoolId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TeacherPerformance_month_idx" ON "TeacherPerformance"("month");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TeacherPerformance_schoolId_fkey') THEN
    ALTER TABLE "TeacherPerformance" ADD CONSTRAINT "TeacherPerformance_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
