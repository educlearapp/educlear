-- CreateTable
CREATE TABLE IF NOT EXISTS "LateFineRun" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "invoiceRunId" TEXT NOT NULL,
    "uniqueKey" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT 'Late payment fine',
    "note" TEXT,
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "fineAmountCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LateFineRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "LateFineRunItem" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "lateFineRunId" TEXT NOT NULL,
    "parentId" TEXT NOT NULL,
    "familyAccountId" TEXT,
    "invoiceId" TEXT NOT NULL,
    "invoiceLineId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "previousOutstandingAmount" DOUBLE PRECISION NOT NULL,
    "newOutstandingAmount" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LateFineRunItem_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX IF NOT EXISTS "LateFineRun_schoolId_idx" ON "LateFineRun"("schoolId");
CREATE INDEX IF NOT EXISTS "LateFineRun_invoiceRunId_idx" ON "LateFineRun"("invoiceRunId");
CREATE INDEX IF NOT EXISTS "LateFineRun_createdAt_idx" ON "LateFineRun"("createdAt");

CREATE INDEX IF NOT EXISTS "LateFineRunItem_schoolId_idx" ON "LateFineRunItem"("schoolId");
CREATE INDEX IF NOT EXISTS "LateFineRunItem_lateFineRunId_idx" ON "LateFineRunItem"("lateFineRunId");
CREATE INDEX IF NOT EXISTS "LateFineRunItem_parentId_idx" ON "LateFineRunItem"("parentId");
CREATE INDEX IF NOT EXISTS "LateFineRunItem_invoiceId_idx" ON "LateFineRunItem"("invoiceId");
CREATE INDEX IF NOT EXISTS "LateFineRunItem_createdAt_idx" ON "LateFineRunItem"("createdAt");

-- Uniques
CREATE UNIQUE INDEX IF NOT EXISTS "LateFineRun_schoolId_uniqueKey_key" ON "LateFineRun"("schoolId", "uniqueKey");
CREATE UNIQUE INDEX IF NOT EXISTS "LateFineRunItem_lateFineRunId_parentId_key" ON "LateFineRunItem"("lateFineRunId", "parentId");

-- Foreign keys
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LateFineRun_schoolId_fkey') THEN
    ALTER TABLE "LateFineRun" ADD CONSTRAINT "LateFineRun_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LateFineRun_invoiceRunId_fkey') THEN
    ALTER TABLE "LateFineRun" ADD CONSTRAINT "LateFineRun_invoiceRunId_fkey" FOREIGN KEY ("invoiceRunId") REFERENCES "InvoiceRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LateFineRunItem_schoolId_fkey') THEN
    ALTER TABLE "LateFineRunItem" ADD CONSTRAINT "LateFineRunItem_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LateFineRunItem_lateFineRunId_fkey') THEN
    ALTER TABLE "LateFineRunItem" ADD CONSTRAINT "LateFineRunItem_lateFineRunId_fkey" FOREIGN KEY ("lateFineRunId") REFERENCES "LateFineRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LateFineRunItem_parentId_fkey') THEN
    ALTER TABLE "LateFineRunItem" ADD CONSTRAINT "LateFineRunItem_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Parent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LateFineRunItem_familyAccountId_fkey') THEN
    ALTER TABLE "LateFineRunItem" ADD CONSTRAINT "LateFineRunItem_familyAccountId_fkey" FOREIGN KEY ("familyAccountId") REFERENCES "FamilyAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LateFineRunItem_invoiceId_fkey') THEN
    ALTER TABLE "LateFineRunItem" ADD CONSTRAINT "LateFineRunItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

