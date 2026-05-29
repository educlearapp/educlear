"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Da Silva owner login audit — read-only checks + optional live login test.
 *
 * Usage:
 *   npx tsx scripts/audit-login-auth.ts
 *   DA_SILVA_OWNER_PASSWORD=... npx tsx scripts/audit-login-auth.ts --verify-login
 *   API_BASE_URL=http://localhost:3000 npx tsx scripts/audit-login-auth.ts --verify-login
 */
require("dotenv/config");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const client_1 = require("@prisma/client");
const ownerProvisioning_1 = require("../src/utils/ownerProvisioning");
const userPermissions_1 = require("../src/utils/userPermissions");
const userAccessStore_1 = require("../src/utils/userAccessStore");
const prisma = new client_1.PrismaClient();
const DA_SILVA_OWNER_EMAIL = "dasilvaacademy@gmail.com";
const DA_SILVA_SCHOOL_ID = "cmpideqeq0000108xb6ouv9zi";
const VERIFY_LOGIN = process.argv.includes("--verify-login");
const API_BASE = String(process.env.API_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const checks = [];
function add(id, title, status, detail) {
    checks.push({ id, title, status, detail });
}
async function postLogin(url, password) {
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: DA_SILVA_OWNER_EMAIL, password }),
    });
    const text = await res.text();
    let body = text;
    try {
        body = text ? JSON.parse(text) : null;
    }
    catch {
        /* keep text */
    }
    return { status: res.status, body };
}
async function main() {
    const generatedAt = new Date().toISOString();
    const ownerPassword = String(process.env.DA_SILVA_OWNER_PASSWORD || "").trim();
    const school = await prisma.school.findUnique({
        where: { id: DA_SILVA_SCHOOL_ID },
        select: { id: true, name: true, email: true },
    });
    if (school) {
        add("1-school", "Linked school exists", "pass", `${school.name} (${school.id})`);
    }
    else {
        add("1-school", "Linked school exists", "fail", `School not found: ${DA_SILVA_SCHOOL_ID}`);
    }
    const users = await prisma.user.findMany({
        where: { email: DA_SILVA_OWNER_EMAIL },
        select: {
            id: true,
            email: true,
            schoolId: true,
            role: true,
            isActive: true,
            passwordHash: true,
            fullName: true,
        },
    });
    if (!users.length) {
        add("1-user", "Owner user record exists", "fail", `No user for ${DA_SILVA_OWNER_EMAIL}`);
    }
    else {
        add("1-user", "Owner user record exists", "pass", `${users.length} user(s) with this email`);
        for (const u of users) {
            const school = await prisma.school.findUnique({
                where: { id: u.schoolId },
                select: { id: true, name: true, email: true },
            });
            const provenance = school
                ? (0, ownerProvisioning_1.describeOwnerProvisioning)(u, school)
                : "unknown";
            add("1-provenance", "Owner provisioning source", provenance === "registration" ? "pass" : provenance === "script" ? "warn" : "warn", school
                ? `${provenance} (school.email=${school.email || "null"}, fullName=${u.fullName || ""})`
                : "school missing");
            if (provenance === "script" && ownerPassword) {
                const match = await bcryptjs_1.default.compare(ownerPassword, u.passwordHash);
                if (!match) {
                    add("1-lost-password", "Registration password stored", "fail", "Owner was script-created — password in env does not match; reclaim via register-school with your chosen password");
                }
            }
            else if (provenance === "script") {
                add("1-lost-password", "Registration password stored", "warn", "Owner was script-created — set REGISTRATION_PASSWORD and run verify-school-registration-auth.ts");
            }
            const schoolOk = u.schoolId === DA_SILVA_SCHOOL_ID;
            add("1-schoolId", "schoolId linked to Da Silva Academy", schoolOk ? "pass" : "fail", `user ${u.id} schoolId=${u.schoolId}`);
            add("1-active", "User isActive", u.isActive ? "pass" : "fail", `user ${u.id} isActive=${u.isActive}`);
            add("1-role", "Prisma role present", u.role ? "pass" : "fail", `user ${u.id} role=${u.role}`);
            const hash = u.passwordHash || "";
            const hashOk = hash.length === 60 && hash.startsWith("$2");
            add("3-hash", "Password hash format (bcrypt)", hashOk ? "pass" : "fail", `length=${hash.length} prefix=${hash.slice(0, 7)}`);
            if (ownerPassword) {
                const match = await bcryptjs_1.default.compare(ownerPassword, hash);
                add("3-compare", "bcrypt.compare(DA_SILVA_OWNER_PASSWORD)", match ? "pass" : "fail", match ? "password matches stored hash" : "password does NOT match stored hash");
            }
            else {
                add("3-compare", "bcrypt.compare(DA_SILVA_OWNER_PASSWORD)", "skip", "Set DA_SILVA_OWNER_PASSWORD in env to test hash match");
            }
            const meta = (0, userAccessStore_1.getUserAccessMeta)(u.id);
            if (meta?.appRole === "Owner" && meta.schoolId === DA_SILVA_SCHOOL_ID) {
                add("1-permissions", "user-access.json Owner permissions", "pass", `appRole=${meta.appRole} schoolId=${meta.schoolId}`);
            }
            else if (!meta) {
                add("1-permissions", "user-access.json Owner permissions", "warn", `No user-access meta for ${u.id}; run ensure-da-silva-owner.ts`);
            }
            else {
                add("1-permissions", "user-access.json Owner permissions", "warn", `meta appRole=${meta.appRole} schoolId=${meta.schoolId}`);
            }
            const expectedPerms = (0, userPermissions_1.permissionsForRole)("Owner");
            const permKeys = Object.keys(expectedPerms);
            const metaPermKeys = meta?.permissions ? Object.keys(meta.permissions) : [];
            add("1-perm-map", "Owner permission map populated", metaPermKeys.length >= permKeys.length ? "pass" : "warn", `modules in meta: ${metaPermKeys.length}, expected: ${permKeys.length}`);
        }
    }
    add("5-jwt", "JWT_SECRET configured", process.env.JWT_SECRET ? "pass" : "fail", process.env.JWT_SECRET ? "JWT_SECRET is set" : "JWT_SECRET missing");
    const wrongPw = await postLogin(`${API_BASE}/auth/login`, "__audit_wrong_password__");
    add("4-auth-route", "POST /auth/login reachable", wrongPw.status === 401 ? "pass" : wrongPw.status === 404 ? "fail" : "warn", `status=${wrongPw.status} body=${JSON.stringify(wrongPw.body)}`);
    const apiAlias = await postLogin(`${API_BASE}/api/auth/login`, "__audit_wrong_password__");
    add("4-api-alias", "POST /api/auth/login reachable (alias)", apiAlias.status === 401 ? "pass" : apiAlias.status === 404 ? "fail" : "warn", `status=${apiAlias.status} body=${JSON.stringify(apiAlias.body)}`);
    let loginVerified = false;
    if (VERIFY_LOGIN) {
        if (!ownerPassword) {
            add("7-verify", "LOGIN VERIFIED", "fail", "--verify-login requires DA_SILVA_OWNER_PASSWORD in env");
        }
        else {
            const ok = await postLogin(`${API_BASE}/auth/login`, ownerPassword);
            const token = ok.body &&
                typeof ok.body === "object" &&
                ok.body !== null &&
                "token" in ok.body
                ? String(ok.body.token || "")
                : "";
            loginVerified = ok.status === 200 && Boolean(token);
            add("7-verify", "LOGIN VERIFIED", loginVerified ? "pass" : "fail", loginVerified
                ? `200 OK, token issued, schoolId=${ok.body.user?.schoolId}`
                : `status=${ok.status} body=${JSON.stringify(ok.body)}`);
        }
    }
    else {
        add("7-verify", "LOGIN VERIFIED", "skip", "Re-run with DA_SILVA_OWNER_PASSWORD=... --verify-login after password reset");
    }
    const blockers = checks.filter((c) => c.status === "fail");
    const report = {
        generatedAt,
        email: DA_SILVA_OWNER_EMAIL,
        schoolId: DA_SILVA_SCHOOL_ID,
        apiBase: API_BASE,
        loginVerified,
        goLiveBlocker: !loginVerified,
        checks,
        recovery: "REGISTRATION_EMAIL=dasilvaacademy@gmail.com REGISTRATION_PASSWORD='...' npx tsx scripts/verify-school-registration-auth.ts --apply-reclaim --verify-login (preferred — restores registration password, not a reset)",
    };
    const outJson = path_1.default.join(process.cwd(), "login-auth-audit.json");
    const outTxt = path_1.default.join(process.cwd(), "login-auth-audit.txt");
    fs_1.default.writeFileSync(outJson, JSON.stringify(report, null, 2));
    const txtLines = [
        "Da Silva owner login authentication audit",
        `Generated: ${generatedAt}`,
        "",
        `LOGIN VERIFIED: ${loginVerified ? "YES" : "NO — GO-LIVE BLOCKER"}`,
        "",
        ...checks.map((c) => `[${c.status.toUpperCase()}] ${c.title}: ${c.detail}`),
        "",
        blockers.length
            ? `Blockers: ${blockers.length} failed check(s)`
            : "No failed checks (login may still need --verify-login)",
        "",
        `Recovery: ${report.recovery}`,
    ];
    fs_1.default.writeFileSync(outTxt, txtLines.join("\n"));
    console.log(txtLines.join("\n"));
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
