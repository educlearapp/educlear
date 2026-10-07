/**
 * Capture Payment response-loss protection: attempt store, save/reconcile flow, error classification.
 * Run: TSX_TSCONFIG_PATH=tsconfig.app.json node --import tsx src/billing/paymentAttemptProtection.test.ts
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom");

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
const g = globalThis as any;
g.window = dom.window;
g.document = dom.window.document;
g.localStorage = dom.window.localStorage;
g.CustomEvent = dom.window.CustomEvent;

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

let passed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

type FetchCall = { url: string; method: string; headers: Record<string, string>; body: any };

async function main() {
  const store = await import("./paymentAttemptStore");
  const flow = await import("./paymentSaveFlow");
  const api = await import("./billingApi");

  const memory = () => {
    const map = new Map<string, string>();
    return {
      map,
      getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
      setItem: (k: string, v: string) => void map.set(k, String(v)),
      removeItem: (k: string) => void map.delete(k),
    };
  };
  let seq = 0;
  const keyGen = () => `key-${++seq}`;
  const base = {
    schoolId: "cmt1e8bjp0jo8lcjeketlynhl",
    familyAccountId: "cmt7tn8nj007silmlb7vyaqs4",
    amount: 1400,
    date: "2026-10-06",
    method: "Bank Transfer",
  };
  const id = (overrides: Record<string, unknown> = {}) => {
    const identity = store.buildPaymentAttemptIdentity({ ...base, ...overrides });
    assert(identity !== null, "identity built");
    return identity!;
  };

  // ── Attempt store ────────────────────────────────────────────────────────────
  await test("same identity reuses the pending key", () => {
    const storage = memory();
    const a = store.getOrCreatePendingPaymentAttempt(id(), { storage, generateKey: keyGen });
    const b = store.getOrCreatePendingPaymentAttempt(id(), { storage, generateKey: keyGen });
    assert(a.idempotencyKey === b.idempotencyKey, "same key for same identity");
  });

  await test("amount / date / method / account change → new key (tests 7–10)", () => {
    const storage = memory();
    const original = store.getOrCreatePendingPaymentAttempt(id(), { storage, generateKey: keyGen }).idempotencyKey;
    const variants: Array<[string, Record<string, unknown>]> = [
      ["amount", { amount: 1500 }],
      ["date", { date: "2026-10-07" }],
      ["method", { method: "EFT" }],
      ["account", { familyAccountId: "fa-other" }],
      ["school", { schoolId: "school-other" }],
    ];
    const keys = new Set([original]);
    for (const [label, change] of variants) {
      const key = store.getOrCreatePendingPaymentAttempt(id(change), { storage, generateKey: keyGen }).idempotencyKey;
      assert(!keys.has(key), `${label} change must create a new key`);
      keys.add(key);
    }
    assert(
      store.getOrCreatePendingPaymentAttempt(id(), { storage, generateKey: keyGen }).idempotencyKey === original,
      "original identity still maps to original key"
    );
  });

  await test("1400, 1400.00, '1,400.00' share one identity (test 19)", () => {
    const storage = memory();
    const a = store.getOrCreatePendingPaymentAttempt(id({ amount: 1400 }), { storage, generateKey: keyGen });
    const b = store.getOrCreatePendingPaymentAttempt(id({ amount: "1400.00" }), { storage, generateKey: keyGen });
    const c = store.getOrCreatePendingPaymentAttempt(id({ amount: "1,400.00" }), { storage, generateKey: keyGen });
    const d = store.getOrCreatePendingPaymentAttempt(id({ amount: 1400.004 }), { storage, generateKey: keyGen });
    assert(a.idempotencyKey === b.idempotencyKey && b.idempotencyKey === c.idempotencyKey, "same key");
    assert(d.idempotencyKey === a.idempotencyKey, "sub-cent float noise rounds to same cents");
    assert(a.amountCents === 140000, "stored as integer cents");
    const e = store.getOrCreatePendingPaymentAttempt(id({ amount: 1400.01 }), { storage, generateKey: keyGen });
    assert(e.idempotencyKey !== a.idempotencyKey, "one cent difference is a different payment");
  });

  await test("incomplete identity is never built", () => {
    for (const bad of [
      { familyAccountId: "" },
      { schoolId: "" },
      { amount: 0 },
      { amount: -5 },
      { amount: "abc" },
      { date: "" },
      { date: "06/10/2026" },
      { method: "" },
    ]) {
      assert(store.buildPaymentAttemptIdentity({ ...base, ...bad }) === null, `rejects ${JSON.stringify(bad)}`);
    }
    assert(store.listPendingPaymentAttemptsForAccount("", base.familyAccountId, { storage: memory() }).length === 0, "no account → none");
  });

  await test(">24h attempt discarded; fresh key only after expiry (test 18)", () => {
    const storage = memory();
    const t0 = Date.parse("2026-10-07T05:41:00Z");
    const first = store.getOrCreatePendingPaymentAttempt(id(), { storage, now: t0, generateKey: keyGen });
    const stillLive = store.getOrCreatePendingPaymentAttempt(id(), {
      storage,
      now: t0 + 23 * 3600_000,
      generateKey: keyGen,
    });
    assert(stillLive.idempotencyKey === first.idempotencyKey, "within 24h → same key");
    const after = t0 + store.PENDING_PAYMENT_ATTEMPT_TTL_MS + 1;
    assert(store.listPendingPaymentAttempts({ storage, now: after }).length === 0, "expired attempt pruned");
    assert(storage.map.get(store.PENDING_PAYMENT_ATTEMPTS_STORAGE_KEY) === undefined, "storage cleaned");
    const fresh = store.getOrCreatePendingPaymentAttempt(id(), { storage, now: after, generateKey: keyGen });
    assert(fresh.idempotencyKey !== first.idempotencyKey, "fresh key after expiry");
  });

  await test("stored record has no names, notes, tokens or payload", () => {
    const storage = memory();
    localStorage.setItem("token", "jwt-secret-token");
    store.getOrCreatePendingPaymentAttempt(id(), { storage, generateKey: keyGen });
    const raw = storage.map.get(store.PENDING_PAYMENT_ATTEMPTS_STORAGE_KEY) || "";
    const rows = JSON.parse(raw);
    assert(
      Object.keys(rows[0]).sort().join(",") ===
        "amountCents,createdAt,date,familyAccountId,idempotencyKey,method,schoolId",
      `minimal fields only: ${Object.keys(rows[0]).join(",")}`
    );
    assert(!raw.includes("jwt-secret-token"), "no auth token");
    assert(!raw.includes("LENTSWE") && !raw.includes("LEN003"), "no account name / code");
    localStorage.removeItem("token");
  });

  await test("corrupt storage is ignored safely and remove works", () => {
    const storage = memory();
    storage.setItem(store.PENDING_PAYMENT_ATTEMPTS_STORAGE_KEY, "{not json");
    assert(store.listPendingPaymentAttempts({ storage }).length === 0, "corrupt → empty");
    storage.setItem(
      store.PENDING_PAYMENT_ATTEMPTS_STORAGE_KEY,
      JSON.stringify([{ idempotencyKey: "../bad key", schoolId: "s" }, null, 5])
    );
    assert(store.listPendingPaymentAttempts({ storage }).length === 0, "invalid rows pruned");
    const a = store.getOrCreatePendingPaymentAttempt(id(), { storage, generateKey: keyGen });
    store.removePendingPaymentAttempt(a.idempotencyKey, { storage });
    assert(store.findPendingPaymentAttempt(id(), { storage }) === null, "removed");
  });

  // ── Save / reconcile flow ───────────────────────────────────────────────────
  const noSleep = async () => {};
  const okResult = (key: string) => ({
    success: true,
    payment: { id: `pay-${key}`, reference: "PAY-20261006-LENTSWE-001" },
    allocationSaved: true,
  });
  const networkError = () => new api.PaymentRequestError("network", "Connection to EduClear was interrupted.");
  const buildPayload = (key: string) => ({ idempotencyKey: key, amount: 1400 });

  await test("normal save: one POST, attempt removed (test 1)", async () => {
    const storage = memory();
    const posts: string[] = [];
    let statusCalls = 0;
    const outcome = await flow.executePaymentSave(id(), buildPayload, {
      createPayment: async (p) => {
        posts.push(String(p.idempotencyKey));
        return okResult(String(p.idempotencyKey));
      },
      fetchStatus: async () => {
        statusCalls += 1;
        return { found: false };
      },
      sleep: noSleep,
      store: { storage, generateKey: keyGen },
    });
    assert(outcome.kind === "saved", "saved");
    assert(posts.length === 1 && statusCalls === 0, "exactly one POST, no status checks");
    assert(store.listPendingPaymentAttempts({ storage }).length === 0, "attempt cleared on success");
  });

  await test("server saved, response lost: status finds it, NO second POST (test 2)", async () => {
    const storage = memory();
    const posts: string[] = [];
    const uncertain: string[] = [];
    const outcome = await flow.executePaymentSave(id(), buildPayload, {
      createPayment: async (p) => {
        posts.push(String(p.idempotencyKey));
        throw networkError();
      },
      fetchStatus: async (key) => ({
        found: true,
        payment: { id: `pay-${key}`, reference: "PAY-20261006-LENTSWE-001", amount: 1400, date: "2026-10-06", method: "Bank Transfer", createdAt: "" },
        allocationSaved: true,
      }),
      sleep: noSleep,
      onUncertain: (e) => uncertain.push(e.kind),
      store: { storage, generateKey: keyGen },
    });
    assert(outcome.kind === "confirmed_after_interruption", `confirmed (got ${outcome.kind})`);
    assert(posts.length === 1, "exactly one POST");
    assert(uncertain.join() === "network", "uncertain callback fired once");
    if (outcome.kind === "confirmed_after_interruption") {
      assert(outcome.payment.reference === "PAY-20261006-LENTSWE-001", "receipt number from status");
      assert(
        flow.paymentConfirmedMessage(outcome.payment.reference) ===
          "Payment confirmed — receipt PAY-20261006-LENTSWE-001",
        "confirmation message"
      );
    }
    assert(store.listPendingPaymentAttempts({ storage }).length === 0, "attempt cleared once confirmed");
  });

  await test("status NOT FOUND: Save safe again with SAME key (test 5)", async () => {
    const storage = memory();
    const posts: string[] = [];
    const first = await flow.executePaymentSave(id(), buildPayload, {
      createPayment: async (p) => {
        posts.push(String(p.idempotencyKey));
        throw networkError();
      },
      fetchStatus: async () => ({ found: false }),
      sleep: noSleep,
      store: { storage, generateKey: keyGen },
    });
    assert(first.kind === "not_saved_after_interruption", `not saved (got ${first.kind})`);
    assert(store.listPendingPaymentAttempts({ storage }).length === 1, "attempt kept");
    assert(
      flow.paymentCreateControlState({ saving: false, gate: "idle" }).saveDisabled === false,
      "Save available again"
    );
    const second = await flow.executePaymentSave(id(), buildPayload, {
      createPayment: async (p) => {
        posts.push(String(p.idempotencyKey));
        return okResult(String(p.idempotencyKey));
      },
      fetchStatus: async () => ({ found: false }),
      sleep: noSleep,
      store: { storage, generateKey: keyGen },
    });
    assert(second.kind === "saved", "second press saved");
    assert(posts.length === 2 && posts[0] === posts[1], "retry reused the original key");
    assert(store.listPendingPaymentAttempts({ storage }).length === 0, "cleared after success");
  });

  await test("status unavailable: warned, Save blocked, attempt persisted (test 6)", async () => {
    const storage = memory();
    let statusCalls = 0;
    const sleeps: number[] = [];
    const outcome = await flow.executePaymentSave(id(), buildPayload, {
      createPayment: async () => {
        throw networkError();
      },
      fetchStatus: async () => {
        statusCalls += 1;
        throw networkError();
      },
      sleep: async (ms) => void sleeps.push(ms),
      store: { storage, generateKey: keyGen },
    });
    assert(outcome.kind === "unconfirmed", `unconfirmed (got ${outcome.kind})`);
    assert(statusCalls === 3 && sleeps.join() === "1000,3000,6000", `checks at +1/+3/+6s (${sleeps.join()})`);
    assert(store.listPendingPaymentAttempts({ storage }).length === 1, "attempt persisted");
    const controls = flow.paymentCreateControlState({ saving: false, gate: "unknown" });
    assert(controls.saveDisabled === true, "Save blocked while unconfirmed");
    assert(controls.backDisabled === false, "Back allowed once checks stop");
    assert(flow.PAYMENT_SAVE_MESSAGES.unknown.includes("Do not capture this payment again"), "warning copy");
  });

  await test("not_found then found on a later check counts as found", async () => {
    let n = 0;
    const outcome = await flow.reconcilePaymentAttempt("k", {
      fetchStatus: async () => {
        n += 1;
        if (n < 3) return { found: false };
        return { found: true, payment: { id: "pay-k", reference: "PAY-1", amount: 1, date: "", method: "", createdAt: "" }, allocationSaved: true };
      },
      sleep: noSleep,
      delaysMs: [1, 2, 3],
    });
    assert(outcome.status === "found", "late write is still found");
    const lastFails = await flow.reconcilePaymentAttempt("k", {
      fetchStatus: (() => {
        let c = 0;
        return async () => {
          c += 1;
          if (c === 1) return { found: false };
          throw networkError();
        };
      })(),
      sleep: noSleep,
      delaysMs: [1, 2],
    });
    assert(lastFails.status === "unknown", "failed final check is unknown, never not_found");
  });

  await test("4xx rejection clears attempt; JSON 5xx keeps it for same-key retry", async () => {
    const storage = memory();
    const rejected = await flow.executePaymentSave(id(), buildPayload, {
      createPayment: async () => {
        throw new api.PaymentRequestError("http", "Payment date must be yyyy-MM-dd", 400);
      },
      fetchStatus: async () => ({ found: false }),
      sleep: noSleep,
      store: { storage, generateKey: keyGen },
    });
    assert(rejected.kind === "rejected", "rejected");
    assert(store.listPendingPaymentAttempts({ storage }).length === 0, "4xx (pre-write) clears attempt");
    const serverErr = await flow.executePaymentSave(id(), buildPayload, {
      createPayment: async () => {
        throw new api.PaymentRequestError("http", "Server error", 500);
      },
      fetchStatus: async () => ({ found: false }),
      sleep: noSleep,
      store: { storage, generateKey: keyGen },
    });
    assert(serverErr.kind === "rejected", "5xx rejected");
    assert(store.listPendingPaymentAttempts({ storage }).length === 1, "5xx keeps attempt");
  });

  await test("only readable EduClear 4xx/auth count as definitive pre-write rejections", () => {
    const E = api.PaymentRequestError;
    const yes: Array<[string, number]> = [["http", 400], ["auth", 401], ["auth", 403], ["http", 404], ["http", 409], ["http", 422]];
    for (const [kind, status] of yes) {
      assert(flow.isDefinitivePreWriteRejection(new E(kind as any, "x", status)), `${kind} ${status} definitive`);
    }
    const no: Array<[string, number | null]> = [
      ["http", 408],
      ["http", 429],
      ["http", 500],
      ["http", 503],
      ["network", 400],
      ["malformed", 200],
      ["network", null],
      ["http", null],
    ];
    for (const [kind, status] of no) {
      assert(!flow.isDefinitivePreWriteRejection(new E(kind as any, "x", status)), `${kind} ${status} not definitive`);
    }
    assert(!flow.isDefinitivePreWriteRejection(new Error("x")), "plain Error not definitive");
  });

  await test("not-found / unknown attempts are never discarded and keep their key", async () => {
    const storage = memory();
    const posts: string[] = [];
    const fail = async () => {
      throw networkError();
    };
    const unknown = await flow.executePaymentSave(id(), buildPayload, {
      createPayment: async (p) => {
        posts.push(String(p.idempotencyKey));
        return fail();
      },
      fetchStatus: fail,
      sleep: noSleep,
      store: { storage, generateKey: keyGen },
    });
    assert(unknown.kind === "unconfirmed", "unknown");
    const protectedKey = unknown.attempt.idempotencyKey;
    const forced = await flow.executePaymentSave(id(), buildPayload, {
      createPayment: async (p) => {
        posts.push(String(p.idempotencyKey));
        return okResult(String(p.idempotencyKey));
      },
      fetchStatus: async () => ({ found: false }),
      sleep: noSleep,
      store: { storage, generateKey: keyGen },
    });
    assert(forced.kind === "saved" && posts[1] === protectedKey, "even a forced retry reuses the protected key");

    const storage2 = memory();
    const first = await flow.executePaymentSave(id(), buildPayload, {
      createPayment: fail,
      fetchStatus: async () => ({ found: false }),
      sleep: noSleep,
      store: { storage: storage2, generateKey: keyGen },
    });
    assert(first.kind === "not_saved_after_interruption", "not found");
    const changed = store.getOrCreatePendingPaymentAttempt(id({ amount: 1500 }), { storage: storage2, generateKey: keyGen });
    assert(changed.idempotencyKey !== first.attempt.idempotencyKey, "deliberate amount change → new identity/key");
    const keys = store.listPendingPaymentAttempts({ storage: storage2 }).map((a) => a.idempotencyKey);
    assert(keys.includes(first.attempt.idempotencyKey), "unresolved original attempt still protected");
    assert(
      store.getOrCreatePendingPaymentAttempt(id(), { storage: storage2, generateKey: keyGen }).idempotencyKey ===
        first.attempt.idempotencyKey,
      "original identity still maps to its protected key"
    );
  });

  await test("Back/Save disabled during POST and reconciliation (test 17)", () => {
    const saving = flow.paymentCreateControlState({ saving: true, gate: "idle" });
    assert(saving.saveDisabled && saving.backDisabled, "during POST");
    const checking = flow.paymentCreateControlState({ saving: false, gate: "checking" });
    assert(checking.saveDisabled && checking.backDisabled, "during reconciliation");
    const idle = flow.paymentCreateControlState({ saving: false, gate: "idle" });
    assert(!idle.saveDisabled && !idle.backDisabled, "idle");
  });

  // ── createPayment / status classification (test 16) ─────────────────────────
  const calls: FetchCall[] = [];
  let responder: (call: FetchCall) => Promise<Response> | Response = () => new Response("{}");
  g.fetch = async (input: unknown, init: RequestInit = {}) => {
    const headers: Record<string, string> = {};
    new Headers(init.headers as HeadersInit).forEach((v, k) => {
      headers[k] = v;
    });
    const call = {
      url: String(input),
      method: String(init.method || "GET").toUpperCase(),
      headers,
      body: typeof init.body === "string" ? JSON.parse(init.body) : null,
    };
    calls.push(call);
    return responder(call);
  };
  const json = (status: number, data: unknown) =>
    new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
  const expectKind = async (kind: string, run: () => Promise<unknown>, label: string) => {
    try {
      await run();
    } catch (error) {
      assert(error instanceof api.PaymentRequestError, `${label}: PaymentRequestError`);
      assert((error as InstanceType<typeof api.PaymentRequestError>).kind === kind, `${label}: kind ${(error as any).kind} ≠ ${kind}`);
      return error as InstanceType<typeof api.PaymentRequestError>;
    }
    throw new Error(`${label}: expected ${kind} error`);
  };

  await test("network vs HTTP vs malformed vs auth are classified distinctly", async () => {
    localStorage.setItem("token", "staff-jwt");
    responder = () => {
      throw new TypeError("Failed to fetch");
    };
    const net = await expectKind("network", () => api.createPayment({ a: 1 }), "fetch rejected");
    assert(!net.message.includes("Failed to fetch"), "raw browser text not surfaced");
    assert(api.isUncertainPaymentRequestError(net), "network is uncertain");

    responder = () => new Response("<html>oops</html>", { status: 200 });
    const bad = await expectKind("malformed", () => api.createPayment({}), "2xx non-JSON");
    assert(api.isUncertainPaymentRequestError(bad), "malformed is uncertain");

    responder = () => ({ ok: true, status: 200, statusText: "OK", text: () => Promise.reject(new TypeError("network error")) }) as unknown as Response;
    await expectKind("network", () => api.createPayment({}), "body cut off mid-stream");

    responder = () => new Response("<html>Bad Gateway</html>", { status: 502 });
    await expectKind("network", () => api.createPayment({}), "502 gateway");
    responder = () => new Response("", { status: 504 });
    await expectKind("network", () => api.createPayment({}), "504 gateway");
    responder = () => json(408, { error: "Request Timeout" });
    await expectKind("network", () => api.createPayment({}), "408 is ambiguous");
    responder = () => json(429, { error: "Too many requests" });
    await expectKind("network", () => api.createPayment({}), "429 is ambiguous");
    responder = () => new Response("<html>Forbidden</html>", { status: 403 });
    await expectKind("network", () => api.createPayment({}), "non-EduClear (unreadable) 4xx is ambiguous");

    responder = () => json(400, { success: false, error: "Payment date must be yyyy-MM-dd" });
    const http = await expectKind("http", () => api.createPayment({}), "400");
    assert(http.message === "Payment date must be yyyy-MM-dd" && http.status === 400, "readable 4xx message");
    assert(!api.isUncertainPaymentRequestError(http), "http is not uncertain");

    responder = () => json(500, { success: false, error: "Server error" });
    const s500 = await expectKind("http", () => api.createPayment({}), "500 JSON");
    assert(s500.status === 500, "500 status kept");

    responder = () => json(401, { success: false, error: "Authentication required" });
    await expectKind("auth", () => api.createPayment({}), "401");
    responder = () => json(403, { success: false, error: "Permission denied" });
    await expectKind("auth", () => api.createPayment({}), "403");

    responder = () => json(200, { success: false, error: "Payment was not saved" });
    await expectKind("http", () => api.createPayment({}), "200 success:false");

    calls.length = 0;
    responder = () => json(200, okResult("abc"));
    const ok = await api.createPayment({ idempotencyKey: "abc", amount: 1400 });
    assert((ok.payment as any).id === "pay-abc", "success body returned unchanged");
    assert(calls.length === 1 && calls[0].method === "POST" && calls[0].url.endsWith("/api/payments"), "one POST");
    assert(calls[0].headers.authorization === "Bearer staff-jwt", "staff auth header sent");
    assert(calls[0].body.idempotencyKey === "abc", "payload untouched");
  });

  await test("fetchPaymentAttemptStatus: GET with auth, validated shape", async () => {
    calls.length = 0;
    responder = () => json(200, { success: true, found: false });
    const nf = await api.fetchPaymentAttemptStatus("idem-1_x");
    assert(nf.found === false, "not found");
    assert(calls[0].method === "GET" && calls[0].url.endsWith("/api/payments/attempts/idem-1_x"), "GET attempts url");
    assert(calls[0].headers.authorization === "Bearer staff-jwt", "auth header");
    assert(calls[0].body === null, "no body");

    responder = () =>
      json(200, { success: true, found: true, payment: { id: "pay-x", reference: "PAY-1", amount: 1400, date: "2026-10-06", method: "EFT", createdAt: "t" }, allocationSaved: true });
    const found = await api.fetchPaymentAttemptStatus("x");
    assert(found.found === true && found.payment.id === "pay-x", "found");

    responder = () => json(200, { success: true, found: true });
    await expectKind("malformed", () => api.fetchPaymentAttemptStatus("x"), "found without payment");
    responder = () => json(401, { error: "Authentication required" });
    await expectKind("auth", () => api.fetchPaymentAttemptStatus("x"), "status 401");
    responder = () => {
      throw new TypeError("Failed to fetch");
    };
    await expectKind("network", () => api.fetchPaymentAttemptStatus("x"), "status network");
    localStorage.removeItem("token");
  });

  console.log(`paymentAttemptProtection: ${passed} passed`);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
