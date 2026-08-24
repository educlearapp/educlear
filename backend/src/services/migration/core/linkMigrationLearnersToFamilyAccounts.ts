/**
 * After migration apply creates learners and billing accounts separately,
 * connect learners to FamilyAccount rows by admission / account ref only.
 *
 * Surname is a REVIEW SIGNAL, never AUTO-LINK AUTHORITY.
 */

import type { Prisma } from "@prisma/client";

import { prisma } from "../../../prisma";
import {
  resolveMigrationFamilyAccountLink,
  type MigrationFamilyReviewSignal,
} from "./migrationFamilyEvidence";

type TxClient = Prisma.TransactionClient;

export async function linkMigrationLearnersToFamilyAccounts(
  schoolId: string,
  tx?: TxClient
): Promise<{
  learnersLinked: number;
  parentsLinked: number;
  reviewSignals: MigrationFamilyReviewSignal[];
}> {
  const client = tx || prisma;
  const familyAccounts = await client.familyAccount.findMany({
    where: { schoolId },
    select: { id: true, accountRef: true, familyName: true },
  });

  const learners = await client.learner.findMany({
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
  const reviewSignals: MigrationFamilyReviewSignal[] = [];
  for (const learner of learners) {
    const resolved = resolveMigrationFamilyAccountLink({
      learner: {
        id: learner.id,
        lastName: learner.lastName,
        admissionNo: learner.admissionNo,
        familyAccountId: learner.familyAccountId,
      },
      familyAccounts,
    });
    if (resolved.review) reviewSignals.push(resolved.review);
    if (!resolved.familyAccountId || learner.familyAccountId) continue;
    if (resolved.reason !== "account-ref") continue;

    await client.learner.update({
      where: { id: learner.id },
      data: {
        familyAccountId: resolved.familyAccountId,
        admissionNo: learner.admissionNo || familyAccounts.find((fa) => fa.id === resolved.familyAccountId)?.accountRef,
      },
    });
    learnersLinked += 1;
  }

  const parents = await client.parent.findMany({
    where: { schoolId, familyAccountId: null },
    select: {
      id: true,
      links: { select: { learner: { select: { familyAccountId: true } } } },
    },
  });

  let parentsLinked = 0;
  for (const parent of parents) {
    const learnerFamilyId =
      parent.links.find((l) => l.learner?.familyAccountId)?.learner?.familyAccountId || null;
    if (!learnerFamilyId) continue;
    await client.parent.update({
      where: { id: parent.id },
      data: { familyAccountId: learnerFamilyId },
    });
    parentsLinked += 1;
  }

  return { learnersLinked, parentsLinked, reviewSignals };
}
