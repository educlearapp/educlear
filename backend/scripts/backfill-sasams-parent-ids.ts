/**
 * Backfill missing Parent.idNumber from SA-SAMS parent sources (no learner profile writes).
 *
 * Usage:
 *   cd backend
 *   npx tsx scripts/backfill-sasams-parent-ids.ts --schoolId <id> --source "/path/to/sasams" --apply
 *
 * Or from migration staging (read-only of staged uploads):
 *   npx tsx scripts/backfill-sasams-parent-ids.ts --schoolId <id> --projectId <migrationProjectId> --apply
 *
 * Dry-run (no DB writes):
 *   npx tsx scripts/backfill-sasams-parent-ids.ts --schoolId <id> --source "/path/to/sasams"
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { prisma } from "../src/prisma";
import { normalizeSaPhone } from "../src/services/parentPortalService";
import {
  parseSasamsParentLearnerLinks,
  parseSasamsParentRegister,
  type SasamsParsedParent,
} from "../src/services/daSilvaMigration/sasamsParsers";

function arg(name: string): string | null {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return null;
  const v = process.argv[idx + 1];
  return v ? String(v).trim() : null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function digitsOnly(value: string | null | undefined): string {
  return String(value || "").replace(/\D/g, "");
}

function normalizeName(value: string | null | undefined): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9 ]/g, "");
}

function normalizeEmail(value: string | null | undefined): string {
  return String(value || "").trim().toLowerCase();
}

function normalizeCell(value: string | null | undefined): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const phone = normalizeSaPhone(raw);
  if (phone?.localCell) return phone.localCell;
  return digitsOnly(raw);
}

function isValidIdNumber(idNumber: string | null | undefined): boolean {
  const digits = digitsOnly(idNumber);
  // SA IDs are 13 digits, but SA-SAMS sometimes stores other official identifiers.
  // Rule: never invent — only accept IDs present in source, and never overwrite existing IDs.
  return digits.length >= 6;
}

type ParentDbRow = {
  id: string;
  firstName: string;
  surname: string;
  cellNo: string;
  email: string | null;
  idNumber: string | null;
  links: Array<{
    learner: { id: string; firstName: string; lastName: string; className: string | null };
  }>;
};

type SourceParentRow = {
  firstName: string;
  surname: string;
  cellNo: string;
  email: string;
  idNumber: string;
  learnerFirstName: string | null;
  learnerLastName: string | null;
  sourceFile: string;
  sourceRow: number;
};

function safeReadSasamsParentSource(filePath: string): SasamsParsedParent[] {
  try {
    if (/parent_learner_links/i.test(path.basename(filePath))) return parseSasamsParentLearnerLinks(filePath);
    return parseSasamsParentRegister(filePath);
  } catch {
    return [];
  }
}

function listCandidateParentFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Skip node_modules-like folders defensively.
        if (entry.name.startsWith(".") || entry.name.toLowerCase() === "node_modules") continue;
        walk(full);
        continue;
      }
      if (!/\.(xls|xlsx)$/i.test(entry.name)) continue;
      const name = entry.name.toLowerCase();
      if (
        name.includes("parent_learner_links") ||
        name.includes("parent_register") ||
        name.includes("parent_contact") ||
        name.includes("parents") ||
        name.includes("guardian") ||
        (name.includes("parent") && name.includes("contact")) ||
        name.includes("contact")
      ) {
        out.push(full);
      }
    }
  };
  walk(root);
  // Prefer deterministic order.
  return out.sort((a, b) => a.localeCompare(b));
}

function sourceRowToCandidate(row: SasamsParsedParent): SourceParentRow | null {
  if (!isValidIdNumber(row.idNumber)) return null;
  const idDigits = digitsOnly(row.idNumber);
  const firstName = String(row.firstName || "").trim();
  const surname = String(row.surname || "").trim();
  if (!firstName || !surname) return null;
  return {
    firstName,
    surname,
    cellNo: normalizeCell(row.cellNo || row.homeNo || row.workNo),
    email: normalizeEmail(row.email),
    idNumber: idDigits,
    learnerFirstName: row.learnerFirstName,
    learnerLastName: row.learnerLastName,
    sourceFile: row.sourceFile,
    sourceRow: row.sourceRow,
  };
}

type MatchResult =
  | { ok: true; idNumber: string; reason: string; evidence: { sourceFile: string; sourceRow: number } }
  | { ok: false; reason: string };

function pickUniqueId(candidates: SourceParentRow[], reasonBase: string): MatchResult {
  if (candidates.length === 0) return { ok: false, reason: "no source rows" };
  const uniqueIds = new Set(candidates.map((c) => c.idNumber));
  if (uniqueIds.size !== 1) {
    return { ok: false, reason: `${reasonBase}: ambiguous (multiple different ID numbers in source)` };
  }
  const idNumber = Array.from(uniqueIds)[0];
  const best = candidates[0];
  return {
    ok: true,
    idNumber,
    reason: reasonBase,
    evidence: { sourceFile: best.sourceFile, sourceRow: best.sourceRow },
  };
}

function buildIndexes(source: SourceParentRow[]) {
  const byNameSurnameCell = new Map<string, SourceParentRow[]>();
  const byNameSurnameEmail = new Map<string, SourceParentRow[]>();
  const byNameSurnameLearner = new Map<string, SourceParentRow[]>();
  const byNormNameSurname = new Map<string, SourceParentRow[]>();

  const push = (map: Map<string, SourceParentRow[]>, key: string, row: SourceParentRow) => {
    if (!key) return;
    const list = map.get(key) || [];
    list.push(row);
    map.set(key, list);
  };

  for (const row of source) {
    const nFirst = normalizeName(row.firstName);
    const nLast = normalizeName(row.surname);
    const nameKey = `${nFirst}|${nLast}`;
    push(byNormNameSurname, nameKey, row);
    push(byNameSurnameCell, `${nameKey}|${row.cellNo || ""}`, row);
    push(byNameSurnameEmail, `${nameKey}|${row.email || ""}`, row);
    const learnerKey =
      row.learnerFirstName && row.learnerLastName
        ? `${nameKey}|${normalizeName(row.learnerFirstName)}|${normalizeName(row.learnerLastName)}`
        : "";
    if (learnerKey) push(byNameSurnameLearner, learnerKey, row);
  }

  return { byNameSurnameCell, byNameSurnameEmail, byNameSurnameLearner, byNormNameSurname };
}

function matchParentId(opts: {
  parent: ParentDbRow;
  indexes: ReturnType<typeof buildIndexes>;
}): MatchResult {
  const p = opts.parent;
  const nFirst = normalizeName(p.firstName);
  const nLast = normalizeName(p.surname);
  const nameKey = `${nFirst}|${nLast}`;
  const cellKey = `${nameKey}|${normalizeCell(p.cellNo)}`;
  const emailKey = `${nameKey}|${normalizeEmail(p.email)}`;

  // 1) Exact parent ID if already linked elsewhere — for this task, interpret as strongest match:
  // name + surname + cell (exact-ish via normalization), since cell numbers are already present in DB.
  const byCell = opts.indexes.byNameSurnameCell.get(cellKey) || [];
  if (byCell.length) return pickUniqueId(byCell, "parent name + surname + cell");

  // 2) Parent name + surname + email
  if (normalizeEmail(p.email)) {
    const byEmail = opts.indexes.byNameSurnameEmail.get(emailKey) || [];
    if (byEmail.length) return pickUniqueId(byEmail, "parent name + surname + email");
  }

  // 3) Parent name + surname + linked learner
  for (const link of p.links) {
    const learnerKey = `${nameKey}|${normalizeName(link.learner.firstName)}|${normalizeName(link.learner.lastName)}`;
    const byLearner = opts.indexes.byNameSurnameLearner.get(learnerKey) || [];
    if (byLearner.length) return pickUniqueId(byLearner, "parent name + surname + linked learner");
  }

  // 4) Normalized parent name + surname
  const byName = opts.indexes.byNormNameSurname.get(nameKey) || [];
  if (byName.length) return pickUniqueId(byName, "normalized parent name + surname");

  return { ok: false, reason: "no source match on priority rules" };
}

async function main(): Promise<void> {
  const schoolId = arg("schoolId");
  const sourceRoot = arg("source");
  const projectId = arg("projectId");
  const apply = hasFlag("apply");

  if (!schoolId || (!sourceRoot && !projectId)) {
    console.error(
      "Usage: npx tsx scripts/backfill-sasams-parent-ids.ts --schoolId <id> (--source <sasamsFolder> | --projectId <migrationProjectId>) [--apply]"
    );
    process.exit(1);
  }

  const stagingUploadsRoot = projectId
    ? path.join(process.cwd(), "uploads", "migration-staging", schoolId, projectId, "uploads")
    : null;
  const effectiveSourceRoot = sourceRoot ? sourceRoot : stagingUploadsRoot!;

  // Parse source files.
  const candidateFiles = (() => {
    if (sourceRoot) {
      // When a folder contains multiple exports (common in staging/tmp), scan all parent/contact candidates
      // instead of enforcing a single canonical filename.
      return listCandidateParentFiles(sourceRoot);
    }
    return listCandidateParentFiles(effectiveSourceRoot);
  })();

  const parsedParents: SourceParentRow[] = [];
  for (const filePath of candidateFiles) {
    const rows = safeReadSasamsParentSource(filePath);
    for (const r of rows) {
      const cand = sourceRowToCandidate(r);
      if (cand) parsedParents.push(cand);
    }
  }

  const indexes = buildIndexes(parsedParents);

  const parents = (await prisma.parent.findMany({
    where: { schoolId },
    select: {
      id: true,
      firstName: true,
      surname: true,
      cellNo: true,
      email: true,
      idNumber: true,
      links: {
        select: {
          learner: { select: { id: true, firstName: true, lastName: true, className: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  })) as ParentDbRow[];

  const totalParents = parents.length;
  const hasIdBefore = parents.filter((p) => isValidIdNumber(p.idNumber)).length;

  const existingIds = new Map<string, string>(); // idNumber -> parentId
  for (const p of parents) {
    const idDigits = digitsOnly(p.idNumber);
    if (idDigits.length >= 6) existingIds.set(idDigits, p.id);
  }

  const missingBefore = parents.filter((p) => !isValidIdNumber(p.idNumber));

  const stillMissingExamples: Array<{
    parent: { firstName: string; surname: string; cellNo: string; email: string | null };
    reason: string;
  }> = [];

  let writes = 0;
  for (const p of missingBefore) {
    const match = matchParentId({ parent: p, indexes });
    if (!match.ok) {
      if (stillMissingExamples.length < 10) {
        stillMissingExamples.push({
          parent: { firstName: p.firstName, surname: p.surname, cellNo: p.cellNo, email: p.email },
          reason: match.reason,
        });
      }
      continue;
    }

    const nextId = match.idNumber;
    // Never overwrite existing ID (even if invalid format) unless it's blank.
    const currentDigits = digitsOnly(p.idNumber);
    if (currentDigits) {
      if (stillMissingExamples.length < 10) {
        stillMissingExamples.push({
          parent: { firstName: p.firstName, surname: p.surname, cellNo: p.cellNo, email: p.email },
          reason: "skipped: parent already has a non-blank idNumber value",
        });
      }
      continue;
    }

    const alreadyOwnedBy = existingIds.get(nextId);
    if (alreadyOwnedBy && alreadyOwnedBy !== p.id) {
      if (stillMissingExamples.length < 10) {
        stillMissingExamples.push({
          parent: { firstName: p.firstName, surname: p.surname, cellNo: p.cellNo, email: p.email },
          reason: `skipped: source ID number already belongs to a different parent record (${match.reason}, ${match.evidence.sourceFile}:${match.evidence.sourceRow})`,
        });
      }
      continue;
    }

    if (apply) {
      await prisma.parent.update({
        where: { id: p.id },
        data: { idNumber: nextId },
      });
    }
    existingIds.set(nextId, p.id);
    writes += 1;
  }

  const afterParents = (await prisma.parent.findMany({
    where: { schoolId },
    select: { idNumber: true },
  })) as Array<{ idNumber: string | null }>;
  const hasIdAfter = afterParents.filter((p) => isValidIdNumber(p.idNumber)).length;
  const stillMissing = totalParents - hasIdAfter;

  const auditPass = hasIdAfter >= hasIdBefore && stillMissing >= 0;

  // REQUIRED AUDIT OUTPUT (return only these results in chat).
  console.log(`Total parents: ${totalParents}`);
  console.log(`Parents with ID before: ${hasIdBefore}`);
  console.log(`Parents with ID after: ${hasIdAfter}`);
  console.log(`Parents still missing ID: ${stillMissing}`);
  console.log(`Examples still missing with reason:`);
  if (stillMissingExamples.length === 0) {
    console.log(`- (none captured)`);
  } else {
    for (const ex of stillMissingExamples) {
      const who = `${ex.parent.firstName} ${ex.parent.surname}`.trim();
      const contact = `cell=${ex.parent.cellNo || "(blank)"} email=${ex.parent.email || "(blank)"}`;
      console.log(`- ${who} (${contact}): ${ex.reason}`);
    }
  }
  console.log(`Audit ${auditPass ? "PASS" : "FAIL"}`);
  if (!auditPass) process.exit(1);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

