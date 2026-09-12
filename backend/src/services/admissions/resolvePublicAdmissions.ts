/**
 * Resolve school + admissions settings from publicSlug only (never client schoolId).
 */
import type { PrismaClient, School, SchoolAdmissionsSettings } from "@prisma/client";

export class PublicAdmissionsError extends Error {
  readonly statusCode: number;
  readonly code: string;
  constructor(message: string, statusCode: number, code: string) {
    super(message);
    this.name = "PublicAdmissionsError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export type ResolvedPublicAdmissions = {
  school: Pick<School, "id" | "name" | "logoUrl" | "primaryColor">;
  settings: SchoolAdmissionsSettings;
};

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v ?? "").trim()).filter(Boolean);
}

export function isAdmissionsWindowOpen(
  settings: Pick<SchoolAdmissionsSettings, "applicationsOpenAt" | "applicationsCloseAt">,
  now: Date = new Date()
): boolean {
  const openAt = settings.applicationsOpenAt;
  const closeAt = settings.applicationsCloseAt;
  if (openAt && now < openAt) return false;
  if (closeAt && now > closeAt) return false;
  return true;
}

export function gradeIsAccepted(settings: SchoolAdmissionsSettings, grade: string | null | undefined): boolean {
  const g = String(grade || "").trim();
  if (!g) return false;
  const allowed = asStringArray(settings.acceptedGrades);
  if (allowed.length === 0) return true; // no restriction configured yet
  return allowed.some((a) => a.toLowerCase() === g.toLowerCase());
}

export async function resolvePublicAdmissionsBySlug(
  prisma: PrismaClient,
  schoolSlug: string
): Promise<ResolvedPublicAdmissions> {
  const slug = String(schoolSlug || "")
    .trim()
    .toLowerCase();
  if (!slug) {
    throw new PublicAdmissionsError("Admissions not found", 404, "ADMISSIONS_NOT_FOUND");
  }

  const settings = await prisma.schoolAdmissionsSettings.findUnique({
    where: { publicSlug: slug },
    include: {
      school: { select: { id: true, name: true, logoUrl: true, primaryColor: true } },
    },
  });

  if (!settings?.school) {
    throw new PublicAdmissionsError("Admissions not found", 404, "ADMISSIONS_NOT_FOUND");
  }

  return {
    school: settings.school,
    settings,
  };
}

export function assertAdmissionsAcceptingApplications(
  settings: SchoolAdmissionsSettings,
  opts?: { now?: Date; requireEnabled?: boolean }
) {
  const requireEnabled = opts?.requireEnabled !== false;
  if (requireEnabled && !settings.enabled) {
    throw new PublicAdmissionsError("Admissions are not open", 403, "ADMISSIONS_CLOSED");
  }
  if (!isAdmissionsWindowOpen(settings, opts?.now || new Date())) {
    throw new PublicAdmissionsError("Admissions are not open", 403, "ADMISSIONS_CLOSED");
  }
}

export { asStringArray };
