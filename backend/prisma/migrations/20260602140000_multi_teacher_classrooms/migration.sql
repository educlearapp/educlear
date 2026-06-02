-- Multi-teacher classroom assignments and teacher content visibility

CREATE TYPE "ClassroomTeacherRole" AS ENUM ('PRIMARY', 'CO_TEACHER', 'ASSISTANT');
CREATE TYPE "TeacherContentVisibility" AS ENUM ('PRIVATE', 'CLASS_TEACHERS', 'ADMIN');

CREATE TABLE "ClassroomTeacher" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "classroomId" TEXT NOT NULL,
    "userId" TEXT,
    "teacherEmail" TEXT NOT NULL DEFAULT '',
    "teacherName" TEXT NOT NULL DEFAULT '',
    "role" "ClassroomTeacherRole" NOT NULL DEFAULT 'CO_TEACHER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClassroomTeacher_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClassroomTeacher_classroomId_teacherEmail_key" ON "ClassroomTeacher"("classroomId", "teacherEmail");
CREATE INDEX "ClassroomTeacher_schoolId_idx" ON "ClassroomTeacher"("schoolId");
CREATE INDEX "ClassroomTeacher_classroomId_idx" ON "ClassroomTeacher"("classroomId");
CREATE INDEX "ClassroomTeacher_userId_idx" ON "ClassroomTeacher"("userId");
CREATE INDEX "ClassroomTeacher_teacherEmail_idx" ON "ClassroomTeacher"("teacherEmail");

ALTER TABLE "ClassroomTeacher" ADD CONSTRAINT "ClassroomTeacher_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClassroomTeacher" ADD CONSTRAINT "ClassroomTeacher_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClassroomTeacher" ADD CONSTRAINT "ClassroomTeacher_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ParentTeacherThread" ADD COLUMN "assignedTeacherId" TEXT;
CREATE INDEX "ParentTeacherThread_schoolId_assignedTeacherId_idx" ON "ParentTeacherThread"("schoolId", "assignedTeacherId");

ALTER TABLE "HomeworkPost" ADD COLUMN "createdByTeacherId" TEXT;
ALTER TABLE "HomeworkPost" ADD COLUMN "visibility" "TeacherContentVisibility" NOT NULL DEFAULT 'CLASS_TEACHERS';
ALTER TABLE "HomeworkPost" ADD COLUMN "isDraft" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "HomeworkPost_schoolId_createdByTeacherId_idx" ON "HomeworkPost"("schoolId", "createdByTeacherId");

ALTER TABLE "SchoolNotice" ADD COLUMN "createdByTeacherId" TEXT;
ALTER TABLE "SchoolNotice" ADD COLUMN "visibility" "TeacherContentVisibility" NOT NULL DEFAULT 'CLASS_TEACHERS';
ALTER TABLE "SchoolNotice" ADD COLUMN "isDraft" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "SchoolNotice_schoolId_createdByTeacherId_idx" ON "SchoolNotice"("schoolId", "createdByTeacherId");

ALTER TABLE "ParentDocument" ADD COLUMN "createdBy" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ParentDocument" ADD COLUMN "createdByTeacherId" TEXT;
ALTER TABLE "ParentDocument" ADD COLUMN "visibility" "TeacherContentVisibility" NOT NULL DEFAULT 'CLASS_TEACHERS';
CREATE INDEX "ParentDocument_schoolId_createdByTeacherId_idx" ON "ParentDocument"("schoolId", "createdByTeacherId");

ALTER TABLE "LearnerIncident" ADD COLUMN "createdByTeacherId" TEXT;
ALTER TABLE "LearnerIncident" ADD COLUMN "visibility" "TeacherContentVisibility" NOT NULL DEFAULT 'CLASS_TEACHERS';
CREATE INDEX "LearnerIncident_schoolId_createdByTeacherId_idx" ON "LearnerIncident"("schoolId", "createdByTeacherId");

CREATE TABLE "TeacherLearnerNote" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "classroomId" TEXT,
    "className" TEXT,
    "body" TEXT NOT NULL,
    "createdByTeacherId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL DEFAULT '',
    "visibility" "TeacherContentVisibility" NOT NULL DEFAULT 'PRIVATE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeacherLearnerNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TeacherLearnerNote_schoolId_learnerId_idx" ON "TeacherLearnerNote"("schoolId", "learnerId");
CREATE INDEX "TeacherLearnerNote_schoolId_createdByTeacherId_idx" ON "TeacherLearnerNote"("schoolId", "createdByTeacherId");
CREATE INDEX "TeacherLearnerNote_learnerId_idx" ON "TeacherLearnerNote"("learnerId");

ALTER TABLE "TeacherLearnerNote" ADD CONSTRAINT "TeacherLearnerNote_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeacherLearnerNote" ADD CONSTRAINT "TeacherLearnerNote_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "Learner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "TeacherStudyNote" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "className" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdByTeacherId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL DEFAULT '',
    "visibility" "TeacherContentVisibility" NOT NULL DEFAULT 'PRIVATE',
    "isDraft" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeacherStudyNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TeacherStudyNote_schoolId_className_idx" ON "TeacherStudyNote"("schoolId", "className");
CREATE INDEX "TeacherStudyNote_schoolId_createdByTeacherId_idx" ON "TeacherStudyNote"("schoolId", "createdByTeacherId");

ALTER TABLE "TeacherStudyNote" ADD CONSTRAINT "TeacherStudyNote_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill primary teacher assignments from legacy classroom.teacherEmail
INSERT INTO "ClassroomTeacher" ("id", "schoolId", "classroomId", "userId", "teacherEmail", "teacherName", "role", "createdAt", "updatedAt")
SELECT
    md5(c."id" || ':' || lower(trim(c."teacherEmail"))) || substr(md5(random()::text), 1, 8),
    c."schoolId",
    c."id",
    u."id",
    lower(trim(c."teacherEmail")),
    COALESCE(NULLIF(trim(c."teacherName"), ''), 'Class Teacher'),
    'PRIMARY'::"ClassroomTeacherRole",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "Classroom" c
LEFT JOIN "User" u ON u."schoolId" = c."schoolId" AND lower(trim(u."email")) = lower(trim(c."teacherEmail"))
WHERE trim(c."teacherEmail") <> ''
ON CONFLICT ("classroomId", "teacherEmail") DO NOTHING;

-- Backfill assignedTeacherId on parent threads from primary teacher user
UPDATE "ParentTeacherThread" t
SET "assignedTeacherId" = ct."userId"
FROM "ClassroomTeacher" ct
WHERE t."classroomId" = ct."classroomId"
  AND ct."role" = 'PRIMARY'
  AND ct."userId" IS NOT NULL
  AND t."assignedTeacherId" IS NULL;
