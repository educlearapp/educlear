/** Build short Caren confirmation questions for Class C cases only. */
import type { RepairPlanItem, ZeroLinkedFaRow } from "./types";

export type CarenQuestion = {
  caseKey: string;
  accountNo: string | null;
  accountRef: string;
  question: string;
  matchedLearnerNames: string[];
  currentAccountNos: string[];
};

export function buildCarenQuestions(
  classC: RepairPlanItem[],
  zeroLinked: ZeroLinkedFaRow[]
): CarenQuestion[] {
  const byFa = new Map(zeroLinked.map((r) => [r.faId, r]));
  return classC.map((item) => {
    const row = byFa.get(item.orphanFaId);
    const names = row?.matchedLearnerNames?.length
      ? row.matchedLearnerNames.join(", ")
      : "(no matched active learners)";
    const currents = (row?.currentAccountNos || []).join(", ") || "(none)";
    return {
      caseKey: item.caseKey,
      accountNo: item.orphanAccountNo,
      accountRef: item.orphanAccountRef,
      matchedLearnerNames: row?.matchedLearnerNames || [],
      currentAccountNos: row?.currentAccountNos || [],
      question: `For zero-linked account ${item.orphanAccountNo || item.orphanAccountRef}: should billing history stay on this account, and which current family (${currents}) should the learner(s) ${names} use going forward?`,
    };
  });
}
