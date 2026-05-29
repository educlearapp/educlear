"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.signParentToken = signParentToken;
exports.verifyParentToken = verifyParentToken;
exports.parentAuthMiddleware = parentAuthMiddleware;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";
function signParentToken(payload) {
    return jsonwebtoken_1.default.sign({ ...payload, role: "parent" }, JWT_SECRET, { expiresIn: "30d" });
}
function verifyParentToken(token) {
    try {
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        if (!decoded?.parentId || !decoded?.schoolId)
            return null;
        return {
            parentId: decoded.parentId,
            schoolId: decoded.schoolId,
            idNumber: decoded.idNumber,
        };
    }
    catch {
        return null;
    }
}
function parentAuthMiddleware(req, res, next) {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) {
        return res.status(401).json({ success: false, error: "Parent authentication required" });
    }
    const payload = verifyParentToken(token);
    if (!payload) {
        return res.status(401).json({ success: false, error: "Invalid or expired parent session" });
    }
    req.parentAuth = payload;
    next();
}
