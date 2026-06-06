/**
 * Seed Phase-1 accepted billing state onto backend/data (persistent disk path on Render).
 *
 * Uses ONLY:
 *   storage/emergency-restore-2026-06-06T08-55-30-773Z/payload.json
 *   storage/emergency-restore-2026-06-06T08-55-30-773Z/billing-ledger-production-backup.json
 *
 * Dry-run by default. Production / repo writes require explicit flags.
 *
 * Render shell (after persistent disk attached):
 *   cd backend
 *   CONFIRM_PHASE1_BILLING_DISK_SEED=true \
 *   npx tsx scripts/seed-phase1-billing-disk.ts --apply --target data
 *
 * Local repo data/ update (for git-bundled fallback — commit separately):
 *   npx tsx scripts/seed-phase1-billing-disk.ts --apply --target data --write-repo-data
 */
import fs from "fs";
import path from "path";

import type { FamilyAccountAgeAnalysisSnapshot } from "../src/utils/familyAccountAgeAnalysisStore";
import type { BillingLedgerEntry } from "../src/utils/billingLedgerStore";
import { EDUCLEAR_UNDO_CORRECTION_SOURCE } from "../src/utils/billingDisplayRules";

const SCHOOL_ID = "cmpideqeq0000108xb6ouv9zi";
const CONFIRM_ENV = "CONFIRM_PHASE1_BILLING_DISK_SEED";
const PHASE1_DIR = path.join(
  process.cwd(),
  "storage",
  "emergency-restore-2026-06-06T08-55-30-773Z"
);
const PAYLOAD_FILE = path.join(PHASE1_DIR, "payload.json");
const LEDGER_BACKUP_FILE = path.join(PHASE1_DIR, "billing-ledger-production-backup.json");
const PERSIST_TEST_FILE = path.join(PHASE1_DIR, "payment-persistence-test.json");
const EXCLUDED_ACCOUNTS = new Set(["JAC001", "LET007"]);

const AFR002_UNDO_PAYMENT_ID = "pay-d26e139c-b1cb-42e0-ba00-61a14e928ddb";
const AFR002_UNDO_CORRECTION_ID = "undo-corr-pay-d26e139c-b1cb-42e0-ba00-61a14e928ddb";

type PayloadFile = {
  schoolId: string;
  importedAt: string;
  snapshots: Array<{
    accountRef: string;
    accountHolder?: string;
    kidesysSection?: string;
    balance: number;
    buckets?: Partial<FamilyAccountAgeAnalysisSnapshot["buckets"]>;
  }>;
};

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function loadJson<T>(filePath: string): T {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required artifact: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function buildAgeAnalysisStore(payload: PayloadFile): Record<string, FamilyAccountAgeAnalysisSnapshot> {
  const schoolId = String(payload.schoolId || SCHOOL_ID).trim();
  const importedAt = String(payload.importedAt || "").trim();
  const store: Record<string, FamilyAccountAgeAnalysisSnapshot> = {};

  for (const row of payload.snapshots || []) {
    const accountRef = String(row.accountRef || "").trim().toUpperCase();
    if (!accountRef || EXCLUDED_ACCOUNTS.has(accountRef)) continue;
    const buckets = row.buckets || {};
    store[accountRef] = {
      schoolId,
      accountRef,
      accountHolder: String(row.accountHolder || "").trim() || accountRef,
      kidesysSection: String(row.kidesysSection || "").trim() || undefined,
      balance: roundMoney(Number(row.balance) || 0),
      buckets: {
        current: roundMoney(Number(buckets.current) || 0),
        d30: roundMoney(Number(buckets.d30) || 0),
        d60: roundMoney(Number(buckets.d60) || 0),
        d90: roundMoney(Number(buckets.d90) || 0),
        d120: roundMoney(Number(buckets.d120) || 0),
      },
      source: "kideesys-age-analysis",
      importedAt,
    };
  }

  return store;
}

function normalizeLedgerBackup(raw: { entries?: BillingLedgerEntry[] }): BillingLedgerEntry[] {
  const entries = Array.isArray(raw.entries) ? [...raw.entries] : [];
  return sanitizePhase1LedgerEntries(entries);
}

/** Remove accidental undo artifacts; restore AFR002 manual payment to active posting state. */
export function sanitizePhase1LedgerEntries(entries: BillingLedgerEntry[]): BillingLedgerEntry[] {
  const filtered = entries.filter((entry) => {
    const id = String(entry.id || "").trim();
    const source = String(entry.source || "").trim();
    if (source === EDUCLEAR_UNDO_CORRECTION_SOURCE) return false;
    if (id.startsWith("undo-corr-")) return false;
    if (id === AFR002_UNDO_CORRECTION_ID) return false;
    return true;
  });

  return filtered.map((entry) => {
    const id = String(entry.id || "").trim();
    if (id !== AFR002_UNDO_PAYMENT_ID) return entry;
    const { statementHidden, undoneAt, undoneByCorrectionId, ...rest } = entry;
    return {
      ...rest,
      statementHidden: undefined,
      undoneAt: undefined,
      undoneByCorrectionId: undefined,
    };
  });
}

function buildDik001PersistTestEntry(): BillingLedgerEntry | null {
  if (!fs.existsSync(PERSIST_TEST_FILE)) return null;
  const spec = loadJson<{
    testAccount?: string;
    paymentAmount?: number;
    idempotencyKey?: string;
  }>(PERSIST_TEST_FILE);
  const accountNo = String(spec.testAccount || "DIK001").trim().toUpperCase();
  const amount = roundMoney(Number(spec.paymentAmount) || 1);
  const idempotencyKey = String(spec.idempotencyKey || "").trim();
  if (!idempotencyKey) return null;

  const stableId = `pay-${idempotencyKey.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80)}`;
  return {
    id: stableId,
    schoolId: SCHOOL_ID,
    learnerId: "",
    accountNo,
    type: "payment",
    amount,
    date: "2026-06-06",
    reference: idempotencyKey,
    description: "Recovery persistence test R1",
    method: "EFT",
    source: "manual",
    createdAt: "2026-06-06T08:56:00.000Z",
  };
}

function writeJsonAtomic(filePath: string, data: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, filePath);
}

function resolveTargetDir(args: string[]): string {
  const targetIdx = args.indexOf("--target");
  if (targetIdx >= 0 && args[targetIdx + 1]) {
    return path.resolve(process.cwd(), args[targetIdx + 1]);
  }
  return path.join(process.cwd(), "data");
}

function validateSeedPlan(opts: {
  ageStore: Record<string, FamilyAccountAgeAnalysisSnapshot>;
  ledgerEntries: BillingLedgerEntry[];
  includeDik001PersistTest: boolean;
}) {
  const ageKeys = new Set(Object.keys(opts.ageStore));
  const excludedPresent = Array.from(EXCLUDED_ACCOUNTS).filter((a) => ageKeys.has(a));
  if (excludedPresent.length) {
    throw new Error(`Excluded accounts still present in age store: ${excludedPresent.join(", ")}`);
  }
  if (ageKeys.size !== 344) {
    throw new Error(`Expected 344 age snapshots, got ${ageKeys.size}`);
  }

  const undoCorrections = opts.ledgerEntries.filter(
    (e) =>
      String(e.source || "") === EDUCLEAR_UNDO_CORRECTION_SOURCE ||
      String(e.id || "").startsWith("undo-corr-")
  );
  if (undoCorrections.length) {
    throw new Error(`Ledger still contains ${undoCorrections.length} undo correction row(s)`);
  }

  const afrPayment = opts.ledgerEntries.find((e) => e.id === AFR002_UNDO_PAYMENT_ID);
  if (afrPayment?.undoneAt || afrPayment?.statementHidden) {
    throw new Error("AFR002 manual payment is still marked undone/hidden");
  }

  const mamRestore = opts.ledgerEntries.find((e) => e.id === "pay-mam004-restore-20260606-single");
  if (!mamRestore) {
    throw new Error("Missing Phase-1 MAM004 restore payment pay-mam004-restore-20260606-single");
  }

  if (opts.includeDik001PersistTest) {
    const dik = opts.ledgerEntries.filter(
      (e) => String(e.accountNo || "").toUpperCase() === "DIK001" && roundMoney(Number(e.amount)) === 1
    );
    if (dik.length !== 1) {
      throw new Error(`Expected exactly 1 DIK001 R1 payment, found ${dik.length}`);
    }
  }

  console.log(
    JSON.stringify(
      {
        ageSnapshotCount: ageKeys.size,
        ledgerEntryCount: opts.ledgerEntries.length,
        excludedAbsent: Array.from(EXCLUDED_ACCOUNTS),
        mam004RestorePresent: Boolean(mamRestore),
        afr002UndoReversed: Boolean(afrPayment && !afrPayment.undoneAt),
        dik001PersistTest: opts.includeDik001PersistTest,
      },
      null,
      2
    )
  );
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const writeRepoData = args.includes("--write-repo-data");
  const includeDik001PersistTest = !args.includes("--skip-dik001-persist-test");
  const targetDir = resolveTargetDir(args);

  const payload = loadJson<PayloadFile>(PAYLOAD_FILE);
  const ageStore = buildAgeAnalysisStore(payload);
  let ledgerEntries = normalizeLedgerBackup(loadJson(LEDGER_BACKUP_FILE));

  if (includeDik001PersistTest) {
    const dikEntry = buildDik001PersistTestEntry();
    if (dikEntry) {
      const exists = ledgerEntries.some((e) => e.id === dikEntry.id);
      if (!exists) ledgerEntries.push(dikEntry);
    }
  }

  validateSeedPlan({ ageStore, ledgerEntries, includeDik001PersistTest });

  const ageFile = { [SCHOOL_ID]: ageStore };
  const ledgerFile = { [SCHOOL_ID]: ledgerEntries };

  const plan = {
    phase1Dir: PHASE1_DIR,
    targetDir,
    ageFile: path.join(targetDir, "family-account-age-analysis.json"),
    ledgerFile: path.join(targetDir, "billing-ledger.json"),
    ageSnapshotCount: Object.keys(ageStore).length,
    ledgerEntryCount: ledgerEntries.length,
    includeDik001PersistTest,
    writeRepoData,
  };

  console.log("=== Phase-1 billing disk seed plan ===");
  console.log(JSON.stringify(plan, null, 2));

  if (!apply) {
    console.log(`Dry-run only. Re-run with --apply and ${CONFIRM_ENV}=true`);
    return;
  }

  if (String(process.env[CONFIRM_ENV] || "").trim().toLowerCase() !== "true") {
    throw new Error(`Refusing --apply without ${CONFIRM_ENV}=true`);
  }

  writeJsonAtomic(plan.ageFile, ageFile);
  writeJsonAtomic(plan.ledgerFile, ledgerFile);
  console.log(`Wrote ${plan.ageFile}`);
  console.log(`Wrote ${plan.ledgerFile}`);

  if (writeRepoData) {
    const repoDataDir = path.join(process.cwd(), "data");
    if (path.resolve(repoDataDir) !== path.resolve(targetDir)) {
      writeJsonAtomic(path.join(repoDataDir, "family-account-age-analysis.json"), ageFile);
      writeJsonAtomic(path.join(repoDataDir, "billing-ledger.json"), ledgerFile);
      console.log(`Also updated repo ${repoDataDir} (git-bundled fallback)`);
    }
  }

  console.log("Phase-1 billing disk seed complete.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
