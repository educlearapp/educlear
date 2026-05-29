"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Hard diagnostic: staged SA-SAMS class lists vs preview parser.
 *
 * Usage (from backend/):
 *   npx tsc && npx tsx scripts/debug-da-silva-staged-sasams.ts
 *   npx tsx scripts/debug-da-silva-staged-sasams.ts [schoolId] [projectId]
 */
require("dotenv/config");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const activateDaSilvaSubscription_1 = require("../src/services/activateDaSilvaSubscription");
const daSilvaMigrationPreview_1 = require("../src/services/daSilvaMigration/daSilvaMigrationPreview");
const daSilvaStagedPaths_1 = require("../src/services/daSilvaMigration/daSilvaStagedPaths");
const sasamsParsers_1 = require("../src/services/daSilvaMigration/sasamsParsers");
const kideesysSpreadsheet_1 = require("../src/utils/kideesysSpreadsheet");
const STAGING_ROOT = path_1.default.join(process.cwd(), "uploads", "migration-staging");
const daSilvaConstants_1 = require("../src/services/daSilvaMigration/daSilvaConstants");
function isProjectUploadsDir(dir) {
    return fs_1.default.existsSync(path_1.default.join(dir, "uploads")) && fs_1.default.statSync(dir).isDirectory();
}
function uploadsDirMtimeMs(uploadsDir) {
    if (!fs_1.default.existsSync(uploadsDir))
        return 0;
    let latest = fs_1.default.statSync(uploadsDir).mtimeMs;
    for (const name of fs_1.default.readdirSync(uploadsDir)) {
        const p = path_1.default.join(uploadsDir, name);
        try {
            const st = fs_1.default.statSync(p);
            if (st.isDirectory())
                latest = Math.max(latest, st.mtimeMs);
            else
                latest = Math.max(latest, st.mtimeMs);
        }
        catch {
            /* skip */
        }
    }
    const classLists = path_1.default.join(uploadsDir, "sasams", "class_lists");
    if (fs_1.default.existsSync(classLists)) {
        latest = Math.max(latest, fs_1.default.statSync(classLists).mtimeMs);
        for (const f of fs_1.default.readdirSync(classLists)) {
            latest = Math.max(latest, fs_1.default.statSync(path_1.default.join(classLists, f)).mtimeMs);
        }
    }
    return latest;
}
function listStagedProjects(schoolId) {
    const schoolDir = path_1.default.join(STAGING_ROOT, schoolId);
    if (!fs_1.default.existsSync(schoolDir))
        return [];
    const refs = [];
    for (const name of fs_1.default.readdirSync(schoolDir)) {
        if (name.startsWith("dasilva-") && name.endsWith(".json"))
            continue;
        if (name.endsWith(".manifest.json"))
            continue;
        if (name.endsWith(".audit-classrooms.json"))
            continue;
        const projectDir = path_1.default.join(schoolDir, name);
        if (!fs_1.default.statSync(projectDir).isDirectory())
            continue;
        if (!isProjectUploadsDir(projectDir))
            continue;
        const uploadsDir = path_1.default.join(projectDir, "uploads");
        refs.push({
            schoolId,
            projectId: name,
            uploadsMtimeMs: uploadsDirMtimeMs(uploadsDir),
        });
    }
    return refs.sort((a, b) => b.uploadsMtimeMs - a.uploadsMtimeMs);
}
function findLatestStagedProject(cliSchoolId, cliProjectId) {
    if (cliSchoolId && cliProjectId) {
        return { schoolId: cliSchoolId, projectId: cliProjectId, uploadsMtimeMs: 0 };
    }
    const schoolIds = cliSchoolId
        ? [cliSchoolId]
        : fs_1.default
            .readdirSync(STAGING_ROOT)
            .filter((name) => name !== "tmp" && fs_1.default.statSync(path_1.default.join(STAGING_ROOT, name)).isDirectory());
    let best = null;
    for (const schoolId of schoolIds) {
        for (const ref of listStagedProjects(schoolId)) {
            if (cliProjectId && ref.projectId !== cliProjectId)
                continue;
            if (!best || ref.uploadsMtimeMs > best.uploadsMtimeMs)
                best = ref;
        }
    }
    if (!best) {
        throw new Error(`No staged migration project found under ${STAGING_ROOT}. Upload via wizard or pass schoolId projectId.`);
    }
    return best;
}
function listAllFilesInDir(dir) {
    if (!fs_1.default.existsSync(dir))
        return [];
    return fs_1.default.readdirSync(dir).sort((a, b) => a.localeCompare(b));
}
function listClassListXlsFiles(classListDir) {
    return listAllFilesInDir(classListDir).filter((f) => /\.xlsx?$/i.test(f));
}
/** Class stream files only (excludes register / parent exports often co-uploaded). */
function listClassStreamXlsFiles(classListDir) {
    return listClassListXlsFiles(classListDir).filter((f) => !/register|parent|contact|employee|billing|transaction|age_analysis/i.test(f));
}
function parseClassStreamDirectory(dir) {
    const tmpDir = path_1.default.join(STAGING_ROOT, "_debug-class-stream");
    fs_1.default.rmSync(tmpDir, { recursive: true, force: true });
    fs_1.default.mkdirSync(tmpDir, { recursive: true });
    for (const f of listClassStreamXlsFiles(dir)) {
        fs_1.default.copyFileSync(path_1.default.join(dir, f), path_1.default.join(tmpDir, f));
    }
    const result = (0, sasamsParsers_1.parseSasamsClassListDirectory)(tmpDir);
    fs_1.default.rmSync(tmpDir, { recursive: true, force: true });
    return result;
}
function findAlternateClassListDirs(projectUploadsDir, canonicalDir) {
    const out = [];
    const candidates = [
        { label: "legacy uploads/05_class_list", path: path_1.default.join(projectUploadsDir, "05_class_list") },
        { label: "legacy uploads/sasams_class_lists", path: path_1.default.join(projectUploadsDir, "sasams_class_lists") },
    ];
    for (const c of candidates) {
        if (path_1.default.resolve(c.path) === path_1.default.resolve(canonicalDir))
            continue;
        const files = listClassListXlsFiles(c.path);
        if (files.length)
            out.push({ label: c.label, path: c.path, fileCount: files.length });
    }
    return out;
}
function detectFileFormat(filePath) {
    if (!fs_1.default.existsSync(filePath))
        return "missing";
    const buf = fs_1.default.readFileSync(filePath).subarray(0, 8);
    if (buf[0] === 0xd0 && buf[1] === 0xcf)
        return "binary-ole-xls (SA-SAMS BIFF)";
    const head = fs_1.default.readFileSync(filePath).subarray(0, 256).toString("utf8");
    if ((0, kideesysSpreadsheet_1.isKideesysXmlSpreadsheet)(fs_1.default.readFileSync(filePath)))
        return "xml-spreadsheetml (Kid-e-Sys)";
    if (head.includes("<?xml"))
        return "xml-unknown";
    return "unknown";
}
function printFileDiagnostic(d) {
    console.log(`\n--- ${d.filename} ---`);
    console.log(`path: ${d.filePath}`);
    console.log(`file format: ${detectFileFormat(d.filePath)}`);
    console.log(`parseMode: ${d.parseMode}`);
    console.log(`detectedHeaderRow (1-based data start): ${d.detectedHeaderRow}`);
    console.log(`layout: header rows ${d.layout.headerStartRow + 1}-${d.layout.headerEndRow + 1}, dataStartRow=${d.layout.dataStartRow + 1}, mappedCount=${d.layout.mappedCount}`);
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
    }
    else if (d.parsedLearnerCount === 0) {
        console.log("row rejections: (none recorded — file may be empty or unreadable)");
    }
}
async function main() {
    const cliSchoolId = String(process.argv[2] || "").trim();
    const cliProjectId = String(process.argv[3] || "").trim();
    const ref = findLatestStagedProject(cliSchoolId || undefined, cliProjectId || undefined);
    const schoolId = ref.schoolId || cliSchoolId || activateDaSilvaSubscription_1.DA_SILVA_ACADEMY_SCHOOL_ID;
    const projectId = ref.projectId;
    const staged = (0, daSilvaStagedPaths_1.resolveDaSilvaStagedPaths)(schoolId, projectId);
    const classListDir = staged.classListDir;
    const projectUploadsDir = path_1.default.dirname(path_1.default.dirname(classListDir));
    console.log("=== Da Silva staged SA-SAMS class list diagnostic ===\n");
    console.log(`schoolId: ${schoolId}`);
    console.log(`projectId: ${projectId}`);
    console.log(`staging root: ${STAGING_ROOT}`);
    console.log(`exact class_lists folder: ${classListDir}`);
    console.log(`class_lists exists: ${fs_1.default.existsSync(classListDir)}`);
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
        console.log("\nFAIL: Wizard preview reads an empty sasams/class_lists folder. Upload route must copy classListFiles here.");
        for (const alt of alternates) {
            const streamFiles = listClassStreamXlsFiles(alt.path);
            const altParsed = parseClassStreamDirectory(alt.path);
            console.log(`\nReference parse on ${alt.label} (${streamFiles.length} class-stream files): ${altParsed.learners.length} learners`);
            console.log(`  (all .xls in folder incl. registers: ${listClassListXlsFiles(alt.path).length} files)`);
        }
        process.exit(1);
    }
    const headerDetection = (0, sasamsParsers_1.detectSasamsClassListHeaders)(classListDir);
    const { learners: parsedLearners, classrooms } = (0, sasamsParsers_1.parseSasamsClassListDirectory)(classListDir);
    const fileDiagnostics = (0, sasamsParsers_1.diagnoseSasamsClassListDirectory)(classListDir);
    console.log("\n=== Preview parser (parseSasamsClassListDirectory + detectSasamsClassListHeaders) ===");
    console.log(`total parsed learners: ${parsedLearners.length}`);
    console.log(`classrooms: ${classrooms.length}`);
    console.log(`headerDetection.totalLearners: ${headerDetection.totalLearners}`);
    console.log("headerDetection.files:", JSON.stringify(headerDetection.files, null, 2));
    let previewTotal = 0;
    try {
        const preview = await (0, daSilvaMigrationPreview_1.previewDaSilvaSasamsClassesLearners)({ schoolId, projectId });
        previewTotal = preview.totalLearners;
        console.log("\n=== previewDaSilvaSasamsClassesLearners (API parity) ===");
        console.log(`totalLearners: ${preview.totalLearners}`);
        console.log(`passed: ${preview.passed}`);
        if (preview.errors.length)
            console.log("errors:", preview.errors);
    }
    catch (e) {
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
    console.log(`expected SA-SAMS: ${daSilvaConstants_1.DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT} (final ${daSilvaConstants_1.DA_SILVA_EXPECTED_FINAL_LEARNER_COUNT} with Crèche supplement)`);
    if (parsedLearners.length === daSilvaConstants_1.DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT) {
        console.log(`\nOK: Parsed ${daSilvaConstants_1.DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT} SA-SAMS learners from staged sasams/class_lists.`);
        return;
    }
    if (parsedLearners.length === 0) {
        console.log("\nFAIL: 0 learners — see per-file rejections above.");
        process.exit(1);
    }
    console.log(`\nWARN: Parsed ${parsedLearners.length} learners (expected ${daSilvaConstants_1.DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT} SA-SAMS).`);
    process.exit(1);
}
main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
});
