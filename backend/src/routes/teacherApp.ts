import { Router } from "express";
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

const uploadDir = path.join(process.cwd(), "uploads/teacher-app");
try {
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
} catch (e) {
  console.warn("[teacher-app] upload dir:", uploadDir, e);
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  },
});
const upload = multer({ storage, limits: { fileSize: 12 * 1024 * 1024 } });

const router = Router();

export type TeacherAppContext = {
  userId: string;
  schoolId: string;
  email: string;
  role: string;
  assignedClassNames: string[];
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

async function loadAssignedClassNames(schoolId: string, teacherEmail: string): Promise<string[]> {
  const norm = normalizeStaffEmail(teacherEmail);
  const rooms = await prisma.classroom.findMany({
    where: { schoolId },
    select: { name: true, teacherEmail: true },
  });
  return rooms.filter((r) => normalizeStaffEmail(r.teacherEmail) === norm).map((r) => r.name);
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
    const assignedClassNames = await loadAssignedClassNames(payload.schoolId, payload.email);
    req.teacherCtx = {
      userId: payload.userId,
      schoolId: payload.schoolId,
      email: payload.email,
      role: payload.role,
      assignedClassNames,
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

function assertClassAllowed(res: any, className: string, assigned: string[]) {
  const cn = String(className || "").trim();
  if (!cn) {
    res.status(400).json({ success: false, error: "className required" });
    return false;
  }
  if (!assigned.includes(cn)) {
    res.status(403).json({ success: false, error: "You are not assigned to this class" });
    return false;
  }
  return true;
}

router.use(teacherAppMiddleware);

router.get("/me", async (req, res) => {
  try {
    const { schoolId, email, userId, role, assignedClassNames } = ctx(req);
    const user = await prisma.user.findFirst({
      where: { id: userId, schoolId },
      select: { id: true, email: true, fullName: true, role: true },
    });
    const school = await prisma.school.findUnique({
      where: { id: schoolId },
      select: { id: true, name: true, logoUrl: true },
    });

    const classrooms = await prisma.classroom.findMany({
      where: { schoolId, name: { in: assignedClassNames } },
      orderBy: { name: "asc" },
    });

    const classroomsOut = await Promise.all(
      classrooms.map(async (c) => {
        const count = await prisma.learner.count({
          where: { schoolId, className: c.name },
        });
        return {
          id: c.id,
          name: c.name,
          teacherName: c.teacherName,
          teacherEmail: c.teacherEmail,
          learnerCount: count,
        };
      })
    );

    let unreadInbox = 0;
    const normEmail = normalizeStaffEmail(email);
    const threads = await prisma.parentTeacherThread.findMany({
      where: { schoolId, teacherEmail: normEmail },
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
      user: user || { id: userId, email, fullName: null, role },
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
    const { schoolId, assignedClassNames } = ctx(req);
    const className = String(req.query.className || "").trim();
    if (!className || !assignedClassNames.includes(className)) {
      return res.status(403).json({ success: false, error: "Invalid class" });
    }
    const learners = await prisma.learner.findMany({
      where: { schoolId, className },
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
    const { schoolId, assignedClassNames } = ctx(req);
    if (!assignedClassNames.length) return res.json({ success: true, posts: [] });
    const posts = await prisma.homeworkPost.findMany({
      where: { schoolId, className: { in: assignedClassNames } },
      orderBy: { createdAt: "desc" },
      take: 80,
    });
    return res.json({ success: true, posts });
  } catch (e) {
    return res.status(500).json({ success: false, error: "Failed to load homework" });
  }
});

router.post("/homework", upload.array("files", 5), async (req, res) => {
  try {
    const { schoolId, assignedClassNames, email } = ctx(req);
    const className = String(req.body?.className || "").trim();
    const title = String(req.body?.title || "").trim();
    if (!title) return res.status(400).json({ success: false, error: "title required" });
    if (!assertClassAllowed(res, className, assignedClassNames)) return;

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
      },
    });

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

    return res.json({ success: true, post });
  } catch (e) {
    console.error("teacher-app homework", e);
    return res.status(500).json({ success: false, error: "Failed to create homework" });
  }
});

router.get("/notices", async (req, res) => {
  try {
    const { schoolId, assignedClassNames } = ctx(req);
    if (!assignedClassNames.length) return res.json({ success: true, notices: [] });
    const notices = await prisma.schoolNotice.findMany({
      where: { schoolId, className: { in: assignedClassNames } },
      orderBy: { publishedAt: "desc" },
      take: 80,
    });
    return res.json({ success: true, notices });
  } catch (e) {
    return res.status(500).json({ success: false, error: "Failed to load notices" });
  }
});

router.post("/notices", upload.array("files", 5), async (req, res) => {
  try {
    const { schoolId, assignedClassNames, email } = ctx(req);
    const className = String(req.body?.className || "").trim();
    const title = String(req.body?.title || "").trim();
    const body = String(req.body?.body || "").trim();
    const noticeTypeRaw = String(req.body?.noticeType || "CLASS").toUpperCase();
    if (!title) return res.status(400).json({ success: false, error: "title required" });
    if (!assertClassAllowed(res, className, assignedClassNames)) return;

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
      },
    });

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

    return res.json({ success: true, notice });
  } catch (e) {
    console.error("teacher-app notices", e);
    return res.status(500).json({ success: false, error: "Failed to create notice" });
  }
});

router.get("/documents", async (req, res) => {
  try {
    const { schoolId, assignedClassNames } = ctx(req);
    if (!assignedClassNames.length) return res.json({ success: true, documents: [] });
    const documents = await prisma.parentDocument.findMany({
      where: { schoolId, className: { in: assignedClassNames } },
      orderBy: { createdAt: "desc" },
      take: 80,
    });
    return res.json({ success: true, documents });
  } catch (e) {
    return res.status(500).json({ success: false, error: "Failed to load documents" });
  }
});

router.post("/documents", upload.single("file"), async (req, res) => {
  try {
    const { schoolId, assignedClassNames, email } = ctx(req);
    const className = String(req.body?.className || "").trim();
    const title = String(req.body?.title || "").trim();
    if (!title) return res.status(400).json({ success: false, error: "title required" });
    if (!assertClassAllowed(res, className, assignedClassNames)) return;
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
      },
    });

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

    return res.json({ success: true, document: doc, createdBy: email });
  } catch (e) {
    console.error("teacher-app documents", e);
    return res.status(500).json({ success: false, error: "Failed to upload document" });
  }
});

router.get("/incidents", async (req, res) => {
  try {
    const { schoolId, assignedClassNames } = ctx(req);
    if (!assignedClassNames.length) return res.json({ success: true, incidents: [] });
    const incidents = await prisma.learnerIncident.findMany({
      where: { schoolId },
      include: {
        learner: { select: { id: true, firstName: true, lastName: true, className: true, grade: true } },
      },
      orderBy: { incidentDate: "desc" },
      take: 120,
    });
    const filtered = incidents.filter(
      (i) => i.learner.className && assignedClassNames.includes(i.learner.className)
    );
    return res.json({ success: true, incidents: filtered });
  } catch (e) {
    return res.status(500).json({ success: false, error: "Failed to load incidents" });
  }
});

router.post("/incidents", async (req, res) => {
  try {
    const { schoolId, assignedClassNames, email } = ctx(req);
    const learnerId = String(req.body?.learnerId || "").trim();
    const summary = String(req.body?.summary || "").trim();
    const severity = String(req.body?.severity || "MEDIUM").trim().toUpperCase();
    const parentVisible = req.body?.parentVisible !== false && req.body?.parentVisible !== "false";
    const notifyParent = req.body?.notifyParent !== false && req.body?.notifyParent !== "false";

    if (!learnerId || !summary) {
      return res.status(400).json({ success: false, error: "learnerId and summary required" });
    }

    const learner = await prisma.learner.findFirst({
      where: { id: learnerId, schoolId },
      select: { id: true, className: true },
    });
    if (!learner || !learner.className || !assignedClassNames.includes(learner.className)) {
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

export default router;
