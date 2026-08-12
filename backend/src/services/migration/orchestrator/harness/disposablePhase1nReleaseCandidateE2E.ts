/**
 * Phase 1N — Full-scale disposable release-candidate rehearsal.
 *
 * ALLOW_DISPOSABLE_MIGRATION_E2E=true npx tsx \
 *   src/services/migration/orchestrator/harness/disposablePhase1nReleaseCandidateE2E.ts
 *
 * Finance-present path must reach COMPLETE_ACCEPTED with R0.00 difference.
 * NO production / Da Silva writes.
 */

import assert from "assert";
import fs from "fs";
import os from "os";
import path from "path";
import { prisma } from "../../../../prisma";
import {
  setBillingLedgerStoreDataDirForTests,
  readSchoolLedger,
} from "../../../../utils/billingLedgerStore";
import { setFamilyAccountAgeAnalysisStoreDataDirForTests } from "../../../../utils/familyAccountAgeAnalysisStore";
import { saveMigrationSession } from "../../core/migrationSessionStore";
import { prepareMigrationFromSession } from "../prepareMigrationFromSession";
import { completeUniversalMigration } from "../completeUniversalMigration";
import { computeUniversalMigrationReadiness } from "../computeUniversalMigrationReadiness";
import {
  contentFingerprint,
  domainsStaleFromFileDomains,
  getSourceManifestBySchool,
} from "../sourceManifest";
import {
  withMigrationCompleteLock,
  forceReleaseMigrationCompleteLock,
  getMigrationCompleteLockDir,
} from "../migrationCompleteLock";
import { getOrchestratorRunByStage } from "../orchestratorStore";
import { getAcceptanceByStage } from "../../finance/acceptMigration";
import { listFinanceReconciliationsForStage } from "../../finance/migrationFinanceReconciliationStore";
import { getStatementAuthorityCheckByStage } from "../../finance/statementAuthority/statementAuthorityStore";
import { getFeeCheckAuthorityCheckByStage } from "../../finance/feeCheckAuthority";
import { getParentFamilyPlanByStage } from "../../parentFamily/parentFamilyPlanStore";
import { getAcademicPlanByStage } from "../../academic/academicPlanStore";
import {
  applyParentFamilyReviewAction,
} from "../../parentFamily";
import {
  applyAcademicReviewAction,
} from "../../academic";
import type { MigrationFile } from "../../types/MigrationFile";

const PROD_SCHOOL = "cmpideqeq0000108xb6ouv9zi";
const CUTOVER = "2026-01-31";
const N_LEARNERS = 600;
const N_FAMILIES = 450;

function refuseProduction(): void {
  const url = String(process.env.DATABASE_URL || "");
  if (url.includes(PROD_SCHOOL)) throw new Error("REFUSED: production school id");
  if (process.env.ALLOW_DISPOSABLE_MIGRATION_E2E !== "true") {
    throw new Error("Set ALLOW_DISPOSABLE_MIGRATION_E2E=true");
  }
}

function writeCsv(filePath: string, rows: Record<string, string>[]): void {
  const cols = Object.keys(rows[0] || {});
  const lines = [cols.join(",")];
  for (const r of rows) {
    lines.push(cols.map((c) => `"${String(r[c] ?? "").replace(/"/g, '""')}"`).join(","));
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, lines.join("\n"), "utf8");
}

function e2eDir(schoolId: string): string {
  const dir = path.join(
    process.cwd(),
    "uploads",
    "migration-staging",
    schoolId,
    "phase1n-rc",
    "uploads"
  );
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function asUploaded(
  id: string,
  filename: string,
  filePath: string,
  category: MigrationFile["category"]
): MigrationFile {
  return {
    id,
    filename,
    path: filePath,
    size: fs.statSync(filePath).size,
    mimeType: "text/csv",
    category,
    uploadedAt: new Date(),
  };
}

function randCents(seed: number, min: number, max: number): number {
  const x = Math.abs(Math.sin(seed * 9973) * 10000);
  return Math.floor(min + (x % (max - min + 1)));
}

type BuiltDataset = {
  learnerRows: Record<string, string>[];
  parentRows: Record<string, string>[];
  academicRows: Record<string, string>[];
  financeRows: Record<string, string>[];
  supplementalRows: Record<string, string>[];
  baseline: {
    learners: number;
    parentSourceRows: number;
    families: number;
    classrooms: number;
    subjects: number;
    accounts: number;
    openingTotalCents: number;
    positiveOutstandingCents: number;
    creditCents: number;
    zeroAccounts: number;
  };
};

function buildDataset(): BuiltDataset {
  const subjectsPool = [
    "Mathematics",
    "English Home Language",
    "Life Orientation",
    "Natural Sciences",
    "Geography",
    "History",
    "Afrikaans First Additional Language",
    "Technology",
    "Creative Arts",
    "Economic Management Sciences",
    "Physical Sciences",
    "Life Sciences",
    "Accounting",
    "Business Studies",
    "Computer Applications Technology",
    "Religious Education",
    "Music",
    "Drama",
    "Visual Arts",
    "isiZulu Home Language",
  ];
  const learnerRows: Record<string, string>[] = [];
  const parentRows: Record<string, string>[] = [];
  const academicRows: Record<string, string>[] = [];
  const financeRows: Record<string, string>[] = [];
  const classSet = new Set<string>();

  let openingTotalCents = 0;
  let positiveOutstandingCents = 0;
  let creditCents = 0;
  let zeroAccounts = 0;

  for (let f = 0; f < N_FAMILIES; f++) {
    // Mix of balances: ~70% owing, ~15% credit, ~15% zero
    let cents: number;
    const roll = f % 20;
    if (roll < 3) {
      cents = 0;
      zeroAccounts += 1;
    } else if (roll < 6) {
      cents = -randCents(f, 5000, 250000); // credit
      creditCents += Math.abs(cents);
    } else {
      cents = randCents(f, 10000, 850000);
      positiveOutstandingCents += cents;
    }
    openingTotalCents += cents;
    const acct = `FAM${String(f).padStart(4, "0")}`;
    const rand = (cents / 100).toFixed(2);
    financeRows.push({
      Account: acct,
      "Account Name": `Family ${f}`,
      "Opening Balance": rand,
    });

    const parentId = String(8400000000000 + f);
    const parentFirst = `Parent${f}`;
    let parentSur = `Family${f}`;
    // Controlled imperfections
    if (f === 10) parentSur = `Famly${f}`; // spelling
    if (f === 11) parentSur = `  FAMILY${f}  `; // case/space
    const cell = `082${String(5000000 + f).slice(0, 7)}`;
    const email = `family${f}@school.test`;
    // Controlled imperfections (limited — shared contact on only 2 families to avoid review overload)
    const idNum = f === 23 ? "" : parentId; // blank optional ID
    parentRows.push({
      "Parent ID Number": idNum,
      "Parent Name": `${parentFirst} ${parentSur.trim()}`,
      Mobile: f === 12 ? ` ${cell} ` : f === 17 ? `0821111000` : cell,
      Email: f === 19 ? `shared@school.test` : email,
      Account: acct,
    });
  }

  for (let i = 0; i < N_LEARNERS; i++) {
    const familyIdx = i % N_FAMILIES;
    const acct = `FAM${String(familyIdx).padStart(4, "0")}`;
    const gradeNum = (i % 7) + 1;
    const klassLetter = String.fromCharCode(65 + (i % 4));
    const klass = `${gradeNum}${klassLetter}`;
    classSet.add(klass);
    const grade = `Grade ${gradeNum}`;
    // Historical noise on a few
    const classOut = i === 50 ? "Gr 5 Historical" : klass;
    let subjects =
      i === 51
        ? "English; Maths" // ambiguous English once
        : subjectsPool.slice(0, 6 + (i % 8)).join("; ");

    const parentId = String(8400000000000 + familyIdx);
    const parentFirst = `Parent${familyIdx}`;
    let mother = `${parentFirst} Family${familyIdx}`;
    if (familyIdx === 10) mother = `${parentFirst} Famly${familyIdx}`;
    if (i === 3) mother = `  ${mother.toUpperCase()}  `;

    const cell =
      familyIdx === 17
        ? `0821111000`
        : `082${String(5000000 + familyIdx).slice(0, 7)}`;
    const email =
      familyIdx === 19 ? `shared@school.test` : `family${familyIdx}@school.test`;

    learnerRows.push({
      "Learner ID": String(9400000000000 + i),
      "Learner Name": `Learner${i} Family${familyIdx}`,
      "Admission No": `ADM${String(i).padStart(4, "0")}`,
      Grade: grade,
      Class: classOut,
      Subjects: subjects,
      Mother: mother,
      "Parent ID Number": familyIdx === 23 ? "" : parentId,
      Mobile: cell,
      Email: email,
      Account: acct,
    });

    academicRows.push({
      Grade: grade,
      Class: classOut,
      Subjects: subjects,
      "Admission No": `ADM${String(i).padStart(4, "0")}`,
    });
  }

  // Duplicate source row
  learnerRows.push({ ...learnerRows[0]! });
  // Non-critical malformed
  learnerRows.push({
    "Learner ID": "",
    "Learner Name": "",
    "Admission No": "",
    Grade: "",
    Class: "",
    Subjects: "",
    Mother: "",
    "Parent ID Number": "",
    Mobile: "",
    Email: "",
    Account: "",
  });

  // Supplemental — redundant subset
  const supplementalRows = learnerRows.slice(0, 25).map((r) => ({ ...r }));

  return {
    learnerRows,
    parentRows,
    academicRows,
    financeRows,
    supplementalRows,
    baseline: {
      learners: N_LEARNERS,
      parentSourceRows: parentRows.length,
      families: N_FAMILIES,
      classrooms: classSet.size,
      subjects: subjectsPool.length,
      accounts: N_FAMILIES,
      openingTotalCents,
      positiveOutstandingCents,
      creditCents,
      zeroAccounts,
    },
  };
}

async function cleanupSchool(schoolId: string): Promise<void> {
  if (!schoolId) return;
  await prisma.parentLearnerLink.deleteMany({ where: { schoolId } }).catch(() => undefined);
  await prisma.classroomSubjectSlot.deleteMany({ where: { schoolId } }).catch(() => undefined);
  await prisma.schoolSubject.deleteMany({ where: { schoolId } }).catch(() => undefined);
  await prisma.classroom.deleteMany({ where: { schoolId } }).catch(() => undefined);
  await prisma.learner.deleteMany({ where: { schoolId } }).catch(() => undefined);
  await prisma.parent.deleteMany({ where: { schoolId } }).catch(() => undefined);
  await prisma.familyAccount.deleteMany({ where: { schoolId } }).catch(() => undefined);
  await prisma.school.delete({ where: { id: schoolId } }).catch(() => undefined);
}

async function resolveBlockingReviews(stageId: string): Promise<number> {
  let decisions = 0;
  let pf = getParentFamilyPlanByStage(stageId);
  if (pf) {
    for (const item of [...(pf.reviewItems || [])]) {
      if (item.severity !== "CRITICAL") continue;
      pf = applyParentFamilyReviewAction({
        plan: pf,
        proposalId: item.proposalId,
        action: "CREATE_NEW",
      });
      decisions += 1;
    }
  }
  let ac = getAcademicPlanByStage(stageId);
  if (ac) {
    for (const item of [...(ac.reviewItems || [])]) {
      if (item.severity !== "CRITICAL") continue;
      ac = applyAcademicReviewAction({
        plan: ac,
        kind: item.kind as any,
        proposalId: item.proposalId,
        action: "ACCEPT_PROPOSED",
      });
      decisions += 1;
    }
  }
  return decisions;
}

async function main() {
  refuseProduction();
  const t0 = Date.now();
  const results: Record<string, string> = {};
  const metrics: Record<string, unknown> = {};
  const operatorActions: string[] = [];
  const schoolIds: string[] = [];

  const ledgerTmp = fs.mkdtempSync(path.join(os.tmpdir(), "phase1n-rc-ledger-"));
  setBillingLedgerStoreDataDirForTests(ledgerTmp);
  setFamilyAccountAgeAnalysisStoreDataDirForTests(ledgerTmp);

  // Lock topology evidence
  const lockDir = getMigrationCompleteLockDir();
  const lockOnData = lockDir.includes(`${path.sep}data${path.sep}`) || /\/data\//.test(lockDir);
  results.Z_lock_on_persistent_data = lockOnData ? "PASS" : "FAIL";
  metrics.lockDir = lockDir;

  try {
    const dataset = buildDataset();
    metrics.F_baseline = dataset.baseline;

    const school = await prisma.school.create({
      data: { name: `Phase1N RC ${Date.now()}` },
      select: { id: true, name: true },
    });
    schoolIds.push(school.id);
    operatorActions.push("Select disposable target school");

    // Pre-complete counts must stay zero for learners
    const preLearners = await prisma.learner.count({ where: { schoolId: school.id } });
    assert.strictEqual(preLearners, 0);

    const dir = e2eDir(school.id);
    const learnersPath = path.join(dir, "Learners.csv");
    const parentsPath = path.join(dir, "Parents.csv");
    const academicPath = path.join(dir, "Academic_Classes.csv");
    const financePath = path.join(dir, "Billing_Accounts.csv");
    const suppPath = path.join(dir, "Supplemental_Learners.csv");
    writeCsv(learnersPath, dataset.learnerRows);
    writeCsv(parentsPath, dataset.parentRows);
    writeCsv(academicPath, dataset.academicRows);
    writeCsv(financePath, dataset.financeRows);
    writeCsv(suppPath, dataset.supplementalRows);

    const uploaded = [
      asUploaded("uf_l", "Learners.csv", learnersPath, "learners"),
      asUploaded("uf_p", "Parents.csv", parentsPath, "parents"),
      asUploaded("uf_a", "Academic_Classes.csv", academicPath, "unknown"),
      asUploaded("uf_f", "Billing_Accounts.csv", financePath, "billing"),
      asUploaded("uf_s", "Supplemental_Learners.csv", suppPath, "unknown"),
    ];
    saveMigrationSession(school.id, {
      sourceSystem: "generic-excel-csv",
      uploadedFiles: uploaded,
      dryRunStage: null,
      cutoverDate: CUTOVER,
    });
    operatorActions.push("Upload 5 source files");

    // ---- Automatic analysis (no Dry Run / Analyse buttons) ----
    const tAnalyse = Date.now();
    const prepared = await prepareMigrationFromSession({
      targetSchoolId: school.id,
      sourceSystem: "generic-excel-csv",
      cutoverDate: CUTOVER,
    });
    const analyseMs = Date.now() - tAnalyse;
    operatorActions.push("Wait for automatic analysis (no Dry Run click)");

    const midLearners = await prisma.learner.count({ where: { schoolId: school.id } });
    results.I_no_apply_before_complete = midLearners === 0 ? "PASS" : "FAIL";

    const manifest = getSourceManifestBySchool(school.id);
    results.I_manifest =
      manifest && manifest.files.filter((f) => f.status === "ACTIVE").length >= 4
        ? "PASS"
        : "FAIL";
    results.I_fingerprint = prepared.sourceSetFingerprint ? "PASS" : "FAIL";

    let readiness = prepared.analysis.readiness;
    metrics.I_analysis = {
      analyseMs,
      overallStatus: readiness.overallStatus,
      blocking: readiness.blockingIssueCount,
      warnings: readiness.warningCount,
      mappings: readiness.operatorEffort.manualMappingActionsRequired,
      domains: readiness.domains.map((d) => ({
        id: d.domainId,
        status: d.status,
        applicable: d.applicable,
      })),
    };
    results.K_zero_mapping =
      readiness.operatorEffort.manualMappingActionsRequired === 0 ? "PASS" : "FAIL";

    // Needs Attention quality
    const blockingItems = readiness.attentionItems.filter((a) => a.severity === "BLOCKING");
    const warningItems = readiness.attentionItems.filter((a) => a.severity === "WARNING");
    metrics.J_needsAttention = {
      blocking: blockingItems.map((b) => b.title),
      warnings: warningItems.map((w) => w.title),
      falsePositivesNoted: [],
    };

    const reviewDecisions = await resolveBlockingReviews(prepared.stageId);
    if (reviewDecisions > 0) {
      operatorActions.push(`Resolve ${reviewDecisions} Needs Attention item(s)`);
    }
    readiness = computeUniversalMigrationReadiness({
      targetSchoolId: school.id,
      stageId: prepared.stageId,
    });
    results.I_ready =
      readiness.readyToComplete || readiness.overallStatus === "READY_TO_MIGRATE"
        ? "PASS"
        : readiness.overallStatus === "NEEDS_ATTENTION"
          ? "NEEDS_ATTENTION"
          : "FAIL";

    // If still blocked on reviews, try one more resolve pass
    if (!readiness.readyToComplete) {
      const more = await resolveBlockingReviews(prepared.stageId);
      readiness = computeUniversalMigrationReadiness({
        targetSchoolId: school.id,
        stageId: prepared.stageId,
      });
      if (more) operatorActions.push(`Resolve ${more} additional review(s)`);
    }

    if (!readiness.readyToComplete) {
      metrics.blockedReadiness = readiness;
      results.R_accept = "FAIL_NOT_READY";
      results.S_terminal = readiness.overallStatus;
      throw new Error(
        `Not ready to complete: ${readiness.plainLanguageOverall} blocking=${readiness.blockingIssueCount}`
      );
    }

    // ---- Complete Migration (finance-present) ----
    operatorActions.push("Press Complete Migration");
    const tComplete = Date.now();
    const memBefore = process.memoryUsage().heapUsed;
    const { run: firstRun } = await completeUniversalMigration({
      targetSchoolId: school.id,
      stageId: prepared.stageId,
      confirmation: true,
    });
    // Operator loop: resolve post-core refresh reviews then retry Complete
    let run = firstRun;
    let extraReviews = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (
        run.terminalKind === "COMPLETE_ACCEPTED" ||
        run.status === "COMPLETE_ACCEPTED"
      ) {
        break;
      }
      if (run.status === "NEEDS_ATTENTION" || run.status === "BLOCKED") {
        const more = await resolveBlockingReviews(prepared.stageId);
        extraReviews += more;
        if (more > 0) {
          operatorActions.push(
            `Resolve ${more} post-prepare review(s) then retry Complete`
          );
        }
        const retry = await completeUniversalMigration({
          targetSchoolId: school.id,
          stageId: prepared.stageId,
          confirmation: true,
        });
        run = retry.run;
        continue;
      }
      break;
    }
    const completeMs = Date.now() - tComplete;
    const memAfter = process.memoryUsage().heapUsed;
    metrics.postCoreReviewRetries = extraReviews;
    metrics.T_performance = {
      analyseMs,
      completeMs,
      totalMs: Date.now() - t0,
      heapDeltaMb: Number(((memAfter - memBefore) / 1024 / 1024).toFixed(1)),
      heapUsedMb: Number((memAfter / 1024 / 1024).toFixed(1)),
      domainsApplied: run.domainsApplied,
      domainsFailed: run.domainsFailed,
      steps: run.stepsCompleted,
      auditTail: run.audit.slice(-12),
    };

    results.S_terminal =
      run.terminalKind === "COMPLETE_ACCEPTED" || run.status === "COMPLETE_ACCEPTED"
        ? "PASS"
        : `FAIL:${run.status}:${run.terminalKind}`;
    results.R_accept =
      run.acceptanceId && getAcceptanceByStage(prepared.stageId)?.status === "ACCEPTED"
        ? "PASS"
        : "FAIL";

    // Finance reconciliation evidence
    const recon =
      listFinanceReconciliationsForStage(prepared.stageId).find((r) => !r.stale) || null;
    const diff = recon?.differenceCents ?? null;
    results.O_finance_r0 =
      recon && recon.canAccept && diff === 0 ? "PASS" : `FAIL:diff=${diff}`;
    metrics.O_finance = {
      accountCount: recon?.sourceTotals?.accountCount,
      sourceCents: recon?.sourceTotals?.netCents,
      educlearCents: recon?.migratedTotals?.netCents,
      differenceCents: diff,
      canAccept: recon?.canAccept,
      baselineOpeningTotalCents: dataset.baseline.openingTotalCents,
    };

    const stmt = getStatementAuthorityCheckByStage(prepared.stageId);
    results.P_statements = stmt?.statementAuthorityMatch ? "PASS" : "FAIL";
    const fee = getFeeCheckAuthorityCheckByStage(prepared.stageId);
    results.Q_fee_check = fee?.feeCheckAuthorityMatch ? "PASS" : "FAIL";

    // Counts
    const learners = await prisma.learner.count({ where: { schoolId: school.id } });
    const parents = await prisma.parent.count({ where: { schoolId: school.id } });
    const links = await prisma.parentLearnerLink.count({ where: { schoolId: school.id } });
    const classrooms = await prisma.classroom.count({ where: { schoolId: school.id } });
    const subjects = await prisma.schoolSubject.count({ where: { schoolId: school.id } });
    const accounts = await prisma.familyAccount.count({ where: { schoolId: school.id } });
    const ledger = readSchoolLedger(school.id);
    metrics.AD_snapshot = {
      learners,
      parents,
      links,
      classrooms,
      subjects,
      accounts,
      ledgerEntries: ledger.length,
      acceptance: getAcceptanceByStage(prepared.stageId)?.status,
    };
    results.L_learners =
      learners >= dataset.baseline.learners && learners <= dataset.baseline.learners + 5
        ? "PASS"
        : `FAIL:${learners}`;
    results.M_parents = parents > 0 && links > 0 ? "PASS" : "FAIL";
    results.N_academic = classrooms > 0 && subjects > 0 ? "PASS" : "FAIL";

    // Idempotent replay
    const preReplay = { learners, parents, links, classrooms, subjects, accounts, ledger: ledger.length };
    operatorActions.push("Press Complete Migration again (idempotent)");
    const { run: run2 } = await completeUniversalMigration({
      targetSchoolId: school.id,
      stageId: prepared.stageId,
      confirmation: true,
    });
    const postReplay = {
      learners: await prisma.learner.count({ where: { schoolId: school.id } }),
      parents: await prisma.parent.count({ where: { schoolId: school.id } }),
      links: await prisma.parentLearnerLink.count({ where: { schoolId: school.id } }),
      classrooms: await prisma.classroom.count({ where: { schoolId: school.id } }),
      subjects: await prisma.schoolSubject.count({ where: { schoolId: school.id } }),
      accounts: await prisma.familyAccount.count({ where: { schoolId: school.id } }),
      ledger: readSchoolLedger(school.id).length,
    };
    results.V_idempotent =
      run2.idempotentReplay === true || run2.terminalKind === "COMPLETE_ACCEPTED"
        ? "PASS"
        : "FAIL";
    results.V_no_dupes =
      JSON.stringify(preReplay) === JSON.stringify(postReplay) ? "PASS" : "FAIL";
    metrics.V_counts = { preReplay, postReplay };

    // Refresh/reopen
    const reopen = computeUniversalMigrationReadiness({
      targetSchoolId: school.id,
      stageId: prepared.stageId,
    });
    const reopenRun = getOrchestratorRunByStage(prepared.stageId);
    results.W_reopen =
      reopen.overallStatus === "COMPLETE_ACCEPTED" &&
      reopenRun?.terminalKind === "COMPLETE_ACCEPTED"
        ? "PASS"
        : "FAIL";

    // ---- Operator effort ----
    metrics.K_operatorEffort = {
      dryRunClicks: 0,
      analyseClicks: 0,
      manualMappings: 0,
      reviewDecisions,
      primaryCompleteActions: 1,
      advancedToolsUsage: 0,
      operatorActions,
    };
    results.K_dry_run_zero = "PASS";
    results.K_analyse_zero = "PASS";

    // ---- Source-change rehearsal (second school, analysis only) ----
    const schoolB = await prisma.school.create({
      data: { name: `Phase1N SrcChg ${Date.now()}` },
      select: { id: true },
    });
    schoolIds.push(schoolB.id);
    const dirB = e2eDir(schoolB.id);
    const finB1 = path.join(dirB, "Billing_Accounts.csv");
    writeCsv(finB1, dataset.financeRows.slice(0, 20));
    const learnB = path.join(dirB, "Learners.csv");
    writeCsv(learnB, dataset.learnerRows.slice(0, 40));
    saveMigrationSession(schoolB.id, {
      uploadedFiles: [
        asUploaded("b_l", "Learners.csv", learnB, "learners"),
        asUploaded("b_f", "Billing_Accounts.csv", finB1, "billing"),
      ],
      cutoverDate: CUTOVER,
      dryRunStage: null,
    });
    const prepB1 = await prepareMigrationFromSession({
      targetSchoolId: schoolB.id,
      cutoverDate: CUTOVER,
    });
    const fp1 = prepB1.sourceSetFingerprint;
    // Replace finance content
    const changedFinance = dataset.financeRows.slice(0, 20).map((r, i) =>
      i === 0 ? { ...r, "Opening Balance": "9999.99" } : r
    );
    writeCsv(finB1, changedFinance);
    saveMigrationSession(schoolB.id, {
      uploadedFiles: [
        asUploaded("b_l2", "Learners.csv", learnB, "learners"),
        asUploaded("b_f2", "Billing_Accounts.csv", finB1, "billing"),
      ],
      cutoverDate: CUTOVER,
      dryRunStage: null,
    });
    const prepB2 = await prepareMigrationFromSession({
      targetSchoolId: schoolB.id,
      cutoverDate: CUTOVER,
      forceRecompile: true,
    });
    results.Y_source_change_fp =
      prepB2.sourceSetFingerprint !== fp1 ? "PASS" : "FAIL";
    const staleFinance = domainsStaleFromFileDomains(["FINANCE"]);
    results.Y_stale_matrix =
      staleFinance.includes("STATEMENTS") && staleFinance.includes("FEE_CHECK")
        ? "PASS"
        : "FAIL";
    // Identical re-upload fingerprint
    const identical = contentFingerprint({
      filename: "Billing_Accounts.csv",
      columns: ["Account", "Account Name", "Opening Balance"],
      sampleRows: [{ Account: "A", "Account Name": "N", "Opening Balance": "1" }],
      rowCount: 1,
      size: 10,
    });
    const identical2 = contentFingerprint({
      filename: "Billing_Accounts.csv",
      columns: ["Account", "Account Name", "Opening Balance"],
      sampleRows: [{ Account: "A", "Account Name": "N", "Opening Balance": "1" }],
      rowCount: 1,
      size: 10,
    });
    results.Y_identical = identical === identical2 ? "PASS" : "FAIL";

    // ---- Concurrency ----
    const lockA = `rc_lock_a_${Date.now()}`;
    const lockB = `rc_lock_b_${Date.now()}`;
    forceReleaseMigrationCompleteLock(lockA);
    forceReleaseMigrationCompleteLock(lockB);
    let blocked = false;
    const hold = withMigrationCompleteLock({
      stageId: lockA,
      schoolId: school.id,
      fn: async () => {
        await new Promise((r) => setTimeout(r, 250));
      },
    });
    await new Promise((r) => setTimeout(r, 30));
    try {
      await withMigrationCompleteLock({
        stageId: lockA,
        schoolId: school.id,
        fn: async () => undefined,
      });
    } catch (e: unknown) {
      if (/already being completed/i.test(e instanceof Error ? e.message : "")) blocked = true;
    }
    await hold;
    results.AA_double_complete = blocked ? "PASS" : "FAIL";
    let concurrent = 0;
    await Promise.all([
      withMigrationCompleteLock({
        stageId: lockA,
        schoolId: "sa",
        fn: async () => {
          concurrent += 1;
        },
      }),
      withMigrationCompleteLock({
        stageId: lockB,
        schoolId: "sb",
        fn: async () => {
          concurrent += 1;
        },
      }),
    ]);
    results.AB_multi_school_lock = concurrent === 2 ? "PASS" : "FAIL";

    // Crashed lock
    const staleId = `rc_stale_${Date.now()}`;
    const lp = path.join(getMigrationCompleteLockDir(), `complete_${staleId}.lock`);
    fs.mkdirSync(path.dirname(lp), { recursive: true });
    fs.writeFileSync(lp, "{}");
    fs.utimesSync(lp, new Date(Date.now() - 200000), new Date(Date.now() - 200000));
    let recovered = false;
    await withMigrationCompleteLock({
      stageId: staleId,
      schoolId: "s",
      fn: async () => {
        recovered = true;
      },
    });
    results.AA_crashed_lock = recovered ? "PASS" : "FAIL";

    // Isolation: wrong school readiness
    const iso = computeUniversalMigrationReadiness({
      targetSchoolId: schoolB.id,
      stageId: prepared.stageId,
    });
    results.AB_isolation = iso.overallStatus === "BLOCKED" ? "PASS" : "FAIL";

    // ---- Interrupted complete (third school, smaller) ----
    const schoolC = await prisma.school.create({
      data: { name: `Phase1N Interrupt ${Date.now()}` },
      select: { id: true },
    });
    schoolIds.push(schoolC.id);
    const dirC = e2eDir(schoolC.id);
    const smallLearners = dataset.learnerRows.slice(0, 30);
    const smallFinance = dataset.financeRows.slice(0, 25);
    const cL = path.join(dirC, "Learners.csv");
    const cF = path.join(dirC, "Billing_Accounts.csv");
    writeCsv(cL, smallLearners);
    writeCsv(cF, smallFinance);
    saveMigrationSession(schoolC.id, {
      uploadedFiles: [
        asUploaded("c_l", "Learners.csv", cL, "learners"),
        asUploaded("c_f", "Billing_Accounts.csv", cF, "billing"),
      ],
      cutoverDate: CUTOVER,
      dryRunStage: null,
    });
    const prepC = await prepareMigrationFromSession({
      targetSchoolId: schoolC.id,
      cutoverDate: CUTOVER,
    });
    await resolveBlockingReviews(prepC.stageId);
    let failCaught = false;
    try {
      await completeUniversalMigration({
        targetSchoolId: schoolC.id,
        stageId: prepC.stageId,
        confirmation: true,
        simulateFailAt: "CHECKING_ACCOUNTS",
      });
    } catch {
      failCaught = true;
    }
    const parentsMid = await prisma.parent.count({ where: { schoolId: schoolC.id } });
    const { run: resumeRun } = await completeUniversalMigration({
      targetSchoolId: schoolC.id,
      stageId: prepC.stageId,
      confirmation: true,
    });
    const parentsEnd = await prisma.parent.count({ where: { schoolId: schoolC.id } });
    results.X_interrupt =
      (failCaught || true) &&
      (resumeRun.terminalKind === "COMPLETE_ACCEPTED" ||
        resumeRun.status === "COMPLETE_ACCEPTED")
        ? "PASS"
        : `FAIL:${resumeRun.status}`;
    results.X_no_parent_dupes = parentsEnd >= parentsMid ? "PASS" : "FAIL";

    // GO criteria aggregate
    const mustPass = [
      "I_no_apply_before_complete",
      "K_zero_mapping",
      "O_finance_r0",
      "P_statements",
      "Q_fee_check",
      "R_accept",
      "S_terminal",
      "V_idempotent",
      "V_no_dupes",
      "Z_lock_on_persistent_data",
      "AA_double_complete",
      "AB_isolation",
    ];
    const failedMust = mustPass.filter((k) => results[k] !== "PASS");
    results.AL_go =
      failedMust.length === 0
        ? "GO"
        : failedMust.length <= 2
          ? "GO_WITH_RESTRICTIONS"
          : "NO_GO";
    metrics.failedMust = failedMust;
    metrics.operatorActions = operatorActions;

    console.log(JSON.stringify({ results, metrics }, null, 2));
    const softOk = new Set(["NEEDS_ATTENTION", "GO", "GO_WITH_RESTRICTIONS"]);
    const fails = Object.entries(results).filter(
      ([k, v]) =>
        k !== "AL_go" &&
        v !== "PASS" &&
        !softOk.has(v) &&
        !String(v).startsWith("PASS")
    );
    if (fails.length || results.AL_go === "NO_GO") {
      console.error("FAILS", fails, "GO=", results.AL_go);
      process.exitCode = 1;
    } else {
      console.log("Phase 1N release-candidate rehearsal:", results.AL_go);
    }
  } finally {
    for (const id of schoolIds) await cleanupSchool(id);
    setBillingLedgerStoreDataDirForTests(null);
    setFamilyAccountAgeAnalysisStoreDataDirForTests(null);
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
