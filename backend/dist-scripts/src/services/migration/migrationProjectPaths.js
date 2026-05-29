"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMigrationStagingRoot = getMigrationStagingRoot;
exports.ensureMigrationStagingRoot = ensureMigrationStagingRoot;
exports.migrationProjectRoot = migrationProjectRoot;
exports.migrationProjectUploadsDir = migrationProjectUploadsDir;
exports.migrationProjectAuditsDir = migrationProjectAuditsDir;
exports.migrationSchoolBackupsDir = migrationSchoolBackupsDir;
exports.migrationProjectManifestPath = migrationProjectManifestPath;
exports.getAllowedMigrationReadRoots = getAllowedMigrationReadRoots;
exports.resolveSafeMigrationReadPath = resolveSafeMigrationReadPath;
exports.loadMigrationProjectManifest = loadMigrationProjectManifest;
exports.saveMigrationProjectManifest = saveMigrationProjectManifest;
exports.storeUploadedFile = storeUploadedFile;
exports.extractZipToUploads = extractZipToUploads;
exports.appendFilesToManifest = appendFilesToManifest;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
const STAGING_ROOT = path_1.default.join(process.cwd(), "uploads", "migration-staging");
function getMigrationStagingRoot() {
    return STAGING_ROOT;
}
function ensureMigrationStagingRoot() {
    if (!fs_1.default.existsSync(STAGING_ROOT)) {
        fs_1.default.mkdirSync(STAGING_ROOT, { recursive: true });
    }
    return STAGING_ROOT;
}
function migrationProjectRoot(schoolId, projectId) {
    return path_1.default.join(STAGING_ROOT, schoolId, projectId);
}
function migrationProjectUploadsDir(schoolId, projectId) {
    return path_1.default.join(migrationProjectRoot(schoolId, projectId), "uploads");
}
function migrationProjectAuditsDir(schoolId, projectId) {
    return path_1.default.join(migrationProjectRoot(schoolId, projectId), "audits");
}
function migrationSchoolBackupsDir(schoolId) {
    return path_1.default.join(STAGING_ROOT, schoolId, "backups");
}
function migrationProjectManifestPath(schoolId, projectId) {
    return path_1.default.join(migrationProjectRoot(schoolId, projectId), "manifest.json");
}
/** Allowed read roots for staged migration files (universal + project staging). */
function getAllowedMigrationReadRoots() {
    const roots = [
        path_1.default.resolve(STAGING_ROOT),
        path_1.default.resolve(process.cwd(), "storage", "migration-staging"),
        path_1.default.resolve(process.cwd(), "..", "storage", "migration-staging"),
    ];
    return [...new Set(roots)];
}
function resolveSafeMigrationReadPath(filePath) {
    const resolved = path_1.default.resolve(String(filePath || ""));
    const allowed = getAllowedMigrationReadRoots();
    if (!allowed.some((root) => resolved === root || resolved.startsWith(root + path_1.default.sep))) {
        throw new Error("Migration file path is outside allowed staging directories");
    }
    return resolved;
}
function loadMigrationProjectManifest(schoolId, projectId) {
    const manifestPath = migrationProjectManifestPath(schoolId, projectId);
    if (!fs_1.default.existsSync(manifestPath))
        return null;
    const raw = fs_1.default.readFileSync(manifestPath, "utf8");
    return JSON.parse(raw);
}
function saveMigrationProjectManifest(manifest) {
    const dir = migrationProjectRoot(manifest.schoolId, manifest.projectId);
    fs_1.default.mkdirSync(dir, { recursive: true });
    fs_1.default.mkdirSync(migrationProjectUploadsDir(manifest.schoolId, manifest.projectId), {
        recursive: true,
    });
    fs_1.default.mkdirSync(migrationProjectAuditsDir(manifest.schoolId, manifest.projectId), {
        recursive: true,
    });
    manifest.updatedAt = new Date().toISOString();
    fs_1.default.writeFileSync(migrationProjectManifestPath(manifest.schoolId, manifest.projectId), JSON.stringify(manifest, null, 2), "utf8");
}
function storeUploadedFile(schoolId, projectId, originalFilename, tempPath) {
    const uploadsDir = migrationProjectUploadsDir(schoolId, projectId);
    fs_1.default.mkdirSync(uploadsDir, { recursive: true });
    const safeName = String(originalFilename || "upload").replace(/[^a-zA-Z0-9._-]/g, "_");
    let dest = path_1.default.join(uploadsDir, safeName);
    if (fs_1.default.existsSync(dest)) {
        const ext = path_1.default.extname(safeName);
        const base = path_1.default.basename(safeName, ext);
        dest = path_1.default.join(uploadsDir, `${base}-${Date.now()}${ext}`);
    }
    fs_1.default.renameSync(tempPath, dest);
    return dest;
}
function extractZipToUploads(schoolId, projectId, zipPath) {
    const uploadsDir = migrationProjectUploadsDir(schoolId, projectId);
    fs_1.default.mkdirSync(uploadsDir, { recursive: true });
    const resolved = resolveSafeMigrationReadPath(zipPath);
    (0, child_process_1.execSync)(`unzip -q -o ${JSON.stringify(resolved)} -d ${JSON.stringify(uploadsDir)}`, {
        stdio: "pipe",
    });
    const extracted = [];
    const walk = (dir) => {
        for (const entry of fs_1.default.readdirSync(dir, { withFileTypes: true })) {
            const full = path_1.default.join(dir, entry.name);
            if (entry.isDirectory())
                walk(full);
            else if (/\.(csv|xls|xlsx)$/i.test(entry.name))
                extracted.push(full);
        }
    };
    walk(uploadsDir);
    return extracted;
}
function appendFilesToManifest(manifest, files) {
    const byId = new Map(manifest.files.map((f) => [f.fileId, f]));
    for (const f of files)
        byId.set(f.fileId, f);
    return { ...manifest, files: [...byId.values()] };
}
