/** Pure helpers for billing statement list empty/loading display (Phase 1 stability). */

export function shouldShowNoAccountsMessage(options: {
  rowsLoading: boolean;
  syncConfirmedEmpty: boolean;
  displayRowCount: number;
  isSearchFiltered: boolean;
}): boolean {
  const { rowsLoading, syncConfirmedEmpty, displayRowCount, isSearchFiltered } = options;
  if (displayRowCount > 0) return false;
  if (isSearchFiltered) return true;
  if (rowsLoading) return false;
  return syncConfirmedEmpty;
}

export function resolveActiveBillingAccount<T>(
  reactContext: T | null | undefined,
  stored: T | null | undefined
): T | null {
  if (reactContext) return reactContext;
  return stored ?? null;
}
