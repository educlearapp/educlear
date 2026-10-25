/**
 * Secure access helpers for files under uploads/teacher-app.
 * Files stay on disk; public static serving is denied — clients use authenticated APIs.
 */
import fs from "fs";
import path from "path";

export const TEACHER_APP_UPLOAD_DIR = path.join(process.cwd(), "uploads/teacher-app");
export const TEACHER_APP_PUBLIC_PREFIX = "/uploads/teacher-app/";

/** Reject path traversal / forged names. Returns basename only. */
export function safeTeacherAppBasename(raw: string | null | undefined): string | null {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return null;
  if (trimmed.includes("\0") || trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\")) {
    return null;
  }
  const base = path.basename(trimmed);
  if (!base || base !== trimmed || base === "." || base === "..") return null;
  // Multer names: <digits>-<digits>.<ext>
  if (!/^[A-Za-z0-9._-]+$/.test(base)) return null;
  return base;
}

/** Absolute path under teacher-app upload dir, or null if unsafe / missing. */
export function resolveTeacherAppAbsolutePath(rawName: string | null | undefined): string | null {
  const base = safeTeacherAppBasename(rawName);
  if (!base) return null;
  const abs = path.resolve(TEACHER_APP_UPLOAD_DIR, base);
  const root = path.resolve(TEACHER_APP_UPLOAD_DIR);
  if (!abs.startsWith(root + path.sep) && abs !== root) return null;
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
  return abs;
}

/** Extract stored teacher-app basename from a legacy absolute or relative fileUrl. */
export function basenameFromTeacherAppFileUrl(fileUrl: string | null | undefined): string | null {
  const u = String(fileUrl || "").trim();
  if (!u) return null;
  const marker = TEACHER_APP_PUBLIC_PREFIX;
  const idx = u.indexOf(marker);
  const relative = idx >= 0 ? u.slice(idx + marker.length) : path.basename(u.split("?")[0]);
  return safeTeacherAppBasename(relative.split("?")[0]);
}

/** Internal storage form — never a fully-qualified public CDN URL. */
export function internalTeacherAppFileUrl(filename: string): string {
  const base = safeTeacherAppBasename(filename);
  if (!base) throw new Error("Invalid upload filename");
  return `${TEACHER_APP_PUBLIC_PREFIX}${base}`;
}

export function parentDocumentDownloadPath(documentId: string): string {
  return `/api/parent-portal/documents/${encodeURIComponent(documentId)}/file`;
}

export function staffDocumentDownloadPath(documentId: string, schoolId: string): string {
  return `/api/school-parent-documents/${encodeURIComponent(documentId)}/file?schoolId=${encodeURIComponent(schoolId)}`;
}

export function teacherAppDocumentDownloadPath(documentId: string): string {
  return `/api/teacher-app/documents/${encodeURIComponent(documentId)}/file`;
}

/** Strip public fileUrl from ParentDocument API payloads. */
export function publicParentDocumentDto<T extends { id: string; fileUrl?: string; fileName?: string | null }>(
  doc: T,
  opts: { audience: "parent" | "staff"; schoolId?: string }
) {
  const { fileUrl: _omit, ...rest } = doc as T & { fileUrl?: string };
  void _omit;
  const downloadPath =
    opts.audience === "parent"
      ? parentDocumentDownloadPath(doc.id)
      : opts.schoolId
        ? staffDocumentDownloadPath(doc.id, opts.schoolId)
        : teacherAppDocumentDownloadPath(doc.id);
  return {
    ...rest,
    downloadPath,
    /** @deprecated Never use for navigation — kept falsey so old clients do not hit public URLs. */
    fileUrl: null as string | null,
  };
}

/** Rewrite homework/notice attachment urls away from public static paths. */
export function redactTeacherAppAttachmentUrls(
  attachments: unknown,
  opts: { downloadBasePath: string }
): unknown {
  if (!Array.isArray(attachments)) return attachments ?? null;
  return attachments.map((a, index) => {
    if (!a || typeof a !== "object") return a;
    const row = a as Record<string, unknown>;
    const url = String(row.url || "");
    const name = basenameFromTeacherAppFileUrl(url);
    if (!name) {
      const { url: _u, ...rest } = row;
      void _u;
      return { ...rest, url: null, downloadPath: `${opts.downloadBasePath}/${index}` };
    }
    const { url: _u, ...rest } = row;
    void _u;
    return {
      ...rest,
      url: null,
      downloadPath: `${opts.downloadBasePath}/${index}`,
      fileKey: name,
    };
  });
}

export const SECURE_DOWNLOAD_HEADERS: Record<string, string> = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
  "X-Content-Type-Options": "nosniff",
};
