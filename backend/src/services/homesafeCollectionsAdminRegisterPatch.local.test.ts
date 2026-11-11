/**
 * Admin register PATCH persistence (isolated local DB).
 * Run: DATABASE_URL=...educlear_hs_cg_local... npx tsx src/services/homesafeCollectionsAdminRegisterPatch.local.test.ts
 */
import { PrismaClient } from "@prisma/client";
import { PrismaHomeSafeCollectionsService } from "./homesafeCollectionsPrismaService";

const prisma = new PrismaClient();
function assert(c: boolean, m: string) {
  if (!c) throw new Error(m);
}

async function main() {
  const db = (await prisma.$queryRaw`SELECT current_database() AS db` as Array<{ db: string }>)[0].db;
  assert(db === "educlear_hs_cg_local", `wrong db ${db}`);
  const suffix = Date.now();
  const school = await prisma.school.create({
    data: { name: `AdminPatch ${suffix}`, email: `ap-${suffix}@t.local` },
  });
  const learner = await prisma.learner.create({
    data: {
      schoolId: school.id,
      firstName: "Pat",
      lastName: "Ch",
      grade: "1",
      className: "1A",
      enrollmentStatus: "ACTIVE",
    },
  });
  const group = await prisma.homeSafeCollectionGroup.create({
    data: {
      schoolId: school.id,
      name: `Bus ${suffix}`,
      kind: "TRANSPORT",
      driverName: "D",
      vehicleReg: "CA1",
    },
  });
  const session = await prisma.homeSafeCollectionSession.create({
    data: {
      schoolId: school.id,
      groupId: group.id,
      weekday: "Wed",
      startTime: "14:00",
      endTime: "14:30",
      responsibleAdult: "D",
    },
  });
  await prisma.homeSafeCollectionMembership.create({
    data: { schoolId: school.id, sessionId: session.id, learnerId: learner.id },
  });
  const svc = new PrismaHomeSafeCollectionsService();
  const date = "2026-11-11";
  await svc.getRegistersForDate(school.id, date);
  const a = await svc.patchRegisterRow({
    schoolId: school.id,
    sessionId: session.id,
    learnerId: learner.id,
    schoolLocalDate: date,
    progress: "READY",
  });
  assert(a.progress === "READY", "ready");
  const b = await svc.patchRegisterRow({
    schoolId: school.id,
    sessionId: session.id,
    learnerId: learner.id,
    schoolLocalDate: date,
    progress: "COLLECTED",
    note: "Collected by D",
  });
  assert(b.progress === "COLLECTED", "collected");
  await Promise.all([
    svc.patchRegisterRow({
      schoolId: school.id,
      sessionId: session.id,
      learnerId: learner.id,
      schoolLocalDate: date,
      progress: "READY",
    }),
    svc.patchRegisterRow({
      schoolId: school.id,
      sessionId: session.id,
      learnerId: learner.id,
      schoolLocalDate: date,
      progress: "COLLECTED",
    }),
  ]);
  const final = await prisma.homeSafeCollectionRegisterRow.findUnique({
    where: {
      sessionId_learnerId_schoolLocalDate: {
        sessionId: session.id,
        learnerId: learner.id,
        schoolLocalDate: date,
      },
    },
  });
  assert(final?.progress === "READY" || final?.progress === "COLLECTED", "concurrent winner");
  const refresh = await svc.getRegistersForDate(school.id, date);
  const row = refresh.rows.find((r) => r.learnerId === learner.id && r.sessionId === session.id);
  assert(row?.progress === final?.progress, "refresh matches DB");
  await prisma.homeSafeCollectionRegisterRow.deleteMany({ where: { schoolId: school.id } });
  await prisma.homeSafeCollectionMembership.deleteMany({ where: { schoolId: school.id } });
  await prisma.homeSafeCollectionSession.deleteMany({ where: { schoolId: school.id } });
  await prisma.homeSafeCollectionGroup.deleteMany({ where: { schoolId: school.id } });
  await prisma.learner.deleteMany({ where: { schoolId: school.id } });
  await prisma.school.delete({ where: { id: school.id } });
  console.log("homesafeCollectionsAdminRegisterPatch.local.test.ts: PASS", {
    finalProgress: final?.progress,
  });
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
