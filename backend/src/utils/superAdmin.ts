/** The only account allowed into EduClear platform Super Admin. */
export const PLATFORM_SUPER_ADMIN_EMAIL = "info@educlear.co.za";

export function normalizeSuperAdminEmail(email: unknown): string {
  return String(email || "").trim().toLowerCase();
}

export function parseSuperAdminEmails(raw?: string): string[] {
  void raw;
  return [PLATFORM_SUPER_ADMIN_EMAIL];
}

export function isPlatformSuperAdminEmail(email: string): boolean {
  return normalizeSuperAdminEmail(email) === PLATFORM_SUPER_ADMIN_EMAIL;
}
