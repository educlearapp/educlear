"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../prisma");
const communicationQueue_1 = require("../communication/communicationQueue");
const communicationEngine_1 = require("../communication/communicationEngine");
const router = (0, express_1.Router)();
router.get("/messages", async (req, res) => {
    try {
        const schoolId = String(req.query.schoolId || "").trim();
        if (!schoolId)
            return res.status(400).json({ success: false, error: "schoolId required" });
        const status = String(req.query.status || "").trim();
        const channel = String(req.query.channel || "").trim();
        const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
        const offset = Math.max(0, Number(req.query.offset) || 0);
        const where = { schoolId };
        if (status)
            where.status = status;
        if (channel)
            where.channel = channel;
        const [items, total] = await Promise.all([
            prisma_1.prisma.communicationMessage.findMany({
                where,
                orderBy: { queuedAt: "desc" },
                skip: offset,
                take: limit,
                include: {
                    parent: { select: { id: true, firstName: true, surname: true, email: true, cellNo: true } },
                    learner: { select: { id: true, firstName: true, lastName: true } },
                },
            }),
            prisma_1.prisma.communicationMessage.count({ where }),
        ]);
        return res.json({ success: true, items, total, limit, offset });
    }
    catch (e) {
        console.error("[communication-engine] list messages", e);
        return res.status(500).json({ success: false, error: "Failed to load messages" });
    }
});
router.get("/messages/stats", async (req, res) => {
    try {
        const schoolId = String(req.query.schoolId || "").trim();
        if (!schoolId)
            return res.status(400).json({ success: false, error: "schoolId required" });
        const grouped = await prisma_1.prisma.communicationMessage.groupBy({
            by: ["status"],
            where: { schoolId },
            _count: { _all: true },
        });
        const byChannel = await prisma_1.prisma.communicationMessage.groupBy({
            by: ["channel"],
            where: { schoolId },
            _count: { _all: true },
        });
        const byCategory = await prisma_1.prisma.communicationMessage.groupBy({
            by: ["category"],
            where: { schoolId },
            _count: { _all: true },
        });
        return res.json({
            success: true,
            byStatus: Object.fromEntries(grouped.map((g) => [g.status, g._count._all])),
            byChannel: Object.fromEntries(byChannel.map((g) => [g.channel, g._count._all])),
            byCategory: Object.fromEntries(byCategory.map((g) => [g.category, g._count._all])),
        });
    }
    catch (e) {
        console.error("[communication-engine] stats", e);
        return res.status(500).json({ success: false, error: "Failed to load stats" });
    }
});
router.get("/campaigns", async (req, res) => {
    try {
        const schoolId = String(req.query.schoolId || "").trim();
        if (!schoolId)
            return res.status(400).json({ success: false, error: "schoolId required" });
        const campaigns = await prisma_1.prisma.communicationCampaign.findMany({
            where: { schoolId },
            orderBy: { createdAt: "desc" },
            take: 100,
            include: {
                _count: { select: { messages: true } },
            },
        });
        return res.json({ success: true, campaigns });
    }
    catch (e) {
        console.error("[communication-engine] campaigns", e);
        return res.status(500).json({ success: false, error: "Failed to load campaigns" });
    }
});
router.post("/messages/:id/retry", async (req, res) => {
    try {
        const id = String(req.params.id || "").trim();
        if (!id)
            return res.status(400).json({ success: false, error: "id required" });
        const r = await (0, communicationQueue_1.retryCommunicationMessage)(prisma_1.prisma, id);
        if (!r.ok)
            return res.status(400).json({ success: false, error: r.error });
        return res.json({ success: true });
    }
    catch (e) {
        console.error("[communication-engine] retry", e);
        return res.status(500).json({ success: false, error: "Retry failed" });
    }
});
router.post("/queue/process", async (_req, res) => {
    try {
        await (0, communicationEngine_1.ensureDefaultCommunicationTemplates)(prisma_1.prisma);
        const result = await (0, communicationQueue_1.processCommunicationQueueBatch)(prisma_1.prisma, 40);
        return res.json({ success: true, ...result });
    }
    catch (e) {
        console.error("[communication-engine] process", e);
        return res.status(500).json({ success: false, error: "Process failed" });
    }
});
router.get("/provider-settings", async (req, res) => {
    try {
        const schoolId = String(req.query.schoolId || "").trim();
        if (!schoolId)
            return res.status(400).json({ success: false, error: "schoolId required" });
        const row = await prisma_1.prisma.schoolCommunicationProfile.findUnique({ where: { schoolId } });
        return res.json({
            success: true,
            settings: row || {
                schoolId,
                smtp: null,
                smsProvider: null,
                whatsappProvider: null,
                pushProvider: null,
                senderDisplayName: "",
                replyToEmail: "",
            },
        });
    }
    catch (e) {
        console.error("[communication-engine] get provider-settings", e);
        return res.status(500).json({ success: false, error: "Failed to load settings" });
    }
});
router.put("/provider-settings", async (req, res) => {
    try {
        const schoolId = String(req.body?.schoolId || "").trim();
        if (!schoolId)
            return res.status(400).json({ success: false, error: "schoolId required" });
        const smtp = req.body?.smtp;
        const smsProvider = req.body?.smsProvider;
        const whatsappProvider = req.body?.whatsappProvider;
        const pushProvider = req.body?.pushProvider;
        const senderDisplayName = String(req.body?.senderDisplayName ?? "");
        const replyToEmail = String(req.body?.replyToEmail ?? "");
        const row = await prisma_1.prisma.schoolCommunicationProfile.upsert({
            where: { schoolId },
            create: {
                schoolId,
                smtp: smtp ?? undefined,
                smsProvider: smsProvider ?? undefined,
                whatsappProvider: whatsappProvider ?? undefined,
                pushProvider: pushProvider ?? undefined,
                senderDisplayName,
                replyToEmail,
            },
            update: {
                ...(smtp !== undefined ? { smtp } : {}),
                ...(smsProvider !== undefined ? { smsProvider } : {}),
                ...(whatsappProvider !== undefined ? { whatsappProvider } : {}),
                ...(pushProvider !== undefined ? { pushProvider } : {}),
                senderDisplayName,
                replyToEmail,
            },
        });
        return res.json({ success: true, settings: row });
    }
    catch (e) {
        console.error("[communication-engine] put provider-settings", e);
        return res.status(500).json({ success: false, error: "Failed to save settings" });
    }
});
router.post("/push/register", async (req, res) => {
    try {
        const schoolId = String(req.body?.schoolId || "").trim();
        const parentId = String(req.body?.parentId || "").trim();
        const endpoint = String(req.body?.endpoint || "").trim();
        const keys = req.body?.keys;
        const userAgent = String(req.body?.userAgent || "").trim();
        if (!schoolId || !parentId || !endpoint) {
            return res.status(400).json({ success: false, error: "schoolId, parentId, endpoint required" });
        }
        const parent = await prisma_1.prisma.parent.findFirst({
            where: { id: parentId, schoolId },
            select: { id: true },
        });
        if (!parent)
            return res.status(404).json({ success: false, error: "Parent not found" });
        const sub = await prisma_1.prisma.pushSubscription.upsert({
            where: { endpoint },
            create: {
                schoolId,
                parentId,
                endpoint,
                keys: keys === undefined ? undefined : keys,
                userAgent: userAgent || undefined,
            },
            update: {
                schoolId,
                parentId,
                keys: keys === undefined ? undefined : keys,
                userAgent: userAgent || undefined,
            },
        });
        return res.json({
            success: true,
            subscriptionId: sub.id,
            note: "Push delivery is not enabled yet; subscription is stored for a future release.",
        });
    }
    catch (e) {
        console.error("[communication-engine] push register", e);
        return res.status(500).json({ success: false, error: "Registration failed" });
    }
});
router.get("/templates", async (req, res) => {
    try {
        const schoolId = String(req.query.schoolId || "").trim();
        await (0, communicationEngine_1.ensureDefaultCommunicationTemplates)(prisma_1.prisma);
        const templates = await prisma_1.prisma.communicationTemplate.findMany({
            where: {
                OR: [{ schoolId: null }, ...(schoolId ? [{ schoolId }] : [])],
            },
            orderBy: [{ schoolId: "asc" }, { templateKey: "asc" }],
        });
        return res.json({ success: true, templates });
    }
    catch (e) {
        console.error("[communication-engine] templates", e);
        return res.status(500).json({ success: false, error: "Failed to load templates" });
    }
});
exports.default = router;
