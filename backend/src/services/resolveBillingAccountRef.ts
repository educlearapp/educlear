import { prisma } from "../prisma";
import { readSchoolLedger } from "../utils/billingLedgerStore";

export type ResolvedBillingAccount = {
  accountRef: string;
  familyAccountId: string | null;
  familyName: string | null;
};

/** Kid-e-Sys billing identity: FamilyAccount.accountRef only (never admissionNo / idNumber). */
export async function resolveBillingAccountRef(
  schoolId: string,
  accountNo: string
): Promise<ResolvedBillingAccount | null> {
  const sid = String(schoolId || "").trim();
  const ref = String(accountNo || "").trim().toUpperCase();
  if (!sid || !ref || ref === "-") return null;

  const family = await prisma.familyAccount.findFirst({
    where: { schoolId: sid, accountRef: ref },
    select: { id: true, accountRef: true, familyName: true },
  });
  if (family) {
    return {
      accountRef: family.accountRef,
      familyAccountId: family.id,
      familyName: family.familyName,
    };
  }

  const ledger = readSchoolLedger(sid);
  if (ledger.some((e) => String(e.accountNo || "").trim().toUpperCase() === ref)) {
    return { accountRef: ref, familyAccountId: null, familyName: null };
  }

  return null;
}
