/**
 * Production startup guard: refuse to boot when billing JSON is not on a persistent disk.
 * Runs after verify-runtime-assets in npm start (post-build, pre-listen).
 */
import { assertBillingPersistentDiskForStartup } from "../dist/utils/billingPersistenceDiagnostics.js";

assertBillingPersistentDiskForStartup();
