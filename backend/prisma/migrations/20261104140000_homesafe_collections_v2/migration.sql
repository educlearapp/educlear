-- HomeSafe Collections V2 (additive only).
-- Does not alter Group, GroupLearner, HomeSafeEvent, or Early Departure data.

CREATE TYPE "HomeSafeCollectionGroupKind" AS ENUM ('TRANSPORT', 'ACTIVITY');
CREATE TYPE "HomeSafeCollectionWeekday" AS ENUM ('Mon', 'Tue', 'Wed', 'Thu', 'Fri');
CREATE TYPE "HomeSafeCollectionAttendance" AS ENUM ('PRESENT', 'ABSENT', 'LATE', 'EXCUSED', 'UNCONFIRMED');
CREATE TYPE "HomeSafeCollectionProgress" AS ENUM ('WAITING', 'CALLED', 'READY', 'COLLECTED', 'HANDED_OVER', 'RETURNED', 'PARTICIPATING', 'COMPLETED', 'AWAY');

CREATE TABLE "HomeSafeCollectionGroup" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "HomeSafeCollectionGroupKind" NOT NULL,
    "driverName" TEXT,
    "driverContact" TEXT,
    "vehicleReg" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomeSafeCollectionGroup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HomeSafeCollectionSession" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "weekday" "HomeSafeCollectionWeekday" NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "responsibleAdult" TEXT NOT NULL,
    "location" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomeSafeCollectionSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HomeSafeCollectionMembership" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HomeSafeCollectionMembership_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HomeSafeCollectionRegisterRow" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "schoolLocalDate" TEXT NOT NULL,
    "attendance" "HomeSafeCollectionAttendance" NOT NULL DEFAULT 'PRESENT',
    "progress" "HomeSafeCollectionProgress" NOT NULL DEFAULT 'WAITING',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomeSafeCollectionRegisterRow_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HomeSafeCollectionGroup_schoolId_name_key" ON "HomeSafeCollectionGroup"("schoolId", "name");
CREATE INDEX "HomeSafeCollectionGroup_schoolId_idx" ON "HomeSafeCollectionGroup"("schoolId");
CREATE INDEX "HomeSafeCollectionGroup_schoolId_kind_idx" ON "HomeSafeCollectionGroup"("schoolId", "kind");

CREATE INDEX "HomeSafeCollectionSession_schoolId_idx" ON "HomeSafeCollectionSession"("schoolId");
CREATE INDEX "HomeSafeCollectionSession_schoolId_groupId_idx" ON "HomeSafeCollectionSession"("schoolId", "groupId");
CREATE INDEX "HomeSafeCollectionSession_schoolId_weekday_idx" ON "HomeSafeCollectionSession"("schoolId", "weekday");
CREATE INDEX "HomeSafeCollectionSession_groupId_idx" ON "HomeSafeCollectionSession"("groupId");

CREATE UNIQUE INDEX "HomeSafeCollectionMembership_sessionId_learnerId_key" ON "HomeSafeCollectionMembership"("sessionId", "learnerId");
CREATE INDEX "HomeSafeCollectionMembership_schoolId_idx" ON "HomeSafeCollectionMembership"("schoolId");
CREATE INDEX "HomeSafeCollectionMembership_sessionId_idx" ON "HomeSafeCollectionMembership"("sessionId");
CREATE INDEX "HomeSafeCollectionMembership_learnerId_idx" ON "HomeSafeCollectionMembership"("learnerId");

CREATE UNIQUE INDEX "HomeSafeCollectionRegisterRow_sessionId_learnerId_schoolLocalDate_key" ON "HomeSafeCollectionRegisterRow"("sessionId", "learnerId", "schoolLocalDate");
CREATE INDEX "HomeSafeCollectionRegisterRow_schoolId_schoolLocalDate_idx" ON "HomeSafeCollectionRegisterRow"("schoolId", "schoolLocalDate");
CREATE INDEX "HomeSafeCollectionRegisterRow_sessionId_schoolLocalDate_idx" ON "HomeSafeCollectionRegisterRow"("sessionId", "schoolLocalDate");
CREATE INDEX "HomeSafeCollectionRegisterRow_learnerId_idx" ON "HomeSafeCollectionRegisterRow"("learnerId");

ALTER TABLE "HomeSafeCollectionGroup" ADD CONSTRAINT "HomeSafeCollectionGroup_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HomeSafeCollectionSession" ADD CONSTRAINT "HomeSafeCollectionSession_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HomeSafeCollectionSession" ADD CONSTRAINT "HomeSafeCollectionSession_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "HomeSafeCollectionGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HomeSafeCollectionMembership" ADD CONSTRAINT "HomeSafeCollectionMembership_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HomeSafeCollectionMembership" ADD CONSTRAINT "HomeSafeCollectionMembership_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "HomeSafeCollectionSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HomeSafeCollectionMembership" ADD CONSTRAINT "HomeSafeCollectionMembership_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "Learner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HomeSafeCollectionRegisterRow" ADD CONSTRAINT "HomeSafeCollectionRegisterRow_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HomeSafeCollectionRegisterRow" ADD CONSTRAINT "HomeSafeCollectionRegisterRow_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "HomeSafeCollectionSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HomeSafeCollectionRegisterRow" ADD CONSTRAINT "HomeSafeCollectionRegisterRow_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "Learner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
