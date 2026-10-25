/**
 * @deprecated Phase 4A — Parent Portal now registers `/parent-sw.js` via `usePortalPwaHead(parentPortalPwaHead)`.
 * Kept as a no-op so any leftover callers do not re-register the old placeholder SW.
 */
export function useParentPortalPushPreparation(_opts: {
  enabled: boolean;
  schoolId: string;
  parentId: string;
}) {
  // Intentionally empty: do not register /push-sw-placeholder.js.
}
