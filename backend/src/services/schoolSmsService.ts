import type { SchoolSmsSettings } from "@prisma/client";
import { prisma } from "../prisma";
import { decryptSecret, encryptSecret, MASKED_SECRET, maskSecret } from "../utils/secretCrypto";
import {
  getWinSmsCreditBalance,
  getWinSmsDeliveryStatus,
  sendWinSms,
  WinSmsApiError,
  type WinSmsSendInput,
} from "./winSmsClient";

export type SmsConnectionStatus = "not_configured" | "connected" | "failed";

export type SchoolSmsSettingsInput = {
  provider?: string;
  apiKey?: string;
};

export type SchoolSmsSettingsPublic = {
  schoolId: string;
  provider: string;
  apiKeySet: boolean;
  configured: boolean;
  connectionStatus: SmsConnectionStatus;
  creditBalance: number | null;
  creditBalanceCheckedAt: string | null;
  connectionTestedAt: string | null;
  lastConnectionError: string | null;
  ready: boolean;
};

function toConnectionStatus(value: string | null | undefined): SmsConnectionStatus {
  if (value === "connected" || value === "failed") return value;
  return "not_configured";
}

function toPublicSettings(row: SchoolSmsSettings | null, schoolId: string): SchoolSmsSettingsPublic {
  const apiKeySet = Boolean(row?.apiKeyEncrypted);
  const connectionStatus = toConnectionStatus(row?.connectionStatus);
  const configured = apiKeySet;
  const ready = configured && connectionStatus === "connected";

  return {
    schoolId,
    provider: row?.provider || "WinSMS",
    apiKeySet,
    configured,
    connectionStatus,
    creditBalance: row?.creditBalance ?? null,
    creditBalanceCheckedAt: row?.creditBalanceCheckedAt?.toISOString() ?? null,
    connectionTestedAt: row?.connectionTestedAt?.toISOString() ?? null,
    lastConnectionError: row?.lastConnectionError ?? null,
    ready,
  };
}

export async function getSchoolSmsSettingsRow(schoolId: string) {
  return prisma.schoolSmsSettings.findUnique({ where: { schoolId } });
}

export async function getPublicSchoolSmsSettings(schoolId: string): Promise<SchoolSmsSettingsPublic> {
  const row = await getSchoolSmsSettingsRow(schoolId);
  return toPublicSettings(row, schoolId);
}

export async function isSchoolSmsConfigured(schoolId: string) {
  const row = await getSchoolSmsSettingsRow(schoolId);
  return Boolean(row?.apiKeyEncrypted);
}

export async function isSchoolSmsReady(schoolId: string) {
  const row = await getSchoolSmsSettingsRow(schoolId);
  return Boolean(row?.apiKeyEncrypted && row.connectionStatus === "connected");
}

export async function getDecryptedSchoolSmsApiKey(schoolId: string): Promise<string | null> {
  const row = await getSchoolSmsSettingsRow(schoolId);
  if (!row?.apiKeyEncrypted) return null;
  const apiKey = decryptSecret(row.apiKeyEncrypted);
  return apiKey || null;
}

export async function saveSchoolSmsSettings(schoolId: string, input: SchoolSmsSettingsInput) {
  const provider = String(input.provider || "WinSMS").trim() || "WinSMS";
  if (provider !== "WinSMS") {
    return { ok: false as const, errors: ["Only WinSMS is supported at this time."] };
  }

  const existing = await getSchoolSmsSettingsRow(schoolId);
  let apiKeyEncrypted = existing?.apiKeyEncrypted || "";

  const incomingKey = input.apiKey;
  if (incomingKey !== undefined && incomingKey !== MASKED_SECRET && String(incomingKey).trim()) {
    try {
      apiKeyEncrypted = encryptSecret(String(incomingKey).trim());
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to encrypt WinSMS API key";
      return { ok: false as const, errors: [message] };
    }
  }

  if (!apiKeyEncrypted) {
    return { ok: false as const, errors: ["WinSMS API key is required."] };
  }

  const keyChanged = existing?.apiKeyEncrypted !== apiKeyEncrypted;
  const row = await prisma.schoolSmsSettings.upsert({
    where: { schoolId },
    create: {
      schoolId,
      provider,
      apiKeyEncrypted,
      connectionStatus: "not_configured",
    },
    update: {
      provider,
      apiKeyEncrypted,
      ...(keyChanged
        ? {
            connectionStatus: "not_configured",
            creditBalance: null,
            creditBalanceCheckedAt: null,
            connectionTestedAt: null,
            lastConnectionError: null,
          }
        : {}),
    },
  });

  return {
    ok: true as const,
    settings: toPublicSettings(row, schoolId),
  };
}

async function resolveApiKeyForAction(
  schoolId: string,
  overrideApiKey?: string
): Promise<{ apiKey: string; persist: boolean }> {
  const trimmedOverride = String(overrideApiKey || "").trim();
  if (trimmedOverride && trimmedOverride !== MASKED_SECRET) {
    return { apiKey: trimmedOverride, persist: false };
  }

  const stored = await getDecryptedSchoolSmsApiKey(schoolId);
  if (!stored) {
    throw new WinSmsApiError("WinSMS API key is not configured for this school", 400);
  }
  return { apiKey: stored, persist: true };
}

async function persistConnectionSuccess(
  schoolId: string,
  creditBalance: number,
  persist: boolean
): Promise<SchoolSmsSettingsPublic> {
  const now = new Date();
  if (!persist) {
    return {
      ...(await getPublicSchoolSmsSettings(schoolId)),
      connectionStatus: "connected",
      creditBalance,
      creditBalanceCheckedAt: now.toISOString(),
      connectionTestedAt: now.toISOString(),
      lastConnectionError: null,
      ready: true,
      configured: true,
      apiKeySet: true,
    };
  }

  const existing = await getSchoolSmsSettingsRow(schoolId);
  if (!existing) {
    return persistConnectionSuccess(schoolId, creditBalance, false);
  }

  const row = await prisma.schoolSmsSettings.update({
    where: { schoolId },
    data: {
      connectionStatus: "connected",
      creditBalance,
      creditBalanceCheckedAt: now,
      connectionTestedAt: now,
      lastConnectionError: null,
    },
  });

  return toPublicSettings(row, schoolId);
}

async function persistConnectionFailure(
  schoolId: string,
  errorMessage: string,
  persist: boolean
): Promise<SchoolSmsSettingsPublic> {
  const now = new Date();
  if (!persist) {
    return {
      ...(await getPublicSchoolSmsSettings(schoolId)),
      connectionStatus: "failed",
      connectionTestedAt: now.toISOString(),
      lastConnectionError: errorMessage,
      ready: false,
    };
  }

  const existing = await getSchoolSmsSettingsRow(schoolId);
  if (!existing) {
    return {
      ...(await getPublicSchoolSmsSettings(schoolId)),
      connectionStatus: "failed",
      connectionTestedAt: now.toISOString(),
      lastConnectionError: errorMessage,
      ready: false,
    };
  }

  const row = await prisma.schoolSmsSettings.update({
    where: { schoolId },
    data: {
      connectionStatus: "failed",
      connectionTestedAt: now,
      lastConnectionError: errorMessage.slice(0, 500),
    },
  });

  return toPublicSettings(row, schoolId);
}

export async function testSchoolSmsConnection(schoolId: string, overrideApiKey?: string) {
  try {
    const { apiKey, persist } = await resolveApiKeyForAction(schoolId, overrideApiKey);
    const { creditBalance } = await getWinSmsCreditBalance(apiKey);
    const settings = await persistConnectionSuccess(schoolId, creditBalance, persist);
    return {
      ok: true as const,
      creditBalance,
      settings,
      message: `Connected to WinSMS. Available credits: ${creditBalance.toLocaleString("en-ZA")}`,
    };
  } catch (error) {
    const message =
      error instanceof WinSmsApiError
        ? error.message
        : error instanceof Error
          ? error.message
          : "WinSMS connection test failed";
    const settings = await persistConnectionFailure(
      schoolId,
      message,
      Boolean(await getSchoolSmsSettingsRow(schoolId))
    );
    return {
      ok: false as const,
      error: message,
      settings,
    };
  }
}

export async function checkSchoolSmsCreditBalance(schoolId: string) {
  try {
    const { apiKey } = await resolveApiKeyForAction(schoolId);
    const { creditBalance } = await getWinSmsCreditBalance(apiKey);
    const now = new Date();
    const existing = await getSchoolSmsSettingsRow(schoolId);
    if (!existing) {
      return {
        ok: true as const,
        creditBalance,
        settings: {
          ...(await getPublicSchoolSmsSettings(schoolId)),
          creditBalance,
          creditBalanceCheckedAt: now.toISOString(),
        },
      };
    }

    const row = await prisma.schoolSmsSettings.update({
      where: { schoolId },
      data: {
        creditBalance,
        creditBalanceCheckedAt: now,
      },
    });

    return {
      ok: true as const,
      creditBalance,
      settings: toPublicSettings(row, schoolId),
    };
  } catch (error) {
    const message =
      error instanceof WinSmsApiError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Failed to check WinSMS credit balance";
    return {
      ok: false as const,
      error: message,
      settings: await getPublicSchoolSmsSettings(schoolId),
    };
  }
}

export async function sendSchoolSms(
  schoolId: string,
  input: WinSmsSendInput & { clientMessageIdPrefix?: string }
) {
  const apiKey = await getDecryptedSchoolSmsApiKey(schoolId);
  if (!apiKey) {
    throw new WinSmsApiError("WinSMS is not configured for this school", 400);
  }

  const recipients = input.recipients.map((recipient, index) => ({
    ...recipient,
    clientMessageId:
      recipient.clientMessageId ||
      (input.clientMessageIdPrefix
        ? `${input.clientMessageIdPrefix}-${index + 1}`
        : undefined),
  }));

  return sendWinSms(apiKey, {
    message: input.message,
    recipients,
    maxSegments: input.maxSegments,
    scheduledTime: input.scheduledTime,
  });
}

export async function getSchoolSmsDeliveryStatus(schoolId: string, messageIds: number[]) {
  const apiKey = await getDecryptedSchoolSmsApiKey(schoolId);
  if (!apiKey) {
    throw new WinSmsApiError("WinSMS is not configured for this school", 400);
  }
  return getWinSmsDeliveryStatus(apiKey, messageIds);
}

export function maskApiKeyForClient(_apiKey: string) {
  return maskSecret(_apiKey);
}
