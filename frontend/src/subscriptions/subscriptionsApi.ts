import { apiFetch } from "../api";
import { isSuperAdmin, SUPER_ADMIN_ENTRY_PATH } from "../auth/roles";
import { USER_APP_ROLE_STORAGE_KEY } from "../auth/schoolSession";
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
  activationSource?: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  activatedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  package: EduClearPackage;
};

export type SubscriptionConfigResponse = {
  success: boolean;
  payfastConfigured: boolean;
  missingPayFastEnv?: string[];
  testModeAvailable: boolean;
};

export type TestActivateSubscriptionResponse = {
  success: boolean;
  schoolId: string;
  dashboardUnlocked: boolean;
  isActive: boolean;
  activationSource: string;
  subscription: SchoolSubscription;
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

function subscriptionAuthHeaders(): Record<string, string> {
  const token = String(localStorage.getItem("token") || "").trim();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function fetchSubscriptionPackages(): Promise<EduClearPackage[]> {
  const data = (await apiFetch("/api/subscriptions/packages")) as PackagesResponse;
  if (!Array.isArray(data?.packages)) return [];
  return data.packages.map((pkg) =>
    normalizeEduClearPackage(pkg as unknown as Record<string, unknown>)
  );
}

export async function fetchSubscriptionConfig(): Promise<SubscriptionConfigResponse> {
  return apiFetch("/api/subscriptions/config") as Promise<SubscriptionConfigResponse>;
}

export async function activateSubscriptionTestMode(
  packageCode?: string
): Promise<TestActivateSubscriptionResponse> {
  return apiFetch("/api/subscriptions/test-activate", {
    method: "POST",
    headers: subscriptionAuthHeaders(),
    body: JSON.stringify({
      ...(packageCode ? { packageCode: String(packageCode).trim().toUpperCase() } : {}),
    }),
  }) as Promise<TestActivateSubscriptionResponse>;
}

const SUBSCRIPTION_GATE_CACHE_KEYS = ["educlearSelectedPackageCode"] as const;
const SUBSCRIPTION_STATUS_CACHE_KEY = "educlearSchoolSubscriptionStatus";

type SubscriptionStatusCacheEntry = {
  schoolId: string;
  status: SubscriptionStatusResponse;
  savedAt: number;
};

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function readSubscriptionStatusCache(): SubscriptionStatusCacheEntry | null {
  try {
    const raw = sessionStorage.getItem(SUBSCRIPTION_STATUS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SubscriptionStatusCacheEntry;
    if (!parsed?.schoolId || !parsed?.status) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Cached subscription status from login or a prior status fetch (session-scoped). */
export function getCachedSchoolSubscriptionStatus(
  schoolId: string
): SubscriptionStatusResponse | null {
  const key = String(schoolId || "").trim();
  if (!key) return null;
  const entry = readSubscriptionStatusCache();
  if (!entry || entry.schoolId !== key) return null;
  return entry.status;
}

export function cacheSchoolSubscriptionStatus(
  schoolId: string,
  status: SubscriptionStatusResponse
): void {
  const key = String(schoolId || "").trim();
  if (!key || !status) return;
  try {
    sessionStorage.setItem(
      SUBSCRIPTION_STATUS_CACHE_KEY,
      JSON.stringify({
        schoolId: key,
        status,
        savedAt: Date.now(),
      } satisfies SubscriptionStatusCacheEntry)
    );
  } catch {
    // sessionStorage may be unavailable; gate still works via network
  }
}

/** Persist package/subscription fields when present on login or /auth/me. */
export function syncSubscriptionFromLoginResponse(data: unknown): void {
  const root = readRecord(data);
  if (!root) return;

  const schoolId = String(
    root.schoolId ?? readRecord(root.school)?.id ?? readRecord(root.user)?.schoolId ?? ""
  ).trim();
  if (!schoolId) return;

  if (root.success === true && ("dashboardUnlocked" in root || "isActive" in root)) {
    cacheSchoolSubscriptionStatus(schoolId, root as unknown as SubscriptionStatusResponse);
    return;
  }

  const nested =
    readRecord(root.subscriptionStatus) ||
    readRecord(root.packageStatus);

  const dashboardUnlocked =
    root.dashboardUnlocked === true ||
    root.isActive === true ||
    nested?.dashboardUnlocked === true ||
    nested?.isActive === true;

  const subscription =
    readRecord(root.subscription) ||
    (nested && (nested.subscription || nested.status) ? nested : null);
  const subscriptionRecord = subscription
    ? (readRecord(subscription.subscription) ? readRecord(subscription.subscription) : subscription)
    : null;

  if (
    dashboardUnlocked ||
    subscription ||
    root.hasSubscription != null ||
    nested?.hasSubscription != null
  ) {
    cacheSchoolSubscriptionStatus(schoolId, {
      success: true,
      schoolId,
      schoolName: String(root.schoolName ?? readRecord(root.school)?.name ?? ""),
      hasSubscription: Boolean(
        root.hasSubscription ?? nested?.hasSubscription ?? subscription
      ),
      isActive: Boolean(root.isActive ?? nested?.isActive ?? dashboardUnlocked),
      dashboardUnlocked,
      subscription: (subscriptionRecord as SchoolSubscription | null) ?? null,
    });
  }
}

/** Clears client-side keys that can keep users on package flows after status is ACTIVE. */
export function clearSubscriptionGateCache(): void {
  for (const key of SUBSCRIPTION_GATE_CACHE_KEYS) {
    localStorage.removeItem(key);
  }
}

export function clearSchoolSubscriptionStatusCache(): void {
  try {
    sessionStorage.removeItem(SUBSCRIPTION_STATUS_CACHE_KEY);
  } catch {
    // ignore
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

export async function refreshSchoolSubscriptionStatus(
  schoolId: string
): Promise<SubscriptionStatusResponse | null> {
  const key = String(schoolId || "").trim();
  if (!key) return null;
  try {
    const fresh = (await apiFetch(
      `/api/subscriptions/school/${encodeURIComponent(key)}/status`,
      {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
      }
    )) as SubscriptionStatusResponse;
    cacheSchoolSubscriptionStatus(key, fresh);
    return fresh;
  } catch {
    return getCachedSchoolSubscriptionStatus(key);
  }
}

/** Returns cached status immediately when available; refreshes in the background. */
export async function fetchSchoolSubscriptionStatus(
  schoolId: string
): Promise<SubscriptionStatusResponse> {
  const key = String(schoolId || "").trim();
  const cached = getCachedSchoolSubscriptionStatus(key);
  if (cached) {
    void refreshSchoolSubscriptionStatus(key);
    return cached;
  }
  const fresh = await refreshSchoolSubscriptionStatus(key);
  if (fresh) return fresh;
  throw new Error("Unable to load subscription status");
}

export type SubscriptionGateState = "loading" | "allowed" | "blocked";

export function getInitialSubscriptionGateState(schoolId: string): SubscriptionGateState {
  const key = String(schoolId || "").trim();
  if (!key) return "blocked";
  const cached = getCachedSchoolSubscriptionStatus(key);
  if (!cached) return "loading";
  return isSubscriptionDashboardUnlocked(cached) ? "allowed" : "blocked";
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

/** Immediate post-login route using cached package status (no network wait). */
export function resolvePostAuthPathSync(schoolId: string): string {
  if (isSuperAdmin()) {
    return SUPER_ADMIN_ENTRY_PATH;
  }

  const appRole = String(localStorage.getItem(USER_APP_ROLE_STORAGE_KEY) || "").trim();
  const prismaRole = String(localStorage.getItem("userRole") || "").trim().toUpperCase();

  if (appRole === "Teacher") {
    return "/teacher-portal/dashboard";
  }

  if (appRole === "Parent" || prismaRole === "PARENT") {
    return "/parent-portal";
  }

  const key = String(schoolId || "").trim();
  const cached = getCachedSchoolSubscriptionStatus(key);
  if (cached) {
    if (isSubscriptionDashboardUnlocked(cached)) {
      return "/dashboard";
    }
    const sub = cached.subscription;
    if (sub?.status === "PENDING_PAYMENT" && sub.packageCode) {
      return "/subscription/status";
    }
    return "/subscription/packages";
  }

  // No cache yet: open dashboard; SubscriptionGate refreshes status in background.
  return "/dashboard";
}

/** Where to send the user after login or registration (uses cache, then network). */
export async function resolvePostAuthPath(schoolId: string): Promise<string> {
  const syncPath = resolvePostAuthPathSync(schoolId);
  void refreshSchoolSubscriptionStatus(schoolId);
  return syncPath;
}
