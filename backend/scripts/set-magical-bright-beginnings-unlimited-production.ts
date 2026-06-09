/**
 * Production: set Magical Bright Beginnings subscription to UNLIMITED / ACTIVE only.
 *
 * Does NOT touch billing, payments, ledger, statements, invoices, SMS credits, or other schools.
 *
 * Preview (read-only):
 *   PRODUCTION_DATABASE_URL="postgresql://..." npx tsx scripts/set-magical-bright-beginnings-unlimited-production.ts --preview
 *
 * Apply (PostgreSQL — recommended for permanent DB save):
 *   CONFIRM_MAGICAL_BB_UNLIMITED=true \
 *   PRODUCTION_DATABASE_URL="postgresql://..." \
 *   npx tsx scripts/set-magical-bright-beginnings-unlimited-production.ts --apply
 *
 * Apply via Super Admin API (uses existing PATCH handler):
 *   CONFIRM_MAGICAL_BB_UNLIMITED=true \
 *   SUPER_ADMIN_PASSWORD="..." \
 *   npx tsx scripts/set-magical-bright-beginnings-unlimited-production.ts --apply-api
 */
import "dotenv/config";

import {
  EduClearPackageCode,
  PrismaClient,
  SchoolSubscriptionStatus,
} from "@prisma/client";

import { ensureEduClearPackages } from "../src/services/ensureEduClearPackages";
import { addOneCalendarMonth } from "../src/services/payfastService";

const TARGET_SCHOOL_NAME = "Magical Bright Beginnings";
const TARGET_SCHOOL_EMAIL = "magicalbb@hotmail.com";
const TARGET_PACKAGE: EduClearPackageCode = "UNLIMITED";
const CONFIRM_ENV = "CONFIRM_MAGICAL_BB_UNLIMITED";
const API_BASE = String(
  process.env.API_BASE || "https://educlear-backend.onrender.com"
).replace(/\/$/, "");

const PREVIEW = process.argv.includes("--preview");
const APPLY = process.argv.includes("--apply");
const APPLY_API = process.argv.includes("--apply-api");
const allowLocalTarget = process.argv.includes("--allow-local-target");

function resolveDbUrl(): string {
  const prod = String(process.env.PRODUCTION_DATABASE_URL || "").trim();
  const local = String(process.env.DATABASE_URL || "").trim();
  const url = prod || local;
  if (!url) throw new Error("PRODUCTION_DATABASE_URL or DATABASE_URL is required");
  const host = resolveDbHost(url);
  if (!allowLocalTarget && isLocalHost(host)) {
    throw new Error(
      `Refusing against local DB (${host}). Set PRODUCTION_DATABASE_URL or pass --allow-local-target.`
    );
  }
  return url;
}

function resolveDbHost(url: string): string {
  const m = String(url || "").match(/@([^/?]+)/);
  return m ? m[1] : "unknown";
}

function isLocalHost(host: string): boolean {
  const h = host.toLowerCase();
  return h.includes("localhost") || h.includes("127.0.0.1");
}

function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.username ? "***:***@" : ""}${u.hostname}${u.port ? `:${u.port}` : ""}${u.pathname}`;
  } catch {
    return "(invalid url)";
  }
}

function formatPackageLabel(code: EduClearPackageCode | null | undefined, name?: string | null): string {
  if (name?.trim()) return name.trim();
  if (code === "UNLIMITED") return "Unlimited";
  if (code === "STARTER") return "Starter";
  return code || "—";
}

function formatStatus(status: SchoolSubscriptionStatus | null | undefined): string {
  if (status === SchoolSubscriptionStatus.ACTIVE) return "Active";
  if (status === SchoolSubscriptionStatus.SUSPENDED) return "Suspended";
  if (status === SchoolSubscriptionStatus.PENDING_PAYMENT) return "Trial";
  return status || "—";
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, init);
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    throw new Error(`${url} ${res.status}: ${String(text).slice(0, 500)}`);
  }
  return data;
}

async function loginSuperAdmin(): Promise<string> {
  const email = String(process.env.SUPER_ADMIN_EMAIL || "info@educlear.co.za").trim();
  const password = String(process.env.SUPER_ADMIN_PASSWORD || "").trim();
  if (!password) throw new Error("SUPER_ADMIN_PASSWORD is required for --apply-api");
  const data = (await fetchJson(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  })) as { token?: string };
  const token = String(data.token || "").trim();
  if (!token) throw new Error("Super admin login failed — no token");
  return token;
}

async function findTargetSchool(prisma: PrismaClient) {
  const school = await prisma.school.findFirst({
    where: {
      email: { equals: TARGET_SCHOOL_EMAIL, mode: "insensitive" },
      name: { equals: TARGET_SCHOOL_NAME, mode: "insensitive" },
    },
    select: {
      id: true,
      name: true,
      email: true,
      schoolSubscription: {
        select: {
          id: true,
          status: true,
          packageCode: true,
          packageId: true,
          updatedAt: true,
          package: {
            select: {
              id: true,
              code: true,
              name: true,
              monthlyPriceCents: true,
              learnerLimit: true,
              payrollStaffLimit: true,
            },
          },
        },
      },
    },
  });

  if (!school) {
    throw new Error(
      `School not found with exact name "${TARGET_SCHOOL_NAME}" and email "${TARGET_SCHOOL_EMAIL}"`
    );
  }
  return school;
}

function printSchoolSnapshot(label: string, school: Awaited<ReturnType<typeof findTargetSchool>>) {
  const sub = school.schoolSubscription;
  const pkg = sub?.package;
  console.log(`\n=== ${label} ===`);
  console.log(`School ID: ${school.id}`);
  console.log(`School name: ${school.name}`);
  console.log(`School email: ${school.email}`);
  console.log(`Package: ${formatPackageLabel(sub?.packageCode, pkg?.name)} (${sub?.packageCode || "none"})`);
  console.log(`Monthly price: R${((pkg?.monthlyPriceCents || 0) / 100).toLocaleString("en-ZA")}`);
  console.log(`Status: ${formatStatus(sub?.status)} (${sub?.status || "none"})`);
  console.log(`Learner limit: ${pkg?.learnerLimit == null ? "Unlimited" : pkg.learnerLimit}`);
  console.log(`Payroll staff limit: ${pkg?.payrollStaffLimit == null ? "Unlimited" : pkg.payrollStaffLimit}`);
  if (sub?.updatedAt) console.log(`Subscription updatedAt: ${sub.updatedAt.toISOString()}`);
}

async function verifyApiStatus(schoolId: string) {
  const data = (await fetchJson(
    `${API_BASE}/api/subscriptions/school/${encodeURIComponent(schoolId)}/status`
  )) as {
    success?: boolean;
    schoolName?: string;
    isActive?: boolean;
    subscription?: {
      status?: string;
      packageCode?: string;
      package?: {
        name?: string;
        monthlyPriceLabel?: string;
        monthlyPriceCents?: number;
        learnerLimit?: number | null;
        payrollStaffLimit?: number | null;
      };
    } | null;
  };

  const sub = data.subscription;
  const pkg = sub?.package;
  console.log("\n=== Production API verification ===");
  console.log(`Endpoint: ${API_BASE}/api/subscriptions/school/${schoolId}/status`);
  console.log(`API success: ${data.success === true}`);
  console.log(`School name: ${data.schoolName || "?"}`);
  console.log(`isActive: ${data.isActive === true}`);
  console.log(`Package code: ${sub?.packageCode || "none"}`);
  console.log(`Package name: ${pkg?.name || "none"}`);
  console.log(
    `Monthly price: ${pkg?.monthlyPriceLabel || (pkg?.monthlyPriceCents != null ? `R${pkg.monthlyPriceCents / 100}` : "?")}`
  );
  console.log(`Learner limit: ${pkg?.learnerLimit == null ? "Unlimited" : pkg.learnerLimit}`);
  console.log(
    `Payroll staff limit: ${pkg?.payrollStaffLimit == null ? "Unlimited" : pkg.payrollStaffLimit}`
  );

  const ok =
    data.success === true &&
    data.isActive === true &&
    sub?.packageCode === TARGET_PACKAGE &&
    pkg?.monthlyPriceCents === 200_000 &&
    pkg?.learnerLimit == null &&
    pkg?.payrollStaffLimit == null;

  console.log(`Verification passed: ${ok ? "YES" : "NO"}`);
  return ok;
}

async function applyDbUpdate(prisma: PrismaClient, schoolId: string) {
  await ensureEduClearPackages();

  const unlimitedPackage = await prisma.eduClearPackage.findUnique({
    where: { code: TARGET_PACKAGE },
    select: {
      id: true,
      code: true,
      name: true,
      monthlyPriceCents: true,
      learnerLimit: true,
      payrollStaffLimit: true,
    },
  });
  if (!unlimitedPackage) {
    throw new Error(`Package ${TARGET_PACKAGE} missing after ensureEduClearPackages`);
  }

  const activatedAt = new Date();
  const currentPeriodStart = new Date(
    activatedAt.getFullYear(),
    activatedAt.getMonth(),
    activatedAt.getDate()
  );
  const currentPeriodEnd = addOneCalendarMonth(currentPeriodStart);

  await prisma.schoolSubscription.upsert({
    where: { schoolId },
    create: {
      schoolId,
      packageId: unlimitedPackage.id,
      packageCode: TARGET_PACKAGE,
      status: SchoolSubscriptionStatus.ACTIVE,
      currentPeriodStart,
      currentPeriodEnd,
      activatedAt,
      cancelledAt: null,
      activationSource: "super_admin_manual_unlimited",
    },
    update: {
      packageId: unlimitedPackage.id,
      packageCode: TARGET_PACKAGE,
      status: SchoolSubscriptionStatus.ACTIVE,
      currentPeriodStart,
      currentPeriodEnd,
      activatedAt,
      cancelledAt: null,
    },
  });
}

async function applyApiUpdate(token: string, schoolId: string) {
  await fetchJson(`${API_BASE}/api/super-admin/schools/${encodeURIComponent(schoolId)}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ package: "Unlimited", status: "Active" }),
  });
}

async function main(): Promise<void> {
  if (!PREVIEW && !APPLY && !APPLY_API) {
    throw new Error("Pass --preview, --apply, or --apply-api");
  }

  if ((APPLY || APPLY_API) && process.env[CONFIRM_ENV] !== "true") {
    throw new Error(`${CONFIRM_ENV}=true is required for apply modes`);
  }

  if (APPLY_API) {
    const token = await loginSuperAdmin();
    const dbUrl = resolveDbUrl();
    const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
    try {
      const before = await findTargetSchool(prisma);
      printSchoolSnapshot("Before (database read)", before);
      await applyApiUpdate(token, before.id);
      const after = await findTargetSchool(prisma);
      printSchoolSnapshot("After (database read)", after);
      await verifyApiStatus(before.id);
    } finally {
      await prisma.$disconnect();
    }
    return;
  }

  const dbUrl = resolveDbUrl();
  console.log(`Database target: ${maskUrl(dbUrl)}`);
  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

  try {
    const before = await findTargetSchool(prisma);
    printSchoolSnapshot("Before", before);

    if (PREVIEW) {
      console.log("\nPreview only — no changes written.");
      return;
    }

    await applyDbUpdate(prisma, before.id);
    const after = await findTargetSchool(prisma);
    printSchoolSnapshot("After", after);
    await verifyApiStatus(before.id);
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
