import { sendSchoolEmail } from "../../services/schoolEmailService";

export type ProviderSendContext = {
  schoolId: string;
  messageId: string;
  recipient: string;
  subject: string;
  body: string;
};

export type ProviderSendResult = {
  ok: boolean;
  simulated: boolean;
  reference?: string;
  error?: string;
  setupRequired?: boolean;
};

export async function sendEmailPlaceholder(ctx: ProviderSendContext): Promise<ProviderSendResult> {
  const recipient = String(ctx.recipient || "").trim();
  if (!recipient) {
    return { ok: false, simulated: false, error: "missing_recipient" };
  }

  try {
    const result = await sendSchoolEmail(ctx.schoolId, {
      to: recipient,
      subject: ctx.subject || "Message from your school",
      html: `<div style="font-family:Arial,sans-serif;line-height:1.5">${String(ctx.body || "")
        .split("\n")
        .map((line) => `<p style="margin:0 0 8px">${line}</p>`)
        .join("")}</div>`,
    });
    return {
      ok: true,
      simulated: false,
      reference: result.messageId || `email:${ctx.messageId}`,
    };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    const setupRequired = Boolean((e as { setupRequired?: boolean }).setupRequired);
    return {
      ok: false,
      simulated: false,
      error: message,
      setupRequired,
    };
  }
}
