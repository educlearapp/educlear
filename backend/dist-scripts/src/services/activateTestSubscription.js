"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TEST_SUBSCRIPTION_ACTIVATION_SOURCE = void 0;
exports.activateSchoolSubscriptionTestMode = activateSchoolSubscriptionTestMode;
const client_1 = require("@prisma/client");
const prisma_1 = require("../prisma");
const ensureEduClearPackages_1 = require("./ensureEduClearPackages");
const payfastService_1 = require("./payfastService");
exports.TEST_SUBSCRIPTION_ACTIVATION_SOURCE = "test_mode_no_payfast";
function parsePackageCode(raw) {
    const normalized = String(raw || "").trim().toUpperCase();
    if (normalized === "STARTER" || normalized === "UNLIMITED") {
        return normalized;
    }
    return null;
}
async function nextSubscriptionInvoiceNumber(schoolId) {
    const prefix = `EC-SUB-${schoolId.slice(0, 6).toUpperCase()}`;
    const latest = await prisma_1.prisma.subscriptionInvoice.findFirst({
        where: { invoiceNumber: { startsWith: prefix } },
        orderBy: { createdAt: "desc" },
        select: { invoiceNumber: true },
    });
    if (!latest) {
        return `${prefix}-0001`;
    }
    const match = latest.invoiceNumber.match(/-(\d+)$/);
    const nextSeq = match ? Number.parseInt(match[1], 10) + 1 : 1;
    return `${prefix}-${String(nextSeq).padStart(4, "0")}`;
}
async function activateSchoolSubscriptionTestMode(opts) {
    const schoolId = String(opts.schoolId || "").trim();
    if (!schoolId) {
        throw new Error("schoolId is required");
    }
    const school = await prisma_1.prisma.school.findUnique({
        where: { id: schoolId },
        select: { id: true, name: true, email: true },
    });
    if (!school) {
        throw new Error("School not found");
    }
    await (0, ensureEduClearPackages_1.ensureEduClearPackages)();
    const packageCode = parsePackageCode(opts.packageCode) ?? "UNLIMITED";
    const pkg = await prisma_1.prisma.eduClearPackage.findFirst({
        where: { code: packageCode, isActive: true },
    });
    if (!pkg) {
        throw new Error(`Package ${packageCode} not found or inactive`);
    }
    const activationSource = String(opts.activationSource || exports.TEST_SUBSCRIPTION_ACTIVATION_SOURCE).trim();
    const activatedAt = new Date();
    const currentPeriodStart = activatedAt;
    const currentPeriodEnd = (0, payfastService_1.addOneCalendarMonth)(activatedAt);
    const invoiceNumber = await nextSubscriptionInvoiceNumber(schoolId);
    const merchantPaymentId = `ec-sub-test-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const result = await prisma_1.prisma.$transaction(async (tx) => {
        const subscription = await tx.schoolSubscription.upsert({
            where: { schoolId },
            create: {
                schoolId,
                packageId: pkg.id,
                packageCode: pkg.code,
                status: client_1.SchoolSubscriptionStatus.ACTIVE,
                activationSource,
                currentPeriodStart,
                currentPeriodEnd,
                activatedAt,
                cancelledAt: null,
            },
            update: {
                packageId: pkg.id,
                packageCode: pkg.code,
                status: client_1.SchoolSubscriptionStatus.ACTIVE,
                activationSource,
                currentPeriodStart,
                currentPeriodEnd,
                activatedAt,
                cancelledAt: null,
            },
        });
        const invoice = await tx.subscriptionInvoice.create({
            data: {
                schoolId,
                subscriptionId: subscription.id,
                invoiceNumber,
                amountCents: pkg.monthlyPriceCents,
                currency: "ZAR",
                status: client_1.SubscriptionInvoiceStatus.PAID,
                periodStart: currentPeriodStart,
                periodEnd: currentPeriodEnd,
                dueAt: activatedAt,
                paidAt: activatedAt,
            },
        });
        await tx.subscriptionPaymentLog.create({
            data: {
                schoolId,
                invoiceId: invoice.id,
                status: client_1.SubscriptionPaymentStatus.PAID,
                merchantPaymentId,
                amountCents: pkg.monthlyPriceCents,
                payerEmail: school.email || undefined,
                paidAt: activatedAt,
                rawRequest: {
                    source: activationSource,
                    activatedByUserId: opts.activatedByUserId,
                    packageCode: pkg.code,
                    invoiceNumber,
                },
            },
        });
        return { subscription, invoice, package: pkg };
    });
    console.log(`[subscriptions] test activate school=${schoolId} package=${result.package.code} source=${activationSource}`);
    return result;
}
