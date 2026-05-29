-- CreateTable
CREATE TABLE "LearnerBillingPlanLine" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "feeDescription" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearnerBillingPlanLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LearnerBillingPlanLine_schoolId_idx" ON "LearnerBillingPlanLine"("schoolId");

-- CreateIndex
CREATE INDEX "LearnerBillingPlanLine_schoolId_learnerId_idx" ON "LearnerBillingPlanLine"("schoolId", "learnerId");

-- AddForeignKey
ALTER TABLE "LearnerBillingPlanLine" ADD CONSTRAINT "LearnerBillingPlanLine_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearnerBillingPlanLine" ADD CONSTRAINT "LearnerBillingPlanLine_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "Learner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
