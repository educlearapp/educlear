"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
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
require("dotenv/config");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const prisma_1 = require("../src/prisma");
const parentPortalService_1 = require("../src/services/parentPortalService");
const sasamsParsers_1 = require("../src/services/daSilvaMigration/sasamsParsers");
function arg(name) {
    const idx = process.argv.indexOf(`--${name}`);
    if (idx === -1)
        return null;
    const v = process.argv[idx + 1];
    return v ? String(v).trim() : null;
}
function hasFlag(name) {
    return process.argv.includes(`--${name}`);
}
function digitsOnly(value) {
    return String(value || "").replace(/\D/g, "");
}
function normalizeName(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ")
        .replace(/[^a-z0-9 ]/g, "");
}
function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
}
function normalizeCell(value) {
    const raw = String(value || "").trim();
    if (!raw)
        return "";
    const phone = (0, parentPortalService_1.normalizeSaPhone)(raw);
    if (phone?.localCell)
        return phone.localCell;
    return digitsOnly(raw);
}
function isValidIdNumber(idNumber) {
    const digits = digitsOnly(idNumber);
    // SA IDs are 13 digits, but SA-SAMS sometimes stores other official identifiers.
    // Rule: never invent — only accept IDs present in source, and never overwrite existing IDs.
    return digits.length >= 6;
}
function safeReadSasamsParentSource(filePath) {
    try {
        if (/parent_learner_links/i.test(path_1.default.basename(filePath)))
            return (0, sasamsParsers_1.parseSasamsParentLearnerLinks)(filePath);
        return (0, sasamsParsers_1.parseSasamsParentRegister)(filePath);
    }
    catch {
        return [];
    }
}
function listCandidateParentFiles(root) {
    if (!fs_1.default.existsSync(root))
        return [];
    const out = [];
    const walk = (dir) => {
        for (const entry of fs_1.default.readdirSync(dir, { withFileTypes: true })) {
            const full = path_1.default.join(dir, entry.name);
            if (entry.isDirectory()) {
                // Skip node_modules-like folders defensively.
                if (entry.name.startsWith(".") || entry.name.toLowerCase() === "node_modules")
                    continue;
                walk(full);
                continue;
            }
            if (!/\.(xls|xlsx)$/i.test(entry.name))
                continue;
            const name = entry.name.toLowerCase();
            if (name.includes("parent_learner_links") ||
                name.includes("parent_register") ||
                name.includes("parent_contact") ||
                name.includes("parents") ||
                name.includes("guardian") ||
                (name.includes("parent") && name.includes("contact")) ||
                name.includes("contact")) {
                out.push(full);
            }
        }
    };
    walk(root);
    // Prefer deterministic order.
    return out.sort((a, b) => a.localeCompare(b));
}
function sourceRowToCandidate(row) {
    if (!isValidIdNumber(row.idNumber))
        return null;
    const idDigits = digitsOnly(row.idNumber);
    const firstName = String(row.firstName || "").trim();
    const surname = String(row.surname || "").trim();
    if (!firstName || !surname)
        return null;
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
function pickUniqueId(candidates, reasonBase) {
    if (candidates.length === 0)
        return { ok: false, reason: "no source rows" };
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
function buildIndexes(source) {
    const byNameSurnameCell = new Map();
    const byNameSurnameEmail = new Map();
    const byNameSurnameLearner = new Map();
    const byNormNameSurname = new Map();
    const push = (map, key, row) => {
        if (!key)
            return;
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
        const learnerKey = row.learnerFirstName && row.learnerLastName
            ? `${nameKey}|${normalizeName(row.learnerFirstName)}|${normalizeName(row.learnerLastName)}`
            : "";
        if (learnerKey)
            push(byNameSurnameLearner, learnerKey, row);
    }
    return { byNameSurnameCell, byNameSurnameEmail, byNameSurnameLearner, byNormNameSurname };
}
function matchParentId(opts) {
    const p = opts.parent;
    const nFirst = normalizeName(p.firstName);
    const nLast = normalizeName(p.surname);
    const nameKey = `${nFirst}|${nLast}`;
    const cellKey = `${nameKey}|${normalizeCell(p.cellNo)}`;
    const emailKey = `${nameKey}|${normalizeEmail(p.email)}`;
    // 1) Exact parent ID if already linked elsewhere — for this task, interpret as strongest match:
    // name + surname + cell (exact-ish via normalization), since cell numbers are already present in DB.
    const byCell = opts.indexes.byNameSurnameCell.get(cellKey) || [];
    if (byCell.length)
        return pickUniqueId(byCell, "parent name + surname + cell");
    // 2) Parent name + surname + email
    if (normalizeEmail(p.email)) {
        const byEmail = opts.indexes.byNameSurnameEmail.get(emailKey) || [];
        if (byEmail.length)
            return pickUniqueId(byEmail, "parent name + surname + email");
    }
    // 3) Parent name + surname + linked learner
    for (const link of p.links) {
        const learnerKey = `${nameKey}|${normalizeName(link.learner.firstName)}|${normalizeName(link.learner.lastName)}`;
        const byLearner = opts.indexes.byNameSurnameLearner.get(learnerKey) || [];
        if (byLearner.length)
            return pickUniqueId(byLearner, "parent name + surname + linked learner");
    }
    // 4) Normalized parent name + surname
    const byName = opts.indexes.byNormNameSurname.get(nameKey) || [];
    if (byName.length)
        return pickUniqueId(byName, "normalized parent name + surname");
    return { ok: false, reason: "no source match on priority rules" };
}
async function main() {
    const schoolId = arg("schoolId");
    const sourceRoot = arg("source");
    const projectId = arg("projectId");
    const apply = hasFlag("apply");
    if (!schoolId || (!sourceRoot && !projectId)) {
        console.error("Usage: npx tsx scripts/backfill-sasams-parent-ids.ts --schoolId <id> (--source <sasamsFolder> | --projectId <migrationProjectId>) [--apply]");
        process.exit(1);
    }
    const stagingUploadsRoot = projectId
        ? path_1.default.join(process.cwd(), "uploads", "migration-staging", schoolId, projectId, "uploads")
        : null;
    const effectiveSourceRoot = sourceRoot ? sourceRoot : stagingUploadsRoot;
    // Parse source files.
    const candidateFiles = (() => {
        if (sourceRoot) {
            // When a folder contains multiple exports (common in staging/tmp), scan all parent/contact candidates
            // instead of enforcing a single canonical filename.
            return listCandidateParentFiles(sourceRoot);
        }
        return listCandidateParentFiles(effectiveSourceRoot);
    })();
    const parsedParents = [];
    for (const filePath of candidateFiles) {
        const rows = safeReadSasamsParentSource(filePath);
        for (const r of rows) {
            const cand = sourceRowToCandidate(r);
            if (cand)
                parsedParents.push(cand);
        }
    }
    const indexes = buildIndexes(parsedParents);
    const parents = (await prisma_1.prisma.parent.findMany({
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
    }));
    const totalParents = parents.length;
    const hasIdBefore = parents.filter((p) => isValidIdNumber(p.idNumber)).length;
    const existingIds = new Map(); // idNumber -> parentId
    for (const p of parents) {
        const idDigits = digitsOnly(p.idNumber);
        if (idDigits.length >= 6)
            existingIds.set(idDigits, p.id);
    }
    const missingBefore = parents.filter((p) => !isValidIdNumber(p.idNumber));
    const stillMissingExamples = [];
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
            await prisma_1.prisma.parent.update({
                where: { id: p.id },
                data: { idNumber: nextId },
            });
        }
        existingIds.set(nextId, p.id);
        writes += 1;
    }
    const afterParents = (await prisma_1.prisma.parent.findMany({
        where: { schoolId },
        select: { idNumber: true },
    }));
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
    }
    else {
        for (const ex of stillMissingExamples) {
            const who = `${ex.parent.firstName} ${ex.parent.surname}`.trim();
            const contact = `cell=${ex.parent.cellNo || "(blank)"} email=${ex.parent.email || "(blank)"}`;
            console.log(`- ${who} (${contact}): ${ex.reason}`);
        }
    }
    console.log(`Audit ${auditPass ? "PASS" : "FAIL"}`);
    if (!auditPass)
        process.exit(1);
}
main()
    .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
})
    .finally(() => prisma_1.prisma.$disconnect());
