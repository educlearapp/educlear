import fs from "fs";
import path from "path";

import { prisma } from "../../prisma";
import { backfillLedgerLearnerIds } from "../../utils/billingLedgerStore";
import { normalizeClassroomInput } from "../../utils/classroomNormalization";
import type { DaSilvaImportManifest, DaSilvaMigrationBundle } from "./daSilvaMigrationService";

export type RelinkDaSilvaLearnerBillingResult = {
  learnersUpdated: number;
  familyAccountsEnsured: number;
  accountToLearnerId: Record<string, string>;
  ledgerRowsBackfilled: number;
};

function normName(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function seedAccountLearnerSeqFromExisting(
  existing: Array<{ admissionNo: string | null }>
): Map<string, number> {
  const accountLearnerSeq = new Map<string, number>();
  for (const row of existing) {
    const adm = String(row.admissionNo || "").trim();
    if (!adm) continue;
    const dash = adm.indexOf("-");
    if (dash === -1) {
      accountLearnerSeq.set(adm, Math.max(accountLearnerSeq.get(adm) || 0, 1));
      continue;
    }
    const base = adm.slice(0, dash);
    const seq = Number.parseInt(adm.slice(dash + 1), 10);
    if (base && Number.isFinite(seq)) {
      accountLearnerSeq.set(base, Math.max(accountLearnerSeq.get(base) || 0, seq));
    }
  }
  return accountLearnerSeq;
}

function peekNextAdmissionNo(
  accountNo: string,
  accountLearnerSeq: Map<string, number>
): string | null {
  const trimmed = String(accountNo || "").trim();
  if (!trimmed) return null;
  const seq = (accountLearnerSeq.get(trimmed) || 0) + 1;
  return seq === 1 ? trimmed : `${trimmed}-${seq}`;
}

function allocateAdmissionNo(
  accountNo: string,
  accountLearnerSeq: Map<string, number>
): string | null {
  const trimmed = String(accountNo || "").trim();
  if (!trimmed) return null;
  const seq = (accountLearnerSeq.get(trimmed) || 0) + 1;
  accountLearnerSeq.set(trimmed, seq);
  return seq === 1 ? trimmed : `${trimmed}-${seq}`;
}

function admissionBase(admissionNo: string | null | undefined): string {
  const adm = String(admissionNo || "").trim();
  if (!adm) return "";
  const dash = adm.indexOf("-");
  return dash === -1 ? adm : adm.slice(0, dash);
}

async function findExistingLearnerIdForImportRow(opts: {
  schoolId: string;
  firstName: string;
  lastName: string;
  className: string;
  admissionNo: string | null;
}): Promise<string | null> {
  if (opts.admissionNo) {
    const byAdm = await prisma.learner.findUnique({
      where: {
        schoolId_admissionNo: {
          schoolId: opts.schoolId,
          admissionNo: opts.admissionNo,
        },
      },
      select: { id: true },
    });
    if (byAdm) return byAdm.id;
  }
  const byName = await prisma.learner.findFirst({
    where: {
      schoolId: opts.schoolId,
      firstName: opts.firstName,
      lastName: opts.lastName,
      className: opts.className || null,
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  return byName?.id || null;
}

/**
 * Ensures every staged learner is linked to the correct FamilyAccount and admissionNo,
 * and rebuilds accountToLearnerId for ledger backfill. Safe to run after a skipped "learners" phase.
 */
export async function relinkDaSilvaLearnerBillingFromBundle(opts: {
  schoolId: string;
  bundle: DaSilvaMigrationBundle;
  manifest: DaSilvaImportManifest;
  matchKeyToLearnerId: Map<string, string>;
  accountToLearnerId: Map<string, string>;
  /** Skip enrollmentStatus writes when production DB has not migrated the column yet. */
  omitEnrollmentStatus?: boolean;
}): Promise<RelinkDaSilvaLearnerBillingResult> {
  const { schoolId, bundle } = opts;
  const accountToFamilyId = new Map<string, string>();
  let familyAccountsEnsured = 0;
  let learnersUpdated = 0;

  const accountFamilyNames = new Map<string, string>();
  for (const row of bundle.learners) {
    const accountNo = String(row.accountNo || "").trim();
    if (!accountNo) continue;
    if (!accountFamilyNames.has(accountNo)) {
      accountFamilyNames.set(accountNo, row.lastName || row.fullName);
    }
  }

  for (const [accountNo, familyName] of accountFamilyNames) {
    const existingFa = await prisma.familyAccount.findFirst({
      where: { schoolId, accountRef: accountNo },
      select: { id: true },
    });
    const fa =
      existingFa ||
      (await prisma.familyAccount.create({
        data: { schoolId, accountRef: accountNo, familyName },
        select: { id: true },
      }));
    accountToFamilyId.set(accountNo, fa.id);
    familyAccountsEnsured += 1;
  }

  const existingAdmissionRows = await prisma.learner.findMany({
    where: { schoolId, admissionNo: { not: null } },
    select: { admissionNo: true },
  });
  const accountLearnerSeq = seedAccountLearnerSeqFromExisting(existingAdmissionRows);

  for (const row of bundle.learners) {
    const accountNo = String(row.accountNo || "").trim();
    const familyAccountId = accountNo ? accountToFamilyId.get(accountNo) || null : null;
    const isHistorical = row.enrollmentTier === "HISTORICAL";
    const norm = normalizeClassroomInput(row.className);
    const canonicalClassName = isHistorical ? null : row.canonicalClassName;

    let learnerId =
      opts.manifest.matchKeyToLearnerId?.[row.matchKey] ||
      opts.matchKeyToLearnerId.get(row.matchKey) ||
      null;

    if (!learnerId) {
      const plannedAdmissionNo = accountNo ? peekNextAdmissionNo(accountNo, accountLearnerSeq) : null;
      learnerId = await findExistingLearnerIdForImportRow({
        schoolId,
        firstName: row.firstName,
        lastName: row.lastName,
        className: canonicalClassName || "",
        admissionNo: plannedAdmissionNo,
      });
      if (!learnerId && accountNo) {
        const byBaseAccount = await prisma.learner.findUnique({
          where: {
            schoolId_admissionNo: { schoolId, admissionNo: accountNo },
          },
          select: { id: true },
        });
        learnerId = byBaseAccount?.id || null;
      }
    }

    if (!learnerId) continue;

    const current = await prisma.learner.findUnique({
      where: { id: learnerId },
      select: { familyAccountId: true, admissionNo: true, firstName: true, lastName: true },
    });

    const admissionNo =
      current?.admissionNo ||
      (accountNo ? allocateAdmissionNo(accountNo, accountLearnerSeq) : null);

    const needsUpdate =
      current?.familyAccountId !== familyAccountId ||
      !current?.admissionNo ||
      !String(current.firstName || "").trim() ||
      !String(current.lastName || "").trim();

    if (needsUpdate) {
      const updateData: {
        familyAccountId: string | null;
        admissionNo: string | null;
        firstName: string;
        lastName: string;
        grade: string;
        className: string | null;
        enrollmentStatus?: "HISTORICAL" | "ACTIVE";
      } = {
        familyAccountId,
        admissionNo,
        firstName: row.firstName || current?.firstName || "",
        lastName: row.lastName || current?.lastName || "",
        grade: isHistorical
          ? "Historical"
          : norm.gradeLabel || row.className.replace(/[A-Za-z]+$/, "").trim(),
        className: canonicalClassName,
      };
      if (!opts.omitEnrollmentStatus) {
        updateData.enrollmentStatus = isHistorical ? "HISTORICAL" : "ACTIVE";
      }
      await prisma.learner.update({
        where: { id: learnerId },
        data: updateData,
      });
      learnersUpdated += 1;
    }

    opts.matchKeyToLearnerId.set(row.matchKey, learnerId);
    if (accountNo && !opts.accountToLearnerId.has(accountNo)) {
      opts.accountToLearnerId.set(accountNo, learnerId);
    }
  }

  const accountToLearnerId = Object.fromEntries(opts.accountToLearnerId);
  const ledgerRowsBackfilled = backfillLedgerLearnerIds(schoolId, accountToLearnerId);

  return {
    learnersUpdated,
    familyAccountsEnsured,
    accountToLearnerId,
    ledgerRowsBackfilled,
  };
}

/** DB-only repair when staging bundle is unavailable. */
export async function relinkSchoolLearnersToFamilyAccountsByDb(
  schoolId: string
): Promise<{ learnersLinked: number; parentsLinked: number; ledgerRowsBackfilled: number }> {
  const familyAccounts = await prisma.familyAccount.findMany({
    where: { schoolId },
    select: { id: true, accountRef: true, familyName: true },
  });
  const familyByRef = new Map(familyAccounts.map((fa) => [fa.accountRef, fa]));

  const learners = await prisma.learner.findMany({
    where: { schoolId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      admissionNo: true,
      familyAccountId: true,
    },
  });

  let learnersLinked = 0;
  const accountToLearnerId: Record<string, string> = {};

  for (const learner of learners) {
    const admBase = admissionBase(learner.admissionNo);
    let targetFa = learner.familyAccountId
      ? familyAccounts.find((fa) => fa.id === learner.familyAccountId)
      : null;

    if (!targetFa && admBase) {
      targetFa = familyByRef.get(admBase) || null;
    }

    if (!targetFa) {
      const surname = normName(learner.lastName);
      const matches = familyAccounts.filter((fa) => normName(fa.familyName) === surname);
      if (matches.length === 1) targetFa = matches[0];
    }

    if (!targetFa) continue;

    const accountRef = targetFa.accountRef;
    if (!accountToLearnerId[accountRef]) {
      accountToLearnerId[accountRef] = learner.id;
    }

    const nextAdmission =
      learner.admissionNo ||
      (accountToLearnerId[accountRef] === learner.id
        ? accountRef
        : `${accountRef}-${learner.id.slice(-4)}`);

    if (learner.familyAccountId !== targetFa.id || !learner.admissionNo) {
      await prisma.learner.update({
        where: { id: learner.id },
        data: {
          familyAccountId: targetFa.id,
          admissionNo: nextAdmission,
        },
      });
      learnersLinked += 1;
    }
  }

  const parents = await prisma.parent.findMany({
    where: { schoolId, familyAccountId: null },
    select: { id: true, surname: true, links: { select: { learner: { select: { familyAccountId: true } } } } },
  });

  let parentsLinked = 0;
  for (const parent of parents) {
    const learnerFamilyId =
      parent.links.find((l) => l.learner?.familyAccountId)?.learner?.familyAccountId || null;
    if (!learnerFamilyId) continue;
    await prisma.parent.update({
      where: { id: parent.id },
      data: { familyAccountId: learnerFamilyId },
    });
    parentsLinked += 1;
  }

  const ledgerRowsBackfilled = backfillLedgerLearnerIds(schoolId, accountToLearnerId);

  return { learnersLinked, parentsLinked, ledgerRowsBackfilled };
}

export function findLatestDaSilvaStagingBundle(
  schoolId: string
): { projectId: string; bundle: DaSilvaMigrationBundle } | null {
  const dir = path.join(process.cwd(), "uploads", "migration-staging", schoolId);
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith("dasilva-") && f.endsWith(".json"))
    .map((f) => ({
      file: f,
      mtime: fs.statSync(path.join(dir, f)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);
  if (!files.length) return null;
  const projectId = files[0].file.replace(/^dasilva-/, "").replace(/\.json$/, "");
  const raw = fs.readFileSync(path.join(dir, files[0].file), "utf8");
  return { projectId, bundle: JSON.parse(raw) as DaSilvaMigrationBundle };
}
