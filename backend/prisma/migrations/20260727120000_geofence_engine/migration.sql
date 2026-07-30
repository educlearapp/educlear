-- Shared Geofence Engine (EduClear-wide). Additive only.
-- Used first by EduClock campus boundary (Save Each Corner). Polygon clock validation stays feature-flagged OFF.

CREATE TYPE "GeofenceZoneType" AS ENUM (
  'CAMPUS_BOUNDARY',
  'ENTRANCE',
  'STAFF_ENTRANCE',
  'VISITOR_ENTRANCE',
  'FOUNDATION_PHASE',
  'HIGH_SCHOOL',
  'TRANSPORT',
  'ASSEMBLY_POINT',
  'EXCLUSION_ZONE',
  'CUSTOM'
);

CREATE TYPE "GeofenceGeometryKind" AS ENUM (
  'POLYGON',
  'POINT'
);

CREATE TABLE "GeofenceZone" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "GeofenceZoneType" NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "geometryKind" "GeofenceGeometryKind" NOT NULL DEFAULT 'POLYGON',
  "geometry" JSONB,
  "metadata" JSONB,
  "campusId" TEXT,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GeofenceZone_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GeofenceVertex" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "zoneId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "latitude" DECIMAL(10,7) NOT NULL,
  "longitude" DECIMAL(10,7) NOT NULL,
  "accuracyMetres" DECIMAL(10,2),
  "capturedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GeofenceVertex_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GeofenceZone_schoolId_idx" ON "GeofenceZone"("schoolId");
CREATE INDEX "GeofenceZone_schoolId_type_idx" ON "GeofenceZone"("schoolId", "type");
CREATE INDEX "GeofenceZone_schoolId_active_idx" ON "GeofenceZone"("schoolId", "active");
CREATE INDEX "GeofenceZone_campusId_idx" ON "GeofenceZone"("campusId");
CREATE INDEX "GeofenceZone_schoolId_campusId_type_active_idx"
  ON "GeofenceZone"("schoolId", "campusId", "type", "active");

CREATE UNIQUE INDEX "GeofenceVertex_zoneId_sequence_key" ON "GeofenceVertex"("zoneId", "sequence");
CREATE INDEX "GeofenceVertex_schoolId_idx" ON "GeofenceVertex"("schoolId");
CREATE INDEX "GeofenceVertex_zoneId_idx" ON "GeofenceVertex"("zoneId");

ALTER TABLE "GeofenceZone"
  ADD CONSTRAINT "GeofenceZone_schoolId_fkey"
  FOREIGN KEY ("schoolId") REFERENCES "School"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GeofenceZone"
  ADD CONSTRAINT "GeofenceZone_campusId_fkey"
  FOREIGN KEY ("campusId") REFERENCES "EduClockCampus"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "GeofenceVertex"
  ADD CONSTRAINT "GeofenceVertex_schoolId_fkey"
  FOREIGN KEY ("schoolId") REFERENCES "School"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GeofenceVertex"
  ADD CONSTRAINT "GeofenceVertex_zoneId_fkey"
  FOREIGN KEY ("zoneId") REFERENCES "GeofenceZone"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
