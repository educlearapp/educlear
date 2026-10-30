/**
 * Local DB integration: demo sendSchoolEmail never reaches Resend; real school path unchanged.
 *
 * Requires local DATABASE_URL (localhost). Uses mocked fetch for Resend — no real messages.
 *
 *   npx tsx src/services/demoTenantEmailSafety.integration.test.ts
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";

import { sendSchoolEmail } from "./schoolEmailService";
import { DEMO_NOT_DELIVERED_LABEL } from "./demoTenantSafety";

function assertLocalDb() {
  const url = String(process.env.DATABASE_URL || "");
  let host = "";
  try {
    host = new URL(url.replace(/^postgresql:/, "http:")).hostname;
  } catch {
    throw new Error("DATABASE_URL unparseable");
  }
  if (host !== "localhost" && host !== "127.0.0.1") {
    throw new Error(`REFUSED non-local host ${host}`);
  }
}

async function main() {
  assertLocalDb();
  const prisma = new PrismaClient();
  const stamp = Date.now();
  const demoId = `demo-email-gate-${stamp}-d`;
  const realId = `demo-email-gate-${stamp}-r`;
  let resendCalls = 0;
  const prevFetch = globalThis.fetch;
  const prevKey = process.env.RESEND_API_KEY;

  process.env.RESEND_API_KEY = "re_test_demo_gate_key";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("api.resend.com")) {
      resendCalls += 1;
      return new Response(JSON.stringify({ id: `re_mock_${resendCalls}` }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return prevFetch(input, init);
  }) as typeof fetch;

  try {
    await prisma.school.create({
      data: {
        id: demoId,
        name: `Demo Gate School ${stamp}`,
        email: `demo-gate-${stamp}@example.com`,
        isDemoTenant: true,
        lifecycleStatus: "ACTIVE",
      },
    });
    await prisma.school.create({
      data: {
        id: realId,
        name: `Real Gate School ${stamp}`,
        email: `real-gate-${stamp}@example.com`,
        isDemoTenant: false,
        lifecycleStatus: "ACTIVE",
      },
    });

    // Demo announcement-style send
    const demoResult = await sendSchoolEmail(demoId, {
      to: "prospect@example.com",
      subject: "Announcement",
      html: "<p>Hello</p>",
    });
    assert.equal((demoResult as { demoSimulated?: boolean }).demoSimulated, true);
    assert.equal((demoResult as { demoLabel?: string }).demoLabel, DEMO_NOT_DELIVERED_LABEL);
    assert.equal(resendCalls, 0, "demo send must not call Resend");

    // Demo admissions-style send
    await sendSchoolEmail(demoId, {
      to: "admissions-staff@example.com",
      subject: "New application",
      html: "<p>APP-2027-001</p>",
    });
    assert.equal(resendCalls, 0, "demo admissions email must not call Resend");

    // Demo statement-style send
    await sendSchoolEmail(demoId, {
      to: "parent@example.com",
      subject: "Statement",
      html: "<p>Balance</p>",
      attachments: [{ filename: "statement.pdf", content: Buffer.from("%PDF-1.4 demo"), contentType: "application/pdf" }],
    });
    assert.equal(resendCalls, 0, "demo statement email must not call Resend");

    // Real school — mocked Resend accepts; proves path still invokes provider
    const realResult = await sendSchoolEmail(realId, {
      to: "finance@example.com",
      subject: "Real school notice",
      html: "<p>Live path</p>",
    });
    assert.equal(resendCalls, 1, "real school must still call Resend (mocked)");
    assert.equal((realResult as { demoSimulated?: boolean }).demoSimulated, undefined);
    assert.ok(String((realResult as { messageId?: string }).messageId || "").startsWith("re_mock_"));

    // Demo cannot clear its own flag via school-scoped prisma update simulation:
    // school profile route never writes isDemoTenant; verify flag stays true after unrelated update.
    await prisma.school.update({
      where: { id: demoId },
      data: { phone: "0555010999" },
    });
    const stillDemo = await prisma.school.findUnique({
      where: { id: demoId },
      select: { isDemoTenant: true },
    });
    assert.equal(stillDemo?.isDemoTenant, true, "unrelated school update must not clear isDemoTenant");

    console.log("PASS demoTenantEmailSafety.integration");
    console.log(
      JSON.stringify({
        demoResendCalls: 0,
        realResendCalls: resendCalls,
        demoLabel: DEMO_NOT_DELIVERED_LABEL,
      })
    );
  } finally {
    globalThis.fetch = prevFetch;
    if (prevKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = prevKey;
    await prisma.school.deleteMany({ where: { id: { in: [demoId, realId] } } }).catch(() => undefined);
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("FAIL", err);
  process.exit(1);
});
