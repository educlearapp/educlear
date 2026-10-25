/**
 * EduClear Parent Portal in-app notification chime (Phase 4C).
 * Audio unlocks only after a user gesture. Never forces OS/iOS silent mode.
 */

export const PARENT_CHIME_URL = "/parent-pwa/educlear-parent-chime.wav";

let audioEl: HTMLAudioElement | null = null;
let unlocked = false;
let playInFlight = false;
let lastPlayAt = 0;

function getAudio(): HTMLAudioElement | null {
  if (typeof window === "undefined" || typeof Audio === "undefined") return null;
  if (!audioEl) {
    audioEl = new Audio(PARENT_CHIME_URL);
    audioEl.preload = "auto";
    audioEl.volume = 0.55;
  }
  return audioEl;
}

/** Call from a click/tap handler so subsequent programmatic plays may succeed. */
export async function unlockParentNotificationSound(): Promise<boolean> {
  const el = getAudio();
  if (!el) return false;
  try {
    el.muted = true;
    await el.play();
    el.pause();
    el.currentTime = 0;
    el.muted = false;
    unlocked = true;
    return true;
  } catch {
    unlocked = false;
    return false;
  }
}

export function isParentNotificationSoundUnlocked(): boolean {
  return unlocked;
}

export function parseQuietHm(hm: string | null | undefined): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(hm || "").trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Quiet-hours check (local clock; overnight wrap supported). */
export function isWithinQuietHours(
  now: Date,
  start: string | null | undefined,
  end: string | null | undefined
): boolean {
  const s = parseQuietHm(start);
  const e = parseQuietHm(end);
  if (s == null || e == null || s === e) return false;
  const mins = now.getHours() * 60 + now.getMinutes();
  if (s < e) return mins >= s && mins < e;
  return mins >= s || mins < e;
}

export type PlayChimeResult = "played" | "skipped_locked" | "skipped_busy" | "skipped_denied" | "unsupported";

/**
 * Play the EduClear chime once. Debounced to avoid overlapping polls.
 * Requires prior unlock via user gesture (except some browsers that allow unmuted play after unlock).
 */
export async function playParentNotificationChime(opts?: { forceUnlock?: boolean }): Promise<PlayChimeResult> {
  const el = getAudio();
  if (!el) return "unsupported";
  const now = Date.now();
  if (playInFlight || now - lastPlayAt < 1200) return "skipped_busy";
  if (!unlocked && !opts?.forceUnlock) return "skipped_locked";

  playInFlight = true;
  try {
    if (opts?.forceUnlock && !unlocked) {
      await unlockParentNotificationSound();
    }
    el.pause();
    el.currentTime = 0;
    el.muted = false;
    await el.play();
    lastPlayAt = Date.now();
    unlocked = true;
    return "played";
  } catch {
    return "skipped_denied";
  } finally {
    playInFlight = false;
  }
}

/** Test Sound — must be invoked directly from a user gesture. */
export async function testParentNotificationChime(): Promise<PlayChimeResult> {
  return playParentNotificationChime({ forceUnlock: true });
}

/** Reset module state (logout / tests). */
export function resetParentNotificationSoundForTests() {
  unlocked = false;
  playInFlight = false;
  lastPlayAt = 0;
  if (audioEl) {
    try {
      audioEl.pause();
    } catch {
      /* ignore */
    }
  }
  audioEl = null;
}
