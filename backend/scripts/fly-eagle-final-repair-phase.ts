/**
 * Fly Eagle final data-repair phase — LED (idempotent) + MAP (idempotent) + HIR003→HIR002.
 *
 * Dry-run:
 *   npx tsx scripts/fly-eagle-final-repair-phase.ts --dry-run
 *
 * Apply (production gates required):
 *   CONFIRM_FLY_EAGLE_BILLING_REPAIR=true CONFIRM_PRODUCTION_WRITE=true \
 *     npx tsx scripts/fly-eagle-final-repair-phase.ts --apply
 *
 * Hard-scoped to Fly Eagle Primary only. Does not touch SOT.
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";

import {
  CONFIRM_FLY_EAGLE_REPAIR_ENV,
  CONFIRM_PRODUCTION_WRITE_ENV,
  FLY_EAGLE_SCHOOL_ID,
  assertFlyEagleSchoolId,
} from "../src/services/flyEagleBillingRemediation/constants";
import { APPROVED_LEDIKWA, APPROVED_MAPUTLA } from "../src/services/flyEagleBillingRemediation/approvedClassBManifests";
import { APPROVED_HIRBORO } from "../src/services/flyEagleBillingRemediation/approvedHirConsolidation";
import { executeApprovedClassBConsolidation } from "../src/services/flyEagleBillingRemediation/classBApply";
import { executeApprovedHirConsolidation } from "../src/services/flyEagleBillingRemediation/hirConsolidateApply";
import { readSchoolLedger } from "../src/utils/billingLedgerStore";
import type { RepairPlanItem } from "../src/services/flyEagleBillingRemediation/types";

const DO_APPLY = process.argv.includes("--apply");
const mode = DO_APPLY ? "apply" : "dry-run";

function planItem(spec: {
  orphanFaId: string;
  orphanAccountRef: string;
  currentFaId: string;
  learnerIds: string[];
  label: string;
}): RepairPlanItem {
  return {
    caseKey: `final:${spec.label}:${spec.orphanFaId}`,
    repairClass: "B",
    orphanFaId: spec.orphanFaId,
    orphanAccountRef: spec.orphanAccountRef,
    orphanAccountNo: null,
    action: "ledger_consolidate_then_merge",
    learnerIds: spec.learnerIds,
    currentFaIds: [spec.currentFaId],
    evidence: [],
    reasons: [],
    preconditions: [],
    monetary: { orphanBalance: 0, orphanInvoiceTotal: 0, orphanPaymentTotal: 0 },
  };
}

function schoolWideTotals(schoolId: string) {
  const ledger = readSchoolLedger(schoolId);
  let invoiceCount = 0,
    paymentCount = 0,
    creditCount = 0,
    invoiceTotal = 0,
    paymentTotal = 0,
    creditTotal = 0;
  for (const e of ledger) {
    if (e.schoolId && e.schoolId !== schoolId) continue;
    const amt = Math.round((Number(e.amount) || 0) * 100) / 100;
    if (e.type === "invoice") {
      invoiceCount++;
      invoiceTotal += amt;
    } else if (e.type === "payment") {
      paymentCount++;
      paymentTotal += amt;
    } else if (e.type === "credit") {
      creditCount++;
      creditTotal += amt;
    }
  }
  return {
    invoiceCount,
    paymentCount,
    creditCount,
    invoiceTotal: Math.round(invoiceTotal * 100) / 100,
    paymentTotal: Math.round(paymentTotal * 100) / 100,
    creditTotal: Math.round(creditTotal * 100) / 100,
  };
}

async function main() {
  assertFlyEagleSchoolId(FLY_EAGLE_SCHOOL_ID);

  if (mode === "apply") {
    if (process.env[CONFIRM_FLY_EAGLE_REPAIR_ENV] !== "true") {
      throw new Error(`Refuse apply: ${CONFIRM_FLY_EAGLE_REPAIR_ENV} must be true`);
    }
    if (process.env[CONFIRM_PRODUCTION_WRITE_ENV] !== "true") {
      throw new Error(`Refuse apply: ${CONFIRM_PRODUCTION_WRITE_ENV} must be true`);
    }
  }

  const prisma = new PrismaClient();
  const outDir = path.join(
    process.cwd(),
    "storage",
    "fly-eagle-remediation",
    `final-repair-${mode}-${new Date().toISOString().replace(/[:.]/g, "-")}`
  );
  fs.mkdirSync(outDir, { recursive: true });

  const beforeTotals = schoolWideTotals(FLY_EAGLE_SCHOOL_ID);

  const led = await executeApprovedClassBConsolidation({
    prisma,
    schoolId: FLY_EAGLE_SCHOOL_ID,
    item: planItem({ ...APPROVED_LEDIKWA, label: "LEDIKWA" }),
    spec: APPROVED_LEDIKWA,
    mode,
  });
  const map = await executeApprovedClassBConsolidation({
    prisma,
    schoolId: FLY_EAGLE_SCHOOL_ID,
    item: planItem({ ...APPROVED_MAPUTLA, label: "MAPUTLA" }),
    spec: APPROVED_MAPUTLA,
    mode,
  });
  const hir = await executeApprovedHirConsolidation({
    prisma,
    schoolId: FLY_EAGLE_SCHOOL_ID,
    spec: APPROVED_HIRBORO,
    mode,
  });

  const afterTotals = schoolWideTotals(FLY_EAGLE_SCHOOL_ID);
  const monetaryReconciled = JSON.stringify(beforeTotals) === JSON.stringify(afterTotals);

  const report = {
    mode,
    schoolId: FLY_EAGLE_SCHOOL_ID,
    gitCommit: process.env.RENDER_GIT_COMMIT || null,
    beforeTotals,
    afterTotals,
    monetaryReconciled,
    cases: { LEDIKWA: led, MAPUTLA: map, HIRBORO: hir },
    aborted: [led, map, hir].some((c) => c.status === "aborted"),
  };

  fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`\nWrote ${outDir}`);

  if (!monetaryReconciled) {
    throw new Error("School-wide monetary totals changed — refuse");
  }
  if (report.aborted) {
    throw new Error("One or more cases aborted — refuse");
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("[fly-eagle-final-repair] FAILED:", err);
  process.exit(1);
});
