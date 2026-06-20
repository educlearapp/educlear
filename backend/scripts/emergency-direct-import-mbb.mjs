#!/usr/bin/env node
/**
 * Emergency direct import for Magical Bright Beginnings only.
 *
 * Dry run:
 *   cd backend
 *   node scripts/emergency-direct-import-mbb.mjs
 *
 * Live write requires all confirmations:
 *   cd backend
 *   CONFIRM_PRODUCTION_WRITE=true node scripts/emergency-direct-import-mbb.mjs \
 *     --write \
 *     --approve-school-id cmq4xjckq00at60qgg4eb956h \
 *     --confirm-live-write MBB_DIRECT_IMPORT
 */
import "dotenv/config";

import crypto from "crypto";
import fs from "fs";
import path from "path";

import { PrismaClient } from "@prisma/client";
import xlsx from "xlsx";

const SCHOOL_ID = "cmq4xjckq00at60qgg4eb956h";
const SCHOOL_NAME = "Magical Bright Beginnings";
const DEFAULT_CLASS_DIR = "/Users/dasilvaacademy/Desktop/MBB class list";
const DEFAULT_DESKTOP_DIR = "/Users/dasilvaacademy/Desktop";
const HISTORY_SOURCE = "kidesys_display_history";
const IMPORTED_AT = "2099-01-01T00:00:00.000Z";
const EXPECTED_LEARNERS = 313;
const DASHBOARD_STAFF_COUNT = 34;
const EXPECTED_HISTORICAL_TRANSACTIONS = 18842;

const CLASS_FILES = [
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
];

const FILES = {
  childList: "child_list_(6_extra_fields) (2).xls",
  siblingAccounts: "sibling_accounts.xls",
  contactList: "contact_list.xls",
  employeeBirthdays: "birthday_employee_list.xls",
  billingPlan: "billing_plan_summary_by_child.xls",
  ageAnalysis: "account_list_(age_analysis).xls",
  transactions: "transaction_list-2.xls",
  paymentReceivePdf: "payment_receive_list.pdf",
};

const prisma = new PrismaClient();

function parseArgs(argv) {
  const args = {
    write: false,
    classDir: DEFAULT_CLASS_DIR,
    desktopDir: DEFAULT_DESKTOP_DIR,
    approveSchoolId: "",
    confirmLiveWrite: "",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === "--write") args.write = true;
    else if (key === "--class-dir" && value) args.classDir = value, i += 1;
    else if (key === "--desktop-dir" && value) args.desktopDir = value, i += 1;
    else if (key === "--approve-school-id" && value) args.approveSchoolId = value, i += 1;
    else if (key === "--confirm-live-write" && value) args.confirmLiveWrite = value, i += 1;
    else throw new Error(`Unknown or incomplete argument: ${key}`);
  }
  return args;
}

function stableHash(input, length = 12) {
  return crypto.createHash("sha1").update(String(input)).digest("hex").slice(0, length);
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function clean(value) {
  return String(value ?? "").trim();
}

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function isNumericRow(row) {
  const firstCell = clean(row[0]);
  return firstCell !== "" && Number.isFinite(Number(firstCell)) && clean(row[1]);
}

function rowsFromWorkbook(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Missing source file: ${filePath}`);
  const workbook = xlsx.readFile(filePath, { cellDates: true });
  const firstSheet = workbook.SheetNames[0];
  return xlsx.utils.sheet_to_json(workbook.Sheets[firstSheet], {
    header: 1,
    defval: "",
    blankrows: false,
  });
}

function toIsoDate(value) {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const raw = clean(value);
  if (!raw) return "";
  const normalized = raw.replace(/\//g, "-");
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function splitFullName(fullName) {
  const parts = clean(fullName).split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "Unknown", lastName: "Unknown" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "-" };
  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts[parts.length - 1],
  };
}

function parseContactHeading(value) {
  const raw = clean(value);
  const match = raw.match(/^([^-]+?)\s*-\s*(.+)$/);
  if (!match) {
    const name = splitFullName(raw);
    return { relationship: "", firstName: name.firstName, surname: name.lastName, displayName: raw };
  }
  const relationship = clean(match[1]);
  const displayName = clean(match[2]);
  const name = splitFullName(displayName);
  return { relationship, firstName: name.firstName, surname: name.lastName, displayName };
}

function statusForClassroom(className) {
  return /left/i.test(className) ? "HISTORICAL" : "ACTIVE";
}

function gradeForClassroom(className) {
  const raw = clean(className);
  if (!raw) return "MBB";
  const beforeClass = raw.split(/\s+CLASS\b/i)[0].trim();
  return beforeClass || raw;
}

function addSkip(skips, source, rowNumber, reason, value = "") {
  skips.push({
    source,
    row: rowNumber,
    reason,
    value: clean(value),
  });
}

function parseClassLists(classDir, skips) {
  const classrooms = new Map();
  const assignments = new Map();
  let assignmentRowCount = 0;

  for (const fileName of CLASS_FILES) {
    const filePath = path.join(classDir, fileName);
    const rows = rowsFromWorkbook(filePath);
    const className = clean(rows[0]?.[0]);
    if (!className) {
      addSkip(skips, fileName, 1, "class list missing classroom title");
      continue;
    }
    classrooms.set(className, { name: className, fileName });
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      if (!isNumericRow(row)) continue;
      const fullName = clean(row[1]);
      const key = normalizeText(fullName);
      if (!key) {
        addSkip(skips, fileName, i + 1, "class list learner name is blank");
        continue;
      }
      if (assignments.has(key) && assignments.get(key).className !== className) {
        addSkip(skips, fileName, i + 1, `learner appears in multiple class lists; keeping ${assignments.get(key).className}`, fullName);
        continue;
      }
      assignments.set(key, {
        fullName,
        className,
        enrollmentStatus: statusForClassroom(className),
        sourceFile: fileName,
        sourceRow: i + 1,
      });
      assignmentRowCount += 1;
    }
  }

  return { classrooms: [...classrooms.values()], assignments, assignmentRowCount };
}

function parseChildList(filePath, classAssignments, skips) {
  const rows = rowsFromWorkbook(filePath);
  const learners = [];
  const seen = new Set();

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (!isNumericRow(row)) continue;
    const fullName = clean(row[1]);
    const birthDate = toIsoDate(row[3]);
    const key = normalizeText(`${fullName} ${birthDate}`);
    if (seen.has(key)) {
      addSkip(skips, "child_list", i + 1, "duplicate Kid-e-Sys child row", fullName);
      continue;
    }
    seen.add(key);
    const assignment = classAssignments.get(normalizeText(fullName));
    if (!assignment) {
      addSkip(skips, "child_list", i + 1, "child not found in current MBB class lists", fullName);
    }
    const name = splitFullName(fullName);
    learners.push({
      sourceRow: i + 1,
      sourceFullName: fullName,
      matchKey: normalizeText(fullName),
      admissionNo: `MBB-${stableHash(`${fullName}|${birthDate}`)}`,
      firstName: name.firstName,
      lastName: name.lastName,
      birthDate,
      gender: clean(row[4]),
      enrollmentDate: toIsoDate(row[7]),
      className: assignment?.className || "",
      grade: gradeForClassroom(assignment?.className || ""),
      enrollmentStatus: assignment?.enrollmentStatus || "HISTORICAL",
    });
  }

  return learners;
}

function parseContactList(filePath, learnersByName, skips) {
  const rows = rowsFromWorkbook(filePath);
  const contacts = [];
  const links = [];
  const contactsByKey = new Map();

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const learnerName = clean(row[0]);
    if (!learnerName || clean(row[1]) !== "Cell No") continue;

    const learner = learnersByName.get(normalizeText(learnerName));
    if (!learner) {
      addSkip(skips, "contact_list", i + 1, "contact learner is not in child master list", learnerName);
      continue;
    }

    const heading = rows[i - 1] || [];
    const work = rows[i + 1] || [];
    const home = rows[i + 2] || [];
    const email = rows[i + 3] || [];

    for (const col of [2, 3]) {
      const headingValue = clean(heading[col]);
      const cellNo = clean(row[col]);
      const workNo = clean(work[col]);
      const homeNo = clean(home[col]);
      const emailAddress = clean(email[col]).toLowerCase();
      if (!headingValue && !cellNo && !workNo && !homeNo && !emailAddress) continue;
      if (!cellNo) {
        addSkip(skips, "contact_list", i + 1, "contact skipped because Parent.cellNo is required", headingValue);
        continue;
      }
      const parsed = parseContactHeading(headingValue);
      const key = normalizeText(`${parsed.relationship}|${parsed.displayName}|${cellNo}|${emailAddress}`);
      if (!contactsByKey.has(key)) {
        contactsByKey.set(key, {
          sourceRow: i + 1,
          sourceColumn: col,
          key,
          relationship: parsed.relationship,
          firstName: parsed.firstName,
          surname: parsed.surname,
          cellNo,
          workNo,
          homeNo,
          email: emailAddress || null,
        });
      }
      links.push({
        learnerAdmissionNo: learner.admissionNo,
        contactKey: key,
        relation: parsed.relationship || null,
        isPrimary: col === 2,
      });
    }
  }

  contacts.push(...contactsByKey.values());
  return { contacts, links };
}

function parseSiblingAccounts(filePath, learnersByName, skips) {
  const rows = rowsFromWorkbook(filePath);
  const accounts = new Map();
  let currentAccount = "";

  for (let i = 0; i < rows.length; i += 1) {
    const value = clean(rows[i][0]);
    if (!value) continue;
    const accountMatch = value.match(/^Account\s+(.+)$/i);
    if (accountMatch) {
      currentAccount = clean(accountMatch[1]).toUpperCase();
      if (!accounts.has(currentAccount)) {
        accounts.set(currentAccount, { accountRef: currentAccount, memberNames: [], learnerAdmissionNos: [] });
      }
      continue;
    }
    if (!currentAccount) {
      addSkip(skips, "sibling_accounts", i + 1, "sibling learner row appears before account header", value);
      continue;
    }
    const learner = learnersByName.get(normalizeText(value));
    accounts.get(currentAccount).memberNames.push(value);
    if (!learner) {
      addSkip(skips, "sibling_accounts", i + 1, "sibling learner is not in child master list", value);
      continue;
    }
    accounts.get(currentAccount).learnerAdmissionNos.push(learner.admissionNo);
  }

  return accounts;
}

function parseAgeAnalysis(filePath, learnersByName, accountLinks, skips) {
  const rows = rowsFromWorkbook(filePath);
  const accounts = new Map();
  let section = "";

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const label = clean(row[0]);
    if (label && !Number.isFinite(Number(row[0]))) {
      if (!/total/i.test(label)) section = label;
      continue;
    }
    if (!isNumericRow(row)) continue;
    const accountRef = clean(row[1]).toUpperCase();
    const accountHolder = clean(row[2]);
    if (!accountRef) {
      addSkip(skips, "account_list_age_analysis", i + 1, "age-analysis row missing account number", accountHolder);
      continue;
    }
    const existing = accountLinks.get(accountRef);
    const learner = learnersByName.get(normalizeText(accountHolder));
    accounts.set(accountRef, {
      accountRef,
      accountHolder,
      familyName: accountHolder || accountRef,
      kidesysSection: section,
      balance: money(row[3]),
      buckets: {
        current: money(row[4]),
        d30: money(row[5]),
        d60: money(row[6]),
        d90: money(row[7]),
        d120: money(row[8]),
      },
    });
    if (!existing && learner) {
      accountLinks.set(accountRef, {
        accountRef,
        memberNames: [learner.sourceFullName],
        learnerAdmissionNos: [learner.admissionNo],
      });
    }
  }

  return accounts;
}

function parseBillingPlans(filePath, learnersByName, skips) {
  const rows = rowsFromWorkbook(filePath);
  const planByLearner = new Map();
  let currentLearner = null;

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (isNumericRow(row)) {
      const fullName = clean(row[1]);
      currentLearner = learnersByName.get(normalizeText(fullName)) || null;
      if (!currentLearner) {
        addSkip(skips, "billing_plan_summary_by_child", i + 1, "billing-plan learner is not in child master list", fullName);
        continue;
      }
      if (!planByLearner.has(currentLearner.admissionNo)) planByLearner.set(currentLearner.admissionNo, []);
      const description = clean(row[2]);
      const amount = money(row[3]);
      if (description && !/billing plan not set up/i.test(description) && amount !== 0) {
        planByLearner.get(currentLearner.admissionNo).push({ description, amount, sourceRow: i + 1 });
      }
      continue;
    }

    const description = clean(row[2]);
    const amount = money(row[3]);
    if (currentLearner && description && amount !== 0) {
      planByLearner.get(currentLearner.admissionNo).push({ description, amount, sourceRow: i + 1 });
    }
  }

  return planByLearner;
}

function parseTransactions(filePath, skips) {
  const rows = rowsFromWorkbook(filePath);
  const history = [];
  let section = "";

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const first = clean(row[0]);
    if (first && !Number.isFinite(Number(row[0]))) {
      if (["Invoice", "Journal (Credit)", "Journal (Debit)", "Payment"].includes(first)) section = first;
      continue;
    }
    if (!Number.isFinite(Number(row[0]))) continue;

    const reference = clean(row[1]);
    const date = toIsoDate(row[2]);
    const accountNo = clean(row[3]).toUpperCase();
    const fullName = clean(row[4]);
    const description = clean(row[5]);
    const rawAmount = money(row[6]);

    if (section === "Journal (Credit)" || section === "Journal (Debit)") {
      addSkip(skips, "transaction_list-2", i + 1, "journal rows are reconciliation-only / not imported as historical invoice-payment rows", reference);
      continue;
    }
    if (section !== "Invoice" && section !== "Payment") {
      addSkip(skips, "transaction_list-2", i + 1, "transaction row is outside Invoice/Payment sections", reference);
      continue;
    }
    if (!accountNo || !date || !reference) {
      addSkip(skips, "transaction_list-2", i + 1, "transaction row missing account/date/reference", reference);
      continue;
    }

    const type = section === "Invoice" ? "invoice" : "payment";
    history.push({
      id: `mbb-history-${stableHash(`${section}|${reference}|${date}|${accountNo}|${fullName}|${rawAmount}|${i + 1}`, 20)}`,
      schoolId: SCHOOL_ID,
      accountNo,
      type,
      amount: Math.abs(rawAmount),
      date,
      reference,
      transactionNo: reference.replace(/^(Invoice|Payment)\s*/i, "").trim() || String(row[0]),
      description,
      fullName,
      source: HISTORY_SOURCE,
      importedAt: IMPORTED_AT,
      invoiceNumber: type === "invoice" ? reference : undefined,
      paymentNumber: type === "payment" ? reference : undefined,
      kidesysReference: reference,
      direction: type === "invoice" ? "debit" : "credit",
      sourceFileRow: i + 1,
    });
  }

  return history;
}

function parseEmployees(filePath) {
  const rows = rowsFromWorkbook(filePath);
  const employees = [];
  for (let i = 0; i < rows.length; i += 1) {
    const dateLabel = clean(rows[i][0]);
    const fullName = clean(rows[i][1]);
    if (!dateLabel || !fullName) continue;
    const name = splitFullName(fullName);
    employees.push({
      employeeNumber: `MBB-STAFF-${stableHash(fullName, 8).toUpperCase()}`,
      firstName: name.firstName,
      lastName: name.lastName,
      fullName,
      notes: `Imported from MBB birthday_employee_list.xls: ${dateLabel}`,
      sourceRow: i + 1,
    });
  }
  return employees;
}

function buildImportBundle(args) {
  const skips = [];
  const sourcePaths = {
    childList: path.join(args.desktopDir, FILES.childList),
    siblingAccounts: path.join(args.desktopDir, FILES.siblingAccounts),
    contactList: path.join(args.desktopDir, FILES.contactList),
    employeeBirthdays: path.join(args.desktopDir, FILES.employeeBirthdays),
    billingPlan: path.join(args.desktopDir, FILES.billingPlan),
    ageAnalysis: path.join(args.desktopDir, FILES.ageAnalysis),
    transactions: path.join(args.desktopDir, FILES.transactions),
    paymentReceivePdf: path.join(args.desktopDir, FILES.paymentReceivePdf),
  };
  if (!fs.existsSync(sourcePaths.paymentReceivePdf)) {
    addSkip(skips, "payment_receive_list.pdf", 0, "PDF missing; reconciliation-only file was not imported");
  }

  const { classrooms, assignments, assignmentRowCount } = parseClassLists(args.classDir, skips);
  const learners = parseChildList(sourcePaths.childList, assignments, skips);
  const learnersByName = new Map(learners.map((learner) => [learner.matchKey, learner]));
  const accountLinks = parseSiblingAccounts(sourcePaths.siblingAccounts, learnersByName, skips);
  const ageAccounts = parseAgeAnalysis(sourcePaths.ageAnalysis, learnersByName, accountLinks, skips);
  const billingPlans = parseBillingPlans(sourcePaths.billingPlan, learnersByName, skips);
  const { contacts, links: contactLinks } = parseContactList(sourcePaths.contactList, learnersByName, skips);
  const history = parseTransactions(sourcePaths.transactions, skips);
  const employees = parseEmployees(sourcePaths.employeeBirthdays);

  return {
    sourcePaths,
    skips,
    classrooms,
    classAssignmentRowCount: assignmentRowCount,
    learners,
    contacts,
    contactLinks,
    accountLinks,
    ageAccounts,
    billingPlans,
    history,
    employees,
  };
}

async function readExistingCounts(bundle) {
  const school = await prisma.school.findUnique({ where: { id: SCHOOL_ID }, select: { id: true, name: true } });
  const [
    existingLearners,
    existingParents,
    existingClassrooms,
    existingEmployees,
    existingAccounts,
  ] = await Promise.all([
    prisma.learner.findMany({ where: { schoolId: SCHOOL_ID }, select: { admissionNo: true } }),
    prisma.parent.findMany({ where: { schoolId: SCHOOL_ID }, select: { cellNo: true, email: true, firstName: true, surname: true, relationship: true } }),
    prisma.classroom.findMany({ where: { schoolId: SCHOOL_ID }, select: { name: true } }),
    prisma.employee.findMany({ where: { schoolId: SCHOOL_ID }, select: { employeeNumber: true } }),
    prisma.familyAccount.findMany({ where: { schoolId: SCHOOL_ID }, select: { accountRef: true } }),
  ]);
  const sameSchoolAccountCollisions = await prisma.familyAccount.findMany({
    where: {
      schoolId: SCHOOL_ID,
      accountRef: { in: [...bundle.ageAccounts.keys()] },
    },
    select: { accountRef: true, schoolId: true },
  });

  const learnerSet = new Set(existingLearners.map((row) => row.admissionNo).filter(Boolean));
  const classroomSet = new Set(existingClassrooms.map((row) => row.name));
  const employeeSet = new Set(existingEmployees.map((row) => row.employeeNumber).filter(Boolean));
  const accountSet = new Set(existingAccounts.map((row) => row.accountRef));
  const parentSet = new Set(
    existingParents.map((row) =>
      normalizeText(`${row.relationship}|${row.firstName}|${row.surname}|${row.cellNo}|${row.email || ""}`)
    )
  );

  return {
    school,
    learnersToInsert: bundle.learners.filter((row) => !learnerSet.has(row.admissionNo)).length,
    parentsToInsert: bundle.contacts.filter((row) => !parentSet.has(row.key)).length,
    classroomsToInsert: bundle.classrooms.filter((row) => !classroomSet.has(row.name)).length,
    staffToInsert: bundle.employees.filter((row) => !employeeSet.has(row.employeeNumber)).length,
    billingAccountsToInsert: [...bundle.ageAccounts.keys()].filter((ref) => !accountSet.has(ref)).length,
    sameSchoolAccountCollisions,
  };
}

function readJsonStore(fileName) {
  const dataDir = path.join(process.cwd(), "data");
  const filePath = path.join(dataDir, fileName);
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return {};
  }
}

function writeJsonStore(fileName, value) {
  const dataDir = path.join(process.cwd(), "data");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, fileName), JSON.stringify(value, null, 2), "utf8");
}

function backupJsonStores() {
  const dataDir = path.join(process.cwd(), "data");
  const backupDir = path.join(process.cwd(), "storage");
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const files = ["family-account-age-analysis.json", "kidesys-transaction-history.json"];
  for (const fileName of files) {
    const src = path.join(dataDir, fileName);
    if (!fs.existsSync(src)) continue;
    const dest = path.join(backupDir, `mbb-direct-import-backup-${stamp}-${fileName}`);
    fs.copyFileSync(src, dest);
    console.log(`Backup written: ${dest}`);
  }
}

function printDryRun(bundle, existing) {
  console.log("MBB DIRECT IMPORT DRY RUN");
  console.log(`School: ${existing.school?.name || SCHOOL_NAME} (${SCHOOL_ID})`);
  console.log(`Child List master learners parsed: ${bundle.learners.length}`);
  console.log(`Class list learner rows parsed: ${bundle.classAssignmentRowCount}`);
  console.log("");
  console.log(`Learners to insert: ${existing.learnersToInsert}`);
  console.log(`Parents/contacts to insert: ${existing.parentsToInsert}`);
  console.log(`Classrooms to insert: ${existing.classroomsToInsert}`);
  console.log(`Staff to insert: ${existing.staffToInsert}`);
  console.log(`Billing accounts to insert: ${existing.billingAccountsToInsert}`);
  console.log(`Historical transactions to insert: ${bundle.history.length}`);
  console.log("");
  console.log(`Parsed unique learners: ${bundle.learners.length}`);
  console.log(`Parsed exported contact slots: ${bundle.contactLinks.length}`);
  console.log(`Parsed unique parent/contact records: ${bundle.contacts.length}`);
  console.log(`Parsed classrooms from class lists: ${bundle.classrooms.length}`);
  console.log(`Parsed staff records: ${bundle.employees.length}`);
  if (bundle.employees.length !== DASHBOARD_STAFF_COUNT) {
    console.log(`Staff dashboard reconciliation: source file has ${bundle.employees.length}; dashboard shows ${DASHBOARD_STAFF_COUNT}; difference ${DASHBOARD_STAFF_COUNT - bundle.employees.length}`);
  }
  console.log(`Parsed billing age-analysis accounts: ${bundle.ageAccounts.size}`);
  console.log(`Parsed historical invoice/payment transactions: ${bundle.history.length}`);
  console.log("Payment Receive List PDF: reconciliation-only; no payments or ledger rows will be posted.");
  console.log("");
  console.log("Classrooms:");
  for (const classroom of bundle.classrooms) console.log(`- ${classroom.name}`);
  console.log("");
  console.log(`Rows skipped with exact reason: ${bundle.skips.length}`);
  for (const skip of bundle.skips) {
    const row = skip.row ? ` row ${skip.row}` : "";
    const value = skip.value ? ` (${skip.value})` : "";
    console.log(`- ${skip.source}${row}: ${skip.reason}${value}`);
  }
  console.log("");
  console.log(`AccountRef collision check scoped by schoolId: ${existing.sameSchoolAccountCollisions.length} existing MBB accountRef(s), 0 cross-school blockers`);
  const countBlockers = [];
  if (bundle.learners.length !== EXPECTED_LEARNERS) {
    countBlockers.push(`learners parsed ${bundle.learners.length}, expected ${EXPECTED_LEARNERS}`);
  }
  if (bundle.history.length !== EXPECTED_HISTORICAL_TRANSACTIONS) {
    countBlockers.push(`historical transactions parsed ${bundle.history.length}, expected ${EXPECTED_HISTORICAL_TRANSACTIONS}`);
  }
  if (countBlockers.length) {
    console.log("");
    console.log("COUNT BLOCKER(S):");
    for (const blocker of countBlockers) console.log(`- ${blocker}`);
  } else {
    console.log("");
    console.log("Live write safety: SAFE after explicit approval flags; no live write has been applied.");
  }
}

function assertLiveApproval(args, existing, bundle) {
  if (!args.write) return;
  if (args.approveSchoolId !== SCHOOL_ID) {
    throw new Error(`Live write blocked: pass --approve-school-id ${SCHOOL_ID}`);
  }
  if (args.confirmLiveWrite !== "MBB_DIRECT_IMPORT") {
    throw new Error("Live write blocked: pass --confirm-live-write MBB_DIRECT_IMPORT");
  }
  if (process.env.CONFIRM_PRODUCTION_WRITE !== "true") {
    throw new Error("Live write blocked: set CONFIRM_PRODUCTION_WRITE=true");
  }
  if (!existing.school) throw new Error(`Live write blocked: target school not found: ${SCHOOL_ID}`);
  if (clean(existing.school.name) !== SCHOOL_NAME) {
    throw new Error(`Live write blocked: target school name mismatch (${existing.school.name})`);
  }
  if (bundle.learners.length !== EXPECTED_LEARNERS) {
    throw new Error(`Live write blocked: parsed ${bundle.learners.length} learners, expected ${EXPECTED_LEARNERS}.`);
  }
  if (bundle.history.length !== EXPECTED_HISTORICAL_TRANSACTIONS) {
    throw new Error(`Live write blocked: parsed ${bundle.history.length} historical transactions, expected ${EXPECTED_HISTORICAL_TRANSACTIONS}.`);
  }
}

async function applyImport(bundle) {
  backupJsonStores();

  const familyAccountIds = new Map();
  for (const account of bundle.ageAccounts.values()) {
    const link = bundle.accountLinks.get(account.accountRef);
    const familyName = link?.memberNames?.length ? link.memberNames.join(" / ") : account.familyName;
    const existing = await prisma.familyAccount.findFirst({
      where: { schoolId: SCHOOL_ID, accountRef: account.accountRef },
      select: { id: true, accountRef: true },
    });
    const row = existing
      ? await prisma.familyAccount.update({
          where: { id: existing.id },
          data: { familyName },
          select: { id: true, accountRef: true },
        })
      : await prisma.familyAccount.create({
          data: {
            schoolId: SCHOOL_ID,
            accountRef: account.accountRef,
            familyName,
          },
          select: { id: true, accountRef: true },
        });
    familyAccountIds.set(row.accountRef, row.id);
  }

  const learnerIds = new Map();
  const accountByAdmissionNo = new Map();
  for (const link of bundle.accountLinks.values()) {
    for (const admissionNo of link.learnerAdmissionNos) {
      accountByAdmissionNo.set(admissionNo, link.accountRef);
    }
  }

  for (const classroom of bundle.classrooms) {
    await prisma.classroom.upsert({
      where: { schoolId_name: { schoolId: SCHOOL_ID, name: classroom.name } },
      update: {},
      create: { schoolId: SCHOOL_ID, name: classroom.name },
    });
  }

  for (const learner of bundle.learners) {
    const accountRef = accountByAdmissionNo.get(learner.admissionNo) || "";
    const familyAccountId = accountRef ? familyAccountIds.get(accountRef) || null : null;
    const plan = bundle.billingPlans.get(learner.admissionNo) || [];
    const totalFee = plan.reduce((sum, item) => sum + item.amount, 0);
    const notes = [
      `MBB direct import source full name: ${learner.sourceFullName}`,
      learner.enrollmentDate ? `Kid-e-Sys enrollment date: ${learner.enrollmentDate}` : "",
      accountRef ? `Kid-e-Sys account: ${accountRef}` : "",
    ].filter(Boolean).join("\n");

    const row = await prisma.learner.upsert({
      where: { schoolId_admissionNo: { schoolId: SCHOOL_ID, admissionNo: learner.admissionNo } },
      update: {
        familyAccountId,
        firstName: learner.firstName,
        lastName: learner.lastName,
        birthDate: learner.birthDate ? new Date(`${learner.birthDate}T00:00:00.000Z`) : null,
        gender: learner.gender || null,
        grade: learner.grade,
        className: learner.className || null,
        enrollmentStatus: learner.enrollmentStatus,
        totalFee,
        notes,
      },
      create: {
        schoolId: SCHOOL_ID,
        familyAccountId,
        firstName: learner.firstName,
        lastName: learner.lastName,
        birthDate: learner.birthDate ? new Date(`${learner.birthDate}T00:00:00.000Z`) : null,
        gender: learner.gender || null,
        grade: learner.grade,
        className: learner.className || null,
        enrollmentStatus: learner.enrollmentStatus,
        admissionNo: learner.admissionNo,
        totalFee,
        notes,
      },
      select: { id: true, admissionNo: true },
    });
    learnerIds.set(row.admissionNo, row.id);

    await prisma.learnerBillingPlanLine.deleteMany({ where: { schoolId: SCHOOL_ID, learnerId: row.id } });
    for (let i = 0; i < plan.length; i += 1) {
      await prisma.learnerBillingPlanLine.create({
        data: {
          schoolId: SCHOOL_ID,
          learnerId: row.id,
          feeDescription: plan[i].description,
          amount: plan[i].amount,
          sortOrder: i,
        },
      });
    }
  }

  const parentIds = new Map();
  for (const contact of bundle.contacts) {
    const existing = await prisma.parent.findFirst({
      where: {
        schoolId: SCHOOL_ID,
        firstName: contact.firstName,
        surname: contact.surname,
        cellNo: contact.cellNo,
        email: contact.email,
      },
      select: { id: true },
    });
    const parent = existing
      ? await prisma.parent.update({
          where: { id: existing.id },
          data: {
            relationship: contact.relationship || null,
            workNo: contact.workNo || null,
            homeNo: contact.homeNo || null,
          },
          select: { id: true },
        })
      : await prisma.parent.create({
          data: {
            schoolId: SCHOOL_ID,
            relationship: contact.relationship || null,
            firstName: contact.firstName,
            surname: contact.surname,
            cellNo: contact.cellNo,
            workNo: contact.workNo || null,
            homeNo: contact.homeNo || null,
            email: contact.email,
          },
          select: { id: true },
        });
    parentIds.set(contact.key, parent.id);
  }

  for (const link of bundle.contactLinks) {
    const parentId = parentIds.get(link.contactKey);
    const learnerId = learnerIds.get(link.learnerAdmissionNo);
    if (!parentId || !learnerId) continue;
    await prisma.parentLearnerLink.upsert({
      where: { parentId_learnerId: { parentId, learnerId } },
      update: {
        relation: link.relation,
        isPrimary: link.isPrimary,
      },
      create: {
        schoolId: SCHOOL_ID,
        parentId,
        learnerId,
        relation: link.relation,
        isPrimary: link.isPrimary,
      },
    });
  }

  for (const employee of bundle.employees) {
    const existing = await prisma.employee.findFirst({
      where: { schoolId: SCHOOL_ID, employeeNumber: employee.employeeNumber },
      select: { id: true },
    });
    if (existing) {
      await prisma.employee.update({
        where: { id: existing.id },
        data: {
          firstName: employee.firstName,
          lastName: employee.lastName,
          fullName: employee.fullName,
          notes: employee.notes,
        },
      });
    } else {
      await prisma.employee.create({
        data: {
          schoolId: SCHOOL_ID,
          employeeNumber: employee.employeeNumber,
          firstName: employee.firstName,
          lastName: employee.lastName,
          fullName: employee.fullName,
          notes: employee.notes,
        },
      });
    }
  }

  const ageStore = readJsonStore("family-account-age-analysis.json");
  ageStore[SCHOOL_ID] = {};
  for (const account of bundle.ageAccounts.values()) {
    ageStore[SCHOOL_ID][account.accountRef] = {
      schoolId: SCHOOL_ID,
      accountRef: account.accountRef,
      accountHolder: account.accountHolder,
      kidesysSection: account.kidesysSection,
      balance: account.balance,
      buckets: account.buckets,
      source: "kideesys-age-analysis",
      importedAt: IMPORTED_AT,
    };
  }
  writeJsonStore("family-account-age-analysis.json", ageStore);

  const historyStore = readJsonStore("kidesys-transaction-history.json");
  historyStore[SCHOOL_ID] = bundle.history;
  writeJsonStore("kidesys-transaction-history.json", historyStore);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const bundle = buildImportBundle(args);
  const existing = await readExistingCounts(bundle);
  printDryRun(bundle, existing);
  assertLiveApproval(args, existing, bundle);

  if (!args.write) {
    console.log("");
    console.log("DRY RUN ONLY: no EduClear data was written.");
    console.log("Live write requires --write, --approve-school-id, --confirm-live-write, and CONFIRM_PRODUCTION_WRITE=true.");
    return;
  }

  await applyImport(bundle);
  console.log("");
  console.log("LIVE WRITE COMPLETE: MBB direct import applied from current uploaded files.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
