/**
 * Verifies the per-school advisory transaction lock used by bulk statement job creation against a
 * LOCAL Postgres only. Reads/writes no tables. Refuses to run unless DATABASE_URL points at localhost.
 * Run: node --import tsx src/services/bulkStatementEmailJobLock.localdb.test.ts
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";

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

async function main() {
  assertLocalDatabase();
  const prisma = new PrismaClient();
  try {
    const order: string[] = [];
    const lockKey = "bulk-statement-email-job:school-local-lock-test";
    const holdMs = 400;

    const first = prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
      order.push("first-acquired");
      await new Promise((resolve) => setTimeout(resolve, holdMs));
      order.push("first-released");
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const secondStartedAt = Date.now();
    const second = prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
      order.push("second-acquired");
    });
    await Promise.all([first, second]);
    const waited = Date.now() - secondStartedAt;

    assert.deepEqual(order, ["first-acquired", "first-released", "second-acquired"], "same school serialised");
    assert.ok(waited >= holdMs - 100, `second transaction waited for the lock (${waited}ms)`);

    const otherOrder: string[] = [];
    const a = prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"bulk-statement-email-job:school-x"}))`;
      await new Promise((resolve) => setTimeout(resolve, holdMs));
      otherOrder.push("x-done");
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const b = prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"bulk-statement-email-job:school-y"}))`;
      otherOrder.push("y-done");
    });
    await Promise.all([a, b]);
    assert.deepEqual(otherOrder, ["y-done", "x-done"], "different schools do not block each other");

    console.log(`  ✓ advisory lock serialises one school (waited ${waited}ms) and isolates other schools`);
    console.log("bulkStatementEmailJobLock.localdb.test.ts: OK");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
