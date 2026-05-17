import {
  buildSourceFingerprint,
  createAutoJournal,
  createJournalLine,
  hasDuplicateAutoJournal,
  type AutoJournalResult,
} from "./accountingJournalEngine";
import { COA_CODES } from "./accountingAutoPostingRules";
import {
  loadActiveCoaAccounts,
  loadJournalStore,
  roundMoney,
  type JournalLine,
} from "./accountingJournalStorage";
import { dateInReportingRange, parseAccountingDate } from "./accountingSettingsStorage";

export const PAYROLL_RUNS_STORAGE_PREFIX = "educlearAccountingPayrollRuns:";
export const ACCOUNTING_PAYROLL_UPDATED_EVENT = "educlear-accounting-payroll-updated";

export type PayrollRunStatus = "Draft" | "Posted";

/** Snapshot of one employee line from Payroll.tsx results. */
export type PayrollEmployeeSnapshot = {
  employeeId: string;
  employeeName: string;
  employeeNumber: string;
  gross: number;
  overtimePay: number;
  bonus: number;
  basicSalary: number;
  paye: number;
  uif: number;
  pension: number;
  medicalAidEmployee: number;
  medicalAidEmployer: number;
  extraDeduction: number;
  deductions: number;
  net: number;
};

export type PayrollRunAccounting = {
  payrollRunId: string;
  schoolId: string;
  runDate: string;
  period: string;
  grossPay: number;
  overtime: number;
  allowances: number;
  paye: number;
  uifEmployee: number;
  uifEmployer: number;
  pension: number;
  medicalAid: number;
  otherDeductions: number;
  netPay: number;
  employerContributions: number;
  totalPayrollCost: number;
  employeeCount: number;
  status: PayrollRunStatus;
  paidImmediately?: boolean;
  journalNo?: string;
  journalId?: string;
  postedAt?: string;
  employees: PayrollEmployeeSnapshot[];
};

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export const PAYROLL_COA = {
  salariesExpense: "5000",
  payrollLiabilities: "2100",
  taxLiabilities: "2200",
  bank: COA_CODES.bank,
} as const;

function payrollRunsKey(schoolId: string) {
  return `${PAYROLL_RUNS_STORAGE_PREFIX}${schoolId}`;
}

export function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function roundPayrollMoney(value: unknown): number {
  return roundMoney(Number(value) || 0);
}

export function dispatchPayrollAccountingUpdated(schoolId: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(ACCOUNTING_PAYROLL_UPDATED_EVENT, {
      detail: { schoolId: String(schoolId || "").trim() },
    })
  );
}

export function calculateEmployerUif(gross: number): number {
  const g = roundPayrollMoney(gross);
  if (g <= 0) return 0;
  return Math.min(g * 0.01, 177.12);
}

export function aggregatePayrollTotals(rows: PayrollEmployeeSnapshot[]) {
  let grossPay = 0;
  let overtime = 0;
  let allowances = 0;
  let paye = 0;
  let uifEmployee = 0;
  let uifEmployer = 0;
  let pension = 0;
  let medicalAid = 0;
  let otherDeductions = 0;
  let netPay = 0;

  for (const row of rows) {
    const gross = roundPayrollMoney(row.gross);
    grossPay += gross;
    overtime += roundPayrollMoney(row.overtimePay);
    allowances += roundPayrollMoney(row.bonus) + roundPayrollMoney(row.medicalAidEmployer);
    paye += roundPayrollMoney(row.paye);
    uifEmployee += roundPayrollMoney(row.uif);
    uifEmployer += calculateEmployerUif(gross);
    pension += roundPayrollMoney(row.pension);
    medicalAid += roundPayrollMoney(row.medicalAidEmployee);
    otherDeductions += roundPayrollMoney(row.extraDeduction);
    netPay += roundPayrollMoney(row.net);
  }

  const employerContributions = roundPayrollMoney(uifEmployer);
  const totalPayrollCost = roundPayrollMoney(grossPay + uifEmployer);

  return {
    grossPay: roundPayrollMoney(grossPay),
    overtime: roundPayrollMoney(overtime),
    allowances: roundPayrollMoney(allowances),
    paye: roundPayrollMoney(paye),
    uifEmployee: roundPayrollMoney(uifEmployee),
    uifEmployer: roundPayrollMoney(uifEmployer),
    pension: roundPayrollMoney(pension),
    medicalAid: roundPayrollMoney(medicalAid),
    otherDeductions: roundPayrollMoney(otherDeductions),
    netPay: roundPayrollMoney(netPay),
    employerContributions,
    totalPayrollCost,
    employeeCount: rows.length,
  };
}

export function loadPayrollRuns(schoolId: string): PayrollRunAccounting[] {
  if (!schoolId) return [];
  try {
    const raw = localStorage.getItem(payrollRunsKey(schoolId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function savePayrollRuns(schoolId: string, runs: PayrollRunAccounting[]) {
  if (!schoolId) return;
  localStorage.setItem(payrollRunsKey(schoolId), JSON.stringify(runs));
  dispatchPayrollAccountingUpdated(schoolId);
}

export function getPayrollRun(schoolId: string, payrollRunId: string): PayrollRunAccounting | null {
  const id = String(payrollRunId || "").trim();
  if (!id) return null;
  return loadPayrollRuns(schoolId).find((r) => r.payrollRunId === id) || null;
}

export function parsePayrollPeriod(period: string): { year: number; monthIndex: number } | null {
  const raw = String(period || "").trim();
  if (!raw) return null;
  const parts = raw.split(/\s+/);
  if (parts.length < 2) return null;
  const monthIndex = MONTH_NAMES.findIndex((m) => m.toLowerCase() === parts[0].toLowerCase());
  const year = Number(parts[parts.length - 1]);
  if (monthIndex < 0 || !Number.isFinite(year)) return null;
  return { year, monthIndex };
}

export function payrollRunInReportingPeriod(
  run: PayrollRunAccounting,
  startDate: string,
  endDate: string
): boolean {
  if (dateInReportingRange(run.runDate, startDate, endDate)) return true;
  const parsed = parsePayrollPeriod(run.period);
  if (!parsed) return false;
  const start = parseAccountingDate(startDate);
  const end = parseAccountingDate(endDate);
  if (!start || !end) return false;
  const runMonthKey = parsed.year * 12 + parsed.monthIndex;
  const startKey = start.year * 12 + start.monthIndex;
  const endKey = end.year * 12 + end.monthIndex;
  return runMonthKey >= startKey && runMonthKey <= endKey;
}

export function payrollRunsForReportingPeriod(
  schoolId: string,
  startDate: string,
  endDate: string,
  status?: PayrollRunStatus
): PayrollRunAccounting[] {
  return loadPayrollRuns(schoolId).filter((run) => {
    if (status && run.status !== status) return false;
    return payrollRunInReportingPeriod(run, startDate, endDate);
  });
}

export function payrollTotalsForReportingPeriod(
  schoolId: string,
  startDate: string,
  endDate: string,
  status: PayrollRunStatus = "Posted"
) {
  const runs = payrollRunsForReportingPeriod(schoolId, startDate, endDate, status);
  return runs.reduce(
    (acc, run) => ({
      grossPay: roundPayrollMoney(acc.grossPay + run.grossPay),
      totalPayrollCost: roundPayrollMoney(acc.totalPayrollCost + run.totalPayrollCost),
      netPay: roundPayrollMoney(acc.netPay + run.netPay),
      paye: roundPayrollMoney(acc.paye + run.paye),
      uifEmployee: roundPayrollMoney(acc.uifEmployee + run.uifEmployee),
      uifEmployer: roundPayrollMoney(acc.uifEmployer + run.uifEmployer),
      pension: roundPayrollMoney(acc.pension + run.pension),
      medicalAid: roundPayrollMoney(acc.medicalAid + run.medicalAid),
      otherDeductions: roundPayrollMoney(acc.otherDeductions + run.otherDeductions),
      employeeCount: acc.employeeCount + run.employeeCount,
      runCount: acc.runCount + 1,
    }),
    {
      grossPay: 0,
      totalPayrollCost: 0,
      netPay: 0,
      paye: 0,
      uifEmployee: 0,
      uifEmployer: 0,
      pension: 0,
      medicalAid: 0,
      otherDeductions: 0,
      employeeCount: 0,
      runCount: 0,
    }
  );
}

export function payrollLiabilitiesFromPostedRuns(schoolId: string, asOfDate: string) {
  const end = String(asOfDate || "").slice(0, 10);
  const runs = loadPayrollRuns(schoolId).filter((r) => r.status === "Posted");
  let payrollPayable = 0;
  let paye = 0;
  let uif = 0;
  let pension = 0;
  let medicalAid = 0;
  let other = 0;

  for (const run of runs) {
    if (run.runDate > end) continue;
    if (run.paidImmediately) continue;
    payrollPayable += run.netPay;
    paye += run.paye;
    uif += run.uifEmployee + run.uifEmployer;
    pension += run.pension;
    medicalAid += run.medicalAid;
    other += run.otherDeductions;
  }

  return {
    payrollPayable: roundPayrollMoney(payrollPayable),
    paye: roundPayrollMoney(paye),
    uif: roundPayrollMoney(uif),
    pension: roundPayrollMoney(pension),
    medicalAid: roundPayrollMoney(medicalAid),
    otherDeductions: roundPayrollMoney(other),
    total: roundPayrollMoney(payrollPayable + paye + uif + pension + medicalAid + other),
  };
}

export function expectedSalaryPaymentsForPeriod(
  schoolId: string,
  startDate: string,
  endDate: string
) {
  const draft = payrollRunsForReportingPeriod(schoolId, startDate, endDate, "Draft");
  const postedUnpaid = payrollRunsForReportingPeriod(schoolId, startDate, endDate, "Posted").filter(
    (r) => !r.paidImmediately
  );
  const net =
    draft.reduce((s, r) => s + r.netPay, 0) + postedUnpaid.reduce((s, r) => s + r.netPay, 0);
  return roundPayrollMoney(net);
}

/** Cash outflow from payroll runs marked paid immediately in the reporting period. */
export function payrollRunsCashPayments(schoolId: string, startDate: string, endDate: string) {
  return roundPayrollMoney(
    payrollRunsForReportingPeriod(schoolId, startDate, endDate, "Posted")
      .filter((r) => r.paidImmediately)
      .reduce((s, r) => s + r.netPay, 0)
  );
}

export function buildPayslipRegister(runs: PayrollRunAccounting[]) {
  const rows: {
    period: string;
    runDate: string;
    employeeName: string;
    employeeNumber: string;
    gross: number;
    paye: number;
    uif: number;
    net: number;
    status: PayrollRunStatus;
  }[] = [];

  for (const run of runs) {
    for (const emp of run.employees || []) {
      rows.push({
        period: run.period,
        runDate: run.runDate,
        employeeName: emp.employeeName,
        employeeNumber: emp.employeeNumber,
        gross: emp.gross,
        paye: emp.paye,
        uif: emp.uif,
        net: emp.net,
        status: run.status,
      });
    }
  }

  return rows.sort((a, b) => b.runDate.localeCompare(a.runDate));
}

export function payrollJournalsForRuns(schoolId: string, runs: PayrollRunAccounting[]) {
  const store = loadJournalStore(schoolId);
  const journalNos = new Set(
    runs.map((r) => String(r.journalNo || "").trim()).filter(Boolean)
  );
  return store.journals.filter(
    (j) =>
      j.sourceModule === "Payroll" &&
      (journalNos.has(j.journalNo) ||
        runs.some((r) => r.journalId && r.journalId === j.id) ||
        runs.some((r) => r.payrollRunId && r.payrollRunId === j.sourceId))
  );
}

export type PayrollRowInput = {
  employeeId: string;
  employeeName: string;
  employeeNumber: string;
  gross: number;
  overtimePay: number;
  bonus: number;
  basicSalary: number;
  paye: number;
  uif: number;
  pension: number;
  medicalAidEmployee: number;
  medicalAidEmployer: number;
  extraDeduction: number;
  deductions: number;
  net: number;
};

export function mapPayrollResultsToSnapshots(rows: PayrollRowInput[]): PayrollEmployeeSnapshot[] {
  return rows.map((row) => ({
    employeeId: String(row.employeeId || "").trim(),
    employeeName: String(row.employeeName || "").trim(),
    employeeNumber: String(row.employeeNumber || "").trim(),
    gross: roundPayrollMoney(row.gross),
    overtimePay: roundPayrollMoney(row.overtimePay),
    bonus: roundPayrollMoney(row.bonus),
    basicSalary: roundPayrollMoney(row.basicSalary),
    paye: roundPayrollMoney(row.paye),
    uif: roundPayrollMoney(row.uif),
    pension: roundPayrollMoney(row.pension),
    medicalAidEmployee: roundPayrollMoney(row.medicalAidEmployee),
    medicalAidEmployer: roundPayrollMoney(row.medicalAidEmployer),
    extraDeduction: roundPayrollMoney(row.extraDeduction),
    deductions: roundPayrollMoney(row.deductions),
    net: roundPayrollMoney(row.net),
  }));
}

/** Bridge Payroll.tsx results into accounting storage (Draft). */
export function upsertDraftPayrollRun(input: {
  schoolId: string;
  period: string;
  rows: PayrollRowInput[];
  payrollRunId?: string;
}): PayrollRunAccounting {
  const schoolId = String(input.schoolId || "").trim();
  const employees = mapPayrollResultsToSnapshots(input.rows);
  const totals = aggregatePayrollTotals(employees);
  const runDate = new Date().toISOString().slice(0, 10);
  const payrollRunId = String(input.payrollRunId || uid("pr")).trim();

  const run: PayrollRunAccounting = {
    payrollRunId,
    schoolId,
    runDate,
    period: String(input.period || "").trim() || runDate.slice(0, 7),
    ...totals,
    status: "Draft",
    employees,
  };

  const runs = loadPayrollRuns(schoolId);
  const idx = runs.findIndex((r) => r.payrollRunId === payrollRunId);
  if (idx >= 0) runs[idx] = run;
  else runs.unshift(run);
  savePayrollRuns(schoolId, runs);
  return run;
}

export function payrollRunFingerprint(payrollRunId: string): string {
  return buildSourceFingerprint({
    sourceType: "payroll-run",
    sourceId: payrollRunId,
    amount: 1,
    date: "posted",
  });
}

export function postPayrollRunJournal(input: {
  schoolId: string;
  run: PayrollRunAccounting;
  paidImmediately?: boolean;
  createdBy?: string;
}): AutoJournalResult {
  const schoolId = String(input.schoolId || "").trim();
  const run = input.run;
  const paidImmediately = Boolean(input.paidImmediately);

  if (!schoolId || !run?.payrollRunId) {
    return { ok: false, skipped: true, reason: "Missing school or payroll run" };
  }

  if (run.status === "Posted" && run.journalNo) {
    return {
      ok: false,
      duplicate: true,
      journalNo: run.journalNo,
      reason: "Payroll run already posted to accounting",
    };
  }

  const fingerprint = payrollRunFingerprint(run.payrollRunId);
  if (hasDuplicateAutoJournal(schoolId, fingerprint)) {
    const store = loadJournalStore(schoolId);
    const existing = store.journals.find((j) => j.sourceFingerprint === fingerprint);
    return {
      ok: false,
      duplicate: true,
      journalNo: existing?.journalNo,
      reason: "Auto journal already exists for this payroll run",
    };
  }

  const totals = aggregatePayrollTotals(run.employees || []);
  if (totals.totalPayrollCost <= 0) {
    return { ok: false, skipped: true, reason: "Payroll total must be greater than zero" };
  }

  return postPayrollRunJournalInner({
    schoolId,
    run,
    totals,
    paidImmediately,
    fingerprint,
    createdBy: input.createdBy,
  });
}

function postPayrollRunJournalInner(input: {
  schoolId: string;
  run: PayrollRunAccounting;
  totals: ReturnType<typeof aggregatePayrollTotals>;
  paidImmediately: boolean;
  fingerprint: string;
  createdBy?: string;
}): AutoJournalResult {
  const { schoolId, run, totals, paidImmediately, fingerprint } = input;

  const resolveAccount = (code: string) => {
    const account = loadActiveCoaAccounts(schoolId).find((a) => a.code === code);
    if (!account) {
      console.warn("[EduClear PayrollAccounting] Chart of Accounts code missing — posting skipped", { code });
      return null;
    }
    return account;
  };

  const salaries = resolveAccount(PAYROLL_COA.salariesExpense);
  if (!salaries) {
    return {
      ok: false,
      skipped: true,
      reason: `Salaries Expense (${PAYROLL_COA.salariesExpense}) not found in Chart of Accounts`,
    };
  }

  const lines: JournalLine[] = [];
  const description = `Payroll — ${run.period}`;
  const reference = run.period;

  lines.push(
    createJournalLine({
      accountCode: salaries.code,
      accountName: salaries.name,
      debit: totals.totalPayrollCost,
      memo: `${description} · employer cost`,
    })
  );

  const creditLine = (code: string, amount: number, memo: string): JournalLine | null => {
    const amt = roundPayrollMoney(amount);
    if (amt <= 0) return null;
    const account = resolveAccount(code);
    if (!account) return null;
    return createJournalLine({
      accountCode: account.code,
      accountName: account.name,
      credit: amt,
      memo,
    });
  };

  const netCredit = paidImmediately
    ? creditLine(PAYROLL_COA.bank, totals.netPay, `${description} · net pay (bank)`)
    : creditLine(PAYROLL_COA.payrollLiabilities, totals.netPay, `${description} · net pay payable`);

  if (totals.netPay > 0 && !netCredit) {
    return {
      ok: false,
      skipped: true,
      reason: paidImmediately
        ? `Bank Account (${PAYROLL_COA.bank}) not found in Chart of Accounts`
        : `Payroll Liabilities (${PAYROLL_COA.payrollLiabilities}) not found in Chart of Accounts`,
    };
  }

  const payeLine = creditLine(PAYROLL_COA.taxLiabilities, totals.paye, `${description} · PAYE`);
  if (totals.paye > 0 && !payeLine) {
    return {
      ok: false,
      skipped: true,
      reason: `Tax Liabilities (${PAYROLL_COA.taxLiabilities}) not found in Chart of Accounts`,
    };
  }

  const uifTotal = roundPayrollMoney(totals.uifEmployee + totals.uifEmployer);
  const uifLine = creditLine(PAYROLL_COA.payrollLiabilities, uifTotal, `${description} · UIF`);
  if (uifTotal > 0 && !uifLine) {
    return {
      ok: false,
      skipped: true,
      reason: `Payroll Liabilities (${PAYROLL_COA.payrollLiabilities}) not found for UIF`,
    };
  }

  const pensionLine = creditLine(PAYROLL_COA.payrollLiabilities, totals.pension, `${description} · Pension`);
  if (totals.pension > 0 && !pensionLine) {
    return {
      ok: false,
      skipped: true,
      reason: `Payroll Liabilities (${PAYROLL_COA.payrollLiabilities}) not found for pension`,
    };
  }

  const medicalLine = creditLine(
    PAYROLL_COA.payrollLiabilities,
    totals.medicalAid,
    `${description} · Medical aid`
  );
  if (totals.medicalAid > 0 && !medicalLine) {
    return {
      ok: false,
      skipped: true,
      reason: `Payroll Liabilities (${PAYROLL_COA.payrollLiabilities}) not found for medical aid`,
    };
  }

  const otherLine = creditLine(
    PAYROLL_COA.payrollLiabilities,
    totals.otherDeductions,
    `${description} · Other deductions`
  );
  if (totals.otherDeductions > 0 && !otherLine) {
    return {
      ok: false,
      skipped: true,
      reason: `Payroll Liabilities (${PAYROLL_COA.payrollLiabilities}) not found for other deductions`,
    };
  };

  for (const line of [netCredit, payeLine, uifLine, pensionLine, medicalLine, otherLine]) {
    if (line) lines.push(line);
  }

  if (lines.length < 2) {
    return { ok: false, skipped: true, reason: "No valid payroll journal lines could be built" };
  }

  return createAutoJournal({
    schoolId,
    date: run.runDate,
    description,
    reference,
    notes: `Auto-posted payroll run ${run.payrollRunId}${paidImmediately ? " · paid immediately" : ""}`,
    sourceModule: "Payroll",
    sourceId: run.payrollRunId,
    sourceFingerprint: fingerprint,
    createdBy: input.createdBy || "Payroll",
    lines,
  });
}

export function postPayrollRunToAccounting(input: {
  schoolId: string;
  payrollRunId: string;
  paidImmediately?: boolean;
  createdBy?: string;
}): { result: AutoJournalResult; run: PayrollRunAccounting | null } {
  const schoolId = String(input.schoolId || "").trim();
  const payrollRunId = String(input.payrollRunId || "").trim();
  const run = getPayrollRun(schoolId, payrollRunId);
  if (!run) {
    return {
      result: { ok: false, skipped: true, reason: "Payroll run not found" },
      run: null,
    };
  }

  const result = postPayrollRunJournal({
    schoolId,
    run,
    paidImmediately: input.paidImmediately,
    createdBy: input.createdBy,
  });

  if (!result.ok) {
    return { result, run };
  }

  const runs = loadPayrollRuns(schoolId);
  const idx = runs.findIndex((r) => r.payrollRunId === payrollRunId);
  if (idx >= 0) {
    runs[idx] = {
      ...runs[idx],
      status: "Posted",
      paidImmediately: Boolean(input.paidImmediately),
      journalNo: result.journalNo,
      journalId: result.journalId,
      postedAt: new Date().toISOString(),
    };
    savePayrollRuns(schoolId, runs);
    return { result, run: runs[idx] };
  }

  return { result, run };
}

export function latestDraftPayrollRun(schoolId: string, period?: string): PayrollRunAccounting | null {
  const runs = loadPayrollRuns(schoolId).filter((r) => r.status === "Draft");
  if (period) {
    const match = runs.find((r) => r.period === period);
    if (match) return match;
  }
  return runs[0] || null;
}

export function payrollCostForMonth(schoolId: string, year: number, monthIndex: number) {
  const start = `${year}-${String(monthIndex + 1).padStart(2, "0")}-01`;
  const endDate = new Date(year, monthIndex + 1, 0);
  const end = endDate.toISOString().slice(0, 10);
  const totals = payrollTotalsForReportingPeriod(schoolId, start, end, "Posted");
  return totals.totalPayrollCost;
}

export function payrollInsightsForMonth(schoolId: string, year: number, monthIndex: number) {
  const start = `${year}-${String(monthIndex + 1).padStart(2, "0")}-01`;
  const endDate = new Date(year, monthIndex + 1, 0);
  const end = endDate.toISOString().slice(0, 10);
  const posted = payrollTotalsForReportingPeriod(schoolId, start, end, "Posted");
  const liabilities = payrollLiabilitiesFromPostedRuns(schoolId, end);
  return {
    payrollCost: posted.totalPayrollCost,
    employeeCount: posted.employeeCount,
    liabilities: liabilities.total,
    paye: posted.paye,
    runCount: posted.runCount,
  };
}
