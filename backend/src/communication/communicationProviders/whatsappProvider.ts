import type { ProviderSendContext, ProviderSendResult } from "./emailProvider";

/**
 * WhatsApp is not enabled for live delivery.
 * Must never report ok:true — the queue previously marked simulated WhatsApp as "sent".
 */
export async function sendWhatsAppPlaceholder(ctx: ProviderSendContext): Promise<ProviderSendResult> {
  void ctx;
  return {
    ok: false,
    simulated: true,
    error: "whatsapp_not_enabled",
    reference: `whatsapp-held:${ctx.messageId}`,
  };
}
