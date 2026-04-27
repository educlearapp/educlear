import { Router } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../prisma";
import { computeStatementBalances } from "../billing/statementBalances";

const router = Router();

function normalizeEmail(email: unknown) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

function normalizePhone(phone: unknown) {
  return String(phone || "")
    .trim()
    .replace(/[^\d+]/g, "");
}

function assertStrongPassword(password: string) {
  if (password.length < 8) {
    const err: any = new Error("Password must be at least 8 characters.");
    err.status = 400;
    throw err;
  }
}

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asOptionalString(value: unknown) {
  const v = asString(value);
  return v ? v : null;
}

function parseDateOrNull(value: unknown) {
  if (!value) return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

router.post("/register", async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");
    const confirmPassword = String(req.body?.confirmPassword || "");
    const phone = normalizePhone(req.body?.cell || req.body?.cellNo || req.body?.phone || "");
    const idNumber = asOptionalString(req.body?.idNumber);

    if (!email || !email.includes("@")) return res.status(400).json({ error: "Valid email is required" });
    assertStrongPassword(password);

    if (!idNumber) return res.status(400).json({ error: "South African ID number is required" });
    if (!phone) return res.status(400).json({ error: "Cell number is required" });
    if (confirmPassword !== password) return res.status(400).json({ error: "Passwords do not match" });

    const existingAccount = await prisma.parentUser.findUnique({ where: { email } });
    if (existingAccount) return res.status(409).json({ error: "An account with this email already exists" });

    // Verification flow:
    // 1) Search by SA ID number first.
    // 2) If no match, search by cell number as backup.
    let parent = await prisma.parent.findFirst({ where: { idNumber } });
    if (!parent) {
      parent = await prisma.parent.findFirst({ where: { cellNo: phone } });
    }

    if (!parent) {
      return res.status(404).json({ error: "We could not verify your details. Please contact the school office." });
    }

    const existingForParent = await prisma.parentUser.findUnique({ where: { parentId: parent.id } });
    if (existingForParent) {
      return res.status(409).json({ error: "This Parent already has a Parent Portal account. Please log in." });
    }

    const hashed = await bcrypt.hash(password, 10);

    const parentUser = await prisma.parentUser.create({
      data: {
        parentId: parent.id,
        email,
        password: hashed,
      },
      select: { id: true, parentId: true, email: true, createdAt: true },
    });

    const fullParent = await prisma.parent.findUnique({
      where: { id: parent.id },
      include: {
        links: { include: { learner: true } },
      },
    });

    const learners = fullParent?.links?.map((l) => l.learner) || [];

    return res.json({
      ok: true,
      parentUser,
      parent: fullParent || parent,
      learners,
      schoolId: parent.schoolId,
    });
  } catch (e: any) {
    const status = Number(e?.status || 500);
    return res.status(status).json({ error: e?.message || "Registration failed" });
  }
});

router.post("/login", async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");
    if (!email || !password) return res.status(400).json({ error: "Email and password required" });

    const parentUser = await prisma.parentUser.findUnique({
      where: { email },
      select: { id: true, parentId: true, email: true, password: true, createdAt: true },
    });
    if (!parentUser) return res.status(401).json({ error: "Invalid credentials" });

    const ok = await bcrypt.compare(password, parentUser.password);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    const parent = await prisma.parent.findUnique({
      where: { id: parentUser.parentId },
      include: {
        links: {
          include: {
            learner: true,
          },
        },
        school: true,
      },
    });

    const learners = parent?.links?.map((l) => l.learner) || [];

    return res.json({
      ok: true,
      parentUser: { id: parentUser.id, parentId: parentUser.parentId, email: parentUser.email, createdAt: parentUser.createdAt },
      parent,
      learners,
      schoolId: parent?.schoolId || null,
      school: parent?.school
        ? {
            id: parent.school.id,
            name: parent.school.name,
            logoUrl: parent.school.logoUrl || null,
          }
        : null,
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Login failed" });
  }
});

router.get("/dashboard/:parentId", async (req, res) => {
  try {
    const parentId = asString(req.params?.parentId);
    if (!parentId) return res.status(400).json({ error: "parentId is required" });

    const parent = await prisma.parent.findUnique({
      where: { id: parentId },
      include: {
        school: true,
        links: {
          include: { learner: true },
        },
      },
    });

    if (!parent) return res.status(404).json({ error: "Parent not found" });

    const learners = parent.links.map((l) => l.learner);
    const schoolId = parent.schoolId;
    const classNames = Array.from(new Set(learners.map((l) => l.className).filter(Boolean))) as string[];

    const [latestHomework, latestProjects, latestNotices, latestTuckshopMenu, openThreads, invoices, payments] = await Promise.all([
      prisma.homework.findMany({
        where: {
          schoolId,
          ...(classNames.length ? { className: { in: classNames } } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
      prisma.project.findMany({
        where: {
          schoolId,
          ...(classNames.length ? { className: { in: classNames } } : {}),
        },
        orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
        take: 5,
      }),
      prisma.notice.findMany({
        where: { schoolId },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        take: 5,
      }),
      prisma.tuckshopMenu.findFirst({
        where: { schoolId },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      }),
      prisma.messageThread.findMany({
        where: { parentId, status: "OPEN" },
        orderBy: { createdAt: "desc" },
        include: {
          replies: {
            orderBy: { createdAt: "asc" },
            take: 50,
          },
          learner: true,
          teacher: { select: { id: true, email: true } },
        },
        take: 20,
      }),
      prisma.invoice.findMany({
        where: { parentId, schoolId },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { id: true, amountCents: true, createdAt: true, dueDate: true },
      }),
      prisma.payment.findMany({
        where: { parentId, schoolId },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { id: true, amount: true, method: true, createdAt: true },
      }),
    ]);

    const outstandingBalance = Number(parent.outstandingAmount || 0);

    return res.json({
      ok: true,
      parent,
      learners,
      school: parent?.school
        ? {
            id: parent.school.id,
            name: parent.school.name,
            logoUrl: parent.school.logoUrl || null,
          }
        : null,
      billing: {
        outstandingBalance,
        recentInvoices: invoices,
        recentPayments: payments,
      },
      latestHomework,
      latestProjects,
      latestNotices,
      tuckshopMenu: latestTuckshopMenu,
      openMessageThreads: openThreads,
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Failed to load parent dashboard" });
  }
});

router.get("/statements/:parentId", async (req, res) => {
  try {
    const parentId = asString(req.params?.parentId);
    if (!parentId) return res.status(400).json({ error: "parentId is required" });

    const parent = await prisma.parent.findUnique({
      where: { id: parentId },
      include: {
        familyAccount: true,
        links: { include: { learner: true } },
      },
    });
    if (!parent) return res.status(404).json({ error: "Parent not found" });

    const learners = parent.links.map((l) => l.learner);

    const [invoices, payments] = await Promise.all([
      prisma.invoice.findMany({
        where: { parentId, schoolId: parent.schoolId },
        orderBy: { createdAt: "desc" },
        take: 200,
        include: {
          lines: true,
          learner: true,
          familyAccount: true,
        },
      }),
      prisma.payment.findMany({
        where: { parentId, schoolId: parent.schoolId },
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
    ]);

    const computed = computeStatementBalances({ invoices, payments });

    return res.json({
      ok: true,
      parent,
      schoolId: parent.schoolId,
      familyAccount: parent.familyAccount,
      learners,
      summary: {
        outstandingBalance: Number(parent.outstandingAmount || 0),
        totalOutstandingBalance: computed.totalOutstandingBalanceCents / 100,
        overdueBalance: computed.overdueBalanceCents / 100,
        nextDueDate: computed.nextDueDate,
      },
      statementLines: computed.statementLines,
      invoices,
      payments,
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Failed to load statements" });
  }
});

router.get("/homework", async (req, res) => {
  try {
    const schoolId = asString(req.query?.schoolId);
    const className = asString(req.query?.className);
    if (!schoolId) return res.status(400).json({ error: "schoolId is required" });
    if (!className) return res.status(400).json({ error: "className is required" });

    const homework = await prisma.homework.findMany({
      where: { schoolId, className },
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      take: 100,
    });

    return res.json({ ok: true, homework });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Failed to fetch homework" });
  }
});

router.get("/projects", async (req, res) => {
  try {
    const schoolId = asString(req.query?.schoolId);
    const className = asOptionalString(req.query?.className);
    if (!schoolId) return res.status(400).json({ error: "schoolId is required" });

    const projects = await prisma.project.findMany({
      where: {
        schoolId,
        ...(className ? { className } : {}),
      },
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      take: 200,
    });

    return res.json({ ok: true, projects });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Failed to fetch projects" });
  }
});

router.get("/notices", async (req, res) => {
  try {
    const schoolId = asString(req.query?.schoolId);
    if (!schoolId) return res.status(400).json({ error: "schoolId is required" });

    const notices = await prisma.notice.findMany({
      where: { schoolId },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 100,
    });

    return res.json({ ok: true, notices });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Failed to fetch notices" });
  }
});

router.get("/tuckshop", async (req, res) => {
  try {
    const schoolId = asString(req.query?.schoolId);
    if (!schoolId) return res.status(400).json({ error: "schoolId is required" });

    const date = parseDateOrNull(req.query?.date);
    const latest = String(req.query?.latest || "").toLowerCase() === "true";

    const menu = latest
      ? await prisma.tuckshopMenu.findFirst({ where: { schoolId }, orderBy: [{ date: "desc" }, { createdAt: "desc" }] })
      : date
        ? await prisma.tuckshopMenu.findFirst({ where: { schoolId, date } })
        : await prisma.tuckshopMenu.findFirst({ where: { schoolId }, orderBy: [{ date: "desc" }, { createdAt: "desc" }] });

    return res.json({ ok: true, menu });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Failed to fetch tuckshop menu" });
  }
});

router.get("/messages/threads", async (req, res) => {
  try {
    const parentId = asOptionalString(req.query?.parentId);
    const teacherId = asOptionalString(req.query?.teacherId);
    const schoolId = asOptionalString(req.query?.schoolId);

    if (!parentId && !teacherId && !schoolId) {
      return res.status(400).json({ error: "Provide parentId or teacherId or schoolId" });
    }

    const threads = await prisma.messageThread.findMany({
      where: {
        ...(schoolId ? { schoolId } : {}),
        ...(parentId ? { parentId } : {}),
        ...(teacherId ? { teacherId } : {}),
      },
      orderBy: { createdAt: "desc" },
      include: {
        learner: true,
        parent: true,
        teacher: { select: { id: true, email: true } },
        replies: { orderBy: { createdAt: "asc" }, take: 50 },
      },
      take: 200,
    });

    return res.json({ ok: true, threads });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Failed to fetch message threads" });
  }
});

router.post("/messages/thread", async (req, res) => {
  try {
    const schoolId = asString(req.body?.schoolId);
    const learnerId = asString(req.body?.learnerId);
    const parentId = asString(req.body?.parentId);
    const teacherId = asOptionalString(req.body?.teacherId);
    const topic = asString(req.body?.topic);
    const message = asString(req.body?.message);

    if (!schoolId) return res.status(400).json({ error: "schoolId is required" });
    if (!learnerId) return res.status(400).json({ error: "learnerId is required" });
    if (!parentId) return res.status(400).json({ error: "parentId is required" });
    if (!topic) return res.status(400).json({ error: "topic is required" });
    if (!message) return res.status(400).json({ error: "message is required" });

    const [parent, learner] = await Promise.all([
      prisma.parent.findUnique({ where: { id: parentId } }),
      prisma.learner.findUnique({ where: { id: learnerId } }),
    ]);
    if (!parent) return res.status(404).json({ error: "Parent not found" });
    if (!learner) return res.status(404).json({ error: "Learner not found" });
    if (parent.schoolId !== schoolId || learner.schoolId !== schoolId) {
      return res.status(400).json({ error: "Parent/Learner must belong to the provided schoolId" });
    }

    const thread = await prisma.messageThread.create({
      data: {
        schoolId,
        learnerId,
        parentId,
        teacherId,
        topic,
        replies: {
          create: {
            senderId: parentId,
            senderRole: "PARENT",
            message,
          },
        },
      },
      include: { replies: true, learner: true, parent: true, teacher: { select: { id: true, email: true } } },
    });

    return res.json({ ok: true, thread });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Failed to create thread" });
  }
});

router.get("/messages/thread/:threadId", async (req, res) => {
  try {
    const threadId = asString(req.params?.threadId);
    if (!threadId) return res.status(400).json({ error: "threadId is required" });

    const thread = await prisma.messageThread.findUnique({
      where: { id: threadId },
      include: {
        learner: true,
        parent: true,
        teacher: { select: { id: true, email: true } },
        replies: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!thread) return res.status(404).json({ error: "Thread not found" });

    return res.json({ ok: true, thread });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Failed to fetch thread" });
  }
});

router.post("/messages/reply", async (req, res) => {
  try {
    const threadId = asString(req.body?.threadId);
    const senderId = asString(req.body?.senderId);
    const senderRole = asString(req.body?.senderRole);
    const message = asString(req.body?.message);

    if (!threadId) return res.status(400).json({ error: "threadId is required" });
    if (!senderId) return res.status(400).json({ error: "senderId is required" });
    if (!senderRole) return res.status(400).json({ error: "senderRole is required" });
    if (!message) return res.status(400).json({ error: "message is required" });

    const thread = await prisma.messageThread.findUnique({ where: { id: threadId } });
    if (!thread) return res.status(404).json({ error: "Thread not found" });
    if (thread.status === "CLOSED") return res.status(400).json({ error: "Thread is closed" });

    const reply = await prisma.messageReply.create({
      data: { threadId, senderId, senderRole, message },
    });

    return res.json({ ok: true, reply });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Failed to add reply" });
  }
});

router.patch("/messages/thread/:threadId/close", async (req, res) => {
  try {
    const threadId = asString(req.params?.threadId);
    if (!threadId) return res.status(400).json({ error: "threadId is required" });

    const updated = await prisma.messageThread.update({
      where: { id: threadId },
      data: { status: "CLOSED" },
    });

    return res.json({ ok: true, thread: updated });
  } catch (e: any) {
    const msg = e?.message || "Failed to close thread";
    if (String(msg).includes("Record to update not found")) return res.status(404).json({ error: "Thread not found" });
    return res.status(500).json({ error: msg });
  }
});

export default router;

