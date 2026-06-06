import { normalizeSaPhone } from "./parentPortalService";
import { isSchoolSmsReady, sendSchoolSms } from "./schoolSmsService";
import { WinSmsApiError } from "./winSmsClient";

export type OtpPurpose = "parent_registration" | "parent_login" | "password_reset";

type OtpRecord = {
  code: string;
  expiresAt: number;
  purpose: OtpPurpose;
};

const otpStore = new Map<string, OtpRecord>();
const OTP_TTL_MS = 10 * 60 * 1000;

export function buildOtpStoreKey(scope: string, identifier: string) {
  return `${scope}:${identifier}`;
}

export function generateOtpCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export function storeOtp(key: string, code: string, purpose: OtpPurpose, ttlMs = OTP_TTL_MS) {
  otpStore.set(key, {
    code,
    purpose,
    expiresAt: Date.now() + ttlMs,
  });
}

export function verifyStoredOtp(key: string, code: string, purpose: OtpPurpose) {
  const record = otpStore.get(key);
  if (!record || record.purpose !== purpose) return false;
  if (record.expiresAt < Date.now()) return false;
  if (record.code !== code) return false;
  otpStore.delete(key);
  return true;
}

export function consumeStoredOtp(key: string, code: string) {
  const record = otpStore.get(key);
  if (!record || record.expiresAt < Date.now()) return false;
  if (record.code !== code) return false;
  otpStore.delete(key);
  return true;
}

export function buildOtpSmsMessage(purpose: OtpPurpose, code: string, schoolName?: string) {
  const prefix = schoolName ? `${schoolName}: ` : "";
  switch (purpose) {
    case "parent_registration":
      return `${prefix}Your Parent Portal registration code is ${code}. Valid for 10 minutes.`;
    case "parent_login":
      return `${prefix}Your Parent Portal login code is ${code}. Valid for 10 minutes.`;
    case "password_reset":
      return `${prefix}Your EduClear password reset code is ${code}. Valid for 10 minutes.`;
    default:
      return `${prefix}Your verification code is ${code}. Valid for 10 minutes.`;
  }
}

export function resolveMobileForSms(rawCellNo: string) {
  const { plainInternational } = normalizeSaPhone(rawCellNo);
  return plainInternational;
}

export type DeliverOtpSmsResult =
  | { delivered: true; delivery: "sms" }
  | { delivered: false; delivery: "not_configured" | "missing_mobile" | "failed"; error?: string };

export async function deliverOtpSms(opts: {
  schoolId: string;
  cellNo: string;
  purpose: OtpPurpose;
  code: string;
  schoolName?: string;
  clientMessageIdPrefix?: string;
}): Promise<DeliverOtpSmsResult> {
  const mobile = resolveMobileForSms(opts.cellNo);
  if (!mobile || mobile.length < 10) {
    return { delivered: false, delivery: "missing_mobile" };
  }

  const smsReady = await isSchoolSmsReady(opts.schoolId);
  if (!smsReady) {
    return { delivered: false, delivery: "not_configured" };
  }

  try {
    await sendSchoolSms(opts.schoolId, {
      message: buildOtpSmsMessage(opts.purpose, opts.code, opts.schoolName),
      recipients: [{ mobileNumber: mobile }],
      maxSegments: 1,
      clientMessageIdPrefix: opts.clientMessageIdPrefix || `otp-${opts.purpose}`,
    });
    return { delivered: true, delivery: "sms" };
  } catch (error) {
    const message =
      error instanceof WinSmsApiError
        ? error.message
        : error instanceof Error
          ? error.message
          : "SMS delivery failed";
    console.error("[otpSmsService] OTP SMS delivery failed", {
      schoolId: opts.schoolId,
      purpose: opts.purpose,
      error: message,
    });
    return { delivered: false, delivery: "failed", error: message };
  }
}

export async function isSchoolSmsConfiguredForOtp(schoolId: string) {
  return isSchoolSmsReady(schoolId);
}
