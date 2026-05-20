import type { ProviderSendContext, ProviderSendResult } from "./emailProvider";

export async function sendSmsPlaceholder(ctx: ProviderSendContext): Promise<ProviderSendResult> {
  void ctx;
  return { ok: true, simulated: true, reference: `sms:${ctx.messageId}` };
}
