"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const client_1 = require("@prisma/client");
const prisma_1 = require("../prisma");
const ensureEduClearCreditBundles_1 = require("../services/ensureEduClearCreditBundles");
const ensureEduClearPackages_1 = require("../services/ensureEduClearPackages");
const payfastService_1 = require("../services/payfastService");
async function smokeUnitChecks() {
    const sample = {
        merchant_id: "10000100",
        merchant_key: "46f0cd694581a",
        return_url: "https://example.com/return",
        cancel_url: "https://example.com/cancel",
        notify_url: "https://example.com/notify",
        name_first: "Test",
        name_last: "School",
        email_address: "billing@example.com",
        m_payment_id: "ec-sub-smoke-1",
        amount: "1500.00",
        item_name: "EduClear Starter subscription",
    };
    const signature = (0, payfastService_1.generatePayFastSignature)(sample, "jt7NOE43FZPn");
    if (!/^[a-f0-9]{32}$/.test(signature)) {
        throw new Error("Signature generation did not return an MD5 hex string");
    }
    console.log("[smoke-payfast] signature unit check OK", { signature });
    console.log("[smoke-payfast] formatPayFastAmount", (0, payfastService_1.formatPayFastAmount)(150000));
}
async function smokeSubscriptionCheckoutFlow() {
    try {
        (0, payfastService_1.loadPayFastConfig)();
    }
    catch (error) {
        console.warn("[smoke-payfast] Skipping subscription checkout flow — PayFast env not configured:", error instanceof Error ? error.message : error);
        return;
    }
    await (0, ensureEduClearPackages_1.ensureEduClearPackages)();
    const school = await prisma_1.prisma.school.findFirst({
        select: { id: true, name: true, email: true },
        orderBy: { createdAt: "asc" },
    });
    if (!school) {
        console.warn("[smoke-payfast] No school in database — skipping subscription checkout flow");
        return;
    }
    const pkg = await prisma_1.prisma.eduClearPackage.findFirst({
        where: { code: "STARTER", isActive: true },
    });
    if (!pkg) {
        throw new Error("STARTER package missing after ensureEduClearPackages");
    }
    const merchantPaymentId = `ec-sub-smoke-${Date.now()}`;
    const payerEmail = school.email || "billing-smoke@educlear.test";
    const paymentLog = await prisma_1.prisma.$transaction(async (tx) => {
        let subscription = await tx.schoolSubscription.findUnique({ where: { schoolId: school.id } });
        if (!subscription) {
            subscription = await tx.schoolSubscription.create({
                data: {
                    schoolId: school.id,
                    packageId: pkg.id,
                    packageCode: pkg.code,
                    status: client_1.SchoolSubscriptionStatus.PENDING_PAYMENT,
                },
            });
        }
        const invoice = await tx.subscriptionInvoice.create({
            data: {
                schoolId: school.id,
                subscriptionId: subscription.id,
                invoiceNumber: `EC-SUB-SMOKE-${Date.now()}`,
                amountCents: pkg.monthlyPriceCents,
                dueAt: new Date(),
            },
        });
        return tx.subscriptionPaymentLog.create({
            data: {
                schoolId: school.id,
                invoiceId: invoice.id,
                status: client_1.SubscriptionPaymentStatus.PENDING,
                merchantPaymentId,
                amountCents: pkg.monthlyPriceCents,
                payerEmail,
            },
        });
    });
    const checkout = (0, payfastService_1.buildPayFastCheckout)({
        merchantPaymentId,
        amountCents: pkg.monthlyPriceCents,
        itemName: `EduClear ${pkg.name} subscription`,
        payerEmail,
        payerFirstName: "Smoke",
        payerLastName: "Test",
        customStr1: paymentLog.id,
        customStr3: "SUBSCRIPTION",
    });
    if (!checkout.payload.signature) {
        throw new Error("Subscription checkout payload missing signature");
    }
    console.log("[smoke-payfast] subscription checkout flow OK", {
        schoolId: school.id,
        paymentLogId: paymentLog.id,
        paymentUrl: checkout.paymentUrl,
        merchantPaymentId,
    });
    await prisma_1.prisma.subscriptionPaymentLog.delete({ where: { id: paymentLog.id } });
    await prisma_1.prisma.subscriptionInvoice.delete({ where: { id: paymentLog.invoiceId } });
    console.log("[smoke-payfast] cleaned up smoke subscription invoice/payment log rows");
}
async function smokeCreditsCheckoutFlow() {
    try {
        (0, payfastService_1.loadPayFastConfig)();
    }
    catch (error) {
        console.warn("[smoke-payfast] Skipping credits checkout flow — PayFast env not configured:", error instanceof Error ? error.message : error);
        return;
    }
    await (0, ensureEduClearCreditBundles_1.ensureEduClearCreditBundles)();
    const school = await prisma_1.prisma.school.findFirst({
        select: { id: true, name: true, email: true },
        orderBy: { createdAt: "asc" },
    });
    if (!school) {
        console.warn("[smoke-payfast] No school in database — skipping credits checkout flow");
        return;
    }
    const bundle = await prisma_1.prisma.eduClearCreditBundle.findFirst({
        where: { code: "FOUNDATION", isActive: true },
    });
    if (!bundle) {
        throw new Error("FOUNDATION bundle missing after ensureEduClearCreditBundles");
    }
    const merchantPaymentId = `ec-crd-smoke-${Date.now()}`;
    const payerEmail = school.email || "billing-smoke@educlear.test";
    const paymentLog = await prisma_1.prisma.$transaction(async (tx) => {
        const invoice = await tx.creditPurchaseInvoice.create({
            data: {
                schoolId: school.id,
                bundleId: bundle.id,
                bundleCode: bundle.code,
                invoiceNumber: `EC-CRD-SMOKE-${Date.now()}`,
                amountCents: bundle.priceCents,
                smsCredits: bundle.smsCredits,
            },
        });
        return tx.creditPurchasePaymentLog.create({
            data: {
                schoolId: school.id,
                invoiceId: invoice.id,
                status: client_1.CreditPurchasePaymentStatus.PENDING,
                merchantPaymentId,
                amountCents: bundle.priceCents,
                payerEmail,
            },
        });
    });
    const checkout = (0, payfastService_1.buildPayFastCheckout)({
        merchantPaymentId,
        amountCents: bundle.priceCents,
        itemName: `EduClear ${bundle.name} SMS credits`,
        payerEmail,
        payerFirstName: "Smoke",
        payerLastName: "Test",
        customStr1: paymentLog.id,
        customStr3: "CREDITS",
    });
    if (!checkout.payload.signature) {
        throw new Error("Credits checkout payload missing signature");
    }
    console.log("[smoke-payfast] credits checkout flow OK", {
        schoolId: school.id,
        paymentLogId: paymentLog.id,
        paymentUrl: checkout.paymentUrl,
        merchantPaymentId,
        smsCredits: bundle.smsCredits,
    });
    await prisma_1.prisma.creditPurchasePaymentLog.delete({ where: { id: paymentLog.id } });
    await prisma_1.prisma.creditPurchaseInvoice.delete({ where: { id: paymentLog.invoiceId } });
    console.log("[smoke-payfast] cleaned up smoke credits invoice/payment log rows");
}
async function run() {
    await smokeUnitChecks();
    await smokeSubscriptionCheckoutFlow();
    await smokeCreditsCheckoutFlow();
    console.log("[smoke-payfast] done");
}
run()
    .catch((error) => {
    console.error(error);
    process.exit(1);
})
    .finally(async () => {
    await prisma_1.prisma.$disconnect();
});
