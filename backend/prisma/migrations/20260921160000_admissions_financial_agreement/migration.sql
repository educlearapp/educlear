-- Online Admissions financial policy / declaration versions and frozen applicant signatures.
-- Additive only. Existing applications receive financialAgreementRequired = false.
-- No acceptance rows are backfilled. No legal documents are published.

CREATE TYPE "SchoolAdmissionsLegalDocumentKind" AS ENUM ('FINANCIAL_POLICY', 'FINANCIAL_DECLARATION');

CREATE TABLE "SchoolAdmissionsLegalDocument" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "kind" "SchoolAdmissionsLegalDocumentKind" NOT NULL,
    "versionLabel" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "contentSha256" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolAdmissionsLegalDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdmissionFinancialAcceptance" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "kind" "SchoolAdmissionsLegalDocumentKind" NOT NULL,
    "documentId" TEXT NOT NULL,
    "titleSnapshot" TEXT NOT NULL,
    "bodySnapshot" TEXT NOT NULL,
    "contentSha256" TEXT NOT NULL,
    "signerGuardianId" TEXT NOT NULL,
    "signerFullNameSnapshot" TEXT NOT NULL,
    "typedSignerName" TEXT NOT NULL,
    "signatureFileKey" TEXT NOT NULL,
    "signatureContentType" TEXT NOT NULL,
    "signatureSha256" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdmissionFinancialAcceptance_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AdmissionApplication" ADD COLUMN "financialAgreementRequired" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "SchoolAdmissionsLegalDocument_schoolId_kind_supersededAt_idx" ON "SchoolAdmissionsLegalDocument"("schoolId", "kind", "supersededAt");

-- One active (not superseded) document per school and kind.
CREATE UNIQUE INDEX "SchoolAdmissionsLegalDocument_one_active_per_school_kind"
ON "SchoolAdmissionsLegalDocument"("schoolId", "kind")
WHERE "supersededAt" IS NULL;

CREATE UNIQUE INDEX "AdmissionFinancialAcceptance_applicationId_kind_key" ON "AdmissionFinancialAcceptance"("applicationId", "kind");
CREATE INDEX "AdmissionFinancialAcceptance_schoolId_applicationId_idx" ON "AdmissionFinancialAcceptance"("schoolId", "applicationId");

ALTER TABLE "SchoolAdmissionsLegalDocument"
  ADD CONSTRAINT "SchoolAdmissionsLegalDocument_schoolId_fkey"
  FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AdmissionFinancialAcceptance"
  ADD CONSTRAINT "AdmissionFinancialAcceptance_schoolId_fkey"
  FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AdmissionFinancialAcceptance"
  ADD CONSTRAINT "AdmissionFinancialAcceptance_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "AdmissionApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AdmissionFinancialAcceptance"
  ADD CONSTRAINT "AdmissionFinancialAcceptance_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "SchoolAdmissionsLegalDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
