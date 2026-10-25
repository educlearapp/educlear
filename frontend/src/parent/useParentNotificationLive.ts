import { useCallback, useEffect, useRef, useState } from "react";
import { parentApiFetch } from "./parentApi";
import { clearParentAppBadge, setParentAppBadge } from "./parentAppBadge";
import {
  PARENT_LIVE_POLL_MS,
  countUnread,
  diffNewNotifications,
  shouldPlayChimeForNewRows,
  type LiveNotificationRow,
} from "./parentNotificationLive";
import {
  isWithinQuietHours,
  playParentNotificationChime,
  unlockParentNotificationSound,
} from "./parentNotificationSound";

type PrefsLite = {
  soundEnabled: boolean;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
};

const DEFAULT_PREFS: PrefsLite = {
  soundEnabled: false,
  quietHoursStart: null,
  quietHoursEnd: null,
};

/**
 * Bounded foreground polling for new ParentNotifications.
 * Seeds known ids on first fetch (no sound). Pauses while document is hidden.
 */
export function useParentNotificationLive(opts: {
  enabled: boolean;
  schoolId: string;
  parentId: string;
}) {
  const [unreadCount, setUnreadCount] = useState(0);
  const [ready, setReady] = useState(false);
  const [prefs, setPrefs] = useState<PrefsLite>(DEFAULT_PREFS);
  const prefsRef = useRef<PrefsLite>(DEFAULT_PREFS);
  const knownRef = useRef<Set<string>>(new Set());
  const seededRef = useRef(false);
  const accountKeyRef = useRef("");
  const inFlightRef = useRef(false);

  useEffect(() => {
    prefsRef.current = prefs;
  }, [prefs]);

  const resetAccount = useCallback(() => {
    knownRef.current = new Set();
    seededRef.current = false;
    setUnreadCount(0);
    setReady(false);
    void clearParentAppBadge();
  }, []);

  useEffect(() => {
    const key = `${opts.schoolId}:${opts.parentId}`;
    if (!opts.schoolId || !opts.parentId) {
      accountKeyRef.current = "";
      resetAccount();
      return;
    }
    if (accountKeyRef.current && accountKeyRef.current !== key) {
      resetAccount();
    }
    accountKeyRef.current = key;
  }, [opts.schoolId, opts.parentId, resetAccount]);

  const refreshPrefs = useCallback(async () => {
    if (!opts.enabled || !opts.parentId) return;
    try {
      const data = await parentApiFetch("/api/parent-portal/notification-preferences");
      const p = data?.preferences || {};
      const next: PrefsLite = {
        soundEnabled: Boolean(p.soundEnabled),
        quietHoursStart: p.quietHoursStart || null,
        quietHoursEnd: p.quietHoursEnd || null,
      };
      prefsRef.current = next;
      setPrefs(next);
    } catch {
      /* keep last */
    }
  }, [opts.enabled, opts.parentId]);

  const poll = useCallback(
    async (reason: "interval" | "focus" | "manual" | "seed") => {
      if (!opts.enabled || !opts.parentId || !opts.schoolId) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden" && reason === "interval") {
        return;
      }
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        const data = await parentApiFetch("/api/parent-portal/notifications");
        const rows = (Array.isArray(data?.notifications) ? data.notifications : []) as LiveNotificationRow[];
        const unread = countUnread(rows);
        setUnreadCount(unread);
        setReady(true);
        void setParentAppBadge(unread);

        const { nextKnown, newRows, nextSeeded } = diffNewNotifications(
          knownRef.current,
          rows,
          seededRef.current
        );
        knownRef.current = nextKnown;
        const wasSeeded = seededRef.current;
        seededRef.current = nextSeeded;

        const p = prefsRef.current;
        if (
          wasSeeded &&
          newRows.length > 0 &&
          shouldPlayChimeForNewRows(newRows, {
            soundEnabled: p.soundEnabled,
            quietHoursStart: p.quietHoursStart,
            quietHoursEnd: p.quietHoursEnd,
            isWithinQuietHours,
          })
        ) {
          void playParentNotificationChime();
        }
      } catch {
        /* ignore transient errors */
      } finally {
        inFlightRef.current = false;
      }
    },
    [opts.enabled, opts.parentId, opts.schoolId]
  );

  useEffect(() => {
    if (!opts.enabled) {
      void clearParentAppBadge();
      return;
    }
    void (async () => {
      await refreshPrefs();
      await poll("seed");
    })();

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void refreshPrefs();
        void poll("focus");
      }
    };
    const onFocus = () => {
      void refreshPrefs();
      void poll("focus");
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);

    // Unlock audio on first parent gesture anywhere in the portal (autoplay policy).
    const unlockOnce = () => {
      void unlockParentNotificationSound();
      window.removeEventListener("pointerdown", unlockOnce);
      window.removeEventListener("keydown", unlockOnce);
    };
    window.addEventListener("pointerdown", unlockOnce, { once: true });
    window.addEventListener("keydown", unlockOnce, { once: true });

    const timer = window.setInterval(() => void poll("interval"), PARENT_LIVE_POLL_MS);

    const onSwMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== "object") return;
      if (data.type === "educlear-parent-push" || data.type === "educlear-parent-open-alerts") {
        void poll("manual");
      }
    };
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("message", onSwMessage);
    }

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pointerdown", unlockOnce);
      window.removeEventListener("keydown", unlockOnce);
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.removeEventListener("message", onSwMessage);
      }
    };
  }, [opts.enabled, poll, refreshPrefs]);

  const syncAfterMarkRead = useCallback(async () => {
    await poll("manual");
  }, [poll]);

  const clearOnLogout = useCallback(() => {
    resetAccount();
    setPrefs(DEFAULT_PREFS);
  }, [resetAccount]);

  return {
    unreadCount,
    ready,
    prefs,
    refreshPrefs,
    syncAfterMarkRead,
    clearOnLogout,
    pollNow: () => poll("manual"),
  };
}
