import type { ProviderSendContext, ProviderSendResult } from "./emailProvider";

/**
 * Communication-engine PUSH channel placeholder.
 * Parent Portal Web Push uses parentPushDeliveryEngine — never this path.
 * Always fail so the outbound communication queue cannot mark push as sent.
 */
export async function sendPushPlaceholder(ctx: ProviderSendContext): Promise<ProviderSendResult> {
  void ctx;
  return {
    ok: false,
    simulated: true,
    error: "web_push_use_parent_push_engine",
    reference: `push-engine-only:${ctx.messageId}`,
  };
}
