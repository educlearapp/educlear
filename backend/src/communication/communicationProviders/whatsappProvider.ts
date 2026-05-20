import type { ProviderSendContext, ProviderSendResult } from "./emailProvider";

export async function sendWhatsAppPlaceholder(ctx: ProviderSendContext): Promise<ProviderSendResult> {
  void ctx;
  return { ok: true, simulated: true, reference: `whatsapp:${ctx.messageId}` };
}
