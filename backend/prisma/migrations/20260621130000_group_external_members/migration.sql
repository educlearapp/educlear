CREATE TABLE "GroupExternalMember" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "memberType" TEXT NOT NULL DEFAULT 'EXTERNAL',
    "sourceFile" TEXT NOT NULL DEFAULT '',
    "sheetName" TEXT NOT NULL DEFAULT '',
    "rowNumber" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupExternalMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GroupExternalMember_groupId_normalizedName_key" ON "GroupExternalMember"("groupId", "normalizedName");
CREATE INDEX "GroupExternalMember_schoolId_idx" ON "GroupExternalMember"("schoolId");
CREATE INDEX "GroupExternalMember_groupId_idx" ON "GroupExternalMember"("groupId");

ALTER TABLE "GroupExternalMember" ADD CONSTRAINT "GroupExternalMember_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GroupExternalMember" ADD CONSTRAINT "GroupExternalMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
