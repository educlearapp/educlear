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
CREATE TYPE "LetterType" AS ENUM ('DEMAND', 'SECTION_41');

-- CreateEnum
CREATE TYPE "LetterStatus" AS ENUM ('DRAFT', 'GENERATED', 'SENT');

-- DropIndex
DROP INDEX "Parent_schoolId_mobile_idx";

-- AlterTable
ALTER TABLE "Parent" DROP COLUMN "fullName",
DROP COLUMN "identityHash",
DROP COLUMN "mobile",
ADD COLUMN     "cellNo" TEXT NOT NULL,
ADD COLUMN     "communicationByEmail" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "communicationByPrint" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "communicationBySMS" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "faxNo" TEXT,
ADD COLUMN     "firstName" TEXT NOT NULL,
ADD COLUMN     "homeNo" TEXT,
ADD COLUMN     "idNumber" TEXT,
ADD COLUMN     "maritalStatus" TEXT,
ADD COLUMN     "nickname" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "relationship" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'GREEN',
ADD COLUMN     "surname" TEXT NOT NULL,
ADD COLUMN     "title" TEXT,
ADD COLUMN     "workNo" TEXT;

-- CreateTable
CREATE TABLE "SchoolFeeSetting" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "grade" TEXT NOT NULL,
    "monthlyFeeCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolFeeSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitorSchool" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "province" TEXT,
    "city" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompetitorSchool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitorFee" (
    "id" TEXT NOT NULL,
    "competitorSchoolId" TEXT NOT NULL,
    "grade" TEXT NOT NULL,
    "monthlyFeeCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompetitorFee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LetterTemplate" (
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
CREATE TABLE "Letter" (
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
CREATE INDEX "SchoolFeeSetting_schoolId_idx" ON "SchoolFeeSetting"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolFeeSetting_schoolId_grade_key" ON "SchoolFeeSetting"("schoolId", "grade");

-- CreateIndex
CREATE INDEX "CompetitorFee_competitorSchoolId_idx" ON "CompetitorFee"("competitorSchoolId");

-- CreateIndex
CREATE INDEX "CompetitorFee_grade_idx" ON "CompetitorFee"("grade");

-- CreateIndex
CREATE INDEX "LetterTemplate_schoolId_type_idx" ON "LetterTemplate"("schoolId", "type");

-- CreateIndex
CREATE INDEX "Letter_schoolId_type_idx" ON "Letter"("schoolId", "type");

-- CreateIndex
CREATE INDEX "Letter_parentId_idx" ON "Letter"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "Parent_idNumber_key" ON "Parent"("idNumber");

-- CreateIndex
CREATE INDEX "Parent_schoolId_cellNo_idx" ON "Parent"("schoolId", "cellNo");

-- AddForeignKey
ALTER TABLE "SchoolFeeSetting" ADD CONSTRAINT "SchoolFeeSetting_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitorFee" ADD CONSTRAINT "CompetitorFee_competitorSchoolId_fkey" FOREIGN KEY ("competitorSchoolId") REFERENCES "CompetitorSchool"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LetterTemplate" ADD CONSTRAINT "LetterTemplate_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Letter" ADD CONSTRAINT "Letter_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Letter" ADD CONSTRAINT "Letter_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Parent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Letter" ADD CONSTRAINT "Letter_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "Learner"("id") ON DELETE SET NULL ON UPDATE CASCADE;
