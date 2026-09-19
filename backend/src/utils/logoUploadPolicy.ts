/** Public school-registration logos and authenticated profile uploads. Images only. */
const ALLOWED_LOGO_TYPES: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

export function schoolLogoExtension(mimetype: string, originalName: string): string | null {
  const mime = String(mimetype || "").toLowerCase();
  const expected = ALLOWED_LOGO_TYPES[mime];
  if (!expected) return null;
  const nameExt = String(originalName || "")
    .toLowerCase()
    .match(/\.[a-z0-9]+$/)?.[0];
  if (!nameExt) return null;
  if (expected === ".jpg" && (nameExt === ".jpg" || nameExt === ".jpeg")) return nameExt;
  if (nameExt !== expected) return null;
  return expected;
}

export function isAllowedSchoolLogo(mimetype: string, originalName: string): boolean {
  return schoolLogoExtension(mimetype, originalName) !== null;
}
