/**
 * Unit tests for Resend client timeout / single retry behaviour.
 * Run: npx ts-node --transpile-only src/services/resendClient.unit.test.ts
 */
import assert from "assert";
import {
  postResendEmail,
  isResendTransientNetworkError,
  ResendNetworkUnavailableError,
  RESEND_NETWORK_UNAVAILABLE_MESSAGE,
  RESEND_MAX_ATTEMPTS,
  RESEND_ATTEMPT_TIMEOUT_MS,
  RESEND_RETRYABLE_ERROR_CODES,
  formatResendHttpError,
} from "./resendClient";
import {
  EDUCLEAR_RELAY_FROM_EMAIL,
  EDUCLEAR_RELAY_FROM_NAME,
} from "../communication/schoolSender";

function networkError(code: string, message = "fetch failed"): TypeError {
  const cause = Object.assign(new Error(message), { code });
  return Object.assign(new TypeError("fetch failed"), { cause });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function testFirstSuccessNoRetry() {
  let calls = 0;
  const result = await postResendEmail({
    apiKey: "re_test",
    payload: {
      from: `"${EDUCLEAR_RELAY_FROM_NAME}" <${EDUCLEAR_RELAY_FROM_EMAIL}>`,
      to: ["parent@example.com"],
      subject: "Statement",
      html: "<p>Hi</p>",
      reply_to: "school@example.com",
    },
    sleepImpl: async () => {
      throw new Error("sleep should not run when first attempt succeeds");
    },
    fetchImpl: async (_url, init) => {
      calls += 1;
      const body = JSON.parse(String(init?.body || "{}"));
      assert.strictEqual(body.from, `"${EDUCLEAR_RELAY_FROM_NAME}" <${EDUCLEAR_RELAY_FROM_EMAIL}>`);
      assert.strictEqual(body.reply_to, "school@example.com");
      assert.notStrictEqual(body.from.includes("onboarding@resend.dev"), true);
      return jsonResponse(200, { id: "msg_ok_1" });
    },
  });
  assert.strictEqual(result.messageId, "msg_ok_1");
  assert.strictEqual(calls, 1);
}

async function testTimeoutThenSuccess() {
  let calls = 0;
  let slept = 0;
  const result = await postResendEmail({
    apiKey: "re_test",
    payload: {
      from: `"EduClear" <${EDUCLEAR_RELAY_FROM_EMAIL}>`,
      to: ["parent@example.com"],
      subject: "Statement",
      html: "<p>Hi</p>",
      reply_to: "school@example.com",
    },
    retryDelayMs: 10,
    sleepImpl: async (ms) => {
      slept += 1;
      assert.strictEqual(ms, 10);
    },
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        throw err;
      }
      return jsonResponse(200, { id: "msg_after_timeout" });
    },
  });
  assert.strictEqual(result.messageId, "msg_after_timeout");
  assert.strictEqual(calls, 2);
  assert.strictEqual(slept, 1);
}

async function testBothTimeoutsReturnUnavailable() {
  let calls = 0;
  await assert.rejects(
    () =>
      postResendEmail({
        apiKey: "re_test",
        payload: {
          from: `"EduClear" <${EDUCLEAR_RELAY_FROM_EMAIL}>`,
          to: ["parent@example.com"],
          subject: "Statement",
          html: "<p>Hi</p>",
        },
        retryDelayMs: 10,
        sleepImpl: async () => undefined,
        fetchImpl: async () => {
          calls += 1;
          throw Object.assign(new TypeError("fetch failed"), {
            cause: Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }),
          });
        },
      }),
    (err: unknown) => {
      assert.ok(err instanceof ResendNetworkUnavailableError);
      assert.strictEqual(err.statusCode, 503);
      assert.strictEqual(err.message, RESEND_NETWORK_UNAVAILABLE_MESSAGE);
      assert.notStrictEqual(err.message, "fetch failed");
      assert.strictEqual(err.attempts, RESEND_MAX_ATTEMPTS);
      return true;
    }
  );
  assert.strictEqual(calls, 2);
}

async function testEconnresetThenSuccess() {
  let calls = 0;
  const result = await postResendEmail({
    apiKey: "re_test",
    payload: {
      from: `"EduClear" <${EDUCLEAR_RELAY_FROM_EMAIL}>`,
      to: ["parent@example.com"],
      subject: "Statement",
      html: "<p>Hi</p>",
      reply_to: "school@example.com",
    },
    retryDelayMs: 10,
    sleepImpl: async () => undefined,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) throw networkError("ECONNRESET");
      return jsonResponse(200, { id: "msg_reset_ok" });
    },
  });
  assert.strictEqual(result.messageId, "msg_reset_ok");
  assert.strictEqual(calls, 2);
}

async function testHttp400NoRetry() {
  let calls = 0;
  await assert.rejects(
    () =>
      postResendEmail({
        apiKey: "re_test",
        payload: {
          from: `"EduClear" <${EDUCLEAR_RELAY_FROM_EMAIL}>`,
          to: ["parent@example.com"],
          subject: "Statement",
          html: "<p>Hi</p>",
        },
        sleepImpl: async () => {
          throw new Error("must not retry HTTP 400");
        },
        fetchImpl: async () => {
          calls += 1;
          return jsonResponse(400, { message: "Invalid payload" });
        },
      }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(String(err.message).includes("Invalid payload"));
      assert.ok(!(err instanceof ResendNetworkUnavailableError));
      return true;
    }
  );
  assert.strictEqual(calls, 1);
}

async function testHttp401And403NoRetry() {
  for (const status of [401, 403]) {
    let calls = 0;
    await assert.rejects(
      () =>
        postResendEmail({
          apiKey: "re_test",
          payload: {
            from: `"EduClear" <${EDUCLEAR_RELAY_FROM_EMAIL}>`,
            to: ["parent@example.com"],
            subject: "Statement",
            html: "<p>Hi</p>",
          },
          sleepImpl: async () => {
            throw new Error(`must not retry HTTP ${status}`);
          },
          fetchImpl: async () => {
            calls += 1;
            return jsonResponse(status, { message: status === 401 ? "Unauthorized" : "Forbidden" });
          },
        }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(!(err instanceof ResendNetworkUnavailableError));
        return true;
      }
    );
    assert.strictEqual(calls, 1, `expected one call for HTTP ${status}`);
  }
}

async function testFromAndReplyToPreserved() {
  let captured: Record<string, unknown> | null = null;
  // Stale env must not leak into From when caller supplies verified From
  process.env.EDUCLEAR_MAIL_FROM_EMAIL = "onboarding@resend.dev";
  await postResendEmail({
    apiKey: "re_test",
    payload: {
      from: `"${EDUCLEAR_RELAY_FROM_NAME}" <${EDUCLEAR_RELAY_FROM_EMAIL}>`,
      to: ["parent@example.com"],
      subject: "Statement",
      html: "<p>Hi</p>",
      reply_to: "dasilvaacademy@gmail.com",
    },
    fetchImpl: async (_url, init) => {
      captured = JSON.parse(String(init?.body || "{}"));
      return jsonResponse(200, { id: "msg_from_ok" });
    },
  });
  assert.ok(captured);
  assert.strictEqual(captured!.from, `"${EDUCLEAR_RELAY_FROM_NAME}" <${EDUCLEAR_RELAY_FROM_EMAIL}>`);
  assert.strictEqual(captured!.reply_to, "dasilvaacademy@gmail.com");
  assert.ok(!String(captured!.from).includes("onboarding@resend.dev"));
}

async function testRetryNeverExceedsOne() {
  let calls = 0;
  await assert.rejects(
    () =>
      postResendEmail({
        apiKey: "re_test",
        payload: {
          from: `"EduClear" <${EDUCLEAR_RELAY_FROM_EMAIL}>`,
          to: ["parent@example.com"],
          subject: "Statement",
          html: "<p>Hi</p>",
        },
        retryDelayMs: 5,
        sleepImpl: async () => undefined,
        fetchImpl: async () => {
          calls += 1;
          throw networkError("ENETUNREACH");
        },
      }),
    (err: unknown) => err instanceof ResendNetworkUnavailableError
  );
  assert.strictEqual(calls, 2);
  assert.strictEqual(RESEND_MAX_ATTEMPTS, 2);
}

async function testHelpers() {
  assert.ok(isResendTransientNetworkError(networkError("ETIMEDOUT")));
  assert.ok(isResendTransientNetworkError(networkError("ECONNRESET")));
  assert.ok(!isResendTransientNetworkError(new Error("Invalid recipient")));
  assert.strictEqual(RESEND_ATTEMPT_TIMEOUT_MS, 15_000);
  assert.ok(RESEND_RETRYABLE_ERROR_CODES.includes("ETIMEDOUT"));
  assert.ok(RESEND_RETRYABLE_ERROR_CODES.includes("UND_ERR_CONNECT_TIMEOUT"));
  assert.ok(formatResendHttpError(400, '{"message":"bad"}').includes("bad"));
}

async function main() {
  await testFirstSuccessNoRetry();
  await testTimeoutThenSuccess();
  await testBothTimeoutsReturnUnavailable();
  await testEconnresetThenSuccess();
  await testHttp400NoRetry();
  await testHttp401And403NoRetry();
  await testFromAndReplyToPreserved();
  await testRetryNeverExceedsOne();
  await testHelpers();
  console.log("resendClient.unit.test.ts: OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
