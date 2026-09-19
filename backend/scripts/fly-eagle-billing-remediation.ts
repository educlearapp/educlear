/**
 * Fly Eagle billing remediation CLI.
 *
 * Snapshot + reconcile + dry-run (default):
 *   PRODUCTION_DATABASE_URL="postgresql://..." \
 *     npx tsx scripts/fly-eagle-billing-remediation.ts --snapshot --dry-run
 *
 * Fixture dry-run (no DB):
 *   npx tsx scripts/fly-eagle-billing-remediation.ts --fixture --dry-run
 *
 * Production apply (Class A only) — requires dual confirm:
 *   CONFIRM_FLY_EAGLE_BILLING_REPAIR=true CONFIRM_PRODUCTION_WRITE=true \
 *   PRODUCTION_DATABASE_URL="postgresql://..." \
 *     npx tsx scripts/fly-eagle-billing-remediation.ts --apply
 *
 * Hard-scoped to Fly Eagle Primary only.
 */
import "dotenv/config";

import fs from "fs";
import os from "os";
import path from "path";

import { PrismaClient } from "@prisma/client";

import {
  CONFIRM_FLY_EAGLE_REPAIR_ENV,
  CONFIRM_PRODUCTION_WRITE_ENV,
  FLY_EAGLE_SCHOOL_ID,
  assertFlyEagleSchoolId,
} from "../src/services/flyEagleBillingRemediation/constants";
import { loadFlyEagleSchoolBundle } from "../src/services/flyEagleBillingRemediation/loadBundle";
import { buildReconciliationReport } from "../src/services/flyEagleBillingRemediation/reconcile";
import { executeRepairPlan } from "../src/services/flyEagleBillingRemediation/repair";
import { writeFlyEagleSnapshot } from "../src/services/flyEagleBillingRemediation/snapshot";
import { buildBillingIntegrityReport } from "../src/services/flyEagleBillingRemediation/integrityReport";
import { buildCarenQuestions } from "../src/services/flyEagleBillingRemediation/carenQuestions";
import { buildClassBConsolidationManifests } from "../src/services/flyEagleBillingRemediation/ledgerConsolidate";
import { buildSyntheticFlyEagleBundle } from "../src/services/flyEagleBillingRemediation/fixtures/syntheticFlyEagleBundle";
import type { FlyEagleSchoolBundle, RemediationLedgerEntry, RemediationSnapshot } from "../src/services/flyEagleBillingRemediation/types";
import { readSchoolLedger } from "../src/utils/billingLedgerStore";
import { readSchoolFamilyAccountAgeAnalysisSnapshots } from "../src/utils/familyAccountAgeAnalysisStore";

const BACKEND_SERVICE_ID = "srv-d6j8jvma2pns7397bghg";

const USE_FIXTURE = process.argv.includes("--fixture");
const DO_SNAPSHOT = process.argv.includes("--snapshot") || !process.argv.includes("--apply");
const DO_APPLY = process.argv.includes("--apply");
const DO_DRY = !DO_APPLY || process.argv.includes("--dry-run");
const allowLocal = process.argv.includes("--allow-local-target");

function resolveDbHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "unknown";
  }
}

function isLocalHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === "localhost" || h === "127.0.0.1";
}

function readRenderApiKey(): string {
  const fromEnv = String(process.env.RENDER_API_KEY || "").trim();
  if (fromEnv) return fromEnv;
  const cliPath = path.join(os.homedir(), ".render", "cli.yaml");
  if (!fs.existsSync(cliPath)) return "";
  const raw = fs.readFileSync(cliPath, "utf8");
  const match = raw.match(/^\s*key:\s*(\S+)\s*$/m);
  return match ? match[1].trim() : "";
}

async function fetchRenderEnvVar(serviceId: string, key: string): Promise<string> {
  const apiKey = readRenderApiKey();
  if (!apiKey) return "";
  const res = await fetch(`https://api.render.com/v1/services/${serviceId}/env-vars`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) return "";
  const rows = (await res.json()) as Array<{ envVar?: { key?: string; value?: string }; key?: string; value?: string }>;
  for (const row of rows) {
    const env = row.envVar || row;
    if (env.key === key) return String(env.value || "").trim();
  }
  return "";
}

async function resolveDatabaseUrl(): Promise<string> {
  const prod = String(process.env.PRODUCTION_DATABASE_URL || process.env.TARGET_DATABASE_URL || "").trim();
  if (prod && (allowLocal || !isLocalHost(resolveDbHost(prod)))) return prod;

  const fromRender = await fetchRenderEnvVar(BACKEND_SERVICE_ID, "DATABASE_URL");
  if (fromRender && (allowLocal || !isLocalHost(resolveDbHost(fromRender)))) return fromRender;

  const local = String(process.env.DATABASE_URL || "").trim();
  if (allowLocal && local) return local;

  throw new Error(
    [
      "Production database URL is required for a live Fly Eagle snapshot.",
      "Set PRODUCTION_DATABASE_URL, or configure RENDER_API_KEY / ~/.render/cli.yaml,",
      "or pass --fixture for synthetic dry-run, or --allow-local-target with DATABASE_URL.",
    ].join(" ")
  );
}

function loadLedgerAndSnapshots(schoolId: string): {
  ledger: RemediationLedgerEntry[];
  ageAnalysisByRef: Record<string, RemediationSnapshot | undefined>;
} {
  assertFlyEagleSchoolId(schoolId);
  const ledgerRaw = readSchoolLedger(schoolId);
  const ledger: RemediationLedgerEntry[] = ledgerRaw.map((e) => ({
    id: (e as { id?: string }).id,
    type: e.type,
    accountNo: e.accountNo,
    schoolId: e.schoolId,
    learnerId: e.learnerId,
    amount: e.amount,
    date: e.date,
    familyAccountId: (e as { familyAccountId?: string }).familyAccountId,
    reference: e.reference,
    description: e.description,
  }));

  const snaps = readSchoolFamilyAccountAgeAnalysisSnapshots(schoolId) || {};
  const ageAnalysisByRef: Record<string, RemediationSnapshot | undefined> = {};
  for (const [ref, snap] of Object.entries(snaps)) {
    if (!snap) continue;
    ageAnalysisByRef[String(ref).trim().toUpperCase()] = {
      accountRef: snap.accountRef,
      accountHolder: snap.accountHolder,
      balance: snap.balance,
      source: snap.source,
      importedAt: snap.importedAt,
    };
  }
  return { ledger, ageAnalysisByRef };
}

function loadAudit(schoolId: string): FlyEagleSchoolBundle["audit"] {
  const auditPath = path.join(process.cwd(), "data", "family-account-audit.json");
  if (!fs.existsSync(auditPath)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(auditPath, "utf8"));
    const rows = Array.isArray(raw)
      ? raw
      : Array.isArray(raw?.[schoolId])
        ? raw[schoolId]
        : Array.isArray(raw?.entries)
          ? raw.entries
          : [];
    return rows
      .filter((e: { schoolId?: string }) => !e.schoolId || e.schoolId === schoolId)
      .map((e: Record<string, unknown>) => ({
        action: String(e.action || ""),
        sourceAccountRef: String(e.sourceAccountRef || e.source || ""),
        targetAccountRef: String(e.targetAccountRef || e.target || ""),
        createdAt: String(e.createdAt || ""),
      }));
  } catch {
    return [];
  }
}

function printSummary(report: ReturnType<typeof buildReconciliationReport>, label: string) {
  console.log(`\n=== ${label} ===`);
  console.log(
    JSON.stringify(
      {
        schoolId: report.schoolId,
        capturedAt: report.capturedAt,
        checksums: report.checksums,
        money: report.money,
        repairPlanCounts: {
          classA: report.repairPlan.classA.length,
          classAMutating: report.repairPlan.classA.filter((i) => i.action !== "none").length,
          classB: report.repairPlan.classB.length,
          classC: report.repairPlan.classC.length,
        },
        notes: report.notes,
      },
      null,
      2
    )
  );
}

async function main() {
  assertFlyEagleSchoolId(FLY_EAGLE_SCHOOL_ID);

  const outRoot = path.join(process.cwd(), "storage", "fly-eagle-remediation");
  fs.mkdirSync(outRoot, { recursive: true });

  let bundle: FlyEagleSchoolBundle;
  let prisma: PrismaClient | null = null;

  if (USE_FIXTURE) {
    console.log("[fly-eagle-remediation] Using synthetic fixture bundle (--fixture)");
    bundle = buildSyntheticFlyEagleBundle();
  } else {
    const dbUrl = await resolveDatabaseUrl();
    const host = resolveDbHost(dbUrl);
    console.log(`[fly-eagle-remediation] DB host=${host} schoolId=${FLY_EAGLE_SCHOOL_ID}`);
    process.env.DATABASE_URL = dbUrl;
    prisma = new PrismaClient();
    const { ledger, ageAnalysisByRef } = loadLedgerAndSnapshots(FLY_EAGLE_SCHOOL_ID);
    if (!ledger.length) {
      console.warn(
        "[fly-eagle-remediation] WARN: local billing-ledger.json has 0 Fly Eagle rows. " +
          "Checksums for invoices/payments will be incomplete until production ledger is available on this host."
      );
    }
    bundle = await loadFlyEagleSchoolBundle({
      prisma,
      schoolId: FLY_EAGLE_SCHOOL_ID,
      ledger,
      ageAnalysisByRef,
      audit: loadAudit(FLY_EAGLE_SCHOOL_ID),
    });
  }

  const report = buildReconciliationReport(bundle);
  printSummary(report, "CANONICAL RECONCILIATION");

  let snapshotDir: string | null = null;
  if (DO_SNAPSHOT) {
    const artifacts = writeFlyEagleSnapshot(bundle, outRoot);
    snapshotDir = artifacts.dir;
    console.log(`[fly-eagle-remediation] Snapshot written → ${artifacts.dir}`);
  }

  const integrity = buildBillingIntegrityReport(bundle);
  const integrityPath = path.join(snapshotDir || outRoot, "integrity-report.json");
  fs.writeFileSync(integrityPath, JSON.stringify(integrity, null, 2), "utf8");
  const caren = buildCarenQuestions(report.repairPlan.classC, report.zeroLinkedFas);
  const carenPath = path.join(snapshotDir || outRoot, "needs-caren.json");
  fs.writeFileSync(carenPath, JSON.stringify(caren, null, 2), "utf8");

  const classBManifests = buildClassBConsolidationManifests(bundle, report.repairPlan.classB);
  const classBPath = path.join(snapshotDir || outRoot, "class-b-consolidation-manifests.json");
  fs.writeFileSync(classBPath, JSON.stringify(classBManifests, null, 2), "utf8");
  const classBUnsafe = classBManifests.filter((m) => !m.safe);

  console.log(
    `\n=== INTEGRITY ===\n` +
      JSON.stringify(
        {
          blockingCount: integrity.blockingCount,
          warningCount: integrity.warningCount,
          countsByCode: integrity.countsByCode,
          integrityPath,
          needsCarenCount: caren.length,
          carenPath,
          classBManifestCount: classBManifests.length,
          classBAllSafe: classBUnsafe.length === 0,
          classBPath,
          sampleFindings: integrity.findings.slice(0, 12),
        },
        null,
        2
      )
  );

  const mode = DO_APPLY && !process.argv.includes("--dry-run") ? "apply" : "dry-run";
  if (mode === "apply" && !prisma) {
    throw new Error("Refuse --apply against fixture-only run");
  }

  if (mode === "apply") {
    console.log(
      `[fly-eagle-remediation] APPLY gates: ${CONFIRM_FLY_EAGLE_REPAIR_ENV}=${process.env[CONFIRM_FLY_EAGLE_REPAIR_ENV]} ${CONFIRM_PRODUCTION_WRITE_ENV}=${process.env[CONFIRM_PRODUCTION_WRITE_ENV]}`
    );
  }

  const repairResult = await executeRepairPlan({
    prisma,
    report,
    mode,
  });

  const repairPath = path.join(
    snapshotDir || outRoot,
    mode === "apply" ? "repair-applied.json" : "repair-dry-run.json"
  );
  fs.writeFileSync(repairPath, JSON.stringify(repairResult, null, 2), "utf8");

  console.log(`\n=== REPAIR ${mode.toUpperCase()} ===`);
  console.log(
    JSON.stringify(
      {
        mode: repairResult.mode,
        monetaryReconciled: repairResult.monetaryReconciled,
        aborted: repairResult.aborted,
        abortReason: repairResult.abortReason,
        wouldChange: repairResult.cases.filter((c) => c.status === "would_change").length,
        applied: repairResult.cases.filter((c) => c.status === "applied").length,
        skipped: repairResult.cases.filter((c) => c.status === "skipped").length,
        unchanged: repairResult.cases.filter((c) => c.status === "unchanged").length,
        repairPath,
        classAMutatingSample: repairResult.cases
          .filter((c) => c.repairClass === "A" && c.status !== "unchanged")
          .slice(0, 15),
        classCSample: repairResult.cases.filter((c) => c.repairClass === "C").slice(0, 10),
      },
      null,
      2
    )
  );

  if (!repairResult.monetaryReconciled) {
    throw new Error("Refuse to continue: monetary totals did not reconcile");
  }

  if (prisma) await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("[fly-eagle-remediation] FAILED:", err);
  process.exit(1);
});
