/**
 * HomeSafe Collections V2 — local HTTP/auth smoke.
 * Requires a running backend whose DATABASE_URL is educlear_hs_cg_local ONLY.
 *
 * Usage:
 *   cd backend
 *   # terminal A:
 *   env $(grep -v '^#' .env.collections-local | xargs) PORT=3000 npm run dev
 *   # terminal B:
 *   DATABASE_URL="$(grep DATABASE_URL .env.collections-local | cut -d= -f2-)" \
 *     BACKEND_URL=http://127.0.0.1:3000 node scripts/homesafe-collections-http-smoke.mjs
 */
import { PrismaClient } from "@prisma/client";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { hashAuthPassword } = require("../dist/services/authCredentials.js");

const BACKEND_URL = String(process.env.BACKEND_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const SCHOOL_A = "cmvv0wv7w0000k73f481gl8pp"; // EduClear Demo School (local iso clone)
const EMAIL_A = "demo@educlear.co.za";
const PASS_A = "Admin123";
const EMAIL_B = "hs-cg-smoke-b@example.invalid";
const PASS_B = "HsCgSmokeB!2026-local";
const GROUP_NAME = `HTTP Smoke ${Date.now()}`;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function api(path, { method = "GET", token, body } = {}) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

async function main() {
  const prisma = new PrismaClient();
  const db = (await prisma.$queryRaw`SELECT current_database() AS db`)[0].db;
  assert(db === "educlear_hs_cg_local", `REFUSE: smoke prisma must be educlear_hs_cg_local, got ${db}`);
  console.log(JSON.stringify({ phase: "preflight", prismaDb: db, backend: BACKEND_URL }, null, 2));

  // Confirm running backend is on the same DB by creating a sentinel via API after login,
  // but first refuse if main educlear somehow has Collections tables (should be empty).
  const mainUrl = (process.env.MAIN_DATABASE_URL || "").trim();
  if (mainUrl) {
    const main = new PrismaClient({ datasources: { db: { url: mainUrl } } });
    const mainDb = (await main.$queryRaw`SELECT current_database() AS db`)[0].db;
    const tables = await main.$queryRaw`
      SELECT tablename FROM pg_tables
      WHERE schemaname='public' AND tablename LIKE 'HomeSafeCollection%'`;
    await main.$disconnect();
    assert(mainDb !== "educlear_hs_cg_local", "MAIN_DATABASE_URL must not be iso");
    assert(tables.length === 0, `REFUSE: main DB ${mainDb} unexpectedly has Collections tables`);
    console.log(JSON.stringify({ phase: "main_untouched", mainDb, collectionsTables: 0 }, null, 2));
  }

  // Ensure school B staff with known password (iso only)
  let schoolB = await prisma.school.findFirst({
    where: { id: { not: SCHOOL_A }, users: { some: { isActive: true } } },
    select: { id: true, name: true },
  });
  assert(!!schoolB, "need a second school for tenant isolation");
  const passwordHash = await hashAuthPassword(PASS_B);
  const existingB = await prisma.user.findFirst({ where: { schoolId: schoolB.id, email: EMAIL_B } });
  if (existingB) {
    await prisma.user.update({
      where: { id: existingB.id },
      data: { passwordHash, isActive: true, role: "SCHOOL_ADMIN" },
    });
  } else {
    await prisma.user.create({
      data: {
        schoolId: schoolB.id,
        email: EMAIL_B,
        passwordHash,
        fullName: "HS CG Smoke B",
        role: "SCHOOL_ADMIN",
        isActive: true,
      },
    });
  }

  const learners = await prisma.learner.findMany({
    where: { schoolId: SCHOOL_A, enrollmentStatus: "ACTIVE" },
    take: 5,
    orderBy: { lastName: "asc" },
    select: { id: true },
  });
  assert(learners.length >= 3, "need ≥3 learners on school A");
  const [l1, l2, l3] = learners;

  // Unauthorized
  const unauth = await api("/api/homesafe/collections/groups");
  assert(unauth.status === 401, `unauth GET groups → 401, got ${unauth.status}`);

  // Login A
  const loginA = await api("/api/auth/login", {
    method: "POST",
    body: { email: EMAIL_A, password: PASS_A },
  });
  assert(loginA.status === 200 && loginA.json?.token, `login A failed ${loginA.status}`);
  assert(loginA.json.user?.schoolId === SCHOOL_A, "login A school mismatch");
  const tokenA = loginA.json.token;

  // Login B
  const loginB = await api("/api/auth/login", {
    method: "POST",
    body: { email: EMAIL_B, password: PASS_B },
  });
  assert(loginB.status === 200 && loginB.json?.token, `login B failed ${loginB.status}`);
  const tokenB = loginB.json.token;
  assert(loginB.json.user?.schoolId === schoolB.id, "login B school mismatch");

  // Confirm backend writes land only on iso
  await prisma.homeSafeCollectionGroup.deleteMany({
    where: { schoolId: SCHOOL_A, name: { startsWith: "HTTP Smoke " } },
  });

  const created = await api("/api/homesafe/collections/groups", {
    method: "POST",
    token: tokenA,
    body: { name: GROUP_NAME, kind: "ACTIVITY" },
  });
  assert(created.status === 201 && created.json?.group?.id, `create group ${created.status}`);
  const groupId = created.json.group.id;

  const inDb = await prisma.homeSafeCollectionGroup.findUnique({ where: { id: groupId } });
  assert(!!inDb && inDb.schoolId === SCHOOL_A, "group must persist on iso DB");
  const dbAfter = (await prisma.$queryRaw`SELECT current_database() AS db`)[0].db;
  assert(dbAfter === "educlear_hs_cg_local", "post-write prisma still iso");

  const tue = await api(`/api/homesafe/collections/groups/${groupId}/sessions`, {
    method: "POST",
    token: tokenA,
    body: {
      weekday: "Tue",
      startTime: "10:00",
      endTime: "10:30",
      responsibleAdult: "Coach Smoke",
      learnerIds: [l1.id, l2.id],
    },
  });
  assert(tue.status === 201, `create tue ${tue.status} ${JSON.stringify(tue.json)}`);
  const tueId = tue.json.session.id;

  const thu = await api(`/api/homesafe/collections/groups/${groupId}/sessions`, {
    method: "POST",
    token: tokenA,
    body: {
      weekday: "Thu",
      startTime: "10:00",
      endTime: "10:30",
      responsibleAdult: "Coach Smoke",
      learnerIds: [l1.id, l2.id],
    },
  });
  assert(thu.status === 201, `create thu ${thu.status}`);
  const thuId = thu.json.session.id;

  const put = await api(`/api/homesafe/collections/sessions/${tueId}/learners`, {
    method: "PUT",
    token: tokenA,
    body: { learnerIds: [l1.id, l2.id, l3.id] },
  });
  assert(put.status === 200 && put.json.learnerIds.includes(l3.id), "put tue roster");

  const tueGet = await api(`/api/homesafe/collections/sessions/${tueId}/learners`, { token: tokenA });
  const thuGet = await api(`/api/homesafe/collections/sessions/${thuId}/learners`, { token: tokenA });
  assert(tueGet.json.learnerIds.sort().join() === [l1.id, l2.id, l3.id].sort().join(), "tue has 3");
  assert(thuGet.json.learnerIds.sort().join() === [l1.id, l2.id].sort().join(), "thu still 2");

  const reg = await api(`/api/homesafe/collections/registers?date=2026-11-03`, { token: tokenA });
  assert(reg.status === 200 && reg.json.weekday === "Tue", "registers tue");
  assert(
    reg.json.rows.filter((r) => r.sessionId === tueId).length === 3,
    "register rows for tue"
  );

  // Tenant isolation
  const cross = await api(`/api/homesafe/collections/sessions/${tueId}/learners`, { token: tokenB });
  assert(cross.status === 403, `cross-tenant GET → 403 got ${cross.status}`);
  const crossWrite = await api(`/api/homesafe/collections/sessions/${tueId}/learners`, {
    method: "PUT",
    token: tokenB,
    body: { learnerIds: [l1.id] },
  });
  assert(crossWrite.status === 403, `cross-tenant PUT → 403 got ${crossWrite.status}`);

  // Remove from tue only
  const del = await api(`/api/homesafe/collections/sessions/${tueId}/learners/${l3.id}`, {
    method: "DELETE",
    token: tokenA,
  });
  assert(del.status === 200, "delete learner from tue");
  const tueAfter = await api(`/api/homesafe/collections/sessions/${tueId}/learners`, { token: tokenA });
  const thuAfter = await api(`/api/homesafe/collections/sessions/${thuId}/learners`, { token: tokenA });
  assert(tueAfter.json.learnerIds.sort().join() === [l1.id, l2.id].sort().join(), "l3 removed tue");
  assert(thuAfter.json.learnerIds.sort().join() === [l1.id, l2.id].sort().join(), "thu unchanged");

  console.log(
    JSON.stringify(
      {
        ok: true,
        prismaDb: dbAfter,
        schoolA: SCHOOL_A,
        schoolB: schoolB.id,
        groupId,
        tueId,
        thuId,
        checks: [
          "unauth_401",
          "core_login",
          "create_group_session",
          "assignment",
          "registers",
          "tenant_isolation",
          "session_scoped_remove",
          "iso_db_write_confirmed",
        ],
      },
      null,
      2
    )
  );
  console.log("homesafe-collections-http-smoke: OK");
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
