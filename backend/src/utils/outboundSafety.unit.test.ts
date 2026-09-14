/**
 * Staging-safety: CORS allowlist merge, outbound kill switches, health payload.
 * Run: npx tsx src/utils/outboundSafety.unit.test.ts
 */
import assert from "assert";
import express from "express";
import http from "http";

import {
  buildHealthResponse,
  DEFAULT_CORS_ALLOWED_ORIGINS,
  isAbsoluteHttpOrigin,
  isCorsOriginAllowed,
  isOutboundEmailDisabled,
  isOutboundSmsDisabled,
  OutboundEmailDisabledError,
  OutboundSmsDisabledError,
  parseCorsAllowedOrigins,
  resolveCorsAllowedOrigins,
  assertOutboundEmailEnabled,
  assertOutboundSmsEnabled,
  OUTBOUND_EMAIL_DISABLED_MESSAGE,
  OUTBOUND_SMS_DISABLED_MESSAGE,
} from "./outboundSafety";
import { postResendEmail } from "../services/resendClient";
import { sendWinSms, WinSmsApiError } from "../services/winSmsClient";

function withEnv(vars: Record<string, string | undefined>, fn: () => void | Promise<void>) {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    previous[key] = process.env[key];
    const next = vars[key];
    if (next === undefined) delete process.env[key];
    else process.env[key] = next;
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const key of Object.keys(vars)) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
    });
}

async function requestJson(
  app: express.Express,
  method: string,
  pathName: string
): Promise<{ status: number; body: unknown; headers: http.IncomingHttpHeaders }> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}${pathName}`, { method });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* keep text */
    }
    return { status: res.status, body, headers: Object.fromEntries(res.headers.entries()) };
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  }
}

async function testCorsParsing() {
  assert.deepStrictEqual(parseCorsAllowedOrigins(""), []);
  assert.deepStrictEqual(parseCorsAllowedOrigins(undefined), []);
  assert.deepStrictEqual(parseCorsAllowedOrigins("  ,  , "), []);
  assert.deepStrictEqual(
    parseCorsAllowedOrigins("https://educlear-frontend-staging.onrender.com"),
    ["https://educlear-frontend-staging.onrender.com"]
  );
  assert.deepStrictEqual(
    parseCorsAllowedOrigins(
      " https://a.example.com , https://b.example.com, https://a.example.com "
    ),
    ["https://a.example.com", "https://b.example.com"]
  );
  assert.deepStrictEqual(parseCorsAllowedOrigins("*"), []);
  assert.deepStrictEqual(parseCorsAllowedOrigins("https://evil.example/path"), []);
  assert.deepStrictEqual(parseCorsAllowedOrigins("ftp://not-http.example"), []);
  assert.ok(!isAbsoluteHttpOrigin("*"));
  assert.ok(isAbsoluteHttpOrigin("http://localhost:5173"));
}

async function testCorsMergeAdditive() {
  const merged = resolveCorsAllowedOrigins(
    "https://educlear-frontend-staging.onrender.com, https://educlear-frontend.onrender.com"
  );
  for (const origin of DEFAULT_CORS_ALLOWED_ORIGINS) {
    assert.ok(merged.includes(origin), `missing default ${origin}`);
  }
  assert.ok(merged.includes("https://educlear-frontend-staging.onrender.com"));
  assert.strictEqual(
    merged.filter((o) => o === "https://educlear-frontend.onrender.com").length,
    1,
    "production origin must not be duplicated"
  );
}

async function testCorsAllowReject() {
  const allowed = resolveCorsAllowedOrigins(
    "https://educlear-frontend-staging.onrender.com"
  );
  assert.ok(isCorsOriginAllowed("https://educlear-frontend.onrender.com", allowed, { isDev: false }));
  assert.ok(isCorsOriginAllowed("http://localhost:5173", allowed, { isDev: false }));
  assert.ok(
    isCorsOriginAllowed("https://educlear-frontend-staging.onrender.com", allowed, {
      isDev: false,
    })
  );
  assert.ok(isCorsOriginAllowed(undefined, allowed, { isDev: false }));
  assert.ok(
    !isCorsOriginAllowed("https://attacker.example", allowed, { isDev: false }),
    "random attacker origin must be rejected"
  );
  assert.ok(!allowed.includes("*"));
  assert.ok(!allowed.some((o) => o.includes("*")));
}

async function testEmailKillSwitchFlags() {
  await withEnv({ DISABLE_OUTBOUND_EMAIL: undefined }, () => {
    assert.strictEqual(isOutboundEmailDisabled(), false);
    assert.doesNotThrow(() => assertOutboundEmailEnabled());
  });
  await withEnv({ DISABLE_OUTBOUND_EMAIL: "false" }, () => {
    assert.strictEqual(isOutboundEmailDisabled(), false);
  });
  await withEnv({ DISABLE_OUTBOUND_EMAIL: "true" }, () => {
    assert.strictEqual(isOutboundEmailDisabled(), true);
    assert.throws(() => assertOutboundEmailEnabled(), OutboundEmailDisabledError);
  });
  await withEnv({ DISABLE_OUTBOUND_EMAIL: "TRUE" }, () => {
    assert.strictEqual(isOutboundEmailDisabled(), true);
  });
}

async function testSmsKillSwitchFlags() {
  await withEnv({ DISABLE_OUTBOUND_SMS: undefined }, () => {
    assert.strictEqual(isOutboundSmsDisabled(), false);
    assert.doesNotThrow(() => assertOutboundSmsEnabled());
  });
  await withEnv({ DISABLE_OUTBOUND_SMS: "false" }, () => {
    assert.strictEqual(isOutboundSmsDisabled(), false);
  });
  await withEnv({ DISABLE_OUTBOUND_SMS: "true" }, () => {
    assert.strictEqual(isOutboundSmsDisabled(), true);
    assert.throws(() => assertOutboundSmsEnabled(), OutboundSmsDisabledError);
    assert.strictEqual(new OutboundSmsDisabledError().message, OUTBOUND_SMS_DISABLED_MESSAGE);
  });
}

async function testResendNotCalledWhenEmailDisabled() {
  let fetchCalls = 0;
  const fakeFetch = (async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify({ id: "should-not-send" }), { status: 200 });
  }) as typeof fetch;

  await withEnv({ DISABLE_OUTBOUND_EMAIL: "true" }, async () => {
    await assert.rejects(
      () =>
        postResendEmail({
          apiKey: "re_test",
          payload: {
            from: "EduClear <noreply@educlear.co.za>",
            to: ["nobody@example.test"],
            subject: "should not send",
            html: "<p>no</p>",
          },
          fetchImpl: fakeFetch,
        }),
      (err: unknown) =>
        err instanceof OutboundEmailDisabledError &&
        err.message === OUTBOUND_EMAIL_DISABLED_MESSAGE
    );
  });
  assert.strictEqual(fetchCalls, 0, "Resend fetch must not be invoked when email disabled");
}

async function testResendStillCallableWhenEmailEnabled() {
  let fetchCalls = 0;
  const fakeFetch = (async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify({ id: "msg_ok" }), { status: 200 });
  }) as typeof fetch;

  await withEnv({ DISABLE_OUTBOUND_EMAIL: undefined }, async () => {
    const result = await postResendEmail({
      apiKey: "re_test",
      payload: {
        from: "EduClear <noreply@educlear.co.za>",
        to: ["nobody@example.test"],
        subject: "ok",
        html: "<p>ok</p>",
      },
      fetchImpl: fakeFetch,
    });
    assert.strictEqual(result.messageId, "msg_ok");
  });
  assert.strictEqual(fetchCalls, 1);
}

async function testWinSmsNotCalledWhenSmsDisabled() {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify({ statusCode: 200 }), { status: 200 });
  }) as typeof fetch;

  try {
    await withEnv({ DISABLE_OUTBOUND_SMS: "true" }, async () => {
      await assert.rejects(
        () =>
          sendWinSms("fake-key", {
            message: "hello",
            recipients: [{ mobileNumber: "27821234567" }],
          }),
        (err: unknown) =>
          err instanceof WinSmsApiError &&
          err.message === OUTBOUND_SMS_DISABLED_MESSAGE &&
          err.statusCode === 503
      );
    });
    assert.strictEqual(fetchCalls, 0, "WinSMS fetch must not be invoked when SMS disabled");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testHealthEndpoint() {
  assert.deepStrictEqual(buildHealthResponse(), { status: "ok" });
  const app = express();
  app.get("/api/health", (_req, res) => {
    res.status(200).json(buildHealthResponse());
  });
  const result = await requestJson(app, "GET", "/api/health");
  assert.strictEqual(result.status, 200);
  assert.deepStrictEqual(result.body, { status: "ok" });
  const bodyObj = result.body as Record<string, unknown>;
  assert.strictEqual(Object.keys(bodyObj).length, 1);
  assert.ok(!("DATABASE_URL" in bodyObj));
  assert.ok(!("env" in bodyObj));
  assert.ok(!("secrets" in bodyObj));
}

async function main() {
  await testCorsParsing();
  await testCorsMergeAdditive();
  await testCorsAllowReject();
  await testEmailKillSwitchFlags();
  await testSmsKillSwitchFlags();
  await testResendNotCalledWhenEmailDisabled();
  await testResendStillCallableWhenEmailEnabled();
  await testWinSmsNotCalledWhenSmsDisabled();
  await testHealthEndpoint();
  console.log("outboundSafety.unit.test.ts: PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
