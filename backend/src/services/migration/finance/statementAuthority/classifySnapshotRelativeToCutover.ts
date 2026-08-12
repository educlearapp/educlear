import type { FamilyAccountAgeAnalysisSnapshot } from "../../../../utils/familyAccountAgeAnalysisStore";
import type { SnapshotRelativeCase } from "./MigrationStatementAuthority";
import { compareInstantToCutover } from "./cutoverInstant";

export function classifySnapshotRelativeToCutover(input: {
  snap: FamilyAccountAgeAnalysisSnapshot | undefined;
  cutoverAt: string;
  /** School already has live EduClear posting activity after cutover. */
  hasProtectedLiveActivity?: boolean;
}): SnapshotRelativeCase {
  if (input.hasProtectedLiveActivity) {
    // Still classify relative date, but caller may elevate to LIVE_SCHOOL_PROTECTED messaging.
  }
  if (!input.snap) return "NO_SNAPSHOT";

  const rel = compareInstantToCutover(input.snap.importedAt, input.cutoverAt);
  if (rel === "before") return "OLDER_THAN_CUTOVER";
  if (rel === "same_day") return "SAME_DATE_AS_CUTOVER";
  if (rel === "after") return "NEWER_THAN_CUTOVER";
  // Unknown importedAt → treat as needing review (safer than overwrite)
  return "SAME_DATE_AS_CUTOVER";
}

export function snapshotCaseOperatorMessage(
  snapshotCase: SnapshotRelativeCase,
  priorImportedAt: string | null
): string {
  switch (snapshotCase) {
    case "NO_SNAPSHOT":
      return "No prior statement snapshot — migrated ledger position will become the statement balance.";
    case "OLDER_THAN_CUTOVER":
      return priorImportedAt
        ? `An older statement snapshot from ${priorImportedAt.slice(0, 10)} will be superseded by the migrated balances after confirmation.`
        : "An older statement snapshot will be superseded by the migrated balances after confirmation.";
    case "SAME_DATE_AS_CUTOVER":
      return "A statement snapshot exists on the same cutover date — confirm migrated balances take precedence.";
    case "NEWER_THAN_CUTOVER":
      return priorImportedAt
        ? `Statement authority still uses a newer balance snapshot from ${priorImportedAt.slice(0, 10)}. Review required — will not overwrite blindly.`
        : "Statement authority uses a newer balance snapshot. Review required — will not overwrite blindly.";
    case "LIVE_SCHOOL_PROTECTED":
      return "Live activity was detected on this school during migration — re-check balances before accepting.";
    default:
      return "Review required.";
  }
}
