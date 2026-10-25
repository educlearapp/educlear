/**
 * OTP / findParentByCredentials learner school isolation.
 * Aligns with parentWithLearners dual schoolId scoping (Phase 5/6).
 * SAFE TARGET: localhost PostgreSQL only. Synthetic fixtures cleaned after run.
 *
 * Run: npx tsx src/services/parentPortalFindParentByCredentials.otp.security.test.ts
 */
import assert from "assert";
import { PrismaClient } from "@prisma/client";

import { findParentByCredentials } from "./parentPortalService";
import { parentWithLearners } from "../routes/parentPortal";
import { ensureSchoolModuleEntitlements } from "./schoolModuleEntitlements";
import { signParentToken } from "../middleware/parentAuth";

const prisma = new PrismaClient();
const PREFIX = "pp20otp-";
const API = process.env.PP20_OTP_API_BASE || "http://127.0.0.1:3000";

function assertLocalDatabase() {
  const url = String(process.env.DATABASE_URL || "");
  assert.ok(url, "DATABASE_URL required");
  let host = "";
  try {
    host = new URL(url.replace(/^postgresql:/, "http:")).hostname;
  } catch {
    host = "";
  }
  assert.ok(
    host === "localhost" || host === "127.0.0.1",
    `Refusing OTP security tests against non-local host: ${host || "(unknown)"}`
  );
}

async function cleanup() {
  const schools = await prisma.school.findMany({
    where: { id: { startsWith: PREFIX } },
    select: { id: true },
  });
  for (const s of schools) {
    const parents = await prisma.parent.findMany({
      where: { schoolId: s.id },
      select: { id: true },
    });
    for (const p of parents) {
      await prisma.parentOnboarding.deleteMany({ where: { parentId: p.id } }).catch(() => undefined);
      await prisma.parentLearnerLink.deleteMany({ where: { parentId: p.id } });
    }
    await prisma.parentLearnerLink.deleteMany({ where: { schoolId: s.id } });
    await prisma.parent.deleteMany({ where: { schoolId: s.id } });
    await prisma.learner.deleteMany({ where: { schoolId: s.id } });
    await prisma.schoolModuleEntitlement.deleteMany({ where: { schoolId: s.id } }).catch(() => undefined);
    await prisma.school.delete({ where: { id: s.id } }).catch(() => undefined);
  }
}

function linkLearnerIds(parent: { links?: Array<{ learner?: { id?: string } | null }> } | null) {
  return (parent?.links || [])
    .map((l) => l.learner?.id)
    .filter((id): id is string => Boolean(id))
    .sort();
}

/** Pre-fix query shape — proves forged cross-school learner was visible. */
async function findParentByCredentialsVulnerable(opts: {
  schoolId: string;
  idNumber: string;
  cellNo?: string;
}) {
  const schoolId = String(opts.schoolId || "").trim();
  const idNumber = String(opts.idNumber || "").trim();
  if (!schoolId || !idNumber) return null;
  return prisma.parent.findFirst({
    where: { schoolId, idNumber },
    include: {
      links: {
        where: { schoolId },
        include: { learner: true },
      },
      school: { select: { id: true, name: true } },
    },
  });
}

async function json(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function main() {
  assertLocalDatabase();
  await cleanup();

  const schoolA = await prisma.school.create({
    data: {
      id: `${PREFIX}A-${Date.now()}`,
      name: "PP20 OTP School A",
      email: `${PREFIX}a@pp20otp.test`,
      lifecycleStatus: "ACTIVE",
    },
  });
  const schoolB = await prisma.school.create({
    data: {
      id: `${PREFIX}B-${Date.now()}`,
      name: "PP20 OTP School B",
      email: `${PREFIX}b@pp20otp.test`,
      lifecycleStatus: "ACTIVE",
    },
  });
  await ensureSchoolModuleEntitlements(schoolA.id);
  await ensureSchoolModuleEntitlements(schoolB.id);

  const idNumber = `OTP${Date.now()}`.slice(0, 13);
  const cellNo = "0829000111";
  const parent = await prisma.parent.create({
    data: {
      id: `${schoolA.id}-parent`,
      schoolId: schoolA.id,
      firstName: "Otp",
      surname: "Fixture",
      cellNo,
      idNumber,
      email: "otp.fixture@pp20otp.test",
    },
  });

  const kidsA = [];
  for (const tag of ["1", "2", "3", "4", "5"]) {
    const learner = await prisma.learner.create({
      data: {
        id: `${schoolA.id}-L${tag}`,
        schoolId: schoolA.id,
        firstName: `OtpChild${tag}`,
        lastName: "Fixture",
        grade: tag,
        className: "A",
        admissionNo: `OTP${tag}`,
      },
    });
    kidsA.push(learner);
    await prisma.parentLearnerLink.create({
      data: {
        schoolId: schoolA.id,
        parentId: parent.id,
        learnerId: learner.id,
        relation: "Mother",
        isPrimary: tag === "1",
      },
    });
  }

  const kidB = await prisma.learner.create({
    data: {
      id: `${schoolB.id}-LX`,
      schoolId: schoolB.id,
      firstName: "Foreign",
      lastName: "Learner",
      grade: "1",
      className: "Z",
      admissionNo: "FORX",
    },
  });
  await prisma.parentLearnerLink.create({
    data: {
      schoolId: schoolA.id, // forged
      parentId: parent.id,
      learnerId: kidB.id,
      relation: "Mother",
      isPrimary: false,
    },
  });

  const vulnerable = await findParentByCredentialsVulnerable({
    schoolId: schoolA.id,
    idNumber,
    cellNo,
  });
  const vulnerableIds = linkLearnerIds(vulnerable);
  assert.ok(vulnerableIds.includes(kidB.id), "sanity: vulnerable OTP lookup still exposes foreign learner");
  console.log("✓ Vulnerable baseline still exposes forged cross-school link on OTP credential lookup");

  const fixed = await findParentByCredentials({ schoolId: schoolA.id, idNumber, cellNo });
  assert.ok(fixed, "findParentByCredentials returns parent");
  const fixedIds = linkLearnerIds(fixed);
  assert.equal(fixedIds.length, 5, "OTP credential lookup returns 5 same-school children");
  assert.ok(!fixedIds.includes(kidB.id), "OTP credential lookup excludes foreign learner");
  for (const kid of kidsA) {
    assert.ok(fixedIds.includes(kid.id), `includes legitimate child ${kid.id}`);
  }
  console.log("✓ Fixed findParentByCredentials: 5 valid; forged foreign learner excluded");

  // 1 / 2 / 3 / 5 progressive link counts
  const parentCounts = await prisma.parent.create({
    data: {
      id: `${schoolA.id}-counts`,
      schoolId: schoolA.id,
      firstName: "Counts",
      surname: "Otp",
      cellNo: "0829000222",
      idNumber: `OTC${Date.now()}`.slice(0, 13),
    },
  });
  const countKids = [];
  for (const tag of ["A", "B", "C", "D", "E"]) {
    countKids.push(
      await prisma.learner.create({
        data: {
          id: `${schoolA.id}-C${tag}`,
          schoolId: schoolA.id,
          firstName: `Count${tag}`,
          lastName: "Otp",
          grade: "1",
          className: "C",
          admissionNo: `OC${tag}`,
        },
      })
    );
  }
  for (const n of [1, 2, 3, 5]) {
    await prisma.parentLearnerLink.deleteMany({ where: { parentId: parentCounts.id } });
    for (let i = 0; i < n; i++) {
      await prisma.parentLearnerLink.create({
        data: {
          schoolId: schoolA.id,
          parentId: parentCounts.id,
          learnerId: countKids[i].id,
          relation: "Father",
          isPrimary: i === 0,
        },
      });
    }
    const row = await findParentByCredentials({
      schoolId: schoolA.id,
      idNumber: parentCounts.idNumber!,
      cellNo: parentCounts.cellNo!,
    });
    assert.equal(linkLearnerIds(row).length, n, `credential lookup with ${n} links returns ${n}`);
  }
  console.log("✓ Synthetic parents with 1, 2, 3 and 5 children via findParentByCredentials");

  // Consistency: findParentByCredentials ↔ parentWithLearners
  const viaMeHelper = await parentWithLearners(parent.id, schoolA.id);
  assert.deepStrictEqual(
    linkLearnerIds(fixed),
    linkLearnerIds(viaMeHelper),
    "OTP credential learners match parentWithLearners (/me source)"
  );
  console.log("✓ findParentByCredentials matches parentWithLearners learner set");

  // Live HTTP: verify-otp + /me + /dashboard when local API is up
  let apiReachable = false;
  try {
    const ping = await fetch(`${API}/api/public/schools`);
    apiReachable = ping.ok;
  } catch {
    apiReachable = false;
  }

  if (apiReachable) {
    const otpReq = await json("/api/parent-portal/auth/request-otp", {
      method: "POST",
      body: JSON.stringify({ schoolId: schoolA.id, idNumber, cellNo }),
    });
    assert.equal(otpReq.status, 200, `request-otp status ${otpReq.status}`);
    const code = String(otpReq.body?.testOtp || otpReq.body?.devOtp || "000000");
    const verify = await json("/api/parent-portal/auth/verify-otp", {
      method: "POST",
      body: JSON.stringify({ schoolId: schoolA.id, idNumber, cellNo, code }),
    });
    assert.equal(verify.status, 200, `verify-otp status ${verify.status}`);
    const verifyLearners = Array.isArray(verify.body?.learners) ? verify.body.learners : [];
    const verifyIds = verifyLearners
      .map((row: { learner?: { id?: string }; id?: string }) => row.learner?.id || row.id)
      .filter(Boolean)
      .sort();
    assert.equal(verifyIds.length, 5, "verify-otp returns 5 authorised learners");
    assert.ok(!verifyIds.includes(kidB.id), "verify-otp never returns foreign learner");

    const token = String(verify.body?.token || "");
    assert.ok(token, "verify-otp returns JWT");
    // Also sign a token locally to prove JWT claims unchanged shape
    const signed = signParentToken({
      parentId: parent.id,
      schoolId: schoolA.id,
      idNumber,
    });
    assert.ok(signed.split(".").length === 3);

    const auth = { Authorization: `Bearer ${token}` };
    const me = await json("/api/parent-portal/me", { headers: auth });
    assert.equal(me.status, 200);
    const meIds = (me.body?.learners || [])
      .map((row: { learner?: { id?: string } }) => row.learner?.id)
      .filter(Boolean)
      .sort();
    assert.deepStrictEqual(meIds, verifyIds, "verify-otp learners match /me");

    const dash = await json(`/api/parent-portal/dashboard?learnerId=${encodeURIComponent(kidsA[0].id)}`, {
      headers: auth,
    });
    assert.equal(dash.status, 200);
    const dashIds = (dash.body?.learners || []).map((l: { id?: string }) => l.id).filter(Boolean).sort();
    assert.deepStrictEqual(dashIds, verifyIds, "verify-otp learners match /dashboard");
    console.log("✓ HTTP verify-otp, /me and /dashboard return consistent authorised learner sets");
  } else {
    console.log("○ Local API not reachable — skipped HTTP verify-otp//me/dashboard consistency (unit path still PASS)");
  }

  await cleanup();
  console.log("\nparentPortalFindParentByCredentials.otp.security.test: PASS");
}

main()
  .catch(async (error) => {
    console.error(error);
    process.exitCode = 1;
    await cleanup().catch(() => undefined);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
