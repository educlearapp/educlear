export function splitAccountHolderNames(accountHolder: string): string[] {
  return String(accountHolder || "")
    .split(/\n/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function formatBillingRowLearnerDisplay(row: {
  name?: string;
  surname?: string;
  memberNames?: string[];
  accountHolder?: string;
}): { name: string; surname: string } {
  const memberNames = Array.isArray(row.memberNames)
    ? row.memberNames.map((n) => String(n || "").trim()).filter(Boolean)
    : [];
  const holderNames = splitAccountHolderNames(String(row.accountHolder || ""));
  const names = memberNames.length ? memberNames : holderNames;

  if (names.length <= 1) {
    return {
      name: String(row.name || "-").trim() || "-",
      surname: String(row.surname || "-").trim() || "-",
    };
  }

  const firstParts = names.map((full) => {
    const parts = full.split(/\s+/).filter(Boolean);
    if (parts.length <= 1) return parts[0] || full;
    return parts.slice(0, -1).join(" ");
  });
  const surnames = names.map((full) => {
    const parts = full.split(/\s+/).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : "";
  });
  const sharedSurname = surnames.every((s) => s && s === surnames[0]) ? surnames[0] : "";

  return {
    name: firstParts.join(" · "),
    surname: sharedSurname || String(row.surname || "-").trim() || "-",
  };
}

export function buildBillingRowSearchText(row: any): string {
  const display = formatBillingRowLearnerDisplay(row);
  const memberNames = Array.isArray(row?.memberNames) ? row.memberNames : [];
  const holderNames = splitAccountHolderNames(String(row?.accountHolder || ""));
  return [
    row?.accountNo,
    display.name,
    display.surname,
    ...memberNames,
    ...holderNames,
    row?.name,
    row?.surname,
    row?.balance,
    row?.lastInvoice,
    row?.lastInvoiceDate,
    row?.lastPayment,
    row?.lastPaymentDate,
    row?.status,
    row?.kidesysSection,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function accountChildrenFromBillingRow(
  row: any,
  learners: any[],
  mapToChild: (source: any, fallbackAccountNo: string) => any | null,
  fallbackAccountNo: string
): any[] {
  const seen = new Set<string>();
  const children: any[] = [];
  const addChild = (source: any) => {
    const mapped = mapToChild(source, fallbackAccountNo);
    if (!mapped || seen.has(mapped.id)) return;
    seen.add(mapped.id);
    children.push(mapped);
  };

  const memberIds = Array.isArray(row?.memberLearnerIds)
    ? row.memberLearnerIds.map((id: unknown) => String(id || "").trim()).filter(Boolean)
    : [];
  for (const id of memberIds) {
    const learner = learners.find((l) => String(l?.id || l?.learnerId) === id);
    if (learner) addChild(learner);
  }

  const memberNames = Array.isArray(row?.memberNames)
    ? row.memberNames
    : splitAccountHolderNames(String(row?.accountHolder || ""));
  for (const fullName of memberNames) {
    const parts = String(fullName || "").split(/\s+/).filter(Boolean);
    if (!parts.length) continue;
    const first = parts[0].toLowerCase();
    const last = (parts[parts.length - 1] || "").toLowerCase();
    const learner = learners.find((l) => {
      const lFirst = String(l?.firstName || l?.name || "").trim().toLowerCase();
      const lLast = String(l?.lastName || l?.surname || "").trim().toLowerCase();
      return lFirst === first && lLast === last;
    });
    if (learner) addChild(learner);
    else {
      addChild({
        id: `holder:${fallbackAccountNo}:${fullName}`,
        firstName: parts.slice(0, -1).join(" ") || parts[0],
        lastName: parts.length > 1 ? parts[parts.length - 1] : "-",
        grade: "-",
        accountNo: fallbackAccountNo,
      });
    }
  }

  return children;
}
