import {
  ensureDaSilvaAcademySubscription,
} from "./activateDaSilvaSubscription";
import { ensureDaSilvaAcademyProduction } from "./ensureDaSilvaAcademyProduction";
import { ensureEduClearPackages } from "./ensureEduClearPackages";
import { runPrismaMigrateDeployWithRecovery } from "./prismaMigrationRecovery";
import { isProductionRuntime } from "./runtime";

/**
 * Production boot tasks before HTTP listen: migrations, package seeds, Da Silva ensure + activation.
 */
export async function runProductionStartup(): Promise<void> {
  await runPrismaMigrateDeployWithRecovery();

  try {
    const codes = await ensureEduClearPackages();
    console.log(`[startup] EduClear packages ensured: ${codes.join(", ")}`);
  } catch (error) {
    console.error("[startup] ensureEduClearPackages failed:", error);
  }

  if (isProductionRuntime()) {
    try {
      await ensureDaSilvaAcademyProduction();
    } catch (error) {
      console.error("[startup] Da Silva school ensure/import failed:", error);
    }

    try {
      await ensureDaSilvaAcademySubscription();
      console.log(
        "[startup] Da Silva subscription ACTIVE (UNLIMITED), dashboardUnlocked=true"
      );
    } catch (error) {
      console.error("[startup] Da Silva subscription activation failed:", error);
    }
  }
}
