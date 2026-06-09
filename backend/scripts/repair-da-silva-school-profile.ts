/**
 * Da Silva Academy — School profile/business fields only (PostgreSQL `School` row).
 *
 * Does NOT touch billing, learners, parents, statements, ledger, invoices, payments,
 * attendance, users, subscriptions, or migration data.
 *
 * Usage (read current row — safe, no writes):
 *   npx tsx scripts/repair-da-silva-school-profile.ts
 *   npx tsx scripts/repair-da-silva-school-profile.ts --from-api
 *
 * Usage (dry-run update diff against production DB):
 *   PRODUCTION_DATABASE_URL="postgresql://..." npx tsx scripts/repair-da-silva-school-profile.ts --dry-run-update
 *
 * Usage (apply — only after you approve REPAIR_VALUES below):
 *   CONFIRM_DA_SILVA_SCHOOL_PROFILE_REPAIR=true \
 *   PRODUCTION_DATABASE_URL="postgresql://..." \
 *   npx tsx scripts/repair-da-silva-school-profile.ts --apply
 *
 * Optional: --allow-local-target to apply against DATABASE_URL on localhost (dev only).
 */
import "dotenv/config";

import { PrismaClient } from "@prisma/client";

import {
  DA_SILVA_ACADEMY_SCHOOL_ID,
  DA_SILVA_SCHOOL_NAME,
} from "../src/services/activateDaSilvaSubscription";

const SCHOOL_ID = DA_SILVA_ACADEMY_SCHOOL_ID;
const PRODUCTION_API =
  process.env.PUBLIC_API_URL?.replace(/\/$/, "") || "https://educlear-backend.onrender.com";
const CONFIRM_ENV = "CONFIRM_DA_SILVA_SCHOOL_PROFILE_REPAIR";
const DA_SILVA_LOGO_URL = "/uploads/school-logos/da-silva-academy-logo.png";

const APPLY = process.argv.includes("--apply");
const FROM_API = process.argv.includes("--from-api");
const DRY_RUN_UPDATE = process.argv.includes("--dry-run-update");
const allowLocalTarget = process.argv.includes("--allow-local-target");

/**
 * Edit these values only after explicit approval. Leave null to clear optional fields.
 * Schema note: UI "cell" → DB column `cellNo`.
 */
/** Approved profile fields only — phone/cell/address/banking are out of scope. */
export const REPAIR_VALUES = {
  name: DA_SILVA_SCHOOL_NAME,
  email: "dasilvaacademy@gmail.com",
  logoUrl: DA_SILVA_LOGO_URL,
} as const;

const OUT_OF_SCOPE_FIELDS = [
  "phone",
  "cellNo",
  "address",
  "postalAddress",
  "bankingDetails",
] as const;

const PROFILE_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  cellNo: true,
  address: true,
  postalAddress: true,
  bankingDetails: true,
  logoUrl: true,
  createdAt: true,
} as const;

type SchoolProfileRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  cellNo: string | null;
  address: string | null;
  postalAddress: string | null;
  bankingDetails: string | null;
  logoUrl: string | null;
  createdAt: Date;
};

function resolveDbHost(url: string): string {
  const m = String(url || "").match(/@([^/?]+)/);
  return m ? m[1] : "unknown";
}

function isLocalHost(host: string): boolean {
  const h = host.toLowerCase();
  return h.includes("localhost") || h.includes("127.0.0.1");
}

function maskUrl(url: string): string {
  if (!url) return "(not set)";
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.username ? "***:***@" : ""}${u.hostname}${u.port ? `:${u.port}` : ""}${u.pathname}`;
  } catch {
    return "(invalid url)";
  }
}

function displayValue(value: string | null | undefined): string {
  if (value === null || value === undefined) return "(null)";
  const text = String(value);
  if (text === "") return "(empty string)";
  return JSON.stringify(text);
}

function fieldStatus(
  current: string | null | undefined,
  target: string | null
): "ok" | "wrong" | "blank" {
  const cur = current === undefined || current === null || String(current).trim() === "" ? null : String(current);
  const tgt = target === null || String(target).trim() === "" ? null : String(target);
  if (cur === tgt) return "ok";
  if (cur === null) return "blank";
  return "wrong";
}

async function fetchProductionApiRow(): Promise<SchoolProfileRow | null> {
  const res = await fetch(`${PRODUCTION_API}/api/schools/${encodeURIComponent(SCHOOL_ID)}`);
  const text = await res.text();
  if (!res.ok) {
    console.error(`[api] GET failed ${res.status}: ${text.slice(0, 300)}`);
    return null;
  }
  const row = JSON.parse(text) as SchoolProfileRow;
  console.log(`[api] ${PRODUCTION_API}/api/schools/${SCHOOL_ID}`);
  return row;
}

async function readDbRow(dbUrl: string): Promise<SchoolProfileRow | null> {
  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  try {
    return await prisma.school.findUnique({
      where: { id: SCHOOL_ID },
      select: PROFILE_SELECT,
    });
  } finally {
    await prisma.$disconnect();
  }
}

function printRow(label: string, row: SchoolProfileRow | null): void {
  console.log(`\n=== ${label} ===`);
  if (!row) {
    console.log("(not found)");
    return;
  }
  console.log(`id:             ${row.id}`);
  console.log(`name:           ${displayValue(row.name)}`);
  console.log(`email:          ${displayValue(row.email)}`);
  console.log(`phone:          ${displayValue(row.phone)}`);
  console.log(`cellNo (cell):  ${displayValue(row.cellNo)}`);
  console.log(`address:        ${displayValue(row.address)}`);
  console.log(`postalAddress:  ${displayValue(row.postalAddress)}`);
  console.log(`bankingDetails: ${displayValue(row.bankingDetails)}`);
  console.log(`logoUrl:        ${displayValue(row.logoUrl)}`);
  console.log(`createdAt:      ${row.createdAt.toISOString?.() ?? row.createdAt}`);
}

function printDiff(current: SchoolProfileRow, target: typeof REPAIR_VALUES): void {
  console.log("\n=== Proposed repair (approved School profile fields only) ===");
  const keys = ["name", "email", "logoUrl"] as const;
  for (const key of keys) {
    const cur = current[key];
    const tgt = target[key];
    const status = fieldStatus(cur, tgt);
    if (status === "ok") {
      console.log(`  ${key}: unchanged ${displayValue(cur)}`);
      continue;
    }
    console.log(`  ${key}: ${status.toUpperCase()}  current=${displayValue(cur)}  →  target=${displayValue(tgt)}`);
  }
  for (const key of OUT_OF_SCOPE_FIELDS) {
    console.log(`  ${key}: skipped (out of scope)  current=${displayValue(current[key])}`);
  }
}

async function applyUpdate(dbUrl: string): Promise<SchoolProfileRow> {
  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  try {
    const existing = await prisma.school.findUnique({
      where: { id: SCHOOL_ID },
      select: { id: true },
    });
    if (!existing) throw new Error(`School not found: ${SCHOOL_ID}`);

    return await prisma.school.update({
      where: { id: SCHOOL_ID },
      data: {
        name: REPAIR_VALUES.name,
        email: REPAIR_VALUES.email,
        logoUrl: REPAIR_VALUES.logoUrl,
      },
      select: PROFILE_SELECT,
    });
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  const localUrl = String(process.env.DATABASE_URL || "").trim();
  const targetUrl = String(
    process.env.PRODUCTION_DATABASE_URL || process.env.TARGET_DATABASE_URL || ""
  ).trim();

  console.log("Da Silva Academy — School profile repair");
  console.log(`schoolId: ${SCHOOL_ID}`);
  console.log(`REPAIR_VALUES: ${JSON.stringify(REPAIR_VALUES, null, 2)}`);

  if (FROM_API || (!APPLY && !DRY_RUN_UPDATE && !targetUrl)) {
    const apiRow = await fetchProductionApiRow();
    printRow("Production API (live)", apiRow);
  }

  if (localUrl) {
    const localRow = await readDbRow(localUrl);
    printRow(`Local DB (${maskUrl(localUrl)})`, localRow);
  }

  if (targetUrl) {
    const prodRow = await readDbRow(targetUrl);
    printRow(`Production DB (${maskUrl(targetUrl)})`, prodRow);
    if (DRY_RUN_UPDATE && prodRow) printDiff(prodRow, REPAIR_VALUES);
  } else if (DRY_RUN_UPDATE) {
    console.warn("\n[WARN] --dry-run-update needs PRODUCTION_DATABASE_URL to diff against live DB.");
    const apiRow = await fetchProductionApiRow();
    if (apiRow) printDiff(apiRow, REPAIR_VALUES);
  }

  if (!APPLY) {
    console.log("\nNo database writes (pass --apply with confirmation to update).");
    return;
  }

  if (String(process.env[CONFIRM_ENV] || "").trim().toLowerCase() !== "true") {
    throw new Error(`Set ${CONFIRM_ENV}=true to apply`);
  }

  const activeUrl = targetUrl || (allowLocalTarget ? localUrl : "");
  if (!activeUrl) {
    throw new Error("PRODUCTION_DATABASE_URL is required for --apply (or --allow-local-target with DATABASE_URL)");
  }

  const targetHost = resolveDbHost(activeUrl);
  if (isLocalHost(targetHost) && !allowLocalTarget) {
    throw new Error(
      `Refusing --apply against local target (${targetHost}). Set PRODUCTION_DATABASE_URL or pass --allow-local-target.`
    );
  }

  const before = await readDbRow(activeUrl);
  if (!before) throw new Error(`School not found on target DB: ${SCHOOL_ID}`);

  printDiff(before, REPAIR_VALUES);
  const after = await applyUpdate(activeUrl);
  printRow(`After apply (${maskUrl(activeUrl)})`, after);
  console.log("\nApply complete.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
