/**
 * Local Postgres proof for outstanding-balance SMS reservations.
 * Refuses to run unless DATABASE_URL is localhost. Sends no SMS.
 * Run: node --import ../frontend/node_modules/tsx/dist/loader.mjs src/services/outstandingBalanceBulkSms.lock.localdb.test.ts
 */
import "dotenv/config";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { sendOutstandingBalanceSms, type BalanceSnapshot } from "./outstandingBalanceBulkSms";

const SCHOOL = "obal-lock-local-school";
const OTHER = "obal-lock-other-school";
const INSTANCE = "19191919-1919-4919-8919-191919191919";

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

function snap(partial: Partial<BalanceSnapshot> & Pick<BalanceSnapshot, "familyAccountId">): BalanceSnapshot {
  return {
    accountNo: partial.accountNo || "B1",
    schoolName: "Local School",
    balance: partial.balance ?? 80,
    familyAccountId: partial.familyAccountId,
    contacts: partial.contacts || [
      { mobileNumber: "27829990000", mobileMasked: "•••• 0000", displayName: "Local Parent" },
    ],
  };
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
      ["--import", "../frontend/node_modules/tsx/dist/loader.mjs", "src/services/outstandingBalanceBulkSms.lock.localdb.test.ts", `--${role}`, ...extra],
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
  const sent = await sendOutstandingBalanceSms({
    schoolId: SCHOOL,
    familyAccountIds: ["fa-1"],
    sendInstanceId: INSTANCE,
    now: new Date("2026-11-06T12:00:00.000Z"),
    deps: {
      resolveAccount: async () => snap({ familyAccountId: "fa-1", accountNo: "B1" }),
      smsReady: async () => true,
      outboundDisabled: false,
      sendSms: async () => {
        fs.writeFileSync(readyFile, "ready");
        const started = Date.now();
        while (!fs.existsSync(releaseFile)) {
          if (Date.now() - started > 15000) throw new Error("holder release timed out");
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        return { recipients: [{ accepted: true }] };
      },
    },
  });
  console.log(JSON.stringify({ role: "holder", ok: sent.ok, accepted: sent.ok ? sent.accepted : 0, code: sent.ok ? "" : sent.code }));
}

async function racer() {
  const sent = await sendOutstandingBalanceSms({
    schoolId: SCHOOL,
    familyAccountIds: ["fa-1"],
    sendInstanceId: INSTANCE,
    now: new Date("2026-11-06T12:00:01.000Z"),
    deps: {
      resolveAccount: async () => snap({ familyAccountId: "fa-1", accountNo: "B1" }),
      smsReady: async () => true,
      outboundDisabled: false,
      sendSms: async () => {
        throw new Error("second process must not call the provider");
      },
    },
  });
  console.log(JSON.stringify({ role: "racer", ok: sent.ok, code: sent.ok ? "" : sent.code }));
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
  const prisma = new PrismaClient();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "obal-lock-"));
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
    assert.equal(raced.code, "BALANCE_SMS_IN_PROGRESS");
    fs.writeFileSync(releaseFile, "go");
    const held = JSON.parse(lastJsonLine(await holderPromise)) as { ok: boolean; accepted: number };
    assert.equal(held.ok, true);
    assert.equal(held.accepted, 1);
    const stored = await prisma.outstandingFeesReminderCampaign.findMany({
      where: { schoolId: SCHOOL, messageType: "outstanding_balance_sms" },
      include: { recipients: true },
    });
    assert.equal(stored.length, 1);
    assert.equal(stored[0].state, "completed");
    assert.equal(stored[0].recipients[0].status, "accepted");
    assert.equal(JSON.stringify(stored).includes("27829990000"), false);
    const other = await prisma.outstandingFeesReminderCampaign.count({ where: { schoolId: OTHER } });
    assert.equal(other, 0);
    console.log("outstandingBalanceBulkSms.lock.localdb.test.ts: OK");
  } finally {
    await cleanup(prisma);
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
