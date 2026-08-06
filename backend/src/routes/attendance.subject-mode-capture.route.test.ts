/**
 * Subject Mode capture sessions + persistence (local fixture school).
 * Run: npx ts-node --transpile-only src/routes/attendance.subject-mode-capture.route.test.ts
 */
import assert from "assert";
import express from "express";
import http from "http";
import { prisma } from "../prisma";
import attendanceRoutes from "./attendance";
import { parseDateOnly } from "../utils/attendancePeriods";
import { subjectSlotPeriodKey } from "../utils/attendanceSessionKeys";

async function startServer() {
  const app = express();
  app.use(express.json());
  app.use("/api/attendance", attendanceRoutes);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;
  return {
    base: `http://127.0.0.1:${port}/api/attendance`,
    close: () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}

async function main() {
  const suffix = Date.now();
  const school = await prisma.school.create({
    data: {
      name: `Subject Capture School ${suffix}`,
      email: `subj-cap-${suffix}@test.local`,
    },
  });
  const otherSchool = await prisma.school.create({
    data: {
      name: `Other School ${suffix}`,
      email: `other-${suffix}@test.local`,
    },
  });
  const teacher = await prisma.user.create({
    data: {
      schoolId: school.id,
      email: `subj-teacher-${suffix}@test.local`,
      passwordHash: "x",
      role: "STAFF",
      fullName: "Subject Teacher",
    },
  });

  const math = await prisma.schoolSubject.create({
    data: { schoolId: school.id, name: "Mathematics", sortOrder: 1 },
  });
  const english = await prisma.schoolSubject.create({
    data: { schoolId: school.id, name: "English Home Language", sortOrder: 2 },
  });
  const life = await prisma.schoolSubject.create({
    data: { schoolId: school.id, name: "Life Skills", sortOrder: 3 },
  });
  // Same subject twice on Tuesday to verify slot separation
  const foreignSchoolSubject = await prisma.schoolSubject.create({
    data: { schoolId: otherSchool.id, name: "Intruder Math", sortOrder: 1 },
  });

  const classroom = await prisma.classroom.create({
    data: {
      schoolId: school.id,
      name: "Grade R Foundation",
      attendanceSessionDisplay: "SUBJECTS",
      teacherName: "Subject Teacher",
      teacherEmail: teacher.email,
    },
  });
  const periodsClassroom = await prisma.classroom.create({
    data: {
      schoolId: school.id,
      name: "Grade 6 Periods",
      attendanceSessionDisplay: "PERIODS",
      teacherName: "Period Teacher",
      teacherEmail: teacher.email,
    },
  });

  // Tuesday = UTC day 2
  const tue = "2026-08-04";
  const mon = "2026-08-03"; // Monday = 1, no slots → empty
  const slotMath1 = await prisma.classroomSubjectSlot.create({
    data: {
      schoolId: school.id,
      classroomId: classroom.id,
      dayOfWeek: 2,
      sortOrder: 0,
      subjectId: math.id,
    },
  });
  const slotEnglish = await prisma.classroomSubjectSlot.create({
    data: {
      schoolId: school.id,
      classroomId: classroom.id,
      dayOfWeek: 2,
      sortOrder: 1,
      subjectId: english.id,
    },
  });
  const slotMath2 = await prisma.classroomSubjectSlot.create({
    data: {
      schoolId: school.id,
      classroomId: classroom.id,
      dayOfWeek: 2,
      sortOrder: 2,
      subjectId: math.id,
    },
  });
  const slotLife = await prisma.classroomSubjectSlot.create({
    data: {
      schoolId: school.id,
      classroomId: classroom.id,
      dayOfWeek: 2,
      sortOrder: 3,
      subjectId: life.id,
    },
  });

  const learners = [];
  for (const name of ["Ava", "Ben", "Cara", "Dan"]) {
    learners.push(
      await prisma.learner.create({
        data: {
          schoolId: school.id,
          firstName: name,
          lastName: "Kid",
          grade: "Grade R Foundation",
          className: "Grade R Foundation",
          admissionNo: `${name}-${suffix}`,
          enrollmentStatus: "ACTIVE",
        },
      })
    );
  }
  const periodLearner = await prisma.learner.create({
    data: {
      schoolId: school.id,
      firstName: "Eve",
      lastName: "Period",
      grade: "Grade 6 Periods",
      className: "Grade 6 Periods",
      admissionNo: `Eve-${suffix}`,
      enrollmentStatus: "ACTIVE",
    },
  });

  const { base, close } = await startServer();
  try {
    // Timetable load + ordering
    const sessionsRes = await fetch(
      `${base}/capture-sessions?schoolId=${school.id}&className=${encodeURIComponent("Grade R Foundation")}&date=${tue}`
    );
    const sessionsJson: any = await sessionsRes.json();
    assert.strictEqual(sessionsRes.status, 200);
    assert.strictEqual(sessionsJson.mode, "SUBJECTS");
    assert.strictEqual(sessionsJson.sessions.length, 4);
    assert.deepStrictEqual(
      sessionsJson.sessions.map((s: any) => s.subjectId),
      [math.id, english.id, math.id, life.id]
    );
    assert.strictEqual(sessionsJson.sessions[0].period, subjectSlotPeriodKey(slotMath1.id));
    assert.strictEqual(sessionsJson.sessions[0].label, "Mathematics (Session 1)");
    assert.strictEqual(sessionsJson.sessions[2].label, "Mathematics (Session 2)");
    assert.strictEqual(sessionsJson.sessions[1].label, "English Home Language");
    assert.ok(!sessionsJson.sessions.some((s: any) => s.subjectId === foreignSchoolSubject.id));

    // Empty day — no silent period fallback
    const emptyRes = await fetch(
      `${base}/capture-sessions?schoolId=${school.id}&className=${encodeURIComponent("Grade R Foundation")}&date=${mon}`
    );
    const emptyJson: any = await emptyRes.json();
    assert.strictEqual(emptyJson.mode, "SUBJECTS");
    assert.strictEqual(emptyJson.sessions.length, 0);
    assert.ok(String(emptyJson.emptyMessage || "").includes("No subject sessions"));

    // Period Mode still returns periods (not subjects)
    const periodSessions = await fetch(
      `${base}/capture-sessions?schoolId=${school.id}&className=${encodeURIComponent("Grade 6 Periods")}&date=${tue}`
    );
    const periodJson: any = await periodSessions.json();
    assert.strictEqual(periodJson.mode, "PERIODS");
    assert.ok(periodJson.sessions.some((s: any) => s.period === "PERIOD_8"));
    assert.ok(periodJson.sessions.some((s: any) => s.period === "INTERVENTION"));
    assert.ok(!periodJson.sessions.some((s: any) => String(s.period).startsWith("SLOT_")));

    // Capture Mathematics Session 1 with mixed reasons
    const math1Period = subjectSlotPeriodKey(slotMath1.id);
    const bulk1 = await fetch(`${base}/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schoolId: school.id,
        className: "Grade R Foundation",
        date: tue,
        period: math1Period,
        subjectId: math.id,
        createdBy: teacher.email,
        marks: [
          { learnerId: learners[0].id, status: "present" },
          { learnerId: learners[1].id, status: "absent", reason: "S" },
          { learnerId: learners[2].id, status: "absent", reason: "SN - Sent to sick bay" },
          { learnerId: learners[3].id, status: "late", reason: "Late - traffic" },
        ],
      }),
    });
    const bulk1Json: any = await bulk1.json();
    assert.strictEqual(bulk1.status, 200, bulk1Json.error);
    assert.strictEqual(bulk1Json.saved, 4);
    assert.strictEqual(bulk1Json.subjectId, math.id);
    assert.strictEqual(bulk1Json.period, math1Period);

    // Reopen session — marks load
    const load1 = await fetch(
      `${base}?schoolId=${school.id}&className=${encodeURIComponent("Grade R Foundation")}&date=${tue}&period=${encodeURIComponent(math1Period)}`
    );
    const load1Json: any = await load1.json();
    assert.strictEqual(load1Json.marks[learners[0].id].status, "Present");
    assert.strictEqual(load1Json.marks[learners[1].id].reason, "S");
    assert.strictEqual(load1Json.marks[learners[2].id].reason, "SN - Sent to sick bay");
    assert.strictEqual(load1Json.marks[learners[0].id].subjectId, math.id);

    // Update one mark — no duplicate rows
    const beforeCount = await prisma.learnerAttendance.count({
      where: { schoolId: school.id, period: math1Period, date: parseDateOnly(tue)! },
    });
    const bulk2 = await fetch(`${base}/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schoolId: school.id,
        className: "Grade R Foundation",
        date: tue,
        period: math1Period,
        subjectId: math.id,
        createdBy: teacher.email,
        marks: [
          { learnerId: learners[0].id, status: "excused", reason: "E - appointment" },
          { learnerId: learners[1].id, status: "absent", reason: "S" },
          { learnerId: learners[2].id, status: "absent", reason: "SN - Sent to sick bay" },
          { learnerId: learners[3].id, status: "late", reason: "Late - traffic" },
        ],
      }),
    });
    const bulk2Json: any = await bulk2.json();
    assert.strictEqual(bulk2.status, 200, bulk2Json.error);
    const afterCount = await prisma.learnerAttendance.count({
      where: { schoolId: school.id, period: math1Period, date: parseDateOnly(tue)! },
    });
    assert.strictEqual(afterCount, beforeCount);
    const reopened = await fetch(
      `${base}?schoolId=${school.id}&className=${encodeURIComponent("Grade R Foundation")}&date=${tue}&period=${encodeURIComponent(math1Period)}`
    );
    const reopenedJson: any = await reopened.json();
    assert.strictEqual(reopenedJson.marks[learners[0].id].status, "Excused");
    assert.strictEqual(reopenedJson.marks[learners[0].id].reason, "E - appointment");

    // English isolated on same day
    const engPeriod = subjectSlotPeriodKey(slotEnglish.id);
    await fetch(`${base}/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schoolId: school.id,
        className: "Grade R Foundation",
        date: tue,
        period: engPeriod,
        subjectId: english.id,
        createdBy: teacher.email,
        marks: [{ learnerId: learners[0].id, status: "present" }],
      }),
    });
    const engLoad = await fetch(
      `${base}?schoolId=${school.id}&className=${encodeURIComponent("Grade R Foundation")}&date=${tue}&period=${encodeURIComponent(engPeriod)}`
    );
    const engJson: any = await engLoad.json();
    assert.strictEqual(engJson.marks[learners[0].id].status, "Present");
    assert.ok(!engJson.marks[learners[1].id]);

    // Repeated Math Session 2 isolated from Session 1
    const math2Period = subjectSlotPeriodKey(slotMath2.id);
    await fetch(`${base}/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schoolId: school.id,
        className: "Grade R Foundation",
        date: tue,
        period: math2Period,
        subjectId: math.id,
        createdBy: teacher.email,
        marks: [{ learnerId: learners[0].id, status: "absent", reason: "A" }],
      }),
    });
    const math2Load = await fetch(
      `${base}?schoolId=${school.id}&className=${encodeURIComponent("Grade R Foundation")}&date=${tue}&period=${encodeURIComponent(math2Period)}`
    );
    const math2Json: any = await math2Load.json();
    assert.strictEqual(math2Json.marks[learners[0].id].status, "Absent");
    // Session 1 still excused for Ava
    const math1Again = await fetch(
      `${base}?schoolId=${school.id}&className=${encodeURIComponent("Grade R Foundation")}&date=${tue}&period=${encodeURIComponent(math1Period)}`
    );
    const math1AgainJson: any = await math1Again.json();
    assert.strictEqual(math1AgainJson.marks[learners[0].id].status, "Excused");

    // Tenancy: cannot use other school's subjectId with this school's slot mismatch
    const badTenancy = await fetch(`${base}/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schoolId: school.id,
        className: "Grade R Foundation",
        date: tue,
        period: math1Period,
        subjectId: foreignSchoolSubject.id,
        createdBy: teacher.email,
        marks: [{ learnerId: learners[0].id, status: "present" }],
      }),
    });
    assert.strictEqual(badTenancy.status, 400);

    // SUBJECTS classroom rejects period-only capture without subject
    const noSubject = await fetch(`${base}/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schoolId: school.id,
        className: "Grade R Foundation",
        date: tue,
        period: "PERIOD_1",
        createdBy: teacher.email,
        marks: [{ learnerId: learners[0].id, status: "present" }],
      }),
    });
    assert.strictEqual(noSubject.status, 400);

    // Period Mode regression Period 8 + Intervention
    for (const period of ["PERIOD_8", "INTERVENTION"] as const) {
      const r = await fetch(`${base}/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schoolId: school.id,
          className: "Grade 6 Periods",
          date: tue,
          period,
          createdBy: teacher.email,
          marks: [{ learnerId: periodLearner.id, status: "present" }],
        }),
      });
      const j: any = await r.json();
      assert.strictEqual(r.status, 200, `${period} ${j.error}`);
    }

    // Weekly subject register integration + reason codes
    const weekly = await fetch(
      `${base}/weekly-period-subject-register?schoolId=${school.id}&weekAnchor=${tue}&className=${encodeURIComponent("Grade R Foundation")}&displayMode=Automatic`
    );
    const weeklyJson: any = await weekly.json();
    assert.strictEqual(weekly.status, 200, weeklyJson.error);
    assert.strictEqual(weeklyJson.report.displayModeResolved, "SUBJECTS");
    const tueCols = weeklyJson.report.columns.filter((c: any) => c.date === tue);
    assert.ok(tueCols.some((c: any) => c.sessionLabel.includes("Mathematics")));
    assert.ok(tueCols.some((c: any) => c.sessionLabel.includes("English")));
    const learnerRow = weeklyJson.report.learners.find((l: any) => l.learnerId === learners[1].id);
    assert.ok(learnerRow);
    const sickCell = learnerRow.cells.find((c: any) => c.abbrev === "S");
    assert.ok(sickCell, "S reason code in weekly register");
    const snLearner = weeklyJson.report.learners.find((l: any) => l.learnerId === learners[2].id);
    assert.ok(snLearner.cells.some((c: any) => c.abbrev === "SN" && c.teacherNote));
    assert.ok(weeklyJson.report.statusLegend.some((l: any) => l.abbrev === "SN"));

    // Historical null subjectId untouched count (no rewrite)
    const historicalCount = await prisma.learnerAttendance.count({
      where: { schoolId: school.id, subjectId: null },
    });
    // Period mode marks may have null subjectId — ensure we didn't null out subject captures
    const subjectMarks = await prisma.learnerAttendance.count({
      where: { schoolId: school.id, subjectId: { not: null } },
    });
    assert.ok(subjectMarks >= 6);
    void historicalCount;
    void slotLife;
    void periodsClassroom;

    console.log("attendance.subject-mode-capture.route.test.ts: PASS");
  } finally {
    await close();
    await prisma.learnerAttendance.deleteMany({ where: { schoolId: { in: [school.id, otherSchool.id] } } });
    await prisma.classroomSubjectSlot.deleteMany({ where: { schoolId: { in: [school.id, otherSchool.id] } } });
    await prisma.schoolSubject.deleteMany({ where: { schoolId: { in: [school.id, otherSchool.id] } } });
    await prisma.classroom.deleteMany({ where: { schoolId: { in: [school.id, otherSchool.id] } } });
    await prisma.learner.deleteMany({ where: { schoolId: { in: [school.id, otherSchool.id] } } });
    await prisma.user.deleteMany({ where: { schoolId: { in: [school.id, otherSchool.id] } } });
    await prisma.school.deleteMany({ where: { id: { in: [school.id, otherSchool.id] } } });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
