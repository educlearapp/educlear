/**
 * Attendance report route tests (isolated fixture school).
 * Run: npx ts-node --transpile-only src/routes/attendance.report.route.test.ts
 */
import express from "express";
import http from "http";
import { prisma } from "../prisma";
import attendanceRoutes from "./attendance";
import { parseDateOnly } from "../utils/attendancePeriods";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

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
      name: `Att Report School ${suffix}`,
      email: `att-report-${suffix}@test.local`,
    },
  });
  const teacher = await prisma.user.create({
    data: {
      schoolId: school.id,
      email: `att-teacher-${suffix}@test.local`,
      passwordHash: "x",
      role: "STAFF",
      fullName: "Report Teacher",
    },
  });

  const presentLearner = await prisma.learner.create({
    data: {
      schoolId: school.id,
      firstName: "Present",
      lastName: "Kid",
      grade: "Grade 3A",
      className: "Grade 3A",
      admissionNo: `P-${suffix}`,
      enrollmentStatus: "ACTIVE",
    },
  });
  const absentLearner = await prisma.learner.create({
    data: {
      schoolId: school.id,
      firstName: "Absent",
      lastName: "Kid",
      grade: "Grade 3A",
      className: "Grade 3A",
      admissionNo: `A-${suffix}`,
      enrollmentStatus: "ACTIVE",
    },
  });
  const lateLearner = await prisma.learner.create({
    data: {
      schoolId: school.id,
      firstName: "Late",
      lastName: "Kid",
      grade: "Grade 3A",
      className: "Grade 3A",
      admissionNo: `L-${suffix}`,
      enrollmentStatus: "ACTIVE",
    },
  });
  const excusedLearner = await prisma.learner.create({
    data: {
      schoolId: school.id,
      firstName: "Excused",
      lastName: "Kid",
      grade: "Grade 3A",
      className: "Grade 3A",
      admissionNo: `E-${suffix}`,
      enrollmentStatus: "ACTIVE",
    },
  });
  const uncapturedLearner = await prisma.learner.create({
    data: {
      schoolId: school.id,
      firstName: "Missing",
      lastName: "Kid",
      grade: "Grade 3A",
      className: "Grade 3A",
      admissionNo: `N-${suffix}`,
      enrollmentStatus: "ACTIVE",
    },
  });
  const otherClassLearner = await prisma.learner.create({
    data: {
      schoolId: school.id,
      firstName: "Other",
      lastName: "Class",
      grade: "Grade 4B",
      className: "Grade 4B",
      admissionNo: `O-${suffix}`,
      enrollmentStatus: "ACTIVE",
    },
  });
  const historical = await prisma.learner.create({
    data: {
      schoolId: school.id,
      firstName: "Hist",
      lastName: "Oric",
      grade: "Grade 3A",
      className: "Grade 3A",
      admissionNo: `H-${suffix}`,
      enrollmentStatus: "HISTORICAL",
    },
  });

  const day = parseDateOnly("2026-07-21")!;
  const marks = [
    { learner: presentLearner, status: "PRESENT" as const },
    { learner: absentLearner, status: "ABSENT" as const },
    { learner: lateLearner, status: "LATE" as const },
    { learner: excusedLearner, status: "EXCUSED" as const },
  ];
  for (const mark of marks) {
    await prisma.learnerAttendance.create({
      data: {
        schoolId: school.id,
        learnerId: mark.learner.id,
        className: "Grade 3A",
        date: day,
        period: "DAILY",
        status: mark.status,
        reason: `${mark.status} note`,
        createdBy: teacher.email,
      },
    });
  }

  // Capture regression: single-day load still works
  const { base, close } = await startServer();
  try {
    const captureRes = await fetch(
      `${base}?schoolId=${school.id}&className=${encodeURIComponent("Grade 3A")}&date=2026-07-21&period=DAILY`
    );
    const captureJson: any = await captureRes.json();
    assert(captureRes.status === 200 && captureJson.success, "capture load failed");
    assert(captureJson.marks[presentLearner.id]?.status === "Present", "present mark");
    assert(captureJson.marks[absentLearner.id]?.status === "Absent", "absent mark");
    assert(!captureJson.marks[uncapturedLearner.id], "uncaptured should have no mark row");
    assert(
      !captureJson.learners.some((l: any) => l.id === historical.id),
      "historical excluded from capture"
    );

    // Daily report
    const dailyRes = await fetch(
      `${base}/report?schoolId=${school.id}&startDate=2026-07-21&endDate=2026-07-21&period=DAILY&className=${encodeURIComponent("Grade 3A")}&reportKind=daily`
    );
    const daily: any = await dailyRes.json();
    assert(dailyRes.status === 200 && daily.success, `daily report ${daily.error}`);
    assert(daily.report.dates[0].weekday === "Tuesday", "daily weekday");
    assert(daily.report.dates[0].fullDateLabel.includes("21 Jul 2026"), "daily full date");
    const byId = Object.fromEntries(daily.report.learners.map((l: any) => [l.learnerId, l]));
    assert(byId[presentLearner.id].days["2026-07-21"].statusLabel === "Present", "Present label");
    assert(byId[absentLearner.id].days["2026-07-21"].statusLabel === "Absent", "Absent label");
    assert(byId[lateLearner.id].days["2026-07-21"].statusLabel === "Late", "Late label");
    assert(byId[excusedLearner.id].days["2026-07-21"].statusLabel === "Excused", "Excused label");
    assert(byId[uncapturedLearner.id].days["2026-07-21"].statusLabel === "Not Captured", "Not Captured");
    assert(!byId[historical.id], "historical excluded from report");
    assert(!byId[otherClassLearner.id], "other class excluded when filtered");
    assert(byId[presentLearner.id].days["2026-07-21"].capturedBy === "Report Teacher", "capturedBy name");
    assert(byId[presentLearner.id].days["2026-07-21"].statusLabel !== "PRESENT", "friendly only");
    assert(!String(byId[presentLearner.id].days["2026-07-21"].statusLabel).includes("_"), "no underscore label");

    // Period filtering — PERIOD_1 empty marks for same day
    const p1Res = await fetch(
      `${base}/report?schoolId=${school.id}&startDate=2026-07-21&endDate=2026-07-21&period=PERIOD_1&className=${encodeURIComponent("Grade 3A")}&reportKind=daily`
    );
    const p1: any = await p1Res.json();
    assert(p1.success, "period1 report");
    assert(
      p1.report.learners.every((l: any) => l.days["2026-07-21"].statusLabel === "Not Captured"),
      "period isolation"
    );

    // Weekly headings Mon-Fri
    const weeklyRes = await fetch(
      `${base}/report?schoolId=${school.id}&startDate=2026-07-20&endDate=2026-07-24&period=DAILY&className=${encodeURIComponent("Grade 3A")}&reportKind=weekly`
    );
    const weekly: any = await weeklyRes.json();
    assert(weekly.success, "weekly");
    assert(weekly.report.dates.length === 5, `weekly days ${weekly.report.dates.length}`);
    assert(weekly.report.dates[0].headingWeekly === "Mon 20 Jul", weekly.report.dates[0].headingWeekly);
    assert(weekly.report.dates[1].headingWeekly === "Tue 21 Jul", weekly.report.dates[1].headingWeekly);
    const wPresent = weekly.report.learners.find((l: any) => l.learnerId === presentLearner.id);
    assert(wPresent.totals.attendancePercentage === 20, `weekly att% ${wPresent.totals.attendancePercentage}`);
    assert(wPresent.totals.captureCompletionPercentage === 20, `weekly cap% ${wPresent.totals.captureCompletionPercentage}`);

    // Weekend weekly
    const weekendRes = await fetch(
      `${base}/report?schoolId=${school.id}&startDate=2026-07-20&endDate=2026-07-26&period=DAILY&includeWeekends=true&reportKind=weekly`
    );
    const weekend: any = await weekendRes.json();
    assert(weekend.report.dates.length === 7, "weekend week");

    // Monthly headings
    const monthlyRes = await fetch(
      `${base}/report?schoolId=${school.id}&startDate=2026-07-01&endDate=2026-07-31&period=DAILY&className=${encodeURIComponent("Grade 3A")}&reportKind=monthly`
    );
    const monthly: any = await monthlyRes.json();
    assert(monthly.success, "monthly");
    assert(monthly.report.dates[0].headingMonthly.match(/^\d+ \w{3}$/), monthly.report.dates[0].headingMonthly);
    assert(!monthly.report.dates.some((d: any) => d.weekday === "Saturday" || d.weekday === "Sunday"), "no weekends monthly");

    // All classrooms grouping
    const allRes = await fetch(
      `${base}/report?schoolId=${school.id}&startDate=2026-07-21&endDate=2026-07-21&period=DAILY&reportKind=daily&groupBy=classrooms`
    );
    const all: any = await allRes.json();
    assert(all.report.sections.length >= 2, "all classrooms sections");
    assert(
      all.report.sections.some((s: any) => s.label === "Grade 3A") &&
        all.report.sections.some((s: any) => s.label === "Grade 4B"),
      "classroom groups"
    );

    console.log("attendance.report.route.test.ts: PASS");
  } finally {
    await close();
    await prisma.learnerAttendance.deleteMany({ where: { schoolId: school.id } });
    await prisma.learner.deleteMany({ where: { schoolId: school.id } });
    await prisma.user.deleteMany({ where: { schoolId: school.id } });
    await prisma.school.delete({ where: { id: school.id } });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
