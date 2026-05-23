export function normalizeSuperAdminEmail(email: unknown): string {
  return String(email || "").trim().toLowerCase();
}

function stripEnvQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

export function parseSuperAdminEmails(raw?: string): string[] {
  return stripEnvQuotes(String(raw ?? process.env.SUPER_ADMIN_EMAILS ?? ""))
    .split(",")
    .map((entry) => normalizeSuperAdminEmail(stripEnvQuotes(entry)))
    .filter(Boolean);
}

export function isPlatformSuperAdminEmail(email: string): boolean {
  const allowed = parseSuperAdminEmails();
  return allowed.includes(normalizeSuperAdminEmail(email));
}
