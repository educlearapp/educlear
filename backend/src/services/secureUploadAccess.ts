/**
 * Shared helpers for private upload directories under uploads/.
 * Public HTTP static serving is denied; authorised APIs stream files.
 */
import fs from "fs";
import path from "path";

export const SECURE_DOWNLOAD_HEADERS: Record<string, string> = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
  "X-Content-Type-Options": "nosniff",
};

export function safeUploadBasename(raw: string | null | undefined): string | null {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return null;
  if (trimmed.includes("\0") || trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\")) {
    return null;
  }
  const base = path.basename(trimmed);
  if (!base || base !== trimmed || base === "." || base === "..") return null;
  if (!/^[A-Za-z0-9._-]+$/.test(base)) return null;
  return base;
}

export function resolveUnderUploadDir(
  uploadDir: string,
  rawName: string | null | undefined
): string | null {
  const base = safeUploadBasename(rawName);
  if (!base) return null;
  const abs = path.resolve(uploadDir, base);
  const root = path.resolve(uploadDir);
  if (!abs.startsWith(root + path.sep) && abs !== root) return null;
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
  return abs;
}

export function basenameFromPrefixedUrl(
  fileUrl: string | null | undefined,
  publicPrefix: string
): string | null {
  const u = String(fileUrl || "").trim();
  if (!u) return null;
  const idx = u.indexOf(publicPrefix);
  const relative = idx >= 0 ? u.slice(idx + publicPrefix.length) : path.basename(u.split("?")[0]);
  return safeUploadBasename(relative.split("?")[0]);
}

export function internalUploadUrl(publicPrefix: string, filename: string): string {
  const base = safeUploadBasename(filename);
  if (!base) throw new Error("Invalid upload filename");
  return `${publicPrefix}${base}`;
}

/** Redact public attachment URLs; expose authenticated downloadPath by index. */
export function redactAttachmentUrls(
  attachments: unknown,
  opts: { downloadBasePath: string; publicPrefix?: string }
): unknown {
  if (!Array.isArray(attachments)) return attachments ?? null;
  return attachments.map((a, index) => {
    if (!a || typeof a !== "object") return a;
    const row = a as Record<string, unknown>;
    const { url: _u, ...rest } = row;
    void _u;
    return {
      ...rest,
      url: null,
      downloadPath: `${opts.downloadBasePath}/${index}`,
      fileKey:
        opts.publicPrefix && row.url
          ? basenameFromPrefixedUrl(String(row.url), opts.publicPrefix)
          : null,
    };
  });
}

export function attachmentAtIndex(
  attachments: unknown,
  indexRaw: string | number
): { name: string; url: string; mimeType?: string } | null {
  const index = typeof indexRaw === "number" ? indexRaw : Number(indexRaw);
  if (!Number.isInteger(index) || index < 0) return null;
  if (!Array.isArray(attachments) || index >= attachments.length) return null;
  const a = attachments[index];
  if (!a || typeof a !== "object") return null;
  const row = a as Record<string, unknown>;
  return {
    name: String(row.name || "attachment"),
    url: String(row.url || ""),
    mimeType: row.mimeType ? String(row.mimeType) : undefined,
  };
}
