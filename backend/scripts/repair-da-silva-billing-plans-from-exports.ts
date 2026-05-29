/**
 * Rebuild learner-billing-plans.json for Da Silva live using Kid-e-Sys billing export
 * and SA-SAMS class lists — keyed by current PostgreSQL learner IDs only.
 *
 * Does NOT touch statements, payments, opening balances, parent balances, ledger,
 * invoices, learners, parents, classrooms, or migration staging/manifests.
 *
 * Usage:
 *   npx tsx scripts/repair-da-silva-billing-plans-from-exports.ts [desktopExportRoot]
 *   npx tsx scripts/repair-da-silva-billing-plans-from-exports.ts [desktopExportRoot] --apply
 *   npx tsx scripts/repair-da-silva-billing-plans-from-exports.ts [desktopExportRoot] --apply --force
 *   npx tsx scripts/repair-da-silva-billing-plans-from-exports.ts [schoolId] [desktopExportRoot] --apply
 */
import "dotenv/config";
import fs from "fs";
import path from "path";

import { PrismaClient } from "@prisma/client";

import {
  DA_SILVA_OWNER_EMAIL,
  DA_SILVA_SCHOOL_NAME,
  getDaSilvaResolvedSchoolId,
  setDaSilvaResolvedSchoolId,
} from "../src/services/activateDaSilvaSubscription";
import {
  buildLearnerMatchIndexes,
  type DbLearnerForParentMatch,
} from "../src/services/daSilvaMigration/daSilvaParentLearnerMatching";
import {
  resolveDaSilvaKideesysBillingPaths,
  resolveDaSilvaSasamsPaths,
} from "../src/services/daSilvaMigration/daSilvaMigrationStrategy";
import {
  buildLearnerMatchKey,
  parseBillingPlanFile,
  type ParsedBillingPlanItem,
} from "../src/services/daSilvaMigration/parsers";
import {
  parseSasamsClassListDirectory,
  sasamsLearnersToParsedLearners,
} from "../src/services/daSilvaMigration/sasamsParsers";
import {
  registerDaSilvaSchoolId,
  resolveSchoolJsonStoreKey,
} from "../src/services/daSilvaSchoolResolve";
import {
  readSchoolBillingPlans,
  type StoredBillingPlanItem,
} from "../src/utils/learnerBillingPlanStore";
import { normalizeClassroomInput } from "../src/utils/classroomNormalization";
import { normalizeMatchText } from "../src/utils/kideesysSpreadsheet";

const prisma = new PrismaClient();

const MIN_MATCHED_TO_APPLY = 350;
const PLAN_FILE = path.join(process.cwd(), "data", "learner-billing-plans.json");

const apply = process.argv.includes("--apply");
const force = process.argv.includes("--force");

const positionalArgs = process.argv
  .slice(2)
  .filter((a) => a !== "--apply" && a !== "--force" && !a.startsWith("-"));

const schoolIdArg = positionalArgs.find(
  (a) => !a.includes("/") && !a.includes(path.sep) && a.length >= 20
);
const desktopRootArg = positionalArgs.find((a) => a.includes("/") || a.includes(path.sep));

type PlanFile = Record<string, Record<string, StoredBillingPlanItem[]>>;

type ExportLearnerHint = {
  matchKey: string;
  fullName: string;
  className: string;
  admissionNo: string | null;
  idNumber: string | null;
};

type BillingMatchRow = {
  billingMatchKey: string;
  fullName: string;
  className: string;
  feeLineCount: number;
  learnerId: string | null;
  strategy: string | null;
  ambiguous: boolean;
};

function normId(value: string | null | undefined): string {
  return String(value || "")
    .replace(/\D/g, "")
    .trim();
}

const FIRST_NAME_ALIASES: Record<string, string[]> = {
  zem: ["zemeriyas"],
  zemeriyas: ["zem"],
  lethabo: ["lebo", "thabo"],
  kgotso: ["kgots"],
  omogolo: ["omo"],
  tshegofatso: ["tshegofatjo"],
  tshegofatjo: ["tshegofatso"],
  ndaloenhle: ["ndalo", "enhle"],
  ndalo: ["ndaloenhle", "enhle"],
  enhle: ["ndaloenhle", "ndalo"],
  ummahaani: ["umme", "haani"],
  hailey: ["haley"],
  haley: ["hailey"],
};

function normPersonText(value: string): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[''`´]/g, "")
    .replace(/[-–—]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .trim();
}

function normSurname(value: string): string {
  return normPersonText(value)
    .replace(/\b(van|der|de|du|le|da|den|di)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanClassName(value: string | null | undefined): string {
  return String(value || "")
    .replace(/\|+$/g, "")
    .replace(/\|+/g, " ")
    .trim();
}

function normClass(value: string | null | undefined): string {
  const norm = normalizeClassroomInput(cleanClassName(value));
  return norm.matchKey || normPersonText(cleanClassName(value));
}

function cleanBillingDisplayName(fullName: string): string {
  return String(fullName || "")
    .replace(/\n/g, " ")
    .replace(/ref:\s*\([^)]*\)/gi, "")
    .replace(/\bdsa\d+\b/gi, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractParentheticalAlias(fullName: string): string | null {
  const match = String(fullName || "").match(/\(([^)]+)\)/);
  const alias = match?.[1]?.trim();
  return alias || null;
}

function billingNameVariants(fullName: string): Array<{ firstName: string; lastName: string }> {
  const variants: Array<{ firstName: string; lastName: string }> = [];
  const seen = new Set<string>();
  const push = (firstName: string, lastName: string) => {
    const key = `${normPersonText(firstName)}|${normPersonText(lastName)}`;
    if (!firstName || !lastName || seen.has(key)) return;
    seen.add(key);
    variants.push({ firstName, lastName });
  };

  const primary = billingFirstLastTokens(fullName);
  push(primary.firstName, primary.lastName);

  const alias = extractParentheticalAlias(fullName);
  if (alias) {
    push(primary.firstName, alias);
    const aliasParts = alias.split(/\s+/).filter(Boolean);
    if (aliasParts.length > 1) {
      push(primary.firstName, aliasParts[aliasParts.length - 1]);
    }
  }

  const tokens = cleanBillingDisplayName(fullName).split(/\s+/).filter(Boolean);
  if (tokens.length >= 3) {
    push(tokens[0], tokens[tokens.length - 1]);
    for (let i = 1; i < tokens.length - 1; i += 1) {
      push(tokens[0], tokens[i]);
    }
  }

  return variants;
}

function tokenizePersonName(value: string): string[] {
  return cleanBillingDisplayName(value)
    .split(/\s+/)
    .map((t) => normPersonText(t))
    .filter(Boolean);
}

function firstNameVariants(first: string): string[] {
  const base = normPersonText(first).replace(/\s+/g, "");
  const variants = new Set<string>([base, normPersonText(first)]);
  const aliases = FIRST_NAME_ALIASES[base] || [];
  for (const alias of aliases) variants.add(normPersonText(alias));
  if (base.length >= 3) variants.add(base.slice(0, 3));
  return [...variants].filter(Boolean);
}

function firstNamesCompatible(billingFirst: string, dbFirst: string): boolean {
  const a = normPersonText(billingFirst).replace(/\s+/g, "");
  const b = normPersonText(dbFirst).replace(/\s+/g, "");
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.startsWith(b) || b.startsWith(a)) return Math.min(a.length, b.length) >= 3;
  for (const variant of firstNameVariants(billingFirst)) {
    if (variant && (b === variant || b.startsWith(variant) || variant.startsWith(b))) return true;
  }
  for (const variant of firstNameVariants(dbFirst)) {
    if (variant && (a === variant || a.startsWith(variant) || variant.startsWith(a))) return true;
  }
  return false;
}

function surnamesCompatible(billingSurname: string, dbSurname: string): boolean {
  const a = normSurname(billingSurname);
  const b = normSurname(dbSurname);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) >= 4;
  const aTokens = a.split(/\s+/);
  const bTokens = b.split(/\s+/);
  if (aTokens.some((t) => bTokens.includes(t) && t.length >= 4)) return true;
  if (a.length >= 5 && b.length >= 5 && a.length === b.length) {
    let diff = 0;
    for (let i = 0; i < a.length; i += 1) {
      if (a[i] !== b[i]) diff += 1;
      if (diff > 1) break;
    }
    if (diff <= 1) return true;
  }
  return false;
}

function billingFirstLastTokens(fullName: string): { firstName: string; lastName: string } {
  const parts = cleanBillingDisplayName(fullName).split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  const lower = parts.map((p) => p.toLowerCase());
  const penultimate = lower[lower.length - 2];
  if (parts.length >= 3 && /^(van|de|du|der|le|da|den|di)$/.test(penultimate)) {
    return {
      firstName: parts.slice(0, -2).join(" "),
      lastName: parts.slice(-2).join(" "),
    };
  }
  return { firstName: parts[0], lastName: parts[parts.length - 1] };
}

type BillingRepairIndexes = ReturnType<typeof buildLearnerMatchIndexes> & {
  bySurnameClass: Map<string, string[]>;
  learnersById: Map<string, DbLearnerForParentMatch>;
};

function pushIndex(map: Map<string, string[]>, key: string, id: string): void {
  if (!key) return;
  const list = map.get(key) || [];
  if (!list.includes(id)) list.push(id);
  map.set(key, list);
}

function buildBillingRepairIndexes(learners: DbLearnerForParentMatch[]): BillingRepairIndexes {
  const base = buildLearnerMatchIndexes(learners);
  const bySurnameClass = new Map<string, string[]>();
  const learnersById = new Map<string, DbLearnerForParentMatch>();

  for (const l of learners) {
    learnersById.set(l.id, l);
    pushIndex(
      bySurnameClass,
      `${normSurname(l.lastName)}|${normClass(l.className)}`,
      l.id
    );
  }

  return { ...base, bySurnameClass, learnersById };
}

function nameClassKey(firstName: string, lastName: string, className: string): string {
  return `${normPersonText(firstName)}|${normPersonText(lastName)}|${normClass(className)}`;
}

function tokensOverlapMatch(
  billingFullName: string,
  className: string,
  indexes: BillingRepairIndexes
): { learnerId: string | null; strategy: string | null; ambiguous: boolean } {
  const billingTokens = tokenizePersonName(billingFullName);
  if (billingTokens.length < 2) {
    return { learnerId: null, strategy: null, ambiguous: false };
  }
  const billingLast = billingTokens[billingTokens.length - 1];
  const cls = normClass(className);
  const hits: string[] = [];

  for (const l of indexes.learnersById.values()) {
    if (normClass(l.className) !== cls) continue;
    const dbTokens = [...tokenizePersonName(l.firstName), ...tokenizePersonName(l.lastName)];
    if (!dbTokens.length) continue;
    const dbLast = dbTokens[dbTokens.length - 1];
    const surnameOk =
      surnamesCompatible(billingLast, dbLast) ||
      surnamesCompatible(billingLast, l.lastName) ||
      dbTokens.some((t) => surnamesCompatible(billingLast, t));
    if (!surnameOk) continue;

    const dbFirstTokens = tokenizePersonName(l.firstName);
    const firstOk =
      dbFirstTokens.some((dt) => billingTokens.some((bt) => firstNamesCompatible(bt, dt))) ||
      billingTokens.some((bt) => firstNamesCompatible(bt, l.firstName)) ||
      dbTokens.every((t) => billingTokens.includes(t));
    if (firstOk) hits.push(l.id);
  }

  const hit = pickUnique(hits);
  if (hit.id || hit.ambiguous) {
    return { learnerId: hit.id, strategy: "token_overlap_class", ambiguous: hit.ambiguous };
  }
  return { learnerId: null, strategy: null, ambiguous: false };
}

function swappedNameMatch(
  billingFullName: string,
  className: string,
  indexes: BillingRepairIndexes
): { learnerId: string | null; strategy: string | null; ambiguous: boolean } {
  const parts = cleanBillingDisplayName(billingFullName).split(/\s+/).filter(Boolean);
  if (parts.length !== 2) {
    return { learnerId: null, strategy: null, ambiguous: false };
  }
  const swappedKey = nameClassKey(parts[1], parts[0], className);
  const hit = pickUnique(indexes.byNameClass.get(swappedKey) || []);
  if (hit.id || hit.ambiguous) {
    return { learnerId: hit.id, strategy: "swapped_first_surname", ambiguous: hit.ambiguous };
  }
  return { learnerId: null, strategy: null, ambiguous: false };
}

function groupBillingPlans(
  items: ParsedBillingPlanItem[]
): Map<string, { fullName: string; className: string; items: StoredBillingPlanItem[] }> {
  const map = new Map<
    string,
    { fullName: string; className: string; items: StoredBillingPlanItem[] }
  >();
  for (const item of items) {
    const existing = map.get(item.matchKey);
    const list = existing?.items || [];
    list.push({ feeDescription: item.feeDescription, amount: item.amount });
    map.set(item.matchKey, {
      fullName: item.fullName,
      className: item.className,
      items: list,
    });
  }
  return map;
}

function resolveDesktopRoot(): string {
  const root = desktopRootArg || path.join(process.env.HOME || "", "Desktop");
  return path.resolve(root);
}

function resolveExportPaths(desktopRoot: string): { billingPlan: string; classListDir: string } {
  const kideesys = resolveDaSilvaKideesysBillingPaths(desktopRoot);
  const sasams = resolveDaSilvaSasamsPaths(desktopRoot);
  return {
    billingPlan: kideesys.billingPlan,
    classListDir: sasams.classListDir,
  };
}

function validatePaths(paths: { billingPlan: string; classListDir: string }): void {
  if (!fs.existsSync(paths.billingPlan)) {
    throw new Error(`Missing billing plan file: ${paths.billingPlan}`);
  }
  if (!fs.existsSync(paths.classListDir)) {
    throw new Error(`Missing class list directory: ${paths.classListDir}`);
  }
}

async function resolveSchoolId(): Promise<{ id: string; name: string }> {
  const hint = String(schoolIdArg || getDaSilvaResolvedSchoolId() || "").trim();
  const school =
    (hint
      ? await prisma.school.findUnique({ where: { id: hint }, select: { id: true, name: true } })
      : null) ||
    (await prisma.school.findFirst({
      where: { email: DA_SILVA_OWNER_EMAIL },
      select: { id: true, name: true },
    })) ||
    (await prisma.school.findFirst({
      where: { name: DA_SILVA_SCHOOL_NAME },
      select: { id: true, name: true },
    }));
  if (!school) throw new Error("Da Silva Academy school not found in database");
  setDaSilvaResolvedSchoolId(school.id);
  registerDaSilvaSchoolId(school.id);
  return school;
}

function pickUnique(candidates: string[]): { id: string | null; ambiguous: boolean } {
  const unique = [...new Set(candidates)];
  if (unique.length === 1) return { id: unique[0], ambiguous: false };
  if (unique.length === 0) return { id: null, ambiguous: false };
  return { id: null, ambiguous: true };
}

function readPlanFile(): PlanFile {
  if (!fs.existsSync(PLAN_FILE)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(PLAN_FILE, "utf8")) as PlanFile;
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function writePlanFile(data: PlanFile): void {
  const dir = path.dirname(PLAN_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(PLAN_FILE, JSON.stringify(data, null, 2), "utf8");
}

function buildExportHintIndex(classListDir: string): {
  byKey: Map<string, ExportLearnerHint>;
  all: ExportLearnerHint[];
} {
  const { learners: sasamsLearners } = parseSasamsClassListDirectory(classListDir);
  const classLearners = sasamsLearnersToParsedLearners(sasamsLearners);
  const byKey = new Map<string, ExportLearnerHint>();
  const all: ExportLearnerHint[] = [];
  for (const l of classLearners) {
    const hint: ExportLearnerHint = {
      matchKey: l.matchKey,
      fullName: l.fullName,
      className: l.className,
      admissionNo: l.admissionNo ?? null,
      idNumber: l.idNumber ?? null,
    };
    byKey.set(l.matchKey, hint);
    all.push(hint);
  }
  return { byKey, all };
}

function nameClassLookupKeys(firstName: string, lastName: string, className: string): string[] {
  const cls = normClass(className);
  const keys = new Set<string>();
  keys.add(nameClassKey(firstName, lastName, className));
  keys.add(
    `${normalizeMatchText(firstName)}|${normalizeMatchText(lastName)}|${cls}`
  );
  keys.add(billingNameClassKey(`${firstName} ${lastName}`.trim(), className));
  return [...keys];
}

/** Kid-e-Sys billing uses full names; DB and SA-SAMS use first+last token only. */
function billingNameClassKey(fullName: string, className: string): string {
  const { firstName, lastName } = billingFirstLastTokens(fullName);
  return nameClassKey(firstName, lastName, className);
}

function resolveExportHint(
  billingMatchKey: string,
  row: { fullName: string; className: string },
  exportByKey: Map<string, ExportLearnerHint>,
  exportHints: ExportLearnerHint[]
): ExportLearnerHint | undefined {
  const direct = exportByKey.get(billingMatchKey);
  if (direct) return direct;
  const { firstName, lastName } = billingFirstLastTokens(row.fullName);
  const shortKey = buildLearnerMatchKey(`${firstName} ${lastName}`.trim(), row.className);
  const shortHit = exportByKey.get(shortKey);
  if (shortHit) return shortHit;

  const rowCls = normClass(row.className);
  const rowTokens = tokenizePersonName(row.fullName);
  let best: ExportLearnerHint | undefined;
  let bestScore = 0;
  for (const hint of exportHints) {
    if (normClass(hint.className) !== rowCls) continue;
    const hintTokens = tokenizePersonName(hint.fullName);
    if (!hintTokens.length || !rowTokens.length) continue;
    const overlap = rowTokens.filter((t) => hintTokens.includes(t)).length;
    const surnameOk = surnamesCompatible(
      rowTokens[rowTokens.length - 1],
      hintTokens[hintTokens.length - 1]
    );
    const score = overlap + (surnameOk ? 2 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = hint;
    }
  }
  return bestScore >= 3 ? best : undefined;
}

async function loadDbLearners(schoolId: string): Promise<DbLearnerForParentMatch[]> {
  return prisma.learner.findMany({
    where: { schoolId, enrollmentStatus: "ACTIVE" },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      className: true,
      admissionNo: true,
      idNumber: true,
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
}

function aliasAndTokenSurnameMatch(
  row: { fullName: string; className: string },
  indexes: BillingRepairIndexes
): { learnerId: string | null; strategy: string | null; ambiguous: boolean } {
  for (const variant of billingNameVariants(row.fullName)) {
    for (const key of nameClassLookupKeys(variant.firstName, variant.lastName, row.className)) {
      const hit = pickUnique(indexes.byNameClass.get(key) || []);
      if (hit.id || hit.ambiguous) {
        return {
          learnerId: hit.id,
          strategy: extractParentheticalAlias(row.fullName)
            ? "parenthetical_surname"
            : "middle_token_surname",
          ambiguous: hit.ambiguous,
        };
      }
    }

    const scKey = `${normSurname(variant.lastName)}|${normClass(row.className)}`;
    const scHits = (indexes.bySurnameClass.get(scKey) || []).filter((id) => {
      const l = indexes.learnersById.get(id);
      return l ? firstNamesCompatible(variant.firstName, l.firstName) : false;
    });
    const scHit = pickUnique(scHits);
    if (scHit.id || scHit.ambiguous) {
      return {
        learnerId: scHit.id,
        strategy: extractParentheticalAlias(row.fullName)
          ? "parenthetical_surname_class"
          : "middle_token_surname_class",
        ambiguous: scHit.ambiguous,
      };
    }
  }

  return { learnerId: null, strategy: null, ambiguous: false };
}

function dbIdentityFallbackMatch(
  row: { fullName: string; className: string },
  indexes: BillingRepairIndexes
): { learnerId: string | null; strategy: string | null; ambiguous: boolean } {
  const billingTokens = tokenizePersonName(row.fullName);
  if (!billingTokens.length) {
    return { learnerId: null, strategy: null, ambiguous: false };
  }
  const hits: string[] = [];
  for (const l of indexes.learnersById.values()) {
    const dbTokens = [...tokenizePersonName(l.firstName), ...tokenizePersonName(l.lastName)];
    if (!dbTokens.length) continue;
    const tokenHit =
      dbTokens.every((t) => billingTokens.includes(t)) ||
      billingTokens.every((t) => dbTokens.includes(t));
    if (!tokenHit) continue;
    if (normClass(l.className) !== normClass(row.className)) continue;
    hits.push(l.id);
  }
  const hit = pickUnique(hits);
  if (hit.id || hit.ambiguous) {
    return { learnerId: hit.id, strategy: "db_identity_tokens", ambiguous: hit.ambiguous };
  }
  return { learnerId: null, strategy: null, ambiguous: false };
}

function matchBillingRowToDb(
  row: { fullName: string; className: string },
  exportHint: ExportLearnerHint | undefined,
  indexes: BillingRepairIndexes
): { learnerId: string | null; strategy: string | null; ambiguous: boolean } {
  const tryPick = (
    ids: string[],
    strategy: string
  ): { learnerId: string | null; strategy: string | null; ambiguous: boolean } | null => {
    const hit = pickUnique(ids);
    if (hit.id || hit.ambiguous) {
      return { learnerId: hit.id, strategy, ambiguous: hit.ambiguous };
    }
    return null;
  };

  const adm = normId(exportHint?.admissionNo);
  if (adm) {
    const hit = tryPick(indexes.byAdmission.get(adm) || [], "admission_no");
    if (hit) return hit;
  }

  const idn = normId(exportHint?.idNumber);
  if (idn.length >= 6) {
    const hit = tryPick(indexes.byIdNumber.get(idn) || [], "sa_id");
    if (hit) return hit;
  }

  const { firstName, lastName } = billingFirstLastTokens(row.fullName);
  const cls = normClass(row.className);
  let hit: { learnerId: string | null; strategy: string | null; ambiguous: boolean } | null =
    null;

  for (const key of nameClassLookupKeys(firstName, lastName, row.className)) {
    hit = tryPick(indexes.byNameClass.get(key) || [], "name_class");
    if (hit) return hit;
  }

  const scKey = `${normSurname(lastName)}|${cls}`;
  const scHits = (indexes.bySurnameClass.get(scKey) || []).filter((id) => {
    const l = indexes.learnersById.get(id);
    return l ? firstNamesCompatible(firstName, l.firstName) : false;
  });
  hit = tryPick(scHits, "surname_class");
  if (hit) return hit;

  const nameOnlyKeys = [
    `${normPersonText(lastName)}|${normPersonText(firstName)}`,
    `${normalizeMatchText(lastName)}|${normalizeMatchText(firstName)}`,
  ];
  for (const key of nameOnlyKeys) {
    hit = tryPick(indexes.byNameOnly.get(key) || [], "surname_first_name");
    if (hit) return hit;
  }

  hit = tokensOverlapMatch(row.fullName, row.className, indexes);
  if (hit.learnerId || hit.ambiguous) return hit;

  hit = swappedNameMatch(row.fullName, row.className, indexes);
  if (hit.learnerId || hit.ambiguous) return hit;

  const relaxedScHits = (indexes.bySurnameClass.get(scKey) || []).filter((id) => {
    const l = indexes.learnersById.get(id);
    if (!l) return false;
    const billingTokens = tokenizePersonName(row.fullName);
    const dbTokens = [...tokenizePersonName(l.firstName), ...tokenizePersonName(l.lastName)];
    return billingTokens.some((bt) =>
      dbTokens.some((dt) => firstNamesCompatible(bt, dt) || surnamesCompatible(bt, dt))
    );
  });
  hit = tryPick(relaxedScHits, "surname_class_nickname");
  if (hit) return hit;

  if (adm.length >= 4) {
    const admSuffixHits: string[] = [];
    for (const l of indexes.learnersById.values()) {
      const dbAdm = normId(l.admissionNo);
      const dbId = normId(l.idNumber);
      if ((dbAdm && (dbAdm.endsWith(adm) || adm.endsWith(dbAdm))) || (dbId && dbId.includes(adm))) {
        admSuffixHits.push(l.id);
      }
    }
    hit = tryPick(admSuffixHits, "admission_suffix");
    if (hit) return hit;
  }

  hit = aliasAndTokenSurnameMatch(row, indexes);
  if (hit.learnerId || hit.ambiguous) return hit;

  hit = dbIdentityFallbackMatch(row, indexes);
  if (hit.learnerId || hit.ambiguous) return hit;

  return { learnerId: null, strategy: null, ambiguous: false };
}

async function main(): Promise<void> {
  const desktopRoot = resolveDesktopRoot();
  const paths = resolveExportPaths(desktopRoot);
  validatePaths(paths);

  const school = await resolveSchoolId();
  const schoolId = school.id;

  console.log("=== Da Silva billing plans repair (exports → current learner IDs) ===");
  console.log(`Mode: ${apply ? "APPLY" : "DRY-RUN (preview only)"}`);
  console.log(`School: ${school.name} (${schoolId})`);
  console.log(`Desktop export root: ${desktopRoot}`);
  console.log(`Billing plan: ${paths.billingPlan}`);
  console.log(`Class lists: ${paths.classListDir}`);

  const dbLearners = await loadDbLearners(schoolId);
  const indexes = buildBillingRepairIndexes(dbLearners);
  const { byKey: exportByKey, all: exportHints } = buildExportHintIndex(paths.classListDir);

  const billingItems = parseBillingPlanFile(paths.billingPlan);
  const planByKey = groupBillingPlans(billingItems);

  const matchRows: BillingMatchRow[] = [];
  const plansByLearnerId = new Map<string, StoredBillingPlanItem[]>();
  const duplicateLearnerWarnings: string[] = [];

  for (const [billingMatchKey, group] of planByKey) {
    const exportHint = resolveExportHint(billingMatchKey, group, exportByKey, exportHints);
    const match = matchBillingRowToDb(group, exportHint, indexes);
    matchRows.push({
      billingMatchKey,
      fullName: group.fullName,
      className: group.className,
      feeLineCount: group.items.length,
      learnerId: match.learnerId,
      strategy: match.strategy,
      ambiguous: match.ambiguous,
    });

    if (!match.learnerId || match.ambiguous) continue;

    if (plansByLearnerId.has(match.learnerId)) {
      duplicateLearnerWarnings.push(
        `${group.fullName} (${billingMatchKey}) → learner ${match.learnerId} already has a plan from another billing key`
      );
      continue;
    }
    plansByLearnerId.set(match.learnerId, group.items);
  }

  const billingFileLearnerCount = planByKey.size;
  const matchedCount = matchRows.filter((r) => r.learnerId && !r.ambiguous).length;
  const unmatchedBilling = matchRows.filter((r) => !r.learnerId || r.ambiguous);
  const matchedLearnerIds = new Set(
    matchRows.filter((r) => r.learnerId && !r.ambiguous).map((r) => r.learnerId as string)
  );
  const learnersWithoutPlan = dbLearners.filter((l) => !matchedLearnerIds.has(l.id));

  const existingPlans = readSchoolBillingPlans(schoolId);
  const existingPlanCount = Object.keys(existingPlans).length;

  console.log("\n=== Counts ===");
  console.log(`Current DB learners (ACTIVE): ${dbLearners.length}`);
  console.log(`Billing file learners (unique): ${billingFileLearnerCount}`);
  console.log(`Matched billing → learner: ${matchedCount}`);
  console.log(`Unmatched billing rows: ${unmatchedBilling.length}`);
  console.log(`Learners without plan: ${learnersWithoutPlan.length}`);
  console.log(`Existing JSON plans for school (stale keys): ${existingPlanCount}`);
  console.log(`Plans to write on apply: ${plansByLearnerId.size}`);

  if (duplicateLearnerWarnings.length) {
    console.log(`\nDuplicate learner mappings skipped (${duplicateLearnerWarnings.length}):`);
    for (const w of duplicateLearnerWarnings.slice(0, 15)) console.log(`  ${w}`);
  }

  if (unmatchedBilling.length) {
    console.log(`\nUnmatched billing (${unmatchedBilling.length}):`);
    for (const row of unmatchedBilling.slice(0, 25)) {
      const hint = resolveExportHint(row.billingMatchKey, row, exportByKey, exportHints);
      console.log(
        `  ${row.fullName} | ${row.className} | fees=${row.feeLineCount} | exportAdm=${hint?.admissionNo ?? ""} | exportId=${hint?.idNumber ?? ""}${row.ambiguous ? " | AMBIGUOUS" : ""}`
      );
    }
  }

  if (learnersWithoutPlan.length) {
    console.log(`\nLearners without plan (${learnersWithoutPlan.length}):`);
    for (const l of learnersWithoutPlan.slice(0, 25)) {
      console.log(
        `  ${l.firstName} ${l.lastName} | class=${l.className ?? ""} | admission=${l.admissionNo ?? ""} | id=${l.idNumber ?? ""}`
      );
    }
  }

  if (!apply) {
    console.log("\nDry run only. Re-run with --apply to overwrite Da Silva plans in learner-billing-plans.json.");
    if (matchedCount < MIN_MATCHED_TO_APPLY) {
      console.log(
        `Note: matched count is below ${MIN_MATCHED_TO_APPLY}; --apply would be refused unless --force is passed.`
      );
    }
    return;
  }

  if (matchedCount < MIN_MATCHED_TO_APPLY && !force) {
    console.error(
      `\nREFUSED: matched ${matchedCount} < ${MIN_MATCHED_TO_APPLY}. Re-run with --force to apply anyway.`
    );
    process.exit(1);
  }

  const all = readPlanFile();
  const storeKey = resolveSchoolJsonStoreKey(schoolId, all, (value) => {
    if (!value || typeof value !== "object") return false;
    return Object.keys(value).length > 0;
  });

  const newSchoolPlans: Record<string, StoredBillingPlanItem[]> = {};
  for (const [learnerId, items] of plansByLearnerId) {
    newSchoolPlans[learnerId] = items;
  }

  all[storeKey] = newSchoolPlans;
  writePlanFile(all);

  const afterCount = Object.keys(readSchoolBillingPlans(schoolId)).length;
  console.log(`\nApplied: wrote ${Object.keys(newSchoolPlans).length} plans under JSON key "${storeKey}".`);
  console.log(`Read-back plan count for school: ${afterCount}`);
  console.log("Other schools in learner-billing-plans.json were preserved.");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
