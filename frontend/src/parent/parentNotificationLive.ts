/**
 * Pure helpers for Parent Portal foreground notification detection (Phase 4C).
 */

export const FOREGROUND_SOUND_TYPES = new Set([
  "TEACHER_MESSAGE",
  "SCHOOL_NOTICE",
  "ASSESSMENT",
  "EXAM",
  "SCHOOL_EVENT",
]);

export type LiveNotificationRow = {
  id: string;
  type: string;
  isRead?: boolean;
  createdAt?: string;
};

export function isForegroundSoundEligibleType(type: string): boolean {
  return FOREGROUND_SOUND_TYPES.has(String(type || ""));
}

export function countUnread(rows: LiveNotificationRow[]): number {
  return rows.reduce((n, r) => n + (r.isRead ? 0 : 1), 0);
}

/**
 * Compare a fresh list to previously known ids.
 * First snapshot (seeded=false) records ids without treating them as "new".
 */
export function diffNewNotifications(
  knownIds: Set<string>,
  rows: LiveNotificationRow[],
  seeded: boolean
): { nextKnown: Set<string>; newRows: LiveNotificationRow[]; nextSeeded: boolean } {
  const nextKnown = new Set(knownIds);
  const newRows: LiveNotificationRow[] = [];
  for (const row of rows) {
    const id = String(row.id || "");
    if (!id) continue;
    if (!nextKnown.has(id)) {
      if (seeded) newRows.push(row);
      nextKnown.add(id);
    }
  }
  return { nextKnown, newRows, nextSeeded: true };
}

/** One chime for a batch if any new row is an eligible type. */
export function shouldPlayChimeForNewRows(
  newRows: LiveNotificationRow[],
  opts: {
    soundEnabled: boolean;
    quietHoursStart: string | null;
    quietHoursEnd: string | null;
    now?: Date;
    isWithinQuietHours: (now: Date, start: string | null, end: string | null) => boolean;
  }
): boolean {
  if (!opts.soundEnabled) return false;
  if (!newRows.some((r) => isForegroundSoundEligibleType(r.type))) return false;
  if (opts.isWithinQuietHours(opts.now || new Date(), opts.quietHoursStart, opts.quietHoursEnd)) {
    return false;
  }
  return true;
}

export const PARENT_LIVE_POLL_MS = 45_000;
