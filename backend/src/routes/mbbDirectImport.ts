import { spawn } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";

import { type Request, type Response, Router } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import { prisma } from "../prisma";

const router = Router();

const SCHOOL_ID = "cmq4xjckq00at60gqg4eb956h";
const SCHOOL_NAME = "Magical Bright Beginnings";
const MAX_FILE_BYTES = 80 * 1024 * 1024;
const MAX_FILES = 32;

const CLASS_FILES = new Set([
  "class_list.xls",
  "class_list (1).xls",
  "class_list (2).xls",
  "class_list (3).xls",
  "class_list (4).xls",
  "class_list (5).xls",
  "class_list (6).xls",
  "class_list (7).xls",
  "class_list (8).xls",
  "class_list (9).xls",
  "class_list (10).xls",
  "class_list (12).xls",
  "class_list (14).xls",
  "class_list (15).xls",
  "class_list (16).xls",
  "class_list (17).xls",
  "class_list (18).xls",
]);

const ROOT_FILES = new Set([
  "child_list_(6_extra_fields) (2).xls",
  "sibling_accounts.xls",
  "contact_list.xls",
  "birthday_employee_list.xls",
  "billing_plan_summary_by_child.xls",
  "account_list_(age_analysis).xls",
  "transaction_list-2.xls",
  "payment_receive_list.pdf",
]);

type ParsedMbbGroup = {
  sourceFile: string;
  sheetName: string;
  rowNumber: number;
  name: string;
  comments: string;
  status?: "ready" | "skip";
  reason?: string;
};

type MbbCleanupGroup = {
  id: string;
  name: string;
  comments: string;
  createdAt: Date;
  childrenCount: number;
  reason: string;
};

type ParsedMbbGroupAssignment = {
  sourceFile: string;
  sheetName: string;
  rowNumber: number;
  groupName: string;
  titleRow: number;
  learnerName: string;
  firstName: string;
  lastName: string;
  admissionNo: string;
};

type MbbLearnerIndexRow = {
  id: string;
  firstName: string;
  lastName: string;
  nickname: string | null;
  admissionNo: string | null;
};

type MbbLearnerCandidateDebug = {
  storedLearnerFullName: string;
  storedFirstName: string;
  storedSurname: string;
  normalizedStoredName: string;
  score: number;
};

type MbbUnmatchedLearnerDebug = {
  uploadedFilename: string;
  worksheetName: string;
  rowNumber: number;
  groupName: string;
  nameReadFromExcel: string;
  normalizedNameUsedForLookup: string;
  closestLearners: MbbLearnerCandidateDebug[];
  whyMatchFailed: string;
};

type MbbGroupLinkDebug = {
  uploadedFilename: string;
  worksheetName: string;
  derivedGroupName: string;
  detectedTitleRow: number;
  detectedGroupName: string;
  matchingGroupFound: boolean;
  matchingGroupId: string;
  learnerNamesRead: number;
  learnerIdsMatched: number;
  learnerLinksCreated: number;
};

function jsonError(res: Response, status: number, message: string) {
  return res.status(status).json({ success: false, error: message });
}

function uploadRoot() {
  const root = path.join(process.cwd(), "uploads", "mbb-direct-import");
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function safeName(value: string) {
  return path.basename(String(value || "upload").replace(/\0/g, ""));
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadRoot()),
    filename: (_req, file, cb) => {
      const suffix = crypto.randomBytes(8).toString("hex");
      cb(null, `${Date.now()}-${suffix}-${safeName(file.originalname)}`);
    },
  }),
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES },
});

function prepareImportFolder(files: Express.Multer.File[]) {
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const root = path.join(uploadRoot(), `run-${runId}`);
  const classDir = path.join(root, "MBB class list");
  fs.mkdirSync(classDir, { recursive: true });

  const seen = new Set<string>();
  for (const file of files) {
    const original = safeName(file.originalname);
    if (CLASS_FILES.has(original)) {
      fs.copyFileSync(file.path, path.join(classDir, original));
      seen.add(original);
    } else if (ROOT_FILES.has(original)) {
      fs.copyFileSync(file.path, path.join(root, original));
      seen.add(original);
    }
  }

  const required = [...CLASS_FILES, ...ROOT_FILES].filter((name) => name !== "payment_receive_list.pdf");
  const missing = required.filter((name) => !seen.has(name));
  return { root, classDir, missing };
}

function parseCountComparison(stdout: string) {
  return JSON.parse(stdout.trim()) as {
    schoolId: string;
    schoolName: string;
    counts: Record<string, { imported: number; exported: number }>;
  };
}

function normalizeName(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function normalizeKey(value: unknown) {
  return normalizeName(value).toLowerCase();
}

function normalizePersonKey(value: unknown) {
  return normalizeName(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizeLearnerLookupName(value: unknown) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function learnerLookupKey(value: unknown) {
  return normalizeLearnerLookupName(value)
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

function normalizeAdmissionKey(value: unknown) {
  return normalizeName(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function groupId() {
  return `grp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function groupLearnerId() {
  return `gl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function isAcceptedGroupsFile(fileName: string) {
  return new Set([".csv", ".xls", ".xlsx"]).has(path.extname(fileName).toLowerCase());
}

function assertSelectedMbbSchool(schoolId: string) {
  if (schoolId !== SCHOOL_ID) {
    throw new Error(`Import MBB Groups can only write to ${SCHOOL_NAME}.`);
  }
}

function pickHeaderColumn(headers: string[], labels: string[]) {
  return headers.findIndex((header) => labels.includes(header));
}

function normalizeHeader(value: unknown) {
  return normalizeName(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function pickHeaderColumnLoose(headers: string[], labels: string[]) {
  const labelSet = new Set(labels.map(normalizeHeader));
  return headers.findIndex((header) => labelSet.has(normalizeHeader(header)));
}

function firstNonEmptyCell(row: unknown[]) {
  for (const cell of row) {
    const value = normalizeName(cell);
    if (value) return value;
  }
  return "";
}

function detectSheetTitle(matrix: unknown[][], labelsToSkip: string[]) {
  const labels = new Set(labelsToSkip.map(normalizeHeader));
  for (let index = 0; index < Math.min(matrix.length, 12); index += 1) {
    const row = Array.isArray(matrix[index]) ? matrix[index] : [];
    const value = firstNonEmptyCell(row);
    if (!value) continue;
    if (labels.has(normalizeHeader(value))) continue;
    return { titleRow: index + 1, groupName: value };
  }
  return { titleRow: 0, groupName: "" };
}

function isNumericGroupName(value: unknown) {
  const name = normalizeName(value);
  return /^\d+(?:[.,]\d+)?$/.test(name);
}

async function loadMbbLearnerNameKeys() {
  const learners = await prisma.$queryRaw<Array<{ firstName: string; lastName: string; nickname: string | null }>>`
    SELECT "firstName", "lastName", "nickname"
    FROM "Learner"
    WHERE "schoolId" = ${SCHOOL_ID}
  `;
  const keys = new Set<string>();
  for (const learner of learners) {
    const first = normalizeName(learner.firstName);
    const last = normalizeName(learner.lastName);
    const nickname = normalizeName(learner.nickname);
    if (first && last) {
      keys.add(normalizePersonKey(`${first} ${last}`));
      keys.add(normalizePersonKey(`${last} ${first}`));
    }
    if (nickname && last) {
      keys.add(normalizePersonKey(`${nickname} ${last}`));
      keys.add(normalizePersonKey(`${last} ${nickname}`));
    }
  }
  keys.delete("");
  return keys;
}

function suspiciousGroupNameReason(name: unknown, learnerNameKeys: Set<string>) {
  const normalized = normalizeName(name);
  if (!normalized) return "Group name is blank";
  if (isNumericGroupName(normalized)) return "Group name looks numeric";
  if (learnerNameKeys.has(normalizePersonKey(normalized))) return "Group name matches an MBB learner name";
  return "";
}

async function assertNoSuspiciousGroupNames(rows: Array<{ name?: unknown }>) {
  const learnerNameKeys = await loadMbbLearnerNameKeys();
  const suspicious = rows
    .map((row) => ({
      name: normalizeName(row?.name),
      reason: suspiciousGroupNameReason(row?.name, learnerNameKeys),
    }))
    .filter((row) => row.reason);
  if (!suspicious.length) return;

  const examples = suspicious.slice(0, 8).map((row) => `${row.name || "(blank)"} (${row.reason})`);
  throw new Error(
    `MBB groups import refused because ${suspicious.length} group name(s) look like wrong-column data: ${examples.join("; ")}`
  );
}

function parseGroupRowsFromFile(file: Express.Multer.File): ParsedMbbGroup[] {
  const workbook = XLSX.readFile(file.path, { raw: false });
  const rows: ParsedMbbGroup[] = [];
  const nameLabels = ["group", "group name", "groups", "name", "class group", "activity group"];
  const commentLabels = ["comments", "comment", "notes", "note", "description"];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: "",
      raw: false,
    });
    if (!matrix.length) continue;

    const firstRow = Array.isArray(matrix[0])
      ? matrix[0].map((cell) => normalizeName(cell).toLowerCase())
      : [];
    const nameColumn = pickHeaderColumn(firstRow, nameLabels);
    const commentsColumn = pickHeaderColumn(firstRow, commentLabels);
    const hasHeader = nameColumn >= 0 || commentsColumn >= 0;
    const dataRows = hasHeader ? matrix.slice(1) : matrix;

    dataRows.forEach((row, index) => {
      const cells = Array.isArray(row) ? row : [];
      const name = normalizeName(cells[hasHeader && nameColumn >= 0 ? nameColumn : 0]);
      const comments = normalizeName(cells[hasHeader && commentsColumn >= 0 ? commentsColumn : 1]);
      if (!name) return;
      rows.push({
        sourceFile: safeName(file.originalname),
        sheetName,
        rowNumber: index + (hasHeader ? 2 : 1),
        name,
        comments,
      });
    });
  }

  return rows;
}

function parseGroupAssignmentsFromFile(file: Express.Multer.File): ParsedMbbGroupAssignment[] {
  const workbook = XLSX.readFile(file.path, { raw: false });
  const rows: ParsedMbbGroupAssignment[] = [];
  const fullNameLabels = ["learner name", "child name", "full name", "name"];
  const firstNameLabels = ["first name", "firstname", "name", "learner first name", "child first name"];
  const lastNameLabels = ["last name", "lastname", "surname", "learner surname", "child surname"];
  const admissionLabels = ["admission no", "admission number", "admission", "learner number", "student number", "child number"];
  const learnerHeaderLabels = [...fullNameLabels, ...firstNameLabels, ...lastNameLabels, ...admissionLabels];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: "",
      raw: false,
    });
    if (!matrix.length) continue;

    const { titleRow, groupName } = detectSheetTitle(matrix, learnerHeaderLabels);
    let parsedSheet = false;
    for (let headerIndex = Math.max(titleRow, 0); headerIndex < Math.min(matrix.length, 18); headerIndex += 1) {
      const headerRow = Array.isArray(matrix[headerIndex]) ? matrix[headerIndex].map(normalizeHeader) : [];
      const fullNameColumn = pickHeaderColumnLoose(headerRow, fullNameLabels);
      const firstNameColumn = pickHeaderColumnLoose(headerRow, firstNameLabels);
      const lastNameColumn = pickHeaderColumnLoose(headerRow, lastNameLabels);
      const admissionColumn = pickHeaderColumnLoose(headerRow, admissionLabels);
      const hasLearnerIdentifier = fullNameColumn >= 0 || admissionColumn >= 0 || (firstNameColumn >= 0 && lastNameColumn >= 0);
      if (!hasLearnerIdentifier) continue;

      matrix.slice(headerIndex + 1).forEach((row, index) => {
        const cells = Array.isArray(row) ? row : [];
        const firstName = normalizeName(cells[firstNameColumn]);
        const lastName = normalizeName(cells[lastNameColumn]);
        const explicitFullName = normalizeName(cells[fullNameColumn]);
        const learnerName = explicitFullName || normalizeName(`${firstName} ${lastName}`);
        const admissionNo = normalizeName(cells[admissionColumn]);
        if (!groupName || (!learnerName && !admissionNo)) return;
        rows.push({
          sourceFile: safeName(file.originalname),
          sheetName,
          rowNumber: headerIndex + index + 2,
          groupName,
          titleRow,
          learnerName,
          firstName,
          lastName,
          admissionNo,
        });
      });
      parsedSheet = true;
      break;
    }

    if (parsedSheet) continue;

    matrix.slice(Math.max(titleRow, 0)).forEach((row, index) => {
      const cells = Array.isArray(row) ? row : [];
      const learnerName = normalizeName(cells[0]);
      const admissionNo = normalizeName(cells[1]);
      if (normalizeKey(learnerName) === normalizeKey(groupName)) return;
      if (learnerHeaderLabels.map(normalizeHeader).includes(normalizeHeader(learnerName))) return;
      if (!groupName || (!learnerName && !admissionNo)) return;
      rows.push({
        sourceFile: safeName(file.originalname),
        sheetName,
        rowNumber: Math.max(titleRow, 0) + index + 1,
        groupName,
        titleRow,
        learnerName,
        firstName: "",
        lastName: "",
        admissionNo,
      });
    });
  }

  return rows;
}

async function verifyMbbSchool() {
  const rows = await prisma.$queryRaw<Array<{ id: string; name: string }>>`
    SELECT "id", "name"
    FROM "School"
    WHERE "id" = ${SCHOOL_ID}
    LIMIT 1
  `;
  const school = rows[0];
  if (!school || school.name !== SCHOOL_NAME) {
    throw new Error(`${SCHOOL_NAME} school record was not found.`);
  }
}

async function existingGroupKeys() {
  const existingRows = await prisma.$queryRaw<Array<{ name: string }>>`
    SELECT "name"
    FROM "Group"
    WHERE "schoolId" = ${SCHOOL_ID}
  `;
  return new Set(existingRows.map((row) => normalizeKey(row.name)));
}

async function loadMbbGroupsByName() {
  const groups = await prisma.$queryRaw<Array<{ id: string; name: string }>>`
    SELECT "id", "name"
    FROM "Group"
    WHERE "schoolId" = ${SCHOOL_ID}
  `;
  const byName = new Map<string, { id: string; name: string }>();
  for (const group of groups) byName.set(normalizeKey(group.name), group);
  return { groups, byName };
}

async function loadMbbLearnersForMatching() {
  const learners = await prisma.$queryRaw<MbbLearnerIndexRow[]>`
    SELECT "id", "firstName", "lastName", "nickname", "admissionNo"
    FROM "Learner"
    WHERE "schoolId" = ${SCHOOL_ID}
  `;
  const byAdmission = new Map<string, MbbLearnerIndexRow>();
  const byName = new Map<string, MbbLearnerIndexRow[]>();
  const addName = (name: string, learner: MbbLearnerIndexRow) => {
    const key = learnerLookupKey(name);
    if (!key) return;
    const rows = byName.get(key) || [];
    if (!rows.some((row) => row.id === learner.id)) rows.push(learner);
    byName.set(key, rows);
  };
  for (const learner of learners) {
    const admissionKey = normalizeAdmissionKey(learner.admissionNo);
    if (admissionKey && !byAdmission.has(admissionKey)) byAdmission.set(admissionKey, learner);

    const first = normalizeName(learner.firstName);
    const last = normalizeName(learner.lastName);
    const nickname = normalizeName(learner.nickname);
    for (const name of [
      `${first} ${last}`,
      `${last} ${first}`,
      nickname && last ? `${nickname} ${last}` : "",
      nickname && last ? `${last} ${nickname}` : "",
    ]) {
      addName(name, learner);
    }
  }
  return { learners, byAdmission, byName };
}

function matchMbbLearner(
  row: ParsedMbbGroupAssignment,
  indexes: Awaited<ReturnType<typeof loadMbbLearnersForMatching>>
) {
  const admissionKey = normalizeAdmissionKey(row.admissionNo);
  if (admissionKey) {
    const byAdmission = indexes.byAdmission.get(admissionKey);
    if (byAdmission) return byAdmission;
  }

  for (const candidate of [
    row.learnerName,
    `${row.firstName} ${row.lastName}`,
    `${row.lastName} ${row.firstName}`,
  ]) {
    const key = learnerLookupKey(candidate);
    if (!key) continue;
    const byName = indexes.byName.get(key) || [];
    if (byName.length === 1) return byName[0];
  }

  return null;
}

function learnerStoredFullName(learner: MbbLearnerIndexRow) {
  return normalizeName(`${learner.firstName} ${learner.lastName}`);
}

function stringSimilarity(a: string, b: string) {
  const left = learnerLookupKey(a);
  const right = learnerLookupKey(b);
  if (!left || !right) return 0;
  if (left === right) return 1000;
  const leftParts = new Set(normalizeLearnerLookupName(a).split(" ").filter(Boolean));
  const rightParts = new Set(normalizeLearnerLookupName(b).split(" ").filter(Boolean));
  let overlap = 0;
  for (const part of leftParts) {
    if (rightParts.has(part)) overlap += 1;
  }
  const prefix = left[0] === right[0] ? 1 : 0;
  const lengthDelta = Math.abs(left.length - right.length);
  return overlap * 100 + prefix * 10 - lengthDelta;
}

function closestLearnersForDebug(
  name: string,
  indexes: Awaited<ReturnType<typeof loadMbbLearnersForMatching>>,
  limit = 5
): MbbLearnerCandidateDebug[] {
  return indexes.learners
    .map((learner) => {
      const storedFullName = learnerStoredFullName(learner);
      return {
        storedLearnerFullName: storedFullName,
        storedFirstName: normalizeName(learner.firstName),
        storedSurname: normalizeName(learner.lastName),
        normalizedStoredName: normalizeLearnerLookupName(storedFullName),
        score: stringSimilarity(name, storedFullName),
      };
    })
    .sort((a, b) => b.score - a.score || a.storedLearnerFullName.localeCompare(b.storedLearnerFullName))
    .slice(0, limit);
}

function learnerMatchFailureReason(
  row: ParsedMbbGroupAssignment,
  indexes: Awaited<ReturnType<typeof loadMbbLearnersForMatching>>
) {
  const admissionKey = normalizeAdmissionKey(row.admissionNo);
  if (admissionKey && !indexes.byAdmission.has(admissionKey)) {
    return `No learner found with admission number ${admissionKey}.`;
  }
  const lookupKeys = [
    row.learnerName,
    `${row.firstName} ${row.lastName}`,
    `${row.lastName} ${row.firstName}`,
  ]
    .map(learnerLookupKey)
    .filter(Boolean);
  for (const key of lookupKeys) {
    const matches = indexes.byName.get(key) || [];
    if (matches.length > 1) {
      return `Multiple learners matched normalized key ${key}; automatic linking requires exactly one match.`;
    }
  }
  return `No stored MBB learner matched normalized key(s): ${lookupKeys.join(", ") || "none"}.`;
}

async function buildGroupsPreview(parsedRows: ParsedMbbGroup[]) {
  await verifyMbbSchool();
  await assertNoSuspiciousGroupNames(parsedRows);
  const existing = await existingGroupKeys();
  const seen = new Set<string>();

  const groups = parsedRows.map((row) => {
    const key = normalizeKey(row.name);
    if (existing.has(key)) {
      return { ...row, status: "skip" as const, reason: "Duplicate group name already exists" };
    }
    if (seen.has(key)) {
      return { ...row, status: "skip" as const, reason: "Duplicate group name in uploaded files" };
    }
    seen.add(key);
    return { ...row, status: "ready" as const, reason: "" };
  });

  const importedPreviewCount = groups.filter((row) => row.status === "ready").length;
  const skippedCount = groups.length - importedPreviewCount;
  return {
    success: true,
    schoolId: SCHOOL_ID,
    schoolName: SCHOOL_NAME,
    groups,
    importedPreviewCount,
    skippedCount,
    totalGroups: groups.length,
  };
}

async function buildBadGroupsCleanupPreview() {
  await verifyMbbSchool();
  const rows = await prisma.$queryRaw<Array<{ id: string; name: string; comments: string; createdAt: Date; childrenCount: bigint }>>`
    SELECT
      g."id",
      g."name",
      g."comments",
      g."createdAt",
      COUNT(gl."learnerId") AS "childrenCount"
    FROM "Group" g
    LEFT JOIN "GroupLearner" gl
      ON gl."groupId" = g."id"
      AND gl."schoolId" = g."schoolId"
    WHERE g."schoolId" = ${SCHOOL_ID}
    GROUP BY g."id", g."name", g."comments", g."createdAt"
    ORDER BY g."createdAt" DESC, g."name" ASC
  `;

  const groupsToDelete: MbbCleanupGroup[] = [];
  const protectedGroups: MbbCleanupGroup[] = [];
  for (const row of rows) {
    const childrenCount = Number(row.childrenCount || 0);
    const item = {
      id: row.id,
      name: row.name,
      comments: row.comments,
      createdAt: row.createdAt,
      childrenCount,
      reason: isNumericGroupName(row.name)
        ? childrenCount === 0
          ? "Numeric group name from bad import"
          : "Protected: group has learners linked"
        : "Protected: group name is not numeric",
    };
    if (isNumericGroupName(row.name) && childrenCount === 0) {
      groupsToDelete.push(item);
    } else {
      protectedGroups.push(item);
    }
  }

  return {
    success: true,
    schoolId: SCHOOL_ID,
    schoolName: SCHOOL_NAME,
    groupsToDelete,
    protectedGroups,
    deleteCount: groupsToDelete.length,
    protectedCount: protectedGroups.length,
  };
}

async function linkMbbLearnersToGroups(assignments: ParsedMbbGroupAssignment[]) {
  await verifyMbbSchool();
  const { groups: existingGroups, byName: groupsByName } = await loadMbbGroupsByName();
  const learnerIndexes = await loadMbbLearnersForMatching();
  const debugByGroup = new Map<string, MbbGroupLinkDebug>();
  const plannedLinks: Array<{
    assignment: ParsedMbbGroupAssignment;
    group: { id: string; name: string } | undefined;
    learner: MbbLearnerIndexRow | null;
    debugKey: string;
  }> = [];

  for (const assignment of assignments) {
    const group = groupsByName.get(normalizeKey(assignment.groupName));
    const learner = matchMbbLearner(assignment, learnerIndexes);
    const debugKey = `${assignment.sourceFile}\u0000${assignment.sheetName}\u0000${assignment.groupName}`;
    const current =
      debugByGroup.get(debugKey) ||
      {
        uploadedFilename: assignment.sourceFile,
        worksheetName: assignment.sheetName,
        derivedGroupName: assignment.groupName,
        detectedTitleRow: assignment.titleRow,
        detectedGroupName: assignment.groupName,
        matchingGroupFound: Boolean(group),
        matchingGroupId: group?.id || "",
        learnerNamesRead: 0,
        learnerIdsMatched: 0,
        learnerLinksCreated: 0,
      };
    current.matchingGroupFound = Boolean(group);
    current.matchingGroupId = group?.id || "";
    current.learnerNamesRead += 1;
    if (learner) current.learnerIdsMatched += 1;
    debugByGroup.set(debugKey, current);
    plannedLinks.push({ assignment, group, learner, debugKey });
  }

  const debug = Array.from(debugByGroup.values());
  const normalizationUsed =
    "Group names are derived from the first non-empty title cell at the top of each worksheet; group matching trims/collapses spaces and is case-insensitive. Learner matching replaces NBSP, trims, collapses whitespace, uppercases, removes punctuation for lookup, and compares against stored firstName + surname.";
  const unmatchedGroupDebug = debug.filter((row) => !row.matchingGroupFound);
  if (unmatchedGroupDebug.length) {
    const existingGroupNames = existingGroups.map((group) => group.name).sort((a, b) => a.localeCompare(b));
    console.warn("[mbb-groups/link-learners] blocked: unmatched group names", {
      unmatchedGroupDebug,
      existingGroupNames,
      normalizationUsed,
    });
    for (const row of debug) {
      console.info("[mbb-groups/link-learners] preflight", row);
    }
    return {
      success: true,
      blocked: true,
      schoolId: SCHOOL_ID,
      schoolName: SCHOOL_NAME,
      error: "No learner-group links were created because one or more uploaded files did not match an existing MBB group.",
      learnersLinked: 0,
      learnersAlreadyLinked: 0,
      learnersSkippedNoGroup: assignments.length,
      learnersSkippedNoLearner: 0,
      groupsUpdated: 0,
      debug,
      unmatchedGroupDebug,
      existingGroupNames,
      normalizationUsed,
    };
  }

  for (const row of debug) {
    console.info("[mbb-groups/link-learners] preflight", row);
  }

  const seenPairs = new Set<string>();
  const updatedGroupIds = new Set<string>();
  const skippedNoGroup: ParsedMbbGroupAssignment[] = [];
  const skippedNoLearner: ParsedMbbGroupAssignment[] = [];
  const unmatchedLearnerDebug: MbbUnmatchedLearnerDebug[] = [];
  let linkedCount = 0;
  let alreadyLinkedCount = 0;

  for (const { assignment, group, learner, debugKey } of plannedLinks) {
    if (!group) {
      skippedNoGroup.push(assignment);
      continue;
    }

    if (!learner) {
      skippedNoLearner.push(assignment);
      unmatchedLearnerDebug.push({
        uploadedFilename: assignment.sourceFile,
        worksheetName: assignment.sheetName,
        rowNumber: assignment.rowNumber,
        groupName: assignment.groupName,
        nameReadFromExcel: assignment.learnerName,
        normalizedNameUsedForLookup: normalizeLearnerLookupName(assignment.learnerName),
        closestLearners: closestLearnersForDebug(assignment.learnerName, learnerIndexes),
        whyMatchFailed: learnerMatchFailureReason(assignment, learnerIndexes),
      });
      continue;
    }

    const pairKey = `${group.id}:${learner.id}`;
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);

    const inserted = await prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "GroupLearner" ("id", "schoolId", "groupId", "learnerId", "createdAt")
      VALUES (${groupLearnerId()}, ${SCHOOL_ID}, ${group.id}, ${learner.id}, CURRENT_TIMESTAMP)
      ON CONFLICT ("groupId", "learnerId") DO NOTHING
      RETURNING "id"
    `;
    updatedGroupIds.add(group.id);
    if (inserted.length > 0) {
      linkedCount += 1;
      const debugRow = debugByGroup.get(debugKey);
      if (debugRow) debugRow.learnerLinksCreated += 1;
    } else {
      alreadyLinkedCount += 1;
    }
  }

  return {
    success: true,
    schoolId: SCHOOL_ID,
    schoolName: SCHOOL_NAME,
    learnersLinked: linkedCount,
    learnersAlreadyLinked: alreadyLinkedCount,
    learnersSkippedNoGroup: skippedNoGroup.length,
    learnersSkippedNoLearner: skippedNoLearner.length,
    groupsUpdated: updatedGroupIds.size,
    debug: Array.from(debugByGroup.values()),
    unmatchedLearnerDebug,
    skippedNoGroup: skippedNoGroup.slice(0, 30).map((row) => ({
      sourceFile: row.sourceFile,
      sheetName: row.sheetName,
      rowNumber: row.rowNumber,
      groupName: row.groupName,
      learnerName: row.learnerName,
      admissionNo: row.admissionNo,
    })),
  };
}

function runImporter(
  root: string,
  classDir: string,
  opts: { repairMissingLearners?: boolean } = {}
): Promise<{ stdout: string; stderr: string }> {
  const script = path.join(process.cwd(), "scripts", "emergency-direct-import-mbb.mjs");
  const args = [
    script,
    "--write",
    "--desktop-dir",
    root,
    "--class-dir",
    classDir,
    "--approve-school-id",
    SCHOOL_ID,
    "--confirm-live-write",
    "MBB_DIRECT_IMPORT",
    "--counts-only",
  ];
  if (opts.repairMissingLearners) args.push("--repair-missing-learners");

  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      args,
      {
        cwd: process.cwd(),
        env: { ...process.env, CONFIRM_PRODUCTION_WRITE: "true" },
      }
    );

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolve({ stdout, stderr });
      const error = new Error(`MBB direct import failed with exit code ${code}`);
      Object.assign(error, { stdout, stderr });
      return reject(error);
    });
  });
}

async function prepareAndRun(
  req: Request,
  res: Response,
  opts: { repairMissingLearners?: boolean } = {}
) {
  const started = Date.now();
  try {
    const files = Array.isArray(req.files) ? (req.files as Express.Multer.File[]) : [];
    if (!files.length) {
      return res.status(400).json({ success: false, error: "Upload the MBB Kid-e-Sys files as files" });
    }

    const { root, classDir, missing } = prepareImportFolder(files);
    if (missing.length) {
      return res.status(400).json({ success: false, error: "Missing required MBB files", missing });
    }

    const { stdout } = await runImporter(root, classDir, opts);
    const comparison = parseCountComparison(stdout);
    return res.json({
      success: true,
      ...comparison,
      executionTimeMs: Date.now() - started,
    });
  } catch (error: unknown) {
    const err = error as Error & { stdout?: string; stderr?: string };
    return res.status(500).json({
      success: false,
      error: err.message || "MBB direct import failed",
      stdout: err.stdout,
      stderr: err.stderr,
      executionTimeMs: Date.now() - started,
    });
  }
}

router.post("/run", upload.array("files", MAX_FILES), async (req, res) => {
  return prepareAndRun(req, res);
});

router.post("/repair-missing-learners", upload.array("files", MAX_FILES), async (req, res) => {
  return prepareAndRun(req, res, { repairMissingLearners: true });
});

router.post("/groups/preview", upload.array("files", MAX_FILES), async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    assertSelectedMbbSchool(schoolId);

    const files = Array.isArray(req.files) ? (req.files as Express.Multer.File[]) : [];
    if (!files.length) return jsonError(res, 400, "Upload the MBB Groups Excel/CSV files.");

    const invalid = files.find((file) => !isAcceptedGroupsFile(file.originalname));
    if (invalid) {
      return jsonError(res, 400, `File must be .csv, .xls, or .xlsx: ${safeName(invalid.originalname)}`);
    }

    const parsedRows = files.flatMap(parseGroupRowsFromFile);
    if (!parsedRows.length) return jsonError(res, 400, "No group names found in the uploaded files.");

    return res.json(await buildGroupsPreview(parsedRows));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to preview MBB groups import";
    return jsonError(res, 500, message);
  }
});

router.post("/groups/import", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    assertSelectedMbbSchool(schoolId);
    await verifyMbbSchool();

    const incomingRows = Array.isArray(req.body?.groups) ? req.body.groups : [];
    await assertNoSuspiciousGroupNames(incomingRows);
    const existing = await existingGroupKeys();
    const seen = new Set<string>();
    let importedCount = 0;
    let skippedCount = 0;

    for (const row of incomingRows) {
      const name = normalizeName(row?.name);
      const comments = normalizeName(row?.comments);
      const key = normalizeKey(name);
      if (!name || existing.has(key) || seen.has(key)) {
        skippedCount += 1;
        continue;
      }

      seen.add(key);
      const inserted = await prisma.$queryRaw<Array<{ id: string }>>`
        INSERT INTO "Group" ("id", "schoolId", "name", "comments", "createdAt", "updatedAt")
        VALUES (${groupId()}, ${SCHOOL_ID}, ${name}, ${comments}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT ("schoolId", "name") DO NOTHING
        RETURNING "id"
      `;
      existing.add(key);
      if (inserted.length > 0) {
        importedCount += 1;
      } else {
        skippedCount += 1;
      }
    }

    return res.json({
      success: true,
      schoolId: SCHOOL_ID,
      schoolName: SCHOOL_NAME,
      importedCount,
      skippedCount,
      totalGroups: incomingRows.length,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to import MBB groups";
    return jsonError(res, 500, message);
  }
});

router.get("/groups/cleanup-preview", async (req, res) => {
  try {
    const schoolId = String(req.query?.schoolId || "").trim();
    assertSelectedMbbSchool(schoolId);
    return res.json(await buildBadGroupsCleanupPreview());
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to preview MBB groups cleanup";
    return jsonError(res, 500, message);
  }
});

router.post("/groups/cleanup-bad-import", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    assertSelectedMbbSchool(schoolId);

    const preview = await buildBadGroupsCleanupPreview();
    const deletedGroups: MbbCleanupGroup[] = [];
    for (const group of preview.groupsToDelete) {
      const deleted = await prisma.$queryRaw<Array<{ id: string }>>`
        DELETE FROM "Group"
        WHERE "id" = ${group.id}
          AND "schoolId" = ${SCHOOL_ID}
          AND "name" = ${group.name}
          AND NOT EXISTS (
            SELECT 1
            FROM "GroupLearner" gl
            WHERE gl."groupId" = "Group"."id"
          )
        RETURNING "id"
      `;
      if (deleted.length > 0) deletedGroups.push(group);
    }

    return res.json({
      success: true,
      schoolId: SCHOOL_ID,
      schoolName: SCHOOL_NAME,
      deletedGroups,
      protectedGroups: preview.protectedGroups,
      deletedCount: deletedGroups.length,
      protectedCount: preview.protectedGroups.length,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to remove bad MBB groups import";
    return jsonError(res, 500, message);
  }
});

router.post("/groups/link-learners", upload.array("files", MAX_FILES), async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    assertSelectedMbbSchool(schoolId);

    const files = Array.isArray(req.files) ? (req.files as Express.Multer.File[]) : [];
    if (!files.length) return jsonError(res, 400, "Upload the MBB group Excel files.");

    const invalid = files.find((file) => !isAcceptedGroupsFile(file.originalname));
    if (invalid) {
      return jsonError(res, 400, `File must be .csv, .xls, or .xlsx: ${safeName(invalid.originalname)}`);
    }

    const assignments = files.flatMap(parseGroupAssignmentsFromFile).filter((row) => row.groupName);
    if (!assignments.length) {
      return jsonError(res, 400, "No learners found in the uploaded group files.");
    }

    return res.json(await linkMbbLearnersToGroups(assignments));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to link MBB learners to groups";
    return jsonError(res, 500, message);
  }
});

export default router;
