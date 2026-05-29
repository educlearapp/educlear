"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUniversalMigrationStagingDir = getUniversalMigrationStagingDir;
exports.ensureUniversalMigrationStagingDir = ensureUniversalMigrationStagingDir;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
/** Raw untouched uploads — never overwrite originals. */
function getUniversalMigrationStagingDir() {
    const backendCwd = process.cwd();
    const underBackend = path_1.default.join(backendCwd, "storage", "migration-staging");
    if (fs_1.default.existsSync(path_1.default.join(backendCwd, "storage"))) {
        return underBackend;
    }
    return path_1.default.join(backendCwd, "..", "storage", "migration-staging");
}
function ensureUniversalMigrationStagingDir() {
    const dir = getUniversalMigrationStagingDir();
    if (!fs_1.default.existsSync(dir)) {
        fs_1.default.mkdirSync(dir, { recursive: true });
    }
    return dir;
}
