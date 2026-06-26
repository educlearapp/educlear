import { Router } from "express";
import { Prisma, PrismaClient } from "@prisma/client";
import { normaliseLatePenaltyAmount } from "../utils/billingSettingsEngine";

const router = Router();
const prisma = new PrismaClient();

type CheckboxMap = Record<string, boolean>;

type BillingGeneralSettings = {
  accountStyle: string;
  showAmounts: string;
  quickPopups: CheckboxMap;
  accountsInfoBlocks: CheckboxMap;
  invoicesInfoBlocks: CheckboxMap;
  paymentsInfoBlocks: CheckboxMap;
  corrections: CheckboxMap;
};

type BillingUiPreferences = {
  showBillingSummaryCards: boolean;
};

type FinancePolicySettings = {
  monthlyFeeDueDay: number;
  gracePeriodDays: number;
  arrangementEligibilityDays: number;
  maximumArrangementDurationMonths: number;
  schoolSettlementDeadline: string;
  minimumMonthlyPayment: number;
  minimumUpfrontPayment: number;
  arrangementsAllowed: boolean;
  requireApproval: boolean;
  requireSupportingDocuments: boolean;
  autoCancelAfterMissedInstalments: number;
  reminderSchedule: string;
  accountHealthThresholds: {
    excellentMaxOverdueDays: number;
    needsAttentionMaxOverdueDays: number;
    actionRequiredMaxOverdueDays: number;
  };
};

type BillingStatementSettings = {
  statementLayout: string;
  statementHistory: string;
  statementFeatures: CheckboxMap;
  showAmounts: string;
  displayOnStatement: {
    schoolName: boolean;
    schoolLogo: boolean;
    payingAddress: boolean;
    childClassroom: boolean;
  };
  standardMessage: string;
  standardEmailSubject: string;
  standardEmailMessage: string;
  standardSmsMessage: string;
};

type BillingInvoiceSettings = {
  defaultInvoicePage: string;
  invoiceLayout: string;
  displayOnInvoice: {
    schoolName: boolean;
    schoolLogo: boolean;
    dueDate: boolean;
    payingAddress: boolean;
    childClassroom: boolean;
  };
  dueDate: string;
  invoiceFeatures: CheckboxMap;
  invoicePrefix: string;
  latePenaltyAmount: number;
  termsAndConditions: string;
  standardMessage: string;
  standardEmailSubject: string;
  standardEmailMessage: string;
  standardSmsMessage: string;
};

type BillingReceiptSettings = {
  defaultPaymentPage: string;
  receiptLayout: string;
  displayOnReceipt: {
    schoolName: boolean;
    schoolLogo: boolean;
  };
  receiptFeatures: CheckboxMap;
  footerMessage: string;
  standardMessage: string;
  standardEmailSubject: string;
  standardEmailMessage: string;
  standardSmsMessage: string;
};

export type BillingSettingsState = {
  general: BillingGeneralSettings;
  uiPreferences: BillingUiPreferences;
  financePolicy: FinancePolicySettings;
  statement: BillingStatementSettings;
  invoice: BillingInvoiceSettings;
  receipt: BillingReceiptSettings;
};

const QUICK_POPUP_IDS = ["quickPayment", "quickInvoice", "quickAccountLookup"];
const ACCOUNTS_INFO_IDS = ["accountNumber", "balanceSummary", "contactDetails", "classroomInfo"];
const INVOICES_INFO_IDS = ["invoiceHistory", "feeBreakdown", "dueAmount"];
const PAYMENTS_INFO_IDS = ["paymentHistory", "allocationDetails", "receiptLink"];
const CORRECTIONS_IDS = ["invoiceCorrections", "paymentCorrections", "accountAdjustments"];
const STATEMENT_FEATURE_IDS = [
  "ageAnalysis",
  "overdueHighlight",
  "learnerPhoto",
  "siblingBalances",
  "paymentHistory",
  "compactStatement",
];
const INVOICE_FEATURE_IDS = ["autoDueDates", "latePaymentFine", "monthlyAutoNumbering"];
const RECEIPT_FEATURE_IDS = [
  "showLogo",
  "showBankingDetails",
  "showSignature",
  "showPaymentMethod",
  "autoReceiptNumbering",
];

function checkboxDefaults(ids: readonly string[]): CheckboxMap {
  return Object.fromEntries(ids.map((id) => [id, false]));
}

const DEFAULT_FINANCE_POLICY: FinancePolicySettings = {
  monthlyFeeDueDay: 3,
  gracePeriodDays: 0,
  arrangementEligibilityDays: 60,
  maximumArrangementDurationMonths: 6,
  schoolSettlementDeadline: "11-03",
  minimumMonthlyPayment: 0,
  minimumUpfrontPayment: 0,
  arrangementsAllowed: false,
  requireApproval: true,
  requireSupportingDocuments: true,
  autoCancelAfterMissedInstalments: 1,
  reminderSchedule: "7 days before due date, on due date, 7 days after due date",
  accountHealthThresholds: {
    excellentMaxOverdueDays: 0,
    needsAttentionMaxOverdueDays: 30,
    actionRequiredMaxOverdueDays: 60,
  },
};

export function defaultBillingSettings(): BillingSettingsState {
  return {
    general: {
      accountStyle: "Account",
      showAmounts: "Amount, Outstanding, Balance",
      quickPopups: checkboxDefaults(QUICK_POPUP_IDS),
      accountsInfoBlocks: checkboxDefaults(ACCOUNTS_INFO_IDS),
      invoicesInfoBlocks: checkboxDefaults(INVOICES_INFO_IDS),
      paymentsInfoBlocks: checkboxDefaults(PAYMENTS_INFO_IDS),
      corrections: checkboxDefaults(CORRECTIONS_IDS),
    },
    uiPreferences: {
      showBillingSummaryCards: true,
    },
    financePolicy: DEFAULT_FINANCE_POLICY,
    statement: {
      statementLayout: "Standard",
      statementHistory: "Full History",
      statementFeatures: checkboxDefaults(STATEMENT_FEATURE_IDS),
      showAmounts: "Inclusive",
      displayOnStatement: {
        schoolName: false,
        schoolLogo: false,
        payingAddress: false,
        childClassroom: false,
      },
      standardMessage: "",
      standardEmailSubject: "",
      standardEmailMessage: "",
      standardSmsMessage: "",
    },
    invoice: {
      defaultInvoicePage: "Standard Invoice",
      invoiceLayout: "Standard",
      displayOnInvoice: {
        schoolName: false,
        schoolLogo: false,
        dueDate: false,
        payingAddress: false,
        childClassroom: false,
      },
      dueDate: "Invoice Date",
      invoiceFeatures: checkboxDefaults(INVOICE_FEATURE_IDS),
      invoicePrefix: "",
      latePenaltyAmount: 0,
      termsAndConditions: "",
      standardMessage: "",
      standardEmailSubject: "",
      standardEmailMessage: "",
      standardSmsMessage: "",
    },
    receipt: {
      defaultPaymentPage: "Standard Receipt",
      receiptLayout: "Standard",
      displayOnReceipt: {
        schoolName: false,
        schoolLogo: false,
      },
      receiptFeatures: checkboxDefaults(RECEIPT_FEATURE_IDS),
      footerMessage: "",
      standardMessage: "",
      standardEmailSubject: "",
      standardEmailMessage: "",
      standardSmsMessage: "",
    },
  };
}

function mergeCheckboxMap(current: CheckboxMap, incoming: CheckboxMap | undefined, knownIds: readonly string[]) {
  const base = checkboxDefaults(knownIds);
  const merged = { ...base, ...current, ...(incoming || {}) };
  for (const id of knownIds) {
    merged[id] = Boolean(merged[id]);
  }
  return merged;
}

function mergeDisplay<T extends Record<string, boolean>>(current: T, incoming: Partial<T> | undefined, defaults: T): T {
  return { ...defaults, ...current, ...(incoming || {}) };
}

function clampNumber(value: unknown, fallback: number, min: number, max?: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const upper = typeof max === "number" ? Math.min(n, max) : n;
  return Math.max(min, upper);
}

function normalizeSettlementDeadline(value: unknown) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{1,2})-(\d{1,2})$/);
  if (!match) return DEFAULT_FINANCE_POLICY.schoolSettlementDeadline;
  const month = Math.min(12, Math.max(1, Number(match[1]))).toString().padStart(2, "0");
  const day = Math.min(31, Math.max(1, Number(match[2]))).toString().padStart(2, "0");
  return `${month}-${day}`;
}

function mergeFinancePolicy(
  current: FinancePolicySettings,
  incoming: Partial<FinancePolicySettings> | undefined
): FinancePolicySettings {
  if (!incoming) return current;
  const raw = incoming || {};
  const thresholds = raw.accountHealthThresholds || current.accountHealthThresholds;
  return {
    monthlyFeeDueDay: Math.round(clampNumber(raw.monthlyFeeDueDay, current.monthlyFeeDueDay, 1, 31)),
    gracePeriodDays: Math.round(clampNumber(raw.gracePeriodDays, current.gracePeriodDays, 0, 31)),
    arrangementEligibilityDays: Math.round(
      clampNumber(raw.arrangementEligibilityDays, current.arrangementEligibilityDays, 1, 365)
    ),
    maximumArrangementDurationMonths: Math.round(
      clampNumber(raw.maximumArrangementDurationMonths, current.maximumArrangementDurationMonths, 1, 6)
    ),
    schoolSettlementDeadline: normalizeSettlementDeadline(raw.schoolSettlementDeadline || current.schoolSettlementDeadline),
    minimumMonthlyPayment: clampNumber(raw.minimumMonthlyPayment, current.minimumMonthlyPayment, 0),
    minimumUpfrontPayment: clampNumber(raw.minimumUpfrontPayment, current.minimumUpfrontPayment, 0),
    arrangementsAllowed: raw.arrangementsAllowed ?? current.arrangementsAllowed,
    requireApproval: raw.requireApproval ?? current.requireApproval,
    requireSupportingDocuments: raw.requireSupportingDocuments ?? current.requireSupportingDocuments,
    autoCancelAfterMissedInstalments: Math.round(
      clampNumber(raw.autoCancelAfterMissedInstalments, current.autoCancelAfterMissedInstalments, 1, 12)
    ),
    reminderSchedule: String(raw.reminderSchedule ?? current.reminderSchedule ?? ""),
    accountHealthThresholds: {
      excellentMaxOverdueDays: Math.round(
        clampNumber(
          thresholds.excellentMaxOverdueDays,
          current.accountHealthThresholds.excellentMaxOverdueDays,
          0,
          365
        )
      ),
      needsAttentionMaxOverdueDays: Math.round(
        clampNumber(
          thresholds.needsAttentionMaxOverdueDays,
          current.accountHealthThresholds.needsAttentionMaxOverdueDays,
          1,
          365
        )
      ),
      actionRequiredMaxOverdueDays: Math.round(
        clampNumber(
          thresholds.actionRequiredMaxOverdueDays,
          current.accountHealthThresholds.actionRequiredMaxOverdueDays,
          1,
          365
        )
      ),
    },
  };
}

function mergeSettings(current: BillingSettingsState, incoming: Partial<BillingSettingsState>): BillingSettingsState {
  const defaults = defaultBillingSettings();
  const general = incoming.general
    ? {
        ...current.general,
        ...incoming.general,
        quickPopups: mergeCheckboxMap(
          current.general.quickPopups,
          incoming.general.quickPopups,
          QUICK_POPUP_IDS
        ),
        accountsInfoBlocks: mergeCheckboxMap(
          current.general.accountsInfoBlocks,
          incoming.general.accountsInfoBlocks,
          ACCOUNTS_INFO_IDS
        ),
        invoicesInfoBlocks: mergeCheckboxMap(
          current.general.invoicesInfoBlocks,
          incoming.general.invoicesInfoBlocks,
          INVOICES_INFO_IDS
        ),
        paymentsInfoBlocks: mergeCheckboxMap(
          current.general.paymentsInfoBlocks,
          incoming.general.paymentsInfoBlocks,
          PAYMENTS_INFO_IDS
        ),
        corrections: mergeCheckboxMap(current.general.corrections, incoming.general.corrections, CORRECTIONS_IDS),
      }
    : current.general;

  const statement = incoming.statement
    ? {
        ...current.statement,
        ...incoming.statement,
        statementFeatures: mergeCheckboxMap(
          current.statement.statementFeatures,
          incoming.statement.statementFeatures,
          STATEMENT_FEATURE_IDS
        ),
        displayOnStatement: mergeDisplay(
          current.statement.displayOnStatement,
          incoming.statement.displayOnStatement,
          defaults.statement.displayOnStatement
        ),
      }
    : current.statement;

  const uiPreferences = incoming.uiPreferences
    ? {
        ...current.uiPreferences,
        ...incoming.uiPreferences,
        showBillingSummaryCards:
          incoming.uiPreferences.showBillingSummaryCards !== false,
      }
    : current.uiPreferences;

  const financePolicy = mergeFinancePolicy(
    current.financePolicy || DEFAULT_FINANCE_POLICY,
    incoming.financePolicy
  );

  const invoice = incoming.invoice
    ? {
        ...current.invoice,
        ...incoming.invoice,
        invoiceFeatures: mergeCheckboxMap(
          current.invoice.invoiceFeatures,
          incoming.invoice.invoiceFeatures,
          INVOICE_FEATURE_IDS
        ),
        displayOnInvoice: mergeDisplay(
          current.invoice.displayOnInvoice,
          incoming.invoice.displayOnInvoice,
          defaults.invoice.displayOnInvoice
        ),
        invoicePrefix: String(incoming.invoice.invoicePrefix ?? current.invoice.invoicePrefix ?? ""),
        termsAndConditions: String(
          incoming.invoice.termsAndConditions ?? current.invoice.termsAndConditions ?? ""
        ),
        latePenaltyAmount: normaliseLatePenaltyAmount(
          incoming.invoice.latePenaltyAmount ?? current.invoice.latePenaltyAmount
        ),
      }
    : current.invoice;

  const receipt = incoming.receipt
    ? {
        ...current.receipt,
        ...incoming.receipt,
        receiptFeatures: mergeCheckboxMap(
          current.receipt.receiptFeatures,
          incoming.receipt.receiptFeatures,
          RECEIPT_FEATURE_IDS
        ),
        displayOnReceipt: mergeDisplay(
          current.receipt.displayOnReceipt,
          incoming.receipt.displayOnReceipt,
          defaults.receipt.displayOnReceipt
        ),
        footerMessage: String(incoming.receipt.footerMessage ?? current.receipt.footerMessage ?? ""),
      }
    : current.receipt;

  return { general, uiPreferences, financePolicy, statement, invoice, receipt };
}

function normalizeSettings(raw: Partial<BillingSettingsState> | undefined): BillingSettingsState {
  return mergeSettings(defaultBillingSettings(), raw || {});
}

function parseStoredSettings(value: unknown): Partial<BillingSettingsState> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Partial<BillingSettingsState>;
}

/** Map a DB row (or null) to settings — testable without Prisma. */
export function billingSettingsFromDbRow(
  row: { settings: unknown } | null | undefined
): BillingSettingsState {
  if (!row) return defaultBillingSettings();
  return normalizeSettings(parseStoredSettings(row.settings));
}

/**
 * Load school billing settings. On Prisma/connection failure, logs server-side and
 * returns safe defaults so invoice/payment paths can continue.
 */
export async function loadSchoolBillingSettings(schoolId: string): Promise<BillingSettingsState> {
  const sid = String(schoolId || "").trim();
  if (!sid) return defaultBillingSettings();
  try {
    const row = await prisma.billingSettings.findUnique({ where: { schoolId: sid } });
    return billingSettingsFromDbRow(row);
  } catch (error) {
    console.error(`[billing-settings] loadSchoolBillingSettings failed for ${sid}:`, error);
    return defaultBillingSettings();
  }
}

async function saveSchoolSettings(schoolId: string, settings: BillingSettingsState): Promise<BillingSettingsState> {
  const payload = settings as unknown as Prisma.InputJsonValue;
  await prisma.billingSettings.upsert({
    where: { schoolId },
    create: { schoolId, settings: payload },
    update: { settings: payload },
  });
  return settings;
}

router.get("/settings", async (req, res) => {
  try {
    const schoolId = String(req.query.schoolId || "").trim();
    if (!schoolId) return res.status(400).json({ success: false, error: "Missing schoolId" });
    const settings = await loadSchoolBillingSettings(schoolId);
    return res.json({ success: true, settings });
  } catch (error) {
    console.error("[billing-settings] GET settings failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

router.put("/settings", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    if (!schoolId) return res.status(400).json({ success: false, error: "Missing schoolId" });
    const current = await loadSchoolBillingSettings(schoolId);
    const next = mergeSettings(current, req.body?.settings || {});
    await saveSchoolSettings(schoolId, next);
    return res.json({ success: true, settings: next });
  } catch (error) {
    console.error("[billing-settings] PUT settings failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

router.post("/settings/reset", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    if (!schoolId) return res.status(400).json({ success: false, error: "Missing schoolId" });
    const settings = defaultBillingSettings();
    await saveSchoolSettings(schoolId, settings);
    return res.json({ success: true, settings });
  } catch (error) {
    console.error("[billing-settings] POST reset failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

export default router;
