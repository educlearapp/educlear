import { Router } from "express";
import fs from "fs";
import path from "path";
import { timingSafeEqual } from "crypto";

import { prisma } from "../prisma";

const router = Router();

const DA_SILVA_SCHOOL_ID = "cmpideqeq0000108xb6ouv9zi";
const EXPORT_TOKEN_HEADER = "x-da-silva-finance-export-token";

function readJsonBucket<T>(fileName: string): T | null {
  const filePath = path.join(process.cwd(), "data", fileName);
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw) as Record<string, T | undefined>;
  return parsed[DA_SILVA_SCHOOL_ID] ?? null;
}

function tokenMatches(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return (
    providedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(providedBuffer, expectedBuffer)
  );
}

router.get("/da-silva-finance-export-readonly", async (req, res) => {
  console.log("[ops] Da Silva finance export endpoint accessed", {
    at: new Date().toISOString(),
    ip: req.ip,
    hasToken: Boolean(req.header(EXPORT_TOKEN_HEADER)),
  });

  const expectedToken = String(process.env.DA_SILVA_FINANCE_EXPORT_TOKEN || "").trim();
  const providedToken = String(req.header(EXPORT_TOKEN_HEADER) || "").trim();

  if (!expectedToken || !providedToken || !tokenMatches(providedToken, expectedToken)) {
    return res.status(403).json({ success: false, error: "Forbidden" });
  }

  try {
    const [
      learnerBillingPlanLines,
      learnerBillingPlanCleared,
      feeStructures,
    ] = await Promise.all([
      prisma.learnerBillingPlanLine.findMany({
        where: { schoolId: DA_SILVA_SCHOOL_ID },
        orderBy: [{ learnerId: "asc" }, { sortOrder: "asc" }],
      }),
      prisma.learnerBillingPlanCleared.findMany({
        where: { schoolId: DA_SILVA_SCHOOL_ID },
        orderBy: [{ learnerId: "asc" }],
      }),
      prisma.feeStructure.findMany({
        where: { schoolId: DA_SILVA_SCHOOL_ID },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
    ]);

    return res.json({
      success: true,
      readOnly: true,
      schoolId: DA_SILVA_SCHOOL_ID,
      generatedAt: new Date().toISOString(),
      sources: {
        familyAccountAgeAnalysis: {
          file: "family-account-age-analysis.json",
          bucket: readJsonBucket("family-account-age-analysis.json"),
        },
        billingLedger: {
          file: "billing-ledger.json",
          bucket: readJsonBucket("billing-ledger.json"),
        },
        learnerBillingPlans: {
          jsonFile: "learner-billing-plans.json",
          jsonBucket: readJsonBucket("learner-billing-plans.json"),
          dbTables: {
            learnerBillingPlanLine: learnerBillingPlanLines,
            learnerBillingPlanCleared,
          },
        },
        feeStructure: {
          table: "FeeStructure",
          rows: feeStructures,
        },
      },
    });
  } catch (error) {
    console.error("[ops] Da Silva finance export failed", error);
    return res.status(500).json({ success: false, error: "Export failed" });
  }
});

export default router;
