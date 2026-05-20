/*
  Warnings:

  - Added the required column `updatedAt` to the `FeeStructure` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "FeeCategory" AS ENUM ('SCHOOL_CHARGE', 'EXTRAMURAL_CHARGE');

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('PERMANENT', 'TEMPORARY', 'CONTRACT', 'PART_TIME', 'CASUAL');

-- CreateEnum
CREATE TYPE "SalaryType" AS ENUM ('MONTHLY', 'WEEKLY', 'DAILY', 'HOURLY');

-- CreateEnum
CREATE TYPE "PayFrequency" AS ENUM ('MONTHLY', 'WEEKLY', 'FORTNIGHTLY');

-- CreateEnum
CREATE TYPE "PayrollRunStatus" AS ENUM ('DRAFT', 'FINALIZED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PayrollItemType" AS ENUM ('EARNING', 'DEDUCTION', 'EMPLOYER_CONTRIBUTION');

-- CreateEnum
CREATE TYPE "PayrollItemCode" AS ENUM ('BASIC_SALARY', 'OVERTIME', 'BONUS', 'COMMISSION', 'ALLOWANCE', 'HOUSING_ALLOWANCE', 'TRANSPORT_ALLOWANCE', 'CELLPHONE_ALLOWANCE', 'OTHER_EARNING', 'PAYE', 'UIF_EMPLOYEE', 'PENSION', 'MEDICAL_AID', 'STAFF_LOAN', 'STAFF_ADVANCE', 'UNION_FEE', 'OTHER_DEDUCTION', 'UIF_EMPLOYER', 'OTHER_EMPLOYER_CONTRIBUTION');

-- CreateEnum
CREATE TYPE "PayslipDeliveryPreference" AS ENUM ('PRINT', 'EMAIL', 'BOTH');

-- CreateEnum
CREATE TYPE "PayslipEmailStatus" AS ENUM ('NOT_SENT', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "PayslipPrintStatus" AS ENUM ('NOT_PRINTED', 'PRINTED');

-- CreateEnum
CREATE TYPE "PayrollReportType" AS ENUM ('SALARY_REGISTER', 'DEDUCTION_REGISTER', 'EMPLOYER_CONTRIBUTION', 'PAYROLL_SUMMARY', 'PAYROLL_PACK');

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
ALTER TABLE "FeeStructure" ADD COLUMN     "category" "FeeCategory",
ADD COLUMN     "description" TEXT,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "type" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "Learner" ADD COLUMN     "birthDate" TIMESTAMP(3),
ADD COLUMN     "gender" TEXT,
ADD COLUMN     "idNumber" TEXT;

-- AlterTable
ALTER TABLE "Parent" ADD COLUMN     "outstandingAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "School" ADD COLUMN     "phone" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "roleId" TEXT;

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolRole" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isOwner" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPermissionOverride" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "allowed" BOOLEAN NOT NULL,

    CONSTRAINT "UserPermissionOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
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
CREATE TABLE "PayrollSetting" (
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
CREATE TABLE "PayrollRun" (
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
CREATE TABLE "PayrollRunEmployee" (
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
CREATE TABLE "PayrollItem" (
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
CREATE TABLE "Payslip" (
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
CREATE TABLE "PayrollEmailLog" (
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
CREATE UNIQUE INDEX "Permission_key_key" ON "Permission"("key");

-- CreateIndex
CREATE INDEX "SchoolRole_schoolId_idx" ON "SchoolRole"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolRole_schoolId_name_key" ON "SchoolRole"("schoolId", "name");

-- CreateIndex
CREATE INDEX "RolePermission_roleId_idx" ON "RolePermission"("roleId");

-- CreateIndex
CREATE INDEX "RolePermission_permissionId_idx" ON "RolePermission"("permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "RolePermission_roleId_permissionId_key" ON "RolePermission"("roleId", "permissionId");

-- CreateIndex
CREATE INDEX "UserPermissionOverride_userId_idx" ON "UserPermissionOverride"("userId");

-- CreateIndex
CREATE INDEX "UserPermissionOverride_permissionId_idx" ON "UserPermissionOverride"("permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "UserPermissionOverride_userId_permissionId_key" ON "UserPermissionOverride"("userId", "permissionId");

-- CreateIndex
CREATE INDEX "Employee_schoolId_idx" ON "Employee"("schoolId");

-- CreateIndex
CREATE INDEX "Employee_employeeNumber_idx" ON "Employee"("employeeNumber");

-- CreateIndex
CREATE INDEX "Employee_email_idx" ON "Employee"("email");

-- CreateIndex
CREATE INDEX "Employee_isActive_idx" ON "Employee"("isActive");

-- CreateIndex
CREATE INDEX "PayrollSetting_schoolId_idx" ON "PayrollSetting"("schoolId");

-- CreateIndex
CREATE INDEX "PayrollSetting_taxYear_idx" ON "PayrollSetting"("taxYear");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollSetting_schoolId_taxYear_key" ON "PayrollSetting"("schoolId", "taxYear");

-- CreateIndex
CREATE INDEX "PayrollRun_schoolId_idx" ON "PayrollRun"("schoolId");

-- CreateIndex
CREATE INDEX "PayrollRun_payrollSettingId_idx" ON "PayrollRun"("payrollSettingId");

-- CreateIndex
CREATE INDEX "PayrollRun_taxYear_payrollMonth_payrollYear_idx" ON "PayrollRun"("taxYear", "payrollMonth", "payrollYear");

-- CreateIndex
CREATE INDEX "PayrollRun_status_idx" ON "PayrollRun"("status");

-- CreateIndex
CREATE INDEX "PayrollRunEmployee_payrollRunId_idx" ON "PayrollRunEmployee"("payrollRunId");

-- CreateIndex
CREATE INDEX "PayrollRunEmployee_employeeId_idx" ON "PayrollRunEmployee"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRunEmployee_payrollRunId_employeeId_key" ON "PayrollRunEmployee"("payrollRunId", "employeeId");

-- CreateIndex
CREATE INDEX "PayrollItem_payrollRunEmployeeId_idx" ON "PayrollItem"("payrollRunEmployeeId");

-- CreateIndex
CREATE INDEX "PayrollItem_itemType_idx" ON "PayrollItem"("itemType");

-- CreateIndex
CREATE INDEX "PayrollItem_itemCode_idx" ON "PayrollItem"("itemCode");

-- CreateIndex
CREATE UNIQUE INDEX "Payslip_payrollRunEmployeeId_key" ON "Payslip"("payrollRunEmployeeId");

-- CreateIndex
CREATE INDEX "Payslip_schoolId_idx" ON "Payslip"("schoolId");

-- CreateIndex
CREATE INDEX "Payslip_payrollRunId_idx" ON "Payslip"("payrollRunId");

-- CreateIndex
CREATE INDEX "Payslip_employeeId_idx" ON "Payslip"("employeeId");

-- CreateIndex
CREATE INDEX "Payslip_emailStatus_idx" ON "Payslip"("emailStatus");

-- CreateIndex
CREATE INDEX "PayrollEmailLog_schoolId_idx" ON "PayrollEmailLog"("schoolId");

-- CreateIndex
CREATE INDEX "PayrollEmailLog_payrollRunId_idx" ON "PayrollEmailLog"("payrollRunId");

-- CreateIndex
CREATE INDEX "PayrollEmailLog_recipientEmail_idx" ON "PayrollEmailLog"("recipientEmail");

-- CreateIndex
CREATE INDEX "PayrollEmailLog_createdAt_idx" ON "PayrollEmailLog"("createdAt");

-- CreateIndex
CREATE INDEX "FeeStructure_schoolId_isActive_idx" ON "FeeStructure"("schoolId", "isActive");

-- CreateIndex
CREATE INDEX "User_roleId_idx" ON "User"("roleId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "SchoolRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolRole" ADD CONSTRAINT "SchoolRole_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "SchoolRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPermissionOverride" ADD CONSTRAINT "UserPermissionOverride_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPermissionOverride" ADD CONSTRAINT "UserPermissionOverride_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollSetting" ADD CONSTRAINT "PayrollSetting_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_payrollSettingId_fkey" FOREIGN KEY ("payrollSettingId") REFERENCES "PayrollSetting"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRunEmployee" ADD CONSTRAINT "PayrollRunEmployee_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "PayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRunEmployee" ADD CONSTRAINT "PayrollRunEmployee_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollItem" ADD CONSTRAINT "PayrollItem_payrollRunEmployeeId_fkey" FOREIGN KEY ("payrollRunEmployeeId") REFERENCES "PayrollRunEmployee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "PayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_payrollRunEmployeeId_fkey" FOREIGN KEY ("payrollRunEmployeeId") REFERENCES "PayrollRunEmployee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollEmailLog" ADD CONSTRAINT "PayrollEmailLog_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollEmailLog" ADD CONSTRAINT "PayrollEmailLog_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "PayrollRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
