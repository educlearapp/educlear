/**
 * All Parents audience helpers for Email Communications.
 * Class multi-select filters the eligible parent pool; send still uses explicit selection.
 */

export function isEligibleParentEmail(email: unknown): boolean {
  const value = String(email ?? "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function contactMatchesSelectedClasses(
  classNames: string[] | undefined,
  selectedClassNames: string[]
): boolean {
  if (!selectedClassNames.length) return false;
  const selected = new Set(selectedClassNames.map((name) => String(name || "").trim()).filter(Boolean));
  if (!selected.size) return false;
  return (classNames || []).some((name) => selected.has(String(name || "").trim()));
}

export function filterEligibleParentsByClasses<T extends { email: string; classNames?: string[] }>(
  contacts: T[],
  selectedClassNames: string[]
): T[] {
  return contacts.filter(
    (contact) =>
      isEligibleParentEmail(contact.email) &&
      contactMatchesSelectedClasses(contact.classNames, selectedClassNames)
  );
}

/** Unique email addresses among selected contacts (invalid/missing excluded). */
export function uniqueSelectedEmailRecipients<T extends { id: string; email: string }>(
  contacts: T[],
  selectedContactIds: string[]
): T[] {
  const selected = new Set(selectedContactIds);
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const contact of contacts) {
    if (!selected.has(contact.id)) continue;
    if (!isEligibleParentEmail(contact.email)) continue;
    const key = String(contact.email).trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(contact);
  }
  return unique;
}

export function pruneSelectedIds(selectedIds: string[], eligibleIds: string[]): string[] {
  const eligible = new Set(eligibleIds);
  return selectedIds.filter((id) => eligible.has(id));
}

export function areAllSelected(selectedIds: string[], eligibleIds: string[]): boolean {
  if (!eligibleIds.length) return false;
  const selected = new Set(selectedIds);
  return eligibleIds.every((id) => selected.has(id));
}

/** Select All Classes always uses the full active class list, not a filtered/visible subset. */
export function selectAllClassNames(allActiveClassNames: string[]): string[] {
  return allActiveClassNames.map((name) => String(name || "").trim()).filter(Boolean);
}

export function toggleClassSelection(
  selectedClassNames: string[],
  className: string,
  checked: boolean
): string[] {
  const name = String(className || "").trim();
  if (!name) return selectedClassNames;
  if (checked) {
    if (selectedClassNames.includes(name)) return selectedClassNames;
    return [...selectedClassNames, name];
  }
  return selectedClassNames.filter((value) => value !== name);
}
