import {
  ensureDaSilvaAcademySubscription,
  getDaSilvaResolvedSchoolId,
} from "./activateDaSilvaSubscription";
import { ensureDaSilvaAcademyLogin } from "./ensureDaSilvaAcademyLogin";
import { ensureDaSilvaAcademyProduction } from "./ensureDaSilvaAcademyProduction";
import { healDaSilvaProductionDataIfCorrupted } from "./daSilvaProductionHeal";
import { removeStuckAli002ManualTestPayments } from "./repairStuckManualBillingEntries";
import { ensureEduClearPackages } from "./ensureEduClearPackages";
import { runPrismaMigrateDeployWithRecovery } from "./prismaMigrationRecovery";
import { prisma } from "../prisma";
import { refreshDaSilvaSchoolIdCache } from "./daSilvaSchoolResolve";
import { assertBillingPersistentDiskForStartup } from "../utils/billingPersistenceDiagnostics";
import { isProductionOrGoLive } from "./runtime";

/**
 * Production boot tasks before HTTP listen: migrations, package seeds, Da Silva ensure + activation.
 */
export async function runProductionStartup(): Promise<void> {
  assertBillingPersistentDiskForStartup();

  console.log("[startup] Running migration recovery");
  await runPrismaMigrateDeployWithRecovery();

  try {
    const codes = await ensureEduClearPackages();
    console.log(`[startup] EduClear packages ensured: ${codes.join(", ")}`);
  } catch (error) {
    console.error("[startup] ensureEduClearPackages failed:", error);
  }

  if (!isProductionOrGoLive()) {
    return;
  }

  try {
    await refreshDaSilvaSchoolIdCache();
  } catch (error) {
    console.error("[startup] Da Silva school id cache failed:", error);
  }

  console.log("[startup] Da Silva school ensure/import starting");
  try {
    await ensureDaSilvaAcademyProduction();
  } catch (error) {
    console.error("[startup] Da Silva school ensure/import failed:", error);
  }

  console.log("[startup] Da Silva owner login ensure starting");
  try {
    const login = await ensureDaSilvaAcademyLogin();
    if (login.ok) {
      console.log(`[startup] Da Silva owner login ready (user ${login.userId})`);
    } else {
      console.error(
        `[startup] Da Silva owner login not ready (user ${login.userId ?? "none"})`
      );
    }
  } catch (error) {
    console.error("[startup] Da Silva owner login ensure failed:", error);
  }

  const resolvedSchoolId = getDaSilvaResolvedSchoolId();
  const school = await prisma.school.findUnique({
    where: { id: resolvedSchoolId },
    select: { id: true },
  });
  if (!school) {
    console.error(
      `[startup] Da Silva subscription activation skipped — school not found: ${resolvedSchoolId}`
    );
    return;
  }

  console.log("[startup] Da Silva school ensured/imported");

  try {
    await healDaSilvaProductionDataIfCorrupted();
  } catch (error) {
    console.error("[startup] Da Silva production heal failed:", error);
  }

  try {
    const removedStuckPayments = removeStuckAli002ManualTestPayments();
    if (removedStuckPayments.length > 0) {
      console.log(
        `[startup] Removed ${removedStuckPayments.length} stuck ALI002 manual test payment(s): ${removedStuckPayments.join(", ")}`
      );
    }
  } catch (error) {
    console.error("[startup] ALI002 stuck manual payment cleanup failed:", error);
  }

  console.log("[startup] Da Silva subscription activation starting");
  try {
    await ensureDaSilvaAcademySubscription();
    console.log("[startup] Da Silva subscription ACTIVE");
  } catch (error) {
    console.error("[startup] Da Silva subscription activation failed:", error);
  }
}
