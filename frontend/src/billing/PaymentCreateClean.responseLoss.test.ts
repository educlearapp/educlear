/**
 * Capture Payment screen — lost-response protection, rendered for real in jsdom.
 * Run: TSX_TSCONFIG_PATH=tsconfig.app.json node --import tsx src/billing/PaymentCreateClean.responseLoss.test.ts
 */
import { createRequire, register } from "node:module";

register(
  "data:text/javascript," +
    encodeURIComponent(
      "export async function load(url, context, next) {" +
        " if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };" +
        // Debug-only widget reads Vite import.meta.env at module scope.
        " if (url.includes('/billing/BillingEnvDebug.tsx')) return { format: 'module', source: 'export default function BillingEnvDebug() { return null; }', shortCircuit: true };" +
        " return next(url, context); }"
    )
);

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom");

const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});
const g = globalThis as any;
g.window = dom.window;
g.document = dom.window.document;
g.localStorage = dom.window.localStorage;
g.HTMLElement = dom.window.HTMLElement;
g.HTMLInputElement = dom.window.HTMLInputElement;
g.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
g.HTMLSelectElement = dom.window.HTMLSelectElement;
g.Node = dom.window.Node;
g.Event = dom.window.Event;
g.CustomEvent = dom.window.CustomEvent;
g.MouseEvent = dom.window.MouseEvent;
g.getComputedStyle = dom.window.getComputedStyle;
g.requestAnimationFrame = (cb: (t: number) => void) => setTimeout(() => cb(Date.now()), 0);
g.cancelAnimationFrame = (id: ReturnType<typeof setTimeout>) => clearTimeout(id);
if (!g.navigator) g.navigator = dom.window.navigator;
g.IS_REACT_ACT_ENVIRONMENT = true;

const SCHOOL = "cmt1e8bjp0jo8lcjeketlynhl";
const FAMILY = "cmt7tn8nj007silmlb7vyaqs4";
const RECEIPT = "PAY-20261006-LENTSWEOMAATLAOTENG-001";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const net = {
  posts: [] as Array<Record<string, any>>,
  statusCalls: [] as string[],
  onPost: (_body: Record<string, any>): Promise<Response> | Response => jsonResponse({}),
  onStatus: (_key: string): Promise<Response> | Response => jsonResponse({ success: true, found: false }),
};

g.fetch = async (input: unknown, init: RequestInit = {}) => {
  const url = String(input);
  const method = String(init.method || "GET").toUpperCase();
  if (method === "POST" && /\/api\/payments$/.test(url)) {
    const body = JSON.parse(String(init.body || "{}"));
    net.posts.push(body);
    return net.onPost(body);
  }
  const attempt = url.match(/\/api\/payments\/attempts\/([^/?#]+)/);
  if (attempt && method === "GET") {
    const key = decodeURIComponent(attempt[1]);
    net.statusCalls.push(key);
    return net.onStatus(key);
  }
  return jsonResponse({ success: true, data: [], payments: [], invoices: [], openInvoices: [], entries: [] });
};

let passed = 0;
async function test(name: string, fn: () => Promise<void>) {
  await fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

function savedPaymentBody(key: string) {
  return {
    success: true,
    duplicate: false,
    allocationSaved: true,
    payment: {
      id: `pay-${key}`,
      reference: RECEIPT,
      type: "payment",
      amount: 1400,
      date: "2026-10-06",
      accountNo: "LENTSWE OMAATLA OTENG",
      method: "Bank Transfer",
    },
    balance: 0,
    openInvoices: [],
    ledgerEntries: [],
  };
}

function foundStatus(key: string) {
  return jsonResponse({
    success: true,
    found: true,
    payment: { id: `pay-${key}`, reference: RECEIPT, amount: 1400, date: "2026-10-06", method: "Bank Transfer", createdAt: "" },
    allocationSaved: true,
  });
}

async function main() {
  const React = await import("react");
  const { act } = React;
  const { createRoot } = await import("react-dom/client");
  const { default: PaymentCreateClean } = await import("./PaymentCreateClean");
  const flow = await import("./paymentSaveFlow");
  const attemptStore = await import("./paymentAttemptStore");

  flow.paymentReconcileTiming.afterSaveDelaysMs = [0, 0, 0];
  flow.paymentReconcileTiming.onOpenDelaysMs = [0];

  const savedEvents: Array<{ paymentId: string; receiptNumber: string }> = [];
  let backClicks = 0;

  const account = {
    id: FAMILY,
    learnerId: "",
    accountNo: "LEN003",
    name: "Lentswe",
    surname: "Oteng",
    balance: 1400,
    familyAccountId: FAMILY,
    eduClearAccountNo: "LEN003",
    sourceAccountRef: "LENTSWE OMAATLA OTENG",
  };
  const form = {
    accountNo: "LEN003",
    learnerId: "",
    date: "2026-10-06",
    type: "Bank Transfer",
    description: "Payment",
    amount: "1400",
    message: "",
  };

  const flush = async (ms = 0) => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    });
  };

  let container = document.getElementById("root")!;
  let root: ReturnType<typeof createRoot>;
  const mount = async () => {
    container.remove();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        React.createElement(PaymentCreateClean, {
          schoolId: SCHOOL,
          selectedAccount: { ...account },
          paymentForm: { ...form },
          onPaymentFormChange: () => {},
          onBack: () => {
            backClicks += 1;
          },
          onSaved: (r: { paymentId: string; receiptNumber: string }) => {
            savedEvents.push(r);
          },
        })
      );
    });
    await flush(20);
  };
  const unmount = async () => {
    await act(async () => root.unmount());
  };

  const button = (label: string) => {
    const el = Array.from(container.querySelectorAll("button")).find(
      (b) => (b.textContent || "").trim() === label
    ) as HTMLButtonElement | undefined;
    assert(Boolean(el), `button "${label}" not found`);
    return el!;
  };
  const hasButton = (text: string) =>
    Array.from(container.querySelectorAll("button")).some((b) => (b.textContent || "").includes(text));
  const saveButton = () =>
    Array.from(container.querySelectorAll("button")).find((b) =>
      /^(Save Payment|Saving…|Checking…|Saved ✓)$/.test((b.textContent || "").trim())
    ) as HTMLButtonElement;
  const click = async (el: HTMLButtonElement) => {
    await act(async () => {
      el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    });
    await flush(10);
  };
  const notice = () => container.querySelector("[data-testid='payment-save-notice']")?.textContent || "";
  const pageText = () => container.textContent || "";
  const pending = () => attemptStore.listPendingPaymentAttempts();
  const reset = () => {
    net.posts.length = 0;
    net.statusCalls.length = 0;
    savedEvents.length = 0;
    backClicks = 0;
    localStorage.removeItem(attemptStore.PENDING_PAYMENT_ATTEMPTS_STORAGE_KEY);
  };

  await test("normal save: one POST, receipt flow fires, attempt cleared", async () => {
    reset();
    net.onPost = (body) => jsonResponse(savedPaymentBody(body.idempotencyKey));
    await mount();
    await click(saveButton());
    await flush(20);
    assert(net.posts.length === 1, `one POST (got ${net.posts.length})`);
    assert(net.statusCalls.length === 0, "no status checks on normal success");
    assert(net.posts[0].familyAccountId === FAMILY && net.posts[0].amount === 1400, "payload unchanged");
    assert(savedEvents.length === 1 && savedEvents[0].receiptNumber === RECEIPT, "onSaved receipt flow");
    assert(pending().length === 0, "attempt cleared");
    assert(!notice(), "no interruption notice");
    await unmount();
  });

  await test("lost response: no raw 'Failed to fetch', Back locked while checking, confirmed, no 2nd POST", async () => {
    reset();
    net.onPost = () => {
      throw new TypeError("Failed to fetch");
    };
    const gate = deferred<Response>();
    net.onStatus = () => gate.promise;
    await mount();
    await click(saveButton());
    await flush(20);

    assert(notice().includes("Connection interrupted. This payment may already have been saved."), `notice: ${notice()}`);
    assert(!pageText().includes("Failed to fetch"), "raw browser error never shown");
    assert(button("Back").disabled, "Back disabled during reconciliation");
    assert(saveButton().disabled, "Save disabled during reconciliation");
    await click(button("Back"));
    assert(backClicks === 0, "Back cannot navigate while checking");
    assert(pending().length === 1, "attempt persisted while uncertain");

    const key = net.posts[0].idempotencyKey;
    gate.resolve(foundStatus(key));
    await flush(30);

    assert(notice().includes(`Payment confirmed — receipt ${RECEIPT}`), `confirmed: ${notice()}`);
    assert(net.posts.length === 1, "NO second POST");
    assert(net.statusCalls[0] === key, "status checked with the original key");
    assert(savedEvents.length === 1 && savedEvents[0].paymentId === `pay-${key}`, "normal receipt flow after confirmation");
    assert(pending().length === 0, "attempt cleared after confirmation");
    assert(!button("Back").disabled, "Back re-enabled");
    await unmount();
  });

  await test("status unavailable: warning, Save blocked, attempt kept, Check payment status offered", async () => {
    reset();
    net.onPost = () => {
      throw new TypeError("Failed to fetch");
    };
    net.onStatus = () => {
      throw new TypeError("Failed to fetch");
    };
    await mount();
    await click(saveButton());
    await flush(30);
    assert(notice().includes("EduClear can't confirm the payment right now. Do not capture this payment again."), `notice: ${notice()}`);
    assert(saveButton().disabled, "Save blocked");
    assert(!button("Back").disabled, "Back allowed once checks stop");
    assert(Boolean(button("Check payment status")), "manual check offered");
    assert(!hasButton("Dismiss"), "no Dismiss path while unknown");
    assert(pending().length === 1, "attempt persisted");
    assert(net.posts.length === 1 && net.statusCalls.length === 3, "one POST, three status checks");
    assert(!pageText().includes("Failed to fetch"), "raw browser error never shown");
    await unmount();
  });

  await test("unknown cannot be bypassed: reopen while still unknown keeps Save blocked and the same key", async () => {
    const key = pending()[0]?.idempotencyKey;
    assert(Boolean(key), "pending attempt from previous test survives remount");
    net.posts.length = 0;
    net.statusCalls.length = 0;
    net.onStatus = () => {
      throw new TypeError("Failed to fetch");
    };
    await mount();
    await flush(30);
    assert(notice().includes("EduClear can't confirm the payment right now."), `notice: ${notice()}`);
    assert(saveButton().disabled, "Save still blocked after reopen");
    assert(!hasButton("Dismiss"), "no Dismiss path");
    await click(saveButton());
    assert(net.posts.length === 0, "blocked Save sends nothing");
    assert(pending().length === 1 && pending()[0].idempotencyKey === key, "same protected key retained");
    await unmount();
  });

  await test("reopen after unknown: status checked first, found → confirmed, no capture", async () => {
    const key = pending()[0]?.idempotencyKey;
    assert(Boolean(key), "pending attempt from previous test survives remount");
    net.posts.length = 0;
    net.statusCalls.length = 0;
    net.onStatus = (k) => foundStatus(k);
    await mount();
    await flush(30);
    assert(net.statusCalls[0] === key, "status checked on open with persisted key");
    assert(net.posts.length === 0, "no POST on open");
    assert(notice().includes(`Payment confirmed — receipt ${RECEIPT}`), `notice: ${notice()}`);
    assert(pending().length === 0, "attempt cleared");
    assert(!saveButton().disabled, "Save available after confirmation");
    await unmount();
  });

  await test("status NOT FOUND after interruption: safe Save again reuses SAME key → one payment", async () => {
    reset();
    net.onPost = () => {
      throw new TypeError("Failed to fetch");
    };
    net.onStatus = () => jsonResponse({ success: true, found: false });
    await mount();
    await click(saveButton());
    await flush(30);
    assert(notice().includes("Payment not found yet. You can safely retry — EduClear will reuse the same payment attempt"), `notice: ${notice()}`);
    assert(pending().length === 1, "protected attempt kept after not found");
    assert(!saveButton().disabled, "Save available");
    net.onPost = (body) => jsonResponse(savedPaymentBody(body.idempotencyKey));
    await click(saveButton());
    await flush(20);
    assert(net.posts.length === 2, "second press POSTs once");
    assert(net.posts[0].idempotencyKey === net.posts[1].idempotencyKey, "same key reused");
    assert(savedEvents.length === 1, "one saved payment");
    assert(pending().length === 0, "attempt cleared");
    await unmount();
  });

  await test("reopen with an unresolved earlier attempt: info only, no Dismiss, attempt never deleted", async () => {
    reset();
    const seeded = attemptStore.getOrCreatePendingPaymentAttempt(
      attemptStore.buildPaymentAttemptIdentity({
        schoolId: SCHOOL,
        familyAccountId: FAMILY,
        amount: 950,
        date: "2026-10-05",
        method: "Cash",
      })!
    );
    net.onStatus = () => jsonResponse({ success: true, found: false });
    await mount();
    await flush(20);
    const info = container.querySelector("[data-testid='payment-unsaved-attempts']")?.textContent || "";
    assert(info.includes("Payment not found yet") && info.includes("2026-10-05") && info.includes("Cash"), `info: ${info}`);
    assert(net.posts.length === 0, "no POST on open");
    assert(!saveButton().disabled, "Save available");
    assert(!hasButton("Dismiss"), "no Dismiss action offered");
    assert(Boolean(button("Check payment status")), "read-only re-check offered");
    await click(button("Check payment status"));
    await flush(20);
    assert(pending().length === 1 && pending()[0].idempotencyKey === seeded.idempotencyKey, "attempt retained after re-check");
    await unmount();
    await mount();
    await flush(20);
    assert(pending().length === 1 && pending()[0].idempotencyKey === seeded.idempotencyKey, "attempt retained across reopen");
    await unmount();
    localStorage.removeItem(attemptStore.PENDING_PAYMENT_ATTEMPTS_STORAGE_KEY);
  });

  /** Idempotent server model: one payment + one allocation set per key, like appendSchoolEntrySafe. */
  const serverModel = () => {
    const payments = new Map<string, Record<string, any>>();
    const allocations = new Map<string, number>();
    const write = (body: Record<string, any>) => {
      const key = String(body.idempotencyKey);
      const duplicate = payments.has(key);
      if (!duplicate) {
        payments.set(key, body);
        allocations.set(key, Array.isArray(body.allocationLines) ? body.allocationLines.length : 0);
      }
      return jsonResponse({ ...savedPaymentBody(key), duplicate });
    };
    const status = (key: string) =>
      payments.has(key) ? foundStatus(key) : jsonResponse({ success: true, found: false });
    return { payments, allocations, write, status };
  };

  const startPostThenRefresh = async (server: ReturnType<typeof serverModel>) => {
    // Original POST is still waiting on the server (e.g. ledger lock) when the page is refreshed.
    net.onPost = () => new Promise<Response>(() => {});
    net.onStatus = (k) => server.status(k);
    await mount();
    await click(saveButton());
    await flush(10);
    const key = String(net.posts[0]?.idempotencyKey || "");
    assert(Boolean(key), "original POST sent");
    assert(pending().length === 1 && pending()[0].idempotencyKey === key, "attempt stored before response");
    await unmount();
    await mount();
    await flush(30);
    return key;
  };

  await test("race: reopen while original POST pending → found:false keeps key; original lands; re-check finds it", async () => {
    reset();
    const server = serverModel();
    const key = await startPostThenRefresh(server);
    const info = container.querySelector("[data-testid='payment-unsaved-attempts']")?.textContent || "";
    assert(info.includes("Payment not found yet"), `early not-found shown: ${info}`);
    assert(net.statusCalls.includes(key), "status checked with the protected key");
    assert(!hasButton("Dismiss"), "no Dismiss action");
    assert(pending().length === 1 && pending()[0].idempotencyKey === key, "protected attempt still stored");

    server.write(net.posts[0]); // original request finally writes on the server
    await click(button("Check payment status"));
    await flush(20);
    assert(notice().includes(`Payment confirmed — receipt ${RECEIPT}`), `confirmed: ${notice()}`);
    assert(pending().length === 0, "cleared only once found");
    assert(net.posts.length === 1, "no second POST");
    assert(server.payments.size === 1 && server.allocations.get(key) === 1, "one payment, one allocation set");
    await unmount();
  });

  await test("race: retry of identical details after early found:false reuses SAME key → one payment", async () => {
    reset();
    const server = serverModel();
    const key = await startPostThenRefresh(server);
    assert(!saveButton().disabled, "Save available after not-found");

    server.write(net.posts[0]); // original lands while the operator is about to retry
    net.onPost = (body) => server.write(body);
    await click(saveButton());
    await flush(20);
    assert(net.posts.length === 2, "retry POSTed once");
    assert(net.posts[1].idempotencyKey === key, "retry reused the protected key");
    assert(server.payments.size === 1, `one ledger payment (got ${server.payments.size})`);
    assert(server.allocations.get(key) === 1, "one allocation set");
    assert(pending().length === 0, "cleared after confirmed success");
    assert(!container.querySelector("[data-testid='payment-unsaved-attempts']"), "resolved attempt banner cleared");
    await unmount();
  });

  await test("HTTP 400 shows the readable server message; no status checks", async () => {
    reset();
    net.onPost = () => jsonResponse({ success: false, error: "Payment date must be yyyy-MM-dd" }, 400);
    await mount();
    await click(saveButton());
    await flush(20);
    const alert = container.querySelector("[role='alert']")?.textContent || "";
    assert(alert.includes("Payment date must be yyyy-MM-dd"), `alert: ${alert}`);
    assert(net.statusCalls.length === 0, "no reconciliation for a definitive rejection");
    assert(pending().length === 0, "pre-write rejection clears attempt");
    await unmount();
  });

  await test("malformed 2xx response gets its own message and is reconciled", async () => {
    reset();
    net.onPost = () => new Response("<html>proxy</html>", { status: 200 });
    net.onStatus = (k) => foundStatus(k);
    await mount();
    await click(saveButton());
    await flush(30);
    assert(net.statusCalls.length >= 1, "status checked");
    assert(notice().includes(`Payment confirmed — receipt ${RECEIPT}`), `notice: ${notice()}`);
    assert(net.posts.length === 1, "no second POST");
    await unmount();
  });

  await test("LEN003 display unaffected", async () => {
    reset();
    await mount();
    assert(pageText().includes("LEN003"), "LEN003 still displayed");
    await unmount();
  });

  console.log(`PaymentCreateClean.responseLoss: ${passed} passed`);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
