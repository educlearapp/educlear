/**
 * Debug Da Silva staging upload manifest — paths, readability, parser smoke checks.
 *
 * Usage:
 *   npx tsx scripts/debug-da-silva-manifest.ts [schoolId] [projectId]
 */
import "dotenv/config";

import fs from "fs";
import path from "path";
import {
  buildDaSilvaManifestDebugReport,
  loadStagingUploadManifest,
  pathsFromStagingUploadManifest,
  stagingUploadManifestPath,
} from "../src/services/daSilvaMigration/daSilvaUploadManifest";
import { previewDaSilvaKideesysBillingMatch } from "../src/services/daSilvaMigration/daSilvaMigrationPreview";
import {
  auditParentMatches,
} from "../src/services/daSilvaMigration/daSilvaParentLearnerMatching";
import {
  parseSasamsClassListDirectory,
  parseSasamsParentLearnerLinks,
  parseSasamsParentSources,
} from "../src/services/daSilvaMigration/sasamsParsers";
import { parseDaSilvaLearnersFromSasams } from "../src/services/daSilvaMigration/daSilvaMigrationService";

const STAGING_ROOT = path.join(process.cwd(), "uploads", "migration-staging");

function findLatestProjectId(schoolId: string): string | null {
  const schoolDir = path.join(STAGING_ROOT, schoolId);
  if (!fs.existsSync(schoolDir)) return null;

  const projectDirs = fs
    .readdirSync(schoolDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith("dasilva-"))
    .map((d) => d.name)
    .sort()
    .reverse();

  for (const dir of projectDirs) {
    const manifest = path.join(schoolDir, dir, "uploads", "manifest.json");
    if (fs.existsSync(manifest)) return dir;
  }
  return projectDirs[0] || null;
}

async function main(): Promise<void> {
  const schoolId = (process.argv[2] || process.env.DA_SILVA_SCHOOL_ID || "").trim();
  let projectId = (process.argv[3] || "").trim();

  if (!schoolId) {
    console.error("Usage: npx tsx scripts/debug-da-silva-manifest.ts <schoolId> [projectId]");
    process.exit(1);
  }

  if (!projectId) {
    projectId = findLatestProjectId(schoolId) || "";
    if (!projectId) {
      console.error(`No Da Silva project found under ${STAGING_ROOT}/${schoolId}`);
      process.exit(1);
    }
    console.log(`Latest projectId: ${projectId}`);
  }

  const manifestPath = stagingUploadManifestPath(schoolId, projectId);
  console.log(`Manifest path: ${manifestPath}`);
  console.log(`Manifest exists: ${fs.existsSync(manifestPath)}`);

  const report = buildDaSilvaManifestDebugReport(schoolId, projectId);
  console.log("\n=== Manifest slots ===");
  for (const slot of report.slots) {
    console.log(
      `${slot.slot}: exists=${slot.exists} readable=${slot.readable} size=${slot.size} path=${slot.path || "—"}`
    );
  }
  console.log(`\nClass list count: ${report.classListsCount}`);
  console.log(`Class list filenames: ${report.classListFilenames.join(", ") || "(none)"}`);
  if (report.manifestErrors.length) {
    console.log("\nManifest errors:");
    for (const err of report.manifestErrors) console.log(`  • ${err}`);
  }

  if (!report.manifestReady) {
    console.error("\nManifest not ready — fix uploads before running parsers.");
    process.exit(1);
  }

  const manifest = loadStagingUploadManifest(schoolId, projectId)!;
  const paths = pathsFromStagingUploadManifest(manifest);

  const { learners } = parseSasamsClassListDirectory(paths.classListDir);
  console.log(`\nSA-SAMS class parser learners: ${learners.length}`);

  const merged = parseDaSilvaLearnersFromSasams({
    classListDir: paths.classListDir,
    learnerRegister: paths.learnerRegister,
    parentRegister: paths.parentRegister,
  });
  console.log(`SA-SAMS merged learners (with register): ${merged.length}`);

  const parentLinks = parseSasamsParentLearnerLinks(paths.parentLearnerLinks);
  console.log(`Parent link rows parsed: ${parentLinks.length}`);

  const dbLearners = merged.map((r) => ({
    id: r.matchKey,
    firstName: r.firstName,
    lastName: r.lastName,
    className: r.canonicalClassName,
    admissionNo: r.admissionNo,
    idNumber: r.idNumber,
  }));
  const combined = parseSasamsParentSources(paths.parentRegister, paths.parentLearnerLinks);
  const audit = auditParentMatches(combined, dbLearners);
  const matched = audit.rows.filter((r) => r.matched).length;
  console.log(`Parent link matches: ${matched}/${combined.length}`);

  const billingPreview = await previewDaSilvaKideesysBillingMatch({ schoolId, projectId });
  console.log(
    `Billing match preview: ${billingPreview.matchedAccounts}/${billingPreview.totalAccounts} matched`
  );
  if (billingPreview.errors.length) {
    console.log("Billing preview errors:");
    for (const err of billingPreview.errors) console.log(`  • ${err}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
