"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const express_2 = __importDefault(require("express"));
const client_1 = require("@prisma/client");
const prisma_1 = require("../prisma");
const ensureEduClearCreditBundles_1 = require("../services/ensureEduClearCreditBundles");
const ensureEduClearPackages_1 = require("../services/ensureEduClearPackages");
const payfastService_1 = require("../services/payfastService");
const communicationCreditsStore_1 = require("../utils/communicationCreditsStore");
const router = (0, express_1.Router)();
function parseCheckoutType(raw, packageCode, bundleCode) {
    const normalized = String(raw || "")
        .trim()
        .toUpperCase();
    if (normalized === "SUBSCRIPTION" || normalized === "CREDITS") {
        return normalized;
    }
    if (parseBundleCode(bundleCode)) {
        return "CREDITS";
    }
    if (parsePackageCode(String(packageCode || ""))) {
        return "SUBSCRIPTION";
    }
    return null;
}
function parsePackageCode(raw) {
    const normalized = String(raw || "").trim().toUpperCase();
    if (normalized === "STARTER" || normalized === "UNLIMITED") {
        return normalized;
    }
    return null;
}
function parseBundleCode(raw) {
    const normalized = String(raw || "").trim().toUpperCase();
    if (normalized === "FOUNDATION" ||
        normalized === "GROWTH" ||
        normalized === "PROFESSIONAL" ||
        normalized === "ELITE") {
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
async function nextCreditPurchaseInvoiceNumber(schoolId) {
    const prefix = `EC-CRD-${schoolId.slice(0, 6).toUpperCase()}`;
    const latest = await prisma_1.prisma.creditPurchaseInvoice.findFirst({
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
function clientIpFromRequest(req) {
    const forwarded = String(req.headers["x-forwarded-for"] || "")
        .split(",")[0]
        ?.trim();
    return forwarded || req.socket.remoteAddress || "";
}
async function createSubscriptionCheckout(req, res, config) {
    const schoolId = String(req.body?.schoolId || "").trim();
    const packageCode = parsePackageCode(String(req.body?.packageCode || ""));
    if (!schoolId || !packageCode) {
        return res.status(400).json({
            success: false,
            error: "schoolId and packageCode (STARTER | UNLIMITED) are required for subscription checkout",
        });
    }
    await (0, ensureEduClearPackages_1.ensureEduClearPackages)();
    const [school, pkg] = await Promise.all([
        prisma_1.prisma.school.findUnique({
            where: { id: schoolId },
            select: { id: true, name: true, email: true, phone: true, cellNo: true },
        }),
        prisma_1.prisma.eduClearPackage.findFirst({
            where: { code: packageCode, isActive: true },
        }),
    ]);
    if (!school) {
        return res.status(404).json({ success: false, error: "School not found" });
    }
    if (!pkg) {
        return res.status(404).json({ success: false, error: "Package not found or inactive" });
    }
    const payerEmail = String(req.body?.payerEmail || school.email || "").trim();
    if (!payerEmail) {
        return res.status(400).json({
            success: false,
            error: "School has no billing email; provide payerEmail",
        });
    }
    const now = new Date();
    const invoiceNumber = await nextSubscriptionInvoiceNumber(schoolId);
    const merchantPaymentId = `ec-sub-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const { first, last } = (0, payfastService_1.splitSchoolContactName)(school.name);
    const itemName = `EduClear ${pkg.name} subscription`;
    const itemDescription = pkg.description || `Monthly ${pkg.name} plan`;
    const result = await prisma_1.prisma.$transaction(async (tx) => {
        let subscription = await tx.schoolSubscription.findUnique({
            where: { schoolId },
        });
        if (!subscription) {
            subscription = await tx.schoolSubscription.create({
                data: {
                    schoolId,
                    packageId: pkg.id,
                    packageCode: pkg.code,
                    status: client_1.SchoolSubscriptionStatus.PENDING_PAYMENT,
                },
            });
        }
        else if (subscription.status === client_1.SchoolSubscriptionStatus.PENDING_PAYMENT &&
            (subscription.packageId !== pkg.id || subscription.packageCode !== pkg.code)) {
            subscription = await tx.schoolSubscription.update({
                where: { id: subscription.id },
                data: {
                    packageId: pkg.id,
                    packageCode: pkg.code,
                },
            });
        }
        const invoice = await tx.subscriptionInvoice.create({
            data: {
                schoolId,
                subscriptionId: subscription.id,
                invoiceNumber,
                amountCents: pkg.monthlyPriceCents,
                currency: "ZAR",
                status: client_1.SubscriptionInvoiceStatus.PENDING,
                dueAt: now,
                periodStart: null,
                periodEnd: null,
            },
        });
        const paymentLog = await tx.subscriptionPaymentLog.create({
            data: {
                schoolId,
                invoiceId: invoice.id,
                status: client_1.SubscriptionPaymentStatus.PENDING,
                merchantPaymentId,
                amountCents: pkg.monthlyPriceCents,
                checkoutUrl: config.processUrl,
                returnUrl: config.returnUrl,
                cancelUrl: config.cancelUrl,
                notifyUrl: config.notifyUrl,
                payerEmail,
                rawRequest: {
                    checkoutType: "SUBSCRIPTION",
                    schoolId,
                    packageCode: pkg.code,
                    invoiceNumber,
                },
            },
        });
        const checkout = (0, payfastService_1.buildPayFastCheckout)({
            merchantPaymentId,
            amountCents: pkg.monthlyPriceCents,
            itemName,
            itemDescription,
            payerEmail,
            payerFirstName: first,
            payerLastName: last,
            payerCell: school.cellNo || school.phone || undefined,
            customStr1: paymentLog.id,
            customStr2: invoice.id,
            customStr3: "SUBSCRIPTION",
        });
        await tx.subscriptionPaymentLog.update({
            where: { id: paymentLog.id },
            data: {
                rawRequest: {
                    checkoutType: "SUBSCRIPTION",
                    schoolId,
                    packageCode: pkg.code,
                    invoiceNumber,
                    checkoutPayload: checkout.payload,
                },
            },
        });
        return {
            subscription,
            invoice,
            paymentLog,
            checkout,
        };
    });
    return res.status(201).json({
        success: true,
        checkoutType: "SUBSCRIPTION",
        paymentUrl: result.checkout.paymentUrl,
        payload: result.checkout.payload,
        merchantPaymentId,
        paymentLogId: result.paymentLog.id,
        invoiceId: result.invoice.id,
        invoiceNumber: result.invoice.invoiceNumber,
        subscriptionId: result.subscription.id,
        amountCents: result.invoice.amountCents,
        packageCode: pkg.code,
    });
}
async function createCreditsCheckout(req, res, config) {
    const schoolId = String(req.body?.schoolId || "").trim();
    const bundleCode = parseBundleCode(req.body?.bundleCode);
    if (!schoolId || !bundleCode) {
        return res.status(400).json({
            success: false,
            error: "schoolId and bundleCode (FOUNDATION | GROWTH | PROFESSIONAL | ELITE) are required for credits checkout",
        });
    }
    await (0, ensureEduClearCreditBundles_1.ensureEduClearCreditBundles)();
    const [school, bundle] = await Promise.all([
        prisma_1.prisma.school.findUnique({
            where: { id: schoolId },
            select: { id: true, name: true, email: true, phone: true, cellNo: true },
        }),
        prisma_1.prisma.eduClearCreditBundle.findFirst({
            where: { code: bundleCode, isActive: true },
        }),
    ]);
    if (!school) {
        return res.status(404).json({ success: false, error: "School not found" });
    }
    if (!bundle) {
        return res.status(404).json({ success: false, error: "Credit bundle not found or inactive" });
    }
    const payerEmail = String(req.body?.payerEmail || school.email || "").trim();
    if (!payerEmail) {
        return res.status(400).json({
            success: false,
            error: "School has no billing email; provide payerEmail",
        });
    }
    const invoiceNumber = await nextCreditPurchaseInvoiceNumber(schoolId);
    const merchantPaymentId = `ec-crd-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const { first, last } = (0, payfastService_1.splitSchoolContactName)(school.name);
    const itemName = `EduClear ${bundle.name} SMS credits`;
    const itemDescription = bundle.description || `${bundle.smsCredits.toLocaleString("en-ZA")} SMS credits — once-off`;
    const result = await prisma_1.prisma.$transaction(async (tx) => {
        const invoice = await tx.creditPurchaseInvoice.create({
            data: {
                schoolId,
                bundleId: bundle.id,
                bundleCode: bundle.code,
                invoiceNumber,
                amountCents: bundle.priceCents,
                smsCredits: bundle.smsCredits,
                currency: "ZAR",
                status: client_1.CreditPurchaseInvoiceStatus.PENDING,
            },
        });
        const paymentLog = await tx.creditPurchasePaymentLog.create({
            data: {
                schoolId,
                invoiceId: invoice.id,
                status: client_1.CreditPurchasePaymentStatus.PENDING,
                merchantPaymentId,
                amountCents: bundle.priceCents,
                checkoutUrl: config.processUrl,
                returnUrl: config.returnUrl,
                cancelUrl: config.cancelUrl,
                notifyUrl: config.notifyUrl,
                payerEmail,
                rawRequest: {
                    checkoutType: "CREDITS",
                    schoolId,
                    bundleCode: bundle.code,
                    invoiceNumber,
                    smsCredits: bundle.smsCredits,
                },
            },
        });
        const checkout = (0, payfastService_1.buildPayFastCheckout)({
            merchantPaymentId,
            amountCents: bundle.priceCents,
            itemName,
            itemDescription,
            payerEmail,
            payerFirstName: first,
            payerLastName: last,
            payerCell: school.cellNo || school.phone || undefined,
            customStr1: paymentLog.id,
            customStr2: invoice.id,
            customStr3: "CREDITS",
        });
        await tx.creditPurchasePaymentLog.update({
            where: { id: paymentLog.id },
            data: {
                rawRequest: {
                    checkoutType: "CREDITS",
                    schoolId,
                    bundleCode: bundle.code,
                    invoiceNumber,
                    smsCredits: bundle.smsCredits,
                    checkoutPayload: checkout.payload,
                },
            },
        });
        return {
            invoice,
            paymentLog,
            checkout,
        };
    });
    return res.status(201).json({
        success: true,
        checkoutType: "CREDITS",
        paymentUrl: result.checkout.paymentUrl,
        payload: result.checkout.payload,
        merchantPaymentId,
        paymentLogId: result.paymentLog.id,
        invoiceId: result.invoice.id,
        invoiceNumber: result.invoice.invoiceNumber,
        amountCents: result.invoice.amountCents,
        bundleCode: bundle.code,
        smsCredits: bundle.smsCredits,
    });
}
router.post("/create-checkout", async (req, res) => {
    try {
        const checkoutType = parseCheckoutType(req.body?.checkoutType, req.body?.packageCode, req.body?.bundleCode);
        if (!checkoutType) {
            return res.status(400).json({
                success: false,
                error: "checkoutType (SUBSCRIPTION | CREDITS) is required, or provide packageCode / bundleCode",
            });
        }
        let config;
        try {
            config = (0, payfastService_1.loadPayFastConfig)();
        }
        catch (error) {
            if (error instanceof payfastService_1.PayFastConfigError) {
                return res.status(503).json({ success: false, error: error.message });
            }
            throw error;
        }
        if (checkoutType === "CREDITS") {
            return createCreditsCheckout(req, res, config);
        }
        return createSubscriptionCheckout(req, res, config);
    }
    catch (error) {
        console.error("[payfast] POST /create-checkout failed:", error);
        return res.status(500).json({ success: false, error: "Failed to create PayFast checkout" });
    }
});
async function handleSubscriptionItn(postData, merchantPaymentId, gatewayPaymentId, paymentStatus) {
    const paymentLog = await prisma_1.prisma.subscriptionPaymentLog.findFirst({
        where: { merchantPaymentId },
        include: {
            invoice: {
                include: {
                    subscription: true,
                },
            },
        },
    });
    if (!paymentLog) {
        return "not_found";
    }
    if (!(0, payfastService_1.amountsMatch)(paymentLog.amountCents, postData.amount_gross)) {
        console.warn("[payfast] subscription ITN amount mismatch", {
            merchantPaymentId,
            expectedCents: paymentLog.amountCents,
            amount_gross: postData.amount_gross,
        });
        return "amount_mismatch";
    }
    await prisma_1.prisma.subscriptionPaymentLog.update({
        where: { id: paymentLog.id },
        data: {
            rawNotify: postData,
            gatewayPaymentId: gatewayPaymentId || paymentLog.gatewayPaymentId,
        },
    });
    if (paymentLog.status === client_1.SubscriptionPaymentStatus.PAID) {
        return "processed";
    }
    if ((0, payfastService_1.isPayFastPaymentComplete)(paymentStatus)) {
        const activatedAt = new Date();
        const currentPeriodStart = activatedAt;
        const currentPeriodEnd = (0, payfastService_1.addOneCalendarMonth)(activatedAt);
        await prisma_1.prisma.$transaction(async (tx) => {
            await tx.subscriptionPaymentLog.update({
                where: { id: paymentLog.id },
                data: {
                    status: client_1.SubscriptionPaymentStatus.PAID,
                    gatewayPaymentId,
                    paidAt: activatedAt,
                    failureReason: null,
                },
            });
            await tx.subscriptionInvoice.update({
                where: { id: paymentLog.invoiceId },
                data: {
                    status: client_1.SubscriptionInvoiceStatus.PAID,
                    paidAt: activatedAt,
                    periodStart: currentPeriodStart,
                    periodEnd: currentPeriodEnd,
                },
            });
            await tx.schoolSubscription.update({
                where: { id: paymentLog.invoice.subscriptionId },
                data: {
                    status: client_1.SchoolSubscriptionStatus.ACTIVE,
                    activatedAt,
                    currentPeriodStart,
                    currentPeriodEnd,
                    cancelledAt: null,
                },
            });
        });
        return "processed";
    }
    if ((0, payfastService_1.isPayFastPaymentFailed)(paymentStatus)) {
        const failureReason = `PayFast status: ${paymentStatus}`;
        await prisma_1.prisma.$transaction(async (tx) => {
            await tx.subscriptionPaymentLog.update({
                where: { id: paymentLog.id },
                data: {
                    status: client_1.SubscriptionPaymentStatus.FAILED,
                    gatewayPaymentId,
                    failureReason,
                },
            });
            await tx.subscriptionInvoice.update({
                where: { id: paymentLog.invoiceId },
                data: {
                    status: client_1.SubscriptionInvoiceStatus.FAILED,
                },
            });
        });
    }
    return "processed";
}
async function handleCreditsItn(postData, merchantPaymentId, gatewayPaymentId, paymentStatus) {
    const paymentLog = await prisma_1.prisma.creditPurchasePaymentLog.findFirst({
        where: { merchantPaymentId },
        include: {
            invoice: true,
        },
    });
    if (!paymentLog) {
        return "not_found";
    }
    if (!(0, payfastService_1.amountsMatch)(paymentLog.amountCents, postData.amount_gross)) {
        console.warn("[payfast] credits ITN amount mismatch", {
            merchantPaymentId,
            expectedCents: paymentLog.amountCents,
            amount_gross: postData.amount_gross,
        });
        return "amount_mismatch";
    }
    await prisma_1.prisma.creditPurchasePaymentLog.update({
        where: { id: paymentLog.id },
        data: {
            rawNotify: postData,
            gatewayPaymentId: gatewayPaymentId || paymentLog.gatewayPaymentId,
        },
    });
    if (paymentLog.status === client_1.CreditPurchasePaymentStatus.PAID) {
        return "processed";
    }
    if ((0, payfastService_1.isPayFastPaymentComplete)(paymentStatus)) {
        const paidAt = new Date();
        await prisma_1.prisma.$transaction(async (tx) => {
            await tx.creditPurchasePaymentLog.update({
                where: { id: paymentLog.id },
                data: {
                    status: client_1.CreditPurchasePaymentStatus.PAID,
                    gatewayPaymentId,
                    paidAt,
                    failureReason: null,
                },
            });
            await tx.creditPurchaseInvoice.update({
                where: { id: paymentLog.invoiceId },
                data: {
                    status: client_1.CreditPurchaseInvoiceStatus.PAID,
                    paidAt,
                    creditsGrantedAt: paidAt,
                },
            });
        });
        (0, communicationCreditsStore_1.grantSmsCreditsToSchool)(paymentLog.schoolId, paymentLog.invoice.smsCredits);
        return "processed";
    }
    if ((0, payfastService_1.isPayFastPaymentFailed)(paymentStatus)) {
        const failureReason = `PayFast status: ${paymentStatus}`;
        await prisma_1.prisma.$transaction(async (tx) => {
            await tx.creditPurchasePaymentLog.update({
                where: { id: paymentLog.id },
                data: {
                    status: client_1.CreditPurchasePaymentStatus.FAILED,
                    gatewayPaymentId,
                    failureReason,
                },
            });
            await tx.creditPurchaseInvoice.update({
                where: { id: paymentLog.invoiceId },
                data: {
                    status: client_1.CreditPurchaseInvoiceStatus.FAILED,
                },
            });
        });
    }
    return "processed";
}
router.post("/notify", express_2.default.urlencoded({ extended: false }), async (req, res) => {
    try {
        const postData = {};
        for (const [key, value] of Object.entries(req.body || {})) {
            postData[key] = String(value ?? "");
        }
        let config;
        try {
            config = (0, payfastService_1.loadPayFastConfig)();
        }
        catch (error) {
            console.error("[payfast] notify config error:", error);
            return res.status(503).end();
        }
        const paramString = (0, payfastService_1.buildItnParamString)(postData);
        const signatureValid = (0, payfastService_1.verifyPayFastItnSignature)(postData, config.passphrase);
        const sourceIpValid = await (0, payfastService_1.isPayFastNotifySourceIp)(clientIpFromRequest(req));
        const host = (0, payfastService_1.resolvePayFastHost)(config.merchantId, config.notifyUrl);
        const serverValid = await (0, payfastService_1.confirmPayFastItnWithServer)(paramString, host);
        if (!signatureValid || !sourceIpValid || !serverValid) {
            console.warn("[payfast] ITN security check failed", {
                signatureValid,
                sourceIpValid,
                serverValid,
                m_payment_id: postData.m_payment_id,
            });
            return res.status(400).end();
        }
        const merchantPaymentId = String(postData.m_payment_id || "").trim();
        const gatewayPaymentId = String(postData.pf_payment_id || "").trim() || null;
        const paymentStatus = String(postData.payment_status || "").trim();
        const checkoutTypeHint = String(postData.custom_str3 || "").trim().toUpperCase();
        if (!merchantPaymentId) {
            return res.status(400).end();
        }
        let result = "not_found";
        if (checkoutTypeHint === "CREDITS" || merchantPaymentId.startsWith("ec-crd-")) {
            result = await handleCreditsItn(postData, merchantPaymentId, gatewayPaymentId, paymentStatus);
        }
        else {
            result = await handleSubscriptionItn(postData, merchantPaymentId, gatewayPaymentId, paymentStatus);
        }
        if (result === "not_found") {
            result =
                checkoutTypeHint === "CREDITS" || merchantPaymentId.startsWith("ec-crd-")
                    ? await handleSubscriptionItn(postData, merchantPaymentId, gatewayPaymentId, paymentStatus)
                    : await handleCreditsItn(postData, merchantPaymentId, gatewayPaymentId, paymentStatus);
        }
        if (result === "amount_mismatch") {
            return res.status(400).end();
        }
        if (result === "not_found") {
            console.warn("[payfast] ITN for unknown merchantPaymentId:", merchantPaymentId);
            return res.status(404).end();
        }
        return res.status(200).end();
    }
    catch (error) {
        console.error("[payfast] POST /notify failed:", error);
        return res.status(500).end();
    }
});
exports.default = router;
