-- Attendance session display mode + school subjects + classroom timetable slots
-- + nullable subject linkage on learner attendance (legacy-safe).

CREATE TYPE "AttendanceSessionDisplay" AS ENUM ('PERIODS', 'SUBJECTS');

ALTER TABLE "Classroom"
ADD COLUMN "attendanceSessionDisplay" "AttendanceSessionDisplay" NOT NULL DEFAULT 'PERIODS';

CREATE TABLE "SchoolSubject" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SchoolSubject_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClassroomSubjectSlot" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "classroomId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "subjectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ClassroomSubjectSlot_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "LearnerAttendance"
ADD COLUMN "subjectId" TEXT;

CREATE UNIQUE INDEX "SchoolSubject_schoolId_name_key" ON "SchoolSubject"("schoolId", "name");
CREATE INDEX "SchoolSubject_schoolId_active_sortOrder_idx" ON "SchoolSubject"("schoolId", "active", "sortOrder");

CREATE UNIQUE INDEX "ClassroomSubjectSlot_classroomId_dayOfWeek_sortOrder_key"
  ON "ClassroomSubjectSlot"("classroomId", "dayOfWeek", "sortOrder");
CREATE INDEX "ClassroomSubjectSlot_schoolId_classroomId_idx"
  ON "ClassroomSubjectSlot"("schoolId", "classroomId");
CREATE INDEX "ClassroomSubjectSlot_subjectId_idx" ON "ClassroomSubjectSlot"("subjectId");

CREATE INDEX "LearnerAttendance_subjectId_idx" ON "LearnerAttendance"("subjectId");

ALTER TABLE "SchoolSubject"
ADD CONSTRAINT "SchoolSubject_schoolId_fkey"
FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClassroomSubjectSlot"
ADD CONSTRAINT "ClassroomSubjectSlot_schoolId_fkey"
FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClassroomSubjectSlot"
ADD CONSTRAINT "ClassroomSubjectSlot_classroomId_fkey"
FOREIGN KEY ("classroomId") REFERENCES "Classroom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClassroomSubjectSlot"
ADD CONSTRAINT "ClassroomSubjectSlot_subjectId_fkey"
FOREIGN KEY ("subjectId") REFERENCES "SchoolSubject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LearnerAttendance"
ADD CONSTRAINT "LearnerAttendance_subjectId_fkey"
FOREIGN KEY ("subjectId") REFERENCES "SchoolSubject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
