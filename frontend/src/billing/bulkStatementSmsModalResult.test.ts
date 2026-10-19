/**
 * Bulk Statement SMS modal — completion / result rendering (mocked responses; no SMS sent).
 * Run: TSX_TSCONFIG_PATH=tsconfig.app.json node --import tsx src/billing/bulkStatementSmsModalResult.test.ts
 */
import assert from "assert";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body><div id=root></div></body></html>", { url: "http://localhost/" });
const g = globalThis as Record<string, unknown>;
g.window = dom.window;
g.document = dom.window.document;
g.HTMLElement = dom.window.HTMLElement;
g.Node = dom.window.Node;
g.localStorage = dom.window.localStorage;
g.IS_REACT_ACT_ENVIRONMENT = true;

const React = (await import("react")).default;
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: BulkStatementSmsModal } = await import("./BulkStatementSmsModal");

const preview = {
  success: true,
  requestedAccountCount: 3,
  eligibleAccountCount: 3,
  skippedAccountCount: 0,
  destinationCount: 3,
  duplicateNumbersRemoved: 0,
  totalOutstanding: 3000,
  estimatedSegments: 1,
  recipientStrategy: "all_eligible",
  messageTemplate: "x",
  defaultMessageTemplate: "x",
  maxChars: 320,
  segmentChars: 160,
  sampleMessages: ["Sample message"],
  recipients: [{ displayName: "Parent (Fictitious)", mobileMasked: "•••• 0000", accountNo: "SAMPLE001" }],
  accounts: [],
  smsReady: true,
  outboundDisabled: false,
  canSend: true,
  concurrency: 4,
};

/** Shape returned by POST /api/statements/bulk-send-sms for a partial (207) outcome. */
const partialSend = {
  success: true,
  ok: true,
  status: 207,
  simulated: false,
  summary: "354 SMS sent. 8 SMS failed. 0 SMS not confirmed by WinSMS — check WinSMS sent history before resending these.",
  recipientStrategy: "all_eligible",
  requestedAccountCount: 133,
  eligibleAccountCount: 133,
  skippedAccountCount: 0,
  attemptedDestinations: 362,
  successfulDestinations: 354,
  failedDestinations: 8,
  unconfirmedDestinations: 3,
  concurrency: 4,
  skippedAccounts: [],
  results: [],
  accountResults: [],
};

const PENDING = Symbol("pending");

function mockFetch(sendBody: unknown, sendStatus: number, previewBody: unknown = preview) {
  g.fetch = async (url: string) => {
    const isPreview = String(url).includes("bulk-sms-preview");
    if (!isPreview && sendBody === PENDING) return new Promise<Response>(() => {});
    const body = isPreview ? previewBody : sendBody;
    const status = isPreview ? 200 : sendStatus;
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  };
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.trim() === text);
  assert.ok(btn, `button "${text}" present`);
  return btn as HTMLButtonElement;
}

async function flush() {
  for (let i = 0; i < 5; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
}

async function runToResult(sendBody: unknown, sendStatus: number, previewBody: unknown = preview, clickSend = true) {
  mockFetch(sendBody, sendStatus, previewBody);
  const container = document.getElementById("root") as HTMLElement;
  const errors: unknown[] = [];
  const onError = (e: ErrorEvent) => errors.push(e.error);
  window.addEventListener("error", onError);
  let closed = 0;
  let sent = 0;
  const caught: unknown[] = [];
  const root = createRoot(container, {
    onUncaughtError: (e) => errors.push(e),
    onCaughtError: (e) => caught.push(e),
  });
  await act(async () => {
    root.render(
      React.createElement(BulkStatementSmsModal, {
        schoolId: "school-sample",
        familyAccountIds: ["fa-1", "fa-2", "fa-3"],
        selectedCount: 3,
        selectedTotalOutstanding: 3000,
        onClose: () => {
          closed += 1;
        },
        onSent: () => {
          sent += 1;
        },
      })
    );
  });
  for (let i = 0; i < 3; i++) {
    await act(async () => buttonByText(container, "Continue").click());
  }
  await flush();
  const sendBtn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Send SMS");
  if (clickSend && sendBtn) await act(async () => sendBtn.click());
  await flush();
  window.removeEventListener("error", onError);
  return { container, root, errors, caught, closed: () => closed, sent: () => sent };
}

async function testPartialResultRendersSummaryAndClose() {
  const r = await runToResult(partialSend, 207);
  assert.deepEqual(r.errors, [], "no render errors");
  const text = r.container.textContent || "";
  assert.ok(text.includes("Send result"), "result step shown");
  assert.ok(text.includes("Recipients attempted: 362"), "attempted shown");
  assert.ok(text.includes("Accepted by WinSMS: 354"), "accepted shown");
  assert.ok(text.includes("Rejected or failed: 8"), "rejected shown");
  assert.ok(text.includes("Pending or not confirmed: 3"), "unconfirmed shown");
  assert.ok(text.includes("not a handset delivery receipt"), "acceptance is not delivery");
  assert.equal(r.sent(), 1, "onSent once");
  await act(async () => buttonByText(r.container, "Done").click());
  await act(async () => buttonByText(r.container, "Close").click());
  assert.equal(r.closed(), 2, "Done and Close both close the modal");
  await act(async () => r.root.unmount());
  console.log("✓ 207 partial result: summary, counts, Done and Close");
}

async function testUnexpectedBodyStillShowsResult() {
  const r = await runToResult({ ok: true, status: 207 }, 207);
  assert.deepEqual(r.errors, [], "no render errors");
  const text = r.container.textContent || "";
  assert.ok(text.includes("Send result"), "result step shown even without summary/counts");
  assert.ok(buttonByText(r.container, "Done"));
  await act(async () => r.root.unmount());
  console.log("✓ sparse 207 body still renders result with Done");
}

async function testMalformedBodyRendersSafeCounts() {
  const r = await runToResult(
    { ...partialSend, summary: { text: "object" }, successfulDestinations: { n: 1 }, failedDestinations: "8" },
    207
  );
  assert.deepEqual(r.errors, [], "malformed body does not crash the modal");
  const text = r.container.textContent || "";
  assert.ok(text.includes("Send result") && text.includes("Bulk SMS completed."), "falls back to a text summary");
  assert.ok(text.includes("Accepted by WinSMS: 0"), "non-numeric count shown as 0");
  assert.ok(text.includes("Rejected or failed: 8"), "numeric string count shown");
  await act(async () => r.root.unmount());
  console.log("✓ malformed 207 body: safe summary and counts, no crash");
}

async function testAcceptedBatchShowsSegmentsAndCredits() {
  const r = await runToResult(
    {
      success: true,
      ok: true,
      status: 200,
      summary: "Bulk SMS sent successfully to 60 destinations across 26 accounts.",
      attemptedDestinations: 60,
      successfulDestinations: 60,
      failedDestinations: 0,
      unconfirmedDestinations: 0,
      skippedAccountCount: 0,
      billedSegments: 240,
      creditsUsed: 240,
      maxMessageSegments: 4,
      results: [],
    },
    200
  );
  const text = r.container.textContent || "";
  assert.ok(text.includes("Send result"), "result step shown");
  assert.ok(text.includes("Accepted by WinSMS: 60"), "accepted count shown");
  assert.ok(text.includes("Rejected or failed: 0"), "rejected count shown");
  assert.ok(text.includes("not a handset delivery receipt"), "acceptance is not delivery");
  assert.ok(text.includes("SMS segments: 240"), "segments shown");
  assert.ok(text.includes("SMS credits: 240"), "credits shown");
  assert.ok(text.includes("Longest message: 4 segments"), "segment length shown");
  assert.ok((r.container.querySelector("[data-testid=bulk-sms-result]")?.textContent || "").trim().length > 40);
  await act(async () => r.root.unmount());
  console.log("✓ accepted batch shows recipients, segments and credits");
}

async function testEmptyResultIsNeverBlank() {
  const r = await runToResult({}, 200);
  const text = r.container.textContent || "";
  assert.ok(text.includes("Send result"));
  assert.ok(text.includes("Bulk SMS finished without a summary from the server."));
  assert.ok(text.includes("Accepted by WinSMS: 0"));
  assert.ok(text.includes("Done"));
  await act(async () => r.root.unmount());
  console.log("✓ empty server body still shows a result");
}

async function testBadSampleMessagesDoNotBlankTheDialog() {
  const r = await runToResult(PENDING, 207, { ...preview, sampleMessages: [{ not: "text" }] }, false);
  assert.deepEqual(r.errors, [], "bad sample messages do not crash the modal");
  assert.equal(r.caught.length, 0, "non-text samples are skipped");
  const text = r.container.textContent || "";
  assert.ok(text.includes("Final preview"), "preview stays visible");
  assert.ok(text.includes("Bulk Statement SMS"), "header still shown");
  assert.ok(text.trim().length > 40, "dialog is not blank");
  await act(async () => buttonByText(r.container, "Close").click());
  assert.equal(r.closed(), 1, "Close still works");
  await act(async () => r.root.unmount());
  console.log("✓ bad sample messages leave the dialog visible");
}

async function testSendingStateStaysVisible() {
  const r = await runToResult(PENDING, 207);
  assert.deepEqual(r.errors, []);
  assert.ok(r.container.textContent?.includes("Final preview"), "preview stays visible while sending");
  assert.ok(buttonByText(r.container, "Sending…").disabled, "send button shows Sending… and is disabled");
  await act(async () => r.root.unmount());
  console.log("✓ in-flight send keeps the preview visible");
}

await testPartialResultRendersSummaryAndClose();
await testUnexpectedBodyStillShowsResult();
await testMalformedBodyRendersSafeCounts();
await testAcceptedBatchShowsSegmentsAndCredits();
await testEmptyResultIsNeverBlank();
await testBadSampleMessagesDoNotBlankTheDialog();
await testSendingStateStaysVisible();
console.log("\nAll bulk SMS modal result tests passed.");
