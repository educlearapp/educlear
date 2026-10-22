/**
 * Communication Settings → SMS: Replace API Key flow (mocked API; no SMS sent).
 * Run: TSX_TSCONFIG_PATH=tsconfig.app.json node --import tsx src/communication/communicationSettingsSmsReplace.test.ts
 */
import assert from "assert";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body><div id=root></div></body></html>", {
  url: "http://localhost/",
});
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
const { default: CommunicationSettings } = await import("./CommunicationSettings");

const SCHOOL_ID = "school-sample";

const failedSmsSettings = {
  schoolId: SCHOOL_ID,
  provider: "WinSMS",
  apiKeySet: true,
  configured: true,
  connectionStatus: "failed",
  creditBalance: null,
  creditBalanceCheckedAt: null,
  connectionTestedAt: "2026-09-23T00:00:00.000Z",
  lastConnectionError: "The WinSMS API Key supplied in the 'AUTHORIZATION' header is invalid.",
  ready: false,
};

const savedSmsSettings = {
  ...failedSmsSettings,
  connectionStatus: "not_configured",
  lastConnectionError: null,
  creditBalanceCheckedAt: null,
  connectionTestedAt: null,
  ready: false,
};

const connectedSmsSettings = {
  ...failedSmsSettings,
  connectionStatus: "connected",
  creditBalance: 321,
  creditBalanceCheckedAt: "2026-10-22T00:00:00.000Z",
  connectionTestedAt: "2026-10-22T00:00:00.000Z",
  lastConnectionError: null,
  ready: true,
};

const communicationSettings = {
  sendViaEduClearDomain: true,
  administrationEmail: "",
  administrationCcSelf: false,
  billingEmail: "",
  billingCcSelf: false,
  signature: "",
  standardEmailSubject: "",
  standardEmailMessage: "",
  standardSmsMessage: "",
  smsProvider: "WinSMS",
  winSmsUsername: "school@example.test",
  winSmsPassword: "",
  winSmsPasswordSet: false,
};

type CapturedCall = { url: string; method: string; body: Record<string, unknown> | null };
const calls: CapturedCall[] = [];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

g.fetch = async (url: string, init?: RequestInit) => {
  const method = String(init?.method || "GET").toUpperCase();
  let body: Record<string, unknown> | null = null;
  if (typeof init?.body === "string") {
    try {
      body = JSON.parse(init.body) as Record<string, unknown>;
    } catch {
      body = null;
    }
  }
  calls.push({ url: String(url), method, body });
  const u = String(url);

  if (u.includes("/api/school-sms-settings/test") && method === "POST") {
    return jsonResponse({
      success: true,
      message: "Connected to WinSMS. Available credits: 321",
      creditBalance: 321,
      settings: connectedSmsSettings,
    });
  }
  if (u.includes("/api/school-sms-settings/balance")) {
    return jsonResponse({ success: true, creditBalance: 0, settings: failedSmsSettings });
  }
  if (u.includes("/api/school-sms-settings") && method === "PUT") {
    return jsonResponse({ success: true, settings: savedSmsSettings });
  }
  if (u.includes("/api/school-sms-settings")) {
    return jsonResponse({ success: true, settings: failedSmsSettings });
  }
  if (u.includes("/api/school-email-settings")) {
    return jsonResponse({ success: false, error: "not configured" }, 500);
  }
  if (u.includes("/api/communication/settings")) {
    return jsonResponse({
      success: true,
      settings: communicationSettings,
      emailBalance: 0,
      smsCredits: 0,
      winSmsCredits: 0,
      schoolName: "Sample School",
      schoolEmail: "school@example.test",
    });
  }
  return jsonResponse({ success: false, error: "unmocked" }, 404);
};

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === text
  );
  assert.ok(btn, `button "${text}" present`);
  return btn as HTMLButtonElement;
}

async function flush() {
  for (let i = 0; i < 6; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
}

async function main() {
  const container = document.getElementById("root") as HTMLElement;
  const errors: unknown[] = [];
  const root = createRoot(container, {
    onUncaughtError: (e) => errors.push(e),
    onCaughtError: (e) => errors.push(e),
  });
  await act(async () => {
    root.render(
      React.createElement(CommunicationSettings, {
        schoolId: SCHOOL_ID,
        schoolName: "Sample School",
        schoolEmail: "school@example.test",
        initialTab: "sms",
      })
    );
  });
  await flush();
  assert.deepEqual(errors, [], "no render errors");

  const initialText = container.textContent || "";
  assert.ok(initialText.includes("Failed"), "failed status shown");
  assert.ok(initialText.includes("invalid"), "stored WinSMS error shown");
  assert.ok(initialText.includes("********"), "saved key shown only masked");
  assert.ok(!initialText.includes("old-secret"), "stored key value never displayed");

  // Saved-key view offers Replace, and no editable key input is shown yet.
  assert.equal(
    container.querySelector("#educlear-winsms-api-key"),
    null,
    "no key input until Replace is chosen"
  );
  await act(async () => buttonByText(container, "Replace API Key").click());
  await flush();

  const input = container.querySelector("#educlear-winsms-api-key") as HTMLInputElement | null;
  assert.ok(input, "replace input appears after Replace API Key");
  assert.equal(input.disabled, false, "replace input is not disabled");
  assert.equal(input.readOnly, false, "replace input is not readOnly");

  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")
    ?.set;
  assert.ok(setter, "input value setter available");
  await act(async () => {
    setter.call(input, "replacement-key-123");
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
  assert.equal(input.value, "replacement-key-123", "replace input accepts typed input");

  calls.length = 0;
  await act(async () => buttonByText(container, "Test Connection").click());
  await flush();
  assert.deepEqual(errors, [], "no errors during test connection");

  const saveCall = calls.find(
    (c) => c.method === "PUT" && c.url.includes("/api/school-sms-settings")
  );
  assert.ok(saveCall, "replacement key saved before testing");
  assert.equal(saveCall.body?.apiKey, "replacement-key-123", "typed replacement key is saved");

  const testCall = calls.find(
    (c) => c.method === "POST" && c.url.includes("/api/school-sms-settings/test")
  );
  assert.ok(testCall, "connection test called");
  assert.ok(
    !testCall.body || !("apiKey" in testCall.body),
    "connection test uses the stored key (no override), so Connected persists"
  );

  const finalText = container.textContent || "";
  assert.ok(finalText.includes("Connected"), "connected status shown after successful test");
  assert.ok(finalText.includes("321"), "mocked WinSMS credit balance shown");
  assert.ok(!finalText.includes("replacement-key-123"), "typed key never rendered back");

  await act(async () => root.unmount());
  console.log("✓ Replace API Key: input accepts typing, saves, tests stored key, shows Connected");
  console.log("\nAll Communication Settings SMS replace tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
