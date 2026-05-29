"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeAuthEmail = exports.AUTH_BCRYPT_ROUNDS = void 0;
exports.hashAuthPassword = hashAuthPassword;
exports.compareAuthPassword = compareAuthPassword;
exports.isValidBcryptHash = isValidBcryptHash;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const superAdmin_1 = require("../utils/superAdmin");
/** Rounds used by POST /auth/login, register-school, seed, and repair scripts. */
exports.AUTH_BCRYPT_ROUNDS = 10;
exports.normalizeAuthEmail = superAdmin_1.normalizeSuperAdminEmail;
async function hashAuthPassword(plain) {
    return bcryptjs_1.default.hash(String(plain || ""), exports.AUTH_BCRYPT_ROUNDS);
}
async function compareAuthPassword(plain, hash) {
    if (!plain || !hash)
        return false;
    return bcryptjs_1.default.compare(String(plain), String(hash));
}
function isValidBcryptHash(hash) {
    const h = String(hash || "");
    return h.length === 60 && h.startsWith("$2");
}
