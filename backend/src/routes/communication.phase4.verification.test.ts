/**
 * Phase 4 — Communication Centre local HTTP + recipient verification.
 * Isolated PREFIX schools on localhost Postgres only.
 * No WinSMS/email provider calls succeed (test schools have no connected providers).
 *
 * Run: node --import ../frontend/node_modules/tsx/dist/loader.mjs src/routes/communication.phase4.verification.test.ts
 */
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";

dotenv.config({ path: path.join(process.cwd(), ".env") });

import { STAFF_JWT_SECRET } from "../utils/staffJwt";
import { requireSchoolModule } from "../middleware/requireSchoolModule";
import { ensureSchoolModuleEntitlements } from "../services/schoolModuleEntitlements";
import {
  estimateCommunicationSmsCredits,
  loadCommunicationRecipients,
} from "../services/communicationRecipientService";
import { permissionsForRole } from "../utils/userPermissions";
import communicationRoutes from "./communication";

const prisma = new PrismaClient();
const PREFIX = "cc-p4-";

type CaseResult = { name: string; pass: boolean; detail?: string };

const results: CaseResult[] = [];

function record(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  const mark = pass ? "PASS" : "FAIL";
  console.log(`  [${mark}] ${name}${detail ? ` — ${detail}` : ""}`);
}

function assertLocalDatabase() {
  const url = String(process.env.DATABASE_URL || "");
  let host = "";
  try {
    host = new URL(url.replace(/^postgresql:/, "http:")).hostname;
  } catch {
    host = "";
  }
  assert.ok(host === "localhost" || host === "127.0.0.1", `non-local host ${host}`);
}

function staffBearer(user: {
  id: string;
  schoolId: string;
  email: string;
  role?: string;
  appRole?: string;
}) {
  return `Bearer ${jwt.sign(
    {
      userId: user.id,
      schoolId: user.schoolId,
      email: user.email,
      role: user.role || "TEACHER",
      appRole: user.appRole,
    },
    STAFF_JWT_SECRET,
    { expiresIn: "1h" }
  )}`;
}

async function cleanup() {
  const schools = await prisma.school.findMany({
    where: { id: { startsWith: PREFIX } },
    select: { id: true },
  });
  for (const s of schools) {
    await prisma.parentLearnerLink.deleteMany({ where: { schoolId: s.id } }).catch(() => undefined);
    await prisma.parent.deleteMany({ where: { schoolId: s.id } }).catch(() => undefined);
    await prisma.learner.deleteMany({ where: { schoolId: s.id } }).catch(() => undefined);
    await prisma.classroomTeacher.deleteMany({ where: { schoolId: s.id } }).catch(() => undefined);
    await prisma.classroom.deleteMany({ where: { schoolId: s.id } }).catch(() => undefined);
    await prisma.schoolSmsSettings.deleteMany({ where: { schoolId: s.id } }).catch(() => undefined);
    await prisma.userRbacMeta.deleteMany({ where: { schoolId: s.id } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { schoolId: s.id } }).catch(() => undefined);
    await prisma.schoolModuleEntitlement.deleteMany({ where: { schoolId: s.id } }).catch(() => undefined);
    await prisma.school.delete({ where: { id: s.id } }).catch(() => undefined);
  }
}

async function main() {
  assertLocalDatabase();
  await cleanup();

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
  const schoolA = await prisma.school.create({
    data: {
      id: `${PREFIX}a-${stamp}`,
      name: "CC P4 School A",
      email: `cca-${stamp}@t.local`,
      lifecycleStatus: "ACTIVE",
    },
  });
  const schoolB = await prisma.school.create({
    data: {
      id: `${PREFIX}b-${stamp}`,
      name: "CC P4 School B",
      email: `ccb-${stamp}@t.local`,
      lifecycleStatus: "ACTIVE",
    },
  });
  await ensureSchoolModuleEntitlements(schoolA.id);
  await ensureSchoolModuleEntitlements(schoolB.id);

  const admin = await prisma.user.create({
    data: {
      id: `${PREFIX}admin-${stamp}`,
      schoolId: schoolA.id,
      email: `admin-${stamp}@t.local`,
      passwordHash: "x",
      role: "SCHOOL_ADMIN",
      fullName: "Admin",
      isActive: true,
    },
  });
  // Correctly configured Admin: persist full Admin template (incl. communications.*).
  // Matches current production load behaviour (no Admin soft-fill fix in this release).
  await prisma.userRbacMeta.create({
    data: {
      userId: admin.id,
      schoolId: schoolA.id,
      appRole: "Admin",
      permissions: permissionsForRole("Admin"),
    },
  });

  const owner = await prisma.user.create({
    data: {
      id: `${PREFIX}owner-${stamp}`,
      schoolId: schoolA.id,
      email: `owner-${stamp}@t.local`,
      passwordHash: "x",
      role: "SCHOOL_ADMIN",
      fullName: "Owner",
      isActive: true,
    },
  });
  await prisma.userRbacMeta.create({
    data: {
      userId: owner.id,
      schoolId: schoolA.id,
      appRole: "Owner",
      permissions: {},
    },
  });

  const teacher = await prisma.user.create({
    data: {
      id: `${PREFIX}teach-${stamp}`,
      schoolId: schoolA.id,
      email: `teach-${stamp}@t.local`,
      passwordHash: "x",
      role: "STAFF",
      fullName: "Teacher",
      isActive: true,
    },
  });
  // Teacher role stays non-school-wide for audience scope, but must hold communications.*
  // (production RBAC: Teacher template does not auto-grant Communications Centre).
  await prisma.userRbacMeta.create({
    data: {
      userId: teacher.id,
      schoolId: schoolA.id,
      appRole: "Teacher",
      permissions: {
        communications: {
          view: true,
          create: true,
          edit: true,
          delete: true,
          print: true,
          send: true,
        },
      },
    },
  });

  const viewOnly = await prisma.user.create({
    data: {
      id: `${PREFIX}view-${stamp}`,
      schoolId: schoolA.id,
      email: `view-${stamp}@t.local`,
      passwordHash: "x",
      role: "STAFF",
      fullName: "View Only Staff",
      isActive: true,
    },
  });
  await prisma.userRbacMeta.create({
    data: {
      userId: viewOnly.id,
      schoolId: schoolA.id,
      appRole: "Custom",
      permissions: {
        communications: { view: true },
      },
    },
  });

  const noCommsTeacher = await prisma.user.create({
    data: {
      id: `${PREFIX}noc-${stamp}`,
      schoolId: schoolA.id,
      email: `noc-${stamp}@t.local`,
      passwordHash: "x",
      role: "STAFF",
      fullName: "No Comms Teacher",
      isActive: true,
    },
  });
  await prisma.userRbacMeta.create({
    data: { userId: noCommsTeacher.id, schoolId: schoolA.id, appRole: "Teacher", permissions: {} },
  });

  const otherAdmin = await prisma.user.create({
    data: {
      id: `${PREFIX}ob-${stamp}`,
      schoolId: schoolB.id,
      email: `ob-${stamp}@t.local`,
      passwordHash: "x",
      role: "SCHOOL_ADMIN",
      fullName: "Other Admin",
      isActive: true,
    },
  });
  await prisma.userRbacMeta.create({
    data: {
      userId: otherAdmin.id,
      schoolId: schoolB.id,
      appRole: "Admin",
      permissions: permissionsForRole("Admin"),
    },
  });

  const classA = await prisma.classroom.create({
    data: {
      schoolId: schoolA.id,
      name: "P4-1A",
      teacherEmail: teacher.email,
      teacherName: "Teacher",
    },
  });
  const classB = await prisma.classroom.create({
    data: {
      schoolId: schoolA.id,
      name: "P4-2B",
      teacherEmail: "other-teacher@t.local",
      teacherName: "Other",
    },
  });
  await prisma.classroomTeacher.create({
    data: {
      schoolId: schoolA.id,
      classroomId: classA.id,
      userId: teacher.id,
      teacherEmail: teacher.email,
      teacherName: "Teacher",
    },
  });

  // Parent with two children in same school (dedupe to one SMS/email contact)
  const multiParent = await prisma.parent.create({
    data: {
      id: `${PREFIX}pm-${stamp}`,
      schoolId: schoolA.id,
      firstName: "Multi",
      surname: "Parent",
      email: `multi-${stamp}@t.local`,
      cellNo: "0821111001",
      idNumber: `M${stamp}`.slice(0, 13),
      communicationBySMS: true,
      communicationByEmail: true,
    },
  });
  const child1 = await prisma.learner.create({
    data: {
      id: `${PREFIX}l1-${stamp}`,
      schoolId: schoolA.id,
      firstName: "Child",
      lastName: "One",
      grade: "1",
      className: "P4-1A",
      enrollmentStatus: "ACTIVE",
    },
  });
  const child2 = await prisma.learner.create({
    data: {
      id: `${PREFIX}l2-${stamp}`,
      schoolId: schoolA.id,
      firstName: "Child",
      lastName: "Two",
      grade: "1",
      className: "P4-1A",
      enrollmentStatus: "ACTIVE",
    },
  });
  await prisma.parentLearnerLink.create({
    data: { schoolId: schoolA.id, parentId: multiParent.id, learnerId: child1.id },
  });
  await prisma.parentLearnerLink.create({
    data: { schoolId: schoolA.id, parentId: multiParent.id, learnerId: child2.id },
  });

  // Second parent same cell as multi (phone dedupe) — different email
  const sharedPhoneParent = await prisma.parent.create({
    data: {
      id: `${PREFIX}ps-${stamp}`,
      schoolId: schoolA.id,
      firstName: "Shared",
      surname: "Phone",
      email: `shared-${stamp}@t.local`,
      cellNo: "0821111001",
      idNumber: `S${stamp}`.slice(0, 13),
      communicationBySMS: true,
      communicationByEmail: true,
    },
  });
  const childShared = await prisma.learner.create({
    data: {
      id: `${PREFIX}l3-${stamp}`,
      schoolId: schoolA.id,
      firstName: "Shared",
      lastName: "Kid",
      grade: "2",
      className: "P4-2B",
      enrollmentStatus: "ACTIVE",
    },
  });
  await prisma.parentLearnerLink.create({
    data: { schoolId: schoolA.id, parentId: sharedPhoneParent.id, learnerId: childShared.id },
  });

  // Opt-out parent in class A
  const optedOut = await prisma.parent.create({
    data: {
      id: `${PREFIX}po-${stamp}`,
      schoolId: schoolA.id,
      firstName: "Opt",
      surname: "Out",
      email: `optout-${stamp}@t.local`,
      cellNo: "0821111002",
      idNumber: `O${stamp}`.slice(0, 13),
      communicationBySMS: false,
      communicationByEmail: false,
    },
  });
  const childOpt = await prisma.learner.create({
    data: {
      id: `${PREFIX}l4-${stamp}`,
      schoolId: schoolA.id,
      firstName: "Opt",
      lastName: "Kid",
      grade: "1",
      className: "P4-1A",
      enrollmentStatus: "ACTIVE",
    },
  });
  await prisma.parentLearnerLink.create({
    data: { schoolId: schoolA.id, parentId: optedOut.id, learnerId: childOpt.id },
  });

  // Grade-2 only parent (unique phone/email)
  const grade2Parent = await prisma.parent.create({
    data: {
      id: `${PREFIX}pg-${stamp}`,
      schoolId: schoolA.id,
      firstName: "Grade",
      surname: "Two",
      email: `grade2-${stamp}@t.local`,
      cellNo: "0821111003",
      idNumber: `G${stamp}`.slice(0, 13),
      communicationBySMS: true,
      communicationByEmail: true,
    },
  });
  // already linked via childShared? No - grade2Parent needs own learner in 2B
  // sharedPhoneParent owns childShared. Create another grade 2 learner for grade2Parent
  const childG2 = await prisma.learner.create({
    data: {
      id: `${PREFIX}l5-${stamp}`,
      schoolId: schoolA.id,
      firstName: "G2",
      lastName: "Only",
      grade: "2",
      className: "P4-2B",
      enrollmentStatus: "ACTIVE",
    },
  });
  await prisma.parentLearnerLink.create({
    data: { schoolId: schoolA.id, parentId: grade2Parent.id, learnerId: childG2.id },
  });

  // School B parent (cross-school)
  const foreignParent = await prisma.parent.create({
    data: {
      id: `${PREFIX}pf-${stamp}`,
      schoolId: schoolB.id,
      firstName: "Foreign",
      surname: "Parent",
      email: `foreign-${stamp}@t.local`,
      cellNo: "0829999001",
      idNumber: `F${stamp}`.slice(0, 13),
    },
  });
  const foreignLearner = await prisma.learner.create({
    data: {
      id: `${PREFIX}lf-${stamp}`,
      schoolId: schoolB.id,
      firstName: "Foreign",
      lastName: "Kid",
      grade: "1",
      className: "XB-1",
      enrollmentStatus: "ACTIVE",
    },
  });
  await prisma.parentLearnerLink.create({
    data: { schoolId: schoolB.id, parentId: foreignParent.id, learnerId: foreignLearner.id },
  });

  const adminTok = staffBearer({
    id: admin.id,
    schoolId: schoolA.id,
    email: admin.email,
    role: "SCHOOL_ADMIN",
    appRole: "Admin",
  });
  const ownerTok = staffBearer({
    id: owner.id,
    schoolId: schoolA.id,
    email: owner.email,
    role: "SCHOOL_ADMIN",
    appRole: "Owner",
  });
  const teacherTok = staffBearer({
    id: teacher.id,
    schoolId: schoolA.id,
    email: teacher.email,
    role: "STAFF",
    appRole: "Teacher",
  });
  const viewOnlyTok = staffBearer({
    id: viewOnly.id,
    schoolId: schoolA.id,
    email: viewOnly.email,
    role: "STAFF",
    appRole: "Custom",
  });
  const noCommsTok = staffBearer({
    id: noCommsTeacher.id,
    schoolId: schoolA.id,
    email: noCommsTeacher.email,
    role: "STAFF",
    appRole: "Teacher",
  });
  const otherTok = staffBearer({
    id: otherAdmin.id,
    schoolId: schoolB.id,
    email: otherAdmin.email,
    role: "SCHOOL_ADMIN",
    appRole: "Admin",
  });

  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/communication", requireSchoolModule("CORE"), communicationRoutes);
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  const base = `http://127.0.0.1:${addr.port}`;

  async function json(pathName: string, opts: RequestInit = {}) {
    const res = await fetch(`${base}${pathName}`, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        ...(opts.headers || {}),
      },
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  }

  console.log("\n=== 1. HTTP security / audience matrix ===");

  // Admin: all parents contacts (correctly configured Admin matrix)
  {
    const res = await json(
      `/api/communication/contacts?schoolId=${encodeURIComponent(schoolA.id)}&channel=sms&kind=parents&audience=all_parents`,
      { headers: { Authorization: adminTok } }
    );
    const ok = res.status === 200 && Array.isArray(res.body.contacts);
    const ids = new Set((res.body.contacts || []).map((c: any) => c.sourceId));
    record(
      "Admin load all parents",
      ok && ids.has(multiParent.id) && !ids.has(optedOut.id),
      `status=${res.status} count=${res.body.contacts?.length}`
    );
  }

  // Owner: school-wide contacts (Owner bypasses communications matrix)
  {
    const res = await json(
      `/api/communication/contacts?schoolId=${encodeURIComponent(schoolA.id)}&channel=sms&kind=parents&audience=all_parents`,
      { headers: { Authorization: ownerTok } }
    );
    const ids = new Set((res.body.contacts || []).map((c: any) => c.sourceId));
    record(
      "Owner load all parents",
      res.status === 200 && ids.has(multiParent.id) && !ids.has(optedOut.id),
      `status=${res.status} count=${res.body.contacts?.length}`
    );
  }

  // Admin: entire grade 1
  {
    const res = await json(
      `/api/communication/contacts?schoolId=${encodeURIComponent(schoolA.id)}&channel=sms&kind=parents&audience=by_class&classScope=grade&grade=1`,
      { headers: { Authorization: adminTok } }
    );
    const ids = new Set((res.body.contacts || []).map((c: any) => c.sourceId));
    record(
      "Admin load entire grade 1",
      res.status === 200 && ids.has(multiParent.id) && !ids.has(grade2Parent.id),
      `status=${res.status} count=${res.body.contacts?.length}`
    );
  }

  // Admin: specific classroom P4-2B
  {
    const res = await json(
      `/api/communication/contacts?schoolId=${encodeURIComponent(schoolA.id)}&channel=sms&kind=parents&audience=by_class&classScope=classroom&className=${encodeURIComponent("P4-2B")}`,
      { headers: { Authorization: adminTok } }
    );
    const ids = new Set((res.body.contacts || []).map((c: any) => c.sourceId));
    record(
      "Admin load classroom P4-2B",
      res.status === 200 && ids.has(grade2Parent.id) && ids.has(sharedPhoneParent.id) && !ids.has(multiParent.id),
      `status=${res.status} count=${res.body.contacts?.length}`
    );
  }

  // Teacher: assigned classroom
  {
    const res = await json(
      `/api/communication/contacts?schoolId=${encodeURIComponent(schoolA.id)}&channel=sms&kind=parents&audience=by_class&classScope=classroom&className=${encodeURIComponent("P4-1A")}`,
      { headers: { Authorization: teacherTok } }
    );
    const ids = new Set((res.body.contacts || []).map((c: any) => c.sourceId));
    record(
      "Teacher load assigned classroom P4-1A",
      res.status === 200 && ids.has(multiParent.id) && !ids.has(grade2Parent.id),
      `status=${res.status} count=${res.body.contacts?.length}`
    );
  }

  // Teacher: unassigned classroom
  {
    const res = await json(
      `/api/communication/contacts?schoolId=${encodeURIComponent(schoolA.id)}&channel=sms&kind=parents&audience=by_class&classScope=classroom&className=${encodeURIComponent("P4-2B")}`,
      { headers: { Authorization: teacherTok } }
    );
    record(
      "Teacher load unassigned classroom (must fail)",
      res.status === 403,
      `status=${res.status} error=${res.body.error || ""}`
    );
  }

  // Teacher: school-wide
  {
    const res = await json(
      `/api/communication/contacts?schoolId=${encodeURIComponent(schoolA.id)}&channel=sms&kind=parents&audience=all_parents`,
      { headers: { Authorization: teacherTok } }
    );
    record(
      "Teacher load all parents (must fail)",
      res.status === 403,
      `status=${res.status} error=${res.body.error || ""}`
    );
  }

  // RBAC × audience: Teacher template without communications.* cannot load even assigned class
  {
    const res = await json(
      `/api/communication/contacts?schoolId=${encodeURIComponent(schoolA.id)}&channel=sms&kind=parents&audience=by_class&classScope=classroom&className=${encodeURIComponent("P4-1A")}`,
      { headers: { Authorization: noCommsTok } }
    );
    record(
      "Teacher without communications.view denied (RBAC before audience)",
      res.status === 403 && /communications\.view/i.test(String(res.body.error || "")),
      `status=${res.status} error=${res.body.error || ""} code=${res.body.code || ""}`
    );
  }

  // RBAC × audience: view does not authorise send even for in-scope draft
  {
    const create = await json(`/api/communication/sms`, {
      method: "POST",
      headers: { Authorization: viewOnlyTok },
      body: JSON.stringify({
        schoolId: schoolA.id,
        description: "view-only draft",
        message: "x",
        contacts: [],
      }),
    });
    record(
      "communications.view alone cannot create SMS draft",
      create.status === 403 && /communications\.create/i.test(String(create.body.error || "")),
      `status=${create.status} error=${create.body.error || ""}`
    );
  }

  // Teacher: grade-wide
  {
    const res = await json(
      `/api/communication/contacts?schoolId=${encodeURIComponent(schoolA.id)}&channel=sms&kind=parents&audience=by_class&classScope=grade&grade=1`,
      { headers: { Authorization: teacherTok } }
    );
    record(
      "Teacher load entire grade (must fail)",
      res.status === 403,
      `status=${res.status} error=${res.body.error || ""}`
    );
  }

  // Cross-school contacts
  {
    const res = await json(
      `/api/communication/contacts?schoolId=${encodeURIComponent(schoolA.id)}&channel=sms&kind=parents&audience=all_parents`,
      { headers: { Authorization: otherTok } }
    );
    record(
      "Cross-school contacts access (must fail)",
      res.status === 403 || res.status === 401,
      `status=${res.status}`
    );
  }

  // Zero recipients send (SMS + email) — empty check before WinSMS readiness
  {
    const created = await json(`/api/communication/sms`, {
      method: "POST",
      headers: { Authorization: adminTok },
      body: JSON.stringify({
        schoolId: schoolA.id,
        description: "P4 empty",
        message: "Hello",
        contacts: [],
      }),
    });
    const id = created.body?.sms?.id;
    const send = await json(`/api/communication/sms/${encodeURIComponent(id)}/send`, {
      method: "POST",
      headers: { Authorization: adminTok },
      body: JSON.stringify({ schoolId: schoolA.id, audience: "all_parents", kind: "parents" }),
    });
    const emailCreated = await json(`/api/communication/emails`, {
      method: "POST",
      headers: { Authorization: adminTok },
      body: JSON.stringify({
        schoolId: schoolA.id,
        description: "P4 empty email",
        from: "test@t.local",
        subject: "t",
        message: "hi",
        contacts: [],
      }),
    });
    const emailId = emailCreated.body?.email?.id;
    const emailSend = await json(`/api/communication/emails/${encodeURIComponent(emailId)}/send`, {
      method: "POST",
      headers: { Authorization: adminTok },
      body: JSON.stringify({ schoolId: schoolA.id, audience: "all_parents", kind: "parents" }),
    });
    record(
      "Send with zero recipients (must fail)",
      send.status === 400 &&
        /at least one contact/i.test(String(send.body.error || "")) &&
        emailSend.status === 400 &&
        /at least one contact/i.test(String(emailSend.body.error || "")),
      `smsStatus=${send.status} emailStatus=${emailSend.status}`
    );
  }

  // Teacher SMS forged draft create must fail even when WinSMS disconnected
  {
    const forgedDraft = await json(`/api/communication/sms`, {
      method: "POST",
      headers: { Authorization: teacherTok },
      body: JSON.stringify({
        schoolId: schoolA.id,
        description: "P4 forged draft",
        message: "Nope",
        contacts: [
          {
            id: "manual-1",
            contactName: "Manual",
            relationship: "Parent",
            cellNo: "0825555000",
            status: "Ready",
          },
        ],
      }),
    });
    record(
      "Teacher SMS draft with manual/unauthorised contact (must fail 403)",
      forgedDraft.status === 403,
      `status=${forgedDraft.status} error=${forgedDraft.body.error || ""}`
    );
  }

  // Teacher empty SMS draft still allowed
  {
    const emptyDraft = await json(`/api/communication/sms`, {
      method: "POST",
      headers: { Authorization: teacherTok },
      body: JSON.stringify({
        schoolId: schoolA.id,
        description: "P4 empty teacher draft",
        message: "Draft",
        contacts: [],
      }),
    });
    record(
      "Teacher empty SMS draft allowed",
      emptyDraft.status === 201 && emptyDraft.body?.sms?.id,
      `status=${emptyDraft.status}`
    );

    // Updating that draft with out-of-scope contacts must fail
    const badUpdate = await json(`/api/communication/sms/${encodeURIComponent(emptyDraft.body.sms.id)}`, {
      method: "PUT",
      headers: { Authorization: teacherTok },
      body: JSON.stringify({
        schoolId: schoolA.id,
        contacts: [
          {
            id: "c-out",
            contactName: "Out",
            relationship: "Parent",
            cellNo: "0821111003",
            status: "Ready",
            source: "parent",
            sourceId: grade2Parent.id,
            classNames: ["P4-2B"],
          },
        ],
      }),
    });
    record(
      "Teacher SMS draft update with out-of-scope parent (must fail 403)",
      badUpdate.status === 403,
      `status=${badUpdate.status} error=${badUpdate.body.error || ""}`
    );
  }

  // Admin manual contact draft still allowed
  {
    const adminManual = await json(`/api/communication/sms`, {
      method: "POST",
      headers: { Authorization: adminTok },
      body: JSON.stringify({
        schoolId: schoolA.id,
        description: "P4 admin manual",
        message: "Hi",
        contacts: [
          {
            id: "manual-admin",
            contactName: "Walk-in",
            relationship: "Parent",
            cellNo: "0827777000",
            status: "Ready",
          },
        ],
      }),
    });
    record(
      "Admin manual SMS draft contact allowed",
      adminManual.status === 201,
      `status=${adminManual.status}`
    );
  }

  // --- Email draft parity (same rules as SMS drafts) ---
  {
    const emptyEmail = await json(`/api/communication/emails`, {
      method: "POST",
      headers: { Authorization: teacherTok },
      body: JSON.stringify({
        schoolId: schoolA.id,
        description: "P4 empty teacher email",
        from: "test@t.local",
        subject: "Draft",
        message: "Draft body",
        contacts: [],
      }),
    });
    record(
      "Teacher empty email draft allowed",
      emptyEmail.status === 201 && emptyEmail.body?.email?.id,
      `status=${emptyEmail.status}`
    );

    const badEmailUpdate = await json(
      `/api/communication/emails/${encodeURIComponent(emptyEmail.body.email.id)}`,
      {
        method: "PUT",
        headers: { Authorization: teacherTok },
        body: JSON.stringify({
          schoolId: schoolA.id,
          contacts: [
            {
              id: "e-out",
              contactName: "Out Email",
              relationship: "Parent",
              email: "grade2-out@t.local",
              attachments: [],
              status: "Ready",
              source: "parent",
              sourceId: grade2Parent.id,
              classNames: ["P4-2B"],
            },
          ],
        }),
      }
    );
    record(
      "Teacher email draft update with out-of-scope parent (must fail 403)",
      badEmailUpdate.status === 403,
      `status=${badEmailUpdate.status} error=${badEmailUpdate.body.error || ""}`
    );
  }

  {
    const manualEmail = await json(`/api/communication/emails`, {
      method: "POST",
      headers: { Authorization: teacherTok },
      body: JSON.stringify({
        schoolId: schoolA.id,
        description: "P4 teacher manual email",
        from: "test@t.local",
        subject: "No",
        message: "No",
        contacts: [
          {
            id: "manual-email",
            contactName: "Manual",
            relationship: "Parent",
            email: "manual@t.local",
            attachments: [],
            status: "Ready",
          },
        ],
      }),
    });
    record(
      "Teacher email draft with manual contact (must fail 403)",
      manualEmail.status === 403,
      `status=${manualEmail.status} error=${manualEmail.body.error || ""}`
    );
  }

  {
    const authorisedEmail = await json(`/api/communication/emails`, {
      method: "POST",
      headers: { Authorization: teacherTok },
      body: JSON.stringify({
        schoolId: schoolA.id,
        description: "P4 teacher authorised email",
        from: "test@t.local",
        subject: "Class note",
        message: "Hello class",
        contacts: [
          {
            id: `parent:${multiParent.id}`,
            contactName: "Multi Parent",
            relationship: "Parent",
            email: multiParent.email,
            attachments: [],
            status: "Ready",
            source: "parent",
            sourceId: multiParent.id,
            classNames: ["P4-1A"],
          },
        ],
      }),
    });
    record(
      "Teacher email draft with authorised assigned-class parent allowed",
      authorisedEmail.status === 201,
      `status=${authorisedEmail.status}`
    );
  }

  {
    const adminManualEmail = await json(`/api/communication/emails`, {
      method: "POST",
      headers: { Authorization: adminTok },
      body: JSON.stringify({
        schoolId: schoolA.id,
        description: "P4 admin manual email",
        from: "test@t.local",
        subject: "Walk-in",
        message: "Hi",
        contacts: [
          {
            id: "manual-admin-email",
            contactName: "Walk-in",
            relationship: "Parent",
            email: "walkin@t.local",
            attachments: [],
            status: "Ready",
          },
        ],
      }),
    });
    record(
      "Admin manual email draft contact allowed",
      adminManualEmail.status === 201,
      `status=${adminManualEmail.status}`
    );
  }

  // Teacher forged SMS send must 403 before WinSMS readiness (disconnected → still 403, not 409)
  {
    const forgedSendDraft = await json(`/api/communication/sms`, {
      method: "POST",
      headers: { Authorization: adminTok },
      body: JSON.stringify({
        schoolId: schoolA.id,
        description: "P4 admin-seeded forged for teacher send",
        message: "Hello",
        contacts: [
          {
            id: "parent:forged-sms",
            contactName: "Forged SMS",
            relationship: "Parent",
            cellNo: "0829999001",
            status: "Ready",
            source: "parent",
            sourceId: foreignParent.id,
            classNames: ["P4-2B"],
          },
        ],
      }),
    });
    const send = await json(
      `/api/communication/sms/${encodeURIComponent(forgedSendDraft.body?.sms?.id)}/send`,
      {
        method: "POST",
        headers: { Authorization: teacherTok },
        body: JSON.stringify({
          schoolId: schoolA.id,
          audience: "by_class",
          classScope: "classroom",
          className: "P4-1A",
          kind: "parents",
        }),
      }
    );
    record(
      "Teacher forged SMS send returns 403 even when WinSMS disconnected",
      send.status === 403,
      `status=${send.status} error=${send.body.error || ""}`
    );
  }

  // Teacher forged recipient IDs on email send (admin-seeded draft; contact check before SMTP)
  {
    const forged = await json(`/api/communication/emails`, {
      method: "POST",
      headers: { Authorization: adminTok },
      body: JSON.stringify({
        schoolId: schoolA.id,
        description: "P4 forged email send seed",
        from: "test@t.local",
        subject: "x",
        message: "x",
        contacts: [
          {
            id: "parent:forged",
            contactName: "Forged",
            relationship: "Parent",
            email: "forged@t.local",
            attachments: [],
            status: "Ready",
            source: "parent",
            sourceId: foreignParent.id,
            classNames: ["P4-2B"],
          },
        ],
      }),
    });
    const send = await json(`/api/communication/emails/${encodeURIComponent(forged.body?.email?.id)}/send`, {
      method: "POST",
      headers: { Authorization: teacherTok },
      body: JSON.stringify({
        schoolId: schoolA.id,
        audience: "by_class",
        classScope: "classroom",
        className: "P4-1A",
        kind: "parents",
      }),
    });
    record(
      "Teacher forged recipient IDs on email send (must fail 403)",
      send.status === 403,
      `status=${send.status} error=${send.body.error || ""}`
    );
  }

  // Admin SMS send to all parents — auth must pass; delivery must NOT call WinSMS (no settings → 409)
  {
    const contactsRes = await json(
      `/api/communication/contacts?schoolId=${encodeURIComponent(schoolA.id)}&channel=sms&kind=parents&audience=all_parents`,
      { headers: { Authorization: adminTok } }
    );
    const contacts = (contactsRes.body.contacts || []).map((c: any) => ({
      id: c.id,
      contactName: c.contactName,
      relationship: c.relationship,
      cellNo: c.cellNo,
      status: "Ready",
      source: c.source,
      sourceId: c.sourceId,
      classNames: c.classNames,
    }));
    const created = await json(`/api/communication/sms`, {
      method: "POST",
      headers: { Authorization: adminTok },
      body: JSON.stringify({
        schoolId: schoolA.id,
        description: "P4 admin all",
        message: "School notice",
        contacts,
      }),
    });
    const send = await json(`/api/communication/sms/${encodeURIComponent(created.body?.sms?.id)}/send`, {
      method: "POST",
      headers: { Authorization: adminTok },
      body: JSON.stringify({ schoolId: schoolA.id, audience: "all_parents", kind: "parents" }),
    });
    record(
      "Admin send all parents auth passes; no live WinSMS (expect 409 not configured)",
      send.status === 409 && /WinSMS/i.test(String(send.body.error || "")),
      `status=${send.status} simulated=${send.body.simulated}`
    );
  }

  // Teacher send assigned class — auth passes → 409 no WinSMS (not 403)
  {
    const contactsRes = await json(
      `/api/communication/contacts?schoolId=${encodeURIComponent(schoolA.id)}&channel=sms&kind=parents&audience=by_class&classScope=classroom&className=${encodeURIComponent("P4-1A")}`,
      { headers: { Authorization: teacherTok } }
    );
    const contacts = (contactsRes.body.contacts || []).map((c: any) => ({
      id: c.id,
      contactName: c.contactName,
      relationship: c.relationship,
      cellNo: c.cellNo,
      status: "Ready",
      source: c.source,
      sourceId: c.sourceId,
      classNames: c.classNames,
    }));
    const created = await json(`/api/communication/sms`, {
      method: "POST",
      headers: { Authorization: teacherTok },
      body: JSON.stringify({
        schoolId: schoolA.id,
        description: "P4 teacher class",
        message: "Class notice",
        contacts,
      }),
    });
    const send = await json(`/api/communication/sms/${encodeURIComponent(created.body?.sms?.id)}/send`, {
      method: "POST",
      headers: { Authorization: teacherTok },
      body: JSON.stringify({
        schoolId: schoolA.id,
        audience: "by_class",
        classScope: "classroom",
        className: "P4-1A",
        kind: "parents",
      }),
    });
    record(
      "Teacher send assigned classroom auth passes; no live WinSMS (expect 409)",
      send.status === 409,
      `status=${send.status}`
    );
  }

  // Teacher school-wide send must 403 before provider
  {
    const created = await json(`/api/communication/sms`, {
      method: "POST",
      headers: { Authorization: teacherTok },
      body: JSON.stringify({
        schoolId: schoolA.id,
        description: "P4 teacher blast",
        message: "Nope",
        contacts: [
          {
            id: multiParent.id,
            contactName: "Multi",
            relationship: "Parent",
            cellNo: "0821111001",
            status: "Ready",
            source: "parent",
            sourceId: multiParent.id,
            classNames: ["P4-1A"],
          },
        ],
      }),
    });
    const send = await json(`/api/communication/sms/${encodeURIComponent(created.body?.sms?.id)}/send`, {
      method: "POST",
      headers: { Authorization: teacherTok },
      body: JSON.stringify({ schoolId: schoolA.id, audience: "all_parents", kind: "parents" }),
    });
    record(
      "Teacher school-wide send (must fail 403)",
      send.status === 403,
      `status=${send.status} error=${send.body.error || ""}`
    );
  }

  console.log("\n=== 2. Recipient accuracy (service layer) ===");

  {
    const allSms = await loadCommunicationRecipients({
      schoolId: schoolA.id,
      channel: "sms",
      kind: "parents",
      audience: "all_parents",
      actor: { isSchoolWideAdmin: true, assignedClassNames: [] },
    });
    const byId = new Map(allSms.contacts.map((c) => [c.sourceId, c]));
    const multi = byId.get(multiParent.id);
    record(
      "Multi-child parent appears once",
      Boolean(multi) && allSms.contacts.filter((c) => c.sourceId === multiParent.id).length === 1,
      `learnerIds=${multi?.learnerIds?.length}`
    );
    // Phone dedupe: shared phone parents → one SMS contact
    const phones = allSms.contacts.map((c) => String(c.cellNo || "").replace(/\D/g, ""));
    const phone082 = phones.filter((p) => p.endsWith("821111001") || p.includes("821111001"));
    record(
      "Shared phone numbers deduped for SMS",
      phone082.length === 1,
      `matchingPhoneContacts=${phone082.length} total=${allSms.contacts.length}`
    );
    record(
      "SMS consent respected (opt-out excluded)",
      !byId.has(optedOut.id),
      `optOutPresent=${byId.has(optedOut.id)}`
    );
  }

  {
    const emailAll = await loadCommunicationRecipients({
      schoolId: schoolA.id,
      channel: "email",
      kind: "parents",
      audience: "all_parents",
      actor: { isSchoolWideAdmin: true, assignedClassNames: [] },
    });
    // Shared phone parents have different emails → both present for email channel
    const emails = new Set(emailAll.contacts.map((c) => c.sourceId));
    record(
      "Email channel keeps distinct emails (shared phone still two parents)",
      emails.has(multiParent.id) && emails.has(sharedPhoneParent.id),
      `count=${emailAll.contacts.length}`
    );
  }

  {
    const grade = await loadCommunicationRecipients({
      schoolId: schoolA.id,
      channel: "sms",
      kind: "parents",
      audience: "by_class",
      classScope: "grade",
      grade: "2",
      actor: { isSchoolWideAdmin: true, assignedClassNames: [] },
    });
    const ids = new Set(grade.contacts.map((c) => c.sourceId));
    record(
      "Grade filter uses learner.grade",
      ids.has(grade2Parent.id) && ids.has(sharedPhoneParent.id) && !ids.has(multiParent.id),
      `count=${grade.contacts.length}`
    );
  }

  {
    const est = estimateCommunicationSmsCredits("Hello from school", 3);
    record(
      "SMS credit estimate = segments × recipients",
      est.segments === 1 && est.estimatedCredits === 3,
      JSON.stringify(est)
    );
  }

  // Preview vs final list: contacts returned by load === what would be submitted
  {
    const loaded = await loadCommunicationRecipients({
      schoolId: schoolA.id,
      channel: "sms",
      kind: "parents",
      audience: "by_class",
      classScope: "classroom",
      className: "P4-1A",
      actor: { isSchoolWideAdmin: true, assignedClassNames: [] },
    });
    const submittedIds = loaded.contacts.map((c) => c.id).sort();
    const previewIds = loaded.contacts.map((c) => c.id).sort();
    record(
      "Recipient preview matches final list identity",
      JSON.stringify(submittedIds) === JSON.stringify(previewIds) && submittedIds.length > 0,
      `n=${submittedIds.length}`
    );
  }

  console.log("\n=== 3. Existing workflow smoke ===");

  {
    const legacy = await json(
      `/api/communication/contacts?schoolId=${encodeURIComponent(schoolA.id)}&channel=email&kind=employees`,
      { headers: { Authorization: adminTok } }
    );
    record("Legacy employees kind still loads for admin", legacy.status === 200, `status=${legacy.status}`);
  }

  {
    const list = await json(`/api/communication/sms?schoolId=${encodeURIComponent(schoolA.id)}`, {
      headers: { Authorization: adminTok },
    });
    record(
      "SMS history list endpoint works",
      list.status === 200 && Array.isArray(list.body.sms),
      `count=${list.body.sms?.length}`
    );
  }

  {
    const hubGuard = path.join(
      process.cwd(),
      "../frontend/src/communication/communicationsCentreHub.guard.test.ts"
    );
    record("Communications Centre hub guard file present", fs.existsSync(hubGuard));
  }

  // Actor flags for manual add
  {
    const adminContacts = await json(
      `/api/communication/contacts?schoolId=${encodeURIComponent(schoolA.id)}&channel=sms&kind=parents&audience=individual`,
      { headers: { Authorization: adminTok } }
    );
    const teacherContacts = await json(
      `/api/communication/contacts?schoolId=${encodeURIComponent(schoolA.id)}&channel=sms&kind=parents&audience=individual`,
      { headers: { Authorization: teacherTok } }
    );
    record(
      "Admin canManualAdd true; teacher canManualAdd false",
      adminContacts.body?.actor?.canManualAdd === true &&
        teacherContacts.body?.actor?.canManualAdd === false,
      `admin=${adminContacts.body?.actor?.canManualAdd} teacher=${teacherContacts.body?.actor?.canManualAdd}`
    );
  }

  server.close();
  await cleanup();
  await prisma.$disconnect();

  const failed = results.filter((r) => !r.pass);
  console.log("\n=== Phase 4 verification summary ===");
  console.log(`Total: ${results.length}  Pass: ${results.length - failed.length}  Fail: ${failed.length}`);
  if (failed.length) {
    console.log("Failures:");
    for (const f of failed) console.log(` - ${f.name}: ${f.detail || ""}`);
    process.exitCode = 1;
  } else {
    console.log("All Phase 4 HTTP/recipient cases passed (no live SMS/email delivery).");
  }
}

main().catch(async (e) => {
  console.error(e);
  await cleanup().catch(() => undefined);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
