-- Additive only: optional Parent.birthDate + Learner medical/admission fields.
-- Does NOT alter LearnerEnrollmentStatus (ACTIVE|HISTORICAL only).
-- Existing rows remain valid; new columns default to NULL.

ALTER TABLE "Parent" ADD COLUMN IF NOT EXISTS "birthDate" TIMESTAMP(3);

ALTER TABLE "Learner" ADD COLUMN IF NOT EXISTS "admissionDate" TIMESTAMP(3);
ALTER TABLE "Learner" ADD COLUMN IF NOT EXISTS "allergies" TEXT;
ALTER TABLE "Learner" ADD COLUMN IF NOT EXISTS "medicalAlert" TEXT;
