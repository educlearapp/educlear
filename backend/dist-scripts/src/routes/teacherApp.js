"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const fs_1 = __importDefault(require("fs"));
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const prisma_1 = require("../prisma");
const staffJwt_1 = require("../utils/staffJwt");
const parentPortalService_1 = require("../services/parentPortalService");
const uploadDir = path_1.default.join(process.cwd(), "uploads/teacher-app");
try {
    if (!fs_1.default.existsSync(uploadDir))
        fs_1.default.mkdirSync(uploadDir, { recursive: true });
}
catch (e) {
    console.warn("[teacher-app] upload dir:", uploadDir, e);
}
const storage = multer_1.default.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
        const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
        cb(null, unique + path_1.default.extname(file.originalname));
    },
});
const upload = (0, multer_1.default)({ storage, limits: { fileSize: 12 * 1024 * 1024 } });
const router = (0, express_1.Router)();
function publicBase(req) {
    return (process.env.PUBLIC_API_URL?.replace(/\/$/, "") || `${req.protocol}://${req.get("host")}`);
}
function learnerMatchesClassFilter(learner, filter) {
    if (filter.learnerId && filter.learnerId === learner.id)
        return true;
    if (filter.grade && filter.grade === learner.grade)
        return true;
    if (filter.className && filter.className === String(learner.className || ""))
        return true;
    if (!filter.learnerId && !filter.grade && !filter.className)
        return true;
    return false;
}
/** Learner/homework className aliases for a registered classroom name (not used for teacher assignment). */
async function buildClassNameVariants(schoolId, classroomName) {
    const base = String(classroomName || "").trim();
    const variants = new Set();
    if (base)
        variants.add(base);
    const learners = await prisma_1.prisma.learner.findMany({
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
        if (cn)
            variants.add(cn);
        const g = String(l.grade || "").trim();
        if (g && base) {
            variants.add(`${g} / ${base}`);
            variants.add(`${g}/${base}`);
        }
    }
    return [...variants];
}
function allClassNameVariants(assigned) {
    const out = new Set();
    for (const c of assigned) {
        out.add(c.name);
        for (const v of c.classNameVariants)
            out.add(v);
    }
    return [...out];
}
async function loadAssignedClassrooms(schoolId, teacherEmail) {
    const norm = (0, staffJwt_1.normalizeStaffEmail)(teacherEmail);
    if (!norm)
        return [];
    const rooms = await prisma_1.prisma.classroom.findMany({
        where: {
            schoolId,
            teacherEmail: { equals: norm, mode: "insensitive" },
        },
        orderBy: { name: "asc" },
    });
    return Promise.all(rooms.map(async (c) => {
        const classNameVariants = await buildClassNameVariants(schoolId, c.name);
        const learnerCount = await prisma_1.prisma.learner.count({
            where: {
                schoolId,
                enrollmentStatus: "ACTIVE",
                className: { in: classNameVariants },
            },
        });
        return {
            id: c.id,
            name: c.name,
            teacherName: c.teacherName,
            teacherEmail: c.teacherEmail,
            learnerCount,
            classNameVariants,
        };
    }));
}
async function teacherAppMiddleware(req, res, next) {
    const payload = (0, staffJwt_1.verifyStaffJwt)(req.headers.authorization);
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
        const assignedClassrooms = await loadAssignedClassrooms(payload.schoolId, payload.email);
        const assignedClassNames = assignedClassrooms.map((c) => c.name);
        req.teacherCtx = {
            userId: payload.userId,
            schoolId: payload.schoolId,
            email: payload.email,
            role: payload.role,
            assignedClassNames,
            assignedClassrooms,
        };
        next();
    }
    catch (e) {
        console.error("teacher-app middleware", e);
        return res.status(500).json({ success: false, error: "Failed to resolve teacher context" });
    }
}
function ctx(req) {
    return req.teacherCtx;
}
function assertClassAllowed(res, className, assigned) {
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
        const user = await prisma_1.prisma.user.findFirst({
            where: { id: userId, schoolId },
            select: { id: true, email: true, fullName: true, role: true },
        });
        const school = await prisma_1.prisma.school.findUnique({
            where: { id: schoolId },
            select: { id: true, name: true, logoUrl: true },
        });
        const classroomsOut = assignedClassrooms.map((c) => ({
            id: c.id,
            name: c.name,
            teacherName: c.teacherName,
            teacherEmail: c.teacherEmail,
            learnerCount: c.learnerCount,
        }));
        let unreadInbox = 0;
        const normEmail = (0, staffJwt_1.normalizeStaffEmail)(email);
        const threads = await prisma_1.prisma.parentTeacherThread.findMany({
            where: { schoolId, teacherEmail: { equals: normEmail, mode: "insensitive" } },
            select: { id: true },
        });
        for (const t of threads) {
            const n = await prisma_1.prisma.parentTeacherMessage.count({
                where: { threadId: t.id, senderType: "PARENT", isRead: false },
            });
            unreadInbox += n;
        }
        return res.json({
            success: true,
            user: user
                ? { ...user, email: (0, staffJwt_1.normalizeStaffEmail)(user.email || email) }
                : { id: userId, email: (0, staffJwt_1.normalizeStaffEmail)(email), fullName: null, role },
            school,
            assignedClassNames,
            assignedClassrooms: classroomsOut,
            classrooms: classroomsOut,
            unreadInbox,
        });
    }
    catch (e) {
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
        const room = assignedClassrooms.find((c) => c.name === className || c.classNameVariants.includes(className));
        const variants = room?.classNameVariants.length ? room.classNameVariants : [className];
        const learners = await prisma_1.prisma.learner.findMany({
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
    }
    catch (e) {
        return res.status(500).json({ success: false, error: "Failed to load learners" });
    }
});
router.get("/homework", async (req, res) => {
    try {
        const { schoolId, assignedClassrooms } = ctx(req);
        const classVariants = allClassNameVariants(assignedClassrooms);
        if (!classVariants.length)
            return res.json({ success: true, posts: [] });
        const posts = await prisma_1.prisma.homeworkPost.findMany({
            where: { schoolId, className: { in: classVariants } },
            orderBy: { createdAt: "desc" },
            take: 80,
        });
        return res.json({ success: true, posts });
    }
    catch (e) {
        return res.status(500).json({ success: false, error: "Failed to load homework" });
    }
});
router.post("/homework", upload.array("files", 5), async (req, res) => {
    try {
        const teacherCtx = ctx(req);
        const { schoolId, assignedClassrooms, email } = teacherCtx;
        const className = String(req.body?.className || "").trim();
        const title = String(req.body?.title || "").trim();
        if (!title)
            return res.status(400).json({ success: false, error: "title required" });
        if (!assertClassAllowed(res, className, assignedClassrooms))
            return;
        const files = req.files || [];
        const base = publicBase(req);
        const attachments = files.map((f) => ({
            name: f.originalname,
            url: `${base}/uploads/teacher-app/${f.filename}`,
            mimeType: f.mimetype,
        }));
        const post = await prisma_1.prisma.homeworkPost.create({
            data: {
                schoolId,
                className,
                title,
                description: req.body?.description || null,
                dueDate: req.body?.dueDate ? new Date(String(req.body.dueDate)) : null,
                attachments: attachments.length ? attachments : undefined,
                createdBy: (0, staffJwt_1.normalizeStaffEmail)(email),
            },
        });
        const links = await prisma_1.prisma.parentLearnerLink.findMany({
            where: { schoolId, learner: { className } },
            select: { parentId: true, learnerId: true },
        });
        for (const link of links) {
            await (0, parentPortalService_1.createParentNotification)({
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
    }
    catch (e) {
        console.error("teacher-app homework", e);
        return res.status(500).json({ success: false, error: "Failed to create homework" });
    }
});
router.get("/notices", async (req, res) => {
    try {
        const { schoolId, assignedClassrooms } = ctx(req);
        const classVariants = allClassNameVariants(assignedClassrooms);
        if (!classVariants.length)
            return res.json({ success: true, notices: [] });
        const notices = await prisma_1.prisma.schoolNotice.findMany({
            where: { schoolId, className: { in: classVariants } },
            orderBy: { publishedAt: "desc" },
            take: 80,
        });
        return res.json({ success: true, notices });
    }
    catch (e) {
        return res.status(500).json({ success: false, error: "Failed to load notices" });
    }
});
router.post("/notices", upload.array("files", 5), async (req, res) => {
    try {
        const teacherCtx = ctx(req);
        const { schoolId, email } = teacherCtx;
        const className = String(req.body?.className || "").trim();
        const title = String(req.body?.title || "").trim();
        const body = String(req.body?.body || "").trim();
        const noticeTypeRaw = String(req.body?.noticeType || "CLASS").toUpperCase();
        if (!title)
            return res.status(400).json({ success: false, error: "title required" });
        if (!assertClassAllowed(res, className, teacherCtx.assignedClassrooms))
            return;
        const allowedTypes = ["CLASS", "SCHOOL", "ASSESSMENT", "EXAM", "GRADE"];
        const noticeType = (allowedTypes.includes(noticeTypeRaw)
            ? noticeTypeRaw
            : "CLASS");
        const dueLine = req.body?.dueDate ? `Due: ${String(req.body.dueDate)}\n\n` : "";
        const fullBody = `${dueLine}${body || title}`;
        const files = req.files || [];
        const base = publicBase(req);
        const attachments = files.map((f) => ({
            name: f.originalname,
            url: `${base}/uploads/teacher-app/${f.filename}`,
            mimeType: f.mimetype,
        }));
        const notice = await prisma_1.prisma.schoolNotice.create({
            data: {
                schoolId,
                noticeType,
                title,
                body: fullBody,
                className,
                attachments: attachments.length ? attachments : undefined,
                createdBy: (0, staffJwt_1.normalizeStaffEmail)(email),
            },
        });
        const notifType = noticeType === "ASSESSMENT"
            ? "ASSESSMENT"
            : noticeType === "EXAM"
                ? "EXAM"
                : "SCHOOL_NOTICE";
        const links = await prisma_1.prisma.parentLearnerLink.findMany({
            where: { schoolId },
            include: { learner: true },
        });
        for (const link of links) {
            if (!learnerMatchesClassFilter(link.learner, { learnerId: null, grade: null, className }))
                continue;
            await (0, parentPortalService_1.createParentNotification)({
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
    }
    catch (e) {
        console.error("teacher-app notices", e);
        return res.status(500).json({ success: false, error: "Failed to create notice" });
    }
});
router.get("/documents", async (req, res) => {
    try {
        const { schoolId, assignedClassrooms } = ctx(req);
        const classVariants = allClassNameVariants(assignedClassrooms);
        if (!classVariants.length)
            return res.json({ success: true, documents: [] });
        const documents = await prisma_1.prisma.parentDocument.findMany({
            where: { schoolId, className: { in: classVariants } },
            orderBy: { createdAt: "desc" },
            take: 80,
        });
        return res.json({ success: true, documents });
    }
    catch (e) {
        return res.status(500).json({ success: false, error: "Failed to load documents" });
    }
});
router.post("/documents", upload.single("file"), async (req, res) => {
    try {
        const teacherCtx = ctx(req);
        const { schoolId, assignedClassrooms, email } = teacherCtx;
        const className = String(req.body?.className || "").trim();
        const title = String(req.body?.title || "").trim();
        if (!title)
            return res.status(400).json({ success: false, error: "title required" });
        if (!assertClassAllowed(res, className, assignedClassrooms))
            return;
        const file = req.file;
        if (!file)
            return res.status(400).json({ success: false, error: "file required" });
        const base = publicBase(req);
        const fileUrl = `${base}/uploads/teacher-app/${file.filename}`;
        const doc = await prisma_1.prisma.parentDocument.create({
            data: {
                schoolId,
                title,
                description: req.body?.description || null,
                className,
                fileUrl,
                fileName: file.originalname,
            },
        });
        const links = await prisma_1.prisma.parentLearnerLink.findMany({
            where: { schoolId },
            include: { learner: true },
        });
        for (const link of links) {
            if (!learnerMatchesClassFilter(link.learner, { learnerId: null, grade: null, className }))
                continue;
            await (0, parentPortalService_1.createParentNotification)({
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
    }
    catch (e) {
        console.error("teacher-app documents", e);
        return res.status(500).json({ success: false, error: "Failed to upload document" });
    }
});
router.get("/incidents", async (req, res) => {
    try {
        const { schoolId, assignedClassrooms } = ctx(req);
        const classVariants = allClassNameVariants(assignedClassrooms);
        if (!classVariants.length)
            return res.json({ success: true, incidents: [] });
        const incidents = await prisma_1.prisma.learnerIncident.findMany({
            where: { schoolId },
            include: {
                learner: { select: { id: true, firstName: true, lastName: true, className: true, grade: true } },
            },
            orderBy: { incidentDate: "desc" },
            take: 120,
        });
        const filtered = incidents.filter((i) => i.learner.className && classVariants.includes(i.learner.className));
        return res.json({ success: true, incidents: filtered });
    }
    catch (e) {
        return res.status(500).json({ success: false, error: "Failed to load incidents" });
    }
});
router.post("/incidents", async (req, res) => {
    try {
        const { schoolId, assignedClassrooms, email } = ctx(req);
        const classVariants = allClassNameVariants(assignedClassrooms);
        const learnerId = String(req.body?.learnerId || "").trim();
        const summary = String(req.body?.summary || "").trim();
        const severity = String(req.body?.severity || "MEDIUM").trim().toUpperCase();
        const parentVisible = req.body?.parentVisible !== false && req.body?.parentVisible !== "false";
        const notifyParent = req.body?.notifyParent !== false && req.body?.notifyParent !== "false";
        if (!learnerId || !summary) {
            return res.status(400).json({ success: false, error: "learnerId and summary required" });
        }
        const learner = await prisma_1.prisma.learner.findFirst({
            where: { id: learnerId, schoolId },
            select: { id: true, className: true },
        });
        if (!learner || !learner.className || !classVariants.includes(learner.className)) {
            return res.status(403).json({ success: false, error: "Learner not in your classes" });
        }
        const incident = await prisma_1.prisma.learnerIncident.create({
            data: {
                schoolId,
                learnerId,
                type: severity || "MEDIUM",
                subject: String(req.body?.subject || "Incident").trim() || "Incident",
                summary,
                parentVisible,
                internalNotes: parentVisible ? null : summary,
                incidentDate: req.body?.incidentDate ? new Date(String(req.body.incidentDate)) : new Date(),
                createdBy: (0, staffJwt_1.normalizeStaffEmail)(email),
            },
        });
        if (parentVisible && notifyParent) {
            await (0, parentPortalService_1.notifyParentsForLearner)({
                schoolId,
                learnerId,
                type: "INCIDENT",
                title: "Incident recorded",
                message: `An incident was recorded for your child: ${incident.subject}. ${summary.slice(0, 400)}`,
                metadata: { incidentId: incident.id, severity: incident.type },
            });
        }
        return res.json({ success: true, incident });
    }
    catch (e) {
        console.error("teacher-app incidents", e);
        return res.status(500).json({ success: false, error: "Failed to save incident" });
    }
});
exports.default = router;
