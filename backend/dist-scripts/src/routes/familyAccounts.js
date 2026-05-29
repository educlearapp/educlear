"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const familyAccountService_1 = require("../services/familyAccountService");
const familyAccountAuditStore_1 = require("../utils/familyAccountAuditStore");
const router = (0, express_1.Router)();
function actorEmailFromRequest(req) {
    const fromBody = String(req.body?.actorEmail || "").trim();
    if (fromBody)
        return fromBody;
    return String(req.query?.actorEmail || "").trim() || undefined;
}
function pickBodyString(body, keys) {
    if (!body)
        return "";
    for (const key of keys) {
        const value = body[key];
        if (value !== undefined && value !== null) {
            const trimmed = String(value).trim();
            if (trimmed)
                return trimmed;
        }
    }
    return "";
}
function mergeStatusCode(message) {
    const lower = message.toLowerCase();
    if (lower.includes("not found") || lower.includes("route not available"))
        return 404;
    return 400;
}
function sanitizeFamilyAccountError(error, fallback) {
    if (error && typeof error === "object") {
        const e = error;
        if (e.code === "P2002") {
            const target = Array.isArray(e.meta?.target) ? e.meta.target : [];
            if (target.includes("admissionNo")) {
                return "A learner with this admission number already exists for this school";
            }
            return "This operation conflicts with existing records";
        }
        if (e.code === "P2003")
            return "Related record not found";
        if (typeof e.message === "string" && e.message.trim()) {
            return sanitizeFamilyAccountErrorMessage(e.message.trim(), fallback);
        }
    }
    if (error instanceof Error && error.message.trim()) {
        return sanitizeFamilyAccountErrorMessage(error.message.trim(), fallback);
    }
    return fallback;
}
function sanitizeFamilyAccountErrorMessage(raw, fallback) {
    if (/Invalid `prisma\./i.test(raw) || /invocation in/i.test(raw))
        return fallback;
    if (/Unique constraint failed/i.test(raw)) {
        if (/admissionNo/i.test(raw)) {
            return "A learner with this admission number already exists for this school";
        }
        return "This operation conflicts with existing records";
    }
    const firstLine = raw.split("\n")[0]?.trim() || "";
    if (!firstLine || firstLine.length > 240)
        return fallback;
    return firstLine;
}
// POST /api/family-accounts/merge
router.post("/merge", async (req, res) => {
    const schoolId = pickBodyString(req.body, ["schoolId"]);
    const sourceFamilyAccountId = pickBodyString(req.body, [
        "sourceFamilyAccountId",
        "sourceAccountId",
    ]);
    const sourceAccountRef = pickBodyString(req.body, [
        "sourceAccountRef",
        "sourceAccountNo",
        "sourceAccountNumber",
    ]);
    const sourceLearnerId = pickBodyString(req.body, [
        "sourceLearnerId",
        "sourceLearner",
        "learnerId",
        "currentLearnerId",
    ]);
    const targetFamilyAccountId = pickBodyString(req.body, [
        "targetFamilyAccountId",
        "targetAccountId",
    ]);
    const targetAccountRef = pickBodyString(req.body, [
        "targetAccountRef",
        "targetAccountNo",
        "targetAccountNumber",
    ]);
    const targetLearnerId = pickBodyString(req.body, [
        "targetLearnerId",
        "targetLearner",
    ]);
    console.log("[family-accounts] POST /merge payload", {
        schoolId: schoolId || null,
        sourceFamilyAccountId: sourceFamilyAccountId || null,
        sourceAccountRef: sourceAccountRef || null,
        sourceLearnerId: sourceLearnerId || null,
        targetFamilyAccountId: targetFamilyAccountId || null,
        targetAccountRef: targetAccountRef || null,
        targetLearnerId: targetLearnerId || null,
    });
    try {
        if (!schoolId) {
            console.warn("[family-accounts] POST /merge validation failed: Missing schoolId");
            return res.status(400).json({ success: false, error: "Missing schoolId" });
        }
        const hasSource = Boolean(sourceFamilyAccountId) || Boolean(sourceAccountRef) || Boolean(sourceLearnerId);
        const hasTarget = Boolean(targetFamilyAccountId) || Boolean(targetAccountRef) || Boolean(targetLearnerId);
        if (!hasSource || !hasTarget) {
            const reason = "Source and target are required (sourceFamilyAccountId or sourceAccountRef or sourceLearnerId, and matching target fields)";
            console.warn("[family-accounts] POST /merge validation failed:", reason, {
                schoolId,
                hasSource,
                hasTarget,
            });
            return res.status(400).json({ success: false, error: reason });
        }
        const result = await (0, familyAccountService_1.mergeFamilyAccounts)({
            schoolId,
            sourceFamilyAccountId,
            sourceAccountRef,
            sourceLearnerId,
            targetFamilyAccountId,
            targetAccountRef,
            targetLearnerId,
            actorEmail: actorEmailFromRequest(req),
        });
        return res.json({
            ...result,
            accounts: result.statements,
            statements: result.statements,
        });
    }
    catch (error) {
        const message = sanitizeFamilyAccountError(error, "Merge failed");
        const status = mergeStatusCode(message);
        console.error("[family-accounts] POST /merge failed:", {
            schoolId: schoolId || null,
            sourceFamilyAccountId: sourceFamilyAccountId || null,
            sourceAccountRef: sourceAccountRef || null,
            sourceLearnerId: sourceLearnerId || null,
            targetFamilyAccountId: targetFamilyAccountId || null,
            targetAccountRef: targetAccountRef || null,
            targetLearnerId: targetLearnerId || null,
            status,
            reason: message,
            error,
        });
        return res.status(status).json({ success: false, error: message });
    }
});
// POST /api/family-accounts/unmerge
router.post("/unmerge", async (req, res) => {
    try {
        const schoolId = String(req.body?.schoolId || "").trim();
        const learnerId = String(req.body?.learnerId || "").trim();
        const createNewAccount = req.body?.createNewAccount !== undefined
            ? Boolean(req.body.createNewAccount)
            : req.body?.createNew !== undefined
                ? Boolean(req.body.createNew)
                : true;
        if (!schoolId) {
            return res.status(400).json({ success: false, error: "Missing schoolId" });
        }
        if (!learnerId) {
            return res.status(400).json({ success: false, error: "learnerId is required" });
        }
        const result = await (0, familyAccountService_1.unmergeLearnerFromFamily)({
            schoolId,
            learnerId,
            createNewAccount,
            actorEmail: actorEmailFromRequest(req),
        });
        return res.json({
            ...result,
            accounts: result.statements,
            statements: result.statements,
        });
    }
    catch (error) {
        const message = sanitizeFamilyAccountError(error, "Unmerge failed");
        const status = message.includes("not found") ? 404 : 400;
        console.error("[family-accounts] POST /unmerge failed:", error);
        return res.status(status).json({ success: false, error: message });
    }
});
// GET /api/family-accounts/audit?schoolId=...
router.get("/audit", async (req, res) => {
    try {
        const schoolId = typeof req.query?.schoolId === "string" ? String(req.query.schoolId) : "";
        if (!schoolId) {
            return res.status(400).json({ success: false, error: "Missing schoolId" });
        }
        const limit = Math.min(200, Math.max(1, Number(req.query?.limit) || 50));
        const entries = (0, familyAccountAuditStore_1.listFamilyAccountAudit)(schoolId, limit);
        return res.json({ success: true, entries });
    }
    catch (error) {
        console.error("[family-accounts] GET /audit failed:", error);
        return res.status(500).json({ success: false, error: "Server error" });
    }
});
exports.default = router;
