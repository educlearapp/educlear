import { useCallback, useEffect, useState } from "react";
import { parentApiFetch } from "./parentApi";
import {
  getCurrentBrowserPushEndpoint,
  getPushSupportState,
  subscribeParentPush,
  unsubscribeBrowserPush,
  type PushSupportState,
} from "./parentPushClient";

type Prefs = {
  pushEnabled: boolean;
  pushTeacherMessages: boolean;
  pushAnnouncements: boolean;
  pushEvents: boolean;
  soundEnabled: boolean;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  lockScreenPreview: boolean;
};

type DeviceRow = {
  id: string;
  endpointHost: string;
  deviceLabel: string | null;
  enabled: boolean;
  lastSeenAt: string | null;
};

const DEFAULT_PREFS: Prefs = {
  pushEnabled: false,
  pushTeacherMessages: true,
  pushAnnouncements: true,
  pushEvents: true,
  soundEnabled: false,
  quietHoursStart: null,
  quietHoursEnd: null,
  lockScreenPreview: false,
};

function supportMessage(state: PushSupportState): string {
  switch (state) {
    case "unsupported":
      return "Push notifications are not supported in this browser.";
    case "insecure_context":
      return "Push requires a secure (HTTPS) connection.";
    case "denied":
      return "Browser notifications are blocked. Enable them in browser settings if you want alerts.";
    default:
      return "Alerts stay on this device only after you enable them below. We never turn them on automatically.";
  }
}

export default function ParentPushSettings() {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [vapidKey, setVapidKey] = useState<string | null>(null);
  const [support, setSupport] = useState<PushSupportState>(() => getPushSupportState());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quietStart, setQuietStart] = useState("");
  const [quietEnd, setQuietEnd] = useState("");

  const refresh = useCallback(async () => {
    setError(null);
    setSupport(getPushSupportState());
    try {
      const [prefRes, subRes, vapidRes] = await Promise.all([
        parentApiFetch("/api/parent-portal/notification-preferences"),
        parentApiFetch("/api/parent-portal/push/subscriptions"),
        parentApiFetch("/api/parent-portal/push/vapid-public-key"),
      ]);
      if (prefRes?.preferences) {
        setPrefs({ ...DEFAULT_PREFS, ...prefRes.preferences });
        setQuietStart(prefRes.preferences.quietHoursStart || "");
        setQuietEnd(prefRes.preferences.quietHoursEnd || "");
      }
      setDevices(Array.isArray(subRes?.subscriptions) ? subRes.subscriptions : []);
      setVapidKey(vapidRes?.publicKey || null);
    } catch (e: any) {
      setError(e?.message || "Could not load notification settings");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const savePrefs = async (patch: Partial<Prefs>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const data = await parentApiFetch("/api/parent-portal/notification-preferences", {
        method: "PUT",
        body: JSON.stringify(patch),
      });
      if (data?.preferences) {
        setPrefs({ ...DEFAULT_PREFS, ...data.preferences });
        setQuietStart(data.preferences.quietHoursStart || "");
        setQuietEnd(data.preferences.quietHoursEnd || "");
      }
      setNotice("Preferences saved.");
    } catch (e: any) {
      setError(e?.message || "Could not save preferences");
    } finally {
      setBusy(false);
    }
  };

  const onEnablePush = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      // Persist opt-in preference first; browser permission only after this user action.
      await parentApiFetch("/api/parent-portal/notification-preferences", {
        method: "PUT",
        body: JSON.stringify({ pushEnabled: true }),
      });

      if (!vapidKey) {
        setPrefs((p) => ({ ...p, pushEnabled: true }));
        setNotice(
          "Push preference saved. Device subscription needs a VAPID public key (set VAPID_PUBLIC_KEY locally). Live delivery is not enabled yet."
        );
        setSupport(getPushSupportState());
        return;
      }

      const browserSub = await subscribeParentPush(vapidKey);
      setSupport(getPushSupportState());
      if (!browserSub) {
        setPrefs((p) => ({ ...p, pushEnabled: true }));
        setNotice("Preference saved. Browser did not grant notification permission, or push is unsupported here.");
        return;
      }

      await parentApiFetch("/api/parent-portal/push/subscriptions", {
        method: "POST",
        body: JSON.stringify({
          endpoint: browserSub.endpoint,
          keys: browserSub.keys,
          deviceLabel: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 40) : null,
        }),
      });
      await refresh();
      setNotice("This device is registered for future alerts. Live push delivery is not enabled yet (Phase 4B).");
    } catch (e: any) {
      setError(e?.message || "Could not enable push on this device");
    } finally {
      setBusy(false);
    }
  };

  const onDisablePush = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const endpoint = await getCurrentBrowserPushEndpoint();
      if (endpoint) {
        await parentApiFetch("/api/parent-portal/push/unsubscribe", {
          method: "POST",
          body: JSON.stringify({ endpoint }),
        }).catch(() => undefined);
        await unsubscribeBrowserPush().catch(() => false);
      }
      await savePrefs({ pushEnabled: false });
      await refresh();
      setNotice("Push alerts disabled for this account preference.");
    } catch (e: any) {
      setError(e?.message || "Could not disable push");
    } finally {
      setBusy(false);
    }
  };

  const onDisableDevice = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await parentApiFetch(`/api/parent-portal/push/subscriptions/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      await refresh();
      setNotice("Device unsubscribed.");
    } catch (e: any) {
      setError(e?.message || "Could not unsubscribe device");
    } finally {
      setBusy(false);
    }
  };

  const onSaveQuietHours = async () => {
    await savePrefs({
      quietHoursStart: quietStart.trim() || null,
      quietHoursEnd: quietEnd.trim() || null,
    });
  };

  return (
    <div className="parent-push-settings" style={{ marginTop: 16 }}>
      <div className="parent-portal-section-label">Notifications</div>
      <p className="parent-portal-muted" style={{ fontSize: 13, marginBottom: 12 }}>
        {supportMessage(support)}
      </p>

      {error ? (
        <p className="parent-portal-error" style={{ fontSize: 13 }}>
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="parent-portal-muted" style={{ fontSize: 13, color: "var(--p-navy)" }}>
          {notice}
        </p>
      ) : null}

      <label className="parent-push-toggle">
        <input
          type="checkbox"
          checked={prefs.pushEnabled}
          disabled={busy || support === "unsupported" || support === "insecure_context"}
          onChange={(e) => {
            if (e.target.checked) void onEnablePush();
            else void onDisablePush();
          }}
        />
        <span>Enable push notifications</span>
      </label>

      <label className="parent-push-toggle">
        <input
          type="checkbox"
          checked={prefs.pushTeacherMessages}
          disabled={busy}
          onChange={(e) => void savePrefs({ pushTeacherMessages: e.target.checked })}
        />
        <span>Teacher messages</span>
      </label>

      <label className="parent-push-toggle">
        <input
          type="checkbox"
          checked={prefs.pushAnnouncements}
          disabled={busy}
          onChange={(e) => void savePrefs({ pushAnnouncements: e.target.checked })}
        />
        <span>School announcements</span>
      </label>

      <label className="parent-push-toggle">
        <input
          type="checkbox"
          checked={prefs.pushEvents}
          disabled={busy}
          onChange={(e) => void savePrefs({ pushEvents: e.target.checked })}
        />
        <span>School events</span>
      </label>

      <label className="parent-push-toggle">
        <input
          type="checkbox"
          checked={prefs.soundEnabled}
          disabled={busy}
          onChange={(e) => void savePrefs({ soundEnabled: e.target.checked })}
        />
        <span>In-app sound</span>
      </label>

      <label className="parent-push-toggle">
        <input
          type="checkbox"
          checked={prefs.lockScreenPreview}
          disabled={busy}
          onChange={(e) => void savePrefs({ lockScreenPreview: e.target.checked })}
        />
        <span>Show message previews on lock screen (off by default)</span>
      </label>

      <div style={{ marginTop: 12 }}>
        <div className="parent-portal-muted" style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
          Quiet hours (optional, HH:mm)
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input
            className="parent-portal-input"
            style={{ width: 96 }}
            placeholder="Start"
            value={quietStart}
            onChange={(e) => setQuietStart(e.target.value)}
            disabled={busy}
            aria-label="Quiet hours start"
          />
          <span className="parent-portal-muted">to</span>
          <input
            className="parent-portal-input"
            style={{ width: 96 }}
            placeholder="End"
            value={quietEnd}
            onChange={(e) => setQuietEnd(e.target.value)}
            disabled={busy}
            aria-label="Quiet hours end"
          />
          <button
            type="button"
            className="parent-portal-btn-ghost"
            disabled={busy}
            onClick={() => void onSaveQuietHours()}
          >
            Save quiet hours
          </button>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <div className="parent-portal-section-label">This account’s devices</div>
        {devices.length === 0 ? (
          <p className="parent-portal-muted" style={{ fontSize: 13 }}>
            No devices registered yet.
          </p>
        ) : (
          <ul className="parent-push-device-list">
            {devices.map((d) => (
              <li key={d.id}>
                <div>
                  <strong>{d.deviceLabel || d.endpointHost}</strong>
                  <div className="parent-portal-muted" style={{ fontSize: 12 }}>
                    {d.endpointHost}
                    {d.enabled ? "" : " · disabled"}
                  </div>
                </div>
                {d.enabled ? (
                  <button
                    type="button"
                    className="parent-portal-btn-ghost"
                    disabled={busy}
                    onClick={() => void onDisableDevice(d.id)}
                  >
                    Remove
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
