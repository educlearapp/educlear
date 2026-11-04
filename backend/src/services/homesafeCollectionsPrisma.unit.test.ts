/**
 * Prisma Collections service tests — requires educlear_hs_cg_local.
 * Run:
 *   DATABASE_URL="$(grep DATABASE_URL .env.collections-local | cut -d= -f2-)" \
 *     npx tsc -p tsconfig.collections.test.json && \
 *     node dist-collections-test/services/homesafeCollectionsPrisma.unit.test.js
 */
import { PrismaClient } from "@prisma/client";
import { PrismaHomeSafeCollectionsService } from "./homesafeCollectionsPrismaService";
import { HsCgDomainError } from "./homesafeCollectionsDomain";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
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
  assert(byCount.length > 0 && byCount[0]._count._all >= 5, "need learners");
  const schoolId = byCount[0].schoolId;
  const learners = await prisma.learner.findMany({
    where: { schoolId, enrollmentStatus: "ACTIVE" },
    take: 6,
    orderBy: { lastName: "asc" },
  });
  assert(learners.length >= 5, "need learners");
  const other = await prisma.school.findFirst({ where: { id: { not: schoolId } } });
  const [a, b, c, d, e] = learners;

  const svc = new PrismaHomeSafeCollectionsService();
  await prisma.homeSafeCollectionGroup.deleteMany({
    where: { schoolId, name: { startsWith: "PrismaUnit " } },
  });

  const group = await svc.createGroup({
    schoolId,
    name: `PrismaUnit ${Date.now()}`,
    kind: "ACTIVITY",
  });

  const tue = await svc.createSession({
    schoolId,
    groupId: group.id,
    weekday: "Tue",
    startTime: "10:00",
    endTime: "10:30",
    responsibleAdult: "Coach",
    learnerIds: [a.id, b.id],
  });
  const thu = await svc.createSession({
    schoolId,
    groupId: group.id,
    weekday: "Thu",
    startTime: "10:00",
    endTime: "10:30",
    responsibleAdult: "Coach",
    learnerIds: [a.id, b.id],
  });
  const thu2 = await svc.createSession({
    schoolId,
    groupId: group.id,
    weekday: "Thu",
    startTime: "14:00",
    endTime: "14:30",
    responsibleAdult: "Coach",
    learnerIds: [d.id, e.id],
  });

  const sessions = await svc.listSessionsForGroup(schoolId, group.id);
  assert(sessions.length === 3, "3 sessions");
  assert(sessions.filter((s) => s.weekday === "Thu").length === 2, "two Thu slots");

  await svc.setSessionLearners({
    schoolId,
    sessionId: tue.session.id,
    learnerIds: [a.id, b.id, c.id],
  });
  assert(
    (await svc.getSessionLearnerIds(schoolId, tue.session.id)).sort().join() ===
      [a.id, b.id, c.id].sort().join(),
    "tue roster"
  );
  assert(
    (await svc.getSessionLearnerIds(schoolId, thu.session.id)).sort().join() ===
      [a.id, b.id].sort().join(),
    "thu unchanged"
  );

  await svc.removeLearnerFromSession({
    schoolId,
    sessionId: tue.session.id,
    learnerId: c.id,
  });
  assert(
    (await svc.getSessionLearnerIds(schoolId, tue.session.id)).sort().join() ===
      [a.id, b.id].sort().join(),
    "c removed tue only"
  );
  assert(
    (await svc.getSessionLearnerIds(schoolId, thu.session.id)).sort().join() ===
      [a.id, b.id].sort().join(),
    "thu still ab"
  );

  const regTue = await svc.getRegistersForDate(schoolId, "2026-11-03");
  assert(regTue.weekday === "Tue", "tue date");
  assert(
    regTue.rows.filter((r) => r.sessionId === tue.session.id).length === 2,
    "tue register rows"
  );
  const regThu = await svc.getRegistersForDate(schoolId, "2026-11-05");
  assert(
    regThu.rows.filter((r) => r.sessionId === thu.session.id).length === 2,
    "thu am register"
  );
  assert(
    regThu.rows.filter((r) => r.sessionId === thu2.session.id).length === 2,
    "thu pm register"
  );

  // restart survival: new service instance reads same DB
  const svc2 = new PrismaHomeSafeCollectionsService();
  assert(
    (await svc2.getSessionLearnerIds(schoolId, tue.session.id)).sort().join() ===
      [a.id, b.id].sort().join(),
    "survives new service instance"
  );

  // schedule validation
  let rejected = false;
  try {
    await svc.createSession({
      schoolId,
      groupId: group.id,
      weekday: "Mon",
      startTime: "07:00",
      endTime: "07:30",
      responsibleAdult: "X",
    });
  } catch (err) {
    rejected = err instanceof HsCgDomainError && err.code === "VALIDATION";
  }
  assert(rejected, "out of window rejected");

  // cross-tenant
  if (other) {
    let mismatch = false;
    try {
      await svc.getGroup(other.id, group.id);
    } catch (err) {
      mismatch = err instanceof HsCgDomainError && err.code === "SCHOOL_MISMATCH";
    }
    assert(mismatch, "cross-tenant blocked");
  }

  // duplicate group name
  let conflict = false;
  try {
    await svc.createGroup({ schoolId, name: group.name, kind: "ACTIVITY" });
  } catch (err) {
    conflict = err instanceof HsCgDomainError && err.code === "CONFLICT";
  }
  assert(conflict, "duplicate group name rejected");

  // concurrent membership updates on same session — last write wins, no crash
  await Promise.all([
    svc.setSessionLearners({ schoolId, sessionId: tue.session.id, learnerIds: [a.id, c.id] }),
    svc.setSessionLearners({ schoolId, sessionId: tue.session.id, learnerIds: [b.id, d.id] }),
  ]);
  const concurrentIds = await svc.getSessionLearnerIds(schoolId, tue.session.id);
  assert(concurrentIds.length === 2, "concurrent set ends with exactly 2");
  assert(
    concurrentIds.every((id) => [a.id, b.id, c.id, d.id].includes(id)),
    "concurrent set learners from one of the writers"
  );
  // Thursday must remain untouched by concurrent Tue writes
  assert(
    (await svc.getSessionLearnerIds(schoolId, thu.session.id)).sort().join() ===
      [a.id, b.id].sort().join(),
    "thu isolated from concurrent tue writes"
  );

  // Fresh PrismaClient (simulates backend restart) must still see rows
  await prisma.$disconnect();
  const prismaB = new PrismaClient();
  const sessionCount = await prismaB.homeSafeCollectionSession.count({
    where: { groupId: group.id },
  });
  assert(sessionCount === 3, "sessions survive prisma reconnect");
  const thuRows = await prismaB.homeSafeCollectionMembership.findMany({
    where: { sessionId: thu.session.id },
    select: { learnerId: true },
  });
  assert(
    thuRows.map((r) => r.learnerId).sort().join() === [a.id, b.id].sort().join(),
    "thu roster survives reconnect"
  );
  await prismaB.$disconnect();

  console.log("homesafeCollectionsPrisma.unit.test.ts: OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
