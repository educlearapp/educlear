CREATE TABLE "GroupLearner" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupLearner_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GroupLearner_groupId_learnerId_key" ON "GroupLearner"("groupId", "learnerId");
CREATE INDEX "GroupLearner_schoolId_idx" ON "GroupLearner"("schoolId");
CREATE INDEX "GroupLearner_groupId_idx" ON "GroupLearner"("groupId");
CREATE INDEX "GroupLearner_learnerId_idx" ON "GroupLearner"("learnerId");

ALTER TABLE "GroupLearner" ADD CONSTRAINT "GroupLearner_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GroupLearner" ADD CONSTRAINT "GroupLearner_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GroupLearner" ADD CONSTRAINT "GroupLearner_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "Learner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
