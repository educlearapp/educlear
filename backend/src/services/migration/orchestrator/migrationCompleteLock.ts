/**
 * Cross-process migration completion lock (shared disk).
 * Pattern mirrors withBillingLedgerLock — no Redis.
 *
 * Phase 1N: locks live under process.cwd()/data/ (Render persistent disk mount),
 * NOT under storage/ (ephemeral). Same mount as billing-ledger.lock.
 */

import fs from "fs";
import path from "path";

/** Persistent-disk root (billing data mount). Overridable in tests. */
let lockRootOverride: string | null = null;

export function setMigrationCompleteLockRootForTests(dir: string | null): void {
  lockRootOverride = dir;
}

function getLockDir(): string {
  if (lockRootOverride) return path.join(lockRootOverride, "migration-orchestrator", "locks");
  return path.join(process.cwd(), "data", "migration-orchestrator", "locks");
}

const LOCK_MAX_WAIT_MS = 15_000;
const LOCK_STALE_MS = 120_000; // crashed process recovery

function ensureDir(): void {
  const LOCK_DIR = getLockDir();
  if (!fs.existsSync(LOCK_DIR)) fs.mkdirSync(LOCK_DIR, { recursive: true });
}

function sanitize(id: string): string | null {
  const t = String(id || "").trim();
  if (!t || t.includes("..") || t.includes("/") || t.includes("\\")) return null;
  if (!/^[a-zA-Z0-9_-]+$/.test(t)) return null;
  return t;
}

function lockPath(stageId: string): string {
  const safe = sanitize(stageId);
  if (!safe) throw new Error("Invalid stage id for lock");
  return path.join(getLockDir(), `complete_${safe}.lock`);
}

function sleepMs(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* busy wait — short */
  }
}

function clearStale(lockFile: string): void {
  try {
    if (!fs.existsSync(lockFile)) return;
    const st = fs.statSync(lockFile);
    if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
      fs.unlinkSync(lockFile);
    }
  } catch {
    /* ignore */
  }
}

export type MigrationLockInfo = {
  pid: number;
  stageId: string;
  schoolId: string;
  acquiredAt: string;
};

/**
 * Acquire exclusive complete-migration lock for a stage (cross-process via shared disk).
 * Throws if lock cannot be acquired in time.
 */
export async function withMigrationCompleteLock<T>(input: {
  stageId: string;
  schoolId: string;
  fn: () => Promise<T>;
}): Promise<T> {
  ensureDir();
  const lp = lockPath(input.stageId);
  const started = Date.now();
  while (Date.now() - started < LOCK_MAX_WAIT_MS) {
    try {
      const payload: MigrationLockInfo = {
        pid: process.pid,
        stageId: input.stageId,
        schoolId: input.schoolId,
        acquiredAt: new Date().toISOString(),
      };
      fs.writeFileSync(lp, JSON.stringify(payload), { flag: "wx" });
      try {
        return await input.fn();
      } finally {
        try {
          fs.unlinkSync(lp);
        } catch {
          /* ignore */
        }
      }
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code !== "EEXIST") throw error;
      clearStale(lp);
      sleepMs(50 + Math.floor(Math.random() * 50));
    }
  }
  throw new Error(
    "Migration is already being completed for this school package. Please wait and refresh."
  );
}

/** Test helper — force-release stale/active lock. */
export function forceReleaseMigrationCompleteLock(stageId: string): void {
  try {
    const lp = lockPath(stageId);
    if (fs.existsSync(lp)) fs.unlinkSync(lp);
  } catch {
    /* ignore */
  }
}

export function peekMigrationCompleteLock(stageId: string): MigrationLockInfo | null {
  try {
    const lp = lockPath(stageId);
    if (!fs.existsSync(lp)) return null;
    return JSON.parse(fs.readFileSync(lp, "utf8")) as MigrationLockInfo;
  } catch {
    return null;
  }
}

/** Documented production lock root relative to cwd. */
export function getMigrationCompleteLockDir(): string {
  return getLockDir();
}
