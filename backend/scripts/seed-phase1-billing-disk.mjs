/**
 * Phase-1 billing disk seed (plain Node — no tsx required on Render).
 * See seed-phase1-billing-disk.ts for typed dev variant.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, "..");

const SCHOOL_ID = "cmpideqeq0000108xb6ouv9zi";
const CONFIRM_ENV = "CONFIRM_PHASE1_BILLING_DISK_SEED";
const EDUCLEAR_UNDO_CORRECTION_SOURCE = "educlear_undo_correction";
const PHASE1_DIR = path.join(
  BACKEND_ROOT,
  "storage",
  "emergency-restore-2026-06-06T08-55-30-773Z"
);
const PAYLOAD_FILE = path.join(PHASE1_DIR, "payload.json");
const LEDGER_BACKUP_FILE = path.join(PHASE1_DIR, "billing-ledger-production-backup.json");
const PERSIST_TEST_FILE = path.join(PHASE1_DIR, "payment-persistence-test.json");
const EXCLUDED_ACCOUNTS = new Set(["JAC001", "LET007"]);
const AFR002_UNDO_PAYMENT_ID = "pay-d26e139c-b1cb-42e0-ba00-61a14e928ddb";
const AFR002_UNDO_CORRECTION_ID = "undo-corr-pay-d26e139c-b1cb-42e0-ba00-61a14e928ddb";

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

function loadJson(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Missing required artifact: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function buildAgeAnalysisStore(payload) {
  const schoolId = String(payload.schoolId || SCHOOL_ID).trim();
  const importedAt = String(payload.importedAt || "").trim();
  const store = {};
  for (const row of payload.snapshots || []) {
    const accountRef = String(row.accountRef || "").trim().toUpperCase();
    if (!accountRef || EXCLUDED_ACCOUNTS.has(accountRef)) continue;
    const buckets = row.buckets || {};
    store[accountRef] = {
      schoolId,
      accountRef,
      accountHolder: String(row.accountHolder || "").trim() || accountRef,
      kidesysSection: String(row.kidesysSection || "").trim() || undefined,
      balance: roundMoney(row.balance),
      buckets: {
        current: roundMoney(buckets.current),
        d30: roundMoney(buckets.d30),
        d60: roundMoney(buckets.d60),
        d90: roundMoney(buckets.d90),
        d120: roundMoney(buckets.d120),
      },
      source: "kideesys-age-analysis",
      importedAt,
    };
  }
  return store;
}

export function sanitizePhase1LedgerEntries(entries) {
  const filtered = entries.filter((entry) => {
    const id = String(entry.id || "").trim();
    const source = String(entry.source || "").trim();
    if (source === EDUCLEAR_UNDO_CORRECTION_SOURCE) return false;
    if (id.startsWith("undo-corr-")) return false;
    if (id === AFR002_UNDO_CORRECTION_ID) return false;
    return true;
  });
  return filtered.map((entry) => {
    if (String(entry.id || "").trim() !== AFR002_UNDO_PAYMENT_ID) return entry;
    const next = { ...entry };
    delete next.statementHidden;
    delete next.undoneAt;
    delete next.undoneByCorrectionId;
    return next;
  });
}

function buildDik001PersistTestEntry() {
  if (!fs.existsSync(PERSIST_TEST_FILE)) return null;
  const spec = loadJson(PERSIST_TEST_FILE);
  const idempotencyKey = String(spec.idempotencyKey || "").trim();
  if (!idempotencyKey) return null;
  const stableId = `pay-${idempotencyKey.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80)}`;
  return {
    id: stableId,
    schoolId: SCHOOL_ID,
    learnerId: "",
    accountNo: String(spec.testAccount || "DIK001").trim().toUpperCase(),
    type: "payment",
    amount: roundMoney(spec.paymentAmount || 1),
    date: "2026-06-06",
    reference: idempotencyKey,
    description: "Recovery persistence test R1",
    method: "EFT",
    source: "manual",
    createdAt: "2026-06-06T08:56:00.000Z",
  };
}

function writeJsonAtomic(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, filePath);
}

function resolveTargetDir(args) {
  const targetIdx = args.indexOf("--target");
  if (targetIdx >= 0 && args[targetIdx + 1]) {
    return path.resolve(BACKEND_ROOT, args[targetIdx + 1]);
  }
  return path.join(BACKEND_ROOT, "data");
}

function validateSeedPlan({ ageStore, ledgerEntries, includeDik001PersistTest }) {
  const ageKeys = new Set(Object.keys(ageStore));
  const excludedPresent = [...EXCLUDED_ACCOUNTS].filter((a) => ageKeys.has(a));
  if (excludedPresent.length) {
    throw new Error(`Excluded accounts still present: ${excludedPresent.join(", ")}`);
  }
  if (ageKeys.size !== 344) throw new Error(`Expected 344 age snapshots, got ${ageKeys.size}`);
  const undoCorrections = ledgerEntries.filter(
    (e) =>
      String(e.source || "") === EDUCLEAR_UNDO_CORRECTION_SOURCE ||
      String(e.id || "").startsWith("undo-corr-")
  );
  if (undoCorrections.length) {
    throw new Error(`Ledger still contains ${undoCorrections.length} undo correction row(s)`);
  }
  const afrPayment = ledgerEntries.find((e) => e.id === AFR002_UNDO_PAYMENT_ID);
  if (afrPayment?.undoneAt || afrPayment?.statementHidden) {
    throw new Error("AFR002 manual payment is still marked undone/hidden");
  }
  if (!ledgerEntries.find((e) => e.id === "pay-mam004-restore-20260606-single")) {
    throw new Error("Missing MAM004 restore payment pay-mam004-restore-20260606-single");
  }
  if (includeDik001PersistTest) {
    const dik = ledgerEntries.filter(
      (e) => String(e.accountNo || "").toUpperCase() === "DIK001" && roundMoney(e.amount) === 1
    );
    if (dik.length !== 1) throw new Error(`Expected 1 DIK001 R1 payment, found ${dik.length}`);
  }
  console.log(
    JSON.stringify(
      {
        ageSnapshotCount: ageKeys.size,
        ledgerEntryCount: ledgerEntries.length,
        mam004RestorePresent: true,
        afr002UndoReversed: Boolean(afrPayment && !afrPayment.undoneAt),
        dik001PersistTest: includeDik001PersistTest,
      },
      null,
      2
    )
  );
}

function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const includeDik001PersistTest = !args.includes("--skip-dik001-persist-test");
  const targetDir = resolveTargetDir(args);

  const payload = loadJson(PAYLOAD_FILE);
  const ageStore = buildAgeAnalysisStore(payload);
  const backupRaw = loadJson(LEDGER_BACKUP_FILE);
  let ledgerEntries = sanitizePhase1LedgerEntries(
    Array.isArray(backupRaw.entries) ? [...backupRaw.entries] : []
  );

  if (includeDik001PersistTest) {
    const dikEntry = buildDik001PersistTestEntry();
    if (dikEntry && !ledgerEntries.some((e) => e.id === dikEntry.id)) {
      ledgerEntries.push(dikEntry);
    }
  }

  validateSeedPlan({ ageStore, ledgerEntries, includeDik001PersistTest });

  const ageFile = { [SCHOOL_ID]: ageStore };
  const ledgerFile = { [SCHOOL_ID]: ledgerEntries };
  const plan = {
    targetDir,
    ageSnapshotCount: Object.keys(ageStore).length,
    ledgerEntryCount: ledgerEntries.length,
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

  writeJsonAtomic(path.join(targetDir, "family-account-age-analysis.json"), ageFile);
  writeJsonAtomic(path.join(targetDir, "billing-ledger.json"), ledgerFile);
  console.log("Phase-1 billing disk seed complete.");
}

main();
