"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeSchoolLogoUrl = normalizeSchoolLogoUrl;
exports.toStoredSchoolLogoUrl = toStoredSchoolLogoUrl;
exports.buildPublicSchoolLogoUrl = buildPublicSchoolLogoUrl;
exports.toAbsoluteSchoolLogoUrl = toAbsoluteSchoolLogoUrl;
exports.resolveUploadsFilePath = resolveUploadsFilePath;
exports.loadSchoolLogoBuffer = loadSchoolLogoBuffer;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
/** Trimmed logo URL from School.logoUrl, or undefined when empty. */
function normalizeSchoolLogoUrl(logoUrl) {
    const url = String(logoUrl || "").trim();
    return url || undefined;
}
/**
 * Persist only the uploads path in School.logoUrl so logos survive host/port changes.
 * External https URLs are kept as-is.
 */
function toStoredSchoolLogoUrl(logoUrl) {
    const url = String(logoUrl || "").trim();
    if (!url)
        return null;
    const uploadsIdx = url.indexOf("/uploads/");
    if (uploadsIdx >= 0)
        return url.slice(uploadsIdx);
    if (url.startsWith("/uploads/"))
        return url;
    if (url.startsWith("http://") || url.startsWith("https://")) {
        const parsed = resolveUploadsFilePath(url);
        if (parsed) {
            const rel = path_1.default.relative(path_1.default.join(process.cwd(), "uploads"), parsed).replace(/\\/g, "/");
            return `/uploads/${rel}`;
        }
        return url;
    }
    if (url.startsWith("uploads/"))
        return `/${url}`;
    return url;
}
function buildPublicSchoolLogoUrl(filename, baseUrl) {
    const base = baseUrl?.replace(/\/$/, "") ||
        process.env.PUBLIC_API_URL?.replace(/\/$/, "") ||
        `http://localhost:${process.env.PORT || 3000}`;
    const safeName = path_1.default.basename(String(filename || "").trim());
    return `${base}/uploads/school-logos/${safeName}`;
}
/** Absolute URL for clients/emails when DB stores a relative uploads path. */
function toAbsoluteSchoolLogoUrl(logoUrl, baseUrl) {
    const stored = normalizeSchoolLogoUrl(logoUrl);
    if (!stored)
        return undefined;
    if (stored.startsWith("http://") || stored.startsWith("https://"))
        return stored;
    const base = baseUrl?.replace(/\/$/, "") ||
        process.env.PUBLIC_API_URL?.replace(/\/$/, "") ||
        `http://localhost:${process.env.PORT || 3000}`;
    return `${base}${stored.startsWith("/") ? stored : `/${stored}`}`;
}
/** Resolve a logo URL to a local file under process.cwd()/uploads when possible. */
function resolveUploadsFilePath(logoUrl) {
    const url = String(logoUrl || "").trim();
    if (!url)
        return null;
    const uploadsIdx = url.indexOf("/uploads/");
    if (uploadsIdx >= 0) {
        const rel = url.slice(uploadsIdx + 1);
        const filePath = path_1.default.join(process.cwd(), rel);
        if (fs_1.default.existsSync(filePath))
            return filePath;
    }
    const relative = url.startsWith("/uploads/")
        ? url.replace(/^\//, "")
        : url.startsWith("uploads/")
            ? url
            : null;
    if (relative) {
        const filePath = path_1.default.join(process.cwd(), relative);
        if (fs_1.default.existsSync(filePath))
            return filePath;
    }
    const basename = path_1.default.basename(url.split("?")[0] || "");
    if (basename && basename !== url) {
        const logoPath = path_1.default.join(process.cwd(), "uploads", "school-logos", basename);
        if (fs_1.default.existsSync(logoPath))
            return logoPath;
    }
    return null;
}
/**
 * Loads school logo bytes for PDF/email generation.
 * Prefers on-disk uploads (same server) before HTTP fetch.
 */
async function loadSchoolLogoBuffer(logoUrl) {
    const url = normalizeSchoolLogoUrl(logoUrl);
    if (!url)
        return null;
    try {
        const localPath = resolveUploadsFilePath(url);
        if (localPath)
            return fs_1.default.readFileSync(localPath);
        const absolute = toAbsoluteSchoolLogoUrl(url);
        if (absolute && (absolute.startsWith("http://") || absolute.startsWith("https://"))) {
            const res = await fetch(absolute);
            if (!res.ok)
                return null;
            return Buffer.from(await res.arrayBuffer());
        }
    }
    catch {
        return null;
    }
    return null;
}
