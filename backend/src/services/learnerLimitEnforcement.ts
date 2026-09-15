/**
 * Learner-capacity enforcement for commercial packages.
 *
 * Capacity is derived from commercial SKU metadata (Full ≤100 vs Full Unlimited)
 * using module entitlements + legacy STARTER/UNLIMITED capacity mapping.
 *
 * Enforcement is OFF unless ENFORCE_LEARNER_LIMITS=true.
 * When off, resolve helpers still expose capacity for Super Admin display.
 */
import { prisma } from "../prisma";
import {
  findCommercialPackageByModules,
  formatLearnerCapacityLabel,
  type EduClearCommercialPackage,
} from "./educlearCommercialPackages";
import {
  getSchoolModuleEntitlementsReadOnly,
  type SchoolModuleEntitlementsMap,
} from "./schoolModuleEntitlements";
import { activeLearnerWhere } from "../utils/learnerEnrollment";

export const LEARNER_LIMIT_ENFORCEMENT_ENV = "ENFORCE_LEARNER_LIMITS";

export function isLearnerLimitEnforcementEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const raw = String(env[LEARNER_LIMIT_ENFORCEMENT_ENV] || "")
    .trim()
    .toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

export type SchoolLearnerCapacity = {
  commercialPackageCode: string | null;
  commercialPackageName: string | null;
  commercialPackageShortLabel: string | null;
  learnerLimit: number | null;
  learnerCapacityLabel: string;
  activeLearnerCount: number;
  remainingSlots: number | null;
  atOrOverLimit: boolean;
  enforcementEnabled: boolean;
  moduleEntitlements: SchoolModuleEntitlementsMap;
  legacyCapacityPackageCode: string | null;
};

export async function loadSchoolLegacyCapacityCode(
  schoolId: string
): Promise<string | null> {
  const sid = String(schoolId || "").trim();
  if (!sid) return null;
  const sub = await prisma.schoolSubscription.findUnique({
    where: { schoolId: sid },
    select: { packageCode: true },
  });
  return sub?.packageCode ? String(sub.packageCode) : null;
}

export async function countActiveLearnersForSchool(schoolId: string): Promise<number> {
  const sid = String(schoolId || "").trim();
  if (!sid) return 0;
  return prisma.learner.count({ where: activeLearnerWhere(sid) });
}

export function resolvePackageForCapacity(
  entitlements: SchoolModuleEntitlementsMap,
  legacyCapacityPackageCode: string | null | undefined
): EduClearCommercialPackage | null {
  return findCommercialPackageByModules(entitlements, {
    legacyPackageCode: legacyCapacityPackageCode,
  });
}

export async function getSchoolLearnerCapacity(
  schoolId: string
): Promise<SchoolLearnerCapacity> {
  const sid = String(schoolId || "").trim();
  const moduleEntitlements = await getSchoolModuleEntitlementsReadOnly(sid);
  const legacyCapacityPackageCode = await loadSchoolLegacyCapacityCode(sid);
  const pkg = resolvePackageForCapacity(moduleEntitlements, legacyCapacityPackageCode);
  const activeLearnerCount = await countActiveLearnersForSchool(sid);
  const learnerLimit = pkg?.learnerLimit ?? null;
  const remainingSlots =
    learnerLimit == null ? null : Math.max(0, learnerLimit - activeLearnerCount);
  const atOrOverLimit = learnerLimit != null && activeLearnerCount >= learnerLimit;

  return {
    commercialPackageCode: pkg?.code ?? null,
    commercialPackageName: pkg?.name ?? null,
    commercialPackageShortLabel: pkg?.shortLabel ?? null,
    learnerLimit,
    learnerCapacityLabel: formatLearnerCapacityLabel(learnerLimit),
    activeLearnerCount,
    remainingSlots,
    atOrOverLimit,
    enforcementEnabled: isLearnerLimitEnforcementEnabled(),
    moduleEntitlements,
    legacyCapacityPackageCode,
  };
}

export type LearnerLimitGateResult =
  | { allowed: true; capacity: SchoolLearnerCapacity }
  | {
      allowed: false;
      capacity: SchoolLearnerCapacity;
      status: 403;
      code: "LEARNER_LIMIT_REACHED";
      error: string;
    };

/**
 * Gate learner creation/reactivation.
 * When enforcement is disabled, always allowed (capacity still returned).
 */
export async function assertLearnerCreateAllowed(
  schoolId: string
): Promise<LearnerLimitGateResult> {
  const capacity = await getSchoolLearnerCapacity(schoolId);
  if (!capacity.enforcementEnabled) {
    return { allowed: true, capacity };
  }
  if (!capacity.atOrOverLimit) {
    return { allowed: true, capacity };
  }
  const limit = capacity.learnerLimit ?? 0;
  return {
    allowed: false,
    capacity,
    status: 403,
    code: "LEARNER_LIMIT_REACHED",
    error: `Active learner limit reached (${capacity.activeLearnerCount}/${limit}) for ${
      capacity.commercialPackageShortLabel || "this package"
    }. Upgrade to Full Unlimited or disable ENFORCE_LEARNER_LIMITS on staging tests only.`,
  };
}
