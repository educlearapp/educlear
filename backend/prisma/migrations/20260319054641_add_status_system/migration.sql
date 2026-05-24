/*
  Warnings:

  - You are about to drop the column `fullName` on the `Parent` table. All the data in the column will be lost.
  - You are about to drop the column `identityHash` on the `Parent` table. All the data in the column will be lost.
  - You are about to drop the column `mobile` on the `Parent` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[idNumber]` on the table `Parent` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `cellNo` to the `Parent` table without a default value. This is not possible if the table is not empty.
  - Added the required column `firstName` to the `Parent` table without a default value. This is not possible if the table is not empty.
  - Added the required column `surname` to the `Parent` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "LetterType" AS ENUM ('DEMAND', 'SECTION_41');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "LetterStatus" AS ENUM ('DRAFT', 'GENERATED', 'SENT');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- DropIndex
DROP INDEX "Parent_schoolId_mobile_idx";

-- AlterTable
ALTER TABLE "Parent" DROP COLUMN "fullName",
DROP COLUMN "identityHash",
DROP COLUMN "mobile",
ADD COLUMN IF NOT EXISTS     "cellNo" TEXT NOT NULL,
ADD COLUMN IF NOT EXISTS     "communicationByEmail" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS     "communicationByPrint" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS     "communicationBySMS" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS     "faxNo" TEXT,
ADD COLUMN IF NOT EXISTS     "firstName" TEXT NOT NULL,
ADD COLUMN IF NOT EXISTS     "homeNo" TEXT,
ADD COLUMN IF NOT EXISTS     "idNumber" TEXT,
ADD COLUMN IF NOT EXISTS     "maritalStatus" TEXT,
ADD COLUMN IF NOT EXISTS     "nickname" TEXT,
ADD COLUMN IF NOT EXISTS     "notes" TEXT,
ADD COLUMN IF NOT EXISTS     "relationship" TEXT,
ADD COLUMN IF NOT EXISTS     "status" TEXT NOT NULL DEFAULT 'GREEN',
ADD COLUMN IF NOT EXISTS     "surname" TEXT NOT NULL,
ADD COLUMN IF NOT EXISTS     "title" TEXT,
ADD COLUMN IF NOT EXISTS     "workNo" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "SchoolFeeSetting" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "grade" TEXT NOT NULL,
    "monthlyFeeCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolFeeSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CompetitorSchool" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "province" TEXT,
    "city" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompetitorSchool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CompetitorFee" (
    "id" TEXT NOT NULL,
    "competitorSchoolId" TEXT NOT NULL,
    "grade" TEXT NOT NULL,
    "monthlyFeeCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompetitorFee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "LetterTemplate" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "type" "LetterType" NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LetterTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Letter" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "type" "LetterType" NOT NULL,
    "status" "LetterStatus" NOT NULL DEFAULT 'DRAFT',
    "parentId" TEXT NOT NULL,
    "learnerId" TEXT,
    "amountCents" INTEGER,
    "dueDate" TIMESTAMP(3),
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "Letter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SchoolFeeSetting_schoolId_idx" ON "SchoolFeeSetting"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "SchoolFeeSetting_schoolId_grade_key" ON "SchoolFeeSetting"("schoolId", "grade");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CompetitorFee_competitorSchoolId_idx" ON "CompetitorFee"("competitorSchoolId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CompetitorFee_grade_idx" ON "CompetitorFee"("grade");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LetterTemplate_schoolId_type_idx" ON "LetterTemplate"("schoolId", "type");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Letter_schoolId_type_idx" ON "Letter"("schoolId", "type");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Letter_parentId_idx" ON "Letter"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Parent_idNumber_key" ON "Parent"("idNumber");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Parent_schoolId_cellNo_idx" ON "Parent"("schoolId", "cellNo");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SchoolFeeSetting_schoolId_fkey') THEN
    ALTER TABLE "SchoolFeeSetting" ADD CONSTRAINT "SchoolFeeSetting_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CompetitorFee_competitorSchoolId_fkey') THEN
    ALTER TABLE "CompetitorFee" ADD CONSTRAINT "CompetitorFee_competitorSchoolId_fkey" FOREIGN KEY ("competitorSchoolId") REFERENCES "CompetitorSchool"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LetterTemplate_schoolId_fkey') THEN
    ALTER TABLE "LetterTemplate" ADD CONSTRAINT "LetterTemplate_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Letter_schoolId_fkey') THEN
    ALTER TABLE "Letter" ADD CONSTRAINT "Letter_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Letter_parentId_fkey') THEN
    ALTER TABLE "Letter" ADD CONSTRAINT "Letter_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Parent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Letter_learnerId_fkey') THEN
    ALTER TABLE "Letter" ADD CONSTRAINT "Letter_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "Learner"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
