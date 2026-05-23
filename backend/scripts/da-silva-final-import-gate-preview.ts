/**
 * Final Da Silva import gate preview — no import, no DB writes.
 * Usage: npx ts-node scripts/da-silva-final-import-gate-preview.ts [desktopRoot]
 */
import path from "path";
import { buildDaSilvaBundleFromDesktopLayout } from "../src/services/daSilvaMigration/daSilvaMigrationService";
import {
  previewDaSilvaFinalImportGate,
  printDaSilvaFinalImportGatePreview,
} from "../src/services/daSilvaMigration/daSilvaFinalImportGate";

const SCHOOL_NAME = "Da Silva Academy";
const desktopRoot = process.argv[2] || path.join(process.env.HOME || "", "Desktop");

const bundle = buildDaSilvaBundleFromDesktopLayout("gate-preview", "gate-preview", desktopRoot);
const preview = previewDaSilvaFinalImportGate(bundle, SCHOOL_NAME);

printDaSilvaFinalImportGatePreview(preview);
process.exit(preview.gateStatus === "PASS" ? 0 : 1);
