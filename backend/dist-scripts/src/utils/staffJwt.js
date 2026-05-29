"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.STAFF_JWT_SECRET = void 0;
exports.verifyStaffJwt = verifyStaffJwt;
exports.normalizeStaffEmail = normalizeStaffEmail;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
exports.STAFF_JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";
function verifyStaffJwt(authHeader) {
    if (!authHeader?.startsWith("Bearer "))
        return null;
    try {
        return jsonwebtoken_1.default.verify(authHeader.slice(7), exports.STAFF_JWT_SECRET);
    }
    catch {
        return null;
    }
}
function normalizeStaffEmail(email) {
    return String(email || "").trim().toLowerCase();
}
