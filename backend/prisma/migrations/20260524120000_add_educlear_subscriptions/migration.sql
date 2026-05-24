-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "EduClearPackageCode" AS ENUM ('STARTER', 'UNLIMITED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "SchoolSubscriptionStatus" AS ENUM ('PENDING_PAYMENT', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'SUSPENDED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "SubscriptionInvoiceStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "SubscriptionPaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "PaymentGatewayProvider" AS ENUM ('PAYFAST', 'OZOW');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "EduClearPackage" (
    "id" TEXT NOT NULL,
    "code" "EduClearPackageCode" NOT NULL,
    "name" TEXT NOT NULL,
    "monthlyPriceCents" INTEGER NOT NULL,
    "learnerLimit" INTEGER,
    "payrollStaffLimit" INTEGER,
    "mostPopular" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EduClearPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "SchoolSubscription" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "packageCode" "EduClearPackageCode" NOT NULL,
    "status" "SchoolSubscriptionStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "SubscriptionInvoice" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'ZAR',
    "status" "SubscriptionInvoiceStatus" NOT NULL DEFAULT 'PENDING',
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "SubscriptionPaymentLog" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "gateway" "PaymentGatewayProvider" NOT NULL DEFAULT 'PAYFAST',
    "status" "SubscriptionPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "merchantPaymentId" TEXT NOT NULL,
    "gatewayPaymentId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "checkoutUrl" TEXT,
    "returnUrl" TEXT,
    "cancelUrl" TEXT,
    "notifyUrl" TEXT,
    "payerEmail" TEXT,
    "rawRequest" JSONB,
    "rawNotify" JSONB,
    "failureReason" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionPaymentLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "EduClearPackage_code_key" ON "EduClearPackage"("code");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "SchoolSubscription_schoolId_key" ON "SchoolSubscription"("schoolId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SchoolSubscription_status_idx" ON "SchoolSubscription"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SchoolSubscription_packageCode_idx" ON "SchoolSubscription"("packageCode");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SubscriptionInvoice_schoolId_status_idx" ON "SubscriptionInvoice"("schoolId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SubscriptionInvoice_subscriptionId_idx" ON "SubscriptionInvoice"("subscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "SubscriptionInvoice_invoiceNumber_key" ON "SubscriptionInvoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SubscriptionPaymentLog_schoolId_createdAt_idx" ON "SubscriptionPaymentLog"("schoolId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SubscriptionPaymentLog_invoiceId_idx" ON "SubscriptionPaymentLog"("invoiceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SubscriptionPaymentLog_merchantPaymentId_idx" ON "SubscriptionPaymentLog"("merchantPaymentId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SubscriptionPaymentLog_status_idx" ON "SubscriptionPaymentLog"("status");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SchoolSubscription_schoolId_fkey') THEN
    ALTER TABLE "SchoolSubscription" ADD CONSTRAINT "SchoolSubscription_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SchoolSubscription_packageId_fkey') THEN
    ALTER TABLE "SchoolSubscription" ADD CONSTRAINT "SchoolSubscription_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "EduClearPackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SubscriptionInvoice_schoolId_fkey') THEN
    ALTER TABLE "SubscriptionInvoice" ADD CONSTRAINT "SubscriptionInvoice_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SubscriptionInvoice_subscriptionId_fkey') THEN
    ALTER TABLE "SubscriptionInvoice" ADD CONSTRAINT "SubscriptionInvoice_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "SchoolSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SubscriptionPaymentLog_schoolId_fkey') THEN
    ALTER TABLE "SubscriptionPaymentLog" ADD CONSTRAINT "SubscriptionPaymentLog_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SubscriptionPaymentLog_invoiceId_fkey') THEN
    ALTER TABLE "SubscriptionPaymentLog" ADD CONSTRAINT "SubscriptionPaymentLog_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SubscriptionInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

