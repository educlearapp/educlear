import fs from "fs";
import path from "path";

/** Trimmed logo URL from School.logoUrl, or undefined when empty. */
export function normalizeSchoolLogoUrl(logoUrl?: string | null): string | undefined {
  const url = String(logoUrl || "").trim();
  return url || undefined;
}

/**
 * Persist only the uploads path in School.logoUrl so logos survive host/port changes.
 * External https URLs are kept as-is.
 */
export function toStoredSchoolLogoUrl(logoUrl?: string | null): string | null {
  const url = String(logoUrl || "").trim();
  if (!url) return null;

  const uploadsIdx = url.indexOf("/uploads/");
  if (uploadsIdx >= 0) return url.slice(uploadsIdx);

  if (url.startsWith("/uploads/")) return url;

  if (url.startsWith("http://") || url.startsWith("https://")) {
    const parsed = resolveUploadsFilePath(url);
    if (parsed) {
      const rel = path.relative(path.join(process.cwd(), "uploads"), parsed).replace(/\\/g, "/");
      return `/uploads/${rel}`;
    }
    return url;
  }

  if (url.startsWith("uploads/")) return `/${url}`;

  return url;
}

export function buildPublicSchoolLogoUrl(filename: string, baseUrl?: string): string {
  const base =
    baseUrl?.replace(/\/$/, "") ||
    process.env.PUBLIC_API_URL?.replace(/\/$/, "") ||
    `http://localhost:${process.env.PORT || 3000}`;
  const safeName = path.basename(String(filename || "").trim());
  return `${base}/uploads/school-logos/${safeName}`;
}

/** Absolute URL for clients/emails when DB stores a relative uploads path. */
export function toAbsoluteSchoolLogoUrl(logoUrl?: string | null, baseUrl?: string): string | undefined {
  const stored = normalizeSchoolLogoUrl(logoUrl);
  if (!stored) return undefined;
  if (stored.startsWith("http://") || stored.startsWith("https://")) return stored;
  const base =
    baseUrl?.replace(/\/$/, "") ||
    process.env.PUBLIC_API_URL?.replace(/\/$/, "") ||
    `http://localhost:${process.env.PORT || 3000}`;
  return `${base}${stored.startsWith("/") ? stored : `/${stored}`}`;
}

/** Resolve a logo URL to a local file under process.cwd()/uploads when possible. */
export function resolveUploadsFilePath(logoUrl: string): string | null {
  const url = String(logoUrl || "").trim();
  if (!url) return null;

  const uploadsIdx = url.indexOf("/uploads/");
  if (uploadsIdx >= 0) {
    const rel = url.slice(uploadsIdx + 1);
    const filePath = path.join(process.cwd(), rel);
    if (fs.existsSync(filePath)) return filePath;
  }

  const relative = url.startsWith("/uploads/")
    ? url.replace(/^\//, "")
    : url.startsWith("uploads/")
      ? url
      : null;
  if (relative) {
    const filePath = path.join(process.cwd(), relative);
    if (fs.existsSync(filePath)) return filePath;
  }

  const basename = path.basename(url.split("?")[0] || "");
  if (basename && basename !== url) {
    const logoPath = path.join(process.cwd(), "uploads", "school-logos", basename);
    if (fs.existsSync(logoPath)) return logoPath;
  }

  return null;
}

/**
 * Loads school logo bytes for PDF/email generation.
 * Prefers on-disk uploads (same server) before HTTP fetch.
 */
export async function loadSchoolLogoBuffer(logoUrl?: string | null): Promise<Buffer | null> {
  const url = normalizeSchoolLogoUrl(logoUrl);
  if (!url) return null;

  try {
    const localPath = resolveUploadsFilePath(url);
    if (localPath) return fs.readFileSync(localPath);

    const absolute = toAbsoluteSchoolLogoUrl(url);
    if (absolute && (absolute.startsWith("http://") || absolute.startsWith("https://"))) {
      const res = await fetch(absolute);
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    }
  } catch {
    return null;
  }

  return null;
}
