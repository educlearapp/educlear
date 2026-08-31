/**
 * HTTP auth isolation for POST /api/invoice-runs/preview and /execute.
 * Does not execute a real invoice run (missing runId → 400 after auth).
 * Production schools are only used as spoofed client schoolId values that must 403.
 * Run: npx tsx src/routes/invoiceRuns.execute.route.test.ts
 */
import express from "express";
import http from "http";
import jwt from "jsonwebtoken";

import { DA_SILVA_ACADEMY_SCHOOL_ID } from "../services/activateDaSilvaSubscription";
import invoiceRunsRoutes from "./invoiceRuns";
import { prisma } from "../prisma";
import { getUserAccessMeta } from "../utils/userAccessStore";
import { appRoleFromPrismaRole } from "../utils/userPermissions";

const FLY_EAGLE_SCHOOL_ID = "cmt1e8bjp0jo8lcjeketlynhl";
const MBB_SCHOOL_ID = "cmq4xjckq00at60gqg4eb956h";
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function signToken(input: { userId: string; schoolId: string; email: string; role: string }) {
  return jwt.sign(input, JWT_SECRET, { expiresIn: "1h" });
}

async function startTestServer() {
  const app = express();
  app.use(express.json());
  app.use("/api/invoice-runs", invoiceRunsRoutes);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}/api/invoice-runs`,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

async function postJson(
  url: string,
  body: Record<string, unknown>,
  token?: string
): Promise<{ status: number; json: Record<string, unknown> }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

async function resolveDaSilvaFinanceUser() {
  const user = await prisma.user.findFirst({
    where: { schoolId: DA_SILVA_ACADEMY_SCHOOL_ID, isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, schoolId: true, email: true, role: true, isActive: true },
  });
  if (!user) throw new Error("No active Da Silva user found for invoice-run execute route test");
  const meta = await getUserAccessMeta(user.id);
  const appRole = String(meta?.appRole || appRoleFromPrismaRole(user.role));
  return { user, appRole };
}

async function runRouteTests() {
  const { baseUrl, close } = await startTestServer();

  try {
    const previewUrl = `${baseUrl}/preview`;
    const executeUrl = `${baseUrl}/execute`;

    const unauthPreview = await postJson(previewUrl, { schoolId: FLY_EAGLE_SCHOOL_ID });
    assert(unauthPreview.status === 401, `unauthenticated preview → 401 got ${unauthPreview.status}`);

    const unauthExecute = await postJson(executeUrl, { schoolId: DA_SILVA_ACADEMY_SCHOOL_ID, dryRun: true });
    assert(unauthExecute.status === 401, `unauthenticated execute → 401 got ${unauthExecute.status}`);

    const badUserToken = signToken({
      userId: "nonexistent-user-id",
      schoolId: DA_SILVA_ACADEMY_SCHOOL_ID,
      email: "missing@example.com",
      role: "SCHOOL_ADMIN",
    });
    const badPreview = await postJson(previewUrl, { schoolId: DA_SILVA_ACADEMY_SCHOOL_ID }, badUserToken);
    assert(badPreview.status === 401, `invalid user token preview → 401 got ${badPreview.status}`);

    const owner = await resolveDaSilvaFinanceUser();
    const ownerToken = signToken({
      userId: owner.user.id,
      schoolId: owner.user.schoolId,
      email: owner.user.email,
      role: owner.user.role,
    });

    const mbbToken = signToken({
      userId: owner.user.id,
      schoolId: MBB_SCHOOL_ID,
      email: owner.user.email,
      role: owner.user.role,
    });
    const jwtMismatch = await postJson(previewUrl, { schoolId: MBB_SCHOOL_ID }, mbbToken);
    assert(jwtMismatch.status === 403, `JWT school != user school → 403 got ${jwtMismatch.status}`);

    if (!["Owner", "Admin", "Finance"].includes(owner.appRole)) {
      console.log(`⚠ Da Silva test user role is ${owner.appRole}; skipping authorized isolation paths`);
      return;
    }

    const spoofFlyEaglePreview = await postJson(
      previewUrl,
      { schoolId: FLY_EAGLE_SCHOOL_ID, runId: "MUST-NOT-RUN" },
      ownerToken
    );
    assert(
      spoofFlyEaglePreview.status === 403,
      `Da Silva preview with Fly Eagle schoolId → 403 got ${spoofFlyEaglePreview.status}`
    );

    const spoofMbbExecute = await postJson(
      executeUrl,
      { schoolId: MBB_SCHOOL_ID, runId: "MUST-NOT-RUN", dryRun: true },
      ownerToken
    );
    assert(
      spoofMbbExecute.status === 403,
      `Da Silva execute with MBB schoolId → 403 got ${spoofMbbExecute.status}`
    );

    const authorizedMissingRun = await postJson(
      previewUrl,
      { schoolId: DA_SILVA_ACADEMY_SCHOOL_ID },
      ownerToken
    );
    assert(
      authorizedMissingRun.status === 400,
      `authorized preview missing runId → 400 got ${authorizedMissingRun.status}`
    );
    assert(authorizedMissingRun.json.errorCode === "INVALID_REQUEST", "authorized 400 is INVALID_REQUEST");
    assert(authorizedMissingRun.status !== 200, "authorized incomplete preview must not execute");

    console.log("✓ HTTP invoice run preview/execute tenant isolation passed");
  } finally {
    await close();
  }
}

async function main() {
  await runRouteTests();
  console.log("invoiceRuns.execute.route.test.ts: OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
