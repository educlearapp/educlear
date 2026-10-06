/**
 * Classroom membership + learner edit route integration tests (local DB, disposable test schools).
 * Run: npx ts-node --transpile-only src/routes/classrooms.membership.route.test.ts
 */
import express from "express";
import http from "http";
import { prisma } from "../prisma";
import classroomsRoutes from "./classrooms";
import learnerRoutes from "./learner";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

if (!/localhost|127\.0\.0\.1/.test(String(process.env.DATABASE_URL || ""))) {
  throw new Error("Refusing to run: DATABASE_URL must point at a local database");
}

type Call = (method: string, path: string, body?: unknown) => Promise<{ status: number; json: any }>;

async function startServer(): Promise<{ call: Call; close: () => void }> {
  const app = express();
  app.use(express.json());
  app.use("/api/classrooms", classroomsRoutes);
  app.use("/api/learners", learnerRoutes);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;
  const call: Call = async (method, path, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  return { call, close: () => server.close() };
}

async function createFixture() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const school = await prisma.school.create({
    data: { name: `EduClear Test School classrooms ${suffix}`, email: `cls-a-${suffix}@test.local` },
  });
  const otherSchool = await prisma.school.create({
    data: { name: `EduClear Test School classrooms other ${suffix}`, email: `cls-b-${suffix}@test.local` },
  });
  const S = school.id;
  const ra = await prisma.classroom.create({ data: { schoolId: S, name: "Grade RA" } });
  const rb = await prisma.classroom.create({ data: { schoolId: S, name: "Grade RB" } });
  const g1 = await prisma.classroom.create({ data: { schoolId: S, name: "Grade 1A" } });
  await prisma.classroom.create({ data: { schoolId: otherSchool.id, name: "Grade RA" } });

  const mk = (data: Record<string, unknown>) =>
    prisma.learner.create({ data: { schoolId: S, grade: "Grade R", ...data } as any });
  const learners = {
    raExact: await mk({ firstName: "Ava", lastName: "Exact", className: "Grade RA" }),
    raSasams: await mk({ firstName: "Ben", lastName: "Sasams", className: "Grade Ra" }),
    raSpaced: await mk({ firstName: "Cara", lastName: "Spaced", className: " GRADE R A " }),
    raHistorical: await mk({
      firstName: "Dan", lastName: "Historical", className: "Grade RA", enrollmentStatus: "HISTORICAL",
    }),
    rbExact: await mk({ firstName: "Eve", lastName: "RbExact", className: "Grade RB" }),
    rbLower: await mk({ firstName: "Finn", lastName: "RbLower", className: "grade rb" }),
    unassigned: await mk({ firstName: "Gia", lastName: "Unassigned", className: null }),
    g1: await mk({ firstName: "Hal", lastName: "GradeOne", grade: "Grade 1", className: "Grade 1A" }),
  };
  const otherSchoolLearner = await prisma.learner.create({
    data: { schoolId: otherSchool.id, firstName: "Ivy", lastName: "OtherSchool", grade: "Grade R", className: "Grade RA" },
  });

  const family = await prisma.familyAccount.create({
    data: { schoolId: S, accountRef: `TST${suffix.slice(-6)}`, familyName: "Editable" },
  });
  const editable = await mk({
    firstName: "Jo", lastName: "Editable", className: null, familyAccountId: family.id,
    admissionNo: family.accountRef, homeLanguage: "English", citizenship: "South Africa", notes: "original",
    allergies: "Peanuts", medicalAlert: "EpiPen",
  });
  const parent = await prisma.parent.create({
    data: { schoolId: S, firstName: "Pat", surname: "Editable", cellNo: "0820000000", email: `pat-${suffix}@test.local` },
  });
  await prisma.parentLearnerLink.create({
    data: { schoolId: S, parentId: parent.id, learnerId: editable.id, isPrimary: true },
  });
  await prisma.learnerBillingPlanLine.create({
    data: { schoolId: S, learnerId: editable.id, feeDescription: "Grade R Fee", amount: 1500 },
  });

  return { S, otherSchoolId: otherSchool.id, ra, rb, g1, learners, otherSchoolLearner, editable, family, parent };
}

async function cleanup(fx: Awaited<ReturnType<typeof createFixture>>) {
  const schoolIds = [fx.S, fx.otherSchoolId];
  await prisma.learnerBillingPlanLine.deleteMany({ where: { schoolId: { in: schoolIds } } });
  await prisma.parentLearnerLink.deleteMany({ where: { schoolId: { in: schoolIds } } });
  await prisma.parent.deleteMany({ where: { schoolId: { in: schoolIds } } });
  await prisma.learner.deleteMany({ where: { schoolId: { in: schoolIds } } });
  await prisma.familyAccount.deleteMany({ where: { schoolId: { in: schoolIds } } });
  await prisma.classroom.deleteMany({ where: { schoolId: { in: schoolIds } } });
  await prisma.school.deleteMany({ where: { id: { in: schoolIds } } });
}

function rosterIds(classroom: any): string[] {
  return (classroom?.learners || []).map((l: any) => l.id).sort();
}

async function run() {
  const { call, close } = await startServer();
  const fx = await createFixture();
  const { S, learners: L } = fx;
  let passed = 0;
  const test = async (name: string, fn: () => Promise<void>) => {
    await fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  };
  const list = async () => (await call("GET", `/api/classrooms?schoolId=${S}`)).json.classrooms as any[];
  const detail = async (id: string) =>
    (await call("GET", `/api/classrooms/${encodeURIComponent(id)}?schoolId=${S}`)).json.classroom;

  try {
    await test("Grade RA roster includes exact and normalized spellings (list + detail)", async () => {
      const rows = await list();
      const raRow = rows.find((c) => c.id === fx.ra.id);
      const expected = [L.raExact.id, L.raSasams.id, L.raSpaced.id].sort();
      assert(JSON.stringify(rosterIds(raRow)) === JSON.stringify(expected), `list RA roster ${rosterIds(raRow)}`);
      const d = await detail(fx.ra.id);
      assert(JSON.stringify(rosterIds(d)) === JSON.stringify(expected), `detail RA roster ${rosterIds(d)}`);
    });

    await test("Grade RB roster includes its learners and not RA learners", async () => {
      const d = await detail(fx.rb.id);
      assert(
        JSON.stringify(rosterIds(d)) === JSON.stringify([L.rbExact.id, L.rbLower.id].sort()),
        `RB roster ${rosterIds(d)}`
      );
    });

    await test("no ghost unregistered rows for case/space variants", async () => {
      const rows = await list();
      const ghosts = rows.filter((c) => c.registered === false);
      assert(ghosts.length === 0, `unexpected unregistered rows: ${ghosts.map((g) => g.name)}`);
    });

    await test("learner from another classroom does not appear", async () => {
      const d = await detail(fx.ra.id);
      assert(!rosterIds(d).includes(L.g1.id), "Grade 1A learner leaked into RA");
      assert(!rosterIds(d).includes(L.rbExact.id), "RB learner leaked into RA");
    });

    await test("learner from another school never appears", async () => {
      const rows = await list();
      const all = rows.flatMap((c) => rosterIds(c));
      assert(!all.includes(fx.otherSchoolLearner.id), "other-school learner leaked into list");
      const crossDetail = await call("GET", `/api/classrooms/${fx.ra.id}?schoolId=${fx.otherSchoolId}`);
      assert(crossDetail.status === 404, `cross-school detail should 404, got ${crossDetail.status}`);
    });

    await test("HISTORICAL learner excluded from roster and count", async () => {
      const rows = await list();
      const raRow = rows.find((c) => c.id === fx.ra.id);
      assert(!rosterIds(raRow).includes(L.raHistorical.id), "historical in list roster");
      const d = await detail(fx.ra.id);
      assert(!rosterIds(d).includes(L.raHistorical.id), "historical in detail roster");
    });

    await test("classroom count matches roster rows (list + detail)", async () => {
      for (const row of await list()) {
        assert(row.childrenCount === row.learners.length, `${row.name}: count ${row.childrenCount} != rows ${row.learners.length}`);
        const d = await detail(row.id);
        assert(d.childrenCount === d.learners.length, `${row.name}: detail count mismatch`);
        assert(d.childrenCount === row.childrenCount, `${row.name}: list ${row.childrenCount} vs detail ${d.childrenCount}`);
      }
    });

    await test("non-Grade-R classroom unaffected", async () => {
      const d = await detail(fx.g1.id);
      assert(JSON.stringify(rosterIds(d)) === JSON.stringify([L.g1.id]), `1A roster ${rosterIds(d)}`);
    });

    await test("Add Learners persists assignment and survives a fresh fetch", async () => {
      const res = await call("POST", `/api/classrooms/${fx.ra.id}/add-learners`, {
        schoolId: S,
        learnerIds: [L.unassigned.id],
      });
      assert(res.status === 200 && res.json.success === true, `add status ${res.status}`);
      assert(res.json.assigned === 1, `assigned ${res.json.assigned}`);
      const db = await prisma.learner.findUnique({ where: { id: L.unassigned.id } });
      assert(db?.className === "Grade RA", `DB className ${db?.className}`);
      const d = await detail(fx.ra.id);
      assert(rosterIds(d).includes(L.unassigned.id), "added learner missing from fresh detail");
      const raRow = (await list()).find((c) => c.id === fx.ra.id);
      assert(rosterIds(raRow).includes(L.unassigned.id), "added learner missing from fresh list");
      assert(raRow.childrenCount === 4, `RA count after add ${raRow.childrenCount}`);
    });

    await test("Add Learners never reports success for zero assignments", async () => {
      const unknown = await call("POST", `/api/classrooms/${fx.ra.id}/add-learners`, {
        schoolId: S,
        learnerIds: ["does-not-exist"],
      });
      assert(unknown.status === 400, `unknown learner status ${unknown.status}`);
      const empty = await call("POST", `/api/classrooms/${fx.ra.id}/add-learners`, { schoolId: S, learnerIds: [] });
      assert(empty.status === 400, `empty selection status ${empty.status}`);
      const crossSchool = await call("POST", `/api/classrooms/${fx.ra.id}/add-learners`, {
        schoolId: S,
        learnerIds: [fx.otherSchoolLearner.id],
      });
      assert(crossSchool.status === 400, `cross-school learner status ${crossSchool.status}`);
      const other = await prisma.learner.findUnique({ where: { id: fx.otherSchoolLearner.id } });
      assert(other?.className === "Grade RA" && other.schoolId === fx.otherSchoolId, "other-school learner modified");
      const historical = await call("POST", `/api/classrooms/${fx.rb.id}/add-learners`, {
        schoolId: S,
        learnerIds: [L.raHistorical.id],
      });
      assert(historical.status === 400, `historical learner status ${historical.status}`);
    });

    await test("move learner updates old and new classroom", async () => {
      const res = await call("POST", `/api/classrooms/${fx.ra.id}/move-learners`, {
        schoolId: S,
        learnerIds: [L.raSasams.id],
        targetClassroomId: fx.rb.id,
      });
      assert(res.status === 200 && res.json.moved === 1, `move status ${res.status}`);
      assert(!rosterIds(await detail(fx.ra.id)).includes(L.raSasams.id), "still in RA after move");
      assert(rosterIds(await detail(fx.rb.id)).includes(L.raSasams.id), "missing from RB after move");
    });

    await test("remove learner clears membership only for that classroom's learners", async () => {
      const wrong = await call("POST", `/api/classrooms/${fx.ra.id}/remove-learners`, {
        schoolId: S,
        learnerIds: [L.g1.id],
      });
      assert(wrong.status === 400, `removing non-member status ${wrong.status}`);
      const g1 = await prisma.learner.findUnique({ where: { id: L.g1.id } });
      assert(g1?.className === "Grade 1A", "non-member was cleared");
      const res = await call("POST", `/api/classrooms/${fx.ra.id}/remove-learners`, {
        schoolId: S,
        learnerIds: [L.raSpaced.id],
      });
      assert(res.status === 200 && res.json.removed === 1, `remove status ${res.status}`);
      assert(!rosterIds(await detail(fx.ra.id)).includes(L.raSpaced.id), "still in RA after remove");
    });

    await test("create/repair do not create ghost duplicate classrooms", async () => {
      const created = await call("POST", `/api/classrooms`, { schoolId: S, name: "grade ra" });
      assert(created.json?.classroom?.id === fx.ra.id, "case-variant create should reuse Grade RA");
      await prisma.learner.update({ where: { id: L.raSpaced.id }, data: { className: "Grade Ra" } });
      const repair = await call("POST", `/api/classrooms/bulk-create-missing`, { schoolId: S });
      assert(repair.json.created === 0, `repair created ${JSON.stringify(repair.json.names)}`);
      const rooms = await prisma.classroom.findMany({ where: { schoolId: S } });
      assert(rooms.length === 3, `classroom rows ${rooms.map((r) => r.name)}`);
      const rename = await call("PUT", `/api/classrooms/${fx.g1.id}`, { schoolId: S, name: "GRADE RB" });
      assert(rename.status === 409, `rename onto existing name status ${rename.status}`);
    });

    await test("edit existing learner persists edited fields and preserves unrelated data", async () => {
      const got = await call("GET", `/api/learners/${fx.editable.id}`);
      assert(got.status === 200, "GET learner");
      const before = await prisma.learner.findUnique({ where: { id: fx.editable.id } });
      const res = await call("PUT", `/api/learners/${fx.editable.id}`, {
        firstName: "Joanne",
        lastName: "Editable",
        gender: "",
        birthDate: "",
        religion: "",
        enrolmentDate: "",
        idNumber: "",
        className: "",
        classroom: "",
        classroomName: "",
        homeLanguage: "Afrikaans",
        nationality: "Namibia",
        notes: "edited",
      });
      assert(res.status === 200 && res.json.success, `PUT status ${res.status}`);
      const after = await prisma.learner.findUnique({ where: { id: fx.editable.id } });
      assert(after?.firstName === "Joanne", `firstName ${after?.firstName}`);
      assert(after?.homeLanguage === "Afrikaans", `homeLanguage ${after?.homeLanguage}`);
      assert(after?.citizenship === "Namibia", `citizenship ${after?.citizenship}`);
      assert(after?.notes === "edited", `notes ${after?.notes}`);
      assert(after?.className === null, `className must stay unassigned, got ${after?.className}`);
      assert(after?.grade === before?.grade, "grade changed");
      assert(after?.familyAccountId === fx.family.id, "family account changed");
      assert(after?.admissionNo === before?.admissionNo, "admissionNo changed");
      assert(after?.allergies === "Peanuts" && after?.medicalAlert === "EpiPen", "medical fields changed");
      assert(after?.enrollmentStatus === "ACTIVE", "enrollment status changed");
      const links = await prisma.parentLearnerLink.findMany({ where: { learnerId: fx.editable.id } });
      assert(links.length === 1 && links[0].parentId === fx.parent.id, "parent link changed");
      const parent = await prisma.parent.findUnique({ where: { id: fx.parent.id } });
      assert(parent?.email?.startsWith("pat-") === true && parent.cellNo === "0820000000", "parent changed");
      const lines = await prisma.learnerBillingPlanLine.count({ where: { learnerId: fx.editable.id } });
      assert(lines === 1, `billing plan lines ${lines}`);
    });

    await test("edit does not create a duplicate learner", async () => {
      const count = await prisma.learner.count({ where: { schoolId: S, lastName: "Editable" } });
      assert(count === 1, `learner rows ${count}`);
    });

    await test("edit assigning a class snaps to the registered classroom spelling", async () => {
      const res = await call("PUT", `/api/learners/${fx.editable.id}`, { className: "  grade  rb " });
      assert(res.status === 200, `PUT status ${res.status}`);
      const after = await prisma.learner.findUnique({ where: { id: fx.editable.id } });
      assert(after?.className === "Grade RB", `className ${after?.className}`);
      assert(rosterIds(await detail(fx.rb.id)).includes(fx.editable.id), "edited learner missing from RB");
    });

    await test("medical keys are rejected on PUT; full-profile PUT without them succeeds", async () => {
      const got = await call("GET", `/api/learners/${fx.editable.id}`);
      const withMedical = await call("PUT", `/api/learners/${fx.editable.id}`, {
        ...got.json.learner,
        parents: undefined,
        allergies: "",
        medicalAlert: "",
      });
      assert(withMedical.status === 400, `medical keys status ${withMedical.status}`);
      const { allergies: _a, medicalAlert: _m, parents: _p, billingPlan: _b, ...rest } = got.json.learner;
      const res = await call("PUT", `/api/learners/${fx.editable.id}`, rest);
      assert(res.status === 200, `full-profile PUT status ${res.status}: ${JSON.stringify(res.json)}`);
      const after = await prisma.learner.findUnique({ where: { id: fx.editable.id } });
      assert(after?.className === "Grade RB", `billing save must not move class, got ${after?.className}`);
      assert(after?.notes === "edited", "billing save changed notes");
    });

    console.log(`classrooms.membership: ${passed} passed`);
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
