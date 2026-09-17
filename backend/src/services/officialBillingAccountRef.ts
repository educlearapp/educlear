import { prisma } from "../prisma";
import {
  isKidESysSourceAccountRef,
  isStatementBillingAccountRef,
} from "./daSilvaMigration/ageAnalysisParser";
import { readSchoolFamilyAccountAgeAnalysisSnapshots } from "../utils/familyAccountAgeAnalysisStore";
import { resolveLearnerAccountNo } from "../utils/learnerIdentity";

const officialRefsBySchool = new Map<string, Set<string>>();

/**
 * Express Invoice schools post against statement-safe family accountRefs (names),
 * not Kid-e-Sys debtor codes. They must never activate the Kid-e-Sys official gate
 * — including when migration baselines store EduClear-style codes (e.g. BEY001).
 *
 * All other schools keep the pre-existing gate: any Kid-e-Sys-shaped age-analysis
 * key activates official-list membership checks (Da Silva, Magical, etc.).
 */
export const EXPRESS_INVOICE_BILLING_SCHOOL_IDS = new Set<string>([
  "cmt1e8bjp0jo8lcjeketlynhl", // Fly Eagle Primary School
]);

export function isExpressInvoiceBillingSchool(schoolId: string): boolean {
  return EXPRESS_INVOICE_BILLING_SCHOOL_IDS.has(String(schoolId || "").trim());
}

/** @internal Test hook — clears memoized official account ref sets. */
export function invalidateOfficialBillingAccountRefsCache(schoolId?: string): void {
  if (schoolId) officialRefsBySchool.delete(String(schoolId || "").trim());
  else officialRefsBySchool.clear();
}

export function normaliseOfficialBillingAccountRef(value: unknown): string {
  const ref = String(value ?? "").trim().toUpperCase();
  if (!ref || !isKidESysSourceAccountRef(ref)) return "";
  return ref;
}

/**
 * Invoice-run / posting identity.
 * When Kid-e-Sys age-analysis snapshots exist, keep Kid-e-Sys-only refs.
 * When that official list is empty, accept learner-linked statement-safe refs
 * (Express Invoice names). Never SA-SAMS numeric admission numbers.
 */
export function normaliseInvoiceRunPostingAccountRef(
  value: unknown,
  officialKidESysRefs: Set<string>
): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (officialKidESysRefs.size > 0) {
    return normaliseOfficialBillingAccountRef(raw);
  }
  const kid = normaliseOfficialBillingAccountRef(raw);
  if (kid) return kid;
  if (!isStatementBillingAccountRef(raw)) return "";
  return raw.toUpperCase();
}

/**
 * Kid-e-Sys age-analysis snapshot account refs — authoritative billing list when non-empty.
 *
 * Read-only. Never writes ledger, balances, statements, plans, or account links.
 *
 * Scope:
 * - Express Invoice schools (Fly Eagle): always empty → Express name posting path.
 * - All other schools: unchanged from historical behaviour — every Kid-e-Sys-shaped
 *   age-analysis key activates the official gate (source-agnostic), matching
 *   Da Silva / Magical pre-fix behaviour.
 */
export function readOfficialBillingAccountRefs(schoolId: string): Set<string> {
  const sid = String(schoolId || "").trim();
  const cached = officialRefsBySchool.get(sid);
  if (cached) return cached;

  if (isExpressInvoiceBillingSchool(sid)) {
    const empty = new Set<string>();
    officialRefsBySchool.set(sid, empty);
    return empty;
  }

  const snapshots = readSchoolFamilyAccountAgeAnalysisSnapshots(schoolId);
  const refs = new Set<string>();
  for (const key of Object.keys(snapshots || {})) {
    const ref = normaliseOfficialBillingAccountRef(key);
    if (ref) refs.add(ref);
  }
  officialRefsBySchool.set(sid, refs);
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
  const post = (value: unknown) => normaliseInvoiceRunPostingAccountRef(value, official);

  const familyFromRow = post(opts.learner?.familyAccount?.accountRef);
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
    const familyRef = post(learner?.familyAccount?.accountRef);
    if (familyRef && !candidates.includes(familyRef)) candidates.unshift(familyRef);
    const fallback = post(resolveLearnerAccountNo(learner));
    if (fallback && !candidates.includes(fallback)) candidates.push(fallback);
  }

  const direct = post(opts.accountNo);
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
  const official = readOfficialBillingAccountRefs(schoolId);
  const ref = normaliseInvoiceRunPostingAccountRef(accountRef, official);
  if (!ref) {
    throw new Error(
      official.size > 0
        ? "Invalid or missing Kid-e-Sys billing account ref"
        : "Invalid or missing billing account ref"
    );
  }
  if (official.size > 0 && !official.has(ref)) {
    throw new Error(
      `Account ${ref} is not on the official billing account list (${official.size} age-analysis accounts)`
    );
  }
}
