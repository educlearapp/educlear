-- CreateTable
CREATE TABLE "LearnerBillingPlan" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "excludeFromInvoiceRun" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LearnerBillingPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearnerBillingPlanItem" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "billingPlanId" TEXT NOT NULL,
    "feeStructureId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "type" TEXT,
    "amountCents" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LearnerBillingPlanItem_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "LearnerBillingPlan_schoolId_idx" ON "LearnerBillingPlan"("schoolId");
CREATE INDEX "LearnerBillingPlan_learnerId_idx" ON "LearnerBillingPlan"("learnerId");
CREATE UNIQUE INDEX "LearnerBillingPlan_learnerId_key" ON "LearnerBillingPlan"("learnerId");
CREATE UNIQUE INDEX "LearnerBillingPlan_schoolId_learnerId_key" ON "LearnerBillingPlan"("schoolId", "learnerId");

CREATE INDEX "LearnerBillingPlanItem_schoolId_idx" ON "LearnerBillingPlanItem"("schoolId");
CREATE INDEX "LearnerBillingPlanItem_billingPlanId_idx" ON "LearnerBillingPlanItem"("billingPlanId");
CREATE INDEX "LearnerBillingPlanItem_feeStructureId_idx" ON "LearnerBillingPlanItem"("feeStructureId");
CREATE UNIQUE INDEX "LearnerBillingPlanItem_billingPlanId_feeStructureId_key" ON "LearnerBillingPlanItem"("billingPlanId", "feeStructureId");

-- Foreign keys
ALTER TABLE "LearnerBillingPlan" ADD CONSTRAINT "LearnerBillingPlan_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LearnerBillingPlan" ADD CONSTRAINT "LearnerBillingPlan_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "Learner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LearnerBillingPlanItem" ADD CONSTRAINT "LearnerBillingPlanItem_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LearnerBillingPlanItem" ADD CONSTRAINT "LearnerBillingPlanItem_billingPlanId_fkey" FOREIGN KEY ("billingPlanId") REFERENCES "LearnerBillingPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LearnerBillingPlanItem" ADD CONSTRAINT "LearnerBillingPlanItem_feeStructureId_fkey" FOREIGN KEY ("feeStructureId") REFERENCES "FeeStructure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

