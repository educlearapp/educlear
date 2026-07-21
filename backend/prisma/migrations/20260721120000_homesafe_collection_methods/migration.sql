-- Expand HomeSafe "Collected by" options while preserving legacy TRANSPORT values.
-- Additive only: no table rewrite, no data copy, no destructive cast.
ALTER TYPE "HomeSafeCollectionMethod" ADD VALUE 'UNCLE';
ALTER TYPE "HomeSafeCollectionMethod" ADD VALUE 'SIBLING';
ALTER TYPE "HomeSafeCollectionMethod" ADD VALUE 'GRANDPARENT';
ALTER TYPE "HomeSafeCollectionMethod" ADD VALUE 'BOLT';
ALTER TYPE "HomeSafeCollectionMethod" ADD VALUE 'SCHOOL_TRANSPORT';
ALTER TYPE "HomeSafeCollectionMethod" ADD VALUE 'TAXI';
ALTER TYPE "HomeSafeCollectionMethod" ADD VALUE 'OTHER';

-- Optional note for OTHER collector (additive nullable column).
ALTER TABLE "HomeSafeEvent" ADD COLUMN "collectionNote" TEXT;
