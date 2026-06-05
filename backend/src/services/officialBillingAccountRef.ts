import { prisma } from "../prisma";
import { isKidESysSourceAccountRef } from "./daSilvaMigration/ageAnalysisParser";
import { readSchoolFamilyAccountAgeAnalysisSnapshots } from "../utils/familyAccountAgeAnalysisStore";
import { resolveLearnerAccountNo } from "../utils/learnerIdentity";

export function normaliseOfficialBillingAccountRef(value: unknown): string {
  const ref = String(value ?? "").trim().toUpperCase();
  if (!ref || !isKidESysSourceAccountRef(ref)) return "";
  return ref;
}

/** Kid-e-Sys age-analysis snapshot account refs — authoritative billing list when non-empty. */
export function readOfficialBillingAccountRefs(schoolId: string): Set<string> {
  const snapshots = readSchoolFamilyAccountAgeAnalysisSnapshots(schoolId);
  const refs = new Set<string>();
  for (const key of Object.keys(snapshots || {})) {
    const ref = normaliseOfficialBillingAccountRef(key);
    if (ref) refs.add(ref);
  }
  return refs;
}

type ResolveOpts = {
  learnerId?: string;
  accountNo?: string;
  learner?: {
    familyAccount?: { accountRef?: string | null } | null;
    admissionNo?: string | null;
    accountNo?: string | null;
    accountNumber?: string | null;
  } | null;
};

/**
 * Resolve posting account ref: prefer family billing account on the official list,
 * never an orphan admission-style ref when snapshots exist.
 */
export async function resolveOfficialBillingAccountRef(
  schoolId: string,
  opts: ResolveOpts = {}
): Promise<string> {
  const sid = String(schoolId || "").trim();
  const official = readOfficialBillingAccountRefs(sid);
  const candidates: string[] = [];

  const familyFromRow = normaliseOfficialBillingAccountRef(
    opts.learner?.familyAccount?.accountRef
  );
  if (familyFromRow) candidates.push(familyFromRow);

  const learnerId = String(opts.learnerId || "").trim();
  if (learnerId && sid) {
    const learner =
      opts.learner ??
      (await prisma.learner.findFirst({
        where: { id: learnerId, schoolId: sid },
        select: {
          familyAccount: { select: { accountRef: true } },
          admissionNo: true,
        },
      }));
    const familyRef = normaliseOfficialBillingAccountRef(learner?.familyAccount?.accountRef);
    if (familyRef && !candidates.includes(familyRef)) candidates.unshift(familyRef);
    const fallback = normaliseOfficialBillingAccountRef(resolveLearnerAccountNo(learner));
    if (fallback && !candidates.includes(fallback)) candidates.push(fallback);
  }

  const direct = normaliseOfficialBillingAccountRef(opts.accountNo);
  if (direct && !candidates.includes(direct)) candidates.push(direct);

  if (!official.size) {
    return candidates.find(Boolean) || "";
  }

  for (const ref of candidates) {
    if (official.has(ref)) return ref;
  }

  return "";
}

export function assertOfficialBillingAccountRef(schoolId: string, accountRef: string): void {
  const ref = normaliseOfficialBillingAccountRef(accountRef);
  if (!ref) {
    throw new Error("Invalid or missing Kid-e-Sys billing account ref");
  }
  const official = readOfficialBillingAccountRefs(schoolId);
  if (official.size > 0 && !official.has(ref)) {
    throw new Error(
      `Account ${ref} is not on the official billing account list (${official.size} age-analysis accounts)`
    );
  }
}
