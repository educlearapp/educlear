import fs from "fs";
import path from "path";

import { prisma } from "../../../prisma";
import { normalizeClassroomInput } from "../../../utils/classroomNormalization";
import { resolveLearnerGender } from "../../../utils/learnerGender";
import {
  calculateBalanceFromEntries,
  normaliseIsoDate,
  readSchoolLedger,
  upsertSchoolEntries,
  type BillingLedgerEntry,
} from "../../../utils/billingLedgerStore";
import {
  KIDESYS_DISPLAY_HISTORY_SOURCE,
  readSchoolKidesysHistory,
  writeSchoolKidesysHistory,
  type KidesysHistoryEntry,
} from "../../../utils/kidesysTransactionHistoryStore";
import {
  upsertSchoolBillingPlans,
  type StoredBillingPlanItem,
} from "../../../utils/learnerBillingPlanStore";
import { parseKidEsysDate } from "../../../utils/kideesysSpreadsheet";
import { normalizeSaPhone } from "../../parentPortalService";
import { syncParentThreadsForClassroom } from "../../parentPortalService";
import { buildAccountsFromLearners } from "../../statementAccounts";
import { relinkLedgerLearnerIds } from "../../../utils/billingLedgerStore";
import {
  loadKidESysCsvBundle,
  type KidESysCsvBundle,
  type ParsedKidESysAccount,
  type ParsedKidESysChild,
  type ParsedKidESysChildParent,
} from "./kideesysCsvParser";
import { KIDESYS_OPENING_BALANCE_LABEL } from "../daSilvaOpeningBalance";

export const KIDEESYS_CSV_MIGRATION_SOURCE = "kidesys_csv_migration" as const;
export const KIDEESYS_CSV_OPENING_SOURCE = "kidesys_csv_opening_balance" as const;

export type KidESysCsvImportManifest = {
  schoolId: string;
  projectId: string;
  sourcePath: string;
  importedAt: string;
  dryRun: boolean;
  learnerIds: string[];
  parentIds: string[];
  linkIds: string[];
  classroomIds: string[];
  familyAccountIds: string[];
  ledgerEntryIds: string[];
  historyEntryIds: string[];
  childIdToLearnerId: Record<string, string>;
  accountNoToLearnerId: Record<string, string>;
  accountIdToAccountNo: Record<string, string>;
};

export type KidESysCsvImportResult = {
  schoolId: string;
  projectId: string;
  dryRun: boolean;
  bundle: KidESysCsvBundle;
  imported: Record<string, number>;
  manifest: KidESysCsvImportManifest;
  backupPath?: string;
};

export type KidESysCsvImportAudit = {
  schoolId: string;
  auditedAt: string;
  sourcePath: string | null;
  bundleCounts: {
    children: number;
    childParents: number;
    accounts: number;
    invoices: number;
    payments: number;
    journals: number;
    monthlyAccounts: number;
  };
  learnersTotal: number;
  learnersWithDob: number;
  learnersWithGender: number;
  learnersWithClassName: number;
  learnersWithAdmissionNo: number;
  learnersWithFamilyAccountId: number;
  parentLinksTotal: number;
  parentLinksResolvable: number;
  ledgerInvoiceCount: number;
  ledgerPaymentCount: number;
  ledgerCsvSourceCount: number;
  duplicateLedgerIds: number;
  historyEntryCount: number;
  accountsWithLastInvoice: number;
  accountsWithLastPayment: number;
  balanceReconcilePassed: number;
  balanceReconcileFailed: number;
  balanceVarianceSamples: Array<{ accountNo: string; target: number; ledger: number; variance: number }>;
  namePopulatedCount: number;
  surnamePopulatedCount: number;
  idPopulatedCount: number;
  classroomPopulatedCount: number;
  familyAccountsCount: number;
  invoicesCount: number;
  paymentsCount: number;
  journalsCount: number;
  gatePassed: boolean;
  gateErrors: string[];
};

export type KidESysCsvBackupSnapshot = {
  schoolId: string;
  backedUpAt: string;
  backupPath: string;
  counts: {
    learners: number;
    parents: number;
    parentLinks: number;
    familyAccounts: number;
    billingPlans: number;
    ledgerEntries: number;
    historyEntries: number;
    totalBalance: number;
  };
};

async function writeSchoolBackupSnapshot(schoolId: string): Promise<KidESysCsvBackupSnapshot> {
  const backedUpAt = new Date().toISOString();
  const stamp = backedUpAt.replace(/[:.]/g, "-");
  const dir = path.join(
    process.cwd(),
    "uploads",
    "migration-staging",
    schoolId,
    "backups"
  );
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const backupPath = path.join(dir, `pre-import-${stamp}.json`);

  const [
    learners,
    parents,
    parentLinks,
    familyAccounts,
    ledger,
    history,
  ] = await Promise.all([
    prisma.learner.count({ where: { schoolId } }),
    prisma.parent.count({ where: { schoolId } }),
    prisma.parentLearnerLink.count({ where: { schoolId } }),
    prisma.familyAccount.count({ where: { schoolId } }),
    Promise.resolve(readSchoolLedger(schoolId)),
    Promise.resolve(readSchoolKidesysHistory(schoolId)),
  ]);

  let billingPlans = 0;
  try {
    const plansPath = path.join(process.cwd(), "data", "learner-billing-plans.json");
    if (fs.existsSync(plansPath)) {
      const raw = JSON.parse(fs.readFileSync(plansPath, "utf8")) as Record<string, unknown>;
      const schoolPlans = raw[schoolId];
      if (schoolPlans && typeof schoolPlans === "object") {
        billingPlans = Object.keys(schoolPlans as object).length;
      }
    }
  } catch {
    /* ignore */
  }

  const totalBalance = Math.round(calculateBalanceFromEntries(ledger) * 100) / 100;

  const snapshot: KidESysCsvBackupSnapshot = {
    schoolId,
    backedUpAt,
    backupPath,
    counts: {
      learners,
      parents,
      parentLinks,
      familyAccounts,
      billingPlans,
      ledgerEntries: ledger.length,
      historyEntries: history.length,
      totalBalance,
    },
  };

  fs.writeFileSync(backupPath, JSON.stringify(snapshot, null, 2));
  return snapshot;
}

function manifestPath(schoolId: string, projectId: string): string {
  return path.join(
    process.cwd(),
    "uploads",
    "migration-staging",
    schoolId,
    `kideesys-csv-${projectId}.manifest.json`
  );
}

function ensureManifestDir(schoolId: string) {
  const dir = path.join(process.cwd(), "uploads", "migration-staging", schoolId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function loadKidESysCsvImportManifest(
  schoolId: string,
  projectId: string
): KidESysCsvImportManifest | null {
  const file = manifestPath(schoolId, projectId);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as KidESysCsvImportManifest;
  } catch {
    return null;
  }
}

function writeManifest(manifest: KidESysCsvImportManifest) {
  ensureManifestDir(manifest.schoolId);
  fs.writeFileSync(manifestPath(manifest.schoolId, manifest.projectId), JSON.stringify(manifest, null, 2));
}

function pushUnique(list: string[], id: string) {
  if (id && !list.includes(id)) list.push(id);
}

function csvLedgerId(kind: string, externalId: string): string {
  return `kidesys-csv-${kind}-${String(externalId || "").trim()}`;
}

function csvHistoryId(kind: string, externalId: string, accountNo: string): string {
  return `kidesys-csv-hist-${kind}-${String(externalId || "").trim()}-${String(accountNo || "").trim()}`;
}

function csvOpeningId(accountNo: string): string {
  return `kidesys-csv-opening-${String(accountNo || "").trim()}`;
}

function resolveIsoDate(raw: string | null | undefined): string {
  const fromKid = raw ? parseKidEsysDate(raw) : null;
  if (fromKid) return fromKid;
  return normaliseIsoDate(raw || "");
}

function parseBirthDate(raw: string | null): Date | null {
  const iso = resolveIsoDate(raw);
  if (!iso) return null;
  const dt = new Date(`${iso}T00:00:00.000Z`);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function seedAccountLearnerSeqFromExisting(
  existing: Array<{ admissionNo: string | null }>
): Map<string, number> {
  const accountLearnerSeq = new Map<string, number>();
  for (const row of existing) {
    const adm = String(row.admissionNo || "").trim();
    if (!adm) continue;
    const dash = adm.indexOf("-");
    if (dash === -1) {
      accountLearnerSeq.set(adm, Math.max(accountLearnerSeq.get(adm) || 0, 1));
      continue;
    }
    const base = adm.slice(0, dash);
    const seq = Number.parseInt(adm.slice(dash + 1), 10);
    if (base && Number.isFinite(seq)) {
      accountLearnerSeq.set(base, Math.max(accountLearnerSeq.get(base) || 0, seq));
    }
  }
  return accountLearnerSeq;
}

function allocateAdmissionNo(accountNo: string, seq: Map<string, number>): string | null {
  const trimmed = String(accountNo || "").trim();
  if (!trimmed) return null;
  const next = (seq.get(trimmed) || 0) + 1;
  seq.set(trimmed, next);
  return next === 1 ? trimmed : `${trimmed}-${next}`;
}

async function findExistingLearner(opts: {
  schoolId: string;
  firstName: string;
  lastName: string;
  className: string | null;
  admissionNo: string | null;
}): Promise<string | null> {
  if (opts.admissionNo) {
    const byAdm = await prisma.learner.findUnique({
      where: {
        schoolId_admissionNo: { schoolId: opts.schoolId, admissionNo: opts.admissionNo },
      },
      select: { id: true },
    });
    if (byAdm) return byAdm.id;
  }
  const byName = await prisma.learner.findFirst({
    where: {
      schoolId: opts.schoolId,
      firstName: opts.firstName,
      lastName: opts.lastName,
      className: opts.className,
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  return byName?.id || null;
}

function accountIndex(bundle: KidESysCsvBundle): {
  byId: Map<string, ParsedKidESysAccount>;
  byNo: Map<string, ParsedKidESysAccount>;
} {
  const byId = new Map<string, ParsedKidESysAccount>();
  const byNo = new Map<string, ParsedKidESysAccount>();
  for (const account of bundle.accounts) {
    if (account.accountId) byId.set(account.accountId, account);
    if (account.accountNo) byNo.set(account.accountNo, account);
  }
  return { byId, byNo };
}

function resolveAccountNoForChild(
  child: ParsedKidESysChild,
  accounts: ReturnType<typeof accountIndex>
): string {
  const direct = String(child.accountNo || "").trim();
  if (direct) return direct;
  const byId = accounts.byId.get(child.childId);
  if (byId?.accountNo) return byId.accountNo;
  return "";
}

function enrichParentFromAccount(
  link: ParsedKidESysChildParent,
  account?: ParsedKidESysAccount
): ParsedKidESysChildParent {
  if (!account) return link;
  return {
    ...link,
    parentFirstName: link.parentFirstName || account.contactFirstName,
    parentSurname: link.parentSurname || account.contactSurname || account.familyName,
    cellNo: link.cellNo || account.cellNo,
    workNo: link.workNo || account.workNo,
    homeNo: link.homeNo || account.homeNo,
    email: link.email || account.email,
  };
}

function buildHistoryFromLedgerEntries(
  schoolId: string,
  entries: BillingLedgerEntry[],
  importedAt: string
): KidesysHistoryEntry[] {
  const history: KidesysHistoryEntry[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (entry.type !== "invoice" && entry.type !== "payment") continue;
    if (entry.source !== KIDEESYS_CSV_MIGRATION_SOURCE) continue;
    const accountNo = String(entry.accountNo || "").trim();
    const externalId = entry.id.replace(/^kidesys-csv-(invoice|payment)-/, "");
    const id = csvHistoryId(entry.type, externalId, accountNo);
    if (seen.has(id)) continue;
    seen.add(id);
    history.push({
      id,
      schoolId,
      accountNo,
      type: entry.type,
      amount: Math.round(Math.abs(entry.amount) * 100) / 100,
      date: entry.date,
      reference: entry.reference,
      transactionNo: externalId,
      description: entry.description,
      fullName: "",
      source: KIDESYS_DISPLAY_HISTORY_SOURCE,
      importedAt,
      invoiceNumber: entry.type === "invoice" ? externalId : undefined,
      paymentNumber: entry.type === "payment" ? externalId : undefined,
      kidesysReference: entry.reference,
    });
  }
  return history;
}

function mergeHistory(existing: KidesysHistoryEntry[], incoming: KidesysHistoryEntry[]): KidesysHistoryEntry[] {
  const byId = new Map<string, KidesysHistoryEntry>();
  for (const row of existing) byId.set(row.id, row);
  for (const row of incoming) byId.set(row.id, row);
  return Array.from(byId.values());
}

/**
 * Canonical Kid-e-Sys CSV/ZIP import for Da Silva (and other schools).
 * Idempotent: stable ledger/history ids; upserts learners, parents, family accounts.
 */
export async function importKidESysCsv(opts: {
  schoolId: string;
  sourcePath: string;
  projectId?: string;
  dryRun?: boolean;
  skipBackup?: boolean;
}): Promise<KidESysCsvImportResult> {
  const schoolId = String(opts.schoolId || "").trim();
  if (!schoolId) throw new Error("schoolId is required");

  const school = await prisma.school.findUnique({ where: { id: schoolId }, select: { id: true } });
  if (!school) throw new Error("School not found");

  const projectId =
    String(opts.projectId || "").trim() ||
    `kideesys-csv-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const dryRun = Boolean(opts.dryRun);
  const bundle = loadKidESysCsvBundle(opts.sourcePath);
  const importedAt = new Date().toISOString();

  let backupPath: string | undefined;
  if (!dryRun && !opts.skipBackup) {
    const backup = await writeSchoolBackupSnapshot(schoolId);
    backupPath = backup.backupPath;
    console.log(`[kideesys-csv] School backup written: ${backupPath}`);
  }

  const existingManifest = loadKidESysCsvImportManifest(schoolId, projectId);
  const manifest: KidESysCsvImportManifest = existingManifest || {
    schoolId,
    projectId,
    sourcePath: bundle.sourcePath,
    importedAt,
    dryRun,
    learnerIds: [],
    parentIds: [],
    linkIds: [],
    classroomIds: [],
    familyAccountIds: [],
    ledgerEntryIds: [],
    historyEntryIds: [],
    childIdToLearnerId: {},
    accountNoToLearnerId: {},
    accountIdToAccountNo: {},
  };

  manifest.sourcePath = bundle.sourcePath;
  manifest.importedAt = importedAt;
  manifest.dryRun = dryRun;

  const accounts = accountIndex(bundle);
  for (const account of bundle.accounts) {
    if (account.accountId && account.accountNo) {
      manifest.accountIdToAccountNo[account.accountId] = account.accountNo;
    }
  }

  const childIdToLearnerId = new Map(Object.entries(manifest.childIdToLearnerId || {}));
  const accountNoToLearnerId = new Map(Object.entries(manifest.accountNoToLearnerId || {}));
  const accountToFamilyId = new Map<string, string>();

  const counts = {
    classrooms: 0,
    familyAccounts: 0,
    learners: 0,
    parents: 0,
    links: 0,
    billingPlans: 0,
    ledgerEntries: 0,
    openingBalances: 0,
    historyEntries: 0,
  };

  if (!dryRun) {
    const classNames = new Set<string>();
    for (const child of bundle.children) {
      if (child.enrollmentStatus === "HISTORICAL") continue;
      const norm = normalizeClassroomInput(child.className);
      const name = norm.classroomName || child.className;
      if (name) classNames.add(name);
    }
    for (const className of classNames) {
      const record = await prisma.classroom.upsert({
        where: { schoolId_name: { schoolId, name: className } },
        create: { schoolId, name: className },
        update: {},
      });
      pushUnique(manifest.classroomIds, record.id);
      counts.classrooms += 1;
    }

    for (const account of bundle.accounts) {
      const accountNo = String(account.accountNo || "").trim();
      if (!accountNo) continue;
      const existingFa = await prisma.familyAccount.findFirst({
        where: { schoolId, accountRef: accountNo },
        select: { id: true },
      });
      const fa = existingFa
        ? await prisma.familyAccount.update({
            where: { id: existingFa.id },
            data: { familyName: account.familyName || accountNo },
            select: { id: true },
          })
        : await prisma.familyAccount.create({
            data: {
              schoolId,
              accountRef: accountNo,
              familyName: account.familyName || accountNo,
            },
            select: { id: true },
          });
      accountToFamilyId.set(accountNo, fa.id);
      pushUnique(manifest.familyAccountIds, fa.id);
      counts.familyAccounts += 1;
    }

    const existingAdmissionRows = await prisma.learner.findMany({
      where: { schoolId, admissionNo: { not: null } },
      select: { admissionNo: true },
    });
    const accountLearnerSeq = seedAccountLearnerSeqFromExisting(existingAdmissionRows);

    for (const child of bundle.children) {
      const accountNo = resolveAccountNoForChild(child, accounts);
      const isHistorical = child.enrollmentStatus === "HISTORICAL";
      const norm = normalizeClassroomInput(child.className);
      const canonicalClassName = isHistorical ? null : norm.classroomName || child.className || null;
      const grade = isHistorical
        ? "Historical"
        : norm.gradeLabel || child.className.replace(/[A-Za-z]+$/, "").trim() || "Unknown";

      let learnerId = childIdToLearnerId.get(child.childId) || null;
      if (!learnerId) {
        learnerId = await findExistingLearner({
          schoolId,
          firstName: child.firstName,
          lastName: child.lastName,
          className: canonicalClassName,
          admissionNo: null,
        });
      }

      const familyAccountId = accountNo ? accountToFamilyId.get(accountNo) || null : null;
      const birthDate = parseBirthDate(child.birthDate);

      const learnerData = {
        schoolId,
        familyAccountId,
        firstName: child.firstName,
        lastName: child.lastName,
        birthDate,
        gender: resolveLearnerGender({ gender: child.gender, idNumber: child.idNumber }),
        idNumber: child.idNumber,
        homeLanguage: child.homeLanguage,
        citizenship: child.citizenship,
        grade,
        className: canonicalClassName,
        enrollmentStatus: isHistorical ? ("HISTORICAL" as const) : ("ACTIVE" as const),
        admissionNo: null as string | null,
        totalFee: 0,
        tuitionFee: 0,
      };

      if (!learnerId) {
        learnerData.admissionNo = accountNo ? allocateAdmissionNo(accountNo, accountLearnerSeq) : null;
        const created =
          learnerData.admissionNo != null
            ? await prisma.learner.upsert({
                where: {
                  schoolId_admissionNo: { schoolId, admissionNo: learnerData.admissionNo },
                },
                create: learnerData,
                update: {
                  familyAccountId: learnerData.familyAccountId,
                  firstName: learnerData.firstName,
                  lastName: learnerData.lastName,
                  birthDate: learnerData.birthDate,
                  gender: learnerData.gender,
                  idNumber: learnerData.idNumber,
                  homeLanguage: learnerData.homeLanguage,
                  citizenship: learnerData.citizenship,
                  grade: learnerData.grade,
                  className: learnerData.className,
                  enrollmentStatus: learnerData.enrollmentStatus,
                },
              })
            : await prisma.learner.create({ data: learnerData });
        learnerId = created.id;
      } else {
        await prisma.learner.update({
          where: { id: learnerId },
          data: {
            familyAccountId,
            firstName: child.firstName,
            lastName: child.lastName,
            birthDate,
            gender: resolveLearnerGender({ gender: child.gender, idNumber: child.idNumber }),
            idNumber: child.idNumber,
            homeLanguage: child.homeLanguage,
            citizenship: child.citizenship,
            grade,
            className: canonicalClassName,
            enrollmentStatus: learnerData.enrollmentStatus,
          },
        });
      }

      childIdToLearnerId.set(child.childId, learnerId);
      if (accountNo && !accountNoToLearnerId.has(accountNo)) {
        accountNoToLearnerId.set(accountNo, learnerId);
      }
      pushUnique(manifest.learnerIds, learnerId);
      counts.learners += 1;
    }

    const parentsByChild = new Map<string, ParsedKidESysChildParent[]>();
    for (const link of bundle.childParents) {
      const list = parentsByChild.get(link.childId) || [];
      list.push(link);
      parentsByChild.set(link.childId, list);
    }

    const primaryAssigned = new Set<string>();
    for (const [childId, links] of parentsByChild) {
      const learnerId = childIdToLearnerId.get(childId);
      if (!learnerId) continue;
      const child = bundle.children.find((c) => c.childId === childId);
      const accountNo = child ? resolveAccountNoForChild(child, accounts) : "";
      const familyAccountId = accountNo ? accountToFamilyId.get(accountNo) || null : null;

      for (let i = 0; i < links.length; i++) {
        const raw = links[i];
        const account =
          accounts.byId.get(raw.parentId) || accounts.byNo.get(raw.parentId) || undefined;
        const parentRow = enrichParentFromAccount(raw, account);
        const phone = normalizeSaPhone(parentRow.cellNo || parentRow.homeNo || "");
        const cellNo = phone?.localCell || parentRow.cellNo || "0000000000";

        const existingParent = await prisma.parent.findFirst({
          where: {
            schoolId,
            firstName: parentRow.parentFirstName || "Guardian",
            surname: parentRow.parentSurname || "Unknown",
            cellNo,
            familyAccountId,
          },
          select: { id: true },
        });

        const parentId =
          existingParent?.id ||
          (
            await prisma.parent.create({
              data: {
                schoolId,
                familyAccountId,
                firstName: parentRow.parentFirstName || "Guardian",
                surname: parentRow.parentSurname || account?.familyName || "Unknown",
                cellNo,
                email: parentRow.email || null,
                relationship: parentRow.relationship,
                workNo: parentRow.workNo || null,
                homeNo: parentRow.homeNo || null,
              },
              select: { id: true },
            })
          ).id;

        pushUnique(manifest.parentIds, parentId);
        counts.parents += 1;

        let isPrimary = false;
        if (!primaryAssigned.has(learnerId) && (parentRow.isPrimary || i === 0)) {
          isPrimary = true;
          primaryAssigned.add(learnerId);
        }

        const linkRecord = await prisma.parentLearnerLink.upsert({
          where: { parentId_learnerId: { parentId, learnerId } },
          create: {
            schoolId,
            parentId,
            learnerId,
            relation: parentRow.relationship,
            isPrimary,
          },
          update: { relation: parentRow.relationship, isPrimary },
          select: { id: true },
        });
        pushUnique(manifest.linkIds, linkRecord.id);
        counts.links += 1;
      }
    }

    const billingPlans: Record<string, StoredBillingPlanItem[]> = {};
    for (const row of bundle.monthlyAccounts) {
      const learnerId =
        childIdToLearnerId.get(row.childId) ||
        accountNoToLearnerId.get(row.accountNo) ||
        "";
      if (!learnerId) continue;
      if (!billingPlans[learnerId]) billingPlans[learnerId] = [];
      billingPlans[learnerId].push({
        feeDescription: row.feeDescription,
        amount: row.amount,
      });
    }
    if (Object.keys(billingPlans).length) {
      upsertSchoolBillingPlans(schoolId, billingPlans);
      counts.billingPlans = Object.keys(billingPlans).length;
    }
  }

  manifest.childIdToLearnerId = Object.fromEntries(childIdToLearnerId);
  manifest.accountNoToLearnerId = Object.fromEntries(accountNoToLearnerId);

  const ledgerEntries: BillingLedgerEntry[] = [];

  const resolveLearnerForAccount = (accountNo: string, childId?: string): string => {
    const fromChild = childId ? childIdToLearnerId.get(childId) : "";
    if (fromChild) return fromChild;
    return accountNoToLearnerId.get(accountNo) || "";
  };

  for (const inv of bundle.invoices) {
    const accountNo = String(inv.accountNo || "").trim();
    if (!accountNo) continue;
    const id = csvLedgerId("invoice", inv.invoiceId);
    ledgerEntries.push({
      id,
      schoolId,
      learnerId: resolveLearnerForAccount(accountNo, inv.childId),
      accountNo,
      type: "invoice",
      amount: inv.amount,
      date: resolveIsoDate(inv.date) || importedAt.slice(0, 10),
      dueDate: resolveIsoDate(inv.dueDate) || undefined,
      reference: inv.reference || `Invoice ${inv.invoiceId}`,
      description: inv.description || inv.reference || `Invoice ${inv.invoiceId}`,
      source: KIDEESYS_CSV_MIGRATION_SOURCE,
      createdAt: importedAt,
    });
    pushUnique(manifest.ledgerEntryIds, id);
  }

  for (const pay of bundle.payments) {
    const accountNo = String(pay.accountNo || "").trim();
    if (!accountNo) continue;
    const id = csvLedgerId("payment", pay.paymentId);
    ledgerEntries.push({
      id,
      schoolId,
      learnerId: resolveLearnerForAccount(accountNo, pay.childId),
      accountNo,
      type: "payment",
      amount: pay.amount,
      date: resolveIsoDate(pay.date) || importedAt.slice(0, 10),
      reference: pay.reference || `Receipt ${pay.paymentId}`,
      description: pay.description || pay.reference || `Payment ${pay.paymentId}`,
      method: pay.method || undefined,
      source: KIDEESYS_CSV_MIGRATION_SOURCE,
      createdAt: importedAt,
    });
    pushUnique(manifest.ledgerEntryIds, id);
  }

  for (const journal of bundle.journals) {
    const accountNo = String(journal.accountNo || "").trim();
    if (!accountNo) continue;
    const kind = journal.kind === "payment" ? "payment" : journal.kind === "credit" ? "credit" : "invoice";
    const id = csvLedgerId("journal", journal.journalId);
    ledgerEntries.push({
      id,
      schoolId,
      learnerId: resolveLearnerForAccount(accountNo, journal.childId),
      accountNo,
      type: kind,
      amount: journal.amount,
      date: resolveIsoDate(journal.date) || importedAt.slice(0, 10),
      reference: journal.reference || `Journal ${journal.journalId}`,
      description: journal.description || journal.reference || `Journal ${journal.journalId}`,
      source: KIDEESYS_CSV_MIGRATION_SOURCE,
      createdAt: importedAt,
    });
    pushUnique(manifest.ledgerEntryIds, id);
  }

  if (!dryRun && ledgerEntries.length) {
    upsertSchoolEntries(schoolId, ledgerEntries);
    counts.ledgerEntries = ledgerEntries.length;
  } else {
    counts.ledgerEntries = ledgerEntries.length;
  }

  const existingLedger = readSchoolLedger(schoolId);
  const mergedLedger = dryRun
    ? (() => {
        const byId = new Map(existingLedger.map((e) => [e.id, e]));
        for (const entry of ledgerEntries) byId.set(entry.id, entry);
        return Array.from(byId.values());
      })()
    : readSchoolLedger(schoolId);

  for (const account of bundle.accounts) {
    const accountNo = String(account.accountNo || "").trim();
    if (!accountNo) continue;
    const scoped = mergedLedger.filter((e) => String(e.accountNo || "").trim() === accountNo);
    const ledgerBalance = calculateBalanceFromEntries(scoped);
    const target = Math.round(account.balance * 100) / 100;
    const variance = Math.round((target - ledgerBalance) * 100) / 100;
    if (Math.abs(variance) <= 0.01) continue;

    const entryType: BillingLedgerEntry["type"] = variance > 0 ? "invoice" : "credit";
    const opening: BillingLedgerEntry = {
      id: csvOpeningId(accountNo),
      schoolId,
      learnerId: accountNoToLearnerId.get(accountNo) || "",
      accountNo,
      type: entryType,
      amount: Math.abs(variance),
      date: importedAt.slice(0, 10),
      reference: `KIDESYS-CSV-OPENING-${accountNo}`,
      description: KIDESYS_OPENING_BALANCE_LABEL,
      source: KIDEESYS_CSV_OPENING_SOURCE,
      createdAt: importedAt,
    };
    ledgerEntries.push(opening);
    pushUnique(manifest.ledgerEntryIds, opening.id);
    counts.openingBalances += 1;
  }

  if (!dryRun && counts.openingBalances > 0) {
    upsertSchoolEntries(
      schoolId,
      ledgerEntries.filter((e) => e.source === KIDEESYS_CSV_OPENING_SOURCE)
    );
  }

  if (!dryRun) {
    relinkLedgerLearnerIds(schoolId, manifest.accountNoToLearnerId);

    const finalLedger = readSchoolLedger(schoolId);
    const historyIncoming = buildHistoryFromLedgerEntries(schoolId, finalLedger, importedAt);
    const historyMerged = mergeHistory(readSchoolKidesysHistory(schoolId), historyIncoming);
    writeSchoolKidesysHistory(schoolId, historyMerged);
    manifest.historyEntryIds = historyIncoming.map((e) => e.id);
    counts.historyEntries = historyIncoming.length;

    for (const classroomId of manifest.classroomIds) {
      await syncParentThreadsForClassroom(schoolId, classroomId);
    }

    writeManifest(manifest);
  }

  return {
    schoolId,
    projectId,
    dryRun,
    bundle,
    imported: counts,
    manifest,
    backupPath,
  };
}

/** @deprecated Use importKidESysCsv */
export const importDaSilvaKidESysCsv = importKidESysCsv;

/** Read-only audit proving CSV import completeness (run after import). */
export async function auditKidESysCsvImport(opts: {
  schoolId: string;
  sourcePath?: string;
  projectId?: string;
}): Promise<KidESysCsvImportAudit> {
  const schoolId = String(opts.schoolId || "").trim();
  const gateErrors: string[] = [];
  const auditedAt = new Date().toISOString();

  let bundle: KidESysCsvBundle | null = null;
  if (opts.sourcePath) {
    try {
      bundle = loadKidESysCsvBundle(opts.sourcePath);
    } catch (e) {
      gateErrors.push(`Failed to load CSV bundle: ${(e as Error).message}`);
    }
  }

  const learners = await prisma.learner.findMany({
    where: { schoolId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      birthDate: true,
      gender: true,
      idNumber: true,
      className: true,
      admissionNo: true,
      familyAccountId: true,
    },
  });

  const learnersWithDob = learners.filter((l) => l.birthDate != null).length;
  const learnersWithGender = learners.filter((l) => String(l.gender || "").trim()).length;
  const learnersWithClassName = learners.filter((l) => String(l.className || "").trim()).length;
  const learnersWithAdmissionNo = learners.filter((l) => String(l.admissionNo || "").trim()).length;
  const learnersWithFamilyAccountId = learners.filter((l) => l.familyAccountId).length;

  const parentLinksTotal = await prisma.parentLearnerLink.count({ where: { schoolId } });
  const links = await prisma.parentLearnerLink.findMany({
    where: { schoolId },
    select: { learnerId: true, parentId: true },
  });
  const learnerIdSet = new Set(learners.map((l) => l.id));
  const parentLinksResolvable = links.filter(
    (l) => learnerIdSet.has(l.learnerId) && l.parentId
  ).length;

  const ledger = readSchoolLedger(schoolId);
  const ledgerCsv = ledger.filter(
    (e) =>
      e.source === KIDEESYS_CSV_MIGRATION_SOURCE || e.source === KIDEESYS_CSV_OPENING_SOURCE
  );
  const ledgerInvoiceCount = ledgerCsv.filter((e) => e.type === "invoice").length;
  const ledgerPaymentCount = ledgerCsv.filter((e) => e.type === "payment").length;

  const ledgerIds = ledgerCsv.map((e) => e.id);
  const duplicateLedgerIds = ledgerIds.length - new Set(ledgerIds).size;

  const historyEntryCount = readSchoolKidesysHistory(schoolId).length;
  const statements = await buildAccountsFromLearners(schoolId, ledger);
  const accountsWithLastInvoice = statements.filter(
    (s) => s.lastInvoice > 0 || s.lastInvoiceLabel
  ).length;
  const accountsWithLastPayment = statements.filter((s) => s.lastPayment > 0).length;

  const balanceVarianceSamples: KidESysCsvImportAudit["balanceVarianceSamples"] = [];
  let balanceReconcilePassed = 0;
  let balanceReconcileFailed = 0;

  if (bundle) {
    for (const account of bundle.accounts) {
      const accountNo = String(account.accountNo || "").trim();
      if (!accountNo) continue;
      const scoped = ledger.filter((e) => String(e.accountNo || "").trim() === accountNo);
      const ledgerBalance = Math.round(calculateBalanceFromEntries(scoped) * 100) / 100;
      const target = Math.round(account.balance * 100) / 100;
      const variance = Math.round((target - ledgerBalance) * 100) / 100;
      if (Math.abs(variance) <= 0.01) {
        balanceReconcilePassed += 1;
      } else {
        balanceReconcileFailed += 1;
        if (balanceVarianceSamples.length < 15) {
          balanceVarianceSamples.push({ accountNo, target, ledger: ledgerBalance, variance });
        }
      }
    }
  }

  const childHeaders = bundle?.headersByFile?.child ?? [];
  const csvHasGender = childHeaders.some((h) => /gender|sex/.test(h));
  const csvHasDob = childHeaders.some((h) => /dob|birth|date_of_birth/.test(h));
  if (
    csvHasGender &&
    bundle &&
    learnersWithGender < Math.min(bundle.children.length, learners.length) * 0.5
  ) {
    gateErrors.push(
      `Gender populated for ${learnersWithGender}/${learners.length} learners — expected majority from child.csv`
    );
  }
  if (
    csvHasDob &&
    bundle &&
    learnersWithDob < Math.min(bundle.children.length, learners.length) * 0.3
  ) {
    gateErrors.push(
      `DOB populated for ${learnersWithDob}/${learners.length} learners — check child.csv date columns`
    );
  }
  if (bundle && ledgerInvoiceCount < bundle.invoices.length * 0.9) {
    gateErrors.push(
      `Ledger invoices ${ledgerInvoiceCount} vs CSV ${bundle.invoices.length} — re-run import or check account_no mapping`
    );
  }
  if (bundle && ledgerPaymentCount < bundle.payments.length * 0.9) {
    gateErrors.push(
      `Ledger payments ${ledgerPaymentCount} vs CSV ${bundle.payments.length} — re-run import or check account_no mapping`
    );
  }
  if (duplicateLedgerIds > 0) {
    gateErrors.push(`Duplicate CSV ledger ids: ${duplicateLedgerIds}`);
  }
  if (balanceReconcileFailed > 0) {
    gateErrors.push(
      `${balanceReconcileFailed} account(s) still out of balance vs accounts.csv (>${balanceReconcilePassed} passed)`
    );
  }
  if (parentLinksTotal === 0 && bundle && bundle.childParents.length > 0) {
    gateErrors.push("No parent links in DB — child_parent.csv import may have failed");
  }

  const manifest = opts.projectId
    ? loadKidESysCsvImportManifest(schoolId, opts.projectId)
    : null;
  if (opts.projectId && !manifest) {
    gateErrors.push(`Import manifest not found for project ${opts.projectId}`);
  }

  const namePopulatedCount = learners.filter((l) => String(l.firstName || "").trim()).length;
  const surnamePopulatedCount = learners.filter((l) => String(l.lastName || "").trim()).length;
  const idPopulatedCount = learners.filter((l) => String(l.idNumber || "").trim()).length;
  const classroomPopulatedCount = learnersWithClassName;
  const familyAccountsCount = await prisma.familyAccount.count({ where: { schoolId } });

  if (learners.length === 0) {
    gateErrors.push("No learners in database for this school");
  }
  if (namePopulatedCount === 0) {
    gateErrors.push("No learners with populated first name");
  }
  if (ledgerInvoiceCount === 0 && (bundle?.invoices.length ?? 0) > 0) {
    gateErrors.push("No CSV-sourced invoice ledger entries found after import");
  }
  if (accountsWithLastPayment === 0 && ledgerPaymentCount > 0) {
    gateErrors.push("Statements show no last payment coverage despite ledger payments");
  }

  return {
    schoolId,
    auditedAt,
    sourcePath: opts.sourcePath || manifest?.sourcePath || null,
    bundleCounts: {
      children: bundle?.children.length ?? 0,
      childParents: bundle?.childParents.length ?? 0,
      accounts: bundle?.accounts.length ?? 0,
      invoices: bundle?.invoices.length ?? 0,
      payments: bundle?.payments.length ?? 0,
      journals: bundle?.journals.length ?? 0,
      monthlyAccounts: bundle?.monthlyAccounts.length ?? 0,
    },
    learnersTotal: learners.length,
    learnersWithDob,
    learnersWithGender,
    learnersWithClassName,
    learnersWithAdmissionNo,
    learnersWithFamilyAccountId,
    parentLinksTotal,
    parentLinksResolvable,
    ledgerInvoiceCount,
    ledgerPaymentCount,
    ledgerCsvSourceCount: ledgerCsv.length,
    duplicateLedgerIds,
    historyEntryCount,
    accountsWithLastInvoice,
    accountsWithLastPayment,
    balanceReconcilePassed,
    balanceReconcileFailed,
    balanceVarianceSamples,
    namePopulatedCount,
    surnamePopulatedCount,
    idPopulatedCount,
    classroomPopulatedCount,
    familyAccountsCount,
    invoicesCount: ledgerInvoiceCount,
    paymentsCount: ledgerPaymentCount,
    journalsCount: ledgerCsv.filter((e) => e.id.includes("journal")).length,
    gatePassed: gateErrors.length === 0,
    gateErrors,
  };
}

/** @deprecated Use auditKidESysCsvImport */
export const auditDaSilvaKidESysCsvImport = auditKidESysCsvImport;
