/** Historical capacity labels only — never commercial prices. */
export type PayFastCheckoutResponse = {
  success: boolean;
  checkoutType: string;
  checkoutKind?: string;
  paymentUrl: string;
  payload: Record<string, string>;
  merchantPaymentId?: string;
  paymentLogId?: string;
  packageCode?: string;
  sku?: string;
  billingCycle?: string;
  amountCents?: number;
  amount?: string;
};

/**
 * @deprecated Do not use for commercial pricing. Modular prices come from
 * educlearCommercialPackages. Kept only so accidental STARTER/UNLIMITED UI
 * references render as historical labels (no Rand amounts).
 */
export const PACKAGE_DISPLAY_PRICES: Record<string, string> = {
  STARTER: "Legacy capacity (historical)",
  UNLIMITED: "Legacy capacity (historical)",
};

export function getPackageDisplayPrice(code: string, fallback?: string): string {
  const key = String(code || "").trim().toUpperCase();
  return PACKAGE_DISPLAY_PRICES[key] || fallback || "—";
}

export function submitPayFastCheckout(
  paymentUrl: string,
  payload: Record<string, string>
): void {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = paymentUrl;
  form.style.display = "none";

  for (const [name, value] of Object.entries(payload)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = String(value ?? "");
    form.appendChild(input);
  }

  document.body.appendChild(form);
  form.submit();
}
