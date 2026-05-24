/** Display prices for go-live packages (always shown on cards). */
export const PACKAGE_DISPLAY_PRICES: Record<string, string> = {
  STARTER: "R1,500 / month",
  UNLIMITED: "R2,000 / month",
};

export function getPackageDisplayPrice(code: string, fallback?: string): string {
  const key = String(code || "").trim().toUpperCase();
  return PACKAGE_DISPLAY_PRICES[key] || fallback || "—";
}

export type PayFastCheckoutResponse = {
  success: boolean;
  checkoutType: string;
  paymentUrl: string;
  payload: Record<string, string>;
  merchantPaymentId?: string;
  paymentLogId?: string;
  packageCode?: string;
};

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
