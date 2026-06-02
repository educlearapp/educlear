/** Built-in platform super admins — always honored in addition to SUPER_ADMIN_EMAILS. */
export const DEFAULT_PLATFORM_SUPER_ADMIN_EMAILS = [
  "info@educlear.co.za",
] as const;

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
  const fromEnv = stripEnvQuotes(String(raw ?? process.env.SUPER_ADMIN_EMAILS ?? ""))
    .split(",")
    .map((entry) => normalizeSuperAdminEmail(stripEnvQuotes(entry)))
    .filter(Boolean);
  const merged = new Set<string>([...DEFAULT_PLATFORM_SUPER_ADMIN_EMAILS, ...fromEnv]);
  return [...merged];
}

export function isPlatformSuperAdminEmail(email: string): boolean {
  const allowed = parseSuperAdminEmails();
  return allowed.includes(normalizeSuperAdminEmail(email));
}
