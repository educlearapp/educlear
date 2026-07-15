/**
 * Local Phase 1 HomeSafe verification (API workflow + DB checks).
 * Run: node dist/scripts/homesafe-local-verification.js
 */
import bcrypt from "bcryptjs";
import express from "express";
import http from "http";
import jwt from "jsonwebtoken";
import teacherAppRoutes from "../src/routes/teacherApp";
import { prisma } from "../src/prisma";
import { resolveSchoolLocalParts } from "../src/utils/schoolLocalTime";

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";

async function startServer() {
  const app = express();
  app.use(express.json());
  app.use("/api/teacher-app", teacherAppRoutes);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;
  return {
    base: `http://127.0.0.1:${port}/api/teacher-app/homesafe`,
    close: () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}

async function main() {
  const suffix = Date.now();
  const passwordHash = await bcrypt.hash("homesafe-verify", 4);
  const school = await prisma.school.create({
    data: { name: `HomeSafe Verify ${suffix}`, email: `homesafe-verify-${suffix}@test.local` },
  });
  const teacher = await prisma.user.create({
    data: {
      schoolId: school.id,
      email: `verify-teacher-${suffix}@test.local`,
      passwordHash,
      role: "STAFF",
      fullName: "Verify Teacher",
    },
  });
  const learnerOne = await prisma.learner.create({
    data: {
      schoolId: school.id,
      firstName: "Alex",
      lastName: "VerifyOne",
      grade: "5",
      className: "5A",
      enrollmentStatus: "ACTIVE",
      admissionNo: `HV1-${suffix}`,
      tuitionFee: 100,
      notes: "homesafe-verify-baseline",
    },
  });
  const learnerTwo = await prisma.learner.create({
    data: {
      schoolId: school.id,
      firstName: "Blake",
      lastName: "VerifyTwo",
      grade: "5",
      className: "5B",
      enrollmentStatus: "ACTIVE",
      admissionNo: `HV2-${suffix}`,
      tuitionFee: 200,
      notes: "homesafe-verify-baseline",
    },
  });

  const token = jwt.sign(
    { userId: teacher.id, schoolId: school.id, email: teacher.email, role: "STAFF" },
    JWT_SECRET,
    { expiresIn: "1h" }
  );

  const baseline = {
    learnerOneUpdatedAt: learnerOne.createdAt.toISOString(),
    learnerTwoUpdatedAt: learnerTwo.createdAt.toISOString(),
    learnerCount: await prisma.learner.count({ where: { schoolId: school.id } }),
    attendanceCount: await prisma.learnerAttendance.count({ where: { schoolId: school.id } }),
    billingPlanCount: await prisma.learnerBillingPlanLine.count({ where: { schoolId: school.id } }),
  };

  const { base, close } = await startServer();
  const timings: Record<string, number> = {};

  try {
    const tSearchStart = Date.now();
    const searchRes = await fetch(`${base}/learners?search=Alex`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    timings.searchMs = Date.now() - tSearchStart;
    const searchJson = (await searchRes.json()) as {
      learners?: Array<{ learnerId: string; dismissedToday: boolean }>;
    };
    if (!searchRes.ok) throw new Error(`search failed ${searchRes.status}`);

    const tDismissStart = Date.now();
    const dismissRes = await fetch(`${base}/dismiss`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ learnerId: learnerOne.id, collectionMethod: "PARENT" }),
    });
    timings.dismissMs = Date.now() - tDismissStart;
    const dismissJson = (await dismissRes.json()) as {
      dismissal?: { schoolLocalTimeDisplay: string; displayName: string };
    };
    if (!dismissRes.ok) throw new Error(`dismiss failed ${dismissRes.status}`);

    const dupRes = await fetch(`${base}/dismiss`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ learnerId: learnerOne.id, collectionMethod: "TRANSPORT" }),
    });

    const transportRes = await fetch(`${base}/dismiss`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ learnerId: learnerTwo.id, collectionMethod: "TRANSPORT" }),
    });
    const transportJson = (await transportRes.json()) as { dismissal?: { schoolLocalTimeDisplay: string } };

    const events = await prisma.homeSafeEvent.findMany({
      where: { schoolId: school.id },
      orderBy: { createdAt: "asc" },
    });

    const learnerAfter = await prisma.learner.findMany({
      where: { id: { in: [learnerOne.id, learnerTwo.id] } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        className: true,
        tuitionFee: true,
        notes: true,
        enrollmentStatus: true,
      },
    });

    const afterCounts = {
      learnerCount: await prisma.learner.count({ where: { schoolId: school.id } }),
      attendanceCount: await prisma.learnerAttendance.count({ where: { schoolId: school.id } }),
      billingPlanCount: await prisma.learnerBillingPlanLine.count({ where: { schoolId: school.id } }),
    };

    const serverNow = resolveSchoolLocalParts(new Date());

    console.log(
      JSON.stringify(
        {
          success: true,
          timings,
          searchResultCount: searchJson.learners?.length ?? 0,
          firstDismissal: dismissJson.dismissal,
          duplicateStatus: dupRes.status,
          secondDismissal: transportJson.dismissal,
          events: events.map((e) => ({
            id: e.id,
            learnerId: e.learnerId,
            teacherId: e.teacherId,
            schoolId: e.schoolId,
            collectionMethod: e.collectionMethod,
            schoolLocalDate: e.schoolLocalDate,
            schoolLocalTime: e.schoolLocalTime,
            learnerNameSnapshot: e.learnerNameSnapshot,
            classroomSnapshot: e.classroomSnapshot,
            occurredAt: e.occurredAt.toISOString(),
          })),
          serverSchoolLocalNow: serverNow,
          baseline,
          afterCounts,
          learnersUnchanged: learnerAfter.every(
            (l) =>
              l.enrollmentStatus === "ACTIVE" &&
              l.notes === "homesafe-verify-baseline" &&
              (l.id === learnerOne.id ? l.tuitionFee === 100 : l.tuitionFee === 200)
          ),
        },
        null,
        2
      )
    );
  } finally {
    await close();
    await prisma.homeSafeEvent.deleteMany({ where: { schoolId: school.id } });
    await prisma.learner.deleteMany({ where: { schoolId: school.id } });
    await prisma.user.delete({ where: { id: teacher.id } });
    await prisma.school.delete({ where: { id: school.id } });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
