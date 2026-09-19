import fs from "fs";
import path from "path";

import { assertFlyEagleSchoolId, FLY_EAGLE_SCHOOL_ID } from "./constants";
import { computeCountChecksums, computeMoneyTotals } from "./checksums";
import type { FlyEagleSchoolBundle, ReconciliationReport } from "./types";
import { buildReconciliationReport } from "./reconcile";

export type SnapshotArtifacts = {
  dir: string;
  bundlePath: string;
  checksumsPath: string;
  reconciliationPath: string;
  checksums: ReturnType<typeof computeCountChecksums>;
  money: ReturnType<typeof computeMoneyTotals>;
  report: ReconciliationReport;
};

/**
 * Write Fly Eagle-only pre-repair snapshot (no secrets).
 */
export function writeFlyEagleSnapshot(
  bundle: FlyEagleSchoolBundle,
  outDir: string
): SnapshotArtifacts {
  assertFlyEagleSchoolId(bundle.schoolId);
  if (bundle.schoolId !== FLY_EAGLE_SCHOOL_ID) {
    throw new Error("Refuse snapshot for non-Fly-Eagle school");
  }

  fs.mkdirSync(outDir, { recursive: true });
  const stamp = bundle.capturedAt.replace(/[:.]/g, "-");
  const dir = path.join(outDir, `fly-eagle-pre-repair-${stamp}`);
  fs.mkdirSync(dir, { recursive: true });

  const checksums = computeCountChecksums(bundle);
  const money = computeMoneyTotals(bundle);
  const report = buildReconciliationReport(bundle);

  const bundlePath = path.join(dir, "bundle.json");
  const checksumsPath = path.join(dir, "checksums.json");
  const reconciliationPath = path.join(dir, "reconciliation.json");

  // Strip any accidental secret-looking fields (none expected on these models)
  const safeBundle = {
    ...bundle,
    note: "Fly Eagle Primary pre-repair snapshot — no passwords/tokens included",
  };

  fs.writeFileSync(bundlePath, JSON.stringify(safeBundle, null, 2), "utf8");
  fs.writeFileSync(
    checksumsPath,
    JSON.stringify({ schoolId: bundle.schoolId, capturedAt: bundle.capturedAt, checksums, money }, null, 2),
    "utf8"
  );
  fs.writeFileSync(reconciliationPath, JSON.stringify(report, null, 2), "utf8");

  return { dir, bundlePath, checksumsPath, reconciliationPath, checksums, money, report };
}
