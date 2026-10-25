import type { ProviderSendContext, ProviderSendResult } from "./emailProvider";

/**
 * Phase 4A: real Web Push is not enabled.
 * Never report success for simulated delivery — queue must record failure until Phase 4B.
 *
 * Phase 4B worker integration (not implemented here):
 * 1. Resolve ParentNotification + ParentNotificationPreference (respect quiet hours / category toggles).
 * 2. Load enabled PushSubscription rows for that parent/school.
 * 3. Create ParentPushDelivery (unique parentNotificationId+subscriptionId) before send.
 * 4. Build privacy-safe payload (title/type/id; body only if lockScreenPreview).
 * 5. Send via web-push with VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY from env; update delivery + failCount.
 */
export async function sendPushPlaceholder(ctx: ProviderSendContext): Promise<ProviderSendResult> {
  void ctx;
  return {
    ok: false,
    simulated: true,
    error: "web_push_not_enabled_phase_4a",
    reference: `push-deferred:${ctx.messageId}`,
  };
}
