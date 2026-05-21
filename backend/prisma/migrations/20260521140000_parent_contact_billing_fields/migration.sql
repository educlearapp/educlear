-- AlterTable
ALTER TABLE "Parent" ADD COLUMN "homeAddress" TEXT;
ALTER TABLE "Parent" ADD COLUMN "communicationAdministration" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Parent" ADD COLUMN "communicationBilling" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "ParentLearnerLink" ADD COLUMN "isPayingPerson" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ParentLearnerLink" ADD COLUMN "billingStatement" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ParentLearnerLink" ADD COLUMN "billingInvoice" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ParentLearnerLink" ADD COLUMN "billingReceipt" BOOLEAN NOT NULL DEFAULT true;
