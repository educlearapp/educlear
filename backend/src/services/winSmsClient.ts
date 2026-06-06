import { redactSensitiveValues } from "../utils/secretCrypto";

const WINSMS_BASE_URL =
  String(process.env.WINSMS_API_BASE_URL || "https://www.winsms.co.za/api/rest/v1").replace(/\/$/, "");
const REQUEST_TIMEOUT_MS = 15_000;

export type WinSmsRecipient = {
  mobileNumber: string;
  clientMessageId?: string;
};

export type WinSmsSendInput = {
  message: string;
  recipients: WinSmsRecipient[];
  maxSegments?: number;
  scheduledTime?: string;
};

export type WinSmsApiResponse = {
  statusCode: number;
  errorMessage?: string;
  creditBalance?: number;
  timeStamp?: string;
  version?: string;
  [key: string]: unknown;
};

export class WinSmsApiError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "WinSmsApiError";
    this.statusCode = statusCode;
  }
}

async function winSmsRequest<T extends WinSmsApiResponse>(
  apiKey: string,
  method: "GET" | "POST",
  path: string,
  body?: unknown
): Promise<T> {
  const key = String(apiKey || "").trim();
  if (!key) {
    throw new WinSmsApiError("WinSMS API key is required", 400);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${WINSMS_BASE_URL}${path}`, {
      method,
      headers: {
        AUTHORIZATION: key,
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const text = await res.text();
    let data: WinSmsApiResponse = { statusCode: res.status };
    if (text) {
      try {
        data = JSON.parse(text) as WinSmsApiResponse;
      } catch {
        throw new WinSmsApiError(
          text.trim().slice(0, 240) || `WinSMS returned invalid JSON (${res.status})`,
          res.status
        );
      }
    }

    const statusCode = Number(data.statusCode ?? res.status);
    if (statusCode !== 200) {
      const safePayload = redactSensitiveValues(data);
      console.error("[winSmsClient] API error", { path, method, statusCode, payload: safePayload });
      throw new WinSmsApiError(
        String(data.errorMessage || `WinSMS request failed (${statusCode})`),
        statusCode
      );
    }

    return data as T;
  } catch (error) {
    if (error instanceof WinSmsApiError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new WinSmsApiError("WinSMS request timed out", 408);
    }
    throw new WinSmsApiError(
      error instanceof Error ? error.message : "WinSMS request failed",
      500
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function getWinSmsCreditBalance(apiKey: string) {
  const data = await winSmsRequest<WinSmsApiResponse & { creditBalance?: number }>(
    apiKey,
    "GET",
    "/credits/balance"
  );
  const balance = Number(data.creditBalance);
  return {
    creditBalance: Number.isFinite(balance) ? balance : 0,
    raw: data,
  };
}

export async function sendWinSms(apiKey: string, input: WinSmsSendInput) {
  const message = String(input.message || "").trim();
  const recipients = (input.recipients || [])
    .map((recipient) => ({
      mobileNumber: String(recipient.mobileNumber || "").replace(/\D/g, ""),
      ...(recipient.clientMessageId
        ? { clientMessageId: String(recipient.clientMessageId).trim() }
        : {}),
    }))
    .filter((recipient) => recipient.mobileNumber.length >= 10);

  if (!message) {
    throw new WinSmsApiError("SMS message is required", 400);
  }
  if (!recipients.length) {
    throw new WinSmsApiError("At least one valid recipient mobile number is required", 400);
  }

  return winSmsRequest<WinSmsApiResponse>(
    apiKey,
    "POST",
    "/sms/outgoing/send",
    {
      message,
      recipients,
      maxSegments: Math.max(1, Number(input.maxSegments) || 1),
      ...(input.scheduledTime ? { scheduledTime: input.scheduledTime } : {}),
    }
  );
}

export async function getWinSmsDeliveryStatus(apiKey: string, messageIds: number[]) {
  const ids = (messageIds || [])
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0);
  if (!ids.length) {
    throw new WinSmsApiError("At least one WinSMS message id is required", 400);
  }
  if (ids.length > 1000) {
    throw new WinSmsApiError("Maximum 1000 message ids per status request", 400);
  }

  return winSmsRequest<WinSmsApiResponse>(apiKey, "POST", "/sms/outgoing/status", ids);
}
