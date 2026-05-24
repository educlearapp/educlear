import { Router } from "express";
import express from "express";
import {
  CreditPurchaseInvoiceStatus,
  CreditPurchasePaymentStatus,
  EduClearCreditBundleCode,
  EduClearPackageCode,
  Prisma,
  SchoolSubscriptionStatus,
  SubscriptionInvoiceStatus,
  SubscriptionPaymentStatus,
} from "@prisma/client";

import { prisma } from "../prisma";
import { ensureEduClearCreditBundles } from "../services/ensureEduClearCreditBundles";
import { ensureEduClearPackages } from "../services/ensureEduClearPackages";
import {
  PayFastConfigError,
  addOneCalendarMonth,
  amountsMatch,
  buildPayFastCheckout,
  buildItnParamString,
  confirmPayFastItnWithServer,
  isPayFastNotifySourceIp,
  isPayFastPaymentComplete,
  isPayFastPaymentFailed,
  loadPayFastConfig,
  resolvePayFastHost,
  splitSchoolContactName,
  verifyPayFastItnSignature,
} from "../services/payfastService";
import { grantSmsCreditsToSchool } from "../utils/communicationCreditsStore";

const router = Router();

type PayFastCheckoutType = "SUBSCRIPTION" | "CREDITS";

function parseCheckoutType(raw: unknown, packageCode: unknown, bundleCode: unknown): PayFastCheckoutType | null {
  const normalized = String(raw || "")
    .trim()
    .toUpperCase();

  if (normalized === "SUBSCRIPTION" || normalized === "CREDITS") {
    return normalized as PayFastCheckoutType;
  }

  if (parseBundleCode(bundleCode)) {
    return "CREDITS";
  }
  if (parsePackageCode(String(packageCode || ""))) {
    return "SUBSCRIPTION";
  }

  return null;
}

function parsePackageCode(raw: string): EduClearPackageCode | null {
  const normalized = String(raw || "").trim().toUpperCase();
  if (normalized === "STARTER" || normalized === "UNLIMITED") {
    return normalized as EduClearPackageCode;
  }
  return null;
}

function parseBundleCode(raw: unknown): EduClearCreditBundleCode | null {
  const normalized = String(raw || "").trim().toUpperCase();
  if (
    normalized === "FOUNDATION" ||
    normalized === "GROWTH" ||
    normalized === "PROFESSIONAL" ||
    normalized === "ELITE"
  ) {
    return normalized as EduClearCreditBundleCode;
  }
  return null;
}

async function nextSubscriptionInvoiceNumber(schoolId: string): Promise<string> {
  const prefix = `EC-SUB-${schoolId.slice(0, 6).toUpperCase()}`;
  const latest = await prisma.subscriptionInvoice.findFirst({
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

async function nextCreditPurchaseInvoiceNumber(schoolId: string): Promise<string> {
  const prefix = `EC-CRD-${schoolId.slice(0, 6).toUpperCase()}`;
  const latest = await prisma.creditPurchaseInvoice.findFirst({
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

function clientIpFromRequest(req: express.Request): string {
  const forwarded = String(req.headers["x-forwarded-for"] || "")
    .split(",")[0]
    ?.trim();
  return forwarded || req.socket.remoteAddress || "";
}

async function createSubscriptionCheckout(
  req: express.Request,
  res: express.Response,
  config: ReturnType<typeof loadPayFastConfig>,
) {
  const schoolId = String(req.body?.schoolId || "").trim();
  const packageCode = parsePackageCode(String(req.body?.packageCode || ""));

  if (!schoolId || !packageCode) {
    return res.status(400).json({
      success: false,
      error: "schoolId and packageCode (STARTER | UNLIMITED) are required for subscription checkout",
    });
  }

  await ensureEduClearPackages();

  const [school, pkg] = await Promise.all([
    prisma.school.findUnique({
      where: { id: schoolId },
      select: { id: true, name: true, email: true, phone: true, cellNo: true },
    }),
    prisma.eduClearPackage.findFirst({
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

  const { first, last } = splitSchoolContactName(school.name);
  const itemName = `EduClear ${pkg.name} subscription`;
  const itemDescription = pkg.description || `Monthly ${pkg.name} plan`;

  const result = await prisma.$transaction(async (tx) => {
    let subscription = await tx.schoolSubscription.findUnique({
      where: { schoolId },
    });

    if (!subscription) {
      subscription = await tx.schoolSubscription.create({
        data: {
          schoolId,
          packageId: pkg.id,
          packageCode: pkg.code,
          status: SchoolSubscriptionStatus.PENDING_PAYMENT,
        },
      });
    } else if (
      subscription.status === SchoolSubscriptionStatus.PENDING_PAYMENT &&
      (subscription.packageId !== pkg.id || subscription.packageCode !== pkg.code)
    ) {
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
        status: SubscriptionInvoiceStatus.PENDING,
        dueAt: now,
        periodStart: null,
        periodEnd: null,
      },
    });

    const paymentLog = await tx.subscriptionPaymentLog.create({
      data: {
        schoolId,
        invoiceId: invoice.id,
        status: SubscriptionPaymentStatus.PENDING,
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
        } satisfies Prisma.InputJsonValue,
      },
    });

    const checkout = buildPayFastCheckout({
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
        } satisfies Prisma.InputJsonValue,
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

async function createCreditsCheckout(
  req: express.Request,
  res: express.Response,
  config: ReturnType<typeof loadPayFastConfig>,
) {
  const schoolId = String(req.body?.schoolId || "").trim();
  const bundleCode = parseBundleCode(req.body?.bundleCode);

  if (!schoolId || !bundleCode) {
    return res.status(400).json({
      success: false,
      error:
        "schoolId and bundleCode (FOUNDATION | GROWTH | PROFESSIONAL | ELITE) are required for credits checkout",
    });
  }

  await ensureEduClearCreditBundles();

  const [school, bundle] = await Promise.all([
    prisma.school.findUnique({
      where: { id: schoolId },
      select: { id: true, name: true, email: true, phone: true, cellNo: true },
    }),
    prisma.eduClearCreditBundle.findFirst({
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

  const { first, last } = splitSchoolContactName(school.name);
  const itemName = `EduClear ${bundle.name} SMS credits`;
  const itemDescription =
    bundle.description || `${bundle.smsCredits.toLocaleString("en-ZA")} SMS credits — once-off`;

  const result = await prisma.$transaction(async (tx) => {
    const invoice = await tx.creditPurchaseInvoice.create({
      data: {
        schoolId,
        bundleId: bundle.id,
        bundleCode: bundle.code,
        invoiceNumber,
        amountCents: bundle.priceCents,
        smsCredits: bundle.smsCredits,
        currency: "ZAR",
        status: CreditPurchaseInvoiceStatus.PENDING,
      },
    });

    const paymentLog = await tx.creditPurchasePaymentLog.create({
      data: {
        schoolId,
        invoiceId: invoice.id,
        status: CreditPurchasePaymentStatus.PENDING,
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
        } satisfies Prisma.InputJsonValue,
      },
    });

    const checkout = buildPayFastCheckout({
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
        } satisfies Prisma.InputJsonValue,
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
    const checkoutType = parseCheckoutType(
      req.body?.checkoutType,
      req.body?.packageCode,
      req.body?.bundleCode,
    );

    if (!checkoutType) {
      return res.status(400).json({
        success: false,
        error:
          "checkoutType (SUBSCRIPTION | CREDITS) is required, or provide packageCode / bundleCode",
      });
    }

    let config;
    try {
      config = loadPayFastConfig();
    } catch (error) {
      if (error instanceof PayFastConfigError) {
        return res.status(503).json({ success: false, error: error.message });
      }
      throw error;
    }

    if (checkoutType === "CREDITS") {
      return createCreditsCheckout(req, res, config);
    }

    return createSubscriptionCheckout(req, res, config);
  } catch (error) {
    console.error("[payfast] POST /create-checkout failed:", error);
    return res.status(500).json({ success: false, error: "Failed to create PayFast checkout" });
  }
});

type ItnHandleResult = "processed" | "not_found" | "amount_mismatch";

async function handleSubscriptionItn(
  postData: Record<string, string>,
  merchantPaymentId: string,
  gatewayPaymentId: string | null,
  paymentStatus: string,
): Promise<ItnHandleResult> {
  const paymentLog = await prisma.subscriptionPaymentLog.findFirst({
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

  if (!amountsMatch(paymentLog.amountCents, postData.amount_gross)) {
    console.warn("[payfast] subscription ITN amount mismatch", {
      merchantPaymentId,
      expectedCents: paymentLog.amountCents,
      amount_gross: postData.amount_gross,
    });
    return "amount_mismatch";
  }

  await prisma.subscriptionPaymentLog.update({
    where: { id: paymentLog.id },
    data: {
      rawNotify: postData as Prisma.InputJsonValue,
      gatewayPaymentId: gatewayPaymentId || paymentLog.gatewayPaymentId,
    },
  });

  if (paymentLog.status === SubscriptionPaymentStatus.PAID) {
    return "processed";
  }

  if (isPayFastPaymentComplete(paymentStatus)) {
    const activatedAt = new Date();
    const currentPeriodStart = activatedAt;
    const currentPeriodEnd = addOneCalendarMonth(activatedAt);

    await prisma.$transaction(async (tx) => {
      await tx.subscriptionPaymentLog.update({
        where: { id: paymentLog.id },
        data: {
          status: SubscriptionPaymentStatus.PAID,
          gatewayPaymentId,
          paidAt: activatedAt,
          failureReason: null,
        },
      });

      await tx.subscriptionInvoice.update({
        where: { id: paymentLog.invoiceId },
        data: {
          status: SubscriptionInvoiceStatus.PAID,
          paidAt: activatedAt,
          periodStart: currentPeriodStart,
          periodEnd: currentPeriodEnd,
        },
      });

      await tx.schoolSubscription.update({
        where: { id: paymentLog.invoice.subscriptionId },
        data: {
          status: SchoolSubscriptionStatus.ACTIVE,
          activatedAt,
          currentPeriodStart,
          currentPeriodEnd,
          cancelledAt: null,
        },
      });
    });

    return "processed";
  }

  if (isPayFastPaymentFailed(paymentStatus)) {
    const failureReason = `PayFast status: ${paymentStatus}`;

    await prisma.$transaction(async (tx) => {
      await tx.subscriptionPaymentLog.update({
        where: { id: paymentLog.id },
        data: {
          status: SubscriptionPaymentStatus.FAILED,
          gatewayPaymentId,
          failureReason,
        },
      });

      await tx.subscriptionInvoice.update({
        where: { id: paymentLog.invoiceId },
        data: {
          status: SubscriptionInvoiceStatus.FAILED,
        },
      });
    });
  }

  return "processed";
}

async function handleCreditsItn(
  postData: Record<string, string>,
  merchantPaymentId: string,
  gatewayPaymentId: string | null,
  paymentStatus: string,
): Promise<ItnHandleResult> {
  const paymentLog = await prisma.creditPurchasePaymentLog.findFirst({
    where: { merchantPaymentId },
    include: {
      invoice: true,
    },
  });

  if (!paymentLog) {
    return "not_found";
  }

  if (!amountsMatch(paymentLog.amountCents, postData.amount_gross)) {
    console.warn("[payfast] credits ITN amount mismatch", {
      merchantPaymentId,
      expectedCents: paymentLog.amountCents,
      amount_gross: postData.amount_gross,
    });
    return "amount_mismatch";
  }

  await prisma.creditPurchasePaymentLog.update({
    where: { id: paymentLog.id },
    data: {
      rawNotify: postData as Prisma.InputJsonValue,
      gatewayPaymentId: gatewayPaymentId || paymentLog.gatewayPaymentId,
    },
  });

  if (paymentLog.status === CreditPurchasePaymentStatus.PAID) {
    return "processed";
  }

  if (isPayFastPaymentComplete(paymentStatus)) {
    const paidAt = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.creditPurchasePaymentLog.update({
        where: { id: paymentLog.id },
        data: {
          status: CreditPurchasePaymentStatus.PAID,
          gatewayPaymentId,
          paidAt,
          failureReason: null,
        },
      });

      await tx.creditPurchaseInvoice.update({
        where: { id: paymentLog.invoiceId },
        data: {
          status: CreditPurchaseInvoiceStatus.PAID,
          paidAt,
          creditsGrantedAt: paidAt,
        },
      });
    });

    grantSmsCreditsToSchool(paymentLog.schoolId, paymentLog.invoice.smsCredits);

    return "processed";
  }

  if (isPayFastPaymentFailed(paymentStatus)) {
    const failureReason = `PayFast status: ${paymentStatus}`;

    await prisma.$transaction(async (tx) => {
      await tx.creditPurchasePaymentLog.update({
        where: { id: paymentLog.id },
        data: {
          status: CreditPurchasePaymentStatus.FAILED,
          gatewayPaymentId,
          failureReason,
        },
      });

      await tx.creditPurchaseInvoice.update({
        where: { id: paymentLog.invoiceId },
        data: {
          status: CreditPurchaseInvoiceStatus.FAILED,
        },
      });
    });
  }

  return "processed";
}

router.post(
  "/notify",
  express.urlencoded({ extended: false }),
  async (req, res) => {
    try {
      const postData: Record<string, string> = {};
      for (const [key, value] of Object.entries(req.body || {})) {
        postData[key] = String(value ?? "");
      }

      let config;
      try {
        config = loadPayFastConfig();
      } catch (error) {
        console.error("[payfast] notify config error:", error);
        return res.status(503).end();
      }

      const paramString = buildItnParamString(postData);
      const signatureValid = verifyPayFastItnSignature(postData, config.passphrase);
      const sourceIpValid = await isPayFastNotifySourceIp(clientIpFromRequest(req));
      const host = resolvePayFastHost(config.merchantId, config.notifyUrl);
      const serverValid = await confirmPayFastItnWithServer(paramString, host);

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

      let result: ItnHandleResult = "not_found";

      if (checkoutTypeHint === "CREDITS" || merchantPaymentId.startsWith("ec-crd-")) {
        result = await handleCreditsItn(postData, merchantPaymentId, gatewayPaymentId, paymentStatus);
      } else {
        result = await handleSubscriptionItn(
          postData,
          merchantPaymentId,
          gatewayPaymentId,
          paymentStatus,
        );
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
    } catch (error) {
      console.error("[payfast] POST /notify failed:", error);
      return res.status(500).end();
    }
  },
);

export default router;
