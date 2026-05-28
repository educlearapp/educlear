import {
  EduClearPackageCode,
  Prisma,
  SchoolSubscriptionStatus,
  SubscriptionInvoiceStatus,
  SubscriptionPaymentStatus,
} from "@prisma/client";

import { prisma } from "../prisma";
import { ensureEduClearPackages } from "./ensureEduClearPackages";
import { addOneCalendarMonth } from "./payfastService";

export const TEST_SUBSCRIPTION_ACTIVATION_SOURCE = "test_mode_no_payfast";

function parsePackageCode(raw: unknown): EduClearPackageCode | null {
  const normalized = String(raw || "").trim().toUpperCase();
  if (normalized === "STARTER" || normalized === "UNLIMITED") {
    return normalized as EduClearPackageCode;
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

export async function activateSchoolSubscriptionTestMode(opts: {
  schoolId: string;
  packageCode?: EduClearPackageCode | null;
  activatedByUserId: string;
  activationSource?: string;
}) {
  const schoolId = String(opts.schoolId || "").trim();
  if (!schoolId) {
    throw new Error("schoolId is required");
  }

  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { id: true, name: true, email: true },
  });
  if (!school) {
    throw new Error("School not found");
  }

  await ensureEduClearPackages();

  const packageCode = parsePackageCode(opts.packageCode) ?? ("UNLIMITED" as EduClearPackageCode);
  const pkg = await prisma.eduClearPackage.findFirst({
    where: { code: packageCode, isActive: true },
  });
  if (!pkg) {
    throw new Error(`Package ${packageCode} not found or inactive`);
  }

  const activationSource = String(opts.activationSource || TEST_SUBSCRIPTION_ACTIVATION_SOURCE).trim();
  const activatedAt = new Date();
  const currentPeriodStart = activatedAt;
  const currentPeriodEnd = addOneCalendarMonth(activatedAt);
  const invoiceNumber = await nextSubscriptionInvoiceNumber(schoolId);
  const merchantPaymentId = `ec-sub-test-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  const result = await prisma.$transaction(async (tx) => {
    const subscription = await tx.schoolSubscription.upsert({
      where: { schoolId },
      create: {
        schoolId,
        packageId: pkg.id,
        packageCode: pkg.code,
        status: SchoolSubscriptionStatus.ACTIVE,
        activationSource,
        currentPeriodStart,
        currentPeriodEnd,
        activatedAt,
        cancelledAt: null,
      },
      update: {
        packageId: pkg.id,
        packageCode: pkg.code,
        status: SchoolSubscriptionStatus.ACTIVE,
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
        status: SubscriptionInvoiceStatus.PAID,
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
        status: SubscriptionPaymentStatus.PAID,
        merchantPaymentId,
        amountCents: pkg.monthlyPriceCents,
        payerEmail: school.email || undefined,
        paidAt: activatedAt,
        rawRequest: {
          source: activationSource,
          activatedByUserId: opts.activatedByUserId,
          packageCode: pkg.code,
          invoiceNumber,
        } satisfies Prisma.InputJsonValue,
      },
    });

    return { subscription, invoice, package: pkg };
  });

  console.log(
    `[subscriptions] test activate school=${schoolId} package=${result.package.code} source=${activationSource}`,
  );

  return result;
}
