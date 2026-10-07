/**
 * GET /api/payments/attempts/:key auth + Capture Payment request observability (real HTTP, no DB writes).
 * Run: npx tsx src/routes/payments.attemptsObservability.test.ts
 */
import http from "http";
import type { AddressInfo } from "net";
import express from "express";

import paymentsRouter from "./payments";
import { evaluateCapturePaymentAuth } from "../middleware/requireCapturePaymentAuth";
import { permissionsForRole } from "../utils/userPermissions";
import {
  observePaymentCaptureRequest,
  setPaymentCaptureLoggerForTests,
  type PaymentCaptureLogEvent,
} from "../utils/paymentCaptureObservability";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

type Logged = { event: PaymentCaptureLogEvent; fields: Record<string, unknown> };

const logs: Logged[] = [];
setPaymentCaptureLoggerForTests((event, fields) => {
  logs.push({ event, fields });
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function listen(app: express.Express): Promise<{ base: string; close: () => Promise<void> }> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

async function waitFor(predicate: () => boolean, label: string, timeoutMs = 2000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error(`timeout waiting for ${label}`);
    await sleep(10);
  }
}

async function testAttemptsRouteRequiresAuth() {
  const app = express();
  app.use(express.json());
  app.use("/api/payments", paymentsRouter);
  const srv = await listen(app);
  try {
    const anon = await fetch(`${srv.base}/api/payments/attempts/3f1c9a52-7e0b`);
    assert(anon.status === 401, `unauthenticated attempts lookup → 401 (got ${anon.status})`);
    const forged = await fetch(`${srv.base}/api/payments/attempts/3f1c9a52-7e0b`, {
      headers: { Authorization: "Bearer not-a-real-token" },
    });
    assert(forged.status === 401, `invalid token attempts lookup → 401 (got ${forged.status})`);
    const spoofed = await fetch(
      `${srv.base}/api/payments/attempts/3f1c9a52-7e0b?schoolId=cmt1e8bjp0jo8lcjeketlynhl`
    );
    assert(spoofed.status === 401, "client schoolId alone never authorizes a lookup");
    const body = await anon.json().catch(() => ({}));
    assert(!("found" in (body as object)), "no status leaked without auth");
  } finally {
    await srv.close();
  }
  console.log("✓ GET /api/payments/attempts/:key requires authenticated staff (401)");
}

function testAttemptsPermissionMatrix() {
  const FLY_EAGLE = "cmt1e8bjp0jo8lcjeketlynhl";
  const DA_SILVA = "cmpideqeq0000108xb6ouv9zi";
  const decide = (appRole: string, requestSchoolId?: string) =>
    evaluateCapturePaymentAuth({
      jwtPayload: { userId: "u-1", schoolId: FLY_EAGLE, email: "staff@example.com", role: appRole.toUpperCase() },
      user: { id: "u-1", schoolId: FLY_EAGLE, role: appRole.toUpperCase(), isActive: true },
      appRole,
      permissions: permissionsForRole(appRole as never),
      requestSchoolId,
      requireAction: "view",
    });
  const finance = decide("Finance");
  assert(finance.allowed && finance.authorizedSchoolId === FLY_EAGLE, "Finance may read attempt status");
  const admin = decide("Admin");
  assert(admin.allowed, "Admin (payments.view) may read attempt status");
  for (const role of ["Viewer", "Teacher"]) {
    const denied = decide(role);
    assert(!denied.allowed && denied.status === 403, `${role} without payments.view rejected (403)`);
  }
  const spoof = decide("Finance", DA_SILVA);
  assert(!spoof.allowed && spoof.status === 403, "client schoolId cannot switch school");
  console.log("✓ attempt status permission: Finance/Admin allowed, Viewer/Teacher 403, school spoof 403");
}

async function testPostObservabilityOnUnauthenticated() {
  logs.length = 0;
  const app = express();
  app.use(express.json());
  app.use("/api/payments", paymentsRouter);
  const srv = await listen(app);
  try {
    const res = await fetch(`${srv.base}/api/payments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-request-id": "req-abc-123" },
      body: JSON.stringify({
        amount: 1400,
        accountNo: "LENTSWE OMAATLA OTENG",
        idempotencyKey: "3f1c9a52-7e0b-4f7e-9d4b-2a6c1e5b8f00",
        bankReference: "BANK-REF-SECRET",
      }),
    });
    assert(res.status === 401, "unauthenticated POST rejected");
    assert(res.headers.get("x-request-id") === "req-abc-123", "safe inbound request id echoed");
    await waitFor(() => logs.some((l) => l.event === "payment_capture_finish"), "finish log");
    const finish = logs.find((l) => l.event === "payment_capture_finish")!;
    assert(finish.fields.requestId === "req-abc-123", "finish log carries request id");
    assert(finish.fields.status === 401, "finish log carries status");
    assert(typeof finish.fields.durationMs === "number", "finish log carries duration");
    await sleep(50);
    assert(
      !logs.some((l) => l.event === "payment_capture_client_closed"),
      "no false client-closed warning after a completed response"
    );
    assert(!logs.some((l) => l.event === "payment_capture_start"), "start only logged after auth");
    const serialized = JSON.stringify(logs);
    for (const secret of ["1400", "LENTSWE", "BANK-REF-SECRET", "3f1c9a52-7e0b-4f7e-9d4b-2a6c1e5b8f00"]) {
      assert(!serialized.includes(secret), `logs must not include ${secret}`);
    }
  } finally {
    await srv.close();
  }
  console.log("✓ POST /api/payments: request id + finish log, no PII, no false close warning");
}

async function testUnsafeRequestIdReplaced() {
  logs.length = 0;
  const app = express();
  app.post("/x", observePaymentCaptureRequest, (_req, res) => {
    res.json({ ok: true });
  });
  const srv = await listen(app);
  try {
    const res = await fetch(`${srv.base}/x`, {
      method: "POST",
      headers: { "x-request-id": "<script>alert(1)</script>" },
    });
    const id = res.headers.get("x-request-id") || "";
    assert(/^[0-9a-f-]{36}$/.test(id), "unsafe inbound id replaced with generated uuid");
  } finally {
    await srv.close();
  }
  console.log("✓ unsafe inbound request id is not reflected");
}

async function testClientAbortLogsClose() {
  logs.length = 0;
  const app = express();
  app.post("/slow", observePaymentCaptureRequest, async (_req, res) => {
    await sleep(400);
    if (!res.writableEnded && !res.destroyed) res.json({ ok: true });
  });
  const srv = await listen(app);
  try {
    const controller = new AbortController();
    const pending = fetch(`${srv.base}/slow`, {
      method: "POST",
      headers: { "x-request-id": "req-abort-1" },
      signal: controller.signal,
    }).catch((error) => error);
    await sleep(60);
    controller.abort();
    await pending;
    await waitFor(
      () => logs.some((l) => l.event === "payment_capture_client_closed"),
      "client closed log"
    );
    const closed = logs.find((l) => l.event === "payment_capture_client_closed")!;
    assert(closed.fields.requestId === "req-abort-1", "close log carries request id");
    assert(closed.fields.headersSent === false, "close log reports response never sent");
    await sleep(500);
    assert(
      logs.filter((l) => l.event === "payment_capture_client_closed").length === 1,
      "close logged once"
    );
  } finally {
    await srv.close();
  }
  console.log("✓ client disconnect before response logs payment_capture_client_closed once");
}

async function main() {
  await testAttemptsRouteRequiresAuth();
  testAttemptsPermissionMatrix();
  await testPostObservabilityOnUnauthenticated();
  await testUnsafeRequestIdReplaced();
  await testClientAbortLogsClose();
  setPaymentCaptureLoggerForTests(null);
  console.log("\nAll payments.attemptsObservability tests passed.");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
