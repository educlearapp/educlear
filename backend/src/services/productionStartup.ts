import {
  ensureDaSilvaAcademySubscription,
  getDaSilvaResolvedSchoolId,
} from "./activateDaSilvaSubscription";
import { ensureDaSilvaAcademyProduction } from "./ensureDaSilvaAcademyProduction";
import { ensureEduClearPackages } from "./ensureEduClearPackages";
import { runPrismaMigrateDeployWithRecovery } from "./prismaMigrationRecovery";
import { prisma } from "../prisma";
import { refreshDaSilvaSchoolIdCache } from "./daSilvaSchoolResolve";
import { isProductionOrGoLive, isProductionRuntime } from "./runtime";

/**
 * Production boot tasks before HTTP listen: migrations, package seeds, Da Silva ensure + activation.
 */
export async function runProductionStartup(): Promise<void> {
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

  console.log("[startup] Da Silva subscription activation starting");
  try {
    await ensureDaSilvaAcademySubscription();
    console.log("[startup] Da Silva subscription ACTIVE");
  } catch (error) {
    console.error("[startup] Da Silva subscription activation failed:", error);
  }
}
