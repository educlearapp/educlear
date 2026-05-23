export function normalizeSuperAdminEmail(email: unknown): string {
  return String(email || "").trim().toLowerCase();
}

export function parseSuperAdminEmails(raw?: string): string[] {
  return String(raw ?? process.env.SUPER_ADMIN_EMAILS ?? "")
    .split(",")
    .map((entry) => normalizeSuperAdminEmail(entry))
    .filter(Boolean);
}

export function isPlatformSuperAdminEmail(email: string): boolean {
  const allowed = parseSuperAdminEmails();
  return allowed.includes(normalizeSuperAdminEmail(email));
}
