/*
  Warnings:

  - Added the required column `updatedAt` to the `FeeStructure` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "FeeCategory" AS ENUM ('SCHOOL_CHARGE', 'EXTRAMURAL_CHARGE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "EmploymentType" AS ENUM ('PERMANENT', 'TEMPORARY', 'CONTRACT', 'PART_TIME', 'CASUAL');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "SalaryType" AS ENUM ('MONTHLY', 'WEEKLY', 'DAILY', 'HOURLY');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "PayFrequency" AS ENUM ('MONTHLY', 'WEEKLY', 'FORTNIGHTLY');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "PayrollRunStatus" AS ENUM ('DRAFT', 'FINALIZED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "PayrollItemType" AS ENUM ('EARNING', 'DEDUCTION', 'EMPLOYER_CONTRIBUTION');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "PayrollItemCode" AS ENUM ('BASIC_SALARY', 'OVERTIME', 'BONUS', 'COMMISSION', 'ALLOWANCE', 'HOUSING_ALLOWANCE', 'TRANSPORT_ALLOWANCE', 'CELLPHONE_ALLOWANCE', 'OTHER_EARNING', 'PAYE', 'UIF_EMPLOYEE', 'PENSION', 'MEDICAL_AID', 'STAFF_LOAN', 'STAFF_ADVANCE', 'UNION_FEE', 'OTHER_DEDUCTION', 'UIF_EMPLOYER', 'OTHER_EMPLOYER_CONTRIBUTION');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "PayslipDeliveryPreference" AS ENUM ('PRINT', 'EMAIL', 'BOTH');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "PayslipEmailStatus" AS ENUM ('NOT_SENT', 'SENT', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "PayslipPrintStatus" AS ENUM ('NOT_PRINTED', 'PRINTED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "PayrollReportType" AS ENUM ('SALARY_REGISTER', 'DEDUCTION_REGISTER', 'EMPLOYER_CONTRIBUTION', 'PAYROLL_SUMMARY', 'PAYROLL_PACK');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "FeeFrequency" ADD VALUE 'MONTHLY_EXCL_DEC';
ALTER TYPE "FeeFrequency" ADD VALUE 'MONTHLY_EXCL_NOV_DEC';
ALTER TYPE "FeeFrequency" ADD VALUE 'ANNUALLY';
ALTER TYPE "FeeFrequency" ADD VALUE 'TERMLY';
ALTER TYPE "FeeFrequency" ADD VALUE 'DAILY';

-- AlterTable
ALTER TABLE "FeeStructure" ADD COLUMN IF NOT EXISTS     "category" "FeeCategory",
ADD COLUMN IF NOT EXISTS     "description" TEXT,
ADD COLUMN IF NOT EXISTS     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS     "notes" TEXT,
ADD COLUMN IF NOT EXISTS     "type" TEXT,
ADD COLUMN IF NOT EXISTS     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "Learner" ADD COLUMN IF NOT EXISTS     "birthDate" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS     "gender" TEXT,
ADD COLUMN IF NOT EXISTS     "idNumber" TEXT;

-- AlterTable
ALTER TABLE "Parent" ADD COLUMN IF NOT EXISTS     "outstandingAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "School" ADD COLUMN IF NOT EXISTS     "phone" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS     "roleId" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "Permission" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "SchoolRole" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isOwner" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "RolePermission" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "UserPermissionOverride" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "allowed" BOOLEAN NOT NULL,

    CONSTRAINT "UserPermissionOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Employee" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "employeeNumber" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "fullName" TEXT,
    "idNumber" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "gender" TEXT,
    "mobileNumber" TEXT,
    "email" TEXT,
    "physicalAddress" TEXT,
    "jobTitle" TEXT,
    "department" TEXT,
    "employmentType" "EmploymentType" NOT NULL DEFAULT 'PERMANENT',
    "salaryType" "SalaryType" NOT NULL DEFAULT 'MONTHLY',
    "payFrequency" "PayFrequency" NOT NULL DEFAULT 'MONTHLY',
    "paymentMethod" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "taxNumber" TEXT,
    "uifApplicable" BOOLEAN NOT NULL DEFAULT true,
    "incomeTaxApplicable" BOOLEAN NOT NULL DEFAULT true,
    "basicSalary" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "hourlyRate" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "overtimeRate" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "overtimeHours" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "fixedHousingAllowance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "fixedTransportAllowance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "fixedCellphoneAllowance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "fixedOtherAllowance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "fixedPension" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "fixedMedicalAid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "fixedStaffLoan" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "fixedStaffAdvance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "fixedOtherDeduction" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "employeeMedicalAid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "employerMedicalAid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "employeePension" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "employerPension" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "bankAccountHolder" TEXT,
    "bankName" TEXT,
    "bankAccountNumber" TEXT,
    "bankBranchCode" TEXT,
    "payslipDeliveryPreference" "PayslipDeliveryPreference" NOT NULL DEFAULT 'BOTH',
    "sendPayslipByEmail" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PayrollSetting" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "taxYear" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "payFrequency" "PayFrequency" NOT NULL DEFAULT 'MONTHLY',
    "defaultPayDay" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'ZAR',
    "primaryRebate" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "secondaryRebate" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "tertiaryRebate" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "taxThresholdUnder65" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "taxThreshold65To74" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "taxThreshold75AndOver" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "uifEnabled" BOOLEAN NOT NULL DEFAULT true,
    "uifEmployeePercent" DECIMAL(5,2) NOT NULL DEFAULT 1,
    "uifEmployerPercent" DECIMAL(5,2) NOT NULL DEFAULT 1,
    "uifMonthlyCeiling" DECIMAL(12,2) NOT NULL DEFAULT 17712,
    "payslipPrefix" TEXT DEFAULT 'PS',
    "payrollRunPrefix" TEXT DEFAULT 'PR',
    "payrollEmailFromName" TEXT,
    "payrollEmailReplyTo" TEXT,
    "payslipEmailSubjectTemplate" TEXT,
    "payslipEmailBodyTemplate" TEXT,
    "bookkeeperName" TEXT,
    "bookkeeperEmail" TEXT,
    "bookkeeperSendPdf" BOOLEAN NOT NULL DEFAULT true,
    "bookkeeperSendExcel" BOOLEAN NOT NULL DEFAULT true,
    "bookkeeperEmailSubjectTemplate" TEXT,
    "bookkeeperEmailBodyTemplate" TEXT,
    "envelopeTopOffsetMm" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "envelopeLeftOffsetMm" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "showFoldGuide" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PayrollRun" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "payrollSettingId" TEXT,
    "runNumber" TEXT,
    "taxYear" INTEGER NOT NULL,
    "payrollMonth" INTEGER NOT NULL,
    "payrollYear" INTEGER NOT NULL,
    "payDate" TIMESTAMP(3) NOT NULL,
    "status" "PayrollRunStatus" NOT NULL DEFAULT 'DRAFT',
    "employeeCount" INTEGER NOT NULL DEFAULT 0,
    "grossTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "deductionsTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "netTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "employerCostTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "finalizedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PayrollRunEmployee" (
    "id" TEXT NOT NULL,
    "payrollRunId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "basicSalary" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "overtimeAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "bonusAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "allowanceAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "otherEarningsAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "grossPay" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "payeAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "uifEmployeeAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "otherDeductionsAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalDeductions" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "netPay" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "uifEmployerAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "employerCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollRunEmployee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PayrollItem" (
    "id" TEXT NOT NULL,
    "payrollRunEmployeeId" TEXT NOT NULL,
    "itemType" "PayrollItemType" NOT NULL,
    "itemCode" "PayrollItemCode" NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Payslip" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "payrollRunId" TEXT NOT NULL,
    "payrollRunEmployeeId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "payslipNumber" TEXT,
    "taxYear" INTEGER NOT NULL,
    "payrollMonth" INTEGER NOT NULL,
    "payrollYear" INTEGER NOT NULL,
    "payDate" TIMESTAMP(3) NOT NULL,
    "grossPay" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalDeductions" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "netPay" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "employerCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "pdfPath" TEXT,
    "emailStatus" "PayslipEmailStatus" NOT NULL DEFAULT 'NOT_SENT',
    "printStatus" "PayslipPrintStatus" NOT NULL DEFAULT 'NOT_PRINTED',
    "emailedAt" TIMESTAMP(3),
    "emailedTo" TEXT,
    "printedAt" TIMESTAMP(3),
    "lastEmailError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payslip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PayrollEmailLog" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "payrollRunId" TEXT,
    "reportType" "PayrollReportType",
    "recipientName" TEXT,
    "recipientEmail" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "errorMessage" TEXT,
    "attachedPdf" BOOLEAN NOT NULL DEFAULT false,
    "attachedExcel" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollEmailLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Permission_key_key" ON "Permission"("key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SchoolRole_schoolId_idx" ON "SchoolRole"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "SchoolRole_schoolId_name_key" ON "SchoolRole"("schoolId", "name");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RolePermission_roleId_idx" ON "RolePermission"("roleId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RolePermission_permissionId_idx" ON "RolePermission"("permissionId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "RolePermission_roleId_permissionId_key" ON "RolePermission"("roleId", "permissionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "UserPermissionOverride_userId_idx" ON "UserPermissionOverride"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "UserPermissionOverride_permissionId_idx" ON "UserPermissionOverride"("permissionId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "UserPermissionOverride_userId_permissionId_key" ON "UserPermissionOverride"("userId", "permissionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Employee_schoolId_idx" ON "Employee"("schoolId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Employee_employeeNumber_idx" ON "Employee"("employeeNumber");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Employee_email_idx" ON "Employee"("email");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Employee_isActive_idx" ON "Employee"("isActive");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PayrollSetting_schoolId_idx" ON "PayrollSetting"("schoolId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PayrollSetting_taxYear_idx" ON "PayrollSetting"("taxYear");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PayrollSetting_schoolId_taxYear_key" ON "PayrollSetting"("schoolId", "taxYear");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PayrollRun_schoolId_idx" ON "PayrollRun"("schoolId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PayrollRun_payrollSettingId_idx" ON "PayrollRun"("payrollSettingId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PayrollRun_taxYear_payrollMonth_payrollYear_idx" ON "PayrollRun"("taxYear", "payrollMonth", "payrollYear");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PayrollRun_status_idx" ON "PayrollRun"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PayrollRunEmployee_payrollRunId_idx" ON "PayrollRunEmployee"("payrollRunId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PayrollRunEmployee_employeeId_idx" ON "PayrollRunEmployee"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PayrollRunEmployee_payrollRunId_employeeId_key" ON "PayrollRunEmployee"("payrollRunId", "employeeId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PayrollItem_payrollRunEmployeeId_idx" ON "PayrollItem"("payrollRunEmployeeId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PayrollItem_itemType_idx" ON "PayrollItem"("itemType");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PayrollItem_itemCode_idx" ON "PayrollItem"("itemCode");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Payslip_payrollRunEmployeeId_key" ON "Payslip"("payrollRunEmployeeId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Payslip_schoolId_idx" ON "Payslip"("schoolId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Payslip_payrollRunId_idx" ON "Payslip"("payrollRunId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Payslip_employeeId_idx" ON "Payslip"("employeeId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Payslip_emailStatus_idx" ON "Payslip"("emailStatus");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PayrollEmailLog_schoolId_idx" ON "PayrollEmailLog"("schoolId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PayrollEmailLog_payrollRunId_idx" ON "PayrollEmailLog"("payrollRunId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PayrollEmailLog_recipientEmail_idx" ON "PayrollEmailLog"("recipientEmail");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PayrollEmailLog_createdAt_idx" ON "PayrollEmailLog"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FeeStructure_schoolId_isActive_idx" ON "FeeStructure"("schoolId", "isActive");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "User_roleId_idx" ON "User"("roleId");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'User_roleId_fkey') THEN
    ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "SchoolRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SchoolRole_schoolId_fkey') THEN
    ALTER TABLE "SchoolRole" ADD CONSTRAINT "SchoolRole_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RolePermission_roleId_fkey') THEN
    ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "SchoolRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RolePermission_permissionId_fkey') THEN
    ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UserPermissionOverride_userId_fkey') THEN
    ALTER TABLE "UserPermissionOverride" ADD CONSTRAINT "UserPermissionOverride_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UserPermissionOverride_permissionId_fkey') THEN
    ALTER TABLE "UserPermissionOverride" ADD CONSTRAINT "UserPermissionOverride_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Employee_schoolId_fkey') THEN
    ALTER TABLE "Employee" ADD CONSTRAINT "Employee_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PayrollSetting_schoolId_fkey') THEN
    ALTER TABLE "PayrollSetting" ADD CONSTRAINT "PayrollSetting_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PayrollRun_schoolId_fkey') THEN
    ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PayrollRun_payrollSettingId_fkey') THEN
    ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_payrollSettingId_fkey" FOREIGN KEY ("payrollSettingId") REFERENCES "PayrollSetting"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PayrollRunEmployee_payrollRunId_fkey') THEN
    ALTER TABLE "PayrollRunEmployee" ADD CONSTRAINT "PayrollRunEmployee_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "PayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PayrollRunEmployee_employeeId_fkey') THEN
    ALTER TABLE "PayrollRunEmployee" ADD CONSTRAINT "PayrollRunEmployee_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PayrollItem_payrollRunEmployeeId_fkey') THEN
    ALTER TABLE "PayrollItem" ADD CONSTRAINT "PayrollItem_payrollRunEmployeeId_fkey" FOREIGN KEY ("payrollRunEmployeeId") REFERENCES "PayrollRunEmployee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Payslip_schoolId_fkey') THEN
    ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Payslip_payrollRunId_fkey') THEN
    ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "PayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Payslip_payrollRunEmployeeId_fkey') THEN
    ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_payrollRunEmployeeId_fkey" FOREIGN KEY ("payrollRunEmployeeId") REFERENCES "PayrollRunEmployee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Payslip_employeeId_fkey') THEN
    ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PayrollEmailLog_schoolId_fkey') THEN
    ALTER TABLE "PayrollEmailLog" ADD CONSTRAINT "PayrollEmailLog_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PayrollEmailLog_payrollRunId_fkey') THEN
    ALTER TABLE "PayrollEmailLog" ADD CONSTRAINT "PayrollEmailLog_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "PayrollRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
