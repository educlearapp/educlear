/**
 * Invoice-run bulk statement period selection.
 * Only engine-backed periods are generatable. Unsupported options are listed
 * explicitly so the UI does not invent financial date-window behaviour.
 */
import {
  formatStatementPeriodHeaderLabel,
  normalizeStatementPeriod,
  resolveStatementPeriodCutoff,
  type StatementPeriodOption,
} from "./statementPeriod";

export const INVOICE_RUN_STATEMENT_DEFAULT_PERIOD: StatementPeriodOption = "Last 3 Months";

/** Periods the trusted statement engine already understands. */
export const INVOICE_RUN_ENGINE_STATEMENT_PERIODS = [
  "Last 1 Month",
  "Last 3 Months",
  "Last 6 Months",
  "Last 12 Months",
  "All Time",
] as const;

export type InvoiceRunEngineStatementPeriod =
  (typeof INVOICE_RUN_ENGINE_STATEMENT_PERIODS)[number];

export type InvoiceRunStatementPeriodChoice =
  | InvoiceRunEngineStatementPeriod
  | "Current Academic Year"
  | "Custom Date Range";

/**
 * First-release UI choices — only engine-backed periods.
 * Academic Year and Custom Date Range remain typed/documented but are hidden until functional.
 */
export const INVOICE_RUN_STATEMENT_PERIOD_CHOICES: InvoiceRunStatementPeriodChoice[] = [
  "Last 1 Month",
  "Last 3 Months",
  "Last 6 Months",
  "Last 12 Months",
  "All Time",
];

/** Unsupported options retained for support/docs tests; not shown in the release dialog. */
export const INVOICE_RUN_STATEMENT_PERIOD_HIDDEN_UNTIL_READY: InvoiceRunStatementPeriodChoice[] = [
  "Current Academic Year",
  "Custom Date Range",
];

export type InvoiceRunStatementPeriodSupport = {
  choice: InvoiceRunStatementPeriodChoice;
  supported: boolean;
  enginePeriod: StatementPeriodOption | null;
  reason?: string;
};

export function describeInvoiceRunStatementPeriodSupport(
  choice: string
): InvoiceRunStatementPeriodSupport {
  const raw = String(choice || "").trim();
  if ((INVOICE_RUN_ENGINE_STATEMENT_PERIODS as readonly string[]).includes(raw)) {
    return {
      choice: raw as InvoiceRunEngineStatementPeriod,
      supported: true,
      enginePeriod: normalizeStatementPeriod(raw),
    };
  }
  if (raw === "Current Academic Year") {
    return {
      choice: "Current Academic Year",
      supported: false,
      enginePeriod: null,
      reason:
        "Current Academic Year is not implemented in the trusted statement engine (no school academic-year calendar bound to statement cutoffs).",
    };
  }
  if (raw === "Custom Date Range") {
    return {
      choice: "Custom Date Range",
      supported: false,
      enginePeriod: null,
      reason:
        "Custom From/To statement windows are not implemented in the trusted statement engine. Do not invent ledger cutoffs outside Last N Months / All Time.",
    };
  }
  return {
    choice: "Last 3 Months",
    supported: false,
    enginePeriod: null,
    reason: `Unsupported statement period: ${raw || "(empty)"}`,
  };
}

export type InvoiceRunStatementWindow = {
  supported: boolean;
  choice: InvoiceRunStatementPeriodChoice;
  enginePeriod: StatementPeriodOption | null;
  startDate: string | null;
  endDate: string;
  label: string;
  reason?: string;
};

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDisplay(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
}

/** Resolve display window for confirmation copy. End date is always "today" for rolling windows. */
export function resolveInvoiceRunStatementWindow(
  choice: string,
  now: Date = new Date()
): InvoiceRunStatementWindow {
  const support = describeInvoiceRunStatementPeriodSupport(choice);
  const end = new Date(now);
  end.setHours(0, 0, 0, 0);
  const endDate = isoDate(end);

  if (!support.supported || !support.enginePeriod) {
    return {
      supported: false,
      choice: support.choice,
      enginePeriod: null,
      startDate: null,
      endDate,
      label: support.choice,
      reason: support.reason,
    };
  }

  if (support.enginePeriod === "All Time") {
    return {
      supported: true,
      choice: support.choice,
      enginePeriod: "All Time",
      startDate: null,
      endDate,
      label: formatStatementPeriodHeaderLabel("All Time", now),
    };
  }

  const cutoff = resolveStatementPeriodCutoff(support.enginePeriod, now);
  const startDate = cutoff ? isoDate(cutoff) : null;
  return {
    supported: true,
    choice: support.choice,
    enginePeriod: support.enginePeriod,
    startDate,
    endDate,
    label: formatStatementPeriodHeaderLabel(support.enginePeriod, now),
  };
}

export function buildInvoiceRunStatementConfirmation(args: {
  familyAccountCount: number;
  choice: string;
  now?: Date;
}): { ok: boolean; message: string; window: InvoiceRunStatementWindow } {
  const window = resolveInvoiceRunStatementWindow(args.choice, args.now);
  const count = Math.max(0, Number(args.familyAccountCount || 0));
  if (!window.supported || !window.enginePeriod) {
    return {
      ok: false,
      message: window.reason || "Selected statement period is not supported.",
      window,
    };
  }
  if (count <= 0) {
    return {
      ok: false,
      message: "No family account statements found to generate for this invoice run.",
      window,
    };
  }
  const range =
    window.enginePeriod === "All Time" || !window.startDate
      ? `All Time (through ${formatDisplay(window.endDate)})`
      : `${formatDisplay(window.startDate)} to ${formatDisplay(window.endDate)}`;
  return {
    ok: true,
    message: `Generate statements for ${count} family account${count === 1 ? "" : "s"} covering ${range}?`,
    window,
  };
}

export function invoiceRunStatementClosingBalanceLimitationNote(): string {
  return (
    "Opening balances for Last N Months are calculated from ledger activity before the period start. " +
    "Closing balances are period-end ledger totals (opening + in-period net) for the selected window — " +
    "not the current Age Analysis snapshot. Kid-e-Sys history rows remain informational and do not " +
    "alter posting balances. Academic Year and Custom Date Range stay unavailable until engine-backed."
  );
}
