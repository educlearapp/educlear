/**
 * HomeSafe route integration tests.
 * Run: npx ts-node --transpile-only src/routes/homesafe.route.test.ts
 */
import bcrypt from "bcryptjs";
import express from "express";
import http from "http";
import jwt from "jsonwebtoken";
import teacherAppRoutes from "./teacherApp";
import { prisma } from "../prisma";
import { resolveSchoolLocalParts } from "../utils/schoolLocalTime";

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
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}/api/teacher-app/homesafe`,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
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

type Fixture = {
  schoolAId: string;
  schoolBId: string;
  teacherAId: string;
  teacherBId: string;
  activeLearnerAId: string;
  historicalLearnerAId: string;
  activeLearnerBId: string;
  tokenA: string;
  tokenB: string;
};

async function createFixture(): Promise<Fixture> {
  const suffix = Date.now();
  const passwordHash = await bcrypt.hash("test-password", 4);

  const schoolA = await prisma.school.create({
    data: { name: `HomeSafe Test School A ${suffix}`, email: `homesafe-a-${suffix}@test.local` },
  });
  const schoolB = await prisma.school.create({
    data: { name: `HomeSafe Test School B ${suffix}`, email: `homesafe-b-${suffix}@test.local` },
  });

  const teacherA = await prisma.user.create({
    data: {
      schoolId: schoolA.id,
      email: `teacher-a-${suffix}@test.local`,
      passwordHash,
      role: "STAFF",
      fullName: "Teacher Alpha",
    },
  });
  const teacherB = await prisma.user.create({
    data: {
      schoolId: schoolB.id,
      email: `teacher-b-${suffix}@test.local`,
      passwordHash,
      role: "STAFF",
      fullName: "Teacher Beta",
    },
  });

  const activeLearnerA = await prisma.learner.create({
    data: {
      schoolId: schoolA.id,
      firstName: "Jamie",
      lastName: "Active",
      grade: "3",
      className: "3A",
      enrollmentStatus: "ACTIVE",
      admissionNo: `HSA-${suffix}`,
    },
  });
  const historicalLearnerA = await prisma.learner.create({
    data: {
      schoolId: schoolA.id,
      firstName: "Jamie",
      lastName: "Historical",
      grade: "3",
      className: "3A",
      enrollmentStatus: "HISTORICAL",
      admissionNo: `HSH-${suffix}`,
    },
  });
  const activeLearnerB = await prisma.learner.create({
    data: {
      schoolId: schoolB.id,
      firstName: "Jamie",
      lastName: "OtherSchool",
      grade: "4",
      className: "4B",
      enrollmentStatus: "ACTIVE",
      admissionNo: `HSB-${suffix}`,
    },
  });

  return {
    schoolAId: schoolA.id,
    schoolBId: schoolB.id,
    teacherAId: teacherA.id,
    teacherBId: teacherB.id,
    activeLearnerAId: activeLearnerA.id,
    historicalLearnerAId: historicalLearnerA.id,
    activeLearnerBId: activeLearnerB.id,
    tokenA: signToken({
      userId: teacherA.id,
      schoolId: schoolA.id,
      email: teacherA.email,
      role: "STAFF",
    }),
    tokenB: signToken({
      userId: teacherB.id,
      schoolId: schoolB.id,
      email: teacherB.email,
      role: "STAFF",
    }),
  };
}

async function cleanupFixture(fixture: Fixture) {
  await prisma.homeSafeEvent.deleteMany({
    where: { schoolId: { in: [fixture.schoolAId, fixture.schoolBId] } },
  });
  await prisma.learner.deleteMany({
    where: { schoolId: { in: [fixture.schoolAId, fixture.schoolBId] } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [fixture.teacherAId, fixture.teacherBId] } },
  });
  await prisma.school.deleteMany({
    where: { id: { in: [fixture.schoolAId, fixture.schoolBId] } },
  });
}

async function runTests() {
  const { baseUrl, close } = await startTestServer();
  const fixture = await createFixture();
  let passed = 0;

  try {
    const unauth = await apiCall(baseUrl, "/learners?search=Jamie");
    assert(unauth.status === 401, `expected 401 unauthenticated, got ${unauth.status}`);
    passed += 1;

    const searchOwn = await apiCall(baseUrl, "/learners?search=Jamie", { token: fixture.tokenA });
    assert(searchOwn.status === 200, `search own school expected 200 got ${searchOwn.status}`);
    const ownLearners = (searchOwn.json.learners as Array<{ learnerId: string }>) || [];
    assert(
      ownLearners.some((l) => l.learnerId === fixture.activeLearnerAId),
      "active learner in own school should appear"
    );
    assert(
      !ownLearners.some((l) => l.learnerId === fixture.historicalLearnerAId),
      "historical learner should not appear"
    );
    assert(
      !ownLearners.some((l) => l.learnerId === fixture.activeLearnerBId),
      "other school learner should not appear"
    );
    passed += 1;

    const parentDismiss = await apiCall(baseUrl, "/dismiss", {
      method: "POST",
      token: fixture.tokenA,
      body: { learnerId: fixture.activeLearnerAId, collectionMethod: "PARENT" },
    });
    assert(parentDismiss.status === 200, `parent dismiss expected 200 got ${parentDismiss.status}`);
    const dismissal = parentDismiss.json.dismissal as Record<string, unknown>;
    assert(dismissal?.collectionMethod === "PARENT", "collection method should be PARENT");
    assert(dismissal?.teacherId === fixture.teacherAId, "teacherId must come from auth");
    passed += 1;

    const saved = await prisma.homeSafeEvent.findFirst({
      where: { learnerId: fixture.activeLearnerAId, schoolId: fixture.schoolAId },
    });
    assert(Boolean(saved), "event should be saved");
    assert(saved!.schoolId === fixture.schoolAId, "schoolId must come from auth");
    assert(saved!.teacherId === fixture.teacherAId, "teacherId saved from auth");
    assert(!String(saved!.occurredAt).includes("1970"), "occurredAt should be server-generated");
    passed += 1;

    const duplicate = await apiCall(baseUrl, "/dismiss", {
      method: "POST",
      token: fixture.tokenA,
      body: { learnerId: fixture.activeLearnerAId, collectionMethod: "TRANSPORT" },
    });
    assert(duplicate.status === 409, `duplicate dismiss expected 409 got ${duplicate.status}`);
    assert(duplicate.json.code === "ALREADY_DISMISSED", "duplicate code expected");
    passed += 1;

    const crossSchool = await apiCall(baseUrl, "/dismiss", {
      method: "POST",
      token: fixture.tokenB,
      body: { learnerId: fixture.activeLearnerAId, collectionMethod: "PARENT" },
    });
    assert(crossSchool.status === 404, `cross-school dismiss expected 404 got ${crossSchool.status}`);
    passed += 1;

    const raceLearner = await prisma.learner.create({
      data: {
        schoolId: fixture.schoolAId,
        firstName: "Race",
        lastName: "Concurrent",
        grade: "1",
        className: "1A",
        enrollmentStatus: "ACTIVE",
        admissionNo: `HSR-${Date.now()}`,
      },
    });
    const [raceA, raceB] = await Promise.all([
      apiCall(baseUrl, "/dismiss", {
        method: "POST",
        token: fixture.tokenA,
        body: { learnerId: raceLearner.id, collectionMethod: "PARENT" },
      }),
      apiCall(baseUrl, "/dismiss", {
        method: "POST",
        token: fixture.tokenA,
        body: { learnerId: raceLearner.id, collectionMethod: "TRANSPORT" },
      }),
    ]);
    const raceSuccessCount = [raceA.status, raceB.status].filter((s) => s === 200).length;
    const raceConflictCount = [raceA.status, raceB.status].filter((s) => s === 409).length;
    assert(raceSuccessCount === 1, "concurrent dismiss: exactly one should succeed");
    assert(raceConflictCount === 1, "concurrent dismiss: exactly one should conflict");
    const raceEventCount = await prisma.homeSafeEvent.count({
      where: { learnerId: raceLearner.id, schoolId: fixture.schoolAId },
    });
    assert(raceEventCount === 1, "concurrent dismiss: only one DB event");
    passed += 1;

    const transportLearner = await prisma.learner.create({
      data: {
        schoolId: fixture.schoolAId,
        firstName: "Taylor",
        lastName: "Transport",
        grade: "2",
        className: "2C",
        enrollmentStatus: "ACTIVE",
        admissionNo: `HST-${Date.now()}`,
      },
    });
    const transportDismiss = await apiCall(baseUrl, "/dismiss", {
      method: "POST",
      token: fixture.tokenA,
      body: { learnerId: transportLearner.id, collectionMethod: "TRANSPORT" },
    });
    assert(transportDismiss.status === 200, "transport dismiss should succeed");
    passed += 1;

    const invalidMethod = await apiCall(baseUrl, "/dismiss", {
      method: "POST",
      token: fixture.tokenA,
      body: { learnerId: transportLearner.id, collectionMethod: "WALK" },
    });
    assert(invalidMethod.status === 400, "invalid collection method should be 400");
    passed += 1;

    const inactiveDismiss = await apiCall(baseUrl, "/dismiss", {
      method: "POST",
      token: fixture.tokenA,
      body: { learnerId: fixture.historicalLearnerAId, collectionMethod: "PARENT" },
    });
    assert(inactiveDismiss.status === 409, "inactive learner dismiss should be 409");
    passed += 1;

    await prisma.learner.update({
      where: { id: fixture.activeLearnerAId },
      data: { firstName: "Renamed", lastName: "Learner", className: "9Z" },
    });
    const historicalEvent = await prisma.homeSafeEvent.findFirst({
      where: { id: saved!.id },
    });
    assert(
      Boolean(historicalEvent?.learnerNameSnapshot.includes("Jamie")),
      "historical snapshot should preserve original learner name"
    );
    assert(historicalEvent?.classroomSnapshot === "3A", "historical snapshot should preserve classroom");
    passed += 1;

    const fixedNow = new Date("2026-07-15T10:30:00.000Z");
    const parts = resolveSchoolLocalParts(fixedNow);
    assert(/^\d{4}-\d{2}-\d{2}$/.test(parts.schoolLocalDate), "schoolLocalDate format");
    assert(/^\d{2}:\d{2}:\d{2}$/.test(parts.schoolLocalTime), "schoolLocalTime format");
    passed += 1;

    const eventCount = await prisma.homeSafeEvent.count({
      where: { learnerId: fixture.activeLearnerAId, schoolId: fixture.schoolAId },
    });
    assert(eventCount === 1, "duplicate protection should leave exactly one event");
    passed += 1;

    console.log(`HomeSafe route tests passed: ${passed}`);
  } finally {
    await cleanupFixture(fixture);
    await close();
  }
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
