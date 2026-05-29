"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUserAccessMeta = getUserAccessMeta;
exports.setUserAccessMeta = setUserAccessMeta;
exports.deleteUserAccessMeta = deleteUserAccessMeta;
exports.listAccessMetaForSchool = listAccessMetaForSchool;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const userPermissions_1 = require("./userPermissions");
const ACCESS_FILE = path_1.default.join(process.cwd(), "data", "user-access.json");
function ensureStore() {
    const dir = path_1.default.dirname(ACCESS_FILE);
    if (!fs_1.default.existsSync(dir))
        fs_1.default.mkdirSync(dir, { recursive: true });
    if (!fs_1.default.existsSync(ACCESS_FILE)) {
        fs_1.default.writeFileSync(ACCESS_FILE, JSON.stringify({ users: {} }, null, 2), "utf8");
    }
}
function readStore() {
    ensureStore();
    try {
        const parsed = JSON.parse(fs_1.default.readFileSync(ACCESS_FILE, "utf8"));
        if (parsed && typeof parsed === "object" && parsed.users) {
            return { users: parsed.users };
        }
    }
    catch {
    }
    return { users: {} };
}
function writeStore(store) {
    ensureStore();
    fs_1.default.writeFileSync(ACCESS_FILE, JSON.stringify(store, null, 2), "utf8");
}
function getUserAccessMeta(userId) {
    const store = readStore();
    return store.users[userId] || null;
}
function setUserAccessMeta(userId, meta) {
    const store = readStore();
    const appRole = String(meta.appRole || "Viewer");
    const permissions = appRole === "Owner"
        ? (0, userPermissions_1.permissionsForRole)("Owner")
        : appRole === "Custom"
            ? (0, userPermissions_1.mergePermissions)(meta.permissions)
            : (0, userPermissions_1.permissionsForRole)(appRole, meta.permissions);
    store.users[userId] = {
        ...meta,
        appRole,
        permissions,
    };
    writeStore(store);
}
function deleteUserAccessMeta(userId) {
    const store = readStore();
    delete store.users[userId];
    writeStore(store);
}
function listAccessMetaForSchool(schoolId) {
    const store = readStore();
    const out = {};
    for (const [userId, meta] of Object.entries(store.users)) {
        if (meta.schoolId === schoolId)
            out[userId] = meta;
    }
    return out;
}
