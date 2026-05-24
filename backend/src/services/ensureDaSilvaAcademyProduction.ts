import fs from "fs";
import path from "path";

import type { DaSilvaImportManifest } from "./daSilvaMigration/daSilvaMigrationService";
import {
  DA_SILVA_ACADEMY_SCHOOL_ID,
  DA_SILVA_OWNER_EMAIL,
  DA_SILVA_SCHOOL_NAME,
  getDaSilvaResolvedSchoolId,
  setDaSilvaResolvedSchoolId,
} from "./activateDaSilvaSubscription";
import { DA_SILVA_FINAL_IMPORT_EXPECTED } from "./daSilvaMigration/daSilvaFinalImportGate";
import { prisma } from "../prisma";
import { normalizeClassroomInput } from "../utils/classroomNormalization";
import { readSchoolBillingPlans } from "../utils/learnerBillingPlanStore";
import { readSchoolLedger } from "../utils/billingLedgerStore";
import { readSchoolKidesysHistory } from "../utils/kidesysTransactionHistoryStore";
import { splitFullName } from "../utils/kideesysSpreadsheet";
import {
  getUserAccessMeta,
  setUserAccessMeta,
  type UserAccessMeta,
} from "../utils/userAccessStore";
import { isProductionRuntime } from "./runtime";

const DA_SILVA_OWNER_USER_ID = "cmpimyjkj00013lhz6kkxr9xu";
const DA_SILVA_LOGO_URL = "/uploads/school-logos/da-silva-academy-logo.png";
const DA_SILVA_PROJECT_ID = "dasilva-mpin5qzg-xn4cxh";

const MANIFEST_PATH = path.join(
  process.cwd(),
  "uploads",
  "migration-staging",
  DA_SILVA_ACADEMY_SCHOOL_ID,
  `dasilva-${DA_SILVA_PROJECT_ID}.manifest.json`
);

function loadProductionManifest(): DaSilvaImportManifest | null {
  if (!fs.existsSync(MANIFEST_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8")) as DaSilvaImportManifest;
  } catch {
    return null;
  }
}

function parseStoredMatchKey(matchKey: string): {
  fullNameNormalized: string;
  classMatchKey: string;
} {
  const pipe = matchKey.indexOf("|");
  if (pipe === -1) {
    return { fullNameNormalized: matchKey.trim(), classMatchKey: "" };
  }
  return {
    fullNameNormalized: matchKey.slice(0, pipe).trim(),
    classMatchKey: matchKey.slice(pipe + 1).trim(),
  };
}

function titleCaseWords(text: string): string {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Reconstruct display class name from manifest match-key suffix (e.g. 6|b → Grade 6 B). */
export function classDisplayFromMatchKeySuffix(classMatchKey: string): string {
  const key = String(classMatchKey || "").trim().toLowerCase();
  if (!key) return "Unassigned";
  if (key.includes("creche") || key === "ps" || key.startsWith("ps|")) {
    return "Pre-School Creche";
  }

  const parts = key.split("|").filter(Boolean);
  if (parts.length >= 2 && /^\d{1,2}$/.test(parts[0])) {
    const grade = parts[0];
    const stream = parts[1].toUpperCase();
    const guess =
      stream.length === 1
        ? `Grade ${grade} ${stream}`
        : `Grade ${grade} / ${stream}`;
    const norm = normalizeClassroomInput(guess);
    return norm.classroomName || guess;
  }

  const norm = normalizeClassroomInput(classMatchKey);
  return norm.classroomName || titleCaseWords(classMatchKey.replace(/\|/g, " "));
}

function humanizeNormalizedName(normalized: string): string {
  return titleCaseWords(normalized);
}

function sumBillingPlan(items: { amount: number }[]): number {
  return items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
}

/** Canonical JSON/manifest key; production DB row may use a different id after registration. */
const DA_SILVA_DATA_SCHOOL_ID = DA_SILVA_ACADEMY_SCHOOL_ID;

type DaSilvaSchoolLookup =
  | { id: string; foundBy: "id" }
  | { id: string; foundBy: "email" }
  | { id: string; foundBy: "name" }
  | null;

async function findExistingDaSilvaSchool(): Promise<DaSilvaSchoolLookup> {
  const byId = await prisma.school.findUnique({
    where: { id: DA_SILVA_ACADEMY_SCHOOL_ID },
    select: { id: true },
  });
  if (byId) {
    return { id: byId.id, foundBy: "id" };
  }

  const byEmail = await prisma.school.findFirst({
    where: { email: DA_SILVA_OWNER_EMAIL },
    select: { id: true },
  });
  if (byEmail) {
    return { id: byEmail.id, foundBy: "email" };
  }

  const byName = await prisma.school.findFirst({
    where: { name: DA_SILVA_SCHOOL_NAME },
    select: { id: true },
  });
  if (byName) {
    return { id: byName.id, foundBy: "name" };
  }

  return null;
}

async function ensureSchoolRecord(): Promise<string> {
  const logoPath = path.join(
    process.cwd(),
    "uploads",
    "school-logos",
    "da-silva-academy-logo.png"
  );
  const logoExists = fs.existsSync(logoPath);

  const schoolUpdate = {
    name: DA_SILVA_SCHOOL_NAME,
    email: DA_SILVA_OWNER_EMAIL,
    ...(logoExists ? { logoUrl: DA_SILVA_LOGO_URL } : {}),
  };

  const existing = await findExistingDaSilvaSchool();

  if (existing?.foundBy === "email") {
    console.log("[startup] Da Silva existing school found by email");
  } else if (existing?.foundBy === "name") {
    console.log("[startup] Da Silva existing school found by name");
  }

  if (existing) {
    await prisma.school.update({
      where: { id: existing.id },
      data: schoolUpdate,
    });
    setDaSilvaResolvedSchoolId(existing.id);
    return existing.id;
  }

  await prisma.school.create({
    data: {
      id: DA_SILVA_ACADEMY_SCHOOL_ID,
      name: DA_SILVA_SCHOOL_NAME,
      email: DA_SILVA_OWNER_EMAIL,
      logoUrl: logoExists ? DA_SILVA_LOGO_URL : null,
    },
  });
  setDaSilvaResolvedSchoolId(DA_SILVA_ACADEMY_SCHOOL_ID);
  return DA_SILVA_ACADEMY_SCHOOL_ID;
}

async function ensureOwnerLink(): Promise<void> {
  const schoolId = getDaSilvaResolvedSchoolId();
  let user =
    (await prisma.user.findUnique({
      where: { id: DA_SILVA_OWNER_USER_ID },
      select: { id: true, email: true, schoolId: true, passwordHash: true },
    })) ||
    (await prisma.user.findFirst({
      where: { email: DA_SILVA_OWNER_EMAIL },
      select: { id: true, email: true, schoolId: true, passwordHash: true },
    }));

  if (!user) {
    console.warn(
      "[startup] Da Silva owner user not in database — login via register-school reclaim (password unchanged by startup)"
    );
    return;
  }

  if (user.schoolId !== schoolId) {
    await prisma.user.update({
      where: { id: user.id },
      data: { schoolId },
    });
    console.log(
      `[startup] Da Silva owner linked to school ${schoolId} (user ${user.id}, password unchanged)`
    );
  } else {
    console.log(
      `[startup] Da Silva owner already linked (user ${user.id}, password unchanged)`
    );
  }

  const existingMeta = getUserAccessMeta(user.id);
  if (!existingMeta) {
    const storePath = path.join(process.cwd(), "data", "user-access.json");
    if (fs.existsSync(storePath)) {
      try {
        const store = JSON.parse(fs.readFileSync(storePath, "utf8")) as {
          users?: Record<string, UserAccessMeta>;
        };
        const fromFile = store.users?.[DA_SILVA_OWNER_USER_ID] || store.users?.[user.id];
        if (fromFile) {
          setUserAccessMeta(user.id, { ...fromFile, schoolId });
        }
      } catch {
        // non-fatal
      }
    }
  }
}

function verifyJsonStores(): void {
  const schoolId = DA_SILVA_DATA_SCHOOL_ID;
  const plans = readSchoolBillingPlans(schoolId);
  const planLearners = Object.keys(plans).length;
  const ledger = readSchoolLedger(schoolId);
  const history = readSchoolKidesysHistory(schoolId);
  console.log(
    `[startup] Da Silva JSON stores: billing plans=${planLearners} learners, ledger=${ledger.length} entries, kidesys history=${history.length} rows`
  );
}

async function importFromManifest(manifest: DaSilvaImportManifest): Promise<void> {
  const schoolId = getDaSilvaResolvedSchoolId();
  const matchEntries = Object.entries(manifest.matchKeyToLearnerId || {});
  const accountToLearner = manifest.accountToLearnerId || {};
  const stagedParents = manifest.stagedParentIds || {};
  const billingPlans = readSchoolBillingPlans(DA_SILVA_DATA_SCHOOL_ID);

  const classNames = new Set<string>();
  for (const matchKey of matchEntries.map(([k]) => k)) {
    const { classMatchKey } = parseStoredMatchKey(matchKey);
    classNames.add(classDisplayFromMatchKeySuffix(classMatchKey));
  }

  let classroomsCreated = 0;
  for (const name of classNames) {
    if (!name) continue;
    await prisma.classroom.upsert({
      where: { schoolId_name: { schoolId, name } },
      create: { schoolId, name },
      update: {},
    });
    classroomsCreated += 1;
  }

  const accountNos = Object.keys(accountToLearner);
  const familyIdByAccount = new Map<string, string>();
  for (const accountNo of accountNos) {
    const learnerId = accountToLearner[accountNo];
    const matchEntry = matchEntries.find(([, id]) => id === learnerId);
    const lastName = matchEntry
      ? splitFullName(humanizeNormalizedName(parseStoredMatchKey(matchEntry[0]).fullNameNormalized))
          .lastName
      : accountNo;
    const fa = await prisma.familyAccount.upsert({
      where: { accountRef: accountNo },
      create: {
        schoolId,
        accountRef: accountNo,
        familyName: lastName || accountNo,
      },
      update: {},
    });
    familyIdByAccount.set(accountNo, fa.id);
  }

  let parentsCreated = 0;
  const parentIdSet = new Set<string>();
  for (const [stageKey, parentId] of Object.entries(stagedParents)) {
    if (parentIdSet.has(parentId)) continue;
    parentIdSet.add(parentId);

    const colon = stageKey.lastIndexOf(":");
    const matchKey = colon >= 0 ? stageKey.slice(0, colon) : stageKey;
    const learnerId = manifest.matchKeyToLearnerId?.[matchKey];
    const accountEntry = Object.entries(accountToLearner).find(([, lid]) => lid === learnerId);
    const accountNo = accountEntry?.[0] || "";
    const familyAccountId = accountNo ? familyIdByAccount.get(accountNo) || null : null;

    const { fullNameNormalized } = parseStoredMatchKey(matchKey);
    const { firstName, lastName } = splitFullName(humanizeNormalizedName(fullNameNormalized));
    const digits = parentId.replace(/\D/g, "");
    const placeholderCell = `07${digits.slice(-8).padStart(8, "0")}`;

    await prisma.parent.upsert({
      where: { id: parentId },
      create: {
        id: parentId,
        schoolId,
        familyAccountId,
        firstName: firstName || "Family",
        surname: lastName || "Account",
        cellNo: placeholderCell,
        relationship: "Guardian",
      },
      update: {
        schoolId,
        familyAccountId,
      },
    });
    parentsCreated += 1;
  }

  let learnersUpserted = 0;
  for (const [matchKey, learnerId] of matchEntries) {
    const { fullNameNormalized, classMatchKey } = parseStoredMatchKey(matchKey);
    const fullName = humanizeNormalizedName(fullNameNormalized);
    const { firstName, lastName } = splitFullName(fullName);
    const className = classDisplayFromMatchKeySuffix(classMatchKey);
    const norm = normalizeClassroomInput(className);

    const accountEntry = Object.entries(accountToLearner).find(([, lid]) => lid === learnerId);
    const accountNo = accountEntry?.[0] || "";
    const familyAccountId = accountNo ? familyIdByAccount.get(accountNo) || null : null;
    const planItems = billingPlans[learnerId] || [];
    const billingTotal = sumBillingPlan(planItems);

    await prisma.learner.upsert({
      where: { id: learnerId },
      create: {
        id: learnerId,
        schoolId,
        familyAccountId,
        firstName: firstName || fullName,
        lastName: lastName || "",
        grade: norm.gradeLabel || className,
        className,
        admissionNo: accountNo || null,
        totalFee: billingTotal,
        tuitionFee: billingTotal,
      },
      update: {
        schoolId,
        familyAccountId,
        firstName: firstName || fullName,
        lastName: lastName || "",
        grade: norm.gradeLabel || className,
        className,
        admissionNo: accountNo || null,
        totalFee: billingTotal,
        tuitionFee: billingTotal,
      },
    });
    learnersUpserted += 1;
  }

  let linksUpserted = 0;
  for (const [stageKey, parentId] of Object.entries(stagedParents)) {
    const colon = stageKey.lastIndexOf(":");
    const matchKey = colon >= 0 ? stageKey.slice(0, colon) : stageKey;
    const learnerId = manifest.matchKeyToLearnerId?.[matchKey];
    if (!learnerId || !parentId) continue;

    await prisma.parentLearnerLink.upsert({
      where: { parentId_learnerId: { parentId, learnerId } },
      create: {
        schoolId,
        parentId,
        learnerId,
        relation: "Guardian",
        isPrimary: stageKey.endsWith(":0"),
      },
      update: { schoolId },
    });
    linksUpserted += 1;
  }

  console.log(
    `[startup] Da Silva import: classrooms=${classroomsCreated}, familyAccounts=${accountNos.length}, parents=${parentsCreated}, learners=${learnersUpserted}, parentLinks=${linksUpserted}`
  );
}

/**
 * Idempotent production ensure for Da Silva Academy only.
 * Rebuilds Prisma rows from the verified manifest + JSON billing files when the school is missing or incomplete.
 */
export async function ensureDaSilvaAcademyProduction(): Promise<void> {
  if (!isProductionRuntime()) {
    return;
  }

  const existingLookup = await findExistingDaSilvaSchool();
  if (existingLookup) {
    setDaSilvaResolvedSchoolId(existingLookup.id);
  }

  const schoolId = getDaSilvaResolvedSchoolId();
  const existing = existingLookup ? { id: existingLookup.id } : null;
  const learnerCount = existing
    ? await prisma.learner.count({ where: { schoolId } })
    : 0;

  const manifest = loadProductionManifest();
  if (!manifest) {
    if (!existing) {
      console.error(
        `[startup] Da Silva production manifest missing at ${MANIFEST_PATH} — cannot import school`
      );
    }
    return;
  }

  const expectedLearners = DA_SILVA_FINAL_IMPORT_EXPECTED.learners;
  if (existing && learnerCount >= expectedLearners) {
    await ensureSchoolRecord();
    await ensureOwnerLink();
    verifyJsonStores();
    console.log(
      `[startup] Da Silva school already present (${learnerCount} learners) — import skipped`
    );
    return;
  }

  console.log("[startup] Da Silva school ensure/import starting…");
  await ensureSchoolRecord();
  await importFromManifest(manifest);
  await ensureOwnerLink();
  verifyJsonStores();

  const finalLearners = await prisma.learner.count({ where: { schoolId } });
  const finalParents = await prisma.parent.count({ where: { schoolId } });
  const finalClassrooms = await prisma.classroom.count({ where: { schoolId } });

  console.log(
    `[startup] Da Silva school ensured/imported: ${DA_SILVA_SCHOOL_NAME} (${schoolId}) learners=${finalLearners} parents=${finalParents} classrooms=${finalClassrooms}`
  );

  if (finalLearners < expectedLearners) {
    console.warn(
      `[startup] Da Silva learner count ${finalLearners} is below expected ${expectedLearners}`
    );
  }
}
