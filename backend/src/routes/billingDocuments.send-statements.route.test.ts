/**
 * Billing documents send-statements preview route.
 * Never sends email. simulate=true never returns Sent.
 * Run: npx ts-node --transpile-only src/routes/billingDocuments.send-statements.route.test.ts
 */
import assert from "assert";
import express from "express";
import http from "http";
import billingDocumentsRoutes, {
  BILLING_DOCUMENT_PREVIEW_STATUS,
  BILLING_DOCUMENT_WOULD_SEND_STATUS,
  mapBillingDocumentSendStatementResults,
} from "./billingDocuments";

function assertTrue(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

async function startServer() {
  const app = express();
  app.use(express.json());
  app.use("/api/billing-documents", billingDocumentsRoutes);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}

async function main() {
  const preview = mapBillingDocumentSendStatementResults(
    [{ contactName: "A", email: "a@example.test", accountNo: "ACC1" }],
    true
  );
  assertTrue(preview[0].status === BILLING_DOCUMENT_PREVIEW_STATUS, "simulate=true status is PREVIEW");
  assertTrue(preview.every((row) => String(row.status).toLowerCase() !== "sent"), "simulate=true NEVER returns Sent");

  const liveFlag = mapBillingDocumentSendStatementResults(
    [{ contactName: "A", email: "a@example.test", accountNo: "ACC1" }],
    false
  );
  assertTrue(liveFlag[0].status === BILLING_DOCUMENT_WOULD_SEND_STATUS, "simulate=false remains non-sending WOULD_SEND");
  assertTrue(liveFlag.every((row) => String(row.status).toLowerCase() !== "sent"), "simulate=false never Sent");

  const skipped = mapBillingDocumentSendStatementResults(
    [
      { contactName: "B", email: "", accountNo: "ACC2" },
      { contactName: "C", email: "c@example.test", accountNo: "-" },
    ],
    true
  );
  assertTrue(skipped[0].status === "SKIPPED", "missing email SKIPPED");
  assertTrue(skipped[1].status === "SKIPPED", "missing account SKIPPED");

  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    fetchCalls += 1;
    return originalFetch(...args);
  }) as typeof fetch;

  const { base, close } = await startServer();
  try {
    const res = await fetch(`${base}/api/billing-documents/send-statements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schoolId: "school-preview",
        simulate: true,
        contacts: [{ contactName: "A", email: "a@example.test", accountNo: "ACC1" }],
      }),
    });
    const json = (await res.json()) as { success: boolean; simulated: boolean; results: Array<{ status: string }> };
    assertTrue(res.status === 200, "preview HTTP 200");
    assertTrue(json.simulated === true, "simulated flag");
    assertTrue(json.results[0].status === "PREVIEW", "HTTP preview status");
    assertTrue(json.results.every((row) => String(row.status).toLowerCase() !== "sent"), "HTTP never Sent");
    assertTrue(fetchCalls === 1, "dry run never calls Resend (only the test HTTP post itself)");
  } finally {
    globalThis.fetch = originalFetch;
    await close();
  }

  console.log("billingDocuments.send-statements.route.test.ts: OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
