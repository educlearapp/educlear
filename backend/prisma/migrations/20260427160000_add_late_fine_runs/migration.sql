-- CreateTable
CREATE TABLE "LateFineRun" (
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
CREATE TABLE "LateFineRunItem" (
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
CREATE INDEX "LateFineRun_schoolId_idx" ON "LateFineRun"("schoolId");
CREATE INDEX "LateFineRun_invoiceRunId_idx" ON "LateFineRun"("invoiceRunId");
CREATE INDEX "LateFineRun_createdAt_idx" ON "LateFineRun"("createdAt");

CREATE INDEX "LateFineRunItem_schoolId_idx" ON "LateFineRunItem"("schoolId");
CREATE INDEX "LateFineRunItem_lateFineRunId_idx" ON "LateFineRunItem"("lateFineRunId");
CREATE INDEX "LateFineRunItem_parentId_idx" ON "LateFineRunItem"("parentId");
CREATE INDEX "LateFineRunItem_invoiceId_idx" ON "LateFineRunItem"("invoiceId");
CREATE INDEX "LateFineRunItem_createdAt_idx" ON "LateFineRunItem"("createdAt");

-- Uniques
CREATE UNIQUE INDEX "LateFineRun_schoolId_uniqueKey_key" ON "LateFineRun"("schoolId", "uniqueKey");
CREATE UNIQUE INDEX "LateFineRunItem_lateFineRunId_parentId_key" ON "LateFineRunItem"("lateFineRunId", "parentId");

-- Foreign keys
ALTER TABLE "LateFineRun" ADD CONSTRAINT "LateFineRun_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LateFineRun" ADD CONSTRAINT "LateFineRun_invoiceRunId_fkey" FOREIGN KEY ("invoiceRunId") REFERENCES "InvoiceRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LateFineRunItem" ADD CONSTRAINT "LateFineRunItem_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LateFineRunItem" ADD CONSTRAINT "LateFineRunItem_lateFineRunId_fkey" FOREIGN KEY ("lateFineRunId") REFERENCES "LateFineRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LateFineRunItem" ADD CONSTRAINT "LateFineRunItem_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Parent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LateFineRunItem" ADD CONSTRAINT "LateFineRunItem_familyAccountId_fkey" FOREIGN KEY ("familyAccountId") REFERENCES "FamilyAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LateFineRunItem" ADD CONSTRAINT "LateFineRunItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

