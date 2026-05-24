-- CreateTable
CREATE TABLE IF NOT EXISTS "InvoiceRun" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "description" TEXT,
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "invoiceMonth" TEXT NOT NULL,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InvoiceRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Invoice" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "invoiceRunId" TEXT NOT NULL,
    "parentId" TEXT NOT NULL,
    "familyAccountId" TEXT,
    "learnerId" TEXT,
    "accountRef" TEXT,
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "InvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX IF NOT EXISTS "InvoiceRun_schoolId_idx" ON "InvoiceRun"("schoolId");
CREATE INDEX IF NOT EXISTS "InvoiceRun_schoolId_invoiceMonth_idx" ON "InvoiceRun"("schoolId", "invoiceMonth");
CREATE INDEX IF NOT EXISTS "InvoiceRun_createdAt_idx" ON "InvoiceRun"("createdAt");

CREATE INDEX IF NOT EXISTS "Invoice_schoolId_idx" ON "Invoice"("schoolId");
CREATE INDEX IF NOT EXISTS "Invoice_invoiceRunId_idx" ON "Invoice"("invoiceRunId");
CREATE INDEX IF NOT EXISTS "Invoice_parentId_idx" ON "Invoice"("parentId");
CREATE INDEX IF NOT EXISTS "Invoice_familyAccountId_idx" ON "Invoice"("familyAccountId");
CREATE INDEX IF NOT EXISTS "Invoice_learnerId_idx" ON "Invoice"("learnerId");
CREATE INDEX IF NOT EXISTS "Invoice_createdAt_idx" ON "Invoice"("createdAt");

CREATE INDEX IF NOT EXISTS "InvoiceLine_invoiceId_idx" ON "InvoiceLine"("invoiceId");

-- Foreign keys
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InvoiceRun_schoolId_fkey') THEN
    ALTER TABLE "InvoiceRun" ADD CONSTRAINT "InvoiceRun_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Invoice_schoolId_fkey') THEN
    ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Invoice_invoiceRunId_fkey') THEN
    ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_invoiceRunId_fkey" FOREIGN KEY ("invoiceRunId") REFERENCES "InvoiceRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Invoice_parentId_fkey') THEN
    ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Parent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Invoice_learnerId_fkey') THEN
    ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "Learner"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Invoice_familyAccountId_fkey') THEN
    ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_familyAccountId_fkey" FOREIGN KEY ("familyAccountId") REFERENCES "FamilyAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InvoiceLine_invoiceId_fkey') THEN
    ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

