/**
 * Local Postgres proof for outstanding-fees reminder reservations.
 * Refuses to run unless DATABASE_URL is localhost. Sends no SMS.
 * Run: node --import ../frontend/node_modules/tsx/dist/loader.mjs src/services/outstandingFeesReminderSms.lock.localdb.test.ts
 */
import "dotenv/config";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { WinSmsApiError } from "./winSmsClient";
import {
  NEW_CAMPAIGN_AUTHORIZATION_TEXT,
  sendOutstandingFeesReminder,
  type ReminderAccountSnapshot,
} from "./outstandingFeesReminderSms";

const SCHOOL = "ofee-lock-local-school";
const OTHER = "ofee-lock-other-school";
const TEMPLATE = "Please pay {{amount}} for account {{accountNo}} at {{schoolName}}.";
const INSTANCE = "12121212-1212-4212-8212-121212121212";

function assertLocalDatabase() {
  const raw = String(process.env.DATABASE_URL || "");
  let host = "";
  try {
    host = new URL(raw).hostname;
  } catch {
    host = "";
  }
  if (host !== "localhost" && host !== "127.0.0.1") {
    throw new Error("Refusing to run: DATABASE_URL is not a local database.");
  }
}

function snap(partial: Partial<ReminderAccountSnapshot> & Pick<ReminderAccountSnapshot, "familyAccountId">): ReminderAccountSnapshot {
  return {
    accountNo: partial.accountNo || "L1",
    schoolName: "Local School",
    balance: partial.balance ?? 150,
    displayName: "Local Parent",
    mobileNumber: partial.mobileNumber || "27821110000",
    mobileMasked: "•••• 0000",
    familyAccountId: partial.familyAccountId,
  };
}

function resolver(rows: Record<string, ReminderAccountSnapshot>) {
  return async (schoolId: string, familyAccountId: string) => rows[`${schoolId}:${familyAccountId}`] ?? null;
}

async function cleanup(prisma: PrismaClient) {
  await prisma.outstandingFeesReminderRecipient.deleteMany({ where: { schoolId: { in: [SCHOOL, OTHER] } } });
  await prisma.outstandingFeesReminderCampaign.deleteMany({ where: { schoolId: { in: [SCHOOL, OTHER] } } });
}

function lastJsonLine(text: string): string {
  const lines = text.split("\n").map((line) => line.trim()).filter((line) => line.startsWith("{"));
  return lines[lines.length - 1] || "";
}

function runChild(role: string, extra: string[] = []): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "../frontend/node_modules/tsx/dist/loader.mjs", "src/services/outstandingFeesReminderSms.lock.localdb.test.ts", `--${role}`, ...extra],
      { cwd: process.cwd(), env: process.env, stdio: ["ignore", "pipe", "pipe"] }
    );
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => {
      out += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      err += String(chunk);
    });
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(err || out || `child ${role} failed`));
      else resolve(out.trim());
    });
  });
}

async function holder(readyFile: string, releaseFile: string) {
  const rows = { [`${SCHOOL}:fa-1`]: snap({ familyAccountId: "fa-1", mobileNumber: "27821110001", accountNo: "L1" }) };
  const sent = await sendOutstandingFeesReminder({
    schoolId: SCHOOL,
    familyAccountIds: ["fa-1"],
    sendInstanceId: INSTANCE,
    messageTemplate: TEMPLATE,
    now: new Date("2026-11-06T12:00:00.000Z"),
    deps: {
      resolveAccount: resolver(rows),
      smsReady: async () => true,
      outboundDisabled: false,
      sendSms: async (_schoolId, input) => {
        fs.writeFileSync(readyFile, "ready");
        const started = Date.now();
        while (!fs.existsSync(releaseFile)) {
          if (Date.now() - started > 15000) throw new Error("holder release timed out");
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        assert.equal(input.message, "Please pay R150 for account L1 at Local School.");
        return { recipients: [{ accepted: true }] };
      },
    },
  });
  console.log(JSON.stringify({ role: "holder", ok: sent.ok, accepted: sent.ok ? sent.accepted : 0, code: sent.ok ? "" : sent.code }));
}

async function racer() {
  const rows = { [`${SCHOOL}:fa-1`]: snap({ familyAccountId: "fa-1", mobileNumber: "27821110001", accountNo: "L1" }) };
  const sent = await sendOutstandingFeesReminder({
    schoolId: SCHOOL,
    familyAccountIds: ["fa-1"],
    sendInstanceId: INSTANCE,
    messageTemplate: TEMPLATE,
    now: new Date("2026-11-06T12:00:01.000Z"),
    deps: {
      resolveAccount: resolver(rows),
      smsReady: async () => true,
      outboundDisabled: false,
      sendSms: async () => {
        throw new Error("second process must not call the provider");
      },
    },
  });
  console.log(JSON.stringify({ role: "racer", ok: sent.ok, code: sent.ok ? "" : sent.code }));
}

async function reader(phone: string) {
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.outstandingFeesReminderCampaign.findMany({
      where: { schoolId: SCHOOL },
      include: { recipients: true },
    });
    const blob = JSON.stringify(rows);
    const first = rows.find((row) => row.sendInstanceId === INSTANCE);
    console.log(
      JSON.stringify({
        role: "reader",
        count: rows.filter((row) => row.sendInstanceId === INSTANCE).length,
        state: first?.state || "",
        template: first?.messageTemplate || "",
        status: first?.recipients[0]?.status || "",
        rawAbsent: !blob.includes(phone),
      })
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  assertLocalDatabase();
  const role = process.argv.find((arg) => arg.startsWith("--"));
  if (role === "--holder") {
    await holder(process.argv[process.argv.indexOf("--holder") + 1], process.argv[process.argv.indexOf("--holder") + 2]);
    return;
  }
  if (role === "--racer") {
    await racer();
    return;
  }
  if (role === "--reader") {
    await reader(process.argv[process.argv.indexOf("--reader") + 1]);
    return;
  }

  const prisma = new PrismaClient();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ofee-lock-"));
  const readyFile = path.join(dir, "ready");
  const releaseFile = path.join(dir, "release");
  try {
    await cleanup(prisma);
    const holderPromise = runChild("holder", [readyFile, releaseFile]);
    const started = Date.now();
    while (!fs.existsSync(readyFile)) {
      if (Date.now() - started > 15000) throw new Error("holder did not reserve the campaign");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const raced = JSON.parse(lastJsonLine(await runChild("racer"))) as { ok: boolean; code: string };
    assert.equal(raced.ok, false);
    assert.equal(raced.code, "REMINDER_IN_PROGRESS");
    fs.writeFileSync(releaseFile, "go");
    const held = JSON.parse(lastJsonLine(await holderPromise)) as { ok: boolean; accepted: number };
    assert.equal(held.ok, true);
    assert.equal(held.accepted, 1);

    const readBack = JSON.parse(lastJsonLine(await runChild("reader", ["27821110001"]))) as {
      count: number;
      state: string;
      template: string;
      status: string;
      rawAbsent: boolean;
    };
    assert.equal(readBack.count, 1);
    assert.equal(readBack.state, "completed");
    assert.equal(readBack.template, TEMPLATE);
    assert.equal(readBack.status, "accepted");
    assert.equal(readBack.rawAbsent, true);

    const rows = {
      [`${SCHOOL}:fa-2`]: snap({ familyAccountId: "fa-2", accountNo: "L2", mobileNumber: "27821110002" }),
      [`${SCHOOL}:fa-3`]: snap({ familyAccountId: "fa-3", accountNo: "L3", mobileNumber: "27821110003" }),
    };
    let calls = 0;
    const partial = await sendOutstandingFeesReminder({
      schoolId: SCHOOL,
      familyAccountIds: ["fa-2", "fa-3"],
      sendInstanceId: "13131313-1313-4313-8313-131313131313",
      messageTemplate: TEMPLATE,
      authorizationText: NEW_CAMPAIGN_AUTHORIZATION_TEXT,
      now: new Date("2026-11-06T12:05:00.000Z"),
      deps: {
        resolveAccount: resolver(rows),
        smsReady: async () => true,
        outboundDisabled: false,
        sendSms: async (_schoolId, input) => {
          calls += 1;
          return { recipients: [{ accepted: input.mobileNumber.endsWith("2") }] };
        },
      },
    });
    assert.equal(partial.ok, true);
    if (partial.ok) {
      assert.equal(partial.accepted, 1);
      assert.equal(partial.failed, 1);
    }
    const timed = await sendOutstandingFeesReminder({
      schoolId: SCHOOL,
      familyAccountIds: ["fa-3"],
      sendInstanceId: "14141414-1414-4414-8414-141414141414",
      messageTemplate: TEMPLATE,
      authorizationText: NEW_CAMPAIGN_AUTHORIZATION_TEXT,
      now: new Date("2026-11-06T12:06:00.000Z"),
      deps: {
        resolveAccount: resolver(rows),
        smsReady: async () => true,
        outboundDisabled: false,
        sendSms: async () => {
          calls += 1;
          throw new WinSmsApiError("timeout", 408);
        },
      },
    });
    assert.equal(timed.ok, true);
    if (timed.ok) assert.equal(timed.pending, 1);
    const retry = await sendOutstandingFeesReminder({
      schoolId: SCHOOL,
      familyAccountIds: ["fa-2", "fa-3"],
      sendInstanceId: "15151515-1515-4515-8515-151515151515",
      messageTemplate: TEMPLATE,
      authorizationText: NEW_CAMPAIGN_AUTHORIZATION_TEXT,
      now: new Date("2026-11-06T12:07:00.000Z"),
      deps: {
        resolveAccount: resolver(rows),
        smsReady: async () => true,
        outboundDisabled: false,
        sendSms: async () => {
          calls += 1;
          throw new Error("must not retry accepted or unconfirmed numbers");
        },
      },
    });
    assert.equal(retry.ok, true);
    if (retry.ok) assert.equal(retry.providerCalled, false);
    assert.equal(calls, 3);

    const other = await sendOutstandingFeesReminder({
      schoolId: OTHER,
      familyAccountIds: ["fa-1"],
      sendInstanceId: "16161616-1616-4616-8616-161616161616",
      messageTemplate: TEMPLATE,
      now: new Date("2026-11-06T12:08:00.000Z"),
      deps: {
        resolveAccount: resolver(rows),
        smsReady: async () => true,
        outboundDisabled: false,
        sendSms: async () => {
          throw new Error("other school must not send");
        },
      },
    });
    assert.equal(other.ok, false);
    if (!other.ok) assert.equal(other.code, "NO_ELIGIBLE_DESTINATIONS");
    console.log("outstandingFeesReminderSms.lock.localdb.test.ts: OK");
  } finally {
    await cleanup(prisma);
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
