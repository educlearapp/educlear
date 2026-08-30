import { prisma } from "../prisma";
import {
  isRetiredAgeAnalysisSnapshot,
  readSchoolFamilyAccountAgeAnalysisSnapshots,
} from "../utils/familyAccountAgeAnalysisStore";

export type CapturePaymentFamily = {
  id: string;
  schoolId: string;
  accountRef: string;
  familyName: string;
  learnerCount: number;
};

export type CapturePaymentFamilyDecision =
  | { ok: true; family: CapturePaymentFamily }
  | { ok: false; status: 400 | 403 | 404 | 409; error: string; code: string };

export function evaluateCapturePaymentFamily(input: {
  family: CapturePaymentFamily | null;
  authorizedSchoolId: string;
  retiredSnapshot?: boolean;
}): CapturePaymentFamilyDecision {
  const authorizedSchoolId = String(input.authorizedSchoolId || "").trim();
  if (!authorizedSchoolId) {
    return {
      ok: false,
      status: 403,
      error: "Missing school authorization",
      code: "MISSING_SCHOOL",
    };
  }
  if (!input.family) {
    return {
      ok: false,
      status: 404,
      error: "Family account not found",
      code: "FAMILY_ACCOUNT_NOT_FOUND",
    };
  }
  if (String(input.family.schoolId) !== authorizedSchoolId) {
    return {
      ok: false,
      status: 403,
      error: "Family account does not belong to the authenticated school",
      code: "CROSS_SCHOOL_FAMILY_ACCOUNT",
    };
  }
  if (input.retiredSnapshot) {
    return {
      ok: false,
      status: 409,
      error: "Family account is retired or merged and cannot receive payments",
      code: "FAMILY_ACCOUNT_RETIRED",
    };
  }
  if (input.family.learnerCount <= 0) {
    return {
      ok: false,
      status: 409,
      error: "Family account has no linked learners (retired or merged predecessor)",
      code: "FAMILY_ACCOUNT_RETIRED",
    };
  }
  return { ok: true, family: input.family };
}

export async function resolveCapturePaymentFamilyAccount(input: {
  familyAccountId: string;
  authorizedSchoolId: string;
}): Promise<CapturePaymentFamilyDecision> {
  const familyAccountId = String(input.familyAccountId || "").trim();
  const authorizedSchoolId = String(input.authorizedSchoolId || "").trim();
  if (!familyAccountId) {
    return {
      ok: false,
      status: 400,
      error: "Missing familyAccountId",
      code: "MISSING_FAMILY_ACCOUNT_ID",
    };
  }

  const row = await prisma.familyAccount.findUnique({
    where: { id: familyAccountId },
    select: {
      id: true,
      schoolId: true,
      accountRef: true,
      familyName: true,
      _count: { select: { learners: true } },
    },
  });

  const family: CapturePaymentFamily | null = row
    ? {
        id: row.id,
        schoolId: row.schoolId,
        accountRef: row.accountRef,
        familyName: row.familyName,
        learnerCount: row._count.learners,
      }
    : null;

  let retiredSnapshot = false;
  if (family && String(family.schoolId) === authorizedSchoolId) {
    const snaps = readSchoolFamilyAccountAgeAnalysisSnapshots(authorizedSchoolId);
    const ref = String(family.accountRef || "").trim().toUpperCase();
    const snap = snaps[ref] || Object.values(snaps).find(
      (s) => String(s.accountRef || "").trim().toUpperCase() === ref
    );
    retiredSnapshot = isRetiredAgeAnalysisSnapshot(snap);
  }

  return evaluateCapturePaymentFamily({ family, authorizedSchoolId, retiredSnapshot });
}
