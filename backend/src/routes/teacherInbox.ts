import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { prisma } from "../prisma";
import { createParentNotification, mapThreadMessage } from "../services/parentPortalService";
import { normalizeStaffEmail, verifyStaffJwt } from "../utils/staffJwt";

const uploadDir = path.join(process.cwd(), "uploads/parent-messages");
try {
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
} catch (e) {
  console.warn(
    "[teacher-inbox] Could not ensure upload directory exists; file uploads may fail until it is writable:",
    uploadDir,
    e
  );
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  },
});
const upload = multer({ storage, limits: { fileSize: 8 * 1024 * 1024 } });

const router = Router();

function normalizeEmail(email: string) {
  return normalizeStaffEmail(email);
}

function resolveInboxFromQuery(req: any):
  | { ok: true; schoolId: string; adminView: boolean; teacherEmail: string }
  | { ok: false; status: number; error: string } {
  const jwtUser = verifyStaffJwt(req.headers.authorization);
  const schoolId = String(req.query.schoolId || "").trim();
  const adminView = String(req.query.adminView || "") === "true";
  let teacherEmail = normalizeEmail(String(req.query.teacherEmail || ""));
  if (jwtUser) {
    if (!schoolId || jwtUser.schoolId !== schoolId) {
      return { ok: false, status: 403, error: "schoolId mismatch or missing" };
    }
    if (adminView) {
      if (jwtUser.role !== "SCHOOL_ADMIN") {
        return { ok: false, status: 403, error: "adminView requires school admin token" };
      }
    } else {
      teacherEmail = normalizeEmail(jwtUser.email);
    }
  }
  if (!schoolId) return { ok: false, status: 400, error: "schoolId required" };
  if (!adminView && !teacherEmail) {
    return { ok: false, status: 400, error: "teacherEmail required" };
  }
  return { ok: true, schoolId, adminView, teacherEmail };
}

function resolveInboxFromBody(req: any):
  | { ok: true; schoolId: string; adminView: boolean; teacherEmail: string }
  | { ok: false; status: number; error: string } {
  const jwtUser = verifyStaffJwt(req.headers.authorization);
  const schoolId = String(req.body?.schoolId || "").trim();
  const adminView = String(req.body?.adminView || "") === "true";
  let teacherEmail = normalizeEmail(String(req.body?.teacherEmail || ""));
  if (jwtUser) {
    if (!schoolId || jwtUser.schoolId !== schoolId) {
      return { ok: false, status: 403, error: "schoolId mismatch or missing" };
    }
    if (adminView) {
      if (jwtUser.role !== "SCHOOL_ADMIN") {
        return { ok: false, status: 403, error: "adminView requires school admin token" };
      }
    } else {
      teacherEmail = normalizeEmail(jwtUser.email);
    }
  }
  if (!schoolId) return { ok: false, status: 400, error: "schoolId required" };
  if (!adminView && !teacherEmail) {
    return { ok: false, status: 400, error: "teacherEmail required" };
  }
  return { ok: true, schoolId, adminView, teacherEmail };
}

router.get("/threads", async (req, res) => {
  try {
    const auth = resolveInboxFromQuery(req);
    if (!auth.ok) {
      return res.status(auth.status).json({ success: false, error: auth.error });
    }
    const { schoolId, adminView, teacherEmail } = auth;

    const where: any = { schoolId };
    if (!adminView) {
      where.teacherEmail = teacherEmail;
    }

    const threads = await prisma.parentTeacherThread.findMany({
      where,
      include: {
        learner: { select: { id: true, firstName: true, lastName: true, grade: true, className: true } },
        parent: { select: { id: true, firstName: true, surname: true, cellNo: true } },
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: { updatedAt: "desc" },
    });

    const enriched = await Promise.all(
      threads.map(async (t) => {
      const last = t.messages[0];
      const unread = await prisma.parentTeacherMessage.count({
        where: { threadId: t.id, senderType: "PARENT", isRead: false },
      });
      return {
        id: t.id,
        status: t.status,
        teacherName: t.teacherName,
        teacherEmail: t.teacherEmail,
        learner: t.learner,
        parent: t.parent,
        lastMessage: last ? mapThreadMessage(last) : null,
        unreadCount: unread,
        updatedAt: t.updatedAt,
      };
    })
    );

    return res.json({ success: true, threads: enriched });
  } catch (e) {
    console.error("teacher threads", e);
    return res.status(500).json({ success: false, error: "Failed to load inbox" });
  }
});

router.get("/threads/:threadId", async (req, res) => {
  try {
    const auth = resolveInboxFromQuery(req);
    if (!auth.ok) {
      return res.status(auth.status).json({ success: false, error: auth.error });
    }
    const { schoolId, adminView, teacherEmail } = auth;
    const threadId = String(req.params.threadId);
    const thread = await prisma.parentTeacherThread.findFirst({
      where: { id: threadId, schoolId },
      include: {
        messages: { orderBy: { createdAt: "asc" } },
        learner: true,
        parent: true,
      },
    });

    if (!thread) return res.status(404).json({ success: false, error: "Thread not found" });
    if (!adminView && normalizeEmail(thread.teacherEmail) !== teacherEmail) {
      return res.status(403).json({ success: false, error: "Access denied" });
    }

    return res.json({
      success: true,
      thread: {
        ...thread,
        messages: thread.messages.map(mapThreadMessage),
      },
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: "Failed to load thread" });
  }
});

router.post("/threads/:threadId/reply", upload.array("files", 5), async (req, res) => {
  try {
    const auth = resolveInboxFromBody(req);
    if (!auth.ok) {
      return res.status(auth.status).json({ success: false, error: auth.error });
    }
    const { schoolId, adminView, teacherEmail } = auth;
    const teacherName = String(req.body?.teacherName || "Teacher").trim();
    const body = String(req.body?.body || "").trim();
    const threadId = String(req.params.threadId);

    if (!body) {
      return res.status(400).json({ success: false, error: "body required" });
    }

    const thread = await prisma.parentTeacherThread.findFirst({
      where: { id: threadId, schoolId },
    });
    if (!thread) return res.status(404).json({ success: false, error: "Thread not found" });
    if (!adminView && normalizeEmail(thread.teacherEmail) !== teacherEmail) {
      return res.status(403).json({ success: false, error: "Access denied" });
    }

    const files = (req.files as Express.Multer.File[]) || [];
    const base =
      process.env.PUBLIC_API_URL?.replace(/\/$/, "") ||
      `${req.protocol}://${req.get("host")}`;
    const attachments = files.map((f) => ({
      name: f.originalname,
      url: `${base}/uploads/parent-messages/${f.filename}`,
      mimeType: f.mimetype,
    }));

    const senderType = adminView && !teacherEmail ? "ADMIN" : "TEACHER";

    const msg = await prisma.parentTeacherMessage.create({
      data: {
        threadId,
        schoolId,
        senderType,
        senderName: teacherName,
        body,
        attachments: attachments.length ? attachments : undefined,
      },
    });

    await prisma.parentTeacherThread.update({
      where: { id: threadId },
      data: { updatedAt: new Date() },
    });

    await createParentNotification({
      schoolId,
      parentId: thread.parentId,
      learnerId: thread.learnerId,
      type: "TEACHER_MESSAGE",
      title: "New message from teacher",
      message: body.slice(0, 200),
      metadata: { threadId },
    });

    return res.json({ success: true, message: mapThreadMessage(msg) });
  } catch (e) {
    console.error("teacher reply", e);
    return res.status(500).json({ success: false, error: "Failed to send reply" });
  }
});

router.patch("/threads/:threadId/read", async (req, res) => {
  try {
    const auth = resolveInboxFromBody(req);
    if (!auth.ok) {
      return res.status(auth.status).json({ success: false, error: auth.error });
    }
    const { schoolId, adminView, teacherEmail } = auth;
    const threadId = String(req.params.threadId);

    const thread = await prisma.parentTeacherThread.findFirst({
      where: { id: threadId, schoolId },
    });
    if (!thread) return res.status(404).json({ success: false, error: "Thread not found" });
    if (!adminView && normalizeEmail(thread.teacherEmail) !== teacherEmail) {
      return res.status(403).json({ success: false, error: "Access denied" });
    }

    await prisma.parentTeacherMessage.updateMany({
      where: {
        threadId,
        senderType: "PARENT",
        isRead: false,
      },
      data: { isRead: true, readAt: new Date() },
    });

    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false, error: "Failed to mark read" });
  }
});

export default router;
