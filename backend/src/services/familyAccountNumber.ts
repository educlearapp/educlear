import { isKidESysSourceAccountRef } from "./daSilvaMigration/ageAnalysisParser";

export type FamilyAccountNumberFields = {
  accountRef?: string | null;
  accountNo?: string | null;
};

function trimRef(value: unknown): string {
  return String(value ?? "").trim();
}

/** Kid-e-Sys-format EduClear account number stored on FamilyAccount.accountNo. */
export function normaliseEduClearAccountNo(value: unknown): string {
  const ref = trimRef(value).toUpperCase();
  return isKidESysSourceAccountRef(ref) ? ref : "";
}

/**
 * Ledger / snapshot / statement join key. Always FamilyAccount.accountRef.
 * For Fly Eagle this remains the Express customer name.
 */
export function resolveLedgerJoinAccountRef(family: FamilyAccountNumberFields | null | undefined): string {
  return trimRef(family?.accountRef);
}

/**
 * Staff/parent visible EduClear account number.
 * Dedicated accountNo wins when assigned; otherwise Kid-e-Sys accountRef (Da Silva / MBB / native).
 * Express names are not treated as EduClear numbers.
 */
export function resolveEduClearAccountNo(family: FamilyAccountNumberFields | null | undefined): string {
  const dedicated = normaliseEduClearAccountNo(family?.accountNo);
  if (dedicated) return dedicated;
  return normaliseEduClearAccountNo(family?.accountRef);
}

/**
 * Primary label: EduClear number when present, else the join/source ref
 * (Express name until Fly Eagle backfill).
 */
export function resolveVisibleAccountNo(family: FamilyAccountNumberFields | null | undefined): string {
  return resolveEduClearAccountNo(family) || resolveLedgerJoinAccountRef(family);
}

export function formatAccountNoWithSource(
  family: FamilyAccountNumberFields | null | undefined
): string {
  const edu = resolveEduClearAccountNo(family);
  const source = resolveLedgerJoinAccountRef(family);
  if (edu && source && source.toUpperCase() !== edu) {
    return `${edu} — ${source}`;
  }
  return edu || source;
}
