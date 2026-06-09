/**
 * Production: apply exact Payment Receive List PDF balances (no scaling).
 *
 *   CONFIRM_DA_SILVA_PAYMENT_RECEIVE_BASELINE=true \
 *   SUPER_ADMIN_PASSWORD="..." \
 *   PAYMENT_RECEIVE_PDF="/path/to/payment_receive_list.pdf" \
 *   npx ts-node --transpile-only scripts/apply-da-silva-payment-receive-baseline-production.ts --apply
 */
import { config as loadDotenv } from "dotenv";
import fs from "fs";
import path from "path";

import { PrismaClient } from "@prisma/client";
import { isKidESysSourceAccountRef } from "../src/services/daSilvaMigration/ageAnalysisParser";
import { parsePaymentReceiveListPdf } from "../src/services/daSilvaMigration/paymentReceiveListParser";
import {
  buildPaymentReceiveListSnapshots,
  buildPaymentReceiveVerificationTable,
  calculatePaymentReceiveCardTotals,
  DA_SILVA_AGE_BASELINE_IMPORTED_AT,
} from "../src/services/migrationCentre/paymentReceiveListExactBaseline";
import { roundStatementMoney } from "../src/services/statementAccounts";

loadDotenv();

const SCHOOL_ID = "cmpideqeq0000108xb6ouv9zi";
const CONFIRM_ENV = "CONFIRM_DA_SILVA_PAYMENT_RECEIVE_BASELINE";
const API_BASE = String(process.env.API_BASE || "https://educlear-backend.onrender.com").replace(
  /\/$/,
  ""
);
const DEFAULT_PDF = "/Users/dasilvaacademy/Desktop/payment_receive_list.pdf";
const SPOT = ["ALI002", "ADA004", "AFR002", "RAM021", "MAO002", "MDU001"];

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
    throw new Error(`${url} ${res.status}: ${String(text).slice(0, 400)}`);
  }
  return data;
}

async function loginSuperAdmin(): Promise<string> {
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

async function fetchLiveBalances(): Promise<Record<string, number>> {
  const data = (await fetchJson(
    `${API_BASE}/api/statements/accounts?schoolId=${encodeURIComponent(SCHOOL_ID)}`
  )) as { accounts?: Array<{ accountNo?: string; balance?: number }> };
  const out: Record<string, number> = {};
  for (const row of data.accounts || []) {
    const acct = String(row.accountNo || "").trim().toUpperCase();
    if (!acct) continue;
    out[acct] = Number(row.balance) || 0;
  }
  return out;
}

async function buildActiveAccountRefs(prisma: PrismaClient): Promise<Set<string>> {
  const learners = await prisma.learner.findMany({
    where: { schoolId: SCHOOL_ID, enrollmentStatus: "ACTIVE" },
    select: { familyAccount: { select: { accountRef: true } } },
  });
  const refs = new Set<string>();
  for (const l of learners) {
    const ref = String(l.familyAccount?.accountRef || "").trim().toUpperCase();
    if (ref && isKidESysSourceAccountRef(ref)) refs.add(ref);
  }
  return refs;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const pdfPath = path.resolve(process.env.PAYMENT_RECEIVE_PDF || DEFAULT_PDF);

  const dbUrl =
    String(process.env.PRODUCTION_DATABASE_URL || "").trim() ||
    String(process.env.DATABASE_URL || "").trim();
  if (!dbUrl) throw new Error("PRODUCTION_DATABASE_URL or DATABASE_URL required");
  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

  const activeRefs = await buildActiveAccountRefs(prisma);
  const { uniqueByAccount, audit } = await parsePaymentReceiveListPdf(pdfPath);

  const { snapshots, pdfBalanceByAccount, cardTotals } = await buildPaymentReceiveListSnapshots({
    schoolId: SCHOOL_ID,
    pdfPath,
    importedAt: DA_SILVA_AGE_BASELINE_IMPORTED_AT,
    activeAccountRefs: activeRefs,
  });

  const beforeLive = await fetchLiveBalances();
  const beforeMatch = buildPaymentReceiveVerificationTable({
    pdfBalanceByAccount,
    eduClearBalanceByAccount: beforeLive,
  });

  const payload = {
    schoolId: SCHOOL_ID,
    importedAt: DA_SILVA_AGE_BASELINE_IMPORTED_AT,
    snapshots: Object.values(snapshots).map((s) => ({
      accountRef: s.accountRef,
      accountHolder: s.accountHolder,
      kidesysSection: s.kidesysSection,
      balance: s.balance,
      buckets: s.buckets,
    })),
  };

  const outDir = path.join(process.cwd(), "storage", `payment-receive-apply-${Date.now()}`);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "payload.json"), JSON.stringify(payload, null, 2));

  const spotCheck = Object.fromEntries(
    SPOT.map((acct) => [
      acct,
      {
        pdfBalance: pdfBalanceByAccount[acct] ?? uniqueByAccount[acct]?.balance ?? null,
        eduClearBefore: beforeLive[acct] ?? null,
      },
    ])
  );

  const plan = {
    mode: apply ? "apply" : "plan",
    pdfPath,
    pdfAccountsTotal: audit.uniqueAccountCount,
    activePdfScope: Object.keys(pdfBalanceByAccount).length,
    activeLearnerAccountRefs: activeRefs.size,
    cardTotals,
    spotCheck,
    beforeLive: {
      matchingPdf: beforeMatch.matchingExactly.length,
      notMatchingPdf: beforeMatch.notMatching.length,
      notMatchingSample: beforeMatch.notMatching.slice(0, 20),
    },
    outDir,
  };

  console.log(JSON.stringify(plan, null, 2));

  if (!apply) {
    console.log(`\nPlan only. Re-run with --apply and ${CONFIRM_ENV}=true`);
    await prisma.$disconnect();
    return;
  }

  if (String(process.env[CONFIRM_ENV] || "").trim().toLowerCase() !== "true") {
    console.error(`Refusing --apply without ${CONFIRM_ENV}=true`);
    process.exit(1);
  }

  const token = await loginSuperAdmin();
  const result = await fetchJson(`${API_BASE}/api/migration/age-analysis-baseline/refresh`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const afterLive = await fetchLiveBalances();
  const afterMatch = buildPaymentReceiveVerificationTable({
    pdfBalanceByAccount,
    eduClearBalanceByAccount: afterLive,
  });

  const afterSpot = Object.fromEntries(
    SPOT.map((acct) => [
      acct,
      {
        pdfBalance: pdfBalanceByAccount[acct] ?? uniqueByAccount[acct]?.balance ?? null,
        eduClearAfter: afterLive[acct] ?? null,
        matches:
          Math.abs(
            roundStatementMoney(afterLive[acct] ?? 0) -
              roundStatementMoney(pdfBalanceByAccount[acct] ?? uniqueByAccount[acct]?.balance ?? 0)
          ) <= 0.01,
      },
    ])
  );

  const matchPct =
    Object.keys(pdfBalanceByAccount).length === 0
      ? 0
      : roundStatementMoney(
          (afterMatch.matchingExactly.length / Object.keys(pdfBalanceByAccount).length) * 100
        );

  const finalReport = {
    applyResult: result,
    accountsMatchingPdf: afterMatch.matchingExactly.length,
    accountsNotMatchingPdf: afterMatch.notMatching.length,
    matchPercent: matchPct,
    spotCheck: afterSpot,
    notMatching: afterMatch.notMatching,
    deployBlocked: afterMatch.notMatching.length > 0 || matchPct < 100,
  };

  fs.writeFileSync(path.join(outDir, "apply-result.json"), JSON.stringify(finalReport, null, 2));
  console.log(JSON.stringify(finalReport, null, 2));

  if (finalReport.deployBlocked) {
    process.exit(1);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
