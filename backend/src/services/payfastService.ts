import crypto from "crypto";
import dns from "dns/promises";
import { URL } from "url";

export const PAYFAST_LIVE_HOST = "www.payfast.co.za";
export const PAYFAST_SANDBOX_HOST = "sandbox.payfast.co.za";

const PAYFAST_VALID_HOSTS = [
  PAYFAST_LIVE_HOST,
  PAYFAST_SANDBOX_HOST,
  "w1w.payfast.co.za",
  "w2w.payfast.co.za",
];

/** Checkout fields in PayFast documentation order (not alphabetical). */
const CHECKOUT_SIGNATURE_FIELD_ORDER = [
  "merchant_id",
  "merchant_key",
  "return_url",
  "cancel_url",
  "notify_url",
  "name_first",
  "name_last",
  "email_address",
  "cell_number",
  "m_payment_id",
  "amount",
  "item_name",
  "item_description",
  "custom_int1",
  "custom_int2",
  "custom_int3",
  "custom_int4",
  "custom_int5",
  "custom_str1",
  "custom_str2",
  "custom_str3",
  "custom_str4",
  "custom_str5",
  "email_confirmation",
  "confirmation_address",
  "payment_method",
] as const;

export type PayFastConfig = {
  merchantId: string;
  merchantKey: string;
  passphrase: string;
  returnUrl: string;
  cancelUrl: string;
  notifyUrl: string;
  host: string;
  processUrl: string;
  validateUrl: string;
};

export type PayFastCheckoutInput = {
  merchantPaymentId: string;
  amountCents: number;
  itemName: string;
  itemDescription?: string;
  payerEmail: string;
  payerFirstName: string;
  payerLastName: string;
  payerCell?: string;
  customStr1?: string;
  customStr2?: string;
  customStr3?: string;
};

export type PayFastCheckoutResult = {
  paymentUrl: string;
  payload: Record<string, string>;
};

export class PayFastConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayFastConfigError";
  }
}

function encodePayFastValue(value: string): string {
  return encodeURIComponent(String(value).trim()).replace(/%20/g, "+");
}

function buildParamStringFromOrderedFields(
  data: Record<string, string>,
  fieldOrder: readonly string[],
): string {
  const parts: string[] = [];

  for (const key of fieldOrder) {
    const value = data[key];
    if (value !== undefined && value !== "") {
      parts.push(`${key}=${encodePayFastValue(value)}`);
    }
  }

  return parts.join("&");
}

export function generatePayFastSignature(
  data: Record<string, string>,
  passphrase: string | null,
  fieldOrder: readonly string[] = CHECKOUT_SIGNATURE_FIELD_ORDER,
): string {
  let paramString = buildParamStringFromOrderedFields(data, fieldOrder);

  if (passphrase) {
    paramString += `&passphrase=${encodePayFastValue(passphrase)}`;
  }

  return crypto.createHash("md5").update(paramString).digest("hex");
}

export function formatPayFastAmount(amountCents: number): string {
  return (amountCents / 100).toFixed(2);
}

export function resolvePayFastHost(merchantId: string, notifyUrl: string): string {
  try {
    const notifyHost = new URL(notifyUrl).hostname.toLowerCase();
    if (notifyHost.includes("sandbox.payfast")) {
      return PAYFAST_SANDBOX_HOST;
    }
    if (
      notifyHost === "localhost" ||
      notifyHost === "127.0.0.1" ||
      notifyHost.includes("ngrok")
    ) {
      return PAYFAST_SANDBOX_HOST;
    }
  } catch {
    // fall through
  }

  if (String(merchantId || "").trim() === "10000100") {
    return PAYFAST_SANDBOX_HOST;
  }

  return PAYFAST_LIVE_HOST;
}

export function loadPayFastConfig(): PayFastConfig {
  const merchantId = String(process.env.PAYFAST_MERCHANT_ID || "").trim();
  const merchantKey = String(process.env.PAYFAST_MERCHANT_KEY || "").trim();
  const passphrase = String(process.env.PAYFAST_PASSPHRASE || "").trim();
  const returnUrl = String(process.env.PAYFAST_RETURN_URL || "").trim();
  const cancelUrl = String(process.env.PAYFAST_CANCEL_URL || "").trim();
  const notifyUrl = String(process.env.PAYFAST_NOTIFY_URL || "").trim();

  const missing: string[] = [];
  if (!merchantId) missing.push("PAYFAST_MERCHANT_ID");
  if (!merchantKey) missing.push("PAYFAST_MERCHANT_KEY");
  if (!passphrase) missing.push("PAYFAST_PASSPHRASE");
  if (!returnUrl) missing.push("PAYFAST_RETURN_URL");
  if (!cancelUrl) missing.push("PAYFAST_CANCEL_URL");
  if (!notifyUrl) missing.push("PAYFAST_NOTIFY_URL");

  if (missing.length > 0) {
    throw new PayFastConfigError(`Missing PayFast environment variables: ${missing.join(", ")}`);
  }

  const host = resolvePayFastHost(merchantId, notifyUrl);

  return {
    merchantId,
    merchantKey,
    passphrase,
    returnUrl,
    cancelUrl,
    notifyUrl,
    host,
    processUrl: `https://${host}/eng/process`,
    validateUrl: `https://${host}/eng/query/validate`,
  };
}

export function buildPayFastCheckout(input: PayFastCheckoutInput): PayFastCheckoutResult {
  const config = loadPayFastConfig();
  const amount = formatPayFastAmount(input.amountCents);

  const basePayload: Record<string, string> = {
    merchant_id: config.merchantId,
    merchant_key: config.merchantKey,
    return_url: config.returnUrl,
    cancel_url: config.cancelUrl,
    notify_url: config.notifyUrl,
    name_first: input.payerFirstName,
    name_last: input.payerLastName,
    email_address: input.payerEmail,
    m_payment_id: input.merchantPaymentId,
    amount,
    item_name: input.itemName,
  };

  if (input.itemDescription) {
    basePayload.item_description = input.itemDescription;
  }
  if (input.payerCell) {
    basePayload.cell_number = input.payerCell;
  }
  if (input.customStr1) {
    basePayload.custom_str1 = input.customStr1;
  }
  if (input.customStr2) {
    basePayload.custom_str2 = input.customStr2;
  }
  if (input.customStr3) {
    basePayload.custom_str3 = input.customStr3;
  }

  const signature = generatePayFastSignature(basePayload, config.passphrase);
  const payload = { ...basePayload, signature };

  return {
    paymentUrl: config.processUrl,
    payload,
  };
}

export function buildItnParamString(postData: Record<string, string>): string {
  const parts: string[] = [];

  for (const [key, rawValue] of Object.entries(postData)) {
    if (key === "signature") {
      break;
    }
    const value = String(rawValue ?? "").replace(/\\/g, "");
    parts.push(`${key}=${encodeURIComponent(value).replace(/%20/g, "+")}`);
  }

  return parts.join("&");
}

export function verifyPayFastItnSignature(
  postData: Record<string, string>,
  passphrase: string,
): boolean {
  const receivedSignature = String(postData.signature || "").trim().toLowerCase();
  if (!receivedSignature) {
    return false;
  }

  const paramString = buildItnParamString(postData);
  const expected = crypto
    .createHash("md5")
    .update(`${paramString}&passphrase=${encodePayFastValue(passphrase)}`)
    .digest("hex");

  return receivedSignature === expected;
}

let cachedValidPayFastIps: string[] | null = null;

async function loadValidPayFastIps(): Promise<string[]> {
  if (cachedValidPayFastIps) {
    return cachedValidPayFastIps;
  }

  const ips = new Set<string>();

  for (const host of PAYFAST_VALID_HOSTS) {
    try {
      const resolved = await dns.lookup(host, { all: true });
      for (const entry of resolved) {
        ips.add(entry.address);
      }
    } catch (error) {
      console.warn(`[payfast] Failed to resolve ${host}:`, error);
    }
  }

  cachedValidPayFastIps = [...ips];
  return cachedValidPayFastIps;
}

export async function isPayFastNotifySourceIp(clientIp: string): Promise<boolean> {
  const normalizedIp = String(clientIp || "")
    .trim()
    .replace(/^::ffff:/, "");

  if (!normalizedIp) {
    return false;
  }

  const validIps = await loadValidPayFastIps();
  return validIps.includes(normalizedIp);
}

export async function confirmPayFastItnWithServer(
  paramString: string,
  host: string,
): Promise<boolean> {
  const validateUrl = `https://${host}/eng/query/validate`;

  const response = await fetch(validateUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: paramString,
  });

  const body = (await response.text()).trim();
  return body === "VALID";
}

export function isPayFastPaymentComplete(paymentStatus: string): boolean {
  return String(paymentStatus || "").trim().toUpperCase() === "COMPLETE";
}

export function isPayFastPaymentFailed(paymentStatus: string): boolean {
  const status = String(paymentStatus || "").trim().toUpperCase();
  return status === "FAILED" || status === "CANCELLED";
}

export function amountsMatch(expectedCents: number, amountGross: string): boolean {
  const expected = expectedCents / 100;
  const received = Number.parseFloat(String(amountGross || "0"));
  if (!Number.isFinite(received)) {
    return false;
  }
  return Math.abs(expected - received) <= 0.01;
}

export function splitSchoolContactName(schoolName: string): { first: string; last: string } {
  const parts = String(schoolName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) {
    return { first: "School", last: "Admin" };
  }
  if (parts.length === 1) {
    return { first: parts[0], last: "Admin" };
  }

  return {
    first: parts[0],
    last: parts.slice(1).join(" "),
  };
}

export function addOneCalendarMonth(from: Date): Date {
  const result = new Date(from);
  result.setMonth(result.getMonth() + 1);
  return result;
}
