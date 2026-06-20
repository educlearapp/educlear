/**
 * Remove PayFast test schools from production (or preview/audit).
 *
 * Targets ONLY (exact names):
 *   - EduClear Payfast Test School
 *   - Payfast Test School
 *   - x
 *
 * Preview:
 *   npx tsx scripts/delete-payfast-test-schools-production.ts --preview
 *
 * Apply PostgreSQL deletes (production DB):
 *   CONFIRM_DELETE_PAYFAST_TEST_SCHOOLS=true \
 *   npx tsx scripts/delete-payfast-test-schools-production.ts --apply
 *
 * Clear JSON stores on THIS host's backend/data (run on Render backend for production disk):
 *   CONFIRM_DELETE_PAYFAST_TEST_SCHOOLS=true \
 *   npx tsx scripts/delete-payfast-test-schools-production.ts --apply-json
 */
import "dotenv/config";

import fs from "fs";
import os from "os";
import path from "path";

import { PrismaClient } from "@prisma/client";

const BACKEND_SERVICE_ID = "srv-d6j8jvma2pns7397bghg";
const CONFIRM_ENV = "CONFIRM_DELETE_PAYFAST_TEST_SCHOOLS";

const PROTECTED_EXACT_NAMES = new Set(
  [
    "Da Silva Academy",
    "Magical Bright Beginnings",
    "EduClear Platform",
    "Little Scientists Lab Club",
    "EduClear Demo School",
  ].map((n) => n.toLowerCase())
);

/** Canonical production IDs — name must still match exactly at runtime. */
const TARGET_SCHOOLS = [
  { id: "cmq57tcic0009twre2xuu3irr", exactName: "EduClear Payfast Test School" },
  { id: "cmq5afroi0041twred1289zoo", exactName: "Payfast Test School" },
  { id: "cmq5802li000itwrelsctwjwk", exactName: "x" },
] as const;

const DA_SILVA_ID = "cmpideqeq0000108xb6ouv9zi";
const MAGICAL_BB_ID = "cmq4xjckq00at60gqg4eb956h";

const PREVIEW = process.argv.includes("--preview");
const APPLY = process.argv.includes("--apply");
const APPLY_JSON = process.argv.includes("--apply-json");
const allowLocal = process.argv.includes("--allow-local-target");

type CountMap = Record<string, number>;

function readRenderApiKey(): string {
  const fromEnv = String(process.env.RENDER_API_KEY || "").trim();
  if (fromEnv) return fromEnv;
  const cliPath = path.join(os.homedir(), ".render", "cli.yaml");
  if (!fs.existsSync(cliPath)) return "";
  const raw = fs.readFileSync(cliPath, "utf8");
  const match = raw.match(/^\s*key:\s*(\S+)\s*$/m);
  return match ? match[1].trim() : "";
}

async function fetchRenderEnvVar(serviceId: string, key: string): Promise<string> {
  const apiKey = readRenderApiKey();
  if (!apiKey) return "";
  const res = await fetch(`https://api.render.com/v1/services/${serviceId}/env-vars`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) return "";
  const rows = (await res.json()) as Array<{ envVar?: { key?: string; value?: string } }>;
  for (const row of rows) {
    const env = row.envVar || row;
    if (env.key === key) return String(env.value || "").trim();
  }
  return "";
}

function isLocalDbUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
}

async function resolveDatabaseUrl(): Promise<string> {
  const prod = String(process.env.PRODUCTION_DATABASE_URL || "").trim();
  const direct = String(process.env.DATABASE_URL || "").trim();
  const candidate = prod || direct;
  if (candidate && (allowLocal || !isLocalDbUrl(candidate))) {
    return candidate;
  }
  const fromRender = await fetchRenderEnvVar(BACKEND_SERVICE_ID, "DATABASE_URL");
  if (fromRender && (allowLocal || !isLocalDbUrl(fromRender))) {
    return fromRender;
  }
  throw new Error(
    "Production DATABASE_URL not available. Set PRODUCTION_DATABASE_URL, RENDER_API_KEY, or use --allow-local-target for local DB only."
  );
}

function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    return `${u.protocol}//${u.username ? "***@" : ""}${u.hostname}${u.pathname}`;
  } catch {
    return "(invalid)";
  }
}

async function countSchoolRows(prisma: PrismaClient, schoolId: string): Promise<CountMap> {
  const counts: CountMap = {};
  const add = async (key: string, fn: () => Promise<number>) => {
    counts[key] = await fn();
  };

  await add("learner", () => prisma.learner.count({ where: { schoolId } }));
  await add("parent", () => prisma.parent.count({ where: { schoolId } }));
  await add("employee", () => prisma.employee.count({ where: { schoolId } }));
  await add("classroom", () => prisma.classroom.count({ where: { schoolId } }));
  await add("familyAccount", () => prisma.familyAccount.count({ where: { schoolId } }));
  await add("user", () => prisma.user.count({ where: { schoolId } }));
  await add("schoolSubscription", () => prisma.schoolSubscription.count({ where: { schoolId } }));
  await add("subscriptionInvoice", () => prisma.subscriptionInvoice.count({ where: { schoolId } }));
  await add("subscriptionPaymentLog", () =>
    prisma.subscriptionPaymentLog.count({ where: { schoolId } })
  );
  await add("creditPurchaseInvoice", () =>
    prisma.creditPurchaseInvoice.count({ where: { schoolId } })
  );
  await add("creditPurchasePaymentLog", () =>
    prisma.creditPurchasePaymentLog.count({ where: { schoolId } })
  );
  await add("communicationLog", () => prisma.communicationLog.count({ where: { schoolId } }));
  await add("schoolSmsSettings", () => prisma.schoolSmsSettings.count({ where: { schoolId } }));
  await add("learnerAttendance", () => prisma.learnerAttendance.count({ where: { schoolId } }));

  return counts;
}

function ledgerEntryCounts(schoolIds: string[]): CountMap {
  const filePath = path.join(process.cwd(), "data", "billing-ledger.json");
  const out: CountMap = {};
  if (!fs.existsSync(filePath)) return out;
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown[]>;
  for (const sid of schoolIds) {
    const rows = parsed[sid];
    if (Array.isArray(rows) && rows.length) out[`billing-ledger.json:${sid}`] = rows.length;
  }
  return out;
}

async function auditTargets(prisma: PrismaClient) {
  const allSchools = await prisma.school.findMany({
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });

  console.log("\n=== ALL SCHOOLS (read-only) ===");
  for (const s of allSchools) {
    console.log(`  ${s.name} | ${s.id} | ${s.email || "—"}`);
  }
  console.log(`Total: ${allSchools.length}`);

  const targetIds = new Set(TARGET_SCHOOLS.map((t) => t.id));
  const similarlyNamed = allSchools.filter(
    (s) =>
      !targetIds.has(s.id) &&
      (/payfast/i.test(s.name) || /^x$/i.test(s.name.trim()) || /test school/i.test(s.name))
  );
  if (similarlyNamed.length) {
    console.error("\n[STOP] Additional similarly named schools found:");
    for (const s of similarlyNamed) {
      console.error(`  ${s.name} (${s.id})`);
    }
    throw new Error("Unexpected similarly named schools — manual review required");
  }

  const audits: Array<Record<string, unknown>> = [];

  for (const target of TARGET_SCHOOLS) {
    const school = await prisma.school.findUnique({
      where: { id: target.id },
      select: { id: true, name: true, email: true, createdAt: true },
    });
    if (!school) {
      throw new Error(`Target school missing: ${target.exactName} (${target.id})`);
    }
    if (school.name !== target.exactName) {
      throw new Error(
        `Name mismatch for ${target.id}: expected "${target.exactName}", got "${school.name}"`
      );
    }
    if (PROTECTED_EXACT_NAMES.has(school.name.trim().toLowerCase())) {
      throw new Error(`Refusing protected school: ${school.name}`);
    }
    if (school.id === DA_SILVA_ID || school.id === MAGICAL_BB_ID) {
      throw new Error(`Refusing protected school id: ${school.id}`);
    }

    const sub = await prisma.schoolSubscription.findUnique({
      where: { schoolId: school.id },
      select: {
        status: true,
        packageCode: true,
        package: { select: { name: true } },
      },
    });

    const counts = await countSchoolRows(prisma, school.id);
    const jsonCounts = ledgerEntryCounts([school.id]);

    audits.push({
      schoolId: school.id,
      name: school.name,
      email: school.email,
      createdAt: school.createdAt.toISOString(),
      subscriptionStatus: sub?.status ?? null,
      package: sub?.packageCode ?? null,
      packageName: sub?.package?.name ?? null,
      prismaCounts: counts,
      jsonCounts,
    });

    console.log(`\n=== ${school.name} (${school.id}) ===`);
    console.log(`Email: ${school.email || "—"}`);
    console.log(`Subscription: ${sub?.status ?? "none"} / ${sub?.packageCode ?? "—"}`);
    for (const [k, v] of Object.entries(counts)) {
      if (v) console.log(`  ${k}: ${v}`);
    }
    for (const [k, v] of Object.entries(jsonCounts)) {
      console.log(`  ${k}: ${v}`);
    }
  }

  const daSilva = await prisma.school.findUnique({
    where: { id: DA_SILVA_ID },
    select: { id: true, name: true },
  });
  const mbb = await prisma.school.findUnique({
    where: { id: MAGICAL_BB_ID },
    select: { id: true, name: true },
  });
  console.log("\n=== PROTECTED CHECK ===");
  console.log(`Da Silva: ${daSilva?.name ?? "MISSING"} (${DA_SILVA_ID})`);
  console.log(`Magical Bright Beginnings: ${mbb?.name ?? "MISSING"} (${MAGICAL_BB_ID})`);

  return audits;
}

async function deleteTargetSchool(
  prisma: PrismaClient,
  schoolId: string,
  schoolName: string,
  cleanup: {
    purgeImportedSchoolData: (schoolId: string) => Promise<CountMap>;
    deleteSchoolUsers: (schoolId: string) => Promise<number>;
    deleteSchoolRoles: (schoolId: string) => Promise<number>;
  }
) {
  const purged = await cleanup.purgeImportedSchoolData(schoolId);
  const usersDeleted = await cleanup.deleteSchoolUsers(schoolId);
  const rolesDeleted = await cleanup.deleteSchoolRoles(schoolId);
  await prisma.school.delete({ where: { id: schoolId } });
  return { schoolId, schoolName, purged, usersDeleted, rolesDeleted };
}

async function main(): Promise<void> {
  if (!PREVIEW && !APPLY && !APPLY_JSON) {
    throw new Error("Pass --preview, --apply, or --apply-json");
  }

  if ((APPLY || APPLY_JSON) && process.env[CONFIRM_ENV] !== "true") {
    throw new Error(`${CONFIRM_ENV}=true is required for apply modes`);
  }

  const schoolIds = TARGET_SCHOOLS.map((t) => t.id);

  if (APPLY_JSON) {
    const {
      clearJsonStoresForSchools,
      clearStagingForSchools,
    } = await import("./school-data-cleanup");
    console.log(`\n=== JSON store cleanup (${path.join(process.cwd(), "data")}) ===`);
    const jsonApplied = clearJsonStoresForSchools(schoolIds);
    const stagingRemoved = clearStagingForSchools(schoolIds);
    console.log("JSON:", jsonApplied);
    console.log("Staging:", stagingRemoved);
    return;
  }

  const dbUrl = await resolveDatabaseUrl();
  console.log(`Database: ${maskUrl(dbUrl)}`);
  process.env.DATABASE_URL = dbUrl;

  const {
    purgeImportedSchoolData,
    deleteSchoolUsers,
    deleteSchoolRoles,
  } = await import("./school-data-cleanup");

  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

  try {
    await auditTargets(prisma);

    if (PREVIEW) {
      console.log("\nPreview only — no deletes performed.");
      return;
    }

    const deleted: Array<Record<string, unknown>> = [];
    const cleanup = { purgeImportedSchoolData, deleteSchoolUsers, deleteSchoolRoles };
    for (const target of TARGET_SCHOOLS) {
      const result = await deleteTargetSchool(prisma, target.id, target.exactName, cleanup);
      deleted.push(result);
      console.log(`\nDeleted school: ${target.exactName} (${target.id})`);
      console.log(`  users removed: ${result.usersDeleted}`);
      console.log(`  roles removed: ${result.rolesDeleted}`);
      const purgedTotal = Object.values(result.purged).reduce((s, n) => s + n, 0);
      console.log(`  purged rows: ${purgedTotal}`);
    }

    const remaining = await prisma.school.count();
    console.log(`\nRemaining schools in database: ${remaining}`);

    const daSilva = await prisma.school.findUnique({ where: { id: DA_SILVA_ID } });
    const mbb = await prisma.school.findUnique({ where: { id: MAGICAL_BB_ID } });
    if (!daSilva || daSilva.name !== "Da Silva Academy") {
      throw new Error("Post-delete check failed: Da Silva Academy missing or renamed");
    }
    if (!mbb || mbb.name !== "Magical Bright Beginnings") {
      throw new Error("Post-delete check failed: Magical Bright Beginnings missing or renamed");
    }
    console.log("Protected schools verified in database.");

    console.log("\n=== DELETE SUMMARY ===");
    console.log(JSON.stringify({ deleted, remainingSchools: remaining }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
