-- OA-03A: Online Admissions core schema (staging domain)
-- No seed data. Admissions disabled by default. Fee amount has no global default.

-- CreateEnum
CREATE TYPE "AdmissionApplicationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'INFO_REQUESTED', 'ACCEPTED', 'DECLINED', 'WITHDRAWN', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AdmissionPaymentStatus" AS ENUM ('NOT_REQUIRED', 'AWAITING_PAYMENT', 'PROOF_UPLOADED', 'UNDER_VERIFICATION', 'VERIFIED', 'REJECTED', 'WAIVED');

-- CreateEnum
CREATE TYPE "AdmissionMatchDecision" AS ENUM ('EXACT_MATCH', 'POSSIBLE_MATCH', 'NO_MATCH', 'CONFIRMED_NEW');

-- CreateEnum
CREATE TYPE "AdmissionActorType" AS ENUM ('APPLICANT', 'STAFF', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AdmissionDocumentUploader" AS ENUM ('APPLICANT', 'STAFF');

-- CreateEnum
CREATE TYPE "AdmissionDocumentScanStatus" AS ENUM ('NOT_SCANNED', 'CLEAN', 'INFECTED', 'ERROR');

-- CreateTable
CREATE TABLE "SchoolAdmissionsSettings" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "publicSlug" TEXT,
    "applicationsOpenAt" TIMESTAMP(3),
    "applicationsCloseAt" TIMESTAMP(3),
    "intakeYear" INTEGER,
    "acceptedGrades" JSONB NOT NULL DEFAULT '[]',
    "admissionFeeRequired" BOOLEAN NOT NULL DEFAULT false,
    "defaultAdmissionFeeAmount" DECIMAL(12,2),
    "currency" TEXT NOT NULL DEFAULT 'ZAR',
    "proofOfPaymentRequired" BOOLEAN NOT NULL DEFAULT false,
    "paymentVerificationRequired" BOOLEAN NOT NULL DEFAULT true,
    "requirePaymentVerifiedBeforeAccept" BOOLEAN NOT NULL DEFAULT true,
    "bankName" TEXT,
    "accountHolder" TEXT,
    "accountNumber" TEXT,
    "branchCode" TEXT,
    "accountType" TEXT,
    "paymentInstructions" TEXT,
    "admissionContactEmail" TEXT,
    "admissionContactPhone" TEXT,
    "requiredDocuments" JSONB NOT NULL DEFAULT '[]',
    "applicationQuestions" JSONB NOT NULL DEFAULT '[]',
    "notificationRecipientUserIds" JSONB NOT NULL DEFAULT '[]',
    "privacyNoticeVersion" TEXT,
    "declarationText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolAdmissionsSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdmissionApplicationCounter" (
    "schoolId" TEXT NOT NULL,
    "intakeYear" INTEGER NOT NULL,
    "nextValue" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdmissionApplicationCounter_pkey" PRIMARY KEY ("schoolId","intakeYear")
);

-- CreateTable
CREATE TABLE "AdmissionApplication" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "applicationNumber" TEXT,
    "status" "AdmissionApplicationStatus" NOT NULL DEFAULT 'DRAFT',
    "intakeYear" INTEGER NOT NULL,
    "requestedGrade" TEXT,
    "feeRequired" BOOLEAN NOT NULL DEFAULT false,
    "feeAmount" DECIMAL(12,2),
    "feeCurrency" TEXT,
    "feeSnapshotAt" TIMESTAMP(3),
    "publicAccessId" TEXT NOT NULL,
    "accessTokenHash" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "resumeOtpHash" TEXT,
    "resumeOtpExpiresAt" TIMESTAMP(3),
    "declaredExistingSibling" BOOLEAN NOT NULL DEFAULT false,
    "declaredSiblingLearnerName" TEXT,
    "declaredSiblingAdmissionNo" TEXT,
    "declaredExistingFamily" BOOLEAN NOT NULL DEFAULT false,
    "staffMatchedFamilyAccountId" TEXT,
    "staffMatchDecision" "AdmissionMatchDecision",
    "promotedLearnerId" TEXT,
    "promotedFamilyAccountId" TEXT,
    "acceptedByUserId" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "statusReason" TEXT,
    "privacyAcceptedAt" TIMESTAMP(3),
    "declarationsAcceptedAt" TIMESTAMP(3),
    "privacyNoticeVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "lastApplicantActivityAt" TIMESTAMP(3),

    CONSTRAINT "AdmissionApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdmissionLearnerCandidate" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "nickname" TEXT,
    "birthDate" TIMESTAMP(3),
    "gender" TEXT,
    "idNumber" TEXT,
    "homeLanguage" TEXT,
    "citizenship" TEXT,
    "homeAddress" TEXT,
    "allergies" TEXT,
    "medicalAlert" TEXT,
    "previousSchoolName" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdmissionLearnerCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdmissionGuardian" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "title" TEXT,
    "firstName" TEXT NOT NULL,
    "surname" TEXT NOT NULL,
    "relationship" TEXT,
    "idNumber" TEXT,
    "cellNo" TEXT,
    "email" TEXT,
    "homeAddress" TEXT,
    "employer" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,
    "isPayingPerson" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "matchedParentId" TEXT,
    "matchDecision" "AdmissionMatchDecision",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdmissionGuardian_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdmissionAnswer" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "questionKey" TEXT NOT NULL,
    "questionLabelSnapshot" TEXT NOT NULL,
    "valueJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdmissionAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdmissionDocument" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "storageProvider" TEXT NOT NULL DEFAULT 'local_disk',
    "storageKey" TEXT NOT NULL,
    "checksumSha256" TEXT,
    "uploadedBy" "AdmissionDocumentUploader" NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "scanStatus" "AdmissionDocumentScanStatus" NOT NULL DEFAULT 'NOT_SCANNED',
    "replacedByDocumentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdmissionDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdmissionFeeRecord" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "amount" DECIMAL(12,2),
    "currency" TEXT NOT NULL DEFAULT 'ZAR',
    "paymentStatus" "AdmissionPaymentStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "paymentReference" TEXT,
    "verifiedByUserId" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "waivedByUserId" TEXT,
    "waivedAt" TIMESTAMP(3),
    "waiveReason" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "latestProofDocumentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdmissionFeeRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdmissionStatusHistory" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "fromStatus" "AdmissionApplicationStatus",
    "toStatus" "AdmissionApplicationStatus" NOT NULL,
    "actorType" "AdmissionActorType" NOT NULL,
    "actorUserId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdmissionStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdmissionPaymentHistory" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "fromStatus" "AdmissionPaymentStatus",
    "toStatus" "AdmissionPaymentStatus" NOT NULL,
    "actorType" "AdmissionActorType" NOT NULL,
    "actorUserId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdmissionPaymentHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdmissionAuditEvent" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "applicationId" TEXT,
    "eventType" TEXT NOT NULL,
    "actorType" "AdmissionActorType" NOT NULL,
    "actorUserId" TEXT,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdmissionAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdmissionStaffNote" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdmissionStaffNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SchoolAdmissionsSettings_schoolId_key" ON "SchoolAdmissionsSettings"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolAdmissionsSettings_publicSlug_key" ON "SchoolAdmissionsSettings"("publicSlug");

-- CreateIndex
CREATE INDEX "SchoolAdmissionsSettings_enabled_idx" ON "SchoolAdmissionsSettings"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "AdmissionApplication_publicAccessId_key" ON "AdmissionApplication"("publicAccessId");

-- CreateIndex
CREATE INDEX "AdmissionApplication_schoolId_status_idx" ON "AdmissionApplication"("schoolId", "status");

-- CreateIndex
CREATE INDEX "AdmissionApplication_schoolId_intakeYear_idx" ON "AdmissionApplication"("schoolId", "intakeYear");

-- CreateIndex
CREATE INDEX "AdmissionApplication_schoolId_submittedAt_idx" ON "AdmissionApplication"("schoolId", "submittedAt");

-- CreateIndex
CREATE INDEX "AdmissionApplication_schoolId_createdAt_idx" ON "AdmissionApplication"("schoolId", "createdAt");

-- CreateIndex
CREATE INDEX "AdmissionApplication_promotedLearnerId_idx" ON "AdmissionApplication"("promotedLearnerId");

-- CreateIndex
CREATE INDEX "AdmissionApplication_staffMatchedFamilyAccountId_idx" ON "AdmissionApplication"("staffMatchedFamilyAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "AdmissionApplication_schoolId_applicationNumber_key" ON "AdmissionApplication"("schoolId", "applicationNumber");

-- CreateIndex
CREATE UNIQUE INDEX "AdmissionLearnerCandidate_applicationId_key" ON "AdmissionLearnerCandidate"("applicationId");

-- CreateIndex
CREATE INDEX "AdmissionLearnerCandidate_schoolId_idx" ON "AdmissionLearnerCandidate"("schoolId");

-- CreateIndex
CREATE INDEX "AdmissionGuardian_schoolId_applicationId_idx" ON "AdmissionGuardian"("schoolId", "applicationId");

-- CreateIndex
CREATE INDEX "AdmissionGuardian_matchedParentId_idx" ON "AdmissionGuardian"("matchedParentId");

-- CreateIndex
CREATE INDEX "AdmissionAnswer_schoolId_idx" ON "AdmissionAnswer"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "AdmissionAnswer_applicationId_questionKey_key" ON "AdmissionAnswer"("applicationId", "questionKey");

-- CreateIndex
CREATE UNIQUE INDEX "AdmissionDocument_storageKey_key" ON "AdmissionDocument"("storageKey");

-- CreateIndex
CREATE INDEX "AdmissionDocument_schoolId_applicationId_idx" ON "AdmissionDocument"("schoolId", "applicationId");

-- CreateIndex
CREATE INDEX "AdmissionDocument_applicationId_documentType_idx" ON "AdmissionDocument"("applicationId", "documentType");

-- CreateIndex
CREATE UNIQUE INDEX "AdmissionFeeRecord_applicationId_key" ON "AdmissionFeeRecord"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "AdmissionFeeRecord_latestProofDocumentId_key" ON "AdmissionFeeRecord"("latestProofDocumentId");

-- CreateIndex
CREATE INDEX "AdmissionFeeRecord_schoolId_paymentStatus_idx" ON "AdmissionFeeRecord"("schoolId", "paymentStatus");

-- CreateIndex
CREATE INDEX "AdmissionStatusHistory_schoolId_applicationId_createdAt_idx" ON "AdmissionStatusHistory"("schoolId", "applicationId", "createdAt");

-- CreateIndex
CREATE INDEX "AdmissionPaymentHistory_schoolId_applicationId_createdAt_idx" ON "AdmissionPaymentHistory"("schoolId", "applicationId", "createdAt");

-- CreateIndex
CREATE INDEX "AdmissionAuditEvent_schoolId_createdAt_idx" ON "AdmissionAuditEvent"("schoolId", "createdAt");

-- CreateIndex
CREATE INDEX "AdmissionAuditEvent_applicationId_createdAt_idx" ON "AdmissionAuditEvent"("applicationId", "createdAt");

-- CreateIndex
CREATE INDEX "AdmissionStaffNote_schoolId_applicationId_createdAt_idx" ON "AdmissionStaffNote"("schoolId", "applicationId", "createdAt");

-- AddForeignKey
ALTER TABLE "SchoolAdmissionsSettings" ADD CONSTRAINT "SchoolAdmissionsSettings_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionApplicationCounter" ADD CONSTRAINT "AdmissionApplicationCounter_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionApplication" ADD CONSTRAINT "AdmissionApplication_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionApplication" ADD CONSTRAINT "AdmissionApplication_staffMatchedFamilyAccountId_fkey" FOREIGN KEY ("staffMatchedFamilyAccountId") REFERENCES "FamilyAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionApplication" ADD CONSTRAINT "AdmissionApplication_promotedLearnerId_fkey" FOREIGN KEY ("promotedLearnerId") REFERENCES "Learner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionApplication" ADD CONSTRAINT "AdmissionApplication_promotedFamilyAccountId_fkey" FOREIGN KEY ("promotedFamilyAccountId") REFERENCES "FamilyAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionApplication" ADD CONSTRAINT "AdmissionApplication_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionLearnerCandidate" ADD CONSTRAINT "AdmissionLearnerCandidate_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionLearnerCandidate" ADD CONSTRAINT "AdmissionLearnerCandidate_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "AdmissionApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionGuardian" ADD CONSTRAINT "AdmissionGuardian_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionGuardian" ADD CONSTRAINT "AdmissionGuardian_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "AdmissionApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionGuardian" ADD CONSTRAINT "AdmissionGuardian_matchedParentId_fkey" FOREIGN KEY ("matchedParentId") REFERENCES "Parent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionAnswer" ADD CONSTRAINT "AdmissionAnswer_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionAnswer" ADD CONSTRAINT "AdmissionAnswer_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "AdmissionApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionDocument" ADD CONSTRAINT "AdmissionDocument_replacedByDocumentId_fkey" FOREIGN KEY ("replacedByDocumentId") REFERENCES "AdmissionDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionDocument" ADD CONSTRAINT "AdmissionDocument_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionDocument" ADD CONSTRAINT "AdmissionDocument_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "AdmissionApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionFeeRecord" ADD CONSTRAINT "AdmissionFeeRecord_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionFeeRecord" ADD CONSTRAINT "AdmissionFeeRecord_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "AdmissionApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionFeeRecord" ADD CONSTRAINT "AdmissionFeeRecord_verifiedByUserId_fkey" FOREIGN KEY ("verifiedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionFeeRecord" ADD CONSTRAINT "AdmissionFeeRecord_waivedByUserId_fkey" FOREIGN KEY ("waivedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionFeeRecord" ADD CONSTRAINT "AdmissionFeeRecord_latestProofDocumentId_fkey" FOREIGN KEY ("latestProofDocumentId") REFERENCES "AdmissionDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionStatusHistory" ADD CONSTRAINT "AdmissionStatusHistory_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionStatusHistory" ADD CONSTRAINT "AdmissionStatusHistory_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "AdmissionApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionStatusHistory" ADD CONSTRAINT "AdmissionStatusHistory_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionPaymentHistory" ADD CONSTRAINT "AdmissionPaymentHistory_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionPaymentHistory" ADD CONSTRAINT "AdmissionPaymentHistory_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "AdmissionApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionPaymentHistory" ADD CONSTRAINT "AdmissionPaymentHistory_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionAuditEvent" ADD CONSTRAINT "AdmissionAuditEvent_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionAuditEvent" ADD CONSTRAINT "AdmissionAuditEvent_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "AdmissionApplication"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionAuditEvent" ADD CONSTRAINT "AdmissionAuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionStaffNote" ADD CONSTRAINT "AdmissionStaffNote_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionStaffNote" ADD CONSTRAINT "AdmissionStaffNote_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "AdmissionApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionStaffNote" ADD CONSTRAINT "AdmissionStaffNote_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
