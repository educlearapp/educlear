/**
 * Canonical school-scoped billing account identity resolution.
 *
 * Explicit identifier types only — never guess whether an untyped string is a
 * Learner id, FamilyAccount id, accountRef, or accountNo.
 */
import { prisma } from "../prisma";
import {
  normaliseEduClearAccountNo,
  resolveLedgerJoinAccountRef,
} from "./familyAccountNumber";
import { isSasamsNumericAccount } from "./resolveStatementLedgerJoin";
import { resolveBillingAccountRef } from "./resolveBillingAccountRef";

export type BillingAccountIdentityType =
  | "familyAccountId"
  | "accountRef"
  | "accountNo"
  | "learnerId";

export type BillingAccountIdentity = {
  type: BillingAccountIdentityType;
  value: string;
};

export type CanonicalBillingAccount = {
  schoolId: string;
  familyAccountId: string | null;
  /** Ledger / statement join key (FamilyAccount.accountRef). */
  accountRef: string;
  /** Dedicated EduClear / Kid-e-Sys account number when present. */
  accountNo: string | null;
  learnerIds: string[];
};

export type BillingAccountResolveErrorCode =
  | "MISSING_SCHOOL"
  | "MISSING_IDENTITY"
  | "UNSUPPORTED_IDENTITY"
  | "NOT_FOUND"
  | "AMBIGUOUS"
  | "CROSS_TENANT";

export type BillingAccountResolveResult =
  | { ok: true; account: CanonicalBillingAccount }
  | { ok: false; status: 400 | 404 | 409; code: BillingAccountResolveErrorCode; error: string };

export class BillingAccountResolutionError extends Error {
  readonly status: 400 | 404 | 409;
  readonly code: BillingAccountResolveErrorCode;

  constructor(result: Extract<BillingAccountResolveResult, { ok: false }>) {
    super(result.error);
    this.name = "BillingAccountResolutionError";
    this.status = result.status;
    this.code = result.code;
  }
}

function trim(value: unknown): string {
  return String(value ?? "").trim();
}

const IDENTITY_TYPES: ReadonlySet<string> = new Set([
  "familyAccountId",
  "accountRef",
  "accountNo",
  "learnerId",
]);

export function parseBillingAccountIdentity(input: {
  type?: string | null;
  value?: string | null;
}): BillingAccountIdentity | null {
  const type = trim(input.type);
  const value = trim(input.value);
  if (!value || !IDENTITY_TYPES.has(type)) return null;
  return { type: type as BillingAccountIdentityType, value };
}

function notFound(): BillingAccountResolveResult {
  // Same message for missing / other-school — no cross-tenant existence signal.
  return { ok: false, status: 404, code: "NOT_FOUND", error: "Account not found for statement PDF" };
}

function toCanonical(
  schoolId: string,
  family: {
    id: string;
    accountRef: string | null;
    accountNo: string | null;
    learners?: Array<{ id: string }>;
  }
): BillingAccountResolveResult {
  const accountRef = resolveLedgerJoinAccountRef(family);
  if (!accountRef) return notFound();
  return {
    ok: true,
    account: {
      schoolId,
      familyAccountId: family.id,
      accountRef,
      accountNo: normaliseEduClearAccountNo(family.accountNo) || null,
      learnerIds: (family.learners || []).map((l) => l.id),
    },
  };
}

/**
 * Resolve a typed billing identity to the school-owned family account join key.
 * Does not silently pick another family when multiple matches map to different refs.
 * Cross-tenant ids return NOT_FOUND (no existence leak).
 */
export async function resolveCanonicalBillingAccount(input: {
  authorizedSchoolId: string;
  identity: BillingAccountIdentity;
}): Promise<BillingAccountResolveResult> {
  const schoolId = trim(input.authorizedSchoolId);
  if (!schoolId) {
    return { ok: false, status: 400, code: "MISSING_SCHOOL", error: "Missing school authorization" };
  }
  const identity = input.identity;
  if (!identity?.value) {
    return { ok: false, status: 400, code: "MISSING_IDENTITY", error: "Missing account identity" };
  }

  if (identity.type === "familyAccountId") {
    const family = await prisma.familyAccount.findFirst({
      where: { id: identity.value, schoolId },
      select: {
        id: true,
        schoolId: true,
        accountRef: true,
        accountNo: true,
        learners: { select: { id: true }, orderBy: { lastName: "asc" } },
      },
    });
    if (!family || family.schoolId !== schoolId) return notFound();
    return toCanonical(schoolId, family);
  }

  if (identity.type === "learnerId") {
    const learner = await prisma.learner.findFirst({
      where: { id: identity.value, schoolId },
      select: {
        id: true,
        familyAccount: {
          select: {
            id: true,
            schoolId: true,
            accountRef: true,
            accountNo: true,
          },
        },
      },
    });
    if (!learner?.familyAccount || learner.familyAccount.schoolId !== schoolId) {
      return notFound();
    }
    return toCanonical(schoolId, {
      ...learner.familyAccount,
      learners: [{ id: learner.id }],
    });
  }

  if (identity.type === "accountRef" || identity.type === "accountNo") {
    const query = identity.value;
    if (isSasamsNumericAccount(query)) {
      return {
        ok: false,
        status: 400,
        code: "UNSUPPORTED_IDENTITY",
        error: "Numeric admission references are not billing account identities",
      };
    }

    const kid = normaliseEduClearAccountNo(query);
    const or: Array<Record<string, string>> = [];
    if (identity.type === "accountRef") {
      or.push({ accountRef: query }, { accountRef: query.toUpperCase() });
    } else {
      // accountNo: dedicated EduClear number, with join-ref fallback for dual-identity schools.
      if (kid) or.push({ accountNo: kid });
      or.push({ accountRef: query }, { accountRef: query.toUpperCase() });
      if (kid) or.push({ accountRef: kid });
    }

    const families = await prisma.familyAccount.findMany({
      where: { schoolId, OR: or },
      select: {
        id: true,
        schoolId: true,
        accountRef: true,
        accountNo: true,
        learners: { select: { id: true }, orderBy: { lastName: "asc" } },
      },
    });
    const inSchool = families.filter((f) => f.schoolId === schoolId);
    if (!inSchool.length) {
      const legacy = await resolveBillingAccountRef(schoolId, query);
      if (legacy?.accountRef) {
        return {
          ok: true,
          account: {
            schoolId,
            familyAccountId: legacy.familyAccountId,
            accountRef: legacy.accountRef,
            accountNo: kid || null,
            learnerIds: [],
          },
        };
      }
      return notFound();
    }

    const distinctRefs = new Set(
      inSchool.map((f) => resolveLedgerJoinAccountRef(f).toUpperCase()).filter(Boolean)
    );
    if (distinctRefs.size > 1) {
      return {
        ok: false,
        status: 409,
        code: "AMBIGUOUS",
        error: "Ambiguous billing account identity",
      };
    }

    return toCanonical(schoolId, inSchool[0]);
  }

  return {
    ok: false,
    status: 400,
    code: "UNSUPPORTED_IDENTITY",
    error: "Unsupported account identity type",
  };
}

/**
 * Build a typed identity from optional explicit fields without guessing.
 * Prefer typed envelope, then familyAccountId, accountRef, accountNo, learnerId.
 * Untyped legacy callers that only pass learnerId/accountNo should keep using
 * the legacy resolveStatementAccountRef path — do not funnel untyped strings here
 * as familyAccountId.
 */
export function preferExplicitBillingIdentity(input: {
  familyAccountId?: string | null;
  accountRef?: string | null;
  accountNo?: string | null;
  learnerId?: string | null;
  identityType?: string | null;
  identityValue?: string | null;
}): BillingAccountIdentity | null {
  const parsed = parseBillingAccountIdentity({
    type: input.identityType,
    value: input.identityValue,
  });
  if (parsed) return parsed;

  const familyAccountId = trim(input.familyAccountId);
  if (familyAccountId) return { type: "familyAccountId", value: familyAccountId };

  const accountRef = trim(input.accountRef);
  if (accountRef) return { type: "accountRef", value: accountRef };

  const accountNo = trim(input.accountNo);
  if (accountNo) return { type: "accountNo", value: accountNo };

  const learnerId = trim(input.learnerId);
  if (learnerId) return { type: "learnerId", value: learnerId };

  return null;
}
