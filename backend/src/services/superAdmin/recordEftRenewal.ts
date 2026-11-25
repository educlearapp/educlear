import { createHash } from "node:crypto";
import { prisma } from "../../prisma";
import {
  computeSubscriptionPeriodEnd,
  ModularCheckoutError,
  parseModularBillingCycle,
  renewalPeriodStart,
  resolveModularCheckoutQuote,
} from "../modularPayfastCheckout";
import { commercialPackageFromEntitlements } from "../resolveSchoolCommercialPackage";

export async function recordEftRenewal(input: {
  schoolId: string;
  reference: unknown;
  paidOn: unknown;
  amountCents: unknown;
  billingCycle: unknown;
  actorId: string;
}) {
  const reference = typeof input.reference === "string" ? input.reference.trim() : "";
  const paidOn = typeof input.paidOn === "string" ? input.paidOn : "";
  const paidAt = new Date(paidOn + "T00:00:00+02:00");
  const billingCycle = parseModularBillingCycle(input.billingCycle);
  if (!reference || reference.length > 120 || !billingCycle ||
      !/^\d{4}-\d{2}-\d{2}$/.test(paidOn) || !Number.isFinite(paidAt.getTime()) ||
      paidAt > new Date() ||
      new Date(paidAt.getTime() + 7200000).toISOString().slice(0, 10) !== paidOn ||
      typeof input.amountCents !== "number" || !Number.isSafeInteger(input.amountCents)) {
    throw new ModularCheckoutError("Enter the verified bank transaction reference, payment date, amount and billing cycle.", 400, "INVALID_EFT_PAYMENT");
  }

  const key = createHash("sha256").update(JSON.stringify([input.schoolId, reference.toLowerCase()])).digest("hex");
  const invoiceNumber = `EC-EFT-${key}`;
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "SchoolSubscription" WHERE "schoolId" = ${input.schoolId} FOR UPDATE`;
    const existing = await tx.subscriptionInvoice.findUnique({
      where: { invoiceNumber },
      select: { id: true },
    });
    if (existing) {
      throw new ModularCheckoutError("This bank transaction is already recorded.", 409, "DUPLICATE_EFT");
    }

    const subscription = await tx.schoolSubscription.findUnique({
      where: { schoolId: input.schoolId },
      include: { school: { include: { moduleEntitlements: true } } },
    });
    if (subscription?.status !== "ACTIVE" || subscription.school.lifecycleStatus === "ARCHIVED") {
      throw new ModularCheckoutError("EFT renewal requires an active school subscription. New schools activate through PayFast.", 409, "EFT_RENEWAL_REQUIRES_ACTIVE");
    }
    const defaultEnabled = subscription.activationSource !== "payfast_modular_itn";
    const modules = { CORE: defaultEnabled, ACCOUNTING: defaultEnabled, PAYROLL: defaultEnabled };
    for (const row of subscription.school.moduleEntitlements) modules[row.module] = row.enabled;
    const current = commercialPackageFromEntitlements(modules, subscription.packageCode);
    if (!current) throw new ModularCheckoutError("The school has no valid package to renew.", 409, "INVALID_RENEWAL_PACKAGE");
    const quote = resolveModularCheckoutQuote({
      sku: current.code,
      billingCycle,
      clientAmountCents: input.amountCents,
    });
    const periodStart = renewalPeriodStart(paidAt, subscription.currentPeriodEnd);
    const periodEnd = computeSubscriptionPeriodEnd(periodStart, billingCycle);
    const invoice = await tx.subscriptionInvoice.create({
      data: {
        schoolId: input.schoolId,
        subscriptionId: subscription.id,
        invoiceNumber,
        amountCents: quote.amountCents,
        status: "PAID",
        dueAt: paidAt,
        paidAt,
        periodStart,
        periodEnd,
      },
    });
    await tx.subscriptionPaymentLog.create({
      data: {
        schoolId: input.schoolId,
        invoiceId: invoice.id,
        gateway: "EFT",
        status: "PAID",
        merchantPaymentId: invoiceNumber,
        gatewayPaymentId: reference,
        amountCents: quote.amountCents,
        paidAt,
        rawRequest: {
          commercialSku: quote.sku,
          billingCycle,
          recordedByUserId: input.actorId,
        },
      },
    });
    await tx.schoolSubscription.update({
      where: { id: subscription.id },
      data: { currentPeriodStart: periodStart, currentPeriodEnd: periodEnd },
    });
    return { success: true, currentPeriodEnd: periodEnd };
  });
}
