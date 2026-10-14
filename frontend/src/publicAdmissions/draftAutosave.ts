/**
 * Draft autosave helpers for the public application form.
 *
 * Saves run one at a time. A save requested while another is in flight is queued and runs
 * after it with the latest form, so an older response can never be applied after a newer
 * save and two PATCH requests from the same page never overlap.
 */
import { PublicAdmissionsApiError } from "./publicAdmissionsApi";
import type { DraftSaveUiState } from "./publicAdmissionsTypes";

export const AUTOSAVE_DEBOUNCE_MS = 1200;
export const AUTOSAVE_RETRY_DELAYS_MS = [2000, 5000, 15000, 30000] as const;
const MAX_QUEUED_PASSES = 5;

export class SingleFlightSaver {
  private inFlight: Promise<boolean> | null = null;
  private rerun = false;

  constructor(private readonly run: () => Promise<boolean>) {}

  get busy(): boolean {
    return this.inFlight != null;
  }

  /** Resolves with the outcome of the last pass covering every request made so far. */
  flush(): Promise<boolean> {
    if (this.inFlight) {
      this.rerun = true;
      return this.inFlight;
    }
    const task = (async () => {
      let ok = false;
      let passes = 0;
      do {
        this.rerun = false;
        passes += 1;
        try {
          ok = await this.run();
        } catch {
          ok = false;
        }
      } while (this.rerun && ok && passes < MAX_QUEUED_PASSES);
      return ok;
    })();
    this.inFlight = task;
    void task.finally(() => {
      if (this.inFlight === task) this.inFlight = null;
    });
    return task;
  }
}

export function autosaveRetryDelayMs(attempt: number): number {
  const index = Math.max(0, Math.min(attempt, AUTOSAVE_RETRY_DELAYS_MS.length - 1));
  return AUTOSAVE_RETRY_DELAYS_MS[index];
}

export type SaveFailureKind = "network" | "server" | "rejected" | "session";

/** Network loss, timeouts, rate limits and server errors are retried; validation is not. */
export function classifySaveFailure(err: unknown): SaveFailureKind {
  if (err instanceof PublicAdmissionsApiError) {
    if (err.status === 404) return "session";
    if (err.status === 0) return "network";
    if (err.status === 408 || err.status === 429 || err.status >= 500) return "server";
    return "rejected";
  }
  return "network";
}

export function isRetryableSaveFailure(kind: SaveFailureKind): boolean {
  return kind === "network" || kind === "server";
}

function formatSavedTime(at: Date): string {
  const hh = String(at.getHours()).padStart(2, "0");
  const mm = String(at.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * Status line text. "All changes saved" only appears when the server has confirmed the
 * current entries (a successful save, or a server copy loaded with nothing changed since).
 */
export function draftSaveStatusText(input: {
  saveState: DraftSaveUiState;
  lastConfirmedAt: Date | null;
  offline: boolean;
  retryScheduled: boolean;
}): string {
  const { saveState, lastConfirmedAt, offline, retryScheduled } = input;
  if (saveState === "saving") return "Saving…";
  if (saveState === "failed") {
    if (offline) return "Offline — not saved yet";
    return retryScheduled ? "Save failed — retrying" : "Save failed";
  }
  if (saveState === "dirty") return offline ? "Offline — not saved yet" : "Unsaved changes";
  if (saveState === "saved") {
    return lastConfirmedAt ? `Saved at ${formatSavedTime(lastConfirmedAt)}` : "Saved";
  }
  return lastConfirmedAt ? "All changes saved" : "Your details save automatically as you type";
}
