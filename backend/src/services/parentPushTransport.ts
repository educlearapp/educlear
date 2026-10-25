/**
 * Web Push transport layer (Phase 4B).
 * External delivery requires WEB_PUSH_DELIVERY_ENABLED=true.
 * Tests inject MockPushTransport — never mark mock success as externalSent.
 */

export type PushSubscriptionWire = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export type PushPayload = {
  title: string;
  body?: string;
  lockScreenPreview: boolean;
  notificationId: string;
  type: string;
};

export type PushTransportResult = {
  ok: boolean;
  /** True only for a real provider HTTP success — never for mocks/simulations. */
  externalSent: boolean;
  simulated: boolean;
  statusCode?: number;
  error?: string;
  reference?: string;
};

export interface ParentPushTransport {
  send(subscription: PushSubscriptionWire, payload: PushPayload): Promise<PushTransportResult>;
}

export class MockPushTransport implements ParentPushTransport {
  readonly sent: Array<{ endpoint: string; payload: PushPayload }> = [];
  nextResult: PushTransportResult = {
    ok: true,
    externalSent: false,
    simulated: true,
    reference: "mock-ok",
  };
  failWithStatus: number | null = null;

  async send(subscription: PushSubscriptionWire, payload: PushPayload): Promise<PushTransportResult> {
    this.sent.push({ endpoint: subscription.endpoint, payload });
    if (this.failWithStatus != null) {
      return {
        ok: false,
        externalSent: false,
        simulated: true,
        statusCode: this.failWithStatus,
        error: `mock_http_${this.failWithStatus}`,
      };
    }
    // Mock must never claim externalSent=true.
    return {
      ...this.nextResult,
      externalSent: false,
      simulated: true,
    };
  }
}

/** Real web-push (lazy-loaded). Only constructed when feature flag + VAPID are configured. */
export class WebPushTransport implements ParentPushTransport {
  private ready: Promise<void>;
  private webpush: typeof import("web-push") | null = null;

  constructor() {
    this.ready = this.init();
  }

  private async init() {
    const pub = String(process.env.VAPID_PUBLIC_KEY || "").trim();
    const priv = String(process.env.VAPID_PRIVATE_KEY || "").trim();
    const subject = String(process.env.VAPID_SUBJECT || "mailto:support@educlear.co.za").trim();
    if (!pub || !priv) {
      throw new Error("vapid_keys_missing");
    }
    // Dynamic import so local/default builds can run tests without calling the provider.
    const webpush = await import("web-push");
    webpush.setVapidDetails(subject, pub, priv);
    this.webpush = webpush;
  }

  async send(subscription: PushSubscriptionWire, payload: PushPayload): Promise<PushTransportResult> {
    await this.ready;
    if (!this.webpush) {
      return { ok: false, externalSent: false, simulated: false, error: "web_push_not_loaded" };
    }
    try {
      const body = JSON.stringify({
        title: payload.title,
        ...(payload.lockScreenPreview && payload.body ? { body: payload.body, lockScreenPreview: true } : {}),
        notificationId: payload.notificationId,
        type: payload.type,
      });
      const res = await this.webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: subscription.keys,
        },
        body,
        { TTL: 60 * 60 }
      );
      const statusCode = typeof res?.statusCode === "number" ? res.statusCode : 201;
      if (statusCode >= 200 && statusCode < 300) {
        return {
          ok: true,
          externalSent: true,
          simulated: false,
          statusCode,
          reference: `web-push:${statusCode}`,
        };
      }
      return {
        ok: false,
        externalSent: false,
        simulated: false,
        statusCode,
        error: `web_push_http_${statusCode}`,
      };
    } catch (e: unknown) {
      const statusCode =
        typeof (e as { statusCode?: number })?.statusCode === "number"
          ? (e as { statusCode: number }).statusCode
          : undefined;
      const message = e instanceof Error ? e.message : String(e);
      return {
        ok: false,
        externalSent: false,
        simulated: false,
        statusCode,
        error: message.slice(0, 200),
      };
    }
  }
}

export function isWebPushDeliveryEnabled(): boolean {
  return String(process.env.WEB_PUSH_DELIVERY_ENABLED || "").trim().toLowerCase() === "true";
}

let injectedTransport: ParentPushTransport | null = null;

/** Test-only: inject mock transport. */
export function setParentPushTransportForTests(transport: ParentPushTransport | null) {
  injectedTransport = transport;
}

export function getParentPushTransport(): ParentPushTransport {
  if (injectedTransport) return injectedTransport;
  if (!isWebPushDeliveryEnabled()) {
    return new MockPushTransport(); // never used for external claim when flag off
  }
  return new WebPushTransport();
}
