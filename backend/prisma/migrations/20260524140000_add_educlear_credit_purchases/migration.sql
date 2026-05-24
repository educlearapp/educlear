-- CreateEnum
CREATE TYPE "EduClearCreditBundleCode" AS ENUM ('FOUNDATION', 'GROWTH', 'PROFESSIONAL', 'ELITE');

-- CreateEnum
CREATE TYPE "CreditPurchaseInvoiceStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CreditPurchasePaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "EduClearCreditBundle" (
    "id" TEXT NOT NULL,
    "code" "EduClearCreditBundleCode" NOT NULL,
    "name" TEXT NOT NULL,
    "smsCredits" INTEGER NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "mostPopular" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EduClearCreditBundle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditPurchaseInvoice" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "bundleCode" "EduClearCreditBundleCode" NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "smsCredits" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'ZAR',
    "status" "CreditPurchaseInvoiceStatus" NOT NULL DEFAULT 'PENDING',
    "creditsGrantedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditPurchaseInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditPurchasePaymentLog" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "gateway" "PaymentGatewayProvider" NOT NULL DEFAULT 'PAYFAST',
    "status" "CreditPurchasePaymentStatus" NOT NULL DEFAULT 'PENDING',
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

    CONSTRAINT "CreditPurchasePaymentLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EduClearCreditBundle_code_key" ON "EduClearCreditBundle"("code");

-- CreateIndex
CREATE UNIQUE INDEX "CreditPurchaseInvoice_invoiceNumber_key" ON "CreditPurchaseInvoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "CreditPurchaseInvoice_schoolId_status_idx" ON "CreditPurchaseInvoice"("schoolId", "status");

-- CreateIndex
CREATE INDEX "CreditPurchaseInvoice_bundleCode_idx" ON "CreditPurchaseInvoice"("bundleCode");

-- CreateIndex
CREATE INDEX "CreditPurchasePaymentLog_schoolId_createdAt_idx" ON "CreditPurchasePaymentLog"("schoolId", "createdAt");

-- CreateIndex
CREATE INDEX "CreditPurchasePaymentLog_invoiceId_idx" ON "CreditPurchasePaymentLog"("invoiceId");

-- CreateIndex
CREATE INDEX "CreditPurchasePaymentLog_merchantPaymentId_idx" ON "CreditPurchasePaymentLog"("merchantPaymentId");

-- CreateIndex
CREATE INDEX "CreditPurchasePaymentLog_status_idx" ON "CreditPurchasePaymentLog"("status");

-- AddForeignKey
ALTER TABLE "CreditPurchaseInvoice" ADD CONSTRAINT "CreditPurchaseInvoice_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditPurchaseInvoice" ADD CONSTRAINT "CreditPurchaseInvoice_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "EduClearCreditBundle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditPurchasePaymentLog" ADD CONSTRAINT "CreditPurchasePaymentLog_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditPurchasePaymentLog" ADD CONSTRAINT "CreditPurchasePaymentLog_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "CreditPurchaseInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
