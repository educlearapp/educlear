-- Parent SA ID uniqueness: global → school-scoped
-- Safe: drops only Parent_idNumber_key; creates composite unique on (schoolId, idNumber).
-- Does not modify Parent rows. PostgreSQL allows multiple NULL idNumber values per school.

DROP INDEX IF EXISTS "Parent_idNumber_key";

CREATE UNIQUE INDEX "Parent_schoolId_idNumber_key" ON "Parent"("schoolId", "idNumber");
