-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "UserRole" AS ENUM ('SCHOOL_ADMIN', 'FINANCE', 'STAFF');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "School" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "School_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "User" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'SCHOOL_ADMIN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Parent" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "email" TEXT,
    "identityHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Parent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Learner" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "grade" TEXT NOT NULL,
    "className" TEXT,
    "admissionNo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Learner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ParentLearnerLink" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "parentId" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "relation" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ParentLearnerLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "School_email_key" ON "School"("email");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "User_schoolId_idx" ON "User"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "User_schoolId_email_key" ON "User"("schoolId", "email");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Parent_schoolId_idx" ON "Parent"("schoolId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Parent_schoolId_mobile_idx" ON "Parent"("schoolId", "mobile");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Learner_schoolId_idx" ON "Learner"("schoolId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Learner_schoolId_grade_idx" ON "Learner"("schoolId", "grade");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Learner_schoolId_admissionNo_key" ON "Learner"("schoolId", "admissionNo");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ParentLearnerLink_schoolId_idx" ON "ParentLearnerLink"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ParentLearnerLink_parentId_learnerId_key" ON "ParentLearnerLink"("parentId", "learnerId");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'User_schoolId_fkey') THEN
    ALTER TABLE "User" ADD CONSTRAINT "User_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Parent_schoolId_fkey') THEN
    ALTER TABLE "Parent" ADD CONSTRAINT "Parent_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Learner_schoolId_fkey') THEN
    ALTER TABLE "Learner" ADD CONSTRAINT "Learner_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ParentLearnerLink_parentId_fkey') THEN
    ALTER TABLE "ParentLearnerLink" ADD CONSTRAINT "ParentLearnerLink_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Parent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ParentLearnerLink_learnerId_fkey') THEN
    ALTER TABLE "ParentLearnerLink" ADD CONSTRAINT "ParentLearnerLink_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "Learner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
