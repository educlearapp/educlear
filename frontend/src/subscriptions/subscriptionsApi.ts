import { apiFetch } from "../api";
import type { PayFastCheckoutResponse } from "./payfastCheckout";

export type EduClearPackage = {
  id: string;
  code: string;
  name: string;
  monthlyPriceCents: number;
  monthlyPriceZar?: number;
  priceLabel?: string;
  learnerLimit: number | null;
  payrollStaffLimit: number | null;
  mostPopular: boolean;
  description: string;
  isActive: boolean;
};

export type PackagePriceFields = Pick<
  EduClearPackage,
  "monthlyPriceZar" | "monthlyPriceCents"
>;

export type SchoolSubscriptionStatus =
  | "PENDING_PAYMENT"
  | "ACTIVE"
  | "PAST_DUE"
  | "CANCELLED"
  | "SUSPENDED";

export type SchoolSubscription = {
  id: string;
  status: SchoolSubscriptionStatus;
  packageCode: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  activatedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  package: EduClearPackage;
};

export type SubscriptionStatusResponse = {
  success: boolean;
  schoolId: string;
  schoolName: string;
  hasSubscription: boolean;
  isActive: boolean;
  dashboardUnlocked: boolean;
  subscription: SchoolSubscription | null;
};

export type PackagesResponse = {
  success: boolean;
  packages: EduClearPackage[];
};

function normalizeEduClearPackage(raw: Record<string, unknown>): EduClearPackage {
  const centsRaw =
    raw.monthlyPriceCents ??
    raw.monthly_price_cents ??
    raw.priceCents ??
    raw.price_cents;
  const cents = Number(centsRaw);
  const zarRaw = raw.monthlyPriceZar ?? raw.monthly_price_zar ?? raw.price;
  const zar = Number(zarRaw);
  const priceLabel = String(raw.priceLabel ?? raw.price_label ?? "").trim();

  return {
    id: String(raw.id ?? ""),
    code: String(raw.code ?? ""),
    name: String(raw.name ?? ""),
    monthlyPriceCents: Number.isFinite(cents) ? cents : 0,
    monthlyPriceZar: Number.isFinite(zar)
      ? zar
      : Number.isFinite(cents)
        ? cents / 100
        : undefined,
    priceLabel: priceLabel || undefined,
    learnerLimit:
      raw.learnerLimit === null || raw.learnerLimit === undefined
        ? null
        : Number(raw.learnerLimit),
    payrollStaffLimit:
      raw.payrollStaffLimit === null || raw.payrollStaffLimit === undefined
        ? null
        : Number(raw.payrollStaffLimit),
    mostPopular: Boolean(raw.mostPopular),
    description: String(raw.description ?? ""),
    isActive: raw.isActive !== false,
  };
}

export async function fetchSubscriptionPackages(): Promise<EduClearPackage[]> {
  const data = (await apiFetch("/api/subscriptions/packages")) as PackagesResponse;
  if (!Array.isArray(data?.packages)) return [];
  return data.packages.map((pkg) =>
    normalizeEduClearPackage(pkg as unknown as Record<string, unknown>)
  );
}

const SUBSCRIPTION_GATE_CACHE_KEYS = ["educlearSelectedPackageCode"] as const;

/** Clears client-side keys that can keep users on package flows after status is ACTIVE. */
export function clearSubscriptionGateCache(): void {
  for (const key of SUBSCRIPTION_GATE_CACHE_KEYS) {
    localStorage.removeItem(key);
  }
}

export function isSubscriptionDashboardUnlocked(
  status: Pick<
    SubscriptionStatusResponse,
    "dashboardUnlocked" | "isActive" | "subscription"
  > | null
  | undefined
): boolean {
  if (!status) return false;
  if (status.dashboardUnlocked) return true;
  if (status.isActive) return true;
  if (status.subscription?.status === "ACTIVE") return true;
  return false;
}

export async function fetchSchoolSubscriptionStatus(
  schoolId: string
): Promise<SubscriptionStatusResponse> {
  return apiFetch(
    `/api/subscriptions/school/${encodeURIComponent(schoolId)}/status`,
    {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
    }
  ) as Promise<SubscriptionStatusResponse>;
}

export function getPackageMonthlyPriceZar(pkg: PackagePriceFields): number | null {
  const zar = pkg.monthlyPriceZar;
  if (zar != null && Number.isFinite(Number(zar))) {
    return Number(zar);
  }

  const cents = pkg.monthlyPriceCents;
  if (cents != null && Number.isFinite(Number(cents))) {
    return Number(cents) / 100;
  }

  return null;
}

export function formatMonthlyPrice(zar: number | null | undefined): string {
  if (zar == null || !Number.isFinite(Number(zar))) return "—";
  return `R${Math.round(Number(zar)).toLocaleString("en-ZA")}`;
}

export function formatPackageMonthlyPrice(
  pkg: PackagePriceFields & Pick<EduClearPackage, "priceLabel">
): string {
  const label = String(pkg.priceLabel || "").trim();
  if (label) {
    return label.replace(/\s*\/\s*month\s*$/i, "").trim();
  }
  return formatMonthlyPrice(getPackageMonthlyPriceZar(pkg));
}

export function formatPackagePriceLabel(
  pkg: PackagePriceFields & Pick<EduClearPackage, "priceLabel">
): string {
  const label = String(pkg.priceLabel || "").trim();
  if (label) return label;
  const monthly = formatPackageMonthlyPrice(pkg);
  if (monthly === "—") return "—";
  return `${monthly} / month`;
}

export function formatPackageBannerLabel(
  pkg: PackagePriceFields & Pick<EduClearPackage, "name" | "priceLabel">
): string {
  return `${pkg.name} — ${formatPackagePriceLabel(pkg)}`;
}

export function formatLearnerLimit(limit: number | null): string {
  if (limit == null) return "Unlimited learners";
  return `Up to ${limit.toLocaleString("en-ZA")} learners`;
}

export function formatPayrollLimit(limit: number | null): string {
  if (limit == null) return "Unlimited payroll";
  return `Up to ${limit.toLocaleString("en-ZA")} payroll staff`;
}

export function formatSubscriptionStatus(status: SchoolSubscriptionStatus | string): string {
  switch (status) {
    case "ACTIVE":
      return "Active";
    case "PENDING_PAYMENT":
      return "Pending";
    case "SUSPENDED":
      return "Suspended";
    case "PAST_DUE":
      return "Past Due";
    case "CANCELLED":
      return "Cancelled";
    default:
      return String(status || "Unknown");
  }
}

export function formatDisplayDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export type CreateSubscriptionCheckoutInput = {
  schoolId: string;
  packageCode: string;
  payerEmail?: string;
};

export async function createSubscriptionCheckout(
  input: CreateSubscriptionCheckoutInput
): Promise<PayFastCheckoutResponse> {
  return apiFetch("/api/payfast/create-checkout", {
    method: "POST",
    body: JSON.stringify({
      checkoutType: "SUBSCRIPTION",
      schoolId: input.schoolId,
      packageCode: input.packageCode,
      payerEmail: input.payerEmail,
    }),
  }) as Promise<PayFastCheckoutResponse>;
}

/** Where to send the user immediately after login or registration. */
export async function resolvePostAuthPath(schoolId: string): Promise<string> {
  clearSubscriptionGateCache();
  const status = await fetchSchoolSubscriptionStatus(schoolId);
  if (isSubscriptionDashboardUnlocked(status)) {
    clearSubscriptionGateCache();
    return "/dashboard";
  }
  const sub = status.subscription;
  if (sub?.status === "PENDING_PAYMENT" && sub.packageCode) {
    return "/subscription/status";
  }
  return "/subscription/packages";
}
