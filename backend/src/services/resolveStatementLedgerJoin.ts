import {
  normaliseEduClearAccountNo,
  resolveLedgerJoinAccountRef,
  type FamilyAccountNumberFields,
} from "./familyAccountNumber";

export type StatementFamilyIdentity = FamilyAccountNumberFields & {
  schoolId: string;
};

/**
 * SA-SAMS numeric admission-style refs must never be treated as statement billing identity.
 */
export function isSasamsNumericAccount(value: unknown): boolean {
  const v = String(value ?? "").trim();
  if (!v || normaliseEduClearAccountNo(v)) return false;
  return /^\d{4,}$/.test(v);
}

/**
 * School-scoped statement lookup: query (dedicated accountNo or accountRef / family name)
 * → FamilyAccount in the authenticated school → preserved accountRef (ledger join key).
 *
 * Fly Eagle: ABA001 → Express accountRef. Da Silva / MBB: SIL007 → SIL007.
 * Families from other schools are ignored even if present in the input array.
 */
export function resolveStatementLedgerJoinFromFamilies(input: {
  authorizedSchoolId: string;
  query: string;
  families: StatementFamilyIdentity[];
}): string | null {
  const schoolId = String(input.authorizedSchoolId || "").trim();
  const query = String(input.query || "").trim();
  if (!schoolId || !query || query === "-") return null;
  if (isSasamsNumericAccount(query)) return null;

  const q = query.toUpperCase();
  const kid = normaliseEduClearAccountNo(query);
  const inSchool = input.families.filter((family) => String(family.schoolId || "").trim() === schoolId);
  if (!inSchool.length) return null;

  if (kid) {
    const byAccountNo = inSchool.find((family) => normaliseEduClearAccountNo(family.accountNo) === kid);
    if (byAccountNo) return resolveLedgerJoinAccountRef(byAccountNo) || null;
  }

  const byRef = inSchool.find((family) => String(family.accountRef || "").trim().toUpperCase() === q);
  if (byRef) return resolveLedgerJoinAccountRef(byRef) || null;

  return null;
}
