/**
 * Cross-subsystem classroom membership tests (local DB, disposable test schools).
 * Teacher portal, parent threads, communications, attendance, registration stats, delete semantics.
 * Run: npx ts-node --transpile-only src/routes/classroomMembership.subsystems.route.test.ts
 */
import express from "express";
import http from "http";
import jwt from "jsonwebtoken";
import { prisma } from "../prisma";
import classroomsRoutes from "./classrooms";
import attendanceRoutes from "./attendance";
import teacherAppRoutes from "./teacherApp";
import { STAFF_JWT_SECRET } from "../utils/staffJwt";
import { getOrCreateThread, syncParentThreadsForClassroom } from "../services/parentPortalService";
import { loadCommunicationRecipients } from "../services/communicationRecipientService";
import { buildAttendanceReport } from "../services/attendanceReportService";
import { buildRegistrationStats } from "../services/registrationStatsService";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

if (!/localhost|127\.0\.0\.1/.test(String(process.env.DATABASE_URL || ""))) {
  throw new Error("Refusing to run: DATABASE_URL must point at a local database");
}

type Call = (
  method: string,
  path: string,
  body?: unknown,
  token?: string
) => Promise<{ status: number; json: any }>;

async function startServer(): Promise<{ call: Call; close: () => void }> {
  const app = express();
  app.use(express.json());
  app.use("/api/classrooms", classroomsRoutes);
  app.use("/api/attendance", attendanceRoutes);
  app.use("/api/teacher-app", teacherAppRoutes);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;
  const call: Call = async (method, path, body, token) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  return { call, close: () => server.close() };
}

async function createFixture() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const school = await prisma.school.create({
    data: { name: `EduClear Test School membership ${suffix}`, email: `mem-a-${suffix}@test.local` },
  });
  const otherSchool = await prisma.school.create({
    data: { name: `EduClear Test School membership other ${suffix}`, email: `mem-b-${suffix}@test.local` },
  });
  const S = school.id;
  const O = otherSchool.id;
  const teacherEmail = `teacher-ra-${suffix}@test.local`;
  const ra = await prisma.classroom.create({
    data: { schoolId: S, name: "Grade RA", teacherName: "Teacher RA", teacherEmail },
  });
  const rb = await prisma.classroom.create({ data: { schoolId: S, name: "Grade RB" } });
  const g1 = await prisma.classroom.create({
    data: { schoolId: S, name: "Grade 1A", teacherName: "Teacher 1A", teacherEmail: `teacher-1a-${suffix}@test.local` },
  });
  const otherRa = await prisma.classroom.create({ data: { schoolId: O, name: "Grade RA" } });

  const mk = (schoolId: string, data: Record<string, unknown>) =>
    prisma.learner.create({ data: { schoolId, grade: "Grade R", ...data } as any });
  const family = await prisma.familyAccount.create({
    data: { schoolId: S, accountRef: `MEM${suffix.slice(-6)}`, familyName: "Membership" },
  });
  const L = {
    raExact: await mk(S, { firstName: "Ava", lastName: "Exact", className: "Grade RA" }),
    raSasams: await mk(S, {
      firstName: "Ben", lastName: "Sasams", className: "Grade Ra", familyAccountId: family.id,
    }),
    raSpaced: await mk(S, { firstName: "Cara", lastName: "Spaced", className: " Grade RA " }),
    raHistorical: await mk(S, {
      firstName: "Dan", lastName: "Historical", className: "Grade RA", enrollmentStatus: "HISTORICAL",
    }),
    rbExact: await mk(S, { firstName: "Eve", lastName: "RbExact", className: "Grade RB" }),
    g1: await mk(S, { firstName: "Hal", lastName: "GradeOne", grade: "Grade 1", className: "Grade 1A" }),
  };
  const otherLearner = await mk(O, { firstName: "Ivy", lastName: "OtherSchool", className: "Grade Ra" });

  const mkParent = (schoolId: string, name: string) =>
    prisma.parent.create({
      data: { schoolId, firstName: name, surname: "Parent", cellNo: "0820000000", email: `${name.toLowerCase()}-${suffix}@test.local` },
    });
  const P = {
    sasams: await mkParent(S, "Sasams"),
    historical: await mkParent(S, "Historical"),
    g1: await mkParent(S, "GradeOne"),
    other: await mkParent(O, "Other"),
  };
  const link = (schoolId: string, parentId: string, learnerId: string) =>
    prisma.parentLearnerLink.create({ data: { schoolId, parentId, learnerId, isPrimary: true } });
  await link(S, P.sasams.id, L.raSasams.id);
  await link(S, P.historical.id, L.raHistorical.id);
  await link(S, P.g1.id, L.g1.id);
  await link(O, P.other.id, otherLearner.id);
  await prisma.learnerBillingPlanLine.create({
    data: { schoolId: S, learnerId: L.raSasams.id, feeDescription: "Grade R Fee", amount: 1500 },
  });

  return { S, O, suffix, teacherEmail, ra, rb, g1, otherRa, L, otherLearner, P, family };
}

type Fixture = Awaited<ReturnType<typeof createFixture>>;

async function cleanup(fx: Fixture) {
  const schoolIds = [fx.S, fx.O];
  await prisma.parentTeacherThread.deleteMany({ where: { schoolId: { in: schoolIds } } });
  await prisma.learnerBillingPlanLine.deleteMany({ where: { schoolId: { in: schoolIds } } });
  await prisma.parentLearnerLink.deleteMany({ where: { schoolId: { in: schoolIds } } });
  await prisma.parent.deleteMany({ where: { schoolId: { in: schoolIds } } });
  await prisma.learner.deleteMany({ where: { schoolId: { in: schoolIds } } });
  await prisma.familyAccount.deleteMany({ where: { schoolId: { in: schoolIds } } });
  await prisma.classroom.deleteMany({ where: { schoolId: { in: schoolIds } } });
  await prisma.school.deleteMany({ where: { id: { in: schoolIds } } });
}

async function relationshipSnapshot(schoolIds: string[]) {
  const learners = await prisma.learner.findMany({
    where: { schoolId: { in: schoolIds } },
    select: { id: true, schoolId: true, familyAccountId: true, admissionNo: true, enrollmentStatus: true },
    orderBy: { id: "asc" },
  });
  const links = await prisma.parentLearnerLink.findMany({
    where: { schoolId: { in: schoolIds } },
    select: { parentId: true, learnerId: true, isPrimary: true },
    orderBy: [{ learnerId: "asc" }, { parentId: "asc" }],
  });
  const billing = await prisma.learnerBillingPlanLine.findMany({
    where: { schoolId: { in: schoolIds } },
    select: { learnerId: true, feeDescription: true, amount: true },
    orderBy: { learnerId: "asc" },
  });
  const families = await prisma.familyAccount.findMany({
    where: { schoolId: { in: schoolIds } },
    select: { id: true, accountRef: true },
    orderBy: { id: "asc" },
  });
  return JSON.stringify({ learners, links, billing, families });
}

const sorted = (ids: string[]) => [...ids].sort();
const same = (a: string[], b: string[]) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

async function run() {
  const { call, close } = await startServer();
  const fx = await createFixture();
  const { S, O, L } = fx;
  const relationshipsBefore = await relationshipSnapshot([S, O]);
  const token = jwt.sign(
    { userId: `teacher-${fx.suffix}`, schoolId: S, email: fx.teacherEmail, role: "TEACHER" },
    STAFF_JWT_SECRET
  );
  const raRoster = [L.raExact.id, L.raSasams.id, L.raSpaced.id];
  let passed = 0;
  const test = async (name: string, fn: () => Promise<void>) => {
    await fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  };
  const detailIds = async (id: string) =>
    ((await call("GET", `/api/classrooms/${encodeURIComponent(id)}?schoolId=${S}`)).json?.classroom?.learners ||
      []).map((l: any) => l.id) as string[];

  try {
    await test("1. teacher portal returns the Grade Ra learner for Grade RA (list + count)", async () => {
      const me = await call("GET", "/api/teacher-app/me", undefined, token);
      assert(me.status === 200, `me status ${me.status}`);
      const room = (me.json.classrooms || []).find((c: any) => c.id === fx.ra.id);
      assert(room?.learnerCount === 3, `teacher learnerCount ${room?.learnerCount}`);
      const res = await call("GET", "/api/teacher-app/learners?className=Grade%20RA", undefined, token);
      assert(res.status === 200, `teacher learners status ${res.status}`);
      const ids = res.json.learners.map((l: any) => l.id);
      assert(same(ids, raRoster), `teacher roster ${ids}`);
      assert(same(ids, await detailIds(fx.ra.id)), "teacher roster equals classroom management roster");
      const att = await call(
        "GET",
        "/api/teacher-app/attendance?className=Grade%20RA&date=2026-10-05&period=DAILY",
        undefined,
        token
      );
      assert(att.status === 200, `teacher attendance status ${att.status}`);
      assert(same(att.json.learners.map((l: any) => l.id), raRoster), "teacher attendance roster");
    });

    await test("2. parent-thread sync and thread creation find the same learner without renaming classrooms", async () => {
      const thread = await prisma.parentTeacherThread.create({
        data: { schoolId: S, parentId: fx.P.sasams.id, learnerId: L.raSasams.id },
      });
      const sync = await syncParentThreadsForClassroom(S, fx.ra.id);
      assert(sync.updated === 1, `sync updated ${sync.updated}`);
      const after = await prisma.parentTeacherThread.findUnique({ where: { id: thread.id } });
      assert(after?.classroomId === fx.ra.id, `thread classroom ${after?.classroomId}`);
      assert(after?.teacherEmail === fx.teacherEmail, `thread teacher ${after?.teacherEmail}`);
      await prisma.parentTeacherThread.delete({ where: { id: thread.id } });
      const created = await getOrCreateThread({ schoolId: S, parentId: fx.P.sasams.id, learnerId: L.raSasams.id });
      assert(created.thread.classroomId === fx.ra.id, `new thread classroom ${created.thread.classroomId}`);
      assert(created.thread.teacherEmail === fx.teacherEmail, `new thread teacher ${created.thread.teacherEmail}`);
      const rooms = await prisma.classroom.findMany({ where: { schoolId: S }, orderBy: { createdAt: "asc" } });
      assert(
        JSON.stringify(rooms.map((r) => r.name)) === JSON.stringify(["Grade RA", "Grade RB", "Grade 1A"]),
        `classrooms renamed/created: ${rooms.map((r) => r.name)}`
      );
    });

    await test("3. communications recipients use the same membership", async () => {
      const parents = await loadCommunicationRecipients({
        schoolId: S, channel: "email", kind: "parents", className: "Grade RA",
      });
      const parentIds = parents.contacts.map((c) => c.sourceId);
      assert(same(parentIds, [fx.P.sasams.id]), `class parents ${parentIds}`);
      assert(
        parents.classFilters.filter((n) => /^grade ra$/i.test(n)).length === 1,
        `class filters ${parents.classFilters}`
      );
      const teachers = await loadCommunicationRecipients({
        schoolId: S, channel: "email", kind: "teachers", className: "grade ra",
      });
      assert(
        teachers.contacts.length === 1 && teachers.contacts[0].email === fx.teacherEmail,
        `class teachers ${teachers.contacts.map((c) => c.email)}`
      );
    });

    await test("4. attendance/register membership matches the classroom roster", async () => {
      const classes = await call("GET", `/api/attendance/classes?schoolId=${S}`);
      const names = classes.json.classes.map((c: any) => c.name);
      assert(!names.includes("Grade Ra") && !names.includes(" Grade RA "), `attendance classes ${names}`);
      const raClass = classes.json.classes.find((c: any) => c.name === "Grade RA");
      assert(raClass?.learnerCount === 3, `attendance RA count ${raClass?.learnerCount}`);
      assert(raClass?.teacherName === "Teacher RA", "attendance class keeps classroom settings");
      const capture = await call("GET", `/api/attendance?schoolId=${S}&className=Grade%20RA&date=2026-10-05&period=DAILY`);
      assert(capture.status === 200, `capture status ${capture.status}`);
      assert(same(capture.json.learners.map((l: any) => l.id), raRoster), "attendance capture roster");
      const report = await buildAttendanceReport({
        schoolId: S, className: "Grade RA", startDate: "2026-10-05", endDate: "2026-10-05",
      } as any);
      assert(same(report.learners.map((l) => l.learnerId), raRoster), "attendance report roster");
      assert(report.learners.every((l) => l.classroom === "Grade RA"), "report rows use canonical label");
    });

    await test("5. HISTORICAL learners excluded from rosters, teacher portal, attendance, class comms", async () => {
      const teacher = await call("GET", "/api/teacher-app/learners?className=Grade%20RA", undefined, token);
      assert(!teacher.json.learners.some((l: any) => l.id === L.raHistorical.id), "teacher portal");
      assert(!(await detailIds(fx.ra.id)).includes(L.raHistorical.id), "classroom roster");
      const comms = await loadCommunicationRecipients({
        schoolId: S, channel: "email", kind: "parents", className: "Grade RA",
      });
      assert(!comms.contacts.some((c) => c.sourceId === fx.P.historical.id), "class comms");
      const all = await loadCommunicationRecipients({ schoolId: S, channel: "email", kind: "parents" });
      assert(all.contacts.some((c) => c.sourceId === fx.P.historical.id), "unfiltered comms unchanged");
    });

    await test("6. other school always excluded", async () => {
      const teacher = await call("GET", "/api/teacher-app/learners?className=Grade%20RA", undefined, token);
      assert(!teacher.json.learners.some((l: any) => l.id === fx.otherLearner.id), "teacher portal");
      const comms = await loadCommunicationRecipients({
        schoolId: S, channel: "email", kind: "parents", className: "Grade RA",
      });
      assert(!comms.contacts.some((c) => c.sourceId === fx.P.other.id), "comms");
      const capture = await call("GET", `/api/attendance?schoolId=${S}&className=Grade%20RA&date=2026-10-05&period=DAILY`);
      assert(!capture.json.learners.some((l: any) => l.id === fx.otherLearner.id), "attendance");
      const otherSync = await syncParentThreadsForClassroom(O, fx.ra.id);
      assert(otherSync.updated === 0, "sync with wrong school is a no-op");
    });

    await test("11. Grade 1A unchanged everywhere", async () => {
      assert(same(await detailIds(fx.g1.id), [L.g1.id]), "classroom roster");
      const classes = await call("GET", `/api/attendance/classes?schoolId=${S}`);
      assert(classes.json.classes.find((c: any) => c.name === "Grade 1A")?.learnerCount === 1, "attendance");
      const comms = await loadCommunicationRecipients({
        schoolId: S, channel: "email", kind: "parents", className: "Grade 1A",
      });
      assert(same(comms.contacts.map((c) => c.sourceId), [fx.P.g1.id]), "comms");
      const stats = await buildRegistrationStats(S);
      assert(stats.stats.classrooms === 3, `registration stats classrooms ${stats.stats.classrooms}`);
    });

    const dupRa = await prisma.classroom.create({
      data: { schoolId: S, name: "Grade Ra", createdAt: new Date(Date.now() + 1000) },
    });

    await test("7. duplicate case-variant classrooms: exact spelling wins, deterministic counts", async () => {
      const first = await call("GET", `/api/classrooms?schoolId=${S}`);
      const second = await call("GET", `/api/classrooms?schoolId=${S}`);
      const summary = (rows: any[]) =>
        rows.map((r) => `${r.id}:${r.childrenCount}:${sorted(r.learners.map((l: any) => l.id))}`).sort().join("|");
      assert(summary(first.json.classrooms) === summary(second.json.classrooms), "list is deterministic");
      assert(same(await detailIds(fx.ra.id), [L.raExact.id, L.raSpaced.id]), "Grade RA keeps exact + trimmed");
      assert(same(await detailIds(dupRa.id), [L.raSasams.id]), "Grade Ra gets its exact spelling");
      const teacher = await call("GET", "/api/teacher-app/learners?className=Grade%20RA", undefined, token);
      assert(
        same(teacher.json.learners.map((l: any) => l.id), [L.raExact.id, L.raSpaced.id]),
        "teacher portal follows the same split"
      );
      const comms = await loadCommunicationRecipients({
        schoolId: S, channel: "email", kind: "parents", className: "Grade RA",
      });
      assert(comms.contacts.length === 0, "Grade RA comms exclude the Grade Ra parent");
    });

    await test("10. add/move/remove target the selected (duplicate) classroom", async () => {
      const newcomer = await prisma.learner.create({
        data: { schoolId: S, firstName: "Kai", lastName: "Newcomer", grade: "Grade R" },
      });
      const add = await call("POST", `/api/classrooms/${dupRa.id}/add-learners`, { schoolId: S, learnerIds: [newcomer.id] });
      assert(add.status === 200 && add.json.assigned === 1, `add ${add.status}`);
      assert((await detailIds(dupRa.id)).includes(newcomer.id), "added to Grade Ra, not Grade RA");
      assert(!(await detailIds(fx.ra.id)).includes(newcomer.id), "not on Grade RA");
      const move = await call("POST", `/api/classrooms/${dupRa.id}/move-learners`, {
        schoolId: S, learnerIds: [newcomer.id], targetClassroomId: fx.rb.id,
      });
      assert(move.status === 200 && move.json.moved === 1, `move ${move.status}`);
      assert((await detailIds(fx.rb.id)).includes(newcomer.id), "moved to RB");
      const remove = await call("POST", `/api/classrooms/${fx.rb.id}/remove-learners`, {
        schoolId: S, learnerIds: [newcomer.id],
      });
      assert(remove.status === 200 && remove.json.removed === 1, `remove ${remove.status}`);
      const db = await prisma.learner.findUnique({ where: { id: newcomer.id } });
      assert(db?.className === null, `className after remove ${db?.className}`);
      await prisma.learner.delete({ where: { id: newcomer.id } });
    });

    await test("9. delete cannot touch another school", async () => {
      const cross = await call("DELETE", `/api/classrooms/${fx.ra.id}?schoolId=${O}`);
      assert(cross.status === 404, `cross-school delete status ${cross.status}`);
      assert((await prisma.classroom.count({ where: { id: fx.ra.id } })) === 1, "classroom survived");
      const raLearners = await prisma.learner.count({ where: { schoolId: S, className: { not: null } } });
      assert(raLearners === 6, `learner classNames untouched, ${raLearners}`);
      const missing = await call("DELETE", `/api/classrooms/${fx.ra.id}`);
      assert(missing.status === 400, `missing schoolId status ${missing.status}`);
    });

    await test("8. delete clears only this classroom's ACTIVE roster, atomically, and reports the count", async () => {
      const res = await call("DELETE", `/api/classrooms/${fx.ra.id}?schoolId=${S}`);
      assert(res.status === 200 && res.json.success, `delete status ${res.status}`);
      assert(res.json.unassigned === 2, `unassigned ${res.json.unassigned}`);
      assert(same(res.json.unassignedLearnerIds, [L.raExact.id, L.raSpaced.id]), "unassigned ids");
      assert(res.json.classroomName === "Grade RA", "classroom name echoed");
      const get = async (id: string) => (await prisma.learner.findUnique({ where: { id } }))?.className;
      assert((await get(L.raExact.id)) === null && (await get(L.raSpaced.id)) === null, "roster cleared");
      assert((await get(L.raSasams.id)) === "Grade Ra", "duplicate classroom member untouched");
      assert((await get(L.raHistorical.id)) === "Grade RA", "HISTORICAL learner untouched");
      assert((await get(L.rbExact.id)) === "Grade RB" && (await get(L.g1.id)) === "Grade 1A", "others untouched");
      assert((await get(fx.otherLearner.id)) === "Grade Ra", "other school untouched");
      assert((await prisma.classroom.count({ where: { id: fx.otherRa.id } })) === 1, "other school classroom kept");
      assert((await prisma.classroom.count({ where: { id: fx.ra.id } })) === 0, "classroom deleted");
      const list = await call("GET", `/api/classrooms?schoolId=${S}`);
      assert(!list.json.classrooms.some((c: any) => /^grade ?ra$/i.test(c.name) && c.registered === false),
        "deleted classroom does not reappear as an unregistered placeholder");
    });

    await test("12. billing, parent and family links untouched", async () => {
      assert((await relationshipSnapshot([S, O])) === relationshipsBefore, "relationships changed");
    });

    console.log(`classroomMembership.subsystems: ${passed} passed`);
  } finally {
    await cleanup(fx);
    close();
    await prisma.$disconnect();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
