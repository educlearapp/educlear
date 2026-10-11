/**
 * Outstanding Fees screen — Phone column regression test.
 * Renders the real OutstandingAccountsReport in jsdom against a mocked API response.
 * Run: TSX_TSCONFIG_PATH=tsconfig.app.json node --import tsx src/billing/OutstandingAccountsReport.phone.test.ts
 */
import { createRequire, register } from "node:module";

register(
  "data:text/javascript," +
    encodeURIComponent(
      "export async function load(url, context, next) {" +
        " if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };" +
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
g.HTMLSelectElement = dom.window.HTMLSelectElement;
g.Node = dom.window.Node;
g.Event = dom.window.Event;
g.MouseEvent = dom.window.MouseEvent;
g.getComputedStyle = dom.window.getComputedStyle;
g.requestAnimationFrame = (cb: (t: number) => void) => setTimeout(() => cb(Date.now()), 0);
g.cancelAnimationFrame = (id: ReturnType<typeof setTimeout>) => clearTimeout(id);
if (!g.navigator) g.navigator = dom.window.navigator;
g.IS_REACT_ACT_ENVIRONMENT = true;

function account(partial: Record<string, unknown>) {
  return {
    familyAccountId: partial.accountRef,
    accountNumber: partial.accountRef,
    learnerNames: ["Learner"],
    memberLearnerIds: [String(partial.accountRef)],
    grades: ["Grade 4"],
    classes: [],
    classLabels: ["Grade 4A"],
    outstandingBalance: 100,
    parentGuardianName: "Parent",
    primaryCellphone: null,
    alternateContact: null,
    email: null,
    lastPaymentDate: null,
    lastPaymentAmount: null,
    daysOverdue: 30,
    oldestDueDate: null,
    ...partial,
  };
}

const ACCOUNTS = [
  account({ accountRef: "ZERO", outstandingBalance: 1500, primaryCellphone: "0821234567" }),
  account({ accountRef: "INTL", outstandingBalance: 900.5, primaryCellphone: "+27 82 123 4567" }),
  account({ accountRef: "NONE", outstandingBalance: 200, primaryCellphone: null }),
  account({ accountRef: "BLANK", outstandingBalance: 100, primaryCellphone: "   " }),
  account({ accountRef: "OTHER", outstandingBalance: 50, classLabels: ["Grade 5B"], primaryCellphone: "0839999999" }),
];
const TOTAL = 2750.5;

g.fetch = async (input: unknown) => {
  const url = String(input);
  if (url.includes("/api/outstanding-accounts")) {
    return new Response(
      JSON.stringify({
        success: true,
        accounts: ACCOUNTS,
        summary: { totalOutstanding: TOTAL, outstandingAccountCount: ACCOUNTS.length, learnersAffected: ACCOUNTS.length },
        classOptions: ["Grade 4A", "Grade 5B"],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }
  return new Response(JSON.stringify({ success: true }), { status: 200 });
};

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

async function main() {
  const React = await import("react");
  const { act } = React;
  const { createRoot } = await import("react-dom/client");
  const { default: OutstandingAccountsReport } = await import("./OutstandingAccountsReport");
  const { formatMoney } = await import("./billingLedger");

  const container = document.getElementById("root")!;
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(OutstandingAccountsReport, { schoolId: "test-school", schoolName: "EduClear Test School" }));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });

  const tables = Array.from(container.querySelectorAll("table"));
  assert(tables.length === 2, `expected one table per class section, got ${tables.length}`);
  for (const table of tables) {
    const headers = Array.from(table.querySelectorAll("thead th")).map((th) => th.textContent || "");
    const parentIdx = headers.indexOf("Parent / Guardian");
    assert(parentIdx >= 0, "Parent / Guardian header present");
    assert(headers[parentIdx + 1] === "Phone", `Phone header directly after Parent / Guardian (got ${headers.join(", ")})`);
    assert(!headers.includes("Cellphone"), "old Cellphone header label replaced");
  }
  console.log("  ok - Phone column header rendered after Parent / Guardian");

  const headers = Array.from(tables[0].querySelectorAll("thead th")).map((th) => th.textContent || "");
  const phoneIdx = headers.indexOf("Phone");
  const phoneFor = (accountRef: string) => {
    const tr = Array.from(container.querySelectorAll("tbody tr")).find((r) =>
      Array.from(r.querySelectorAll("td")).some((td) => td.textContent === accountRef)
    );
    assert(Boolean(tr), `row for ${accountRef}`);
    return tr!.querySelectorAll("td")[phoneIdx].textContent;
  };
  assert(phoneFor("ZERO") === "0821234567", "leading-zero phone shown on screen");
  assert(phoneFor("INTL") === "+27 82 123 4567", "+27 phone shown on screen");
  assert(phoneFor("OTHER") === "0839999999", "phone shown in second class section");
  console.log("  ok - phone numbers appear on screen");

  assert(phoneFor("NONE") === "—", "missing phone renders as —");
  assert(phoneFor("BLANK") === "—", "blank phone renders as —");
  const bodyText = container.textContent || "";
  assert(!/\bnull\b|\bundefined\b/.test(bodyText), "no raw null/undefined rendered");
  console.log("  ok - missing phone renders as —");

  assert(bodyText.includes(`Class Total: ${formatMoney(2700.5)}`), "Grade 4A class total unchanged");
  assert(bodyText.includes(`Class Total: ${formatMoney(50)}`), "Grade 5B class total unchanged");
  assert(bodyText.includes("GRAND TOTAL") && bodyText.includes(formatMoney(TOTAL)), "grand total unchanged");
  assert(!bodyText.includes("Class totals do not reconcile"), "reconciliation still OK");
  console.log("  ok - class and grand totals unchanged");

  await act(async () => root.unmount());
  console.log("\nAll OutstandingAccountsReport phone tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
