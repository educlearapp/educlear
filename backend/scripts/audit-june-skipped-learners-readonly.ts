/**
 * READ-ONLY June invoice gap audit.
 * Identifies ACTIVE learners with billable server plans missing a June-period invoice.
 * Does NOT create invoices or modify any data.
 *
 * Usage:
 *   npx tsx scripts/audit-june-skipped-learners-readonly.ts
 *   SCHOOL_ID=cmpideqeq0000108xb6ouv9zi API_BASE=https://educlear-backend.onrender.com npx tsx scripts/audit-june-skipped-learners-readonly.ts
 */
import "dotenv/config";
import fs from "fs";
import path from "path";

import { prisma } from "../src/prisma";
import { activeLearnerWhere } from "../src/utils/learnerEnrollment";
import {
  readExplicitlyEmptyBillingPlanLearnerIds,
  readSchoolBillingPlansResolved,
} from "../src/services/learnerBillingPlanDbStore";
import {
  buildBillingPlanLookupIndexes,
  resolveLearnerBillingPlanItems,
} from "../src/utils/learnerBillingPlanStore";
import {
  learnerHasInvoiceForPeriod,
  listInvoices,
  normalizeInvoicePeriod,
} from "../src/utils/billingLedgerStore";
import {
  resolveBillingGroupKeyForRun,
  sumBillingPlanAmount,
} from "../src/services/invoiceRunExecuteService";

const SCHOOL_ID = String(
  process.env.SCHOOL_ID || "cmpideqeq0000108xb6ouv9zi"
).trim();
const JUNE_PERIOD = normalizeInvoicePeriod("June 2026", "2026-06-01");
const API_BASE = String(process.env.API_BASE || "").replace(/\/$/, "");

type AuditLearner = {
  learnerId: string;
  learnerName: string;
  accountRef: string;
  planAmount: number;
  invoicedForJune: boolean;
  billingGroupKey: string;
};

type SiblingGap = {
  billingGroupKey: string;
  accountRef: string;
  activeLearners: number;
  billableLearners: number;
  invoicedLearners: number;
  missedLearnerIds: string[];
  partialInvoicing: boolean;
};

async function fetchLedgerFromApi(schoolId: string) {
  if (!API_BASE) return null;
  const res = await fetch(`${API_BASE}/api/invoices/ledger?schoolId=${encodeURIComponent(schoolId)}`);
  if (!res.ok) return null;
  const body = await res.json();
  return Array.isArray(body?.entries) ? body.entries : null;
}

async function main() {
  console.log(`[audit-june] READ-ONLY schoolId=${SCHOOL_ID} period=${JUNE_PERIOD}`);

  const learners = await prisma.learner.findMany({
    where: activeLearnerWhere(SCHOOL_ID),
    select: {
      id: true,
      firstName: true,
      lastName: true,
      admissionNo: true,
      idNumber: true,
      familyAccountId: true,
      familyAccount: { select: { accountRef: true } },
    },
  });

  const plansByLearnerId = await readSchoolBillingPlansResolved(SCHOOL_ID);
  const explicitlyEmpty = await readExplicitlyEmptyBillingPlanLearnerIds(SCHOOL_ID);
  const planIndexes = buildBillingPlanLookupIndexes(plansByLearnerId, learners);

  const apiLedger = await fetchLedgerFromApi(SCHOOL_ID);
  const localInvoices = listInvoices(SCHOOL_ID);
  const invoiceEntries = apiLedger
    ? apiLedger.filter((entry: any) => entry.type === "invoice")
    : localInvoices;

  const audited: AuditLearner[] = [];
  const missed: AuditLearner[] = [];

  for (const learner of learners) {
    const planItems = resolveLearnerBillingPlanItems(
      learner,
      plansByLearnerId,
      planIndexes,
      explicitlyEmpty
    );
    const planAmount = sumBillingPlanAmount(planItems);
    if (planAmount <= 0) continue;

    const accountRef = String(learner.familyAccount?.accountRef || "").trim().toUpperCase();
    const invoicedForJune = learnerHasInvoiceForPeriod(
      invoiceEntries,
      learner.id,
      JUNE_PERIOD
    );

    const row: AuditLearner = {
      learnerId: learner.id,
      learnerName: `${learner.firstName} ${learner.lastName}`.trim(),
      accountRef,
      planAmount,
      invoicedForJune,
      billingGroupKey: resolveBillingGroupKeyForRun(learner),
    };
    audited.push(row);
    if (!invoicedForJune) missed.push(row);
  }

  const groups = new Map<string, AuditLearner[]>();
  for (const row of audited) {
    const key = row.billingGroupKey;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  const siblingGaps: SiblingGap[] = [];
  for (const [billingGroupKey, rows] of groups) {
    if (rows.length < 2) continue;
    const invoiced = rows.filter((row) => row.invoicedForJune);
    const missedRows = rows.filter((row) => !row.invoicedForJune);
    if (!missedRows.length) continue;

    siblingGaps.push({
      billingGroupKey,
      accountRef: rows[0]?.accountRef || "",
      activeLearners: rows.length,
      billableLearners: rows.length,
      invoicedLearners: invoiced.length,
      missedLearnerIds: missedRows.map((row) => row.learnerId),
      partialInvoicing: invoiced.length > 0 && missedRows.length > 0,
    });
  }

  const report = {
    mode: "read-only",
    schoolId: SCHOOL_ID,
    invoicePeriod: JUNE_PERIOD,
    generatedAt: new Date().toISOString(),
    billableActiveLearners: audited.length,
    invoicedForJune: audited.filter((row) => row.invoicedForJune).length,
    missedForJune: missed.length,
    siblingPartialAccounts: siblingGaps.filter((gap) => gap.partialInvoicing).length,
    missedLearners: missed,
    siblingGaps,
    ledgerSource: apiLedger ? "api" : "local-file",
  };

  const storageDir = path.join(process.cwd(), "storage");
  if (!fs.existsSync(storageDir)) fs.mkdirSync(storageDir, { recursive: true });
  const outPath = path.join(storageDir, "june-invoice-run-gap-audit.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");

  console.log(`[audit-june] billable=${report.billableActiveLearners} invoiced=${report.invoicedForJune} missed=${report.missedForJune}`);
  console.log(`[audit-june] sibling partial accounts=${report.siblingPartialAccounts}`);
  console.log(`[audit-june] report=${outPath}`);
  console.log("audit-june-skipped-learners-readonly.ts: OK");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
