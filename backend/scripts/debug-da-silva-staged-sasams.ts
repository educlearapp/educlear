/**
 * Hard diagnostic: staged SA-SAMS class lists vs preview parser.
 *
 * Usage (from backend/):
 *   npx tsc && npx tsx scripts/debug-da-silva-staged-sasams.ts
 *   npx tsx scripts/debug-da-silva-staged-sasams.ts [schoolId] [projectId]
 */
import "dotenv/config";

import fs from "fs";
import path from "path";

import { DA_SILVA_ACADEMY_SCHOOL_ID } from "../src/services/activateDaSilvaSubscription";
import { previewDaSilvaSasamsClassesLearners } from "../src/services/daSilvaMigration/daSilvaMigrationPreview";
import { resolveDaSilvaStagedPaths } from "../src/services/daSilvaMigration/daSilvaStagedPaths";
import {
  detectSasamsClassListHeaders,
  diagnoseSasamsClassListDirectory,
  parseSasamsClassListDirectory,
  type SasamsClassListFileDiagnostic,
} from "../src/services/daSilvaMigration/sasamsParsers";
import { isKideesysXmlSpreadsheet } from "../src/utils/kideesysSpreadsheet";

const STAGING_ROOT = path.join(process.cwd(), "uploads", "migration-staging");
import { DA_SILVA_EXPECTED_FINAL_LEARNER_COUNT, DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT } from "../src/services/daSilvaMigration/daSilvaConstants";

type StagedProjectRef = {
  schoolId: string;
  projectId: string;
  uploadsMtimeMs: number;
};

function isProjectUploadsDir(dir: string): boolean {
  return fs.existsSync(path.join(dir, "uploads")) && fs.statSync(dir).isDirectory();
}

function uploadsDirMtimeMs(uploadsDir: string): number {
  if (!fs.existsSync(uploadsDir)) return 0;
  let latest = fs.statSync(uploadsDir).mtimeMs;
  for (const name of fs.readdirSync(uploadsDir)) {
    const p = path.join(uploadsDir, name);
    try {
      const st = fs.statSync(p);
      if (st.isDirectory()) latest = Math.max(latest, st.mtimeMs);
      else latest = Math.max(latest, st.mtimeMs);
    } catch {
      /* skip */
    }
  }
  const classLists = path.join(uploadsDir, "sasams", "class_lists");
  if (fs.existsSync(classLists)) {
    latest = Math.max(latest, fs.statSync(classLists).mtimeMs);
    for (const f of fs.readdirSync(classLists)) {
      latest = Math.max(latest, fs.statSync(path.join(classLists, f)).mtimeMs);
    }
  }
  return latest;
}

function listStagedProjects(schoolId: string): StagedProjectRef[] {
  const schoolDir = path.join(STAGING_ROOT, schoolId);
  if (!fs.existsSync(schoolDir)) return [];

  const refs: StagedProjectRef[] = [];
  for (const name of fs.readdirSync(schoolDir)) {
    if (name.startsWith("dasilva-") && name.endsWith(".json")) continue;
    if (name.endsWith(".manifest.json")) continue;
    if (name.endsWith(".audit-classrooms.json")) continue;
    const projectDir = path.join(schoolDir, name);
    if (!fs.statSync(projectDir).isDirectory()) continue;
    if (!isProjectUploadsDir(projectDir)) continue;
    const uploadsDir = path.join(projectDir, "uploads");
    refs.push({
      schoolId,
      projectId: name,
      uploadsMtimeMs: uploadsDirMtimeMs(uploadsDir),
    });
  }
  return refs.sort((a, b) => b.uploadsMtimeMs - a.uploadsMtimeMs);
}

function findLatestStagedProject(cliSchoolId?: string, cliProjectId?: string): StagedProjectRef {
  if (cliSchoolId && cliProjectId) {
    return { schoolId: cliSchoolId, projectId: cliProjectId, uploadsMtimeMs: 0 };
  }

  const schoolIds = cliSchoolId
    ? [cliSchoolId]
    : fs
        .readdirSync(STAGING_ROOT)
        .filter((name) => name !== "tmp" && fs.statSync(path.join(STAGING_ROOT, name)).isDirectory());

  let best: StagedProjectRef | null = null;
  for (const schoolId of schoolIds) {
    for (const ref of listStagedProjects(schoolId)) {
      if (cliProjectId && ref.projectId !== cliProjectId) continue;
      if (!best || ref.uploadsMtimeMs > best.uploadsMtimeMs) best = ref;
    }
  }

  if (!best) {
    throw new Error(
      `No staged migration project found under ${STAGING_ROOT}. Upload via wizard or pass schoolId projectId.`
    );
  }
  return best;
}

function listAllFilesInDir(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).sort((a, b) => a.localeCompare(b));
}

function listClassListXlsFiles(classListDir: string): string[] {
  return listAllFilesInDir(classListDir).filter((f) => /\.xlsx?$/i.test(f));
}

/** Class stream files only (excludes register / parent exports often co-uploaded). */
function listClassStreamXlsFiles(classListDir: string): string[] {
  return listClassListXlsFiles(classListDir).filter(
    (f) => !/register|parent|contact|employee|billing|transaction|age_analysis/i.test(f)
  );
}

function parseClassStreamDirectory(dir: string) {
  const tmpDir = path.join(STAGING_ROOT, "_debug-class-stream");
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  for (const f of listClassStreamXlsFiles(dir)) {
    fs.copyFileSync(path.join(dir, f), path.join(tmpDir, f));
  }
  const result = parseSasamsClassListDirectory(tmpDir);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  return result;
}

function findAlternateClassListDirs(projectUploadsDir: string, canonicalDir: string): Array<{
  label: string;
  path: string;
  fileCount: number;
}> {
  const out: Array<{ label: string; path: string; fileCount: number }> = [];
  const candidates = [
    { label: "legacy uploads/05_class_list", path: path.join(projectUploadsDir, "05_class_list") },
    { label: "legacy uploads/sasams_class_lists", path: path.join(projectUploadsDir, "sasams_class_lists") },
  ];
  for (const c of candidates) {
    if (path.resolve(c.path) === path.resolve(canonicalDir)) continue;
    const files = listClassListXlsFiles(c.path);
    if (files.length) out.push({ label: c.label, path: c.path, fileCount: files.length });
  }
  return out;
}

function detectFileFormat(filePath: string): string {
  if (!fs.existsSync(filePath)) return "missing";
  const buf = fs.readFileSync(filePath).subarray(0, 8);
  if (buf[0] === 0xd0 && buf[1] === 0xcf) return "binary-ole-xls (SA-SAMS BIFF)";
  const head = fs.readFileSync(filePath).subarray(0, 256).toString("utf8");
  if (isKideesysXmlSpreadsheet(fs.readFileSync(filePath))) return "xml-spreadsheetml (Kid-e-Sys)";
  if (head.includes("<?xml")) return "xml-unknown";
  return "unknown";
}

function printFileDiagnostic(d: SasamsClassListFileDiagnostic): void {
  console.log(`\n--- ${d.filename} ---`);
  console.log(`path: ${d.filePath}`);
  console.log(`file format: ${detectFileFormat(d.filePath)}`);
  console.log(`parseMode: ${d.parseMode}`);
  console.log(`detectedHeaderRow (1-based data start): ${d.detectedHeaderRow}`);
  console.log(
    `layout: header rows ${d.layout.headerStartRow + 1}-${d.layout.headerEndRow + 1}, dataStartRow=${d.layout.dataStartRow + 1}, mappedCount=${d.layout.mappedCount}`
  );
  console.log("detected columns:", JSON.stringify(d.mappedColumns, null, 2));
  console.log(`parsed learner count: ${d.parsedLearnerCount}`);
  console.log("first 3 parsed learners:", JSON.stringify(d.firstParsedLearners, null, 2));
  console.log("first 20 raw rows:", JSON.stringify(d.rawFirst20, null, 2));

  if (d.parsedLearnerCount === 0 && d.rejections.length) {
    console.log(`row rejections (${d.rejections.length} non-learner/data rows):`);
    const cap = 40;
    for (const r of d.rejections.slice(0, cap)) {
      console.log(`  row ${r.sheetRow}: ${r.reason}`);
      console.log(`    cells: ${JSON.stringify(r.snapshot)}`);
    }
    if (d.rejections.length > cap) {
      console.log(`  ... ${d.rejections.length - cap} more rejections omitted`);
    }
  } else if (d.parsedLearnerCount === 0) {
    console.log("row rejections: (none recorded — file may be empty or unreadable)");
  }
}

async function main(): Promise<void> {
  const cliSchoolId = String(process.argv[2] || "").trim();
  const cliProjectId = String(process.argv[3] || "").trim();

  const ref = findLatestStagedProject(cliSchoolId || undefined, cliProjectId || undefined);
  const schoolId = ref.schoolId || cliSchoolId || DA_SILVA_ACADEMY_SCHOOL_ID;
  const projectId = ref.projectId;

  const staged = resolveDaSilvaStagedPaths(schoolId, projectId);
  const classListDir = staged.classListDir;
  const projectUploadsDir = path.dirname(path.dirname(classListDir));

  console.log("=== Da Silva staged SA-SAMS class list diagnostic ===\n");
  console.log(`schoolId: ${schoolId}`);
  console.log(`projectId: ${projectId}`);
  console.log(`staging root: ${STAGING_ROOT}`);
  console.log(`exact class_lists folder: ${classListDir}`);
  console.log(`class_lists exists: ${fs.existsSync(classListDir)}`);

  const filenames = listClassListXlsFiles(classListDir);
  console.log(`number of .xls/.xlsx files in class_lists: ${filenames.length}`);
  console.log("filenames:", filenames.length ? filenames.join(", ") : "(none)");

  const alternates = findAlternateClassListDirs(projectUploadsDir, classListDir);
  if (alternates.length) {
    console.log("\nOther class-list locations under same project uploads (not used by wizard preview):");
    for (const alt of alternates) {
      console.log(`  ${alt.label}: ${alt.path} (${alt.fileCount} xls files)`);
    }
  }

  if (!filenames.length) {
    console.log(
      "\nFAIL: Wizard preview reads an empty sasams/class_lists folder. Upload route must copy classListFiles here."
    );
    for (const alt of alternates) {
      const streamFiles = listClassStreamXlsFiles(alt.path);
      const altParsed = parseClassStreamDirectory(alt.path);
      console.log(
        `\nReference parse on ${alt.label} (${streamFiles.length} class-stream files): ${altParsed.learners.length} learners`
      );
      console.log(`  (all .xls in folder incl. registers: ${listClassListXlsFiles(alt.path).length} files)`);
    }
    process.exit(1);
  }

  const headerDetection = detectSasamsClassListHeaders(classListDir);
  const { learners: parsedLearners, classrooms } = parseSasamsClassListDirectory(classListDir);
  const fileDiagnostics = diagnoseSasamsClassListDirectory(classListDir);

  console.log("\n=== Preview parser (parseSasamsClassListDirectory + detectSasamsClassListHeaders) ===");
  console.log(`total parsed learners: ${parsedLearners.length}`);
  console.log(`classrooms: ${classrooms.length}`);
  console.log(`headerDetection.totalLearners: ${headerDetection.totalLearners}`);
  console.log("headerDetection.files:", JSON.stringify(headerDetection.files, null, 2));

  let previewTotal = 0;
  try {
    const preview = await previewDaSilvaSasamsClassesLearners({ schoolId, projectId });
    previewTotal = preview.totalLearners;
    console.log("\n=== previewDaSilvaSasamsClassesLearners (API parity) ===");
    console.log(`totalLearners: ${preview.totalLearners}`);
    console.log(`passed: ${preview.passed}`);
    if (preview.errors.length) console.log("errors:", preview.errors);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.log("\n=== previewDaSilvaSasamsClassesLearners (API parity) ===");
    console.log(`skipped: ${message}`);
  }

  for (const d of fileDiagnostics) {
    printFileDiagnostic(d);
  }

  const diagnosticTotal = fileDiagnostics.reduce((s, f) => s + f.parsedLearnerCount, 0);
  console.log("\n=== Summary ===");
  console.log(`per-file diagnostic total: ${diagnosticTotal}`);
  console.log(`parseSasamsClassListDirectory total: ${parsedLearners.length}`);
  console.log(`preview totalLearners: ${previewTotal}`);
  console.log(`expected SA-SAMS: ${DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT} (final ${DA_SILVA_EXPECTED_FINAL_LEARNER_COUNT} with Crèche supplement)`);

  if (parsedLearners.length === DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT) {
    console.log(`\nOK: Parsed ${DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT} SA-SAMS learners from staged sasams/class_lists.`);
    return;
  }

  if (parsedLearners.length === 0) {
    console.log("\nFAIL: 0 learners — see per-file rejections above.");
    process.exit(1);
  }

  console.log(`\nWARN: Parsed ${parsedLearners.length} learners (expected ${DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT} SA-SAMS).`);
  process.exit(1);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
