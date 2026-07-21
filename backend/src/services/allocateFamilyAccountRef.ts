import { prisma } from "../prisma";
import { isKidESysSourceAccountRef } from "./daSilvaMigration/ageAnalysisParser";
import { readOfficialBillingAccountRefs } from "./officialBillingAccountRef";
import { readSchoolLedger } from "../utils/billingLedgerStore";
import { readSchoolFamilyAccountAgeAnalysisSnapshots } from "../utils/familyAccountAgeAnalysisStore";
import { readSchoolKidesysHistory } from "../utils/kidesysTransactionHistoryStore";
import { getSurnamePrefix } from "../utils/learnerIdentity";

const MAX_ALLOCATION_ATTEMPTS = 25;

function normalisePrefix(prefix: string): string {
  return String(prefix || "").trim().toUpperCase();
}

function normaliseAccountRefForPrefix(value: unknown, prefix: string): string {
  const ref = String(value ?? "").trim().toUpperCase();
  const upperPrefix = normalisePrefix(prefix);
  if (!ref.startsWith(upperPrefix)) return "";
  if (!isKidESysSourceAccountRef(ref)) return "";
  return ref;
}

/** Parse numeric suffix for refs matching `${prefix}${digits}`. */
export function parseAccountRefSuffix(prefix: string, accountRef: string): number | null {
  const upperPrefix = normalisePrefix(prefix);
  const ref = String(accountRef || "").trim().toUpperCase();
  const match = ref.match(new RegExp(`^${upperPrefix}(\\d+)$`, "i"));
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Collect occupied refs for a surname prefix from all authoritative finance sources. */
export async function collectOccupiedAccountRefsForPrefix(
  schoolId: string,
  prefix: string
): Promise<Set<string>> {
  const sid = String(schoolId || "").trim();
  const upperPrefix = normalisePrefix(prefix);
  const occupied = new Set<string>();

  if (!sid || !upperPrefix) return occupied;

  const familyAccounts = await prisma.familyAccount.findMany({
    where: { schoolId: sid, accountRef: { startsWith: upperPrefix } },
    select: { accountRef: true },
  });
  for (const row of familyAccounts) {
    const ref = normaliseAccountRefForPrefix(row.accountRef, upperPrefix);
    if (ref) occupied.add(ref);
  }

  const snapshots = readSchoolFamilyAccountAgeAnalysisSnapshots(sid);
  for (const key of Object.keys(snapshots || {})) {
    const ref = normaliseAccountRefForPrefix(key, upperPrefix);
    if (ref) occupied.add(ref);
  }

  for (const ref of readOfficialBillingAccountRefs(sid)) {
    const normalised = normaliseAccountRefForPrefix(ref, upperPrefix);
    if (normalised) occupied.add(normalised);
  }

  for (const entry of readSchoolLedger(sid)) {
    const ref = normaliseAccountRefForPrefix(entry.accountNo, upperPrefix);
    if (ref) occupied.add(ref);
  }

  for (const entry of readSchoolKidesysHistory(sid)) {
    const ref = normaliseAccountRefForPrefix(entry.accountNo, upperPrefix);
    if (ref) occupied.add(ref);
  }

  return occupied;
}

/**
 * Compute the next unused account ref using max(existing numeric suffix) + 1.
 * Does not fill gaps — avoids reusing Kid-e-Sys gap numbers such as MAS009.
 */
export function computeNextAvailableAccountRef(prefix: string, occupied: Set<string>): string {
  const upperPrefix = normalisePrefix(prefix);
  let maxSuffix = 0;

  for (const ref of occupied) {
    const suffix = parseAccountRefSuffix(upperPrefix, ref);
    if (suffix !== null) maxSuffix = Math.max(maxSuffix, suffix);
  }

  for (let candidateSuffix = maxSuffix + 1; candidateSuffix <= maxSuffix + 10000; candidateSuffix++) {
    const candidate = `${upperPrefix}${String(candidateSuffix).padStart(3, "0")}`;
    if (!occupied.has(candidate)) return candidate;
  }

  throw new Error(`Unable to allocate account ref for prefix ${upperPrefix}`);
}

function isPrismaUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

/**
 * Allocate a unique Kid-e-Sys-format family account ref for a school + surname.
 * Checks Postgres, age-analysis snapshots, official ref index, ledger, and history.
 * Retries on concurrent unique-constraint collisions.
 */
export async function allocateFamilyAccountRef(
  schoolId: string,
  surname: string
): Promise<string> {
  const sid = String(schoolId || "").trim();
  const prefix = getSurnamePrefix(surname);
  if (!sid) throw new Error("Missing schoolId for account ref allocation");

  let lastCandidate = "";

  for (let attempt = 0; attempt < MAX_ALLOCATION_ATTEMPTS; attempt++) {
    const occupied = await collectOccupiedAccountRefsForPrefix(sid, prefix);
    const candidate = computeNextAvailableAccountRef(prefix, occupied);
    lastCandidate = candidate;

    const existingFamily = await prisma.familyAccount.findFirst({
      where: { schoolId: sid, accountRef: candidate },
      select: { id: true },
    });
    if (existingFamily) continue;

    const snapshots = readSchoolFamilyAccountAgeAnalysisSnapshots(sid);
    if (snapshots[candidate]) continue;

    return candidate;
  }

  throw new Error(
    `Failed to allocate unique account ref for prefix ${prefix} after ${MAX_ALLOCATION_ATTEMPTS} attempts (last candidate ${lastCandidate || "none"})`
  );
}

/** @internal Used when FamilyAccount.create hits a concurrent unique collision. */
export function isFamilyAccountRefCollision(error: unknown): boolean {
  return isPrismaUniqueViolation(error);
}
