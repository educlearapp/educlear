"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Final Da Silva import gate preview — no import, no DB writes.
 * Usage: npx ts-node scripts/da-silva-final-import-gate-preview.ts [desktopRoot]
 */
const path_1 = __importDefault(require("path"));
const daSilvaMigrationService_1 = require("../src/services/daSilvaMigration/daSilvaMigrationService");
const daSilvaFinalImportGate_1 = require("../src/services/daSilvaMigration/daSilvaFinalImportGate");
const SCHOOL_NAME = "Da Silva Academy";
const desktopRoot = process.argv[2] || path_1.default.join(process.env.HOME || "", "Desktop");
const bundle = (0, daSilvaMigrationService_1.buildDaSilvaBundleFromDesktopLayout)("gate-preview", "gate-preview", desktopRoot);
const preview = (0, daSilvaFinalImportGate_1.previewDaSilvaFinalImportGate)(bundle, SCHOOL_NAME);
(0, daSilvaFinalImportGate_1.printDaSilvaFinalImportGatePreview)(preview);
process.exit(preview.gateStatus === "PASS" ? 0 : 1);
