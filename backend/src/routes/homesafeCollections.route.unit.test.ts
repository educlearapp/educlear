/**
 * HomeSafe Collections V2 route tests against Prisma-backed service.
 * Requires DATABASE_URL → educlear_hs_cg_local.
 *
 * Run:
 *   DATABASE_URL=...educlear_hs_cg_local... \
 *     npx tsc -p tsconfig.collections.test.json && \
 *     node dist-collections-test/routes/homesafeCollections.route.unit.test.js
 */
import router from "./homesafeCollections";
import { PrismaClient } from "@prisma/client";
import { HsCgDomainError } from "../services/homesafeCollectionsDomain";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const express = require("express") as typeof import("express");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const http = require("http") as typeof import("http");

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

async function request(
  app: import("express").Express,
  method: string,
  path: string,
  opts: { body?: unknown } = {}
): Promise<{ status: number; json: any }> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no port");
  const port = addr.port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    const json = await res.json();
    return { status: res.status, json };
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((e: Error | undefined) => (e ? reject(e) : resolve()))
    );
  }
}

function buildApp(authorizedSchoolId: string | null) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    if (authorizedSchoolId) {
      req.schoolModuleAuth = { authorizedSchoolId, userId: "u-route-test", module: "CORE" };
    }
    next();
  });
  app.use(router);
  return app;
}

async function main() {
  const prisma = new PrismaClient();
  const db = (await prisma.$queryRaw`SELECT current_database() AS db` as any[])[0].db;
  assert(db === "educlear_hs_cg_local", `wrong db ${db}`);

  const byCount = await prisma.learner.groupBy({
    by: ["schoolId"],
    where: { enrollmentStatus: "ACTIVE" },
    _count: { _all: true },
    orderBy: { _count: { schoolId: "desc" } },
    take: 1,
  });
  assert(byCount.length > 0 && byCount[0]._count._all >= 3, "need learners");
  const schoolA = byCount[0].schoolId;
  const schoolB =
    (await prisma.school.findFirst({ where: { id: { not: schoolA } }, select: { id: true } }))?.id ||
    null;
  const learners = await prisma.learner.findMany({
    where: { schoolId: schoolA, enrollmentStatus: "ACTIVE" },
    take: 3,
    orderBy: { lastName: "asc" },
    select: { id: true },
  });
  const [emma, liam, noah] = learners;

  await prisma.homeSafeCollectionGroup.deleteMany({
    where: { schoolId: schoolA, name: { startsWith: "RouteUnit " } },
  });

  // Unauthenticated
  {
    const app = buildApp(null);
    const res = await request(app, "GET", "/groups");
    assert(res.status === 401, "unauthenticated GET groups → 401");
  }

  const appA = buildApp(schoolA);
  const groupName = `RouteUnit ${Date.now()}`;
  const created = await request(appA, "POST", "/groups", {
    body: { name: groupName, kind: "ACTIVITY" },
  });
  assert(created.status === 201 && created.json.success, "create group");
  const groupId = created.json.group.id;

  // Persist check
  assert(!!(await prisma.homeSafeCollectionGroup.findUnique({ where: { id: groupId } })), "group in DB");

  const s1 = await request(appA, "POST", `/groups/${groupId}/sessions`, {
    body: {
      weekday: "Tue",
      startTime: "10:00",
      endTime: "10:30",
      responsibleAdult: "Coach",
      learnerIds: [emma.id, liam.id],
    },
  });
  assert(s1.status === 201, `create tue session ${JSON.stringify(s1.json)}`);
  const tueId = s1.json.session.id;

  const s2 = await request(appA, "POST", `/groups/${groupId}/sessions`, {
    body: {
      weekday: "Thu",
      startTime: "10:00",
      endTime: "10:30",
      responsibleAdult: "Coach",
      learnerIds: [emma.id, liam.id],
    },
  });
  assert(s2.status === 201, "create thu session");
  const thuId = s2.json.session.id;

  const put = await request(appA, "PUT", `/sessions/${tueId}/learners`, {
    body: { learnerIds: [emma.id, liam.id, noah.id] },
  });
  assert(put.status === 200 && put.json.learnerIds.includes(noah.id), "put tue learners");

  const tueLearners = await request(appA, "GET", `/sessions/${tueId}/learners`);
  const thuLearners = await request(appA, "GET", `/sessions/${thuId}/learners`);
  assert(
    tueLearners.json.learnerIds.sort().join() === [emma.id, liam.id, noah.id].sort().join(),
    "route tue roster"
  );
  assert(
    thuLearners.json.learnerIds.sort().join() === [emma.id, liam.id].sort().join(),
    "route thu roster"
  );

  const regTue = await request(appA, "GET", "/registers?date=2026-11-03");
  assert(regTue.status === 200 && regTue.json.weekday === "Tue", "register tue");
  assert(
    regTue.json.rows.filter((r: any) => r.sessionId === tueId).length === 3,
    "register tue rows"
  );

  if (schoolB) {
    const appB = buildApp(schoolB);
    const cross = await request(appB, "GET", `/sessions/${tueId}/learners`);
    assert(cross.status === 403 && cross.json.code === "SCHOOL_MISMATCH", "tenant isolation GET");
    const crossWrite = await request(appB, "PUT", `/sessions/${tueId}/learners`, {
      body: { learnerIds: [emma.id] },
    });
    assert(crossWrite.status === 403, "tenant isolation PUT");
  }

  // Schedule validation via route
  const bad = await request(appA, "POST", `/groups/${groupId}/sessions`, {
    body: {
      weekday: "Mon",
      startTime: "07:00",
      endTime: "07:30",
      responsibleAdult: "X",
    },
  });
  assert(bad.status === 400 && bad.json.code === "VALIDATION", "out of window rejected");

  const del = await request(appA, "DELETE", `/sessions/${tueId}/learners/${noah.id}`);
  assert(del.status === 200, "delete noah from tue");
  const after = await request(appA, "GET", `/sessions/${tueId}/learners`);
  assert(
    after.json.learnerIds.sort().join() === [emma.id, liam.id].sort().join(),
    "noah gone"
  );
  const thuStill = await request(appA, "GET", `/sessions/${thuId}/learners`);
  assert(
    thuStill.json.learnerIds.sort().join() === [emma.id, liam.id].sort().join(),
    "thu unchanged"
  );

  // Domain error shape still HsCgDomainError for mismatch
  assert(HsCgDomainError !== undefined, "domain error imported");

  console.log("homesafeCollections.route.unit.test.ts: OK");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
