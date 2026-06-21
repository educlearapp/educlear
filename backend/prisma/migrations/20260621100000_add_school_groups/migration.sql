CREATE TABLE "Group" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "comments" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Group_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Group_schoolId_name_key" ON "Group"("schoolId", "name");
CREATE INDEX "Group_schoolId_idx" ON "Group"("schoolId");

ALTER TABLE "Group" ADD CONSTRAINT "Group_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
