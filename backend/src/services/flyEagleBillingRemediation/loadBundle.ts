/**
 * Load a Fly-Eagle-scoped school bundle from Prisma + on-disk ledger/snapshots.
 * READ-ONLY. Hard-fails if schoolId is not Fly Eagle.
 */
import type { PrismaClient } from "@prisma/client";

import { assertFlyEagleSchoolId, FLY_EAGLE_SCHOOL_ID, FLY_EAGLE_SCHOOL_NAME } from "./constants";
import { isoOrNull } from "./normalize";
import type {
  FlyEagleSchoolBundle,
  RemediationAuditEntry,
  RemediationLedgerEntry,
  RemediationSnapshot,
} from "./types";

type LoadOpts = {
  prisma: PrismaClient;
  schoolId?: string;
  /** Ledger rows for this school (already filtered). */
  ledger?: RemediationLedgerEntry[];
  ageAnalysisByRef?: Record<string, RemediationSnapshot | undefined>;
  audit?: RemediationAuditEntry[];
  capturedAt?: string;
};

export async function loadFlyEagleSchoolBundle(opts: LoadOpts): Promise<FlyEagleSchoolBundle> {
  const schoolId = String(opts.schoolId || FLY_EAGLE_SCHOOL_ID).trim();
  assertFlyEagleSchoolId(schoolId);

  const school = await opts.prisma.school.findUnique({
    where: { id: schoolId },
    select: { id: true, name: true },
  });
  if (!school) {
    throw new Error(`Fly Eagle school not found in database: ${schoolId}`);
  }

  const [learners, familyAccounts, parents, parentLearnerLinks] = await Promise.all([
    opts.prisma.learner.findMany({
      where: { schoolId },
      select: {
        id: true,
        schoolId: true,
        firstName: true,
        lastName: true,
        enrollmentStatus: true,
        className: true,
        grade: true,
        familyAccountId: true,
        admissionNo: true,
        birthDate: true,
        createdAt: true,
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    }),
    opts.prisma.familyAccount.findMany({
      where: { schoolId },
      select: {
        id: true,
        schoolId: true,
        accountRef: true,
        accountNo: true,
        familyName: true,
        createdAt: true,
        retiredAt: true,
        mergedIntoFamilyAccountId: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    opts.prisma.parent.findMany({
      where: { schoolId },
      select: {
        id: true,
        schoolId: true,
        familyAccountId: true,
        firstName: true,
        surname: true,
        cellNo: true,
        email: true,
        idNumber: true,
      },
    }),
    opts.prisma.parentLearnerLink.findMany({
      where: { schoolId },
      select: { parentId: true, learnerId: true, schoolId: true },
    }),
  ]);

  return {
    schoolId,
    schoolName: school.name || FLY_EAGLE_SCHOOL_NAME,
    capturedAt: opts.capturedAt || new Date().toISOString(),
    learners: learners.map((l) => ({
      ...l,
      enrollmentStatus: String(l.enrollmentStatus || "ACTIVE"),
      birthDate: isoOrNull(l.birthDate),
      createdAt: isoOrNull(l.createdAt),
    })),
    familyAccounts: familyAccounts.map((fa) => ({
      ...fa,
      createdAt: isoOrNull(fa.createdAt),
      retiredAt: isoOrNull(fa.retiredAt),
    })),
    parents,
    parentLearnerLinks,
    ledger: opts.ledger || [],
    ageAnalysisByRef: opts.ageAnalysisByRef || {},
    audit: opts.audit || [],
  };
}
