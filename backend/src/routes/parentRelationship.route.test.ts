/**
 * Regression: a parent's relationship (Mother / Father / Guardian …) edited through
 * Manage Learner persists on the learner's ParentLearnerLink, survives reloads and
 * unrelated learner saves, and never disturbs family accounts, primary contacts or
 * billing settings.
 *
 * Relationship is per learner: for a parent linked to several learners, a change on one
 * learner (or an unchanged save from a sibling) never alters the other learners or the
 * parent record — including learners whose blank link displays the parent fallback.
 * Imports / repair tools may only fill a blank relationship. Link-existing-parent requests
 * from frontends released before the relationship picker keep working until
 * PARENT_LINK_RELATION_REQUIRED=true is set.
 *
 * Run (local DB only): npx tsx src/routes/parentRelationship.route.test.ts
 */
import assert from "assert";
import express from "express";
import http from "http";
import jwt from "jsonwebtoken";
import { prisma } from "../prisma";
import { setUserAccessMeta } from "../utils/userAccessStore";
import { permissionsForRole } from "../utils/userPermissions";
import { fillBlankLinkRelation, relationshipFillForParent } from "../utils/parentLinkRelation";
import learnerRoutes from "./learner";
import parentsRoutes from "./parents";

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
    throw new Error(`Refusing to run parent relationship tests against non-local DB host (${host || "unknown"})`);
  }
}

async function startServer() {
  const app = express();
  app.use(express.json());
  app.use("/api/learners", learnerRoutes);
  app.use("/api/parents", parentsRoutes);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}

async function jsonFetch(url: string, opts: { method?: string; body?: unknown; token?: string } = {}) {
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

async function runLiveTests() {
  const suffix = Date.now();
  const school = await prisma.school.create({
    data: { name: `Relationship ${suffix}`, email: `relationship-${suffix}@test.local` },
  });
  const user = await prisma.user.create({
    data: {
      schoolId: school.id,
      email: `relationship-admin-${suffix}@test.local`,
      passwordHash: "x",
      role: "SCHOOL_ADMIN",
      fullName: "Relationship Admin",
    },
  });
  await setUserAccessMeta(user.id, {
    schoolId: school.id,
    appRole: "Admin",
    firstName: "Relationship",
    surname: "Admin",
    permissions: permissionsForRole("Admin"),
    lastLoginAt: null,
  });
  const token = jwt.sign(
    { userId: user.id, schoolId: school.id, email: user.email, role: "SCHOOL_ADMIN" },
    JWT_SECRET,
    { expiresIn: "1h" }
  );

  const family = await prisma.familyAccount.create({
    data: { schoolId: school.id, accountRef: `REL-${suffix}`, familyName: "Testfamily" },
  });
  const mkLearner = (firstName: string) =>
    prisma.learner.create({
      data: {
        schoolId: school.id,
        firstName,
        lastName: "Testfamily",
        grade: "1",
        className: "1A",
        familyAccountId: family.id,
        enrollmentStatus: "ACTIVE",
      },
    });
  const learnerA = await mkLearner("Alpha");
  const learnerB = await mkLearner("Beta");

  let cellSeq = 0;
  const mkParent = (firstName: string) =>
    prisma.parent.create({
      data: {
        schoolId: school.id,
        familyAccountId: family.id,
        firstName,
        surname: "Testfamily",
        relationship: "Guardian",
        cellNo: `08${String(suffix + ++cellSeq).slice(-8)}`,
        email: `${firstName.toLowerCase()}-${suffix}@test.local`,
        communicationBilling: false,
      },
    });
  const mum = await mkParent("Mum");
  const dad = await mkParent("Dad");
  const shared = await mkParent("Shared");

  const mkLink = (parentId: string, learnerId: string, extra: Record<string, unknown> = {}) =>
    prisma.parentLearnerLink.create({
      data: { schoolId: school.id, parentId, learnerId, relation: "Guardian", isPrimary: true, ...extra },
    });
  await mkLink(mum.id, learnerA.id, { isPayingPerson: true, billingInvoice: false });
  await mkLink(dad.id, learnerA.id, { isPrimary: false, billingReceipt: false });
  await mkLink(shared.id, learnerA.id, { isPrimary: false });
  await mkLink(shared.id, learnerB.id, { isPrimary: true });

  const { base, close } = await startServer();

  const detailParents = async (learnerId: string) =>
    ((await jsonFetch(`${base}/api/learners/${encodeURIComponent(learnerId)}`)).json.learner?.parents || []) as any[];
  const listParents = async (learnerId: string) => {
    const list = await jsonFetch(`${base}/api/learners?schoolId=${encodeURIComponent(school.id)}`);
    const row = (list.json.learners || []).find((r: any) => r.id === learnerId);
    return (row?.parents || []) as any[];
  };
  const linkRow = (parentId: string, learnerId: string) =>
    prisma.parentLearnerLink.findUnique({ where: { parentId_learnerId: { parentId, learnerId } } });

  /** Manage Learner "Save Parent": the edited parent only, as built by parentToApiPayload. */
  const saveParent = async (learnerId: string, parentId: string, overrides: Record<string, unknown>) => {
    const current = (await detailParents(learnerId)).find((p) => p.id === parentId);
    assert.ok(current, `parent ${parentId} not linked to ${learnerId}`);
    const res = await jsonFetch(`${base}/api/learners/${encodeURIComponent(learnerId)}`, {
      method: "PUT",
      token,
      body: {
        parents: [
          {
            id: current.id,
            relationship: current.relationship || "Parent",
            title: current.title || null,
            firstName: current.firstName,
            surname: current.surname,
            cellNo: current.cellNo,
            phone: current.cellNo,
            email: current.email || undefined,
            communicationBilling: current.communicationBilling !== false,
            communicationAdministration: current.communicationAdministration !== false,
            communicationByEmail: current.communicationByEmail !== false,
            communicationByPrint: current.communicationByPrint !== false,
            communicationBySMS: current.communicationBySMS !== false,
            isPayingPerson: Boolean(current.isPayingPerson),
            billingStatement: current.billingStatement !== false,
            billingInvoice: current.billingInvoice !== false,
            billingReceipt: current.billingReceipt !== false,
            isPrimary: current.isPrimary !== false,
            ...overrides,
          },
        ],
      },
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    return res;
  };

  const relationOn = async (learnerId: string, parentId: string) => {
    const detail = (await detailParents(learnerId)).find((p) => p.id === parentId);
    const listed = (await listParents(learnerId)).find((p) => p.id === parentId);
    const row = await linkRow(parentId, learnerId);
    return { detail: detail?.relationship, list: listed?.relationship, db: row?.relation };
  };

  try {
    const familyBefore = await prisma.familyAccount.findUnique({ where: { id: family.id } });
    const mumLinkBefore = await linkRow(mum.id, learnerA.id);
    const dadLinkBefore = await linkRow(dad.id, learnerA.id);

    // ── Guardian → Mother ──
    await saveParent(learnerA.id, mum.id, { relationship: "Mother" });
    assert.deepEqual(await relationOn(learnerA.id, mum.id), { detail: "Mother", list: "Mother", db: "Mother" });
    ok("Guardian → Mother persists (DB link, learner detail, learner list)");

    // ── Guardian → Father ──
    await saveParent(learnerA.id, dad.id, { relationship: "Father" });
    assert.deepEqual(await relationOn(learnerA.id, dad.id), { detail: "Father", list: "Father", db: "Father" });
    ok("Guardian → Father persists");

    // ── Multiple parents on the same learner keep their own relationship ──
    assert.equal((await relationOn(learnerA.id, mum.id)).db, "Mother");
    assert.equal((await relationOn(learnerA.id, shared.id)).db, "Guardian");
    ok("multiple parents on one learner: each keeps its own relationship");

    // ── Mother → Father ──
    await saveParent(learnerA.id, mum.id, { relationship: "Father" });
    assert.equal((await relationOn(learnerA.id, mum.id)).db, "Father");
    await saveParent(learnerA.id, mum.id, { relationship: "Mother" });
    assert.deepEqual(await relationOn(learnerA.id, mum.id), { detail: "Mother", list: "Mother", db: "Mother" });
    ok("Mother → Father → Mother persists each time");

    // ── Unrelated learner saves (Manage Learner Save, classroom move, billing plan) ──
    const learnerSave = await jsonFetch(`${base}/api/learners/${encodeURIComponent(learnerA.id)}`, {
      method: "PUT",
      token,
      body: { firstName: "Alpha", lastName: "Testfamily", notes: "updated note", className: "1A" },
    });
    assert.equal(learnerSave.status, 200, JSON.stringify(learnerSave.json));
    const classMove = await jsonFetch(`${base}/api/learners/${encodeURIComponent(learnerA.id)}`, {
      method: "PUT",
      body: { className: "1B", classroom: "1B", classroomName: "1B", grade: "1" },
    });
    assert.equal(classMove.status, 200, JSON.stringify(classMove.json));
    const loaded = (await jsonFetch(`${base}/api/learners/${encodeURIComponent(learnerA.id)}`)).json.learner;
    const billingSave = await jsonFetch(`${base}/api/learners/${encodeURIComponent(learnerA.id)}`, {
      method: "PUT",
      token,
      // Billing tab body shape minus billingPlan, so the test leaves local billing JSON stores alone.
      body: { ...loaded, parents: undefined, parent: undefined, allergies: undefined, medicalAlert: undefined, billingPlan: undefined },
    });
    assert.equal(billingSave.status, 200, JSON.stringify(billingSave.json));
    assert.equal((await relationOn(learnerA.id, mum.id)).db, "Mother");
    assert.equal((await relationOn(learnerA.id, dad.id)).db, "Father");
    ok("learner-only saves (details, class move, billing plan) leave relationships untouched");

    // ── Save & reload an existing relationship while editing another field ──
    await saveParent(learnerA.id, dad.id, { workNo: "0110000000" });
    assert.deepEqual(await relationOn(learnerA.id, dad.id), { detail: "Father", list: "Father", db: "Father" });
    ok("editing another parent field re-saves the existing relationship unchanged");

    // ── Family account, primary contact and billing settings preserved ──
    const mumLink = await linkRow(mum.id, learnerA.id);
    const dadLink = await linkRow(dad.id, learnerA.id);
    assert.equal(mumLink?.isPrimary, mumLinkBefore?.isPrimary);
    assert.equal(mumLink?.isPayingPerson, true);
    assert.equal(mumLink?.billingInvoice, false);
    assert.equal(dadLink?.isPrimary, dadLinkBefore?.isPrimary);
    assert.equal(dadLink?.billingReceipt, false);
    const mumAfter = await prisma.parent.findUnique({ where: { id: mum.id } });
    assert.equal(mumAfter?.familyAccountId, family.id);
    assert.equal(mumAfter?.communicationBilling, false);
    assert.deepEqual(await prisma.familyAccount.findUnique({ where: { id: family.id } }), familyBefore);
    assert.equal((await prisma.learner.findUnique({ where: { id: learnerA.id } }))?.familyAccountId, family.id);
    ok("family account, primary flag, paying person and billing flags preserved");

    // ── Parent linked to two learners: relationship is per learner ──
    const sharedRecord = async () =>
      (await prisma.parent.findUnique({ where: { id: shared.id } }))?.relationship;
    const listedRelationship = async () => {
      const res = await jsonFetch(`${base}/api/parents?schoolId=${encodeURIComponent(school.id)}`, { token });
      return (res.json.parents || []).find((p: any) => p.id === shared.id)?.relationship;
    };

    await saveParent(learnerA.id, shared.id, { relationship: "Mother" });
    assert.equal((await relationOn(learnerA.id, shared.id)).db, "Mother");
    assert.deepEqual(await relationOn(learnerB.id, shared.id), { detail: "Guardian", list: "Guardian", db: "Guardian" });
    assert.equal(await sharedRecord(), "Mother");
    ok("shared parent: change on learner A does not alter learner B");

    const sharedLinkBBefore = await linkRow(shared.id, learnerB.id);
    await saveParent(learnerB.id, shared.id, { workNo: "0120000000" });
    assert.equal((await relationOn(learnerA.id, shared.id)).db, "Mother");
    assert.equal((await relationOn(learnerB.id, shared.id)).db, "Guardian");
    assert.equal(await sharedRecord(), "Mother", "unchanged sibling value must not overwrite the parent record");
    assert.equal(await listedRelationship(), "Mother");
    assert.deepEqual(await linkRow(shared.id, learnerB.id), sharedLinkBBefore);
    ok("shared parent: saving other fields on learner B keeps A, B and the parent record unchanged");

    await saveParent(learnerB.id, shared.id, { relationship: "Father" });
    assert.equal((await relationOn(learnerB.id, shared.id)).db, "Father");
    assert.equal((await relationOn(learnerA.id, shared.id)).db, "Mother");
    ok("shared parent: deliberate change on learner B updates only learner B");

    await saveParent(learnerA.id, mum.id, { relationship: "" });
    assert.equal((await relationOn(learnerA.id, mum.id)).db, "Mother");
    ok("blank relationship in a save never clears the stored relationship");

    // ── Parent fallback is frozen while another learner's link is blank ──
    const fallback = await mkParent("Fallback");
    await mkLink(fallback.id, learnerA.id, { isPrimary: false });
    await mkLink(fallback.id, learnerB.id, { isPrimary: false, relation: null });
    const fallbackRecord = async () =>
      (await prisma.parent.findUnique({ where: { id: fallback.id } }))?.relationship;
    assert.deepEqual(await relationOn(learnerB.id, fallback.id), { detail: "Guardian", list: "Guardian", db: null });

    await saveParent(learnerA.id, fallback.id, { relationship: "Mother" });
    assert.equal((await relationOn(learnerA.id, fallback.id)).db, "Mother");
    assert.deepEqual(await relationOn(learnerB.id, fallback.id), { detail: "Guardian", list: "Guardian", db: null });
    assert.equal(await fallbackRecord(), "Guardian");
    ok("blank link on learner B: change on learner A leaves B's displayed and stored relationship unchanged");

    await saveParent(learnerB.id, fallback.id, { workNo: "0130000000" });
    assert.deepEqual(await relationOn(learnerB.id, fallback.id), { detail: "Guardian", list: "Guardian", db: null });
    assert.equal((await relationOn(learnerA.id, fallback.id)).db, "Mother");
    ok("blank link on learner B: saving other fields on B copies nothing and changes nothing");

    await saveParent(learnerB.id, fallback.id, { relationship: "Father" });
    assert.equal((await relationOn(learnerB.id, fallback.id)).db, "Father");
    assert.equal((await relationOn(learnerA.id, fallback.id)).db, "Mother");
    ok("blank link on learner B: deliberate choice on B sets only B");

    // ── Add Existing Parent: clients released before the relationship picker ──
    delete process.env.PARENT_LINK_RELATION_REQUIRED;
    const learnerC = await mkLearner("Gamma");
    const sharedRecordBeforeLink = await sharedRecord();
    const legacyLink = await jsonFetch(`${base}/api/parents/link-to-learner`, {
      method: "POST",
      token,
      body: { schoolId: school.id, parentId: shared.id, learnerId: learnerC.id, relation: undefined, isPrimary: false },
    });
    assert.equal(legacyLink.status, 200, JSON.stringify(legacyLink.json));
    assert.equal((await linkRow(shared.id, learnerC.id))?.relation, null);
    assert.equal((await relationOn(learnerA.id, shared.id)).db, "Mother");
    assert.equal((await relationOn(learnerB.id, shared.id)).db, "Father");
    assert.equal(await sharedRecord(), sharedRecordBeforeLink);
    ok("pre-picker frontend link (no relation) still succeeds with a blank link, nothing copied");

    await saveParent(learnerC.id, shared.id, { workNo: "0140000000" });
    assert.equal((await linkRow(shared.id, learnerC.id))?.relation, null);
    assert.equal(await sharedRecord(), sharedRecordBeforeLink);
    await saveParent(learnerC.id, shared.id, { relationship: "Uncle" });
    assert.equal((await relationOn(learnerC.id, shared.id)).db, "Uncle");
    assert.equal((await relationOn(learnerA.id, shared.id)).db, "Mother");
    assert.equal((await relationOn(learnerB.id, shared.id)).db, "Father");
    ok("pre-picker frontend edit and save on the new link affect only that learner");
    await prisma.parentLearnerLink.delete({
      where: { parentId_learnerId: { parentId: shared.id, learnerId: learnerC.id } },
    });

    // ── Add Existing Parent with enforcement on requires a relationship for this learner ──
    process.env.PARENT_LINK_RELATION_REQUIRED = "true";
    try {
      const linkNoRelation = await jsonFetch(`${base}/api/parents/link-to-learner`, {
        method: "POST",
        token,
        body: { parentId: shared.id, learnerId: learnerC.id, isPrimary: false },
      });
      assert.equal(linkNoRelation.status, 400, JSON.stringify(linkNoRelation.json));
      assert.equal(linkNoRelation.json.code, "RELATION_REQUIRED");
      assert.equal(await linkRow(shared.id, learnerC.id), null);
    } finally {
      delete process.env.PARENT_LINK_RELATION_REQUIRED;
    }
    ok("enforcement on: link without a relationship → 400 RELATION_REQUIRED, no link created");

    const sharedRecordBeforeExplicit = await sharedRecord();
    const linkWithRelation = await jsonFetch(`${base}/api/parents/link-to-learner`, {
      method: "POST",
      token,
      body: { parentId: shared.id, learnerId: learnerC.id, relation: "Aunt", isPrimary: false },
    });
    assert.equal(linkWithRelation.status, 200, JSON.stringify(linkWithRelation.json));
    assert.equal((await relationOn(learnerC.id, shared.id)).db, "Aunt");
    assert.equal((await relationOn(learnerA.id, shared.id)).db, "Mother");
    assert.equal((await relationOn(learnerB.id, shared.id)).db, "Father");
    assert.equal(await sharedRecord(), sharedRecordBeforeExplicit);
    ok("link existing parent stores only the relationship chosen for that learner");

    // ── Import / repair tools may fill a blank relationship but never overwrite ──
    assert.equal(await fillBlankLinkRelation(prisma, mum.id, learnerA.id, "Guardian"), 0);
    assert.equal((await linkRow(mum.id, learnerA.id))?.relation, "Mother");
    await prisma.parentLearnerLink.update({
      where: { parentId_learnerId: { parentId: dad.id, learnerId: learnerA.id } },
      data: { relation: null },
    });
    assert.equal(await fillBlankLinkRelation(prisma, dad.id, learnerA.id, "Father"), 1);
    assert.equal((await linkRow(dad.id, learnerA.id))?.relation, "Father");
    assert.equal(relationshipFillForParent("Guardian", "Mother"), undefined);
    assert.equal(relationshipFillForParent("Guardian", null), "Guardian");
    assert.equal(relationshipFillForParent(null, null), undefined);
    ok("import/repair helpers fill blanks only and never overwrite Mother / Father");
  } finally {
    await close();
    await prisma.parentLearnerLink.deleteMany({ where: { schoolId: school.id } });
    await prisma.parent.deleteMany({ where: { schoolId: school.id } });
    await prisma.learnerBillingPlanLine.deleteMany({ where: { schoolId: school.id } }).catch(() => undefined);
    await prisma.learnerBillingPlanCleared.deleteMany({ where: { schoolId: school.id } }).catch(() => undefined);
    await prisma.learner.deleteMany({ where: { schoolId: school.id } });
    await prisma.familyAccount.deleteMany({ where: { schoolId: school.id } });
    await prisma.userRbacMeta.deleteMany({ where: { userId: user.id } });
    await prisma.user.deleteMany({ where: { id: user.id } });
    await prisma.school.deleteMany({ where: { id: school.id } }).catch(() => undefined);
  }
}

async function main() {
  assertLocalDatabase();
  await runLiveTests();
  console.log(`\nAll ${passed} parent relationship tests passed.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
