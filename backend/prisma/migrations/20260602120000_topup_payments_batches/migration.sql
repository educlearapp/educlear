-- CreateTable
CREATE TABLE "MigrationTopupPaymentBatch" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedBy" TEXT NOT NULL DEFAULT '',
    "sourceFilename" TEXT NOT NULL DEFAULT '',
    "rowsImported" INTEGER NOT NULL DEFAULT 0,
    "rowsSkipped" INTEGER NOT NULL DEFAULT 0,
    "totalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rolledBackAt" TIMESTAMP(3),
    "rolledBackBy" TEXT,

    CONSTRAINT "MigrationTopupPaymentBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MigrationTopupPaymentRow" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "accountNo" TEXT NOT NULL DEFAULT '',
    "receiptNo" TEXT NOT NULL DEFAULT '',
    "transactionDate" TEXT NOT NULL DEFAULT '',
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paymentType" TEXT NOT NULL DEFAULT '',
    "ledgerEntryId" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'preview',
    "reason" TEXT NOT NULL DEFAULT '',
    "rawRow" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MigrationTopupPaymentRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MigrationTopupPaymentBatch_schoolId_idx" ON "MigrationTopupPaymentBatch"("schoolId");

-- CreateIndex
CREATE INDEX "MigrationTopupPaymentBatch_schoolId_uploadedAt_idx" ON "MigrationTopupPaymentBatch"("schoolId", "uploadedAt");

-- CreateIndex
CREATE INDEX "MigrationTopupPaymentRow_schoolId_idx" ON "MigrationTopupPaymentRow"("schoolId");

-- CreateIndex
CREATE INDEX "MigrationTopupPaymentRow_batchId_idx" ON "MigrationTopupPaymentRow"("batchId");

-- CreateIndex
CREATE INDEX "MigrationTopupPaymentRow_schoolId_transactionDate_idx" ON "MigrationTopupPaymentRow"("schoolId", "transactionDate");

-- CreateIndex
CREATE INDEX "MigrationTopupPaymentRow_schoolId_ledgerEntryId_idx" ON "MigrationTopupPaymentRow"("schoolId", "ledgerEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "MigrationTopupPaymentRow_schoolId_fingerprint_key" ON "MigrationTopupPaymentRow"("schoolId", "fingerprint");

-- AddForeignKey
ALTER TABLE "MigrationTopupPaymentBatch" ADD CONSTRAINT "MigrationTopupPaymentBatch_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MigrationTopupPaymentRow" ADD CONSTRAINT "MigrationTopupPaymentRow_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MigrationTopupPaymentRow" ADD CONSTRAINT "MigrationTopupPaymentRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "MigrationTopupPaymentBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

