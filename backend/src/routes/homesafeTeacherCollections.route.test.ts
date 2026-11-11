/**
 * Teacher HomeSafe Collections route tests (isolated local DB).
 *
 * Run:
 *   DATABASE_URL=postgresql://educlear:educlearpass@localhost:5432/educlear_hs_cg_local \
 *     npx tsx src/routes/homesafeTeacherCollections.route.test.ts
 */
import bcrypt from "bcryptjs";
import express from "express";
import http from "http";
import jwt from "jsonwebtoken";
import teacherAppRoutes from "./teacherApp";
import { prisma } from "../prisma";

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function signToken(input: { userId: string; schoolId: string; email: string; role: string }) {
  return jwt.sign(input, JWT_SECRET, { expiresIn: "1h" });
}

async function startTestServer() {
  const app = express();
  app.use(express.json());
  app.use("/api/teacher-app", teacherAppRoutes);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}/api/teacher-app/homesafe/collections`,
    close: () =>
      new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

async function apiCall(
  baseUrl: string,
  path: string,
  options: { method?: string; body?: Record<string, unknown>; token?: string } = {}
) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  const res = await fetch(`${baseUrl}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

async function main() {
  const db = (await prisma.$queryRaw`SELECT current_database() AS db` as Array<{ db: string }>)[0]
    .db;
  assert(db === "educlear_hs_cg_local", `REFUSE: expected educlear_hs_cg_local, got ${db}`);

  const suffix = Date.now();
  const passwordHash = await bcrypt.hash("test-password", 4);
  const dateTue = "2026-11-10";
  const dateThu = "2026-11-12";

  const schoolA = await prisma.school.create({
    data: {
      name: `HS-CG Teacher A ${suffix}`,
      email: `hs-cg-teacher-a-${suffix}@test.local`,
    },
  });
  const schoolB = await prisma.school.create({
    data: {
      name: `HS-CG Teacher B ${suffix}`,
      email: `hs-cg-teacher-b-${suffix}@test.local`,
    },
  });

  // Zero-classroom authorised staff (no ClassroomTeacher rows).
  const teacherA = await prisma.user.create({
    data: {
      schoolId: schoolA.id,
      email: `zero-class-a-${suffix}@test.local`,
      passwordHash,
      fullName: "Zero Class Teacher A",
      role: "STAFF",
      isActive: true,
    },
  });
  const teacherB = await prisma.user.create({
    data: {
      schoolId: schoolB.id,
      email: `zero-class-b-${suffix}@test.local`,
      passwordHash,
      fullName: "Zero Class Teacher B",
      role: "STAFF",
      isActive: true,
    },
  });

  const learnersA = await Promise.all(
    ["Ada", "Ben", "Cara", "Dan"].map((first, i) =>
      prisma.learner.create({
        data: {
          schoolId: schoolA.id,
          firstName: first,
          lastName: `Tester${suffix}`,
          grade: "2",
          className: i % 2 === 0 ? "Grade 2A" : "Grade 2B",
          enrollmentStatus: "ACTIVE",
        },
      })
    )
  );
  const [ada, ben, cara, dan] = learnersA;

  const learnerB = await prisma.learner.create({
    data: {
      schoolId: schoolB.id,
      firstName: "Other",
      lastName: `School${suffix}`,
      grade: "3",
      className: "Grade 3A",
      enrollmentStatus: "ACTIVE",
    },
  });

  const transport = await prisma.homeSafeCollectionGroup.create({
    data: {
      schoolId: schoolA.id,
      name: `Bus Alpha ${suffix}`,
      kind: "TRANSPORT",
      driverName: "Sipho Driver",
      driverContact: "0820000001",
      vehicleReg: "CA 123-456",
    },
  });
  const activity = await prisma.homeSafeCollectionGroup.create({
    data: {
      schoolId: schoolA.id,
      name: `Chess Club ${suffix}`,
      kind: "ACTIVITY",
    },
  });
  const foreignGroup = await prisma.homeSafeCollectionGroup.create({
    data: {
      schoolId: schoolB.id,
      name: `Foreign Group ${suffix}`,
      kind: "ACTIVITY",
    },
  });

  const busTue = await prisma.homeSafeCollectionSession.create({
    data: {
      schoolId: schoolA.id,
      groupId: transport.id,
      weekday: "Tue",
      startTime: "14:00",
      endTime: "14:30",
      responsibleAdult: "Sipho Driver",
      location: "Front gate",
    },
  });
  const busThu = await prisma.homeSafeCollectionSession.create({
    data: {
      schoolId: schoolA.id,
      groupId: transport.id,
      weekday: "Thu",
      startTime: "14:00",
      endTime: "14:30",
      responsibleAdult: "Sipho Driver",
      location: "Front gate",
    },
  });
  const chessThuAm = await prisma.homeSafeCollectionSession.create({
    data: {
      schoolId: schoolA.id,
      groupId: activity.id,
      weekday: "Thu",
      startTime: "10:00",
      endTime: "10:30",
      responsibleAdult: "Ms Grove",
      location: "Hall",
    },
  });
  const chessThuPm = await prisma.homeSafeCollectionSession.create({
    data: {
      schoolId: schoolA.id,
      groupId: activity.id,
      weekday: "Thu",
      startTime: "14:00",
      endTime: "14:45",
      responsibleAdult: "Ms Grove",
      location: "Hall",
    },
  });
  const foreignSession = await prisma.homeSafeCollectionSession.create({
    data: {
      schoolId: schoolB.id,
      groupId: foreignGroup.id,
      weekday: "Thu",
      startTime: "11:00",
      endTime: "11:30",
      responsibleAdult: "Other",
    },
  });

  // Distinct Tue vs Thu transport rosters; two Thu activity sessions with different learners.
  await prisma.homeSafeCollectionMembership.createMany({
    data: [
      { schoolId: schoolA.id, sessionId: busTue.id, learnerId: ada.id },
      { schoolId: schoolA.id, sessionId: busTue.id, learnerId: ben.id },
      { schoolId: schoolA.id, sessionId: busThu.id, learnerId: cara.id },
      { schoolId: schoolA.id, sessionId: busThu.id, learnerId: dan.id },
      { schoolId: schoolA.id, sessionId: chessThuAm.id, learnerId: ada.id },
      { schoolId: schoolA.id, sessionId: chessThuAm.id, learnerId: cara.id },
      { schoolId: schoolA.id, sessionId: chessThuPm.id, learnerId: ben.id },
      { schoolId: schoolA.id, sessionId: chessThuPm.id, learnerId: dan.id },
      { schoolId: schoolB.id, sessionId: foreignSession.id, learnerId: learnerB.id },
    ],
  });

  const tokenA = signToken({
    userId: teacherA.id,
    schoolId: schoolA.id,
    email: teacherA.email,
    role: "STAFF",
  });
  const tokenB = signToken({
    userId: teacherB.id,
    schoolId: schoolB.id,
    email: teacherB.email,
    role: "STAFF",
  });

  const { baseUrl, close } = await startTestServer();

  try {
    const unauth = await apiCall(baseUrl, `/bootstrap?date=${dateThu}`);
    assert(unauth.status === 401, "unauthenticated bootstrap → 401");

    const tue = await apiCall(baseUrl, `/bootstrap?date=${dateTue}`, { token: tokenA });
    assert(tue.status === 200, `tue bootstrap ${tue.status}`);
    const tueJson = tue.json as any;
    assert(tueJson.success === true, "tue success");
    assert(tueJson.weekday === "Tue", "tue weekday");
    assert(Array.isArray(tueJson.groups) && tueJson.groups.length === 2, "school A has 2 groups");
    assert(
      !tueJson.groups.some((g: any) => g.id === foreignGroup.id),
      "tenant isolation: no school B groups"
    );
    const tueBus = tueJson.groups.find((g: any) => g.id === transport.id);
    assert(!!tueBus?.driverName && tueBus.vehicleReg === "CA 123-456", "driver/vehicle present");
    const tueBusSession = tueBus.sessions.find((s: any) => s.id === busTue.id);
    assert(
      JSON.stringify([...(tueBusSession.learnerIds || [])].sort()) ===
        JSON.stringify([ada.id, ben.id].sort()),
      "Tue bus roster Ada+Ben only"
    );
    const tueRegisterIds = (tueJson.registers || []).map((r: any) => r.learnerId).sort();
    assert(
      JSON.stringify(tueRegisterIds) === JSON.stringify([ada.id, ben.id].sort()),
      "Tue registers match Tue roster only"
    );

    const thu = await apiCall(baseUrl, `/bootstrap?date=${dateThu}`, { token: tokenA });
    assert(thu.status === 200, `thu bootstrap ${thu.status}`);
    const thuJson = thu.json as any;
    const thuBus = thuJson.groups.find((g: any) => g.id === transport.id);
    const thuBusSession = thuBus.sessions.find((s: any) => s.id === busThu.id);
    assert(
      JSON.stringify([...(thuBusSession.learnerIds || [])].sort()) ===
        JSON.stringify([cara.id, dan.id].sort()),
      "Thu bus roster Cara+Dan (different from Tue)"
    );
    const chess = thuJson.groups.find((g: any) => g.id === activity.id);
    const am = chess.sessions.find((s: any) => s.id === chessThuAm.id);
    const pm = chess.sessions.find((s: any) => s.id === chessThuPm.id);
    assert(am && pm, "two Thu activity sessions");
    assert(
      JSON.stringify([...(am.learnerIds || [])].sort()) ===
        JSON.stringify([ada.id, cara.id].sort()),
      "Thu AM chess roster"
    );
    assert(
      JSON.stringify([...(pm.learnerIds || [])].sort()) ===
        JSON.stringify([ben.id, dan.id].sort()),
      "Thu PM chess roster distinct"
    );

    const patch = await apiCall(baseUrl, "/registers", {
      method: "PATCH",
      token: tokenA,
      body: {
        sessionId: busThu.id,
        learnerId: cara.id,
        date: dateThu,
        progress: "READY",
      },
    });
    assert(patch.status === 200, `patch ${patch.status}`);
    assert((patch.json as any).row?.progress === "READY", "progress persisted");

    const refresh = await apiCall(baseUrl, `/bootstrap?date=${dateThu}`, { token: tokenA });
    const refreshed = ((refresh.json as any).registers || []).find(
      (r: any) => r.sessionId === busThu.id && r.learnerId === cara.id
    );
    assert(refreshed?.progress === "READY", "refresh persists READY");

    const cross = await apiCall(baseUrl, "/registers", {
      method: "PATCH",
      token: tokenA,
      body: {
        sessionId: foreignSession.id,
        learnerId: learnerB.id,
        date: dateThu,
        progress: "READY",
      },
    });
    assert(cross.status === 403 || cross.status === 404, "cross-tenant patch denied");

    const otherSchool = await apiCall(baseUrl, `/bootstrap?date=${dateThu}`, { token: tokenB });
    assert(otherSchool.status === 200, "school B bootstrap ok");
    assert(
      ((otherSchool.json as any).groups || []).every((g: any) => g.schoolId === schoolB.id),
      "school B only sees own groups"
    );
    assert(
      !((otherSchool.json as any).groups || []).some((g: any) => g.id === transport.id),
      "school B cannot see school A transport"
    );

    // Management endpoints must not be mounted on teacher collections.
    const createAttempt = await apiCall(baseUrl, "/groups", {
      method: "POST",
      token: tokenA,
      body: { name: "Should Fail", kind: "ACTIVITY" },
    });
    assert(
      createAttempt.status === 404 || createAttempt.status === 405,
      "teacher collections must not create groups"
    );

    assert(
      (thuJson.capabilities?.canManageGroups === false &&
        thuJson.capabilities?.canPatchRegister === true &&
        thuJson.capabilities?.hasCallAckWorkflow === false &&
        thuJson.capabilities?.hasRegisterActorAudit === false) as boolean,
      "capabilities advertise gaps honestly"
    );

    console.log("homesafeTeacherCollections.route.test.ts: PASS");
  } finally {
    await close();
    await prisma.homeSafeCollectionRegisterRow.deleteMany({
      where: { schoolId: { in: [schoolA.id, schoolB.id] } },
    });
    await prisma.homeSafeCollectionMembership.deleteMany({
      where: { schoolId: { in: [schoolA.id, schoolB.id] } },
    });
    await prisma.homeSafeCollectionSession.deleteMany({
      where: { schoolId: { in: [schoolA.id, schoolB.id] } },
    });
    await prisma.homeSafeCollectionGroup.deleteMany({
      where: { schoolId: { in: [schoolA.id, schoolB.id] } },
    });
    await prisma.learner.deleteMany({ where: { schoolId: { in: [schoolA.id, schoolB.id] } } });
    await prisma.user.deleteMany({ where: { schoolId: { in: [schoolA.id, schoolB.id] } } });
    await prisma.school.deleteMany({ where: { id: { in: [schoolA.id, schoolB.id] } } });
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
