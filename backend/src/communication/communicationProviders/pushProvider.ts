import type { ProviderSendContext, ProviderSendResult } from "./emailProvider";

/** Web Push delivery — future: load subscriptions by parentId and fan out. */
export async function sendPushPlaceholder(ctx: ProviderSendContext): Promise<ProviderSendResult> {
  void ctx;
  return { ok: true, simulated: true, reference: `push:${ctx.messageId}` };
}
