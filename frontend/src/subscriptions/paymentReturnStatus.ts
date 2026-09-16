/**
 * PayFast browser-return UI state helpers (client-side, pure).
 */
export type PaymentReturnUiState = "loading" | "activated" | "pending" | "unconfirmed";

export type PaymentReturnStatusPayload = {
  paymentStatus?: string;
  activationStatus?: string;
  commercialSku?: string | null;
  billingCycle?: string | null;
  uiState?: string;
};

export const PAYMENT_RETURN_POLL_INTERVAL_MS = 2000;
export const PAYMENT_RETURN_POLL_MAX_MS = 45_000;

export const PENDING_CHECKOUT_MERCHANT_PAYMENT_KEY = "educlear.pendingCheckoutMerchantPaymentId";
export const PENDING_CHECKOUT_SCHOOL_KEY = "educlear.pendingCheckoutSchoolId";

export function rememberPendingCheckout(input: {
  schoolId: string;
  merchantPaymentId: string;
}): void {
  const schoolId = String(input.schoolId || "").trim();
  const merchantPaymentId = String(input.merchantPaymentId || "").trim();
  if (!schoolId || !merchantPaymentId) return;
  try {
    sessionStorage.setItem(PENDING_CHECKOUT_SCHOOL_KEY, schoolId);
    sessionStorage.setItem(PENDING_CHECKOUT_MERCHANT_PAYMENT_KEY, merchantPaymentId);
  } catch {
    // sessionStorage may be unavailable
  }
}

export function readPendingCheckoutMerchantPaymentId(schoolId: string): string | null {
  const sid = String(schoolId || "").trim();
  if (!sid) return null;
  try {
    const storedSchool = String(sessionStorage.getItem(PENDING_CHECKOUT_SCHOOL_KEY) || "").trim();
    const mid = String(sessionStorage.getItem(PENDING_CHECKOUT_MERCHANT_PAYMENT_KEY) || "").trim();
    if (!mid) return null;
    // Only use stored id when it belongs to the current session school.
    if (storedSchool && storedSchool !== sid) return null;
    return mid;
  } catch {
    return null;
  }
}

export function clearPendingCheckout(): void {
  try {
    sessionStorage.removeItem(PENDING_CHECKOUT_MERCHANT_PAYMENT_KEY);
    sessionStorage.removeItem(PENDING_CHECKOUT_SCHOOL_KEY);
  } catch {
    // ignore
  }
}

export function resolveReturnUiState(
  payload: PaymentReturnStatusPayload | null | undefined
): PaymentReturnUiState {
  const ui = String(payload?.uiState || "").trim().toLowerCase();
  if (ui === "activated") return "activated";
  if (ui === "pending") return "pending";
  if (ui === "unconfirmed") return "unconfirmed";
  const activation = String(payload?.activationStatus || "").trim().toUpperCase();
  if (activation === "ACTIVE") return "activated";
  if (activation === "PENDING") return "pending";
  return "unconfirmed";
}

export function paymentReturnCopy(state: PaymentReturnUiState): {
  title: string;
  body: string;
  showDashboardCta: boolean;
  showRefreshCta: boolean;
  showContactCta: boolean;
} {
  if (state === "activated") {
    return {
      title: "Payment Successful",
      body: "Your EduClear subscription is now active.",
      showDashboardCta: true,
      showRefreshCta: false,
      showContactCta: false,
    };
  }
  if (state === "pending") {
    return {
      title: "Payment received",
      body: "We're confirming your EduClear subscription. This usually only takes a few moments.",
      showDashboardCta: false,
      showRefreshCta: true,
      showContactCta: false,
    };
  }
  return {
    title: "Payment received, but we're still confirming your subscription.",
    body: "Please refresh status in a moment. Do not pay again. If this continues, contact EduClear.",
    showDashboardCta: false,
    showRefreshCta: true,
    showContactCta: true,
  };
}
