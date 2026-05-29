"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const prisma_1 = require("../prisma");
const userPermissions_1 = require("../utils/userPermissions");
const userAccessStore_1 = require("../utils/userAccessStore");
const router = (0, express_1.Router)();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
function formatApiError(error, fallback) {
    if (error && typeof error === "object") {
        const e = error;
        if (e.code === "P2002")
            return "Email already exists for this school";
        if (e.code === "P2003")
            return "School not found — invalid schoolId";
        if (typeof e.message === "string" && e.message.trim())
            return e.message;
    }
    return fallback;
}
function isValidEmail(email) {
    return EMAIL_RE.test(email);
}
function splitFullName(fullName) {
    const parts = String(fullName || "")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
    if (!parts.length)
        return { firstName: "", surname: "" };
    if (parts.length === 1)
        return { firstName: parts[0], surname: "" };
    return { firstName: parts[0], surname: parts.slice(1).join(" ") };
}
function serializeUser(user, meta) {
    const fallback = splitFullName(user.fullName);
    const firstName = meta?.firstName || fallback.firstName;
    const surname = meta?.surname || fallback.surname;
    const appRole = (meta?.appRole || "Viewer");
    const permissions = (0, userPermissions_1.permissionsForRole)(appRole, meta?.permissions || null);
    return {
        id: user.id,
        schoolId: user.schoolId,
        email: user.email,
        firstName,
        surname,
        fullName: `${firstName} ${surname}`.trim() || user.fullName || "",
        appRole,
        role: appRole,
        prismaRole: user.role,
        status: user.isActive ? "Active" : "Disabled",
        isActive: user.isActive,
        permissions,
        lastLoginAt: meta?.lastLoginAt || null,
        createdAt: user.createdAt.toISOString(),
    };
}
async function countActiveOwners(schoolId, excludeUserId) {
    const users = await prisma_1.prisma.user.findMany({
        where: { schoolId, isActive: true },
        select: { id: true },
    });
    const metaMap = (0, userAccessStore_1.listAccessMetaForSchool)(schoolId);
    return users.filter((u) => {
        if (excludeUserId && u.id === excludeUserId)
            return false;
        const meta = metaMap[u.id];
        return (meta?.appRole || "") === "Owner";
    }).length;
}
router.get("/", async (req, res) => {
    try {
        const schoolId = String(req.query?.schoolId || "").trim();
        if (!schoolId) {
            return res.status(400).json({ success: false, error: "schoolId is required" });
        }
        const users = await prisma_1.prisma.user.findMany({
            where: { schoolId },
            orderBy: { createdAt: "desc" },
            select: {
                id: true,
                schoolId: true,
                email: true,
                fullName: true,
                isActive: true,
                role: true,
                createdAt: true,
            },
        });
        const metaMap = (0, userAccessStore_1.listAccessMetaForSchool)(schoolId);
        const rows = users.map((user) => serializeUser(user, metaMap[user.id] || null));
        return res.json({ success: true, users: rows });
    }
    catch (error) {
        console.error("[users] GET / failed:", error);
        return res.status(500).json({
            success: false,
            error: formatApiError(error, "Failed to fetch users"),
        });
    }
});
router.post("/", async (req, res) => {
    try {
        const body = req.body ?? {};
        const schoolId = String(body.schoolId || "").trim();
        const firstName = String(body.firstName || body.name || "").trim();
        const surname = String(body.surname || "").trim();
        const email = String(body.email || "").trim().toLowerCase();
        const password = String(body.password || "");
        const appRole = String(body.appRole || body.role || "Viewer").trim();
        const isActive = body.isActive !== false && body.status !== "Disabled";
        if (!schoolId || !firstName || !email || !password) {
            return res.status(400).json({
                success: false,
                error: "schoolId, firstName, email, and password are required",
            });
        }
        if (!isValidEmail(email)) {
            return res.status(400).json({ success: false, error: "Invalid email address" });
        }
        if (!userPermissions_1.APP_ROLES.includes(appRole)) {
            return res.status(400).json({ success: false, error: "Invalid role" });
        }
        if (password.length < 8) {
            return res.status(400).json({ success: false, error: "Password must be at least 8 characters" });
        }
        const school = await prisma_1.prisma.school.findUnique({ where: { id: schoolId }, select: { id: true } });
        if (!school) {
            return res.status(400).json({ success: false, error: "School not found — invalid schoolId" });
        }
        const existing = await prisma_1.prisma.user.findFirst({ where: { schoolId, email } });
        if (existing) {
            return res.status(400).json({ success: false, error: "Email already exists for this school" });
        }
        const passwordHash = await bcryptjs_1.default.hash(password, 10);
        const permissions = (0, userPermissions_1.permissionsForRole)(appRole, body.permissions ? (0, userPermissions_1.mergePermissions)(body.permissions) : null);
        const user = await prisma_1.prisma.user.create({
            data: {
                schoolId,
                email,
                fullName: `${firstName} ${surname}`.trim(),
                passwordHash,
                isActive,
                role: (0, userPermissions_1.prismaRoleForAppRole)(appRole),
            },
            select: {
                id: true,
                schoolId: true,
                email: true,
                fullName: true,
                isActive: true,
                role: true,
                createdAt: true,
            },
        });
        (0, userAccessStore_1.setUserAccessMeta)(user.id, {
            schoolId,
            firstName,
            surname,
            appRole,
            permissions,
            lastLoginAt: null,
        });
        const meta = (0, userAccessStore_1.getUserAccessMeta)(user.id);
        return res.status(201).json({ success: true, user: serializeUser(user, meta) });
    }
    catch (error) {
        console.error("[users] POST / failed:", error);
        return res.status(500).json({
            success: false,
            error: formatApiError(error, "Failed to create user"),
        });
    }
});
router.put("/:id", async (req, res) => {
    try {
        const userId = String(req.params.id || "").trim();
        const body = req.body ?? {};
        const schoolId = String(body.schoolId || "").trim();
        const existing = await prisma_1.prisma.user.findUnique({ where: { id: userId } });
        if (!existing) {
            return res.status(404).json({ success: false, error: "User not found" });
        }
        if (schoolId && existing.schoolId !== schoolId) {
            return res.status(403).json({ success: false, error: "User does not belong to this school" });
        }
        const meta = (0, userAccessStore_1.getUserAccessMeta)(userId);
        const currentRole = (meta?.appRole || "Viewer");
        const firstName = String(body.firstName ?? meta?.firstName ?? "").trim();
        const surname = String(body.surname ?? meta?.surname ?? "").trim();
        const email = body.email ? String(body.email).trim().toLowerCase() : existing.email;
        const appRole = (body.appRole || body.role)
            ? String(body.appRole || body.role).trim()
            : currentRole;
        const isActive = typeof body.isActive === "boolean"
            ? body.isActive
            : body.status
                ? body.status !== "Disabled"
                : existing.isActive;
        if (!isValidEmail(email)) {
            return res.status(400).json({ success: false, error: "Invalid email address" });
        }
        if (email !== existing.email) {
            const duplicate = await prisma_1.prisma.user.findFirst({
                where: { schoolId: existing.schoolId, email, NOT: { id: userId } },
            });
            if (duplicate) {
                return res.status(400).json({ success: false, error: "Email already exists for this school" });
            }
        }
        if (!userPermissions_1.APP_ROLES.includes(appRole)) {
            return res.status(400).json({ success: false, error: "Invalid role" });
        }
        if (currentRole === "Owner" && appRole !== "Owner" && isActive) {
            const owners = await countActiveOwners(existing.schoolId, userId);
            if (owners < 1) {
                return res.status(400).json({
                    success: false,
                    error: "Cannot change role: school must keep at least one active Owner",
                });
            }
        }
        const permissions = (0, userPermissions_1.permissionsForRole)(appRole, body.permissions ? (0, userPermissions_1.mergePermissions)(body.permissions) : meta?.permissions || null);
        const updateData = {
            email,
            fullName: `${firstName} ${surname}`.trim(),
            isActive,
            role: (0, userPermissions_1.prismaRoleForAppRole)(appRole),
        };
        if (body.password) {
            const password = String(body.password);
            if (password.length < 8) {
                return res.status(400).json({ success: false, error: "Password must be at least 8 characters" });
            }
            updateData.passwordHash = await bcryptjs_1.default.hash(password, 10);
        }
        const user = await prisma_1.prisma.user.update({
            where: { id: userId },
            data: updateData,
            select: {
                id: true,
                schoolId: true,
                email: true,
                fullName: true,
                isActive: true,
                role: true,
                createdAt: true,
            },
        });
        (0, userAccessStore_1.setUserAccessMeta)(userId, {
            schoolId: existing.schoolId,
            firstName,
            surname,
            appRole,
            permissions,
            lastLoginAt: meta?.lastLoginAt || null,
        });
        const savedMeta = (0, userAccessStore_1.getUserAccessMeta)(userId);
        return res.json({ success: true, user: serializeUser(user, savedMeta) });
    }
    catch (error) {
        console.error("[users] PUT /:id failed:", error);
        return res.status(500).json({
            success: false,
            error: formatApiError(error, "Failed to update user"),
        });
    }
});
router.patch("/:id/status", async (req, res) => {
    try {
        const userId = String(req.params.id || "").trim();
        const status = String(req.body?.status || "").trim();
        const isActive = typeof req.body?.isActive === "boolean" ? req.body.isActive : status !== "Disabled";
        const existing = await prisma_1.prisma.user.findUnique({ where: { id: userId } });
        if (!existing) {
            return res.status(404).json({ success: false, error: "User not found" });
        }
        const meta = (0, userAccessStore_1.getUserAccessMeta)(userId);
        if (meta?.appRole === "Owner" && !isActive) {
            const owners = await countActiveOwners(existing.schoolId, userId);
            if (owners < 1) {
                return res.status(400).json({
                    success: false,
                    error: "Cannot disable the last active Owner for this school",
                });
            }
        }
        const user = await prisma_1.prisma.user.update({
            where: { id: userId },
            data: { isActive },
            select: {
                id: true,
                schoolId: true,
                email: true,
                fullName: true,
                isActive: true,
                role: true,
                createdAt: true,
            },
        });
        return res.json({ success: true, user: serializeUser(user, meta) });
    }
    catch (error) {
        console.error("[users] PATCH /:id/status failed:", error);
        return res.status(500).json({
            success: false,
            error: formatApiError(error, "Failed to update user status"),
        });
    }
});
router.patch("/:id/permissions", async (req, res) => {
    try {
        const userId = String(req.params.id || "").trim();
        const body = req.body ?? {};
        const appRole = String(body.appRole || body.role || "").trim();
        const permissionsInput = body.permissions;
        const existing = await prisma_1.prisma.user.findUnique({ where: { id: userId } });
        if (!existing) {
            return res.status(404).json({ success: false, error: "User not found" });
        }
        const meta = (0, userAccessStore_1.getUserAccessMeta)(userId);
        const resolvedRole = (appRole || meta?.appRole || "Viewer");
        const permissions = resolvedRole === "Owner"
            ? (0, userPermissions_1.permissionsForRole)("Owner")
            : (0, userPermissions_1.mergePermissions)(permissionsInput || meta?.permissions || (0, userPermissions_1.permissionsForRole)(resolvedRole));
        (0, userAccessStore_1.setUserAccessMeta)(userId, {
            schoolId: existing.schoolId,
            firstName: meta?.firstName || splitFullName(existing.fullName).firstName,
            surname: meta?.surname || splitFullName(existing.fullName).surname,
            appRole: resolvedRole,
            permissions,
            lastLoginAt: meta?.lastLoginAt || null,
        });
        if (resolvedRole !== meta?.appRole) {
            await prisma_1.prisma.user.update({
                where: { id: userId },
                data: { role: (0, userPermissions_1.prismaRoleForAppRole)(resolvedRole) },
            });
        }
        const savedMeta = (0, userAccessStore_1.getUserAccessMeta)(userId);
        return res.json({
            success: true,
            user: serializeUser({
                ...existing,
                role: (0, userPermissions_1.prismaRoleForAppRole)(resolvedRole),
                createdAt: existing.createdAt,
            }, savedMeta),
        });
    }
    catch (error) {
        console.error("[users] PATCH /:id/permissions failed:", error);
        return res.status(500).json({
            success: false,
            error: formatApiError(error, "Failed to save permissions"),
        });
    }
});
router.post("/:id/reset-password", async (req, res) => {
    try {
        const userId = String(req.params.id || "").trim();
        const password = String(req.body?.password || req.body?.newPassword || "").trim();
        if (!password || password.length < 8) {
            return res.status(400).json({
                success: false,
                error: "New password is required (minimum 8 characters)",
            });
        }
        const existing = await prisma_1.prisma.user.findUnique({ where: { id: userId } });
        if (!existing) {
            return res.status(404).json({ success: false, error: "User not found" });
        }
        const passwordHash = await bcryptjs_1.default.hash(password, 10);
        await prisma_1.prisma.user.update({
            where: { id: userId },
            data: { passwordHash },
        });
        return res.json({ success: true, message: "Password reset successfully" });
    }
    catch (error) {
        console.error("[users] POST /:id/reset-password failed:", error);
        return res.status(500).json({
            success: false,
            error: formatApiError(error, "Failed to reset password"),
        });
    }
});
router.delete("/:id", async (req, res) => {
    try {
        const userId = String(req.params.id || "").trim();
        const existing = await prisma_1.prisma.user.findUnique({ where: { id: userId } });
        if (!existing) {
            return res.status(404).json({ success: false, error: "User not found" });
        }
        const meta = (0, userAccessStore_1.getUserAccessMeta)(userId);
        if (meta?.appRole === "Owner") {
            const owners = await countActiveOwners(existing.schoolId, userId);
            if (owners < 1) {
                return res.status(400).json({
                    success: false,
                    error: "Cannot delete the last active Owner for this school",
                });
            }
        }
        await prisma_1.prisma.user.delete({ where: { id: userId } });
        (0, userAccessStore_1.deleteUserAccessMeta)(userId);
        return res.json({ success: true });
    }
    catch (error) {
        console.error("[users] DELETE /:id failed:", error);
        return res.status(500).json({ success: false, error: "Failed to delete user" });
    }
});
exports.default = router;
