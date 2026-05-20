import { prisma } from "../prisma";
import { resolveLearnerAccountNo } from "../utils/learnerIdentity";
import {
  calculateBalanceForAccount,
  calculateBalanceFromEntries,
  collectFamilyAccountEntries,
  readSchoolLedger,
  type BillingLedgerEntry,
} from "../utils/billingLedgerStore";

function statusFromBalance(balance: number) {
  if (balance > 10000) return "Bad Debt";
  if (balance > 0) return "Recently Owing";
  if (balance < 0) return "Over Paid";
  return "Up To Date";
}

export async function buildAccountsFromLearners(schoolId: string, ledger: BillingLedgerEntry[]) {
  const learners = await prisma.learner.findMany({
    where: { schoolId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      schoolId: true,
      firstName: true,
      lastName: true,
      familyAccountId: true,
      familyAccount: { select: { accountRef: true, familyName: true } },
    },
  });

  const familyMembersById = new Map<string, string[]>();
  for (const l of learners) {
    const familyId = String(l.familyAccountId || "").trim();
    if (!familyId) continue;
    const list = familyMembersById.get(familyId) || [];
    list.push(l.id);
    familyMembersById.set(familyId, list);
  }

  const familyBalanceById = new Map<string, number>();
  for (const [familyId, memberIds] of familyMembersById) {
    const anchor = learners.find((l) => l.id === memberIds[0]);
    const accountRef = anchor ? resolveLearnerAccountNo(anchor) : "";
    const scoped = collectFamilyAccountEntries(ledger, {
      accountRef,
      learnerIds: memberIds,
    });
    familyBalanceById.set(familyId, calculateBalanceFromEntries(scoped));
  }

  return learners.map((l) => {
    const accountNo = resolveLearnerAccountNo(l);
    const familyId = String(l.familyAccountId || "").trim();
    const memberIds = familyId ? familyMembersById.get(familyId) || [l.id] : [l.id];
    const accountEntries = familyId
      ? collectFamilyAccountEntries(ledger, { accountRef: accountNo, learnerIds: memberIds })
      : ledger.filter(
          (e) =>
            String(e.learnerId) === l.id || (accountNo && String(e.accountNo) === accountNo)
        );
    const lastInvoice = accountEntries
      .filter((e) => e.type === "invoice")
      .sort(
        (a, b) =>
          new Date(b.date || b.createdAt).getTime() - new Date(a.date || a.createdAt).getTime()
      )[0];
    const lastPayment = accountEntries
      .filter((e) => e.type === "payment")
      .sort(
        (a, b) =>
          new Date(b.date || b.createdAt).getTime() - new Date(a.date || a.createdAt).getTime()
      )[0];
    const balance =
      familyId && familyBalanceById.has(familyId)
        ? familyBalanceById.get(familyId)!
        : calculateBalanceForAccount(ledger, l.id, accountNo);

    return {
      accountNo,
      learnerId: l.id,
      schoolId: l.schoolId,
      name: l.firstName || "-",
      surname: l.lastName || "-",
      balance,
      lastInvoice: lastInvoice?.amount ?? 0,
      lastInvoiceDate: lastInvoice?.date || "",
      lastPayment: lastPayment?.amount ?? 0,
      lastPaymentDate: lastPayment?.date || "",
      status: statusFromBalance(balance),
      familyAccountId: l.familyAccountId,
      familyName: l.familyAccount?.familyName ?? null,
    };
  });
}
