/**
 * Regression: removing a parent from a learner deletes exactly one ParentLearnerLink,
 * persists across reloads, is Owner/Admin + school scoped, idempotent, and never
 * touches the Parent record, the parent's other learners, or family billing data.
 *
 * Run (local DB only): npx tsx src/routes/parentUnlink.route.test.ts
 */
import assert from "assert";
import express from "express";
import http from "http";
import jwt from "jsonwebtoken";
import { prisma } from "../prisma";
import { setUserAccessMeta } from "../utils/userAccessStore";
import { permissionsForRole } from "../utils/userPermissions";
import { signParentToken } from "../middleware/parentAuth";
import { notifyParentsForLearner } from "../services/parentPortalService";
import { selectOutstandingBillingContact } from "../services/outstandingAccountsService";
import learnerRoutes from "./learner";
import parentsRoutes from "./parents";
import parentPortalRoutes from "./parentPortal";

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";

function assertLocalDatabase() {
  const url = String(process.env.DATABASE_URL || "");
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return "";
    }
  })();
  if (host !== "localhost" && host !== "127.0.0.1") {
    throw new Error(`Refusing to run parent unlink tests against non-local DB host (${host || "unknown"})`);
  }
}

function signStaff(input: { userId: string; schoolId: string; email: string; role: string }) {
  return jwt.sign(input, JWT_SECRET, { expiresIn: "1h" });
}

async function startServer() {
  const app = express();
  app.use(express.json());
  app.use("/api/learners", learnerRoutes);
  app.use("/api/parents", parentsRoutes);
  app.use("/api/parent-portal", parentPortalRoutes);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}

async function jsonFetch(
  url: string,
  opts: { method?: string; body?: unknown; token?: string } = {}
) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const res = await fetch(url, {
    method: opts.method || "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, any>;
  return { status: res.status, json };
}

let passed = 0;
function ok(name: string) {
  passed += 1;
  console.log(`  ok - ${name}`);
}

function testBillingContactPrefersAuthorisedLink() {
  const contact = (id: string, firstName: string) => ({
    id,
    firstName,
    surname: "Testfamily",
    cellNo: null,
    workNo: null,
    homeNo: null,
    email: null,
    communicationBilling: true,
  });
  const guardian = contact("p-guardian", "Guardian");
  const familyOnly = contact("p-familyOnly", "FamilyOnly");
  const chosen = selectOutstandingBillingContact(
    [
      {
        learnerId: "l-primary",
        isPrimary: true,
        isPayingPerson: false,
        billingStatement: true,
        relation: "Mother",
        parent: guardian,
      },
    ],
    ["l-primary"],
    [familyOnly, guardian]
  );
  assert.equal(chosen.parentId, "p-guardian", "linked parent outranks family-account-only parent");
  ok("statement contact: sole linked parent outranks family-account-only parent");
}

async function runLiveTests() {
  const suffix = Date.now();
  const schoolA = await prisma.school.create({
    data: { name: `Unlink A ${suffix}`, email: `unlink-a-${suffix}@test.local` },
  });
  const schoolB = await prisma.school.create({
    data: { name: `Unlink B ${suffix}`, email: `unlink-b-${suffix}@test.local` },
  });

  const mkUser = async (schoolId: string, label: string, appRole: string) => {
    const user = await prisma.user.create({
      data: {
        schoolId,
        email: `unlink-${label}-${suffix}@test.local`,
        passwordHash: "x",
        role: "SCHOOL_ADMIN",
        fullName: `User ${label}`,
      },
    });
    await setUserAccessMeta(user.id, {
      schoolId,
      appRole,
      firstName: "User",
      surname: label,
      permissions: permissionsForRole(appRole),
      lastLoginAt: null,
    });
    return {
      user,
      token: signStaff({ userId: user.id, schoolId, email: user.email, role: "SCHOOL_ADMIN" }),
    };
  };

  const adminA = await mkUser(schoolA.id, "admin-a", "Admin");
  const financeA = await mkUser(schoolA.id, "finance-a", "Finance");
  const adminB = await mkUser(schoolB.id, "admin-b", "Admin");

  const familyPrimary = await prisma.familyAccount.create({
    data: { schoolId: schoolA.id, accountRef: `PRI-${suffix}`, familyName: "Testfamily" },
  });
  const familyOther = await prisma.familyAccount.create({
    data: { schoolId: schoolA.id, accountRef: `OTH-${suffix}`, familyName: "Testfamily" },
  });

  const mkLearner = (schoolId: string, firstName: string, familyAccountId: string | null) =>
    prisma.learner.create({
      data: {
        schoolId,
        firstName,
        lastName: "Testfamily",
        grade: "1",
        className: "1A",
        familyAccountId,
        enrollmentStatus: "ACTIVE",
      },
    });
  const primaryLearner = await mkLearner(schoolA.id, "Primary", familyPrimary.id);
  const sibling = await mkLearner(schoolA.id, "Other", familyOther.id);
  const learnerB = await mkLearner(schoolB.id, "Bee", null);

  const mkParent = (schoolId: string, firstName: string, familyAccountId: string | null) =>
    prisma.parent.create({
      data: {
        schoolId,
        firstName,
        surname: "Testfamily",
        cellNo: `08${String(suffix).slice(-8)}`,
        email: `${firstName.toLowerCase()}-${suffix}@test.local`,
        familyAccountId,
      },
    });
  const guardian = await mkParent(schoolA.id, "Guardian", familyPrimary.id);
  const shared = await mkParent(schoolA.id, "Shared", familyOther.id);
  const parentB = await mkParent(schoolB.id, "Other", null);

  const link = (schoolId: string, parentId: string, learnerId: string, isPayingPerson = false) =>
    prisma.parentLearnerLink.create({
      data: { schoolId, parentId, learnerId, relation: "Guardian", isPrimary: true, isPayingPerson },
    });
  await link(schoolA.id, guardian.id, primaryLearner.id);
  await link(schoolA.id, shared.id, primaryLearner.id);
  await link(schoolA.id, shared.id, sibling.id, true);
  await link(schoolB.id, parentB.id, learnerB.id);

  const sharedBefore = await prisma.parent.findUnique({ where: { id: shared.id } });
  const linkExists = async (parentId: string, learnerId: string) =>
    Boolean(
      await prisma.parentLearnerLink.findUnique({
        where: { parentId_learnerId: { parentId, learnerId } },
      })
    );

  const { base, close } = await startServer();
  const unlink = (token: string | undefined, parentId: string, learnerId: string) =>
    jsonFetch(`${base}/api/parents/unlink-from-learner`, {
      method: "POST",
      token,
      body: { parentId, learnerId },
    });

  try {
    // ── Authorisation & school isolation ──
    assert.equal((await unlink(undefined, shared.id, primaryLearner.id)).status, 401);
    ok("unauthenticated unlink → 401");

    const finance = await unlink(financeA.token, shared.id, primaryLearner.id);
    assert.equal(finance.status, 403);
    assert.ok(await linkExists(shared.id, primaryLearner.id));
    ok("Finance role unlink → 403, link kept");

    const crossB = await unlink(adminB.token, shared.id, primaryLearner.id);
    assert.equal(crossB.status, 404);
    assert.equal(crossB.json.code, "PARENT_NOT_FOUND");
    assert.ok(await linkExists(shared.id, primaryLearner.id));
    ok("School B admin cannot unlink School A pair (404), link kept");

    const crossParent = await unlink(adminA.token, parentB.id, primaryLearner.id);
    assert.equal(crossParent.status, 404);
    const crossLearner = await unlink(adminA.token, shared.id, learnerB.id);
    assert.equal(crossLearner.status, 404);
    assert.equal(crossLearner.json.code, "LEARNER_NOT_FOUND");
    assert.ok(await linkExists(parentB.id, learnerB.id));
    ok("School A admin cannot reach School B parent or learner (404)");

    assert.equal((await unlink(adminA.token, "", primaryLearner.id)).status, 400);
    ok("missing parentId → 400");

    // ── Portal access before unlink ──
    const sharedPortalToken = signParentToken({ parentId: shared.id, schoolId: schoolA.id });
    const meBefore = await jsonFetch(`${base}/api/parent-portal/me`, { token: sharedPortalToken });
    const portalGated = meBefore.status === 403;
    if (!portalGated) {
      assert.equal(meBefore.status, 200);
      const ids = (meBefore.json.learners || []).map((r: any) => r.learner?.id);
      assert.ok(ids.includes(primaryLearner.id) && ids.includes(sibling.id));
    }

    // ── Shared parent: unlink from one learner only ──
    const res = await unlink(adminA.token, shared.id, primaryLearner.id);
    assert.equal(res.status, 200);
    assert.equal(res.json.unlinked, true);
    assert.equal(res.json.alreadyUnlinked, false);
    assert.equal(await linkExists(shared.id, primaryLearner.id), false);
    assert.equal(await linkExists(shared.id, sibling.id), true);
    assert.equal(await linkExists(guardian.id, primaryLearner.id), true);
    ok("shared parent unlinked from one learner; other learner link and co-parent kept");

    const sharedAfter = await prisma.parent.findUnique({ where: { id: shared.id } });
    assert.deepEqual(sharedAfter, sharedBefore);
    const siblingLink = await prisma.parentLearnerLink.findUnique({
      where: { parentId_learnerId: { parentId: shared.id, learnerId: sibling.id } },
    });
    assert.equal(siblingLink?.isPayingPerson, true);
    const faCount = await prisma.familyAccount.count({
      where: { id: { in: [familyPrimary.id, familyOther.id] }, retiredAt: null },
    });
    assert.equal(faCount, 2);
    const primaryLearnerAfter = await prisma.learner.findUnique({ where: { id: primaryLearner.id } });
    assert.equal(primaryLearnerAfter?.familyAccountId, familyPrimary.id);
    ok("Parent record, paying-person flag elsewhere, and family accounts untouched");

    const again = await unlink(adminA.token, shared.id, primaryLearner.id);
    assert.equal(again.status, 200);
    assert.equal(again.json.unlinked, false);
    assert.equal(again.json.alreadyUnlinked, true);
    ok("repeat unlink is idempotent (alreadyUnlinked)");

    // ── Persistence across reload (refresh / re-login = fresh GET) ──
    const detail = await jsonFetch(`${base}/api/learners/${encodeURIComponent(primaryLearner.id)}`);
    const parentIds = (detail.json.learner?.parents || []).map((p: any) => p.id);
    assert.deepEqual(parentIds, [guardian.id]);
    const list = await jsonFetch(`${base}/api/learners?schoolId=${encodeURIComponent(schoolA.id)}`);
    const row = (list.json.learners || []).find((r: any) => r.id === primaryLearner.id);
    assert.deepEqual((row?.parents || []).map((p: any) => p.id), [guardian.id]);
    ok("GET learner detail and list return only the remaining linked parent");

    // ── Portal access & notifications after unlink ──
    if (!portalGated) {
      const meAfter = await jsonFetch(`${base}/api/parent-portal/me`, { token: sharedPortalToken });
      const ids = (meAfter.json.learners || []).map((r: any) => r.learner?.id);
      assert.ok(!ids.includes(primaryLearner.id), "unlinked learner no longer in portal");
      assert.ok(ids.includes(sibling.id), "other learner still in portal");
      ok("parent portal: unlinked learner removed, other learner retained");
    } else {
      console.log("  skip - parent portal /me (CORE module gate active for test school)");
    }

    const notified = await notifyParentsForLearner({
      schoolId: schoolA.id,
      learnerId: primaryLearner.id,
      type: "SCHOOL_NOTICE",
      title: "Test",
      message: "Test",
    });
    assert.equal(notified, 1);
    const notifParents = await prisma.parentNotification.findMany({
      where: { schoolId: schoolA.id, learnerId: primaryLearner.id },
      select: { parentId: true },
    });
    assert.deepEqual(
      notifParents.map((n) => n.parentId),
      [guardian.id]
    );
    ok("learner notifications go only to the remaining linked parent");

    // ── Existing parent editing does not recreate removed links ──
    const edit = await jsonFetch(`${base}/api/learners/${encodeURIComponent(primaryLearner.id)}`, {
      method: "PUT",
      token: adminA.token,
      body: {
        parents: [
          {
            id: guardian.id,
            firstName: "Guardian",
            surname: "Testfamily",
            cellNo: guardian.cellNo,
            email: guardian.email,
            relationship: "Mother",
          },
        ],
      },
    });
    assert.equal(edit.status, 200, JSON.stringify(edit.json));
    assert.equal(await linkExists(shared.id, primaryLearner.id), false);
    assert.deepEqual((edit.json.learner?.parents || []).map((p: any) => p.id), [guardian.id]);
    ok("editing a remaining parent does not recreate the removed link");

    // ── Legitimate re-link of a parent to multiple learners still allowed ──
    const relink = await jsonFetch(`${base}/api/parents/link-to-learner`, {
      method: "POST",
      token: adminA.token,
      body: { parentId: shared.id, learnerId: primaryLearner.id, isPrimary: false },
    });
    assert.equal(relink.status, 200);
    assert.equal(await linkExists(shared.id, primaryLearner.id), true);
    assert.equal(await linkExists(shared.id, sibling.id), true);
    ok("owner can deliberately link a shared parent to multiple learners");
    await unlink(adminA.token, shared.id, primaryLearner.id);

    // ── Adding a new parent still works ──
    const add = await jsonFetch(`${base}/api/learners/${encodeURIComponent(primaryLearner.id)}`, {
      method: "PUT",
      token: adminA.token,
      body: {
        parents: [
          {
            firstName: "Newdad",
            surname: "Zulu",
            cellNo: "0839990000",
            relationship: "Father",
            confirmCreateDespiteMatch: true,
          },
        ],
      },
    });
    assert.equal(add.status, 200, JSON.stringify(add.json));
    const added = (add.json.learner?.parents || []).find((p: any) => p.firstName === "Newdad");
    assert.ok(added?.id);
    ok("adding a new parent still creates a link");

    // ── Zero linked parents ──
    await unlink(adminA.token, added.id, primaryLearner.id);
    await unlink(adminA.token, guardian.id, primaryLearner.id);
    const empty = await jsonFetch(`${base}/api/learners/${encodeURIComponent(primaryLearner.id)}`);
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.json.learner?.parents, []);
    assert.ok(await prisma.parent.findUnique({ where: { id: guardian.id } }));
    ok("learner with zero linked parents returns an empty list; parent records kept");
  } finally {
    await close();
    const schoolIds = [schoolA.id, schoolB.id];
    await prisma.communicationLog.deleteMany({ where: { schoolId: { in: schoolIds } } }).catch(() => undefined);
    await prisma.communicationMessage.deleteMany({ where: { schoolId: { in: schoolIds } } }).catch(() => undefined);
    await prisma.parentNotification.deleteMany({ where: { schoolId: { in: schoolIds } } }).catch(() => undefined);
    await prisma.communicationTemplate.deleteMany({ where: { schoolId: { in: schoolIds } } }).catch(() => undefined);
    await prisma.parentOnboarding.deleteMany({ where: { schoolId: { in: schoolIds } } }).catch(() => undefined);
    await prisma.parentLearnerLink.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await prisma.parent.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await prisma.learner.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await prisma.familyAccount.deleteMany({ where: { schoolId: { in: schoolIds } } });
    const userIds = [adminA.user.id, financeA.user.id, adminB.user.id];
    await prisma.userRbacMeta.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.school.deleteMany({ where: { id: { in: schoolIds } } }).catch(() => undefined);
  }
}

async function main() {
  testBillingContactPrefersAuthorisedLink();
  assertLocalDatabase();
  await runLiveTests();
  console.log(`\nAll ${passed} parent unlink tests passed.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
