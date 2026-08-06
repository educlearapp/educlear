/**
 * Period 8 + Intervention capture, reports, weekly register, API validation.
 * Run: npx ts-node --transpile-only src/routes/attendance.period8-intervention.route.test.ts
 */
import assert from "assert";
import express from "express";
import http from "http";
import { prisma } from "../prisma";
import attendanceRoutes from "./attendance";
import { parseDateOnly, periodLabel } from "../utils/attendancePeriods";
import { PERIOD_REGISTER_COLUMNS, INTERVENTION_SESSION } from "../utils/attendanceSessionKeys";

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
      name: `P8 Interv School ${suffix}`,
      email: `p8-interv-${suffix}@test.local`,
    },
  });
  const teacher = await prisma.user.create({
    data: {
      schoolId: school.id,
      email: `p8-teacher-${suffix}@test.local`,
      passwordHash: "x",
      role: "STAFF",
      fullName: "P8 Teacher",
    },
  });
  const classroom = await prisma.classroom.create({
    data: {
      schoolId: school.id,
      name: "Grade 6A",
      attendanceSessionDisplay: "PERIODS",
      teacherName: "P8 Teacher",
      teacherEmail: teacher.email,
    },
  });
  const learner = await prisma.learner.create({
    data: {
      schoolId: school.id,
      firstName: "Ava",
      lastName: "Learner",
      grade: "Grade 6A",
      className: "Grade 6A",
      admissionNo: `P8-${suffix}`,
      enrollmentStatus: "ACTIVE",
    },
  });

  // Foundation Phase SUBJECTS classroom — must remain unaffected by period session expansion
  const fpClassroom = await prisma.classroom.create({
    data: {
      schoolId: school.id,
      name: "Grade R",
      attendanceSessionDisplay: "SUBJECTS",
      teacherName: "FP Teacher",
      teacherEmail: `fp-${suffix}@test.local`,
    },
  });

  const day = "2026-08-04"; // Tuesday
  const date = parseDateOnly(day)!;
  const { base, close } = await startServer();

  try {
    // API validation: Period 8 + Intervention accepted; Period 9 rejected
    const badRes = await fetch(
      `${base}/report?schoolId=${school.id}&startDate=${day}&endDate=${day}&period=PERIOD_9&reportKind=daily`
    );
    const badJson: any = await badRes.json();
    assert.strictEqual(badRes.status, 400);
    assert.strictEqual(badJson.success, false);

    // Capture sessions lists Period 8 + Intervention with correct labels (not Period 9)
    const sessionsRes = await fetch(
      `${base}/capture-sessions?schoolId=${school.id}&className=${encodeURIComponent("Grade 6A")}&date=${day}`
    );
    const sessionsJson: any = await sessionsRes.json();
    assert.strictEqual(sessionsRes.status, 200);
    assert.strictEqual(sessionsJson.mode, "PERIODS");
    const byPeriod = Object.fromEntries(
      sessionsJson.sessions.map((s: any) => [s.period, s.label])
    );
    assert.strictEqual(byPeriod.PERIOD_8, "Period 8");
    assert.strictEqual(byPeriod.INTERVENTION, "Intervention");
    assert.ok(!byPeriod.PERIOD_9);
    assert.strictEqual(periodLabel("INTERVENTION"), "Intervention");

    // Foundation Phase SUBJECTS classroom stays on subject mode (unchanged)
    const fpSessionsRes = await fetch(
      `${base}/capture-sessions?schoolId=${school.id}&className=${encodeURIComponent("Grade R")}&date=${day}`
    );
    const fpSessions: any = await fpSessionsRes.json();
    assert.strictEqual(fpSessions.mode, "SUBJECTS");
    assert.ok(Array.isArray(fpSessions.sessions));

    // Bulk capture Period 8
    const p8Bulk = await fetch(`${base}/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schoolId: school.id,
        className: "Grade 6A",
        date: day,
        period: "PERIOD_8",
        createdBy: teacher.email,
        marks: [{ learnerId: learner.id, status: "present" }],
      }),
    });
    const p8BulkJson: any = await p8Bulk.json();
    assert.strictEqual(p8Bulk.status, 200, p8BulkJson.error);
    assert.strictEqual(p8BulkJson.success, true);
    assert.strictEqual(p8BulkJson.saved, 1);

    // Bulk capture Intervention (independent session)
    const intBulk = await fetch(`${base}/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schoolId: school.id,
        className: "Grade 6A",
        date: day,
        period: "INTERVENTION",
        createdBy: teacher.email,
        marks: [{ learnerId: learner.id, status: "late", reason: "catch-up" }],
      }),
    });
    const intBulkJson: any = await intBulk.json();
    assert.strictEqual(intBulk.status, 200, intBulkJson.error);
    assert.strictEqual(intBulkJson.success, true);

    // Existing Period 1–7 unchanged: empty for PERIOD_1 while PERIOD_8 captured
    const p1Load = await fetch(
      `${base}?schoolId=${school.id}&className=${encodeURIComponent("Grade 6A")}&date=${day}&period=PERIOD_1`
    );
    const p1Json: any = await p1Load.json();
    assert.strictEqual(p1Json.success, true);
    assert.ok(!p1Json.marks[learner.id]);

    const p8Load = await fetch(
      `${base}?schoolId=${school.id}&className=${encodeURIComponent("Grade 6A")}&date=${day}&period=PERIOD_8`
    );
    const p8Json: any = await p8Load.json();
    assert.strictEqual(p8Json.marks[learner.id]?.status, "Present");

    const intLoad = await fetch(
      `${base}?schoolId=${school.id}&className=${encodeURIComponent("Grade 6A")}&date=${day}&period=INTERVENTION`
    );
    const intJson: any = await intLoad.json();
    assert.strictEqual(intJson.marks[learner.id]?.status, "Late");

    // Daily / weekly / monthly reports for Period 8
    for (const kind of ["daily", "weekly", "monthly"] as const) {
      const start = kind === "monthly" ? "2026-08-01" : kind === "weekly" ? "2026-08-03" : day;
      const end = kind === "monthly" ? "2026-08-31" : kind === "weekly" ? "2026-08-07" : day;
      const res = await fetch(
        `${base}/report?schoolId=${school.id}&startDate=${start}&endDate=${end}&period=PERIOD_8&className=${encodeURIComponent("Grade 6A")}&reportKind=${kind}`
      );
      const json: any = await res.json();
      assert.strictEqual(res.status, 200, `${kind} p8 ${json.error}`);
      assert.strictEqual(json.success, true);
      assert.strictEqual(json.report.meta.periodLabel, "Period 8");
      const row = json.report.learners.find((l: any) => l.learnerId === learner.id);
      assert.ok(row, `${kind} learner`);
      assert.strictEqual(row.days[day].statusLabel, "Present");
    }

    // Intervention daily report — labeled Intervention, not Period 9
    const intReport = await fetch(
      `${base}/report?schoolId=${school.id}&startDate=${day}&endDate=${day}&period=INTERVENTION&className=${encodeURIComponent("Grade 6A")}&reportKind=daily`
    );
    const intReportJson: any = await intReport.json();
    assert.strictEqual(intReportJson.success, true);
    assert.strictEqual(intReportJson.report.meta.periodLabel, "Intervention");
    assert.notStrictEqual(intReportJson.report.meta.periodLabel, "Period 9");
    const intRow = intReportJson.report.learners.find((l: any) => l.learnerId === learner.id);
    assert.strictEqual(intRow.days[day].statusLabel, "Late");

    // Weekly Period Register: Period 1–8 columns + Intervention when marks exist
    const weeklyReg = await fetch(
      `${base}/weekly-period-subject-register?schoolId=${school.id}&weekAnchor=${day}&className=${encodeURIComponent("Grade 6A")}&displayMode=Periods`
    );
    const weeklyJson: any = await weeklyReg.json();
    assert.strictEqual(weeklyReg.status, 200, weeklyJson.error);
    assert.strictEqual(weeklyJson.success, true);
    const cols = weeklyJson.report.columns as Array<{ date: string; period?: string; sessionLabel: string }>;
    const tueCols = cols.filter((c) => c.date === day);
    assert.strictEqual(
      PERIOD_REGISTER_COLUMNS.every((p) => tueCols.some((c) => c.period === p)),
      true,
      "Period 1–8 present"
    );
    assert.ok(
      tueCols.some((c) => c.period === INTERVENTION_SESSION && c.sessionLabel === "Intervention"),
      "Intervention separate session when attendance exists"
    );
    assert.ok(!tueCols.some((c) => c.sessionLabel === "Period 9"));
    // Intervention not merged into Period 8
    const p8Col = tueCols.find((c) => c.period === "PERIOD_8");
    const intCol = tueCols.find((c) => c.period === INTERVENTION_SESSION);
    assert.ok(p8Col && intCol && p8Col.key !== intCol.key);

    // Days without Intervention marks should not get Intervention columns
    const monCols = cols.filter((c) => c.date === "2026-08-03");
    assert.ok(!monCols.some((c) => c.period === INTERVENTION_SESSION));
    assert.strictEqual(monCols.filter((c) => c.period?.startsWith("PERIOD_")).length, 8);

    // Historical Period 1–7 rows untouched (create old mark; still readable)
    await prisma.learnerAttendance.create({
      data: {
        schoolId: school.id,
        learnerId: learner.id,
        className: "Grade 6A",
        date,
        period: "PERIOD_3",
        status: "ABSENT",
        createdBy: teacher.email,
      },
    });
    const p3Load = await fetch(
      `${base}?schoolId=${school.id}&className=${encodeURIComponent("Grade 6A")}&date=${day}&period=PERIOD_3`
    );
    const p3Json: any = await p3Load.json();
    assert.strictEqual(p3Json.marks[learner.id]?.status, "Absent");

    void classroom;
    void fpClassroom;
    void date;
    console.log("attendance.period8-intervention.route.test.ts: PASS");
  } finally {
    await close();
    await prisma.learnerAttendance.deleteMany({ where: { schoolId: school.id } });
    await prisma.classroomSubjectSlot.deleteMany({ where: { schoolId: school.id } }).catch(() => undefined);
    await prisma.classroom.deleteMany({ where: { schoolId: school.id } });
    await prisma.learner.deleteMany({ where: { schoolId: school.id } });
    await prisma.user.deleteMany({ where: { schoolId: school.id } });
    await prisma.school.delete({ where: { id: school.id } });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
