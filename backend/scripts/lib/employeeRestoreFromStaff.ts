/**
 * Shared helpers: restore Da Silva Payroll Employee rows from production STAFF User accounts.
 * Employees only — does not read or write billing, payments, Users, or migration data.
 */
import fs from "fs";
import path from "path";

import { PrismaClient } from "@prisma/client";

export const DA_SILVA_SCHOOL_ID = "cmpideqeq0000108xb6ouv9zi";
export const RESTORE_NOTE_PREFIX = "[educlear-employee-restore:";
export const CONFIRM_APPLY_ENV = "CONFIRM_PRODUCTION_EMPLOYEE_RESTORE";
export const CONFIRM_ROLLBACK_ENV = "CONFIRM_PRODUCTION_EMPLOYEE_RESTORE_ROLLBACK";

export const BLANK_EMPLOYEE_FIELDS = [
  "idNumber",
  "dateOfBirth",
  "gender",
  "jobTitle",
  "department",
  "employeeNumber",
  "startDate",
  "endDate",
  "taxNumber",
  "bankName",
  "bankAccountHolder",
  "bankAccountNumber",
  "bankBranchCode",
  "physicalAddress",
  "mobileNumber",
] as const;

export type StaffSourceRow = {
  userId: string;
  fullName: string | null;
  email: string;
  createdAt: Date;
  isActive: boolean;
  rbacFirstName: string;
  rbacSurname: string;
  proposedFirstName: string;
  proposedLastName: string;
  mobileNumber: string | null;
  physicalAddress: string | null;
  xlsMatch: string | null;
};

export type DuplicateCheckResult =
  | { status: "create" }
  | { status: "skip"; reason: string; existingEmployeeId: string };

export type RestoreManifest = {
  batchId: string;
  schoolId: string;
  schoolName: string;
  appliedAt: string;
  source: "staff-users";
  staffCount: number;
  createdCount: number;
  skippedCount: number;
  createdEmployeeIds: string[];
  skipped: Array<{ userId: string; email: string; reason: string; existingEmployeeId?: string }>;
  rows: Array<{
    userId: string;
    email: string;
    firstName: string;
    lastName: string;
    employeeId?: string;
    action: "created" | "skipped";
  }>;
};

export function restoreBatchNote(batchId: string): string {
  return `${RESTORE_NOTE_PREFIX}${batchId}]`;
}

export function storageRoot(): string {
  return path.join(process.cwd(), "storage");
}

export function manifestDir(batchId: string): string {
  return path.join(storageRoot(), `employee-restore-apply-${batchId}`);
}

export function manifestPath(batchId: string): string {
  return path.join(manifestDir(batchId), "manifest.json");
}

export function requireProductionDatabaseUrl(): string {
  const url = String(process.env.DATABASE_URL || "").trim();
  if (!url) {
    throw new Error("DATABASE_URL is required (set to production PostgreSQL for Da Silva restore scripts).");
  }
  if (url.includes("localhost") || url.includes("127.0.0.1")) {
    throw new Error(
      "DATABASE_URL points to localhost. Set production DATABASE_URL before running production employee restore scripts."
    );
  }
  return url;
}

export function assertConfirm(envName: string): void {
  if (String(process.env[envName] || "").trim().toLowerCase() !== "true") {
    throw new Error(`${envName}=true is required for this operation.`);
  }
}

function normalizeNamePart(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function titleCaseWord(word: string): string {
  if (!word) return word;
  if (word.length <= 2 && word === word.toUpperCase()) return word;
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function titleCaseName(value: string): string {
  return normalizeNamePart(value)
    .split(" ")
    .map((part) =>
      part
        .split("-")
        .map((p) => titleCaseWord(p))
        .join("-")
    )
    .join(" ");
}

/** Split a display name into firstName / lastName for Employee rows. */
export function splitDisplayName(displayName: string): { firstName: string; lastName: string } {
  const cleaned = normalizeNamePart(displayName);
  if (!cleaned) return { firstName: "", lastName: "" };

  const particles = new Set(["van", "der", "de", "du", "le", "la", "von"]);
  const parts = cleaned.split(" ");
  if (parts.length === 1) return { firstName: titleCaseName(parts[0]), lastName: "" };

  let splitAt = parts.length - 1;
  while (splitAt > 1 && particles.has(parts[splitAt - 1].toLowerCase())) {
    splitAt -= 1;
  }

  const firstName = titleCaseName(parts.slice(0, splitAt).join(" "));
  const lastName = titleCaseName(parts.slice(splitAt).join(" "));
  return { firstName, lastName };
}

export function proposeEmployeeName(input: {
  fullName: string | null;
  rbacFirstName: string;
  rbacSurname: string;
}): { firstName: string; lastName: string } {
  const rbacFirst = normalizeNamePart(input.rbacFirstName);
  const rbacLast = normalizeNamePart(input.rbacSurname);

  if (rbacFirst && rbacLast && !rbacFirst.toLowerCase().includes(rbacLast.toLowerCase())) {
    return {
      firstName: titleCaseName(rbacFirst),
      lastName: titleCaseName(rbacLast),
    };
  }

  const source = normalizeNamePart(input.fullName || "") || rbacFirst || rbacLast;
  return splitDisplayName(source);
}

type XlsContactRow = {
  normalizedName: string;
  displayName: string;
  mobileNumber: string | null;
  physicalAddress: string | null;
};

function normalizeComparableName(value: string): string {
  return normalizeNamePart(value).toLowerCase().replace(/[^a-z0-9 ]/g, "");
}

function loadXlsContactRows(): XlsContactRow[] {
  const candidates = [
    path.join(process.cwd(), "uploads", "migration-staging", "tmp", "1779892585165-employee_contact_list.xls"),
    path.join(process.cwd(), "storage", "migration-staging", "1779791960544-640174273-employee_contact_list.xls"),
  ];

  let filePath = "";
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      filePath = candidate;
      break;
    }
  }
  if (!filePath) return [];

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const xlsx = require("xlsx") as typeof import("xlsx");
    const wb = xlsx.readFile(filePath);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const data = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as unknown[][];

    const rows: XlsContactRow[] = [];
    for (const row of data) {
      const displayName = String(row[0] || "").trim();
      if (!displayName || displayName.toLowerCase().includes("da silva")) continue;
      if (!/^[A-Za-z]/.test(displayName)) continue;
      rows.push({
        normalizedName: normalizeComparableName(displayName),
        displayName,
        mobileNumber: String(row[1] || "").trim() || null,
        physicalAddress: String(row[2] || "").trim() || null,
      });
    }
    return rows;
  } catch {
    return [];
  }
}

function findXlsEnrichment(
  rows: XlsContactRow[],
  proposedFirstName: string,
  proposedLastName: string,
  fullName: string | null
): XlsContactRow | null {
  const targets = [
    normalizeComparableName(`${proposedFirstName} ${proposedLastName}`),
    normalizeComparableName(fullName || ""),
  ].filter(Boolean);

  for (const target of targets) {
    const exact = rows.find((row) => row.normalizedName === target);
    if (exact) return exact;
  }

  for (const target of targets) {
    const partial = rows.find(
      (row) => row.normalizedName.includes(target) || target.includes(row.normalizedName)
    );
    if (partial) return partial;
  }

  return null;
}

export async function loadStaffSourceRows(prisma: PrismaClient): Promise<StaffSourceRow[]> {
  const xlsRows = loadXlsContactRows();

  const staff = await prisma.user.findMany({
    where: { schoolId: DA_SILVA_SCHOOL_ID, role: "STAFF" },
    include: { rbacMeta: true },
    orderBy: [{ fullName: "asc" }, { email: "asc" }],
  });

  return staff.map((user) => {
    const rbacFirstName = user.rbacMeta?.firstName || "";
    const rbacSurname = user.rbacMeta?.surname || "";
    const { firstName, lastName } = proposeEmployeeName({
      fullName: user.fullName,
      rbacFirstName,
      rbacSurname,
    });
    const xls = findXlsEnrichment(xlsRows, firstName, lastName, user.fullName);

    return {
      userId: user.id,
      fullName: user.fullName,
      email: user.email,
      createdAt: user.createdAt,
      isActive: user.isActive,
      rbacFirstName,
      rbacSurname,
      proposedFirstName: firstName,
      proposedLastName: lastName,
      mobileNumber: xls?.mobileNumber || null,
      physicalAddress: xls?.physicalAddress || null,
      xlsMatch: xls?.displayName || null,
    };
  });
}

export async function loadExistingEmployees(prisma: PrismaClient) {
  return prisma.employee.findMany({
    where: { schoolId: DA_SILVA_SCHOOL_ID },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      notes: true,
    },
  });
}

export function duplicateCheck(
  existing: Array<{ id: string; firstName: string; lastName: string; email: string | null }>,
  row: StaffSourceRow
): DuplicateCheckResult {
  const emailKey = row.email.trim().toLowerCase();
  const nameKey = `${row.proposedFirstName} ${row.proposedLastName}`.trim().toLowerCase();

  const byEmail = existing.find((e) => String(e.email || "").trim().toLowerCase() === emailKey);
  if (byEmail) {
    return {
      status: "skip",
      reason: "duplicate email",
      existingEmployeeId: byEmail.id,
    };
  }

  const byName = existing.find((e) => {
    const existingName = `${e.firstName} ${e.lastName}`.trim().toLowerCase();
    return existingName === nameKey;
  });
  if (byName) {
    return {
      status: "skip",
      reason: "duplicate name",
      existingEmployeeId: byName.id,
    };
  }

  return { status: "create" };
}

export function buildEmployeeCreateData(
  row: StaffSourceRow,
  batchId: string
): {
  schoolId: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  mobileNumber: string | null;
  physicalAddress: string | null;
  isActive: boolean;
  notes: string;
} {
  return {
    schoolId: DA_SILVA_SCHOOL_ID,
    firstName: row.proposedFirstName,
    lastName: row.proposedLastName,
    fullName: `${row.proposedFirstName} ${row.proposedLastName}`.trim(),
    email: row.email.trim(),
    mobileNumber: row.mobileNumber,
    physicalAddress: row.physicalAddress,
    isActive: row.isActive,
    notes: `${restoreBatchNote(batchId)} sourceUserId=${row.userId}`,
  };
}

export function formatExportReport(rows: StaffSourceRow[], schoolName: string): string {
  const lines: string[] = [];
  lines.push("EduClear Employee Restore — STAFF Export Report (read-only)");
  lines.push(`School: ${schoolName} (${DA_SILVA_SCHOOL_ID})`);
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`STAFF source rows: ${rows.length}`);
  lines.push("");
  lines.push(
    " # | Full name | Email | Created (UTC) | Proposed firstName | Proposed lastName | XLS match"
  );
  lines.push("-".repeat(120));

  rows.forEach((row, index) => {
    lines.push(
      [
        String(index + 1).padStart(2, " "),
        row.fullName || "(none)",
        row.email,
        row.createdAt.toISOString(),
        row.proposedFirstName,
        row.proposedLastName,
        row.xlsMatch || "-",
      ].join(" | ")
    );
  });

  lines.push("");
  lines.push("First 10 names:");
  rows.slice(0, 10).forEach((row, index) => {
    lines.push(`${index + 1}. ${row.proposedFirstName} ${row.proposedLastName} <${row.email}>`);
  });

  return lines.join("\n");
}

export function formatDryRunReport(input: {
  schoolName: string;
  rows: StaffSourceRow[];
  existingCount: number;
  wouldCreate: StaffSourceRow[];
  wouldSkip: Array<{ row: StaffSourceRow; reason: string; existingEmployeeId: string }>;
  xlsPhoneMatches: number;
  xlsAddressMatches: number;
}): string {
  const lines: string[] = [];
  lines.push("EduClear Employee Restore — Dry-run Report (no writes)");
  lines.push(`School: ${input.schoolName} (${DA_SILVA_SCHOOL_ID})`);
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push(`STAFF source rows: ${input.rows.length}`);
  lines.push(`Existing Employee rows (production): ${input.existingCount}`);
  lines.push(`Would CREATE Employee rows: ${input.wouldCreate.length}`);
  lines.push(`Would SKIP (duplicate): ${input.wouldSkip.length}`);
  lines.push(`XLS phone enrichments available: ${input.xlsPhoneMatches}`);
  lines.push(`XLS address enrichments available: ${input.xlsAddressMatches}`);
  lines.push("");
  lines.push("Fields always left blank on create:");
  lines.push(
    `  ${BLANK_EMPLOYEE_FIELDS.filter((f) => f !== "mobileNumber" && f !== "physicalAddress").join(", ")}`
  );
  lines.push("Optional XLS enrichment (when name matches employee_contact_list.xls): mobileNumber, physicalAddress");
  lines.push("Defaults applied: basicSalary=0, isActive=true, uifApplicable=true, incomeTaxApplicable=true");
  lines.push("");
  lines.push("Duplicate checks: email (case-insensitive), firstName+lastName (case-insensitive).");
  lines.push("");
  lines.push("Would CREATE:");
  input.wouldCreate.forEach((row, index) => {
    lines.push(
      `${String(index + 1).padStart(2, " ")}. ${row.proposedFirstName} ${row.proposedLastName} | ${row.email} | phone=${row.mobileNumber || "blank"} | address=${row.physicalAddress ? "yes" : "blank"}`
    );
  });

  if (input.wouldSkip.length) {
    lines.push("");
    lines.push("Would SKIP:");
    input.wouldSkip.forEach((entry, index) => {
      lines.push(
        `${String(index + 1).padStart(2, " ")}. ${entry.row.proposedFirstName} ${entry.row.proposedLastName} | ${entry.row.email} | ${entry.reason} | existingEmployeeId=${entry.existingEmployeeId}`
      );
    });
  }

  return lines.join("\n");
}

export function writeReportFile(prefix: string, content: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(storageRoot(), `${prefix}-${stamp}`);
  fs.mkdirSync(dir, { recursive: true });
  const txtPath = path.join(dir, "report.txt");
  const jsonPath = path.join(dir, "report-meta.json");
  fs.writeFileSync(txtPath, content, "utf8");
  fs.writeFileSync(
    jsonPath,
    JSON.stringify({ generatedAt: new Date().toISOString(), reportFile: txtPath }, null, 2),
    "utf8"
  );
  return txtPath;
}

export function readManifest(batchId: string): RestoreManifest {
  const file = manifestPath(batchId);
  if (!fs.existsSync(file)) {
    throw new Error(`Manifest not found: ${file}`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8")) as RestoreManifest;
}

export function listRestoreManifests(): RestoreManifest[] {
  const root = storageRoot();
  if (!fs.existsSync(root)) return [];
  const dirs = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("employee-restore-apply-"))
    .map((entry) => entry.name.replace(/^employee-restore-apply-/, ""));

  const manifests: RestoreManifest[] = [];
  for (const batchId of dirs) {
    try {
      manifests.push(readManifest(batchId));
    } catch {
      // ignore invalid dirs
    }
  }
  return manifests.sort((a, b) => b.appliedAt.localeCompare(a.appliedAt));
}
