/**
 * Production apply: Kid-e-Sys top-up payments via official migration API.
 *
 *   CONFIRM_DA_SILVA_TOPUP_APPLY=true \
 *   SUPER_ADMIN_PASSWORD="..." \
 *   npx ts-node --transpile-only scripts/apply-da-silva-topup-production.ts
 */
import { config as loadDotenv } from "dotenv";
import fs from "fs";
import path from "path";

loadDotenv();

const SCHOOL_ID = "cmpideqeq0000108xb6ouv9zi";
const API_BASE = String(process.env.API_BASE || "https://educlear-backend.onrender.com").replace(
  /\/$/,
  ""
);
const KIDE_FILE = path.resolve(
  process.env.KIDE_TRANSACTION_LIST ||
    path.join(process.cwd(), "storage", "kideesys-payments-from-2026-06-01.xlsx")
);
const CONFIRM_ENV = "CONFIRM_DA_SILVA_TOPUP_APPLY";
const REF_MIN = 54255;
const REF_MAX = 54606;

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, init);
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    throw new Error(`${url} ${res.status}: ${String(text).slice(0, 500)}`);
  }
  return data;
}

async function login(): Promise<string> {
  const email = String(process.env.SUPER_ADMIN_EMAIL || "info@educlear.co.za").trim();
  const password = String(process.env.SUPER_ADMIN_PASSWORD || "").trim();
  if (!password) throw new Error("SUPER_ADMIN_PASSWORD required");
  const data = (await fetchJson(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  })) as { token?: string };
  const token = String(data.token || "").trim();
  if (!token) throw new Error("Login failed — no token");
  return token;
}

function paymentRefNum(reference: string): number | null {
  const m = String(reference || "").match(/Payment\s+(\d+)/i);
  return m ? Number(m[1]) : null;
}

async function previewOnProduction(token: string) {
  if (!fs.existsSync(KIDE_FILE)) throw new Error(`File not found: ${KIDE_FILE}`);
  const buffer = fs.readFileSync(KIDE_FILE);
  const form = new FormData();
  form.append("schoolId", SCHOOL_ID);
  form.append("file", new Blob([buffer]), path.basename(KIDE_FILE));

  return fetchJson(`${API_BASE}/api/migration/topup-payments/preview`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
}

async function applyOnProduction(token: string, sessionId: string) {
  return fetchJson(`${API_BASE}/api/migration/topup-payments/apply`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ schoolId: SCHOOL_ID, sessionId }),
  });
}

async function fetchVerification() {
  const paymentsData = (await fetchJson(
    `${API_BASE}/api/payments?schoolId=${encodeURIComponent(SCHOOL_ID)}`
  )) as { payments?: Array<{ source?: string; amount?: number; reference?: string; id?: string }> };
  const payments = paymentsData.payments || [];
  const kidesysTopup = payments.filter(
    (p) => String(p.source || "").toLowerCase() === "kidesys_topup"
  );
  const manualPayments = payments.filter(
    (p) => String(p.source || "").toLowerCase() !== "kidesys_topup"
  );
  const refsInRange = kidesysTopup.filter((p) => {
    const n = paymentRefNum(p.reference || "");
    return n !== null && n >= REF_MIN && n <= REF_MAX;
  });

  const accountsData = (await fetchJson(
    `${API_BASE}/api/statements/accounts?schoolId=${encodeURIComponent(SCHOOL_ID)}`
  )) as { accounts?: unknown[]; totalOutstandingBalance?: number };
  const accounts = accountsData.accounts || [];

  const ledgerData = (await fetchJson(
    `${API_BASE}/api/invoices/ledger?schoolId=${encodeURIComponent(SCHOOL_ID)}`
  )) as { entries?: unknown[] };

  return {
    kidesysTopupCount: kidesysTopup.length,
    kidesysTopupValue: Math.round(kidesysTopup.reduce((s, p) => s + Number(p.amount || 0), 0) * 100) / 100,
    manualPaymentCount: manualPayments.length,
    statementAccountsCount: accounts.length,
    totalOutstandingBalance: accountsData.totalOutstandingBalance ?? null,
    refs54255_54606Count: refsInRange.length,
    ledgerEntryCount: (ledgerData.entries || []).length,
  };
}

async function main() {
  if (String(process.env[CONFIRM_ENV] || "").trim().toLowerCase() !== "true") {
    console.error(`Refusing apply without ${CONFIRM_ENV}=true`);
    process.exit(1);
  }

  const token = await login();

  console.log("[1/3] Production preview (same file as approved dry-run)…");
  const preview = (await previewOnProduction(token)) as {
    sessionId?: string;
    canApply?: boolean;
    totals?: {
      totalRows?: number;
      newPayments?: number;
      duplicatesSkipped?: number;
      unmatchedRows?: number;
      totalPaymentAmount?: number;
    };
  };

  console.log(
    JSON.stringify(
      {
        preview: {
          sessionId: preview.sessionId,
          canApply: preview.canApply,
          totals: preview.totals,
        },
      },
      null,
      2
    )
  );

  if (!preview.canApply) throw new Error("Preview canApply=false — aborting");
  if (preview.totals?.newPayments !== 345) {
    throw new Error(`Expected 345 new payments, got ${preview.totals?.newPayments}`);
  }
  if ((preview.totals?.duplicatesSkipped || 0) !== 0 || (preview.totals?.unmatchedRows || 0) !== 0) {
    throw new Error("Preview has duplicates or unmatched rows — aborting");
  }

  const sessionId = String(preview.sessionId || "").trim();
  if (!sessionId) throw new Error("No sessionId from preview");

  console.log("\n[2/3] Applying on production…");
  const applyResult = (await applyOnProduction(token, sessionId)) as {
    success?: boolean;
    batchId?: string;
    rowsImported?: number;
    rowsSkipped?: number;
    totalAmount?: number;
    fileName?: string;
    uploadedAt?: string;
    ledgerEntryIds?: string[];
  };

  console.log(JSON.stringify({ applyResult }, null, 2));

  console.log("\n[3/3] Post-apply verification…");
  const verification = await fetchVerification();

  const report = {
    generatedAt: new Date().toISOString(),
    schoolId: SCHOOL_ID,
    sourceFile: path.basename(KIDE_FILE),
    localApprovedSession: "tp-1780660147734-3458ea27",
    productionSessionApplied: sessionId,
    applyResult,
    verification,
    reconciliation: {
      importedCount: applyResult.rowsImported,
      importedValue: applyResult.totalAmount,
      errors: [],
      kidesysTopupExpected: { count: 345, value: 1249925 },
      kidesysTopupActual: {
        count: verification.kidesysTopupCount,
        value: verification.kidesysTopupValue,
      },
      statementAccountsExpected: 344,
      statementAccountsActual: verification.statementAccountsCount,
      refs54255_54606Expected: "present in kidesys_topup band",
      refs54255_54606Count: verification.refs54255_54606Count,
      manualPaymentsPreserved: verification.manualPaymentCount,
      pass:
        verification.kidesysTopupCount === 345 &&
        verification.kidesysTopupValue === 1249925 &&
        verification.statementAccountsCount === 344 &&
        (applyResult.rowsImported || 0) === 345 &&
        (applyResult.rowsSkipped || 0) === 0,
    },
  };

  console.log(JSON.stringify({ finalReport: report }, null, 2));

  const outDir = path.join(process.cwd(), "storage", `topup-apply-report-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "apply-report.json"), JSON.stringify(report, null, 2));
  console.log(`\nReport saved: ${outDir}/apply-report.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
