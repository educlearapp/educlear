-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "SupplierStatus" AS ENUM ('active', 'inactive');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "SupplierInvoiceStatus" AS ENUM ('pending', 'approved', 'partially_paid', 'paid');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "Supplier" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "contactPerson" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "vatNumber" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "status" "SupplierStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ExpenseCategory" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpenseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "SupplierInvoice" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "vatAmount" DECIMAL(14,2) NOT NULL,
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "outstandingAmount" DECIMAL(14,2) NOT NULL,
    "status" "SupplierInvoiceStatus" NOT NULL DEFAULT 'pending',
    "notes" TEXT NOT NULL DEFAULT '',
    "linkedBankTransactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "SupplierInvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,4) NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "lineTotal" DECIMAL(14,2) NOT NULL,
    "expenseCategoryId" TEXT,

    CONSTRAINT "SupplierInvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "SupplierInvoicePayment" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reference" TEXT NOT NULL DEFAULT '',
    "method" TEXT NOT NULL DEFAULT 'EFT',
    "notes" TEXT NOT NULL DEFAULT '',
    "bankTransactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierInvoicePayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AccountingJournal" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "journalNo" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "reference" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'Posted',
    "sourceModule" TEXT,
    "sourceId" TEXT,
    "sourceFingerprint" TEXT,
    "createdBy" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountingJournal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AccountingJournalLine" (
    "id" TEXT NOT NULL,
    "journalId" TEXT NOT NULL,
    "accountCode" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "memo" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "AccountingJournalLine_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "BankTransaction" ADD COLUMN IF NOT EXISTS "suggestedInvoiceId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "BankTransaction" ADD COLUMN IF NOT EXISTS "suggestedInvoiceNumber" TEXT NOT NULL DEFAULT '';
ALTER TABLE "BankTransaction" ADD COLUMN IF NOT EXISTS "invoiceMatchScore" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Supplier_schoolId_idx" ON "Supplier"("schoolId");
CREATE INDEX IF NOT EXISTS "Supplier_schoolId_supplierName_idx" ON "Supplier"("schoolId", "supplierName");
CREATE INDEX IF NOT EXISTS "Supplier_schoolId_status_idx" ON "Supplier"("schoolId", "status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ExpenseCategory_schoolId_code_key" ON "ExpenseCategory"("schoolId", "code");
CREATE INDEX IF NOT EXISTS "ExpenseCategory_schoolId_idx" ON "ExpenseCategory"("schoolId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SupplierInvoice_schoolId_idx" ON "SupplierInvoice"("schoolId");
CREATE INDEX IF NOT EXISTS "SupplierInvoice_schoolId_status_idx" ON "SupplierInvoice"("schoolId", "status");
CREATE INDEX IF NOT EXISTS "SupplierInvoice_schoolId_dueDate_idx" ON "SupplierInvoice"("schoolId", "dueDate");
CREATE INDEX IF NOT EXISTS "SupplierInvoice_supplierId_idx" ON "SupplierInvoice"("supplierId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SupplierInvoiceLine_invoiceId_idx" ON "SupplierInvoiceLine"("invoiceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SupplierInvoicePayment_schoolId_idx" ON "SupplierInvoicePayment"("schoolId");
CREATE INDEX IF NOT EXISTS "SupplierInvoicePayment_invoiceId_idx" ON "SupplierInvoicePayment"("invoiceId");
CREATE INDEX IF NOT EXISTS "SupplierInvoicePayment_bankTransactionId_idx" ON "SupplierInvoicePayment"("bankTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AccountingJournal_schoolId_sourceFingerprint_key" ON "AccountingJournal"("schoolId", "sourceFingerprint");
CREATE INDEX IF NOT EXISTS "AccountingJournal_schoolId_idx" ON "AccountingJournal"("schoolId");
CREATE INDEX IF NOT EXISTS "AccountingJournal_schoolId_date_idx" ON "AccountingJournal"("schoolId", "date");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AccountingJournalLine_journalId_idx" ON "AccountingJournalLine"("journalId");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Supplier_schoolId_fkey') THEN
    ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ExpenseCategory_schoolId_fkey') THEN
    ALTER TABLE "ExpenseCategory" ADD CONSTRAINT "ExpenseCategory_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SupplierInvoice_schoolId_fkey') THEN
    ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SupplierInvoice_supplierId_fkey') THEN
    ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SupplierInvoiceLine_invoiceId_fkey') THEN
    ALTER TABLE "SupplierInvoiceLine" ADD CONSTRAINT "SupplierInvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SupplierInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SupplierInvoiceLine_expenseCategoryId_fkey') THEN
    ALTER TABLE "SupplierInvoiceLine" ADD CONSTRAINT "SupplierInvoiceLine_expenseCategoryId_fkey" FOREIGN KEY ("expenseCategoryId") REFERENCES "ExpenseCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SupplierInvoicePayment_invoiceId_fkey') THEN
    ALTER TABLE "SupplierInvoicePayment" ADD CONSTRAINT "SupplierInvoicePayment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SupplierInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AccountingJournal_schoolId_fkey') THEN
    ALTER TABLE "AccountingJournal" ADD CONSTRAINT "AccountingJournal_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AccountingJournalLine_journalId_fkey') THEN
    ALTER TABLE "AccountingJournalLine" ADD CONSTRAINT "AccountingJournalLine_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "AccountingJournal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
