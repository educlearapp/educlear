import { Router, type NextFunction, type Request, type Response } from "express";
import type { SchoolNoticeType } from "@prisma/client";
import fs from "fs";
import multer from "multer";
import path from "path";
import { prisma } from "../prisma";
import { normalizeStaffEmail, verifyStaffJwt } from "../utils/staffJwt";
import {
  createParentNotification,
  notifyParentsForLearner,
} from "../services/parentPortalService";
import {
  assignedClassroomIdsForTeacher,
  listTeachersForClassroom,
} from "../utils/classroomTeachers";
import {
  isSchoolAdminRole,
  normalizeTeacherVisibility,
  shouldNotifyParents,
  teacherCanViewItem,
  teacherVisibilityWhere,
  type TeacherVisibilityContext,
} from "../utils/teacherVisibility";

const uploadDir = path.join(process.cwd(), "uploads/teacher-app");
export const TEACHER_APP_MAX_FILE_BYTES = 12 * 1024 * 1024;
export const TEACHER_APP_MAX_FILES = 5;

try {
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
} catch (e) {
  console.warn("[teacher-app] upload dir:", uploadDir, e);
}

function ensureTeacherAppUploadDir(): void {
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    try {
      ensureTeacherAppUploadDir();
      cb(null, uploadDir);
    } catch (e) {
      cb(e instanceof Error ? e : new Error("Upload failed"), uploadDir);
    }
  },
  filename: (_req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  },
});
const upload = multer({
  storage,
  limits: { fileSize: TEACHER_APP_MAX_FILE_BYTES, files: TEACHER_APP_MAX_FILES },
});

function jsonUploadError(res: Response, status: number, error: string) {
  return res.status(status).json({ success: false, error });
}

/** Return JSON for multer / storage errors instead of HTML 500 pages. */
export function teacherAppUploadErrorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction
) {
  if (res.headersSent) return next(err);

  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return jsonUploadError(res, 413, "File too large. Maximum file size is 12 MB.");
    }
    if (err.code === "LIMIT_FILE_COUNT") {
      return jsonUploadError(res, 400, "You can attach up to 5 files.");
    }
    if (err.code === "LIMIT_UNEXPECTED_FILE") {
      return jsonUploadError(res, 400, "Upload failed. Please try again.");
    }
    console.error("[teacher-app] multer upload", err);
    return jsonUploadError(res, 400, "Upload failed. Please try again.");
  }

  const code = err && typeof err === "object" ? (err as NodeJS.ErrnoException).code : undefined;
  if (code === "EACCES" || code === "ENOSPC" || code === "ENOENT") {
    console.error("[teacher-app] upload storage", err);
    return jsonUploadError(res, 500, "Upload failed. Please try again.");
  }

  if (err instanceof Error) {
    console.error("[teacher-app] upload", err);
  }
  return jsonUploadError(res, 500, "Upload failed. Please try again.");
}

const router = Router();

export type AssignedClassroomRow = {
  id: string;
  name: string;
  teacherName: string;
  teacherEmail: string;
  learnerCount: number;
  classNameVariants: string[];
  role: "PRIMARY" | "CO_TEACHER" | "ASSISTANT" | "LEGACY";
  coTeacherCount: number;
};

export type TeacherAppContext = {
  userId: string;
  schoolId: string;
  email: string;
  role: string;
  assignedClassNames: string[];
  assignedClassrooms: AssignedClassroomRow[];
};

function publicBase(req: { protocol: string; get: (h: string) => string | undefined }) {
  return (
    process.env.PUBLIC_API_URL?.replace(/\/$/, "") || `${req.protocol}://${req.get("host")}`
  );
}

function learnerMatchesClassFilter(
  learner: { id: string; grade: string; className: string | null },
  filter: { learnerId: string | null; grade: string | null; className: string | null }
) {
  if (filter.learnerId && filter.learnerId === learner.id) return true;
  if (filter.grade && filter.grade === learner.grade) return true;
  if (filter.className && filter.className === String(learner.className || "")) return true;
  if (!filter.learnerId && !filter.grade && !filter.className) return true;
  return false;
}

/** Learner/homework className aliases for a registered classroom name (not used for teacher assignment). */
async function buildClassNameVariants(schoolId: string, classroomName: string): Promise<string[]> {
  const base = String(classroomName || "").trim();
  const variants = new Set<string>();
  if (base) variants.add(base);

  const learners = await prisma.learner.findMany({
    where: {
      schoolId,
      enrollmentStatus: "ACTIVE",
      OR: [
        { className: base },
        { className: { endsWith: `/${base}` } },
        { className: { endsWith: ` / ${base}` } },
      ],
    },
    select: { className: true, grade: true },
    take: 100,
  });

  for (const l of learners) {
    const cn = String(l.className || "").trim();
    if (cn) variants.add(cn);
    const g = String(l.grade || "").trim();
    if (g && base) {
      variants.add(`${g} / ${base}`);
      variants.add(`${g}/${base}`);
    }
  }

  return [...variants];
}

function allClassNameVariants(assigned: AssignedClassroomRow[]): string[] {
  const out = new Set<string>();
  for (const c of assigned) {
    out.add(c.name);
    for (const v of c.classNameVariants) out.add(v);
  }
  return [...out];
}

function visibilityCtx(req: any): TeacherVisibilityContext {
  const c = ctx(req);
  return { userId: c.userId, email: c.email, role: c.role };
}

async function loadAssignedClassrooms(
  schoolId: string,
  userId: string,
  teacherEmail: string
): Promise<AssignedClassroomRow[]> {
  const norm = normalizeStaffEmail(teacherEmail);
  const classroomIds = await assignedClassroomIdsForTeacher(schoolId, userId, teacherEmail);
  if (!classroomIds.length) return [];

  const rooms = await prisma.classroom.findMany({
    where: { schoolId, id: { in: classroomIds } },
    orderBy: { name: "asc" },
  });

  const assignments = await prisma.classroomTeacher.findMany({
    where: { schoolId, classroomId: { in: classroomIds } },
    select: { classroomId: true, role: true, teacherEmail: true, userId: true },
  });

  return Promise.all(
    rooms.map(async (c) => {
      const classNameVariants = await buildClassNameVariants(schoolId, c.name);
      const learnerCount = await prisma.learner.count({
        where: {
          schoolId,
          enrollmentStatus: "ACTIVE",
          className: { in: classNameVariants },
        },
      });
      const roomAssignments = assignments.filter((a) => a.classroomId === c.id);
      const mine = roomAssignments.find(
        (a) =>
          a.userId === userId ||
          (norm && normalizeStaffEmail(a.teacherEmail) === norm)
      );
      const legacyMatch =
        !mine && norm && normalizeStaffEmail(c.teacherEmail) === norm;
      const coTeacherCount = Math.max(0, roomAssignments.length - 1);
      return {
        id: c.id,
        name: c.name,
        teacherName: c.teacherName,
        teacherEmail: c.teacherEmail,
        learnerCount,
        classNameVariants,
        role: mine?.role ?? (legacyMatch ? "LEGACY" : "CO_TEACHER"),
        coTeacherCount,
      };
    })
  );
}

async function teacherAppMiddleware(req: any, res: any, next: any) {
  const payload = verifyStaffJwt(req.headers.authorization);
  if (!payload) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }
  if (payload.role === "FINANCE") {
    return res.status(403).json({
      success: false,
      error: "Teacher app is not available for finance accounts. Use the staff dashboard.",
    });
  }
  try {
    const assignedClassrooms = await loadAssignedClassrooms(
      payload.schoolId,
      payload.userId,
      payload.email
    );
    const assignedClassNames = assignedClassrooms.map((c) => c.name);
    req.teacherCtx = {
      userId: payload.userId,
      schoolId: payload.schoolId,
      email: payload.email,
      role: payload.role,
      assignedClassNames,
      assignedClassrooms,
    } satisfies TeacherAppContext;
    next();
  } catch (e) {
    console.error("teacher-app middleware", e);
    return res.status(500).json({ success: false, error: "Failed to resolve teacher context" });
  }
}

function ctx(req: any): TeacherAppContext {
  return req.teacherCtx as TeacherAppContext;
}

function assertClassAllowed(res: any, className: string, assigned: AssignedClassroomRow[]) {
  const cn = String(className || "").trim();
  if (!cn) {
    res.status(400).json({ success: false, error: "className required" });
    return false;
  }
  const allowed = allClassNameVariants(assigned);
  if (!allowed.includes(cn)) {
    res.status(403).json({ success: false, error: "You are not assigned to this class" });
    return false;
  }
  return true;
}

router.use(teacherAppMiddleware);

router.get("/me", async (req, res) => {
  try {
    const { schoolId, email, userId, role, assignedClassNames, assignedClassrooms } = ctx(req);
    const user = await prisma.user.findFirst({
      where: { id: userId, schoolId },
      select: { id: true, email: true, fullName: true, role: true },
    });
    const school = await prisma.school.findUnique({
      where: { id: schoolId },
      select: { id: true, name: true, logoUrl: true },
    });

    const classroomsOut = assignedClassrooms.map((c) => ({
      id: c.id,
      name: c.name,
      teacherName: c.teacherName,
      teacherEmail: c.teacherEmail,
      learnerCount: c.learnerCount,
      role: c.role,
      coTeacherCount: c.coTeacherCount,
    }));

    let unreadInbox = 0;
    const normEmail = normalizeStaffEmail(email);
    const threadWhere: Record<string, unknown> = { schoolId };
    if (!isSchoolAdminRole(role)) {
      threadWhere.OR = [
        ...(normEmail ? [{ teacherEmail: { equals: normEmail, mode: "insensitive" } }] : []),
        { assignedTeacherId: userId },
      ];
    }
    const threads = await prisma.parentTeacherThread.findMany({
      where: threadWhere,
      select: { id: true },
    });
    for (const t of threads) {
      const n = await prisma.parentTeacherMessage.count({
        where: { threadId: t.id, senderType: "PARENT", isRead: false },
      });
      unreadInbox += n;
    }

    return res.json({
      success: true,
      user: user
        ? { ...user, email: normalizeStaffEmail(user.email || email) }
        : { id: userId, email: normalizeStaffEmail(email), fullName: null, role },
      school,
      assignedClassNames,
      assignedClassrooms: classroomsOut,
      classrooms: classroomsOut,
      unreadInbox,
    });
  } catch (e) {
    console.error("teacher-app /me", e);
    return res.status(500).json({ success: false, error: "Failed to load profile" });
  }
});

router.get("/learners", async (req, res) => {
  try {
    const teacherCtx = ctx(req);
    const { schoolId, assignedClassrooms } = teacherCtx;
    const className = String(req.query.className || "").trim();
    const allowed = allClassNameVariants(assignedClassrooms);
    if (!className || !allowed.includes(className)) {
      return res.status(403).json({ success: false, error: "Invalid class" });
    }
    const room = assignedClassrooms.find(
      (c) => c.name === className || c.classNameVariants.includes(className)
    );
    const variants = room?.classNameVariants.length ? room.classNameVariants : [className];
    const learners = await prisma.learner.findMany({
      where: { schoolId, enrollmentStatus: "ACTIVE", className: { in: variants } },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        grade: true,
        className: true,
        admissionNo: true,
      },
    });
    return res.json({ success: true, learners });
  } catch (e) {
    return res.status(500).json({ success: false, error: "Failed to load learners" });
  }
});

router.get("/homework", async (req, res) => {
  try {
    const teacherCtx = ctx(req);
    const { schoolId, assignedClassrooms } = teacherCtx;
    const vctx = visibilityCtx(req);
    const scope = String(req.query.scope || "all").trim().toLowerCase();
    const classVariants = allClassNameVariants(assignedClassrooms);
    if (!classVariants.length) return res.json({ success: true, posts: [] });
    const rows = await prisma.homeworkPost.findMany({
      where: {
        schoolId,
        className: { in: classVariants },
        isDraft: false,
        ...teacherVisibilityWhere(vctx),
      },
      orderBy: { createdAt: "desc" },
      take: 120,
    });
    const posts = rows.filter((p) => {
      if (!teacherCanViewItem(p, vctx)) return false;
      const mine = p.createdByTeacherId === vctx.userId || normalizeStaffEmail(p.createdBy) === normalizeStaffEmail(vctx.email);
      if (scope === "mine") return mine;
      if (scope === "shared") return !mine && p.visibility === "CLASS_TEACHERS";
      return true;
    });
    return res.json({ success: true, posts });
  } catch (e) {
    return res.status(500).json({ success: false, error: "Failed to load homework" });
  }
});

router.post("/homework", upload.array("files", TEACHER_APP_MAX_FILES), async (req, res) => {
  try {
    const teacherCtx = ctx(req);
    const { schoolId, assignedClassrooms, email, userId } = teacherCtx;
    const className = String(req.body?.className || "").trim();
    const title = String(req.body?.title || "").trim();
    const visibility = normalizeTeacherVisibility(req.body?.visibility);
    const isDraft =
      req.body?.isDraft === true ||
      req.body?.isDraft === "true" ||
      visibility === "PRIVATE" && req.body?.publish !== "true";
    if (!title) return res.status(400).json({ success: false, error: "title required" });
    if (!assertClassAllowed(res, className, assignedClassrooms)) return;

    const files = (req.files as Express.Multer.File[]) || [];
    const base = publicBase(req);
    const attachments = files.map((f) => ({
      name: f.originalname,
      url: `${base}/uploads/teacher-app/${f.filename}`,
      mimeType: f.mimetype,
    }));

    const post = await prisma.homeworkPost.create({
      data: {
        schoolId,
        className,
        title,
        description: req.body?.description || null,
        dueDate: req.body?.dueDate ? new Date(String(req.body.dueDate)) : null,
        attachments: attachments.length ? attachments : undefined,
        createdBy: normalizeStaffEmail(email),
        createdByTeacherId: userId,
        visibility,
        isDraft,
      },
    });

    if (shouldNotifyParents(visibility, isDraft)) {
      const links = await prisma.parentLearnerLink.findMany({
        where: { schoolId, learner: { className } },
        select: { parentId: true, learnerId: true },
      });
      for (const link of links) {
        await createParentNotification({
          schoolId,
          parentId: link.parentId,
          learnerId: link.learnerId,
          type: "HOMEWORK",
          title: "Homework uploaded",
          message: title,
          metadata: { homeworkId: post.id, className },
        });
      }
    }

    return res.json({ success: true, post });
  } catch (e) {
    console.error("teacher-app homework", e);
    return res.status(500).json({ success: false, error: "Failed to create homework" });
  }
});

router.get("/notices", async (req, res) => {
  try {
    const teacherCtx = ctx(req);
    const { schoolId, assignedClassrooms } = teacherCtx;
    const vctx = visibilityCtx(req);
    const scope = String(req.query.scope || "all").trim().toLowerCase();
    const classVariants = allClassNameVariants(assignedClassrooms);
    if (!classVariants.length) return res.json({ success: true, notices: [] });
    const rows = await prisma.schoolNotice.findMany({
      where: {
        schoolId,
        className: { in: classVariants },
        isDraft: false,
        ...teacherVisibilityWhere(vctx),
      },
      orderBy: { publishedAt: "desc" },
      take: 120,
    });
    const notices = rows.filter((n) => {
      if (!teacherCanViewItem(n, vctx)) return false;
      const mine =
        n.createdByTeacherId === vctx.userId ||
        normalizeStaffEmail(n.createdBy) === normalizeStaffEmail(vctx.email);
      if (scope === "mine") return mine;
      if (scope === "shared") return !mine && n.visibility === "CLASS_TEACHERS";
      return true;
    });
    return res.json({ success: true, notices });
  } catch (e) {
    return res.status(500).json({ success: false, error: "Failed to load notices" });
  }
});

router.post("/notices", upload.array("files", TEACHER_APP_MAX_FILES), async (req, res) => {
  try {
    const teacherCtx = ctx(req);
    const { schoolId, email, userId } = teacherCtx;
    const className = String(req.body?.className || "").trim();
    const title = String(req.body?.title || "").trim();
    const body = String(req.body?.body || "").trim();
    const noticeTypeRaw = String(req.body?.noticeType || "CLASS").toUpperCase();
    const visibility = normalizeTeacherVisibility(req.body?.visibility);
    const isDraft =
      req.body?.isDraft === true ||
      req.body?.isDraft === "true" ||
      (visibility === "PRIVATE" && req.body?.publish !== "true");
    if (!title) return res.status(400).json({ success: false, error: "title required" });
    if (!assertClassAllowed(res, className, teacherCtx.assignedClassrooms)) return;

    const allowedTypes: SchoolNoticeType[] = ["CLASS", "SCHOOL", "ASSESSMENT", "EXAM", "GRADE"];
    const noticeType = (allowedTypes.includes(noticeTypeRaw as SchoolNoticeType)
      ? noticeTypeRaw
      : "CLASS") as SchoolNoticeType;

    const dueLine = req.body?.dueDate ? `Due: ${String(req.body.dueDate)}\n\n` : "";
    const fullBody = `${dueLine}${body || title}`;

    const files = (req.files as Express.Multer.File[]) || [];
    const base = publicBase(req);
    const attachments = files.map((f) => ({
      name: f.originalname,
      url: `${base}/uploads/teacher-app/${f.filename}`,
      mimeType: f.mimetype,
    }));

    const notice = await prisma.schoolNotice.create({
      data: {
        schoolId,
        noticeType,
        title,
        body: fullBody,
        className,
        attachments: attachments.length ? attachments : undefined,
        createdBy: normalizeStaffEmail(email),
        createdByTeacherId: userId,
        visibility,
        isDraft,
      },
    });

    if (shouldNotifyParents(visibility, isDraft)) {
      const notifType =
        noticeType === "ASSESSMENT"
          ? ("ASSESSMENT" as const)
          : noticeType === "EXAM"
            ? ("EXAM" as const)
            : ("SCHOOL_NOTICE" as const);

      const links = await prisma.parentLearnerLink.findMany({
        where: { schoolId },
        include: { learner: true },
      });

      for (const link of links) {
        if (!learnerMatchesClassFilter(link.learner, { learnerId: null, grade: null, className }))
          continue;
        await createParentNotification({
          schoolId,
          parentId: link.parentId,
          learnerId: link.learnerId,
          type: notifType,
          title,
          message: fullBody.slice(0, 500),
          metadata: { noticeId: notice.id, className },
        });
      }
    }

    return res.json({ success: true, notice });
  } catch (e) {
    console.error("teacher-app notices", e);
    return res.status(500).json({ success: false, error: "Failed to create notice" });
  }
});

router.get("/documents", async (req, res) => {
  try {
    const teacherCtx = ctx(req);
    const { schoolId, assignedClassrooms } = teacherCtx;
    const vctx = visibilityCtx(req);
    const scope = String(req.query.scope || "all").trim().toLowerCase();
    const classVariants = allClassNameVariants(assignedClassrooms);
    if (!classVariants.length) return res.json({ success: true, documents: [] });
    const rows = await prisma.parentDocument.findMany({
      where: {
        schoolId,
        className: { in: classVariants },
        ...teacherVisibilityWhere(vctx),
      },
      orderBy: { createdAt: "desc" },
      take: 120,
    });
    const documents = rows.filter((d) => {
      if (!teacherCanViewItem(d, vctx)) return false;
      const mine =
        d.createdByTeacherId === vctx.userId ||
        normalizeStaffEmail(d.createdBy) === normalizeStaffEmail(vctx.email);
      if (scope === "mine") return mine;
      if (scope === "shared") return !mine && d.visibility === "CLASS_TEACHERS";
      return true;
    });
    return res.json({ success: true, documents });
  } catch (e) {
    return res.status(500).json({ success: false, error: "Failed to load documents" });
  }
});

router.post("/documents", upload.single("file"), async (req, res) => {
  try {
    const teacherCtx = ctx(req);
    const { schoolId, assignedClassrooms, email, userId } = teacherCtx;
    const className = String(req.body?.className || "").trim();
    const title = String(req.body?.title || "").trim();
    const visibility = normalizeTeacherVisibility(req.body?.visibility);
    if (!title) return res.status(400).json({ success: false, error: "title required" });
    if (!assertClassAllowed(res, className, assignedClassrooms)) return;
    const file = req.file as Express.Multer.File | undefined;
    if (!file) return res.status(400).json({ success: false, error: "file required" });

    const base = publicBase(req);
    const fileUrl = `${base}/uploads/teacher-app/${file.filename}`;

    const doc = await prisma.parentDocument.create({
      data: {
        schoolId,
        title,
        description: req.body?.description || null,
        className,
        fileUrl,
        fileName: file.originalname,
        createdBy: normalizeStaffEmail(email),
        createdByTeacherId: userId,
        visibility,
      },
    });

    if (shouldNotifyParents(visibility, false)) {
      const links = await prisma.parentLearnerLink.findMany({
        where: { schoolId },
        include: { learner: true },
      });
      for (const link of links) {
        if (!learnerMatchesClassFilter(link.learner, { learnerId: null, grade: null, className }))
          continue;
        await createParentNotification({
          schoolId,
          parentId: link.parentId,
          learnerId: link.learnerId,
          type: "DOCUMENT",
          title: "New document",
          message: title,
          metadata: { documentId: doc.id, fileUrl },
        });
      }
    }

    return res.json({ success: true, document: doc });
  } catch (e) {
    console.error("teacher-app documents", e);
    return res.status(500).json({ success: false, error: "Failed to upload document" });
  }
});

router.get("/incidents", async (req, res) => {
  try {
    const teacherCtx = ctx(req);
    const { schoolId, assignedClassrooms } = teacherCtx;
    const vctx = visibilityCtx(req);
    const scope = String(req.query.scope || "all").trim().toLowerCase();
    const classVariants = allClassNameVariants(assignedClassrooms);
    if (!classVariants.length) return res.json({ success: true, incidents: [] });
    const rows = await prisma.learnerIncident.findMany({
      where: {
        schoolId,
        ...teacherVisibilityWhere(vctx),
      },
      include: {
        learner: { select: { id: true, firstName: true, lastName: true, className: true, grade: true } },
      },
      orderBy: { incidentDate: "desc" },
      take: 160,
    });
    const filtered = rows.filter((i) => {
      if (!i.learner.className || !classVariants.includes(i.learner.className)) return false;
      if (!teacherCanViewItem(i, vctx)) return false;
      const mine =
        i.createdByTeacherId === vctx.userId ||
        normalizeStaffEmail(i.createdBy) === normalizeStaffEmail(vctx.email);
      if (scope === "mine") return mine;
      if (scope === "shared") return !mine && i.visibility === "CLASS_TEACHERS";
      return true;
    });
    return res.json({ success: true, incidents: filtered });
  } catch (e) {
    return res.status(500).json({ success: false, error: "Failed to load incidents" });
  }
});

router.post("/incidents", async (req, res) => {
  try {
    const { schoolId, assignedClassrooms, email, userId } = ctx(req);
    const classVariants = allClassNameVariants(assignedClassrooms);
    const learnerId = String(req.body?.learnerId || "").trim();
    const summary = String(req.body?.summary || "").trim();
    const severity = String(req.body?.severity || "MEDIUM").trim().toUpperCase();
    const parentVisible = req.body?.parentVisible !== false && req.body?.parentVisible !== "false";
    const notifyParent = req.body?.notifyParent !== false && req.body?.notifyParent !== "false";
    const visibility = normalizeTeacherVisibility(req.body?.visibility ?? "CLASS_TEACHERS");

    if (!learnerId || !summary) {
      return res.status(400).json({ success: false, error: "learnerId and summary required" });
    }

    const learner = await prisma.learner.findFirst({
      where: { id: learnerId, schoolId },
      select: { id: true, className: true },
    });
    if (!learner || !learner.className || !classVariants.includes(learner.className)) {
      return res.status(403).json({ success: false, error: "Learner not in your classes" });
    }

    const incident = await prisma.learnerIncident.create({
      data: {
        schoolId,
        learnerId,
        type: severity || "MEDIUM",
        subject: String(req.body?.subject || "Incident").trim() || "Incident",
        summary,
        parentVisible,
        internalNotes: parentVisible ? null : summary,
        incidentDate: req.body?.incidentDate ? new Date(String(req.body.incidentDate)) : new Date(),
        createdBy: normalizeStaffEmail(email),
        createdByTeacherId: userId,
        visibility,
      },
    });

    if (parentVisible && notifyParent) {
      await notifyParentsForLearner({
        schoolId,
        learnerId,
        type: "INCIDENT",
        title: "Incident recorded",
        message: `An incident was recorded for your child: ${incident.subject}. ${summary.slice(0, 400)}`,
        metadata: { incidentId: incident.id, severity: incident.type },
      });
    }

    return res.json({ success: true, incident });
  } catch (e) {
    console.error("teacher-app incidents", e);
    return res.status(500).json({ success: false, error: "Failed to save incident" });
  }
});

router.get("/classroom/:classroomId", async (req, res) => {
  try {
    const teacherCtx = ctx(req);
    const { schoolId, assignedClassrooms } = teacherCtx;
    const vctx = visibilityCtx(req);
    const classroomId = String(req.params.classroomId || "").trim();
    const room = assignedClassrooms.find((c) => c.id === classroomId);
    if (!room) {
      return res.status(403).json({ success: false, error: "You are not assigned to this class" });
    }
    const classVariants = room.classNameVariants.length ? room.classNameVariants : [room.name];
    const teachers = await listTeachersForClassroom(schoolId, classroomId);

    const [myHomework, sharedHomework, sharedNotices, myMessages, incidents, learners] =
      await Promise.all([
        prisma.homeworkPost.findMany({
          where: {
            schoolId,
            className: { in: classVariants },
            createdByTeacherId: vctx.userId,
            isDraft: false,
          },
          orderBy: { createdAt: "desc" },
          take: 20,
        }),
        prisma.homeworkPost.findMany({
          where: {
            schoolId,
            className: { in: classVariants },
            visibility: "CLASS_TEACHERS",
            isDraft: false,
            NOT: { createdByTeacherId: vctx.userId },
          },
          orderBy: { createdAt: "desc" },
          take: 20,
        }),
        prisma.schoolNotice.findMany({
          where: {
            schoolId,
            className: { in: classVariants },
            visibility: "CLASS_TEACHERS",
            isDraft: false,
          },
          orderBy: { publishedAt: "desc" },
          take: 20,
        }),
        prisma.parentTeacherThread.findMany({
          where: {
            schoolId,
            classroomId,
            OR: [
              { assignedTeacherId: vctx.userId },
              {
                teacherEmail: {
                  equals: normalizeStaffEmail(vctx.email),
                  mode: "insensitive",
                },
              },
            ],
          },
          include: {
            learner: { select: { id: true, firstName: true, lastName: true } },
            parent: { select: { id: true, firstName: true, surname: true } },
          },
          orderBy: { updatedAt: "desc" },
          take: 20,
        }),
        prisma.learnerIncident.findMany({
          where: { schoolId, ...teacherVisibilityWhere(vctx) },
          include: {
            learner: { select: { id: true, firstName: true, lastName: true, className: true } },
          },
          orderBy: { incidentDate: "desc" },
          take: 40,
        }),
        prisma.learner.findMany({
          where: { schoolId, enrollmentStatus: "ACTIVE", className: { in: classVariants } },
          orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
          select: {
            id: true,
            firstName: true,
            lastName: true,
            grade: true,
            className: true,
            admissionNo: true,
          },
        }),
      ]);

    const classIncidents = incidents.filter(
      (i) => i.learner.className && classVariants.includes(i.learner.className)
    );

    return res.json({
      success: true,
      classroom: {
        id: room.id,
        name: room.name,
        learnerCount: room.learnerCount,
        role: room.role,
        coTeacherCount: room.coTeacherCount,
        teachers,
      },
      learners,
      myHomework,
      sharedHomework,
      sharedNotices,
      myMessages,
      incidents: classIncidents,
    });
  } catch (e) {
    console.error("teacher-app classroom overview", e);
    return res.status(500).json({ success: false, error: "Failed to load classroom" });
  }
});

router.get("/attendance", async (req, res) => {
  try {
    const teacherCtx = ctx(req);
    const { schoolId, assignedClassrooms } = teacherCtx;
    const className = String(req.query.className || "").trim();
    const dateRaw = String(req.query.date || new Date().toISOString().slice(0, 10)).trim();
    if (!assertClassAllowed(res, className, assignedClassrooms)) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) {
      return res.status(400).json({ success: false, error: "Valid date required (YYYY-MM-DD)" });
    }
    const date = new Date(`${dateRaw}T12:00:00.000Z`);
    const room = assignedClassrooms.find(
      (c) => c.name === className || c.classNameVariants.includes(className)
    );
    const variants = room?.classNameVariants.length ? room.classNameVariants : [className];
    const learners = await prisma.learner.findMany({
      where: { schoolId, enrollmentStatus: "ACTIVE", className: { in: variants } },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        grade: true,
        className: true,
        admissionNo: true,
      },
    });
    const learnerIds = learners.map((l) => l.id);
    const marks =
      learnerIds.length === 0
        ? []
        : await prisma.learnerAttendance.findMany({
            where: { schoolId, learnerId: { in: learnerIds }, date },
          });
    return res.json({ success: true, learners, marks, date: dateRaw, className });
  } catch (e) {
    return res.status(500).json({ success: false, error: "Failed to load attendance" });
  }
});

router.get("/study-notes", async (req, res) => {
  try {
    const teacherCtx = ctx(req);
    const { schoolId, assignedClassrooms } = teacherCtx;
    const vctx = visibilityCtx(req);
    const scope = String(req.query.scope || "all").trim().toLowerCase();
    const classVariants = allClassNameVariants(assignedClassrooms);
    const rows = await prisma.teacherStudyNote.findMany({
      where: {
        schoolId,
        OR: [{ className: { in: classVariants } }, { className: null }],
        ...teacherVisibilityWhere(vctx),
      },
      orderBy: { updatedAt: "desc" },
      take: 80,
    });
    const notes = rows.filter((n) => {
      if (!teacherCanViewItem(n, vctx)) return false;
      const mine = n.createdByTeacherId === vctx.userId;
      if (scope === "mine") return mine;
      if (scope === "shared") return !mine && n.visibility === "CLASS_TEACHERS";
      return true;
    });
    return res.json({ success: true, notes });
  } catch (e) {
    return res.status(500).json({ success: false, error: "Failed to load study notes" });
  }
});

router.post("/study-notes", async (req, res) => {
  try {
    const { schoolId, assignedClassrooms, email, userId } = ctx(req);
    const className = String(req.body?.className || "").trim();
    const title = String(req.body?.title || "").trim();
    const body = String(req.body?.body || "").trim();
    const visibility = normalizeTeacherVisibility(req.body?.visibility ?? "PRIVATE");
    const isDraft = req.body?.isDraft === true || req.body?.isDraft === "true";
    if (!title || !body) {
      return res.status(400).json({ success: false, error: "title and body required" });
    }
    if (className && !assertClassAllowed(res, className, assignedClassrooms)) return;

    const note = await prisma.teacherStudyNote.create({
      data: {
        schoolId,
        className: className || null,
        title,
        body,
        createdByTeacherId: userId,
        createdBy: normalizeStaffEmail(email),
        visibility,
        isDraft,
      },
    });
    return res.json({ success: true, note });
  } catch (e) {
    return res.status(500).json({ success: false, error: "Failed to save study note" });
  }
});

router.get("/learner-notes", async (req, res) => {
  try {
    const teacherCtx = ctx(req);
    const { schoolId, assignedClassrooms } = teacherCtx;
    const vctx = visibilityCtx(req);
    const learnerId = String(req.query.learnerId || "").trim();
    const classVariants = allClassNameVariants(assignedClassrooms);
    const where: Record<string, unknown> = {
      schoolId,
      ...teacherVisibilityWhere(vctx),
    };
    if (learnerId) where.learnerId = learnerId;
    const rows = await prisma.teacherLearnerNote.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: 80,
      include: {
        learner: { select: { id: true, firstName: true, lastName: true, className: true } },
      },
    });
    const notes = rows.filter(
      (n) =>
        teacherCanViewItem(n, vctx) &&
        (!n.learner.className || classVariants.includes(n.learner.className))
    );
    return res.json({ success: true, notes });
  } catch (e) {
    return res.status(500).json({ success: false, error: "Failed to load learner notes" });
  }
});

router.post("/learner-notes", async (req, res) => {
  try {
    const { schoolId, assignedClassrooms, email, userId } = ctx(req);
    const learnerId = String(req.body?.learnerId || "").trim();
    const body = String(req.body?.body || "").trim();
    const visibility = normalizeTeacherVisibility(req.body?.visibility ?? "PRIVATE");
    if (!learnerId || !body) {
      return res.status(400).json({ success: false, error: "learnerId and body required" });
    }
    const classVariants = allClassNameVariants(assignedClassrooms);
    const learner = await prisma.learner.findFirst({
      where: { id: learnerId, schoolId },
      select: { id: true, className: true },
    });
    if (!learner?.className || !classVariants.includes(learner.className)) {
      return res.status(403).json({ success: false, error: "Learner not in your classes" });
    }
    const note = await prisma.teacherLearnerNote.create({
      data: {
        schoolId,
        learnerId,
        className: learner.className,
        body,
        createdByTeacherId: userId,
        createdBy: normalizeStaffEmail(email),
        visibility,
      },
    });
    return res.json({ success: true, note });
  } catch (e) {
    return res.status(500).json({ success: false, error: "Failed to save learner note" });
  }
});

export default router;
