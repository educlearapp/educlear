/**
 * Teacher HomeSafe Collections — management + register route tests (isolated local DB).
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
  const inactiveA = await prisma.user.create({
    data: {
      schoolId: schoolA.id,
      email: `inactive-a-${suffix}@test.local`,
      passwordHash,
      fullName: "Inactive Teacher A",
      role: "STAFF",
      isActive: false,
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
    ["Ada", "Ben", "Cara", "Dan", "Eve"].map((first, i) =>
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
  const [ada, ben, cara, dan, eve] = learnersA;

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

  const tokenA = signToken({
    userId: teacherA.id,
    schoolId: schoolA.id,
    email: teacherA.email,
    role: "STAFF",
  });
  const tokenInactive = signToken({
    userId: inactiveA.id,
    schoolId: schoolA.id,
    email: inactiveA.email,
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

    const inactiveCreate = await apiCall(baseUrl, "/groups", {
      method: "POST",
      token: tokenInactive,
      body: { name: `Blocked ${suffix}`, kind: "ACTIVITY" },
    });
    assert(inactiveCreate.status === 403, "inactive teacher cannot create");

    // 1–2 Create Transport + Activity
    const transportCreate = await apiCall(baseUrl, "/groups", {
      method: "POST",
      token: tokenA,
      body: {
        name: `Bus Alpha ${suffix}`,
        kind: "TRANSPORT",
        driverName: "Sipho Driver",
        driverContact: "0820000001",
        vehicleReg: "CA 123-456",
      },
    });
    assert(transportCreate.status === 201, `transport create ${transportCreate.status}`);
    const transport = (transportCreate.json as any).group;
    assert(transport?.kind === "TRANSPORT", "transport kind");

    const activityCreate = await apiCall(baseUrl, "/groups", {
      method: "POST",
      token: tokenA,
      body: { name: `Dance Mouse ${suffix}`, kind: "ACTIVITY" },
    });
    assert(activityCreate.status === 201, `activity create ${activityCreate.status}`);
    const activity = (activityCreate.json as any).group;

    // Duplicate name blocked
    const dup = await apiCall(baseUrl, "/groups", {
      method: "POST",
      token: tokenA,
      body: { name: `Dance Mouse ${suffix}`, kind: "ACTIVITY" },
    });
    assert(dup.status === 409 || dup.status === 400, "duplicate group name blocked");

    // 4 Edit group name
    const renamed = await apiCall(baseUrl, `/groups/${activity.id}`, {
      method: "PATCH",
      token: tokenA,
      body: { name: `Dance Mouse Renamed ${suffix}`, expectedUpdatedAt: activity.updatedAt },
    });
    assert(renamed.status === 200, `rename ${renamed.status}`);
    assert((renamed.json as any).group?.name === `Dance Mouse Renamed ${suffix}`, "name persisted");
    const activityName = (renamed.json as any).group.name;
    const activityUpdatedAt = (renamed.json as any).group.updatedAt;

    // Stale concurrent edit
    const stale = await apiCall(baseUrl, `/groups/${activity.id}`, {
      method: "PATCH",
      token: tokenA,
      body: { name: "Should Fail", expectedUpdatedAt: activity.updatedAt },
    });
    assert(stale.status === 409, "stale expectedUpdatedAt → 409");

    // 5–9 Sessions + distinct rosters
    const tueSession = await apiCall(baseUrl, `/groups/${activity.id}/sessions`, {
      method: "POST",
      token: tokenA,
      body: {
        weekday: "Tue",
        startTime: "09:00",
        endTime: "09:45",
        responsibleAdult: "Ms Grove",
        learnerIds: [ada.id, ben.id, cara.id],
      },
    });
    assert(tueSession.status === 201, `tue session ${tueSession.status}`);
    const tueId = (tueSession.json as any).session.id;

    const thuSessions = await apiCall(baseUrl, `/groups/${activity.id}/sessions`, {
      method: "POST",
      token: tokenA,
      body: {
        weekdays: ["Thu"],
        startTime: "10:00",
        endTime: "10:45",
        responsibleAdult: "Ms Grove",
        learnerIds: [dan.id, eve.id],
      },
    });
    assert(thuSessions.status === 201, `thu session ${thuSessions.status}`);
    const thuId =
      (thuSessions.json as any).session?.id || (thuSessions.json as any).sessions?.[0]?.id;
    assert(!!thuId, "thu session id");

    const thuPm = await apiCall(baseUrl, `/groups/${activity.id}/sessions`, {
      method: "POST",
      token: tokenA,
      body: {
        weekday: "Thu",
        startTime: "14:00",
        endTime: "14:45",
        responsibleAdult: "Ms Grove",
        learnerIds: [ada.id],
      },
    });
    assert(thuPm.status === 201, `thu pm ${thuPm.status}`);
    const thuPmId = (thuPm.json as any).session.id;

    // Once-weekly learner: Ben only Tue; Eve only Thu AM
    // Multi-weekly: Ada on Tue + Thu PM
    const setThuPm = await apiCall(baseUrl, `/sessions/${thuPmId}/learners`, {
      method: "PUT",
      token: tokenA,
      body: { learnerIds: [ada.id, ben.id] },
    });
    assert(setThuPm.status === 200, "set thu pm roster");

    // Changing Thu must not modify Tue
    const tueRoster = await apiCall(baseUrl, `/sessions/${tueId}/learners`, { token: tokenA });
    assert(
      JSON.stringify([...((tueRoster.json as any).learnerIds || [])].sort()) ===
        JSON.stringify([ada.id, ben.id, cara.id].sort()),
      "Tue roster unchanged after Thu edits"
    );

    const thuRoster = await apiCall(baseUrl, `/sessions/${thuId}/learners`, { token: tokenA });
    assert(
      JSON.stringify([...((thuRoster.json as any).learnerIds || [])].sort()) ===
        JSON.stringify([dan.id, eve.id].sort()),
      "Thu AM distinct roster"
    );

    // 10–11 Remove + duplicate prevention
    const remove = await apiCall(baseUrl, `/sessions/${tueId}/learners/${cara.id}`, {
      method: "DELETE",
      token: tokenA,
    });
    assert(remove.status === 200, "remove learner");
    const afterRemove = await apiCall(baseUrl, `/sessions/${tueId}/learners`, { token: tokenA });
    assert(
      !((afterRemove.json as any).learnerIds || []).includes(cara.id),
      "cara removed from Tue only"
    );

    const assignDup = await apiCall(baseUrl, "/assignments", {
      method: "POST",
      token: tokenA,
      body: { learnerIds: [ada.id], sessionIds: [tueId] },
    });
    assert(assignDup.status === 200, "assign ok");
    assert((assignDup.json as any).skippedDup >= 1, "duplicate membership skipped");

    // Transport sessions for register tests
    const busTue = await apiCall(baseUrl, `/groups/${transport.id}/sessions`, {
      method: "POST",
      token: tokenA,
      body: {
        weekday: "Tue",
        startTime: "14:00",
        endTime: "14:30",
        learnerIds: [ada.id, ben.id],
      },
    });
    const busThu = await apiCall(baseUrl, `/groups/${transport.id}/sessions`, {
      method: "POST",
      token: tokenA,
      body: {
        weekday: "Thu",
        startTime: "14:00",
        endTime: "14:30",
        learnerIds: [cara.id, dan.id],
      },
    });
    assert(busTue.status === 201 && busThu.status === 201, "bus sessions");
    const busTueId = (busTue.json as any).session.id;
    const busThuId = (busThu.json as any).session.id;

    const tue = await apiCall(baseUrl, `/bootstrap?date=${dateTue}`, { token: tokenA });
    assert(tue.status === 200, `tue bootstrap ${tue.status}`);
    const tueJson = tue.json as any;
    assert(tueJson.capabilities?.canManageGroups === true, "canManageGroups true");
    assert(tueJson.capabilities?.hasRegisterActorAudit === false, "no fabricated audit");
    assert(
      !tueJson.groups.some((g: any) => g.schoolId && g.schoolId !== schoolA.id),
      "only school A"
    );

    const patch = await apiCall(baseUrl, "/registers", {
      method: "PATCH",
      token: tokenA,
      body: {
        sessionId: busThuId,
        learnerId: cara.id,
        date: dateThu,
        progress: "READY",
      },
    });
    assert(patch.status === 200, `patch ${patch.status}`);
    assert((patch.json as any).row?.progress === "READY", "progress persisted");

    const refresh = await apiCall(baseUrl, `/bootstrap?date=${dateThu}`, { token: tokenA });
    const refreshed = ((refresh.json as any).registers || []).find(
      (r: any) => r.sessionId === busThuId && r.learnerId === cara.id
    );
    assert(refreshed?.progress === "READY", "refresh persists READY");

    // 12 Safe delete blocked when register history exists
    const impactBlocked = await apiCall(baseUrl, `/groups/${transport.id}/deletion-impact`, {
      token: tokenA,
    });
    assert((impactBlocked.json as any).impact?.canDelete === false, "delete blocked with history");
    const delBlocked = await apiCall(baseUrl, `/groups/${transport.id}`, {
      method: "DELETE",
      token: tokenA,
      body: { confirmName: transport.name, expectedUpdatedAt: transport.updatedAt },
    });
    assert(delBlocked.status === 409, "delete with history → 409");

    // Empty group can delete
    const emptyCreate = await apiCall(baseUrl, "/groups", {
      method: "POST",
      token: tokenA,
      body: { name: `Temp Empty ${suffix}`, kind: "ACTIVITY" },
    });
    const empty = (emptyCreate.json as any).group;
    const delEmpty = await apiCall(baseUrl, `/groups/${empty.id}`, {
      method: "DELETE",
      token: tokenA,
      body: { confirmName: empty.name, expectedUpdatedAt: empty.updatedAt },
    });
    assert(delEmpty.status === 200, "empty group deletes");

    // Session delete blocked after register history on busThu
    const delSession = await apiCall(baseUrl, `/sessions/${busThuId}`, {
      method: "DELETE",
      token: tokenA,
      body: {},
    });
    assert(delSession.status === 409, "session with register history blocked");

    // 15 Tenant isolation
    const cross = await apiCall(baseUrl, `/groups/${transport.id}`, {
      method: "PATCH",
      token: tokenB,
      body: { name: "Hijack" },
    });
    assert(cross.status === 403 || cross.status === 404, "cross-tenant group edit denied");

    const crossLearners = await apiCall(baseUrl, `/sessions/${busTueId}/learners`, {
      method: "PUT",
      token: tokenB,
      body: { learnerIds: [learnerB.id] },
    });
    assert(
      crossLearners.status === 403 || crossLearners.status === 404,
      "cross-tenant roster denied"
    );

    const foreignLearner = await apiCall(baseUrl, `/sessions/${tueId}/learners`, {
      method: "PUT",
      token: tokenA,
      body: { learnerIds: [ada.id, learnerB.id] },
    });
    assert(foreignLearner.status === 400, "foreign school learner rejected");

    const otherSchool = await apiCall(baseUrl, `/bootstrap?date=${dateThu}`, { token: tokenB });
    assert(
      !((otherSchool.json as any).groups || []).some((g: any) => g.id === transport.id),
      "school B cannot see school A groups"
    );

    // Shared Admin/Teacher persistence: group still visible via shared Prisma tables
    const adminVisible = await prisma.homeSafeCollectionGroup.findUnique({
      where: { id: activity.id },
    });
    assert(adminVisible?.name === activityName, "Admin/Teacher share same group row");
    assert(adminVisible?.updatedAt.toISOString() === activityUpdatedAt, "updatedAt matches");

    // Directory learners endpoint (no classroom required)
    const dir = await apiCall(baseUrl, "/learners", { token: tokenA });
    assert(dir.status === 200, "learners directory");
    assert(((dir.json as any).learners || []).length >= 5, "school learners listed");

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
