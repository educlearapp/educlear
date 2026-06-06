import fs from "fs";
import path from "path";

import { isProductionRuntime } from "../services/runtime";

/** Render blueprint mount path for educlear-billing-data disk. */
export const RENDER_BILLING_DISK_MOUNT = "/opt/render/project/src/backend/data";

export const AUTO_SEED_PHASE1_BILLING_DISK_ENV = "AUTO_SEED_PHASE1_BILLING_DISK";

export type BillingDataPaths = {
  cwd: string;
  dataDir: string;
  ledgerFile: string;
  ageAnalysisFile: string;
  paymentAllocationFile: string;
  expectedRenderMountPath: string;
};

export type BillingPersistenceDiagnostics = BillingDataPaths & {
  success: true;
  nodeEnv: string;
  gitCommit: string;
  serverTime: string;
  autoSeedPhase1BillingDisk: string;
  requireBillingPersistentDisk: string;
  billingPersistenceGuard: string;
  persistentDiskDetected: boolean;
  dataDirIsSeparateDeviceFromCwd: boolean;
  dataDirResolvedPath: string;
  dataDirMatchesExpectedRenderMount: boolean;
  mountEntriesForDataDir: string[];
  ledgerFileExists: boolean;
  ledgerFileSizeBytes: number | null;
  ledgerFileModifiedTime: string | null;
  ledgerEntryCountTotal: number;
  ledgerEntryCountDaSilva: number;
  ageAnalysisFileExists: boolean;
  paymentAllocationFileExists: boolean;
  filesystem: {
    cwdDevice: number | null;
    dataDirDevice: number | null;
    cwdInode: number | null;
    dataDirInode: number | null;
  };
  paymentWritesAllowed: boolean;
  paymentWriteBlockReason: string | null;
};

export function getBillingDataPaths(): BillingDataPaths {
  const cwd = process.cwd();
  const dataDir = path.join(cwd, "data");
  return {
    cwd,
    dataDir,
    ledgerFile: path.join(dataDir, "billing-ledger.json"),
    ageAnalysisFile: path.join(dataDir, "family-account-age-analysis.json"),
    paymentAllocationFile: path.join(dataDir, "payment-allocations.json"),
    expectedRenderMountPath: RENDER_BILLING_DISK_MOUNT,
  };
}

function readMountLinesForPath(targetPath: string): string[] {
  try {
    const resolved = fs.realpathSync(targetPath);
    const raw = fs.readFileSync("/proc/mounts", "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => {
        const mountPoint = line.split(/\s+/)[1];
        if (!mountPoint) return false;
        return (
          resolved === mountPoint ||
          resolved.startsWith(`${mountPoint}/`) ||
          mountPoint === targetPath ||
          mountPoint.startsWith(targetPath)
        );
      });
  } catch {
    return [];
  }
}

function countLedgerEntries(ledgerFile: string): { total: number; daSilva: number } {
  const DA_SILVA = "cmpideqeq0000108xb6ouv9zi";
  try {
    const parsed = JSON.parse(fs.readFileSync(ledgerFile, "utf8")) as Record<string, unknown>;
    let total = 0;
    for (const value of Object.values(parsed)) {
      if (Array.isArray(value)) total += value.length;
    }
    const daSilva = Array.isArray(parsed[DA_SILVA]) ? parsed[DA_SILVA].length : 0;
    return { total, daSilva };
  } catch {
    return { total: 0, daSilva: 0 };
  }
}

function detectPersistentDisk(paths: BillingDataPaths): {
  persistentDiskDetected: boolean;
  dataDirIsSeparateDeviceFromCwd: boolean;
  dataDirResolvedPath: string;
  dataDirMatchesExpectedRenderMount: boolean;
  mountEntriesForDataDir: string[];
  filesystem: BillingPersistenceDiagnostics["filesystem"];
} {
  const filesystem: BillingPersistenceDiagnostics["filesystem"] = {
    cwdDevice: null,
    dataDirDevice: null,
    cwdInode: null,
    dataDirInode: null,
  };

  let dataDirResolvedPath = paths.dataDir;
  let dataDirIsSeparateDeviceFromCwd = false;

  try {
    if (fs.existsSync(paths.dataDir)) {
      dataDirResolvedPath = fs.realpathSync(paths.dataDir);
      const dataStat = fs.statSync(paths.dataDir);
      filesystem.dataDirDevice = dataStat.dev;
      filesystem.dataDirInode = dataStat.ino;
    }
    const cwdStat = fs.statSync(paths.cwd);
    filesystem.cwdDevice = cwdStat.dev;
    filesystem.cwdInode = cwdStat.ino;
    if (filesystem.dataDirDevice != null && filesystem.cwdDevice != null) {
      dataDirIsSeparateDeviceFromCwd = filesystem.dataDirDevice !== filesystem.cwdDevice;
    }
  } catch {
    /* best-effort */
  }

  const mountEntriesForDataDir = readMountLinesForPath(paths.dataDir);
  const dataDirMatchesExpectedRenderMount =
    dataDirResolvedPath === RENDER_BILLING_DISK_MOUNT;

  // Path alone is NOT sufficient — without a disk, backend/data still exists on container FS.
  const persistentDiskDetected =
    dataDirIsSeparateDeviceFromCwd || mountEntriesForDataDir.length > 0;

  return {
    persistentDiskDetected,
    dataDirIsSeparateDeviceFromCwd,
    dataDirResolvedPath,
    dataDirMatchesExpectedRenderMount,
    mountEntriesForDataDir,
    filesystem,
  };
}

export function shouldEnforceBillingPersistentDisk(): boolean {
  if (String(process.env.BILLING_PERSISTENCE_GUARD || "").trim().toLowerCase() === "skip") {
    return false;
  }
  if (String(process.env.REQUIRE_BILLING_PERSISTENT_DISK || "true").trim().toLowerCase() === "false") {
    return false;
  }
  return isProductionRuntime();
}

export function collectBillingPersistenceDiagnostics(): BillingPersistenceDiagnostics {
  const paths = getBillingDataPaths();
  const disk = detectPersistentDisk(paths);

  let ledgerFileExists = false;
  let ledgerFileSizeBytes: number | null = null;
  let ledgerFileModifiedTime: string | null = null;
  let ledgerEntryCountTotal = 0;
  let ledgerEntryCountDaSilva = 0;

  if (fs.existsSync(paths.ledgerFile)) {
    ledgerFileExists = true;
    try {
      const stat = fs.statSync(paths.ledgerFile);
      ledgerFileSizeBytes = stat.size;
      ledgerFileModifiedTime = stat.mtime.toISOString();
      const counts = countLedgerEntries(paths.ledgerFile);
      ledgerEntryCountTotal = counts.total;
      ledgerEntryCountDaSilva = counts.daSilva;
    } catch {
      /* best-effort */
    }
  }

  const paymentWritesAllowed =
    !shouldEnforceBillingPersistentDisk() || disk.persistentDiskDetected;
  const paymentWriteBlockReason = paymentWritesAllowed
    ? null
    : "Billing persistent disk not detected — payment writes blocked until Render disk is mounted at backend/data.";

  return {
    success: true,
    nodeEnv: process.env.NODE_ENV || "development",
    gitCommit: process.env.GIT_COMMIT || process.env.RENDER_GIT_COMMIT || "—",
    serverTime: new Date().toISOString(),
    autoSeedPhase1BillingDisk: String(process.env[AUTO_SEED_PHASE1_BILLING_DISK_ENV] || "").trim() || "—",
    requireBillingPersistentDisk: String(process.env.REQUIRE_BILLING_PERSISTENT_DISK || "true"),
    billingPersistenceGuard: String(process.env.BILLING_PERSISTENCE_GUARD || "—"),
    paymentWritesAllowed,
    paymentWriteBlockReason,
    ledgerFileExists,
    ledgerFileSizeBytes,
    ledgerFileModifiedTime,
    ledgerEntryCountTotal,
    ledgerEntryCountDaSilva,
    ageAnalysisFileExists: fs.existsSync(paths.ageAnalysisFile),
    paymentAllocationFileExists: fs.existsSync(paths.paymentAllocationFile),
    ...paths,
    ...disk,
  };
}

/** Fail process startup in production when billing JSON is on ephemeral container storage. */
export function assertBillingPersistentDiskForStartup(): void {
  const diag = collectBillingPersistenceDiagnostics();

  if (!shouldEnforceBillingPersistentDisk()) {
    console.log(
      `[billing-persistence] Guard skipped (productionRuntime=${isProductionRuntime()}, persistentDiskDetected=${diag.persistentDiskDetected})`
    );
    return;
  }

  if (diag.autoSeedPhase1BillingDisk.toLowerCase() === "true") {
    console.warn(
      `[billing-persistence] WARN: ${AUTO_SEED_PHASE1_BILLING_DISK_ENV}=true — remove from Render dashboard after disk seed; reseed on boot can wipe live payments.`
    );
  }

  if (diag.persistentDiskDetected) {
    console.log(
      `[billing-persistence] OK persistent billing disk detected (dataDir=${diag.dataDirResolvedPath}, ledgerEntries=${diag.ledgerEntryCountDaSilva}, size=${diag.ledgerFileSizeBytes})`
    );
    return;
  }

  console.error("[billing-persistence] FATAL: persistent billing disk NOT detected in production.");
  console.error(
    "[billing-persistence] Attach Render disk educlear-billing-data @ /opt/render/project/src/backend/data"
  );
  console.error(JSON.stringify(diag, null, 2));
  process.exit(1);
}

export function getPaymentWriteGuard(): { allowed: boolean; reason: string | null; diagnostics: BillingPersistenceDiagnostics } {
  const diagnostics = collectBillingPersistenceDiagnostics();
  return {
    allowed: diagnostics.paymentWritesAllowed,
    reason: diagnostics.paymentWriteBlockReason,
    diagnostics,
  };
}
