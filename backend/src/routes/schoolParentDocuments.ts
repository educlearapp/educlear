/**
 * Staff ParentDocument list / upload / authenticated download for Communications Centre.
 * Reuses ParentDocument + teacher-app upload storage. Targeting validated server-side.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import { prisma } from "../prisma";
import {
  allowSchool,
  resolveStaffSchoolGate,
  sendAuthRequired,
} from "../middleware/staffSchoolGate";
import { assignedClassroomIdsForTeacher } from "../utils/classroomTeachers";
import { normalizeStaffEmail } from "../utils/staffJwt";
import { isSchoolWideNoticePublisherRole } from "./parentPortal";
import {
  actionFromHttpMethod,
  allowCommunicationsCentreActor,
} from "../utils/communicationsCentreAccess";
import type { PermissionAction } from "../utils/userPermissions";
import {
  createParentNotification,
  uniqueParentLearnerLinks,
} from "../services/parentPortalService";
import { loadSchoolClassMembership } from "../utils/classroomMembership";
import {
  internalTeacherAppFileUrl,
  basenameFromTeacherAppFileUrl,
  resolveTeacherAppAbsolutePath,
  SECURE_DOWNLOAD_HEADERS,
  staffDocumentDownloadPath,
} from "../services/teacherAppFileAccess";

const MAX_FILE_BYTES = 12 * 1024 * 1024;

const router = Router();

const uploadDir = path.join(process.cwd(), "uploads/teacher-app");

function ensureUploadDir(): void {
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
}

try {
  ensureUploadDir();
} catch (e) {
  console.warn("[school-parent-documents] upload dir:", uploadDir, e);
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    try {
      ensureUploadDir();
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
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
});

export function schoolParentDocumentsUploadErrorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction
) {
  if (res.headersSent) return next(err);
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ success: false, error: "File too large. Maximum 12 MB." });
    }
    return res.status(400).json({ success: false, error: "Upload failed. Please try again." });
  }
  if (err instanceof Error) console.error("[school-parent-documents] upload", err);
  return res.status(500).json({ success: false, error: "Upload failed. Please try again." });
}

type DocActor = {
  userId: string;
  email: string;
  isSchoolWideAdmin: boolean;
  assignedClassNames: string[];
};

async function resolveDocActor(
  req: { headers: { authorization?: string }; method?: string },
  res: Response,
  schoolId: string,
  requireAction?: PermissionAction
): Promise<DocActor | null> {
  const gate = await resolveStaffSchoolGate(req.headers.authorization);
  if (!gate) {
    sendAuthRequired(res);
    return null;
  }
  if (!allowSchool(gate, schoolId, res)) return null;

  const action = requireAction || actionFromHttpMethod(req.method || "GET");
  if (!allowCommunicationsCentreActor(gate, action)) {
    res.status(403).json({
      success: false,
      error: `Permission denied: communications.${action}`,
      code: "COMMUNICATIONS_FORBIDDEN",
    });
    return null;
  }

  const classroomIds = await assignedClassroomIdsForTeacher(
    schoolId,
    gate.auth.userId,
    gate.auth.email
  );
  const classrooms = await prisma.classroom.findMany({
    where: { schoolId, id: { in: classroomIds } },
    select: { name: true },
  });
  const byEmail = await prisma.classroom.findMany({
    where: {
      schoolId,
      teacherEmail: { equals: normalizeStaffEmail(gate.auth.email), mode: "insensitive" },
    },
    select: { name: true },
  });
  const assignedClassNames = [
    ...new Set(
      [...classrooms, ...byEmail].map((c) => String(c.name || "").trim()).filter(Boolean)
    ),
  ];

  return {
    userId: gate.auth.userId,
    email: normalizeStaffEmail(gate.auth.email),
    isSchoolWideAdmin: isSchoolWideNoticePublisherRole({
      superAdmin: gate.superAdmin,
      appRole: gate.auth.appRole,
      role: gate.auth.role,
    }),
    assignedClassNames,
  };
}

function learnerMatchesDoc(
  membership: Awaited<ReturnType<typeof loadSchoolClassMembership>>,
  learner: { id: string; grade: string; className: string | null },
  doc: { learnerId: string | null; grade: string | null; className: string | null }
) {
  if (doc.learnerId && doc.learnerId === learner.id) return true;
  if (doc.grade && doc.grade === learner.grade) return true;
  if (doc.className && membership.resolver.sameClassroom(doc.className, learner.className)) {
    return true;
  }
  if (!doc.learnerId && !doc.grade && !doc.className) return true;
  return false;
}

function assertTargetingAllowed(
  actor: DocActor,
  targeting: { grade: string | null; className: string | null; learnerId: string | null },
  res: Response
): boolean {
  const { grade, className, learnerId } = targeting;
  const schoolWide = !grade && !className && !learnerId;

  if (actor.isSchoolWideAdmin) {
    if (className && actor.assignedClassNames.length) {
      // Admin may target any class; no further check required for school-wide admins.
    }
    return true;
  }

  if (schoolWide || grade || learnerId) {
    res.status(403).json({
      success: false,
      error: "Teachers may only upload documents for their assigned classes",
      code: "TARGETING_DENIED",
    });
    return false;
  }

  if (!className || !actor.assignedClassNames.includes(className)) {
    res.status(403).json({
      success: false,
      error: "Class not in your assigned classrooms",
      code: "CLASS_DENIED",
    });
    return false;
  }
  return true;
}

function canViewDoc(
  actor: DocActor,
  doc: { className: string | null; grade: string | null; learnerId: string | null; createdByTeacherId: string | null }
): boolean {
  if (actor.isSchoolWideAdmin) return true;
  if (doc.createdByTeacherId && doc.createdByTeacherId === actor.userId) return true;
  if (doc.className && actor.assignedClassNames.includes(doc.className)) return true;
  return false;
}

function sendErr(res: Response, e: unknown) {
  const status = typeof (e as { status?: number })?.status === "number" ? (e as { status: number }).status : 500;
  const message = e instanceof Error ? e.message : "Request failed";
  if (status >= 500) console.error("school-parent-documents", e);
  return res.status(status).json({ success: false, error: message });
}

router.get("/", async (req, res) => {
  try {
    const schoolId = String(req.query.schoolId || "").trim();
    if (!schoolId) return res.status(400).json({ success: false, error: "schoolId required" });
    const actor = await resolveDocActor(req, res, schoolId);
    if (!actor) return;

    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const offset = Math.max(0, Number(req.query.offset) || 0);

    const where: Record<string, unknown> = { schoolId };
    if (!actor.isSchoolWideAdmin) {
      if (!actor.assignedClassNames.length) {
        return res.json({
          success: true,
          documents: [],
          total: 0,
          limit,
          offset,
          actor: { isSchoolWideAdmin: false, assignedClassNames: [] },
        });
      }
      where.OR = [
        { className: { in: actor.assignedClassNames } },
        { createdByTeacherId: actor.userId },
      ];
    }

    const [rows, total] = await Promise.all([
      prisma.parentDocument.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: offset,
        take: limit,
      }),
      prisma.parentDocument.count({ where }),
    ]);

    const documents = rows.map((d) => ({
      id: d.id,
      title: d.title,
      description: d.description,
      grade: d.grade,
      className: d.className,
      learnerId: d.learnerId,
      fileName: d.fileName,
      createdBy: d.createdBy,
      createdAt: d.createdAt,
      visibility: d.visibility,
      downloadPath: staffDocumentDownloadPath(d.id, schoolId),
      fileUrl: null,
      targeting:
        d.className
          ? `Class · ${d.className}`
          : d.grade
            ? `Grade · ${d.grade}`
            : d.learnerId
              ? "Learner-specific"
              : "School-wide",
    }));

    return res.json({
      success: true,
      documents,
      total,
      limit,
      offset,
      actor: {
        isSchoolWideAdmin: actor.isSchoolWideAdmin,
        assignedClassNames: actor.assignedClassNames,
      },
    });
  } catch (e) {
    return sendErr(res, e);
  }
});

router.post("/", upload.single("file"), async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    if (!schoolId) return res.status(400).json({ success: false, error: "schoolId required" });
    const actor = await resolveDocActor(req, res, schoolId);
    if (!actor) return;

    const title = String(req.body?.title || "").trim();
    if (!title) return res.status(400).json({ success: false, error: "title required" });

    const grade = String(req.body?.grade || "").trim() || null;
    const className = String(req.body?.className || "").trim() || null;
    const learnerId = String(req.body?.learnerId || "").trim() || null;

    if (!assertTargetingAllowed(actor, { grade, className, learnerId }, res)) return;

    if (learnerId) {
      const learner = await prisma.learner.findFirst({
        where: { id: learnerId, schoolId },
        select: { id: true },
      });
      if (!learner) {
        return res.status(400).json({ success: false, error: "Learner not found in this school" });
      }
    }

    const file = req.file as Express.Multer.File | undefined;
    if (!file) return res.status(400).json({ success: false, error: "file required" });

    const fileUrl = internalTeacherAppFileUrl(file.filename);

    const doc = await prisma.parentDocument.create({
      data: {
        schoolId,
        title,
        description: req.body?.description ? String(req.body.description).slice(0, 4000) : null,
        grade,
        className,
        learnerId,
        fileUrl,
        fileName: file.originalname,
        createdBy: actor.email,
        createdByTeacherId: actor.userId,
        visibility: "CLASS_TEACHERS",
      },
    });

    const links = await prisma.parentLearnerLink.findMany({
      where: { schoolId },
      include: { learner: true },
    });
    const membership = await loadSchoolClassMembership(schoolId);
    const matched = uniqueParentLearnerLinks(
      links.filter((link) =>
        learnerMatchesDoc(membership, link.learner, {
          learnerId: doc.learnerId,
          grade: doc.grade,
          className: doc.className,
        })
      )
    );
    for (const link of matched) {
      await createParentNotification({
        schoolId,
        parentId: link.parentId,
        learnerId: link.learnerId,
        type: "DOCUMENT",
        title: "New document",
        message: title,
        metadata: { documentId: doc.id },
      });
    }

    return res.json({
      success: true,
      document: {
        id: doc.id,
        title: doc.title,
        downloadPath: staffDocumentDownloadPath(doc.id, schoolId),
        fileUrl: null,
      },
    });
  } catch (e) {
    return sendErr(res, e);
  }
});

/** Authenticated download — school + role gate; does not expose other tenants' files. */
router.get("/:id/file", async (req, res) => {
  try {
    const schoolId = String(req.query.schoolId || "").trim();
    const id = String(req.params.id || "").trim();
    if (!schoolId || !id) {
      return res.status(400).json({ success: false, error: "schoolId and id required" });
    }
    const actor = await resolveDocActor(req, res, schoolId);
    if (!actor) return;

    const doc = await prisma.parentDocument.findFirst({
      where: { id, schoolId },
    });
    if (!doc) return res.status(404).json({ success: false, error: "Not found" });
    if (!canViewDoc(actor, doc)) {
      return res.status(403).json({ success: false, error: "Access denied", code: "FORBIDDEN" });
    }

    const safeName = basenameFromTeacherAppFileUrl(doc.fileUrl);
    const abs = resolveTeacherAppAbsolutePath(safeName);
    if (!abs) {
      return res.status(404).json({ success: false, error: "File missing" });
    }

    for (const [k, v] of Object.entries(SECURE_DOWNLOAD_HEADERS)) {
      res.setHeader(k, v);
    }
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${(doc.fileName || safeName || "document").replace(/"/g, "")}"`
    );
    return res.sendFile(abs);
  } catch (e) {
    return sendErr(res, e);
  }
});

export default router;
