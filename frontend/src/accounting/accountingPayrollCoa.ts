import type { AccountType, ChartAccount } from "./AccountingChartOfAccounts";

export const ACCOUNTING_COA_UPDATED_EVENT = "educlear-accounting-coa-updated";

export type PayrollCoaSeed = {
  code: string;
  name: string;
  group: string;
  type: AccountType;
  linkedModule: string;
  description?: string;
};

/** Payroll posting requires these account codes (also listed in default school COA import). */
export const REQUIRED_PAYROLL_COA: PayrollCoaSeed[] = [
  {
    code: "1000",
    name: "Bank Account",
    group: "Current Assets",
    type: "Assets",
    linkedModule: "Banking",
  },
  {
    code: "2100",
    name: "Payroll Liabilities",
    group: "Current Liabilities",
    type: "Liabilities",
    linkedModule: "Payroll",
  },
  {
    code: "2200",
    name: "Tax Liabilities",
    group: "Current Liabilities",
    type: "Liabilities",
    linkedModule: "",
  },
  {
    code: "5000",
    name: "Salaries Expense",
    group: "Operating Expenses",
    type: "Expenses",
    linkedModule: "Payroll",
  },
];

const PAYROLL_NAME_ALIASES: Record<string, string[]> = {
  "1000": ["bank account", "bank"],
  "2100": ["payroll liabilities", "payroll liability", "salaries payable", "wages payable"],
  "2200": ["tax liabilities", "tax liability", "paye liability", "sars liability", "uif liability"],
  "5000": ["salaries expense", "salaries", "salary expense", "wages expense", "payroll expense"],
};

export function normalizeAccountName(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
}

export function dispatchCoaUpdated(schoolId: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(ACCOUNTING_COA_UPDATED_EVENT, {
      detail: { schoolId: String(schoolId || "").trim() },
    })
  );
}

export function payrollCoaSeedToAccount(seed: PayrollCoaSeed, now: string): ChartAccount {
  return {
    id: `coa-${seed.code}-${seed.name.replace(/\s+/g, "-").toLowerCase()}`,
    code: seed.code,
    name: seed.name,
    group: seed.group,
    type: seed.type,
    description: seed.description || `Default ${seed.type} account for ${seed.name}.`,
    linkedModule: seed.linkedModule,
    active: true,
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  };
}

/** Match required payroll account by exact code or normalized / alias name (active only). */
export function findPayrollCoaAccount(
  accounts: ChartAccount[],
  seed: PayrollCoaSeed,
  options?: { activeOnly?: boolean }
): ChartAccount | null {
  const activeOnly = options?.activeOnly !== false;
  const list = activeOnly ? accounts.filter((a) => a.active !== false) : accounts;
  const code = seed.code.trim();

  const byCode = list.find((a) => String(a.code || "").trim() === code);
  if (byCode) return byCode;

  const aliases = new Set([
    normalizeAccountName(seed.name),
    ...(PAYROLL_NAME_ALIASES[code] || []),
  ]);

  return (
    list.find((a) => {
      if (a.type !== seed.type) return false;
      return aliases.has(normalizeAccountName(a.name));
    }) || null
  );
}

export function findPayrollCoaByCode(
  accounts: ChartAccount[],
  code: string,
  options?: { activeOnly?: boolean }
): ChartAccount | null {
  const seed = REQUIRED_PAYROLL_COA.find((s) => s.code === code);
  if (!seed) {
    const activeOnly = options?.activeOnly !== false;
    const list = activeOnly ? accounts.filter((a) => a.active !== false) : accounts;
    return list.find((a) => String(a.code || "").trim() === code) || null;
  }
  return findPayrollCoaAccount(accounts, seed, options);
}

/** Add only missing required payroll accounts (no duplicates by code or normalized name). */
export function ensureRequiredPayrollCoa(accounts: ChartAccount[]): {
  accounts: ChartAccount[];
  added: string[];
} {
  const now = new Date().toISOString();
  const next = [...accounts];
  const added: string[] = [];

  for (const seed of REQUIRED_PAYROLL_COA) {
    if (findPayrollCoaAccount(next, seed, { activeOnly: false })) continue;
    next.push(payrollCoaSeedToAccount(seed, now));
    added.push(`${seed.code} — ${seed.name}`);
  }

  return { accounts: next, added };
}

export function getPayrollCoaReadiness(accounts: ChartAccount[]) {
  const missing: string[] = [];
  for (const seed of REQUIRED_PAYROLL_COA) {
    if (!findPayrollCoaAccount(accounts, seed)) {
      missing.push(`${seed.code} — ${seed.name}`);
    }
  }
  return {
    ready: missing.length === 0,
    missing,
    required: REQUIRED_PAYROLL_COA.map((s) => `${s.code} — ${s.name}`),
  };
}
