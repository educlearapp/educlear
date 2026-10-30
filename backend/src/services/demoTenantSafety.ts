/**
 * Demo-tenant outbound safety.
 *
 * Trust source: School.isDemoTenant (boolean DB flag).
 * Never identify demos by name, email, or hardcoded school IDs.
 * Only Super Admin (or privileged seed scripts) may set the flag.
 */
import { prisma } from "../prisma";

export const DEMO_NOT_DELIVERED_LABEL = "DEMO — NOT DELIVERED";

export const DEMO_EMAIL_SIMULATED_PREFIX = "demo-not-delivered";

export type DemoEmailSimulationResult = {
  messageId: string;
  accepted: string[];
  rejected: string[];
  response: string;
  demoSimulated: true;
  demoLabel: typeof DEMO_NOT_DELIVERED_LABEL;
};

export async function isDemoTenantSchool(schoolId: string): Promise<boolean> {
  const id = String(schoolId || "").trim();
  if (!id) return false;
  const row = await prisma.school.findUnique({
    where: { id },
    select: { isDemoTenant: true },
  });
  return row?.isDemoTenant === true;
}

/** Build a simulated successful email send — never contacts Resend/SMTP. */
export function buildDemoEmailSimulation(to: string | string[]): DemoEmailSimulationResult {
  const recipients = Array.isArray(to)
    ? to.map(String).map((s) => s.trim()).filter(Boolean)
    : [String(to || "").trim()].filter(Boolean);
  const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return {
    messageId: `${DEMO_EMAIL_SIMULATED_PREFIX}:${token}`,
    accepted: recipients,
    rejected: [],
    response: DEMO_NOT_DELIVERED_LABEL,
    demoSimulated: true,
    demoLabel: DEMO_NOT_DELIVERED_LABEL,
  };
}

export function labelDemoEmailSubject(subject: string): string {
  const raw = String(subject || "").trim();
  if (!raw) return DEMO_NOT_DELIVERED_LABEL;
  if (raw.includes(DEMO_NOT_DELIVERED_LABEL)) return raw;
  return `[${DEMO_NOT_DELIVERED_LABEL}] ${raw}`;
}

/**
 * Persist isDemoTenant. Caller must already be authorised as platform Super Admin.
 * School-scoped Owner/Admin must never invoke this.
 */
export async function setSchoolDemoTenantFlag(opts: {
  schoolId: string;
  isDemoTenant: boolean;
  actorUserId: string;
  actorEmail: string;
}): Promise<{ schoolId: string; isDemoTenant: boolean }> {
  const schoolId = String(opts.schoolId || "").trim();
  if (!schoolId) throw new Error("Missing schoolId");
  const next = opts.isDemoTenant === true;
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { id: true, isDemoTenant: true, name: true },
  });
  if (!school) throw new Error("School not found");

  if (school.isDemoTenant === next) {
    return { schoolId: school.id, isDemoTenant: school.isDemoTenant };
  }

  await prisma.school.update({
    where: { id: school.id },
    data: { isDemoTenant: next },
  });

  console.info(
    `[demo-tenant] school=${school.id} isDemoTenant ${school.isDemoTenant}→${next} by=${opts.actorEmail}`
  );

  return { schoolId: school.id, isDemoTenant: next };
}
