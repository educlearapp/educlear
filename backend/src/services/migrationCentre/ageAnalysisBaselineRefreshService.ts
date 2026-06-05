import { prisma } from "../../prisma";
import {
  replaceSchoolFamilyAccountAgeAnalysisSnapshots,
  type FamilyAccountAgeAnalysisSnapshot,
} from "../../utils/familyAccountAgeAnalysisStore";
import { roundBillingMoney } from "../billingSummary";

export type AgeAnalysisBaselineSnapshotInput = {
  accountRef: string;
  accountHolder?: string;
  kidesysSection?: string;
  balance: number;
  buckets?: Partial<FamilyAccountAgeAnalysisSnapshot["buckets"]>;
};

export type AgeAnalysisBaselineRefreshResult = {
  success: boolean;
  schoolId: string;
  importedAt: string;
  snapshotCount: number;
  familyAccountsUpserted: number;
};

function money(value: unknown): number {
  return roundBillingMoney(value);
}

export async function refreshAgeAnalysisBaseline(opts: {
  schoolId: string;
  importedAt: string;
  snapshots: AgeAnalysisBaselineSnapshotInput[];
}): Promise<AgeAnalysisBaselineRefreshResult> {
  const schoolId = String(opts.schoolId || "").trim();
  const importedAt = String(opts.importedAt || "").trim();
  if (!schoolId) throw new Error("schoolId required");
  if (!importedAt) throw new Error("importedAt required");
  if (!Array.isArray(opts.snapshots) || !opts.snapshots.length) {
    throw new Error("snapshots required");
  }

  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { id: true },
  });
  if (!school) throw new Error("School not found");

  const store: Record<string, FamilyAccountAgeAnalysisSnapshot> = {};
  let familyAccountsUpserted = 0;

  for (const row of opts.snapshots) {
    const accountRef = String(row.accountRef || "").trim().toUpperCase();
    if (!accountRef) continue;
    const accountHolder = String(row.accountHolder || "").trim() || accountRef;
    const buckets = row.buckets || {};

    store[accountRef] = {
      schoolId,
      accountRef,
      accountHolder,
      kidesysSection: String(row.kidesysSection || "").trim() || undefined,
      balance: money(row.balance),
      buckets: {
        current: money(buckets.current ?? 0),
        d30: money(buckets.d30 ?? 0),
        d60: money(buckets.d60 ?? 0),
        d90: money(buckets.d90 ?? 0),
        d120: money(buckets.d120 ?? 0),
      },
      source: "kideesys-age-analysis",
      importedAt,
    };

    const existing = await prisma.familyAccount.findUnique({
      where: { accountRef },
      select: { id: true, schoolId: true },
    });
    if (existing && existing.schoolId !== schoolId) {
      throw new Error(`AccountRef ${accountRef} belongs to another school (${existing.schoolId})`);
    }

    await prisma.familyAccount.upsert({
      where: { accountRef },
      create: { schoolId, accountRef, familyName: accountHolder },
      update: { familyName: accountHolder },
      select: { id: true },
    });
    familyAccountsUpserted += 1;
  }

  replaceSchoolFamilyAccountAgeAnalysisSnapshots(schoolId, store);

  return {
    success: true,
    schoolId,
    importedAt,
    snapshotCount: Object.keys(store).length,
    familyAccountsUpserted,
  };
}
