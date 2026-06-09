-- CreateTable
CREATE TABLE "LearnerBillingPlanCleared" (
    "schoolId" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "clearedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearnerBillingPlanCleared_pkey" PRIMARY KEY ("schoolId","learnerId")
);

-- CreateIndex
CREATE INDEX "LearnerBillingPlanCleared_schoolId_idx" ON "LearnerBillingPlanCleared"("schoolId");

-- AddForeignKey
ALTER TABLE "LearnerBillingPlanCleared" ADD CONSTRAINT "LearnerBillingPlanCleared_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearnerBillingPlanCleared" ADD CONSTRAINT "LearnerBillingPlanCleared_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "Learner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
