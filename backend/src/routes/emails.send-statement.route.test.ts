/**
 * Email send-statement route tests for Resend network resilience.
 * Run: npx ts-node --transpile-only src/routes/emails.send-statement.route.test.ts
 *
 * Uses pdfBase64 path (no ledger PDF generation) and a mocked global fetch.
 */
import assert from "assert";
import express from "express";
import http from "http";
import { prisma } from "../prisma";
import emailsRoutes from "./emails";
import { RESEND_NETWORK_UNAVAILABLE_MESSAGE } from "../services/resendClient";
import { EDUCLEAR_RELAY_FROM_EMAIL, EDUCLEAR_RELAY_FROM_NAME } from "../communication/schoolSender";

const MIN_PDF_BASE64 = Buffer.from(
  "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n" + "x".repeat(80)
).toString("base64");

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/emails", emailsRoutes);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return {
    base: `http://127.0.0.1:${port}/api/emails`,
    close: () =>
      new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}

async function postJson(base: string, body: unknown) {
  const res = await fetch(`${base}/send-statement`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

function networkError(code: string) {
  return Object.assign(new TypeError("fetch failed"), {
    cause: Object.assign(new Error(code), { code }),
  });
}

async function main() {
  const prevKey = process.env.RESEND_API_KEY;
  const prevFrom = process.env.EDUCLEAR_MAIL_FROM_EMAIL;
  process.env.RESEND_API_KEY = "re_test_key_for_route";
  process.env.EDUCLEAR_MAIL_FROM_EMAIL = "onboarding@resend.dev";

  const suffix = Date.now();
  const school = await prisma.school.create({
    data: {
      name: `Resend Route School ${suffix}`,
      email: `route-school-${suffix}@educlear.test`,
    },
  });

  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  let lastBody: Record<string, unknown> | null = null;
  let mode: "ok" | "timeout-then-ok" | "always-timeout" | "http400" | "http401" = "ok";

  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input);
    if (!url.includes("api.resend.com")) {
      return originalFetch(input, init);
    }
    fetchCalls += 1;
    lastBody = JSON.parse(String(init?.body || "{}"));
    if (mode === "ok") {
      return new Response(JSON.stringify({ id: "msg_route_ok" }), { status: 200 });
    }
    if (mode === "timeout-then-ok") {
      if (fetchCalls === 1) throw networkError("ETIMEDOUT");
      return new Response(JSON.stringify({ id: "msg_route_retry" }), { status: 200 });
    }
    if (mode === "always-timeout") {
      throw networkError("ETIMEDOUT");
    }
    if (mode === "http400") {
      return new Response(JSON.stringify({ message: "Invalid recipient" }), { status: 400 });
    }
    if (mode === "http401") {
      return new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 });
    }
    throw new Error(`unexpected mode ${mode}`);
  }) as typeof fetch;

  const server = await startServer();
  try {
    // 1) success — From / Reply-To correct; stale env ignored
    mode = "ok";
    fetchCalls = 0;
    {
      const { status, json } = await postJson(server.base, {
        schoolId: school.id,
        to: "parent@example.com",
        subject: "Your statement",
        html: "<p>Please see attached.</p>",
        pdfBase64: MIN_PDF_BASE64,
        filename: "statement.pdf",
      });
      assert.strictEqual(status, 200, JSON.stringify(json));
      assert.strictEqual(json.messageId, "msg_route_ok");
      assert.strictEqual(fetchCalls, 1);
      assert.ok(lastBody);
      assert.strictEqual(
        lastBody!.from,
        `"${EDUCLEAR_RELAY_FROM_NAME}" <${EDUCLEAR_RELAY_FROM_EMAIL}>`
      );
      assert.strictEqual(lastBody!.reply_to, school.email);
      assert.ok(!String(lastBody!.from).includes("onboarding@resend.dev"));
    }

    // 2) timeout then success
    mode = "timeout-then-ok";
    fetchCalls = 0;
    {
      const { status, json } = await postJson(server.base, {
        schoolId: school.id,
        to: "parent@example.com",
        subject: "Your statement",
        html: "<p>Please see attached.</p>",
        pdfBase64: MIN_PDF_BASE64,
      });
      assert.strictEqual(status, 200, JSON.stringify(json));
      assert.strictEqual(json.messageId, "msg_route_retry");
      assert.strictEqual(fetchCalls, 2);
    }

    // 3) both timeouts → 503 friendly message (never "fetch failed")
    mode = "always-timeout";
    fetchCalls = 0;
    {
      const { status, json } = await postJson(server.base, {
        schoolId: school.id,
        to: "parent@example.com",
        subject: "Your statement",
        html: "<p>Please see attached.</p>",
        pdfBase64: MIN_PDF_BASE64,
      });
      assert.strictEqual(status, 503, JSON.stringify(json));
      assert.strictEqual(json.error, RESEND_NETWORK_UNAVAILABLE_MESSAGE);
      assert.notStrictEqual(json.error, "fetch failed");
      assert.strictEqual(fetchCalls, 2);
    }

    // 5) HTTP 400 — no retry
    mode = "http400";
    fetchCalls = 0;
    {
      const { status, json } = await postJson(server.base, {
        schoolId: school.id,
        to: "parent@example.com",
        subject: "Your statement",
        html: "<p>Please see attached.</p>",
        pdfBase64: MIN_PDF_BASE64,
      });
      assert.strictEqual(status, 500, JSON.stringify(json));
      assert.ok(String(json.error).includes("Invalid recipient"));
      assert.strictEqual(fetchCalls, 1);
    }

    // 6) HTTP 401 — no retry
    mode = "http401";
    fetchCalls = 0;
    {
      const { status, json } = await postJson(server.base, {
        schoolId: school.id,
        to: "parent@example.com",
        subject: "Your statement",
        html: "<p>Please see attached.</p>",
        pdfBase64: MIN_PDF_BASE64,
      });
      assert.strictEqual(status, 500, JSON.stringify(json));
      assert.ok(String(json.error).includes("Unauthorized"));
      assert.strictEqual(fetchCalls, 1);
    }

    // 7) PDF generation / validation failure → Resend never called
    mode = "ok";
    fetchCalls = 0;
    {
      const { status, json } = await postJson(server.base, {
        schoolId: school.id,
        to: "parent@example.com",
        subject: "Your statement",
        html: "<p>Please see attached.</p>",
        pdfBase64: Buffer.from("NOT_A_PDF").toString("base64"),
      });
      assert.ok(status >= 400, JSON.stringify(json));
      assert.ok(String(json.error || "").toLowerCase().includes("pdf"));
      assert.strictEqual(fetchCalls, 0);
    }
  } finally {
    globalThis.fetch = originalFetch;
    await server.close();
    await prisma.school.delete({ where: { id: school.id } }).catch(() => undefined);
    if (prevKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = prevKey;
    if (prevFrom === undefined) delete process.env.EDUCLEAR_MAIL_FROM_EMAIL;
    else process.env.EDUCLEAR_MAIL_FROM_EMAIL = prevFrom;
  }

  console.log("emails.send-statement.route.test.ts: OK");
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
