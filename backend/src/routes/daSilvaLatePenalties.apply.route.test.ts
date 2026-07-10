/**
 * HTTP route integration tests for Da Silva late penalty apply (in-memory apply, no ledger file writes).
 * Run: npx ts-node --transpile-only src/routes/daSilvaLatePenalties.apply.route.test.ts
 */
import express from "express";
import http from "http";
import jwt from "jsonwebtoken";

import { DA_SILVA_ACADEMY_SCHOOL_ID } from "../services/activateDaSilvaSubscription";
import type { DaSilvaPenaltyApplyResult } from "../services/daSilvaLatePenaltyApplyService";
import { registerDaSilvaLatePenaltyRoutes } from "./daSilvaLatePenalties";
import { prisma } from "../prisma";
import { getUserAccessMeta } from "../utils/userAccessStore";
import { appRoleFromPrismaRole } from "../utils/userPermissions";

const MBB_SCHOOL_ID = "cmq4xjckq00at60gqg4eb956h";
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";
const PENALTY_MONTH = "2026-07";
const OTHER_MONTH = "2026-08";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function signToken(input: { userId: string; schoolId: string; email: string; role: string }) {
  return jwt.sign(input, JWT_SECRET, { expiresIn: "1h" });
}

async function startTestServer(
  applyImpl: (input: {
    schoolId: string;
    penaltyMonth: string;
    selectedAccountRefs: string[];
  }) => Promise<DaSilvaPenaltyApplyResult>
) {
  const app = express();
  app.use(express.json());
  const router = express.Router();
  registerDaSilvaLatePenaltyRoutes(router, {
    previewDaSilvaLatePenalties: async () =>
      ({
        schoolAllowed: true,
        previewOnly: true as const,
        applyBlocked: true as const,
        penaltyMonth: PENALTY_MONTH,
        rows: [],
        summary: {
          totalAccounts: 0,
          eligibleCount: 0,
          alreadyAppliedCount: 0,
          notEligibleCount: 0,
          totalPenaltyAmount: 0,
          statementsSummary: {
            accountsCount: 0,
            totalOutstanding: 0,
            recentlyOwing: 0,
            badDebt: 0,
            overPaid: 0,
          },
        },
      }) as Awaited<ReturnType<typeof import("../services/daSilvaLatePenaltyPreviewService").previewDaSilvaLatePenalties>>,
    applyDaSilvaLatePenalties: applyImpl,
  });
  app.use("/api/billing/da-silva-late-penalties", router);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}/api/billing/da-silva-late-penalties`,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

async function postApply(
  baseUrl: string,
  body: Record<string, unknown>,
  token?: string
): Promise<{ status: number; json: Record<string, unknown> }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}/apply`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

async function resolveDaSilvaOwner() {
  const user = await prisma.user.findFirst({
    where: {
      schoolId: DA_SILVA_ACADEMY_SCHOOL_ID,
      isActive: true,
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, schoolId: true, email: true, role: true, isActive: true },
  });
  if (!user) throw new Error("No active Da Silva user found for route integration test");
  const meta = await getUserAccessMeta(user.id);
  const appRole = String(meta?.appRole || appRoleFromPrismaRole(user.role));
  return { user, appRole };
}

async function runRouteTests() {
  let applyCalls = 0;
  const memoryKeys = new Set<string>();

  const { baseUrl, close } = await startTestServer(async ({ schoolId, penaltyMonth, selectedAccountRefs }) => {
    applyCalls += 1;
    const rows = selectedAccountRefs.map((accountRef) => {
      const idempotencyKey = `penalty-${schoolId}-${accountRef}-${penaltyMonth}`;
      if (memoryKeys.has(idempotencyKey)) {
        return { accountRef, status: "skipped" as const, reason: "already_applied", idempotencyKey };
      }
      memoryKeys.add(idempotencyKey);
      return {
        accountRef,
        status: "posted" as const,
        reason: "posted",
        penaltyAmount: 720,
        idempotencyKey,
        ledgerEntryId: idempotencyKey,
      };
    });
    const posted = rows.filter((r) => r.status === "posted");
    return {
      success: true,
      schoolAllowed: true,
      penaltyMonth,
      postedCount: posted.length,
      skippedCount: rows.length - posted.length,
      errorCount: 0,
      totalPostedAmount: posted.length * 720,
      rows,
    };
  });

  try {
    const body = {
      schoolId: DA_SILVA_ACADEMY_SCHOOL_ID,
      penaltyMonth: PENALTY_MONTH,
      selectedAccountRefs: ["TST001"],
    };

    const unauth = await postApply(baseUrl, body);
    assert(unauth.status === 401, `unauthenticated expected 401 got ${unauth.status}`);

    const owner = await resolveDaSilvaOwner();
    const ownerToken = signToken({
      userId: owner.user.id,
      schoolId: owner.user.schoolId,
      email: owner.user.email,
      role: owner.user.role,
    });

    if (!["Owner", "Admin", "Finance"].includes(owner.appRole)) {
      console.log(`⚠ Da Silva test user role is ${owner.appRole}; skipping success path`);
    } else {
      const ok = await postApply(baseUrl, body, ownerToken);
      assert(ok.status === 200, `owner apply expected 200 got ${ok.status}`);
      assert(Number(ok.json.postedCount) === 1, "owner apply posted 1");
      assert(applyCalls === 1, "apply called once");
    }

    // Teacher/Viewer role → 403 covered in requireDaSilvaLatePenaltyApply.test.ts (pure auth).
    const badUserToken = signToken({
      userId: "nonexistent-user-id",
      schoolId: DA_SILVA_ACADEMY_SCHOOL_ID,
      email: "missing@example.com",
      role: "SCHOOL_ADMIN",
    });
    const badUser = await postApply(baseUrl, body, badUserToken);
    assert(badUser.status === 401, `invalid user token → 401 got ${badUser.status}`);

    const mbbToken = signToken({
      userId: owner.user.id,
      schoolId: MBB_SCHOOL_ID,
      email: owner.user.email,
      role: owner.user.role,
    });
    const mbbReq = await postApply(
      baseUrl,
      { ...body, schoolId: MBB_SCHOOL_ID },
      mbbToken
    );
    assert(mbbReq.status === 403, `MBB token mismatch user school → 403 got ${mbbReq.status}`);

    const spoof = await postApply(
      baseUrl,
      { ...body, schoolId: MBB_SCHOOL_ID },
      ownerToken
    );
    assert(spoof.status === 403, `Da Silva user spoofing MBB schoolId → 403 got ${spoof.status}`);

    if (["Owner", "Admin", "Finance"].includes(owner.appRole)) {
      const dup = await postApply(baseUrl, body, ownerToken);
      assert(dup.status === 200, "duplicate apply HTTP 200");
      assert(Number(dup.json.skippedCount) === 1, "duplicate skipped");
      assert(Number(dup.json.postedCount) === 0, "duplicate posted 0");

      const otherMonth = await postApply(
        baseUrl,
        { ...body, penaltyMonth: OTHER_MONTH },
        ownerToken
      );
      assert(otherMonth.status === 200, "different month allowed");
      assert(Number(otherMonth.json.postedCount) === 1, "different month posted 1");
    }

    console.log("✓ HTTP route integration checks passed");
  } finally {
    await close();
  }
}

async function run() {
  await runRouteTests();
  console.log("\ndaSilvaLatePenalties.apply.route.test.ts: all passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
