export function looksLikeHtmlOrPlaintextRouteError(message: string): boolean {
  const t = message.trim();
  if (t.startsWith("<!DOCTYPE") || t.startsWith("<!doctype")) return true;
  if (t.includes("<html") || t.includes("<HTML")) return true;
  if (/Cannot\s+GET\s+\//i.test(t)) return true;
  if (/Internal Server Error/i.test(t) && t.includes("<")) return true;
  return false;
}

/** Map API / proxy errors to a clean teacher-portal upload message. */
export function formatTeacherUploadError(message: string): string {
  if (looksLikeHtmlOrPlaintextRouteError(message)) {
    return "Upload failed. Please try again.";
  }
  const m = message.trim();
  if (!m) return "Upload failed. Please try again.";
  if (/file too large|maximum file size is 12\s*mb/i.test(m)) {
    return "File too large. Maximum file size is 12 MB.";
  }
  if (/too many files|attach up to 5/i.test(m)) {
    return "You can attach up to 5 files.";
  }
  return m;
}
