import type { ProviderSendContext, ProviderSendResult } from "./emailProvider";
import { normalizeSaPhone } from "../../services/parentPortalService";
import { isSchoolSmsReady, sendSchoolSms } from "../../services/schoolSmsService";
import { WinSmsApiError } from "../../services/winSmsClient";

export async function sendSmsPlaceholder(ctx: ProviderSendContext): Promise<ProviderSendResult> {
  const schoolId = String(ctx.schoolId || "").trim();
  const to = String(ctx.recipient || "").trim();
  const body = String(ctx.body || "").trim();

  if (!schoolId || !to || !body) {
    return { ok: false, simulated: false, error: "Missing SMS destination or message body" };
  }

  const ready = await isSchoolSmsReady(schoolId);
  if (!ready) {
    return { ok: true, simulated: true, reference: `sms:${ctx.messageId}` };
  }

  try {
    const { plainInternational } = normalizeSaPhone(to);
    const response = await sendSchoolSms(schoolId, {
      message: body,
      recipients: [{ mobileNumber: plainInternational, clientMessageId: ctx.messageId }],
      maxSegments: Math.max(1, Math.ceil(body.length / 160)),
      clientMessageIdPrefix: ctx.messageId ? `comm-${ctx.messageId}` : "comm",
    });

    return {
      ok: true,
      simulated: false,
      reference: String(response.timeStamp || ctx.messageId || "sms"),
    };
  } catch (error) {
    const message =
      error instanceof WinSmsApiError
        ? error.message
        : error instanceof Error
          ? error.message
          : "SMS send failed";
    return { ok: false, simulated: false, error: message };
  }
}
