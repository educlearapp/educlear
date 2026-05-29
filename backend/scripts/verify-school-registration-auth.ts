/**
 * End-to-end school owner auth verification (any registered email).
 *
 * Usage:
 *   REGISTRATION_EMAIL=dasilvaacademy@gmail.com REGISTRATION_PASSWORD='...' \
 *     npx tsx scripts/verify-school-registration-auth.ts
 *
 *   ... --verify-login     # POST /auth/login must return 200 + token
 *   ... --apply-reclaim    # run register-school reclaim for script-provisioned owners
 *
 * Env:
 *   REGISTRATION_EMAIL / REGISTRATION_PASSWORD (required)
 *   API_BASE_URL (default http://localhost:3000)
 *   EXPECTED_SCHOOL_ID (optional)
 */
import "dotenv/config";

import bcrypt from "bcryptjs";
import fs from "fs";
import path from "path";

import { PrismaClient } from "@prisma/client";

import {
  describeOwnerProvisioning,
  isScriptProvisionedOwner,
} from "../src/utils/ownerProvisioning";
import { permissionsForRole } from "../src/utils/userPermissions";
import { getUserAccessMeta } from "../src/utils/userAccessStore";

const prisma = new PrismaClient();

const email = String(process.env.REGISTRATION_EMAIL || process.argv[2] || "")
  .trim()
  .toLowerCase();
const password = String(process.env.REGISTRATION_PASSWORD || process.argv[3] || "");
const VERIFY_LOGIN = process.argv.includes("--verify-login");
const APPLY_RECLAIM = process.argv.includes("--apply-reclaim");
const API_BASE = String(process.env.API_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const EXPECTED_SCHOOL_ID = String(process.env.EXPECTED_SCHOOL_ID || "").trim();

type Check = {
  id: string;
  title: string;
  status: "pass" | "fail" | "warn" | "skip";
  detail: string;
};

const checks: Check[] = [];

function add(id: string, title: string, status: Check["status"], detail: string): void {
  checks.push({ id, title, status, detail });
}

async function postLogin(
  loginEmail: string,
  loginPassword: string
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: loginEmail, password: loginPassword }),
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* keep text */
  }
  return { status: res.status, body };
}

async function postRegisterReclaim(
  schoolName: string,
  contactPerson: string,
  phone: string
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${API_BASE}/auth/register-school`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      schoolName,
      contactPerson,
      email,
      phone,
      password,
    }),
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* keep text */
  }
  return { status: res.status, body };
}

async function main(): Promise<void> {
  const generatedAt = new Date().toISOString();

  if (!email) {
    throw new Error("REGISTRATION_EMAIL is required");
  }
  if (!password) {
    throw new Error("REGISTRATION_PASSWORD is required");
  }

  const users = await prisma.user.findMany({
    where: { email },
    select: {
      id: true,
      email: true,
      schoolId: true,
      role: true,
      isActive: true,
      passwordHash: true,
      fullName: true,
      createdAt: true,
    },
  });

  if (!users.length) {
    add("user", "User row exists", "fail", `No user for ${email}`);
  } else {
    add("user", "User row exists", "pass", `${users.length} row(s)`);
    if (users.length > 1) {
      add("dup", "Duplicate email users", "fail", users.map((u) => `${u.id}@${u.schoolId}`).join(", "));
    } else {
      add("dup", "Duplicate email users", "pass", "single user");
    }
  }

  let loginVerified = false;
  let passwordMatches = false;
  let provisioning: string = "none";

  if (APPLY_RECLAIM && users.length === 1) {
    const u = users[0];
    const school = await prisma.school.findUnique({
      where: { id: u.schoolId },
      select: { id: true, name: true, email: true },
    });
    if (school && isScriptProvisionedOwner(u, school)) {
      const reclaim = await postRegisterReclaim(
        school.name,
        u.fullName?.includes("Owner") ? "Da Silva Academy" : String(u.fullName || "Owner"),
        "0000000000"
      );
      const reclaimed =
        reclaim.status === 200 &&
        reclaim.body &&
        typeof reclaim.body === "object" &&
        (reclaim.body as { reclaimed?: boolean }).reclaimed;
      add(
        "reclaim",
        "register-school reclaim (pre-check)",
        reclaimed ? "pass" : "fail",
        `status=${reclaim.status} body=${JSON.stringify(reclaim.body)}`
      );
      if (reclaimed) {
        const refreshed = await prisma.user.findUnique({
          where: { id: u.id },
          select: { passwordHash: true, fullName: true },
        });
        if (refreshed) u.passwordHash = refreshed.passwordHash;
        school.email = email;
      }
    }
  }

  for (const user of users) {
    const school = await prisma.school.findUnique({
      where: { id: user.schoolId },
      select: { id: true, name: true, email: true, createdAt: true },
    });
    if (!school) {
      add("school", "School linked", "fail", `Missing school ${user.schoolId}`);
      continue;
    }

    provisioning = describeOwnerProvisioning(user, school);
    add(
      "provenance",
      "Owner provisioning source",
      provisioning === "script" ? "warn" : provisioning === "registration" ? "pass" : "warn",
      `${provisioning} (fullName=${user.fullName || ""}, school.email=${school.email || "null"})`
    );

    if (EXPECTED_SCHOOL_ID && user.schoolId !== EXPECTED_SCHOOL_ID) {
      add("schoolId", "Expected schoolId", "fail", `got ${user.schoolId}, expected ${EXPECTED_SCHOOL_ID}`);
    } else if (EXPECTED_SCHOOL_ID) {
      add("schoolId", "Expected schoolId", "pass", user.schoolId);
    } else {
      add("schoolId", "schoolId", "pass", `${user.schoolId} (${school.name})`);
    }

    add("role", "Prisma role", user.role ? "pass" : "fail", String(user.role));
    add("active", "isActive", user.isActive ? "pass" : "fail", String(user.isActive));

    const hash = user.passwordHash || "";
    const hashOk = hash.length === 60 && hash.startsWith("$2");
    add(
      "hash",
      "bcrypt hash format",
      hashOk ? "pass" : "fail",
      `len=${hash.length} prefix=${hash.slice(0, 7)}`
    );

    passwordMatches = await bcrypt.compare(password, hash);
    add(
      "compare",
      "bcrypt.compare(REGISTRATION_PASSWORD)",
      passwordMatches ? "pass" : "fail",
      passwordMatches ? "password matches stored hash" : "password does NOT match stored hash"
    );

    if (provisioning === "script" && !passwordMatches) {
      add(
        "lost",
        "Registration password never stored",
        "fail",
        "Owner was created by migration/repair script — use register-school reclaim (not password reset)"
      );
    }

    const meta = getUserAccessMeta(user.id);
    add(
      "access",
      "user-access Owner meta",
      meta?.appRole === "Owner" ? "pass" : "warn",
      meta ? `appRole=${meta.appRole}` : "missing — set via register-school or ensure-da-silva-owner"
    );

    const expectedPerms = permissionsForRole("Owner");
    add(
      "perms",
      "Owner permission map",
      meta?.permissions && Object.keys(meta.permissions).length >= Object.keys(expectedPerms).length
        ? "pass"
        : "warn",
      meta?.permissions ? `${Object.keys(meta.permissions).length} modules` : "no meta"
    );

  }

  if (VERIFY_LOGIN || APPLY_RECLAIM) {
    const login = await postLogin(email, password);
    const token =
      login.body &&
      typeof login.body === "object" &&
      login.body !== null &&
      "token" in login.body
        ? String((login.body as { token?: string }).token || "")
        : "";
    loginVerified = login.status === 200 && Boolean(token);
    add(
      "login",
      "POST /auth/login success",
      loginVerified ? "pass" : "fail",
      loginVerified
        ? `200 token issued schoolId=${(login.body as { user?: { schoolId?: string } }).user?.schoolId}`
        : `status=${login.status} body=${JSON.stringify(login.body)}`
    );
  } else {
    add("login", "POST /auth/login success", "skip", "Re-run with --verify-login");
  }

  const blockers = checks.filter((c) => c.status === "fail");
  const report = {
    generatedAt,
    email,
    apiBase: API_BASE,
    provisioning,
    passwordMatches,
    loginVerified,
    goLiveBlocker: !loginVerified && VERIFY_LOGIN,
    checks,
    recovery:
      provisioning === "script" && !passwordMatches
        ? "Re-submit Register School with same email/name/password OR: REGISTRATION_EMAIL=... REGISTRATION_PASSWORD=... npx tsx scripts/verify-school-registration-auth.ts --apply-reclaim --verify-login"
        : !passwordMatches
          ? "Password does not match hash — confirm REGISTRATION_PASSWORD and database (local vs production)"
          : "Login should succeed — run with --verify-login",
  };

  const outJson = path.join(process.cwd(), "verify-school-registration-auth.json");
  const outTxt = path.join(process.cwd(), "verify-school-registration-auth.txt");
  fs.writeFileSync(outJson, JSON.stringify(report, null, 2));
  const txt = [
    "School registration auth verification",
    `Generated: ${generatedAt}`,
    `Email: ${email}`,
    "",
    `LOGIN VERIFIED: ${loginVerified ? "YES" : VERIFY_LOGIN ? "NO" : "not tested"}`,
    `Password matches hash: ${passwordMatches ? "YES" : "NO"}`,
    `Provisioning: ${provisioning}`,
    "",
    ...checks.map((c) => `[${c.status.toUpperCase()}] ${c.title}: ${c.detail}`),
    "",
    `Recovery: ${report.recovery}`,
  ];
  fs.writeFileSync(outTxt, txt.join("\n"));
  console.log(txt.join("\n"));
  console.log(`\nWrote ${outJson} and ${outTxt}`);

  if (blockers.length || (VERIFY_LOGIN && !loginVerified)) {
    process.exit(1);
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
