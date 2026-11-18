/**
 * Phase 1E edge cases: duplicates, unmatched accounts, empty Type.
 * ALLOW_DISPOSABLE_MIGRATION_E2E=true npx tsx \
 *   src/services/migration/orchestrator/harness/disposablePhase1eEdgeCasesE2E.ts
 */
import assert from "assert";
import fs from "fs";
import path from "path";
import { prisma } from "../../../../prisma";
import {
  setBillingLedgerStoreDataDirForTests,
  readSchoolLedger,
} from "../../../../utils/billingLedgerStore";
import { setFamilyAccountAgeAnalysisStoreDataDirForTests } from "../../../../utils/familyAccountAgeAnalysisStore";
import { saveMigrationSession } from "../../core/migrationSessionStore";
import { prepareMigrationFromSession } from "../prepareMigrationFromSession";
import { completeUniversalMigration } from "../completeUniversalMigration";
import { listFinanceReconciliationsForStage } from "../../finance/migrationFinanceReconciliationStore";
import type { MigrationFile } from "../../types/MigrationFile";

const CUTOVER = "2026-06-05";
const FIXTURE_DIR = path.resolve(
  process.cwd(),
  "../docs/verification/universal-migration-phase1e/fixtures"
);

function writeCsv(filePath: string, rows: Record<string, string>[]): void {
  const cols = Object.keys(rows[0] || {});
  const lines = [cols.join(",")];
  for (const r of rows) {
    lines.push(cols.map((c) => `"${String(r[c] ?? "").replace(/"/g, '""')}"`).join(","));
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, lines.join("\n"), "utf8");
}

function loadFixtureRows(name: string): Record<string, string>[] {
  const raw = fs.readFileSync(path.join(FIXTURE_DIR, name), "utf8").trim();
  const lines = raw.split(/\r?\n/);
  const headers = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = cells[i] ?? "";
    });
    return row;
  });
}

function asUploaded(
  id: string,
  filename: string,
  filePath: string,
  category: MigrationFile["category"]
): MigrationFile {
  return {
    id,
    filename,
    path: filePath,
    size: fs.statSync(filePath).size,
    mimeType: "text/csv",
    category,
    uploadedAt: new Date(),
  };
}

async function main(): Promise<void> {
  if (process.env.ALLOW_DISPOSABLE_MIGRATION_E2E !== "true") {
    throw new Error("Set ALLOW_DISPOSABLE_MIGRATION_E2E=true");
  }
  const stamp = Date.now();
  const tmpRoot = path.join(process.cwd(), "uploads", "migration-e2e-phase1e-edge", String(stamp));
  const ledgerDir = path.join(tmpRoot, "ledger");
  fs.mkdirSync(ledgerDir, { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, "age"), { recursive: true });
  setBillingLedgerStoreDataDirForTests(ledgerDir);
  setFamilyAccountAgeAnalysisStoreDataDirForTests(path.join(tmpRoot, "age"));

  const school = await prisma.school.create({
    data: {
      name: `Phase1E Edge ${stamp}`,
      email: `phase1e-edge-${stamp}@educlear.test`,
      isDemoTenant: true,
    } as any,
  });

  const uploadDir = path.join(
    process.cwd(),
    "uploads",
    "migration-staging",
    school.id,
    "phase1e-edge",
    "uploads"
  );
  fs.mkdirSync(uploadDir, { recursive: true });

  const basePay = loadFixtureRows("payments.csv");
  const edgePay = loadFixtureRows("payments-edge.csv");
  writeCsv(path.join(uploadDir, "learners.csv"), loadFixtureRows("learners.csv"));
  writeCsv(path.join(uploadDir, "accounts.csv"), loadFixtureRows("accounts.csv"));
  writeCsv(path.join(uploadDir, "payments.csv"), [...basePay, ...edgePay]);

  saveMigrationSession(school.id, {
    uploadedFiles: [
      asUploaded("e_l", "learners.csv", path.join(uploadDir, "learners.csv"), "learners"),
      asUploaded("e_a", "accounts.csv", path.join(uploadDir, "accounts.csv"), "billing"),
      asUploaded("e_p", "payments.csv", path.join(uploadDir, "payments.csv"), "transactions"),
    ],
    cutoverDate: CUTOVER,
    dryRunStage: null,
    sourceSystem: "generic-excel-csv",
  } as any);

  const prepared = await prepareMigrationFromSession({
    targetSchoolId: school.id,
    cutoverDate: CUTOVER,
    sourceSystem: "generic-excel-csv",
  });

  let run: any = null;
  let readiness: any = null;
  try {
    ({ run, readiness } = await completeUniversalMigration({
      stageId: prepared.stageId,
      targetSchoolId: school.id,
      confirmation: true,
    }));
  } catch (e: any) {
    run = e.run;
    readiness = e.readiness;
    console.log("complete threw:", e.message, "status=", run?.status);
  }

  const recon = listFinanceReconciliationsForStage(prepared.stageId)[0];
  const ledger = readSchoolLedger(school.id) || [];
  const pays = ledger.filter(
    (e) =>
      e.type === "payment" ||
      (e.type === "credit" && !String(e.reference || "").includes("OPENING"))
  );
  const refs = pays.map((e) => String(e.reference || ""));

  console.log(
    JSON.stringify(
      {
        runStatus: run?.status,
        terminalKind: run?.terminalKind,
        differenceCents: recon?.differenceCents ?? null,
        canAccept: recon?.canAccept ?? null,
        paymentRefs: refs,
        dupCount: refs.filter((r) => r.includes("PAY-DUP")).length,
        orphanPosted: refs.some((r) => r.includes("PAY-ORPHAN")),
        noTypePosted: refs.some((r) => r.includes("PAY-NOTYPE")),
        histPosted: refs.some((r) => r.includes("HIST-01")),
        validPosted: ["PAY-A", "PAY-B", "CR-01", "PAY-OK", "PAY-EX"].map((r) => ({
          r,
          ok: refs.some((x) => x.includes(r)),
        })),
      },
      null,
      2
    )
  );

  assert.ok(!refs.some((r) => r.includes("PAY-ORPHAN")), "orphan must not post");
  assert.ok(!refs.some((r) => r.includes("PAY-NOTYPE")), "empty type must not post");
  assert.ok(refs.filter((r) => r.includes("PAY-DUP")).length <= 1, "duplicate at most once");
  assert.ok(!refs.some((r) => r.includes("HIST-01")), "pre-cutover not posted");

  // Edge rows that cannot post must either leave recon blocked OR be excluded from source totals
  // with clear reporting — never silently allocate to the wrong account.
  if (run?.status === "COMPLETE_ACCEPTED") {
    assert.strictEqual(recon.differenceCents, 0, "accepted implies R0.00");
    for (const r of ["PAY-A", "PAY-B", "PAY-OK", "PAY-EX"]) {
      assert.ok(refs.some((x) => x.includes(r)), `missing ${r}`);
    }
  } else {
    assert.ok(
      recon == null ||
        recon.canAccept === false ||
        recon.differenceCents !== 0 ||
        run?.status === "FAILED" ||
        run?.status === "COMPLETE_SUPPLIED_DATA",
      "edge failures must not falsely accept"
    );
  }

  console.log("Phase 1E edge cases E2E: PASS");
}

main().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});
