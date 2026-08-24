/**
 * Source finance totals from the staged package + compiled classification.
 *
 * Rule:
 *   opening balance at cutover
 *   + eligible transactions after cutover
 *   = current migrated account position
 *
 * Pre-cutover TRANSACTION_HISTORY is excluded when opening balances are used
 * (never double-count history + opening).
 */

import type { MigrationStage } from "../types/MigrationStage";
import type { MigrationTargetField } from "../types/MigrationTargetField";
import type { MigrationFileColumnMappings } from "../types/MigrationValidation";
import { classifyFinanceSourceRow } from "./classifyFinanceSourceRow";
import type { FinanceTotalsCents } from "./MigrationFinanceReconciliation";
import { parseMoneyToCents } from "./moneyCents";

type MappedRow = Partial<Record<MigrationTargetField, string>>;

function cleanString(v: unknown): string {
  return String(v ?? "").trim();
}

function buildTargetToSource(
  mappings: MigrationFileColumnMappings["mappings"]
): Map<MigrationTargetField, string> {
  const map = new Map<MigrationTargetField, string>();
  for (const m of mappings) {
    const target = String(m.targetField || "").trim() as MigrationTargetField;
    const source = String(m.sourceColumn || "").trim();
    if (target && source) map.set(target, source);
  }
  return map;
}

function mapRawRecord(
  raw: Record<string, string>,
  targetToSource: Map<MigrationTargetField, string>
): MappedRow {
  const out: MappedRow = {};
  for (const [target, sourceCol] of targetToSource) {
    const value = cleanString(raw[sourceCol]);
    if (value) out[target as MigrationTargetField] = value;
  }
  return out;
}

function isPreCutover(dateStr: string, cutoverDate: string): boolean {
  const d = dateStr.slice(0, 10);
  const c = cutoverDate.slice(0, 10);
  if (!d || !c) return false;
  return d < c;
}

export type SourceAccountPosition = {
  accountRef: string;
  /** Net cents for this account (opening + post-cutover movements). */
  netCents: number;
  openingCents: number;
  postCutoverCents: number;
};

export function buildSourceFinancePositions(input: {
  stage: MigrationStage;
  rowsByFileId: Map<string, Record<string, string>[]>;
  /** When true (default), opening balances replace pre-cutover history in source totals. */
  openingBalancesAuthoritative?: boolean;
}): {
  totals: FinanceTotalsCents;
  byAccount: Map<string, SourceAccountPosition>;
  skippedUnsupported: Array<{ reason: string; detail?: string }>;
} {
  const openingAuthoritative = input.openingBalancesAuthoritative !== false;
  const cutover = cleanString(input.stage.cutoverDate);
  const byAccount = new Map<string, SourceAccountPosition>();
  const skippedUnsupported: Array<{ reason: string; detail?: string }> = [];
  let debitCents = 0;
  let creditCents = 0;
  let transactionCount = 0;
  let openingBalanceCount = 0;

  const ensure = (accountRef: string): SourceAccountPosition => {
    let row = byAccount.get(accountRef);
    if (!row) {
      row = { accountRef, netCents: 0, openingCents: 0, postCutoverCents: 0 };
      byAccount.set(accountRef, row);
    }
    return row;
  };

  for (const file of input.stage.files) {
    const role = String(file.sheetRole || "DATA").toUpperCase();
    if (role === "SUMMARY" || role === "SUPPORTING") continue;
    const mapping = input.stage.mappings.find((m) => m.fileId === file.fileId);
    if (!mapping) continue;
    const targetToSource = buildTargetToSource(mapping.mappings);
    const rows = input.rowsByFileId.get(file.fileId) || [];
    const hints = mapping.mappings.map((m) => m.sourceColumn);

    for (const raw of rows) {
      const mapped = mapRawRecord(raw, targetToSource);
      const accountRef = cleanString(mapped.accountNumber);
      const txDate = cleanString(mapped.transactionDate);
      const pre = cutover ? isPreCutover(txDate, cutover) : false;

      const { classification, reason } = classifyFinanceSourceRow({
        mapped,
        sourceColumnHints: hints,
        treatPreCutoverAsHistory: openingAuthoritative,
        isPreCutover: pre,
      });

      if (classification === "UNKNOWN_FINANCE") {
        skippedUnsupported.push({ reason, detail: accountRef || file.filename });
        continue;
      }
      if (classification === "ACCOUNT_METADATA" || classification === "BILLING_PLAN") {
        continue;
      }
      if (classification === "TRANSACTION_HISTORY") {
        skippedUnsupported.push({
          reason: "Pre-cutover history excluded from source totals (covered by opening balance)",
          detail: accountRef || undefined,
        });
        continue;
      }
      if (!accountRef) continue;

      if (classification === "OPENING_BALANCE") {
        const cents = parseMoneyToCents(mapped.openingBalance);
        if (cents === null || cents === 0) continue;
        const pos = ensure(accountRef);
        pos.openingCents += cents;
        pos.netCents += cents;
        openingBalanceCount += 1;
        if (cents > 0) debitCents += cents;
        else creditCents += Math.abs(cents);
        continue;
      }

      // Post-cutover (or no cutover) money movements that affect position
      let movement = 0;
      if (classification === "PAYMENT" || classification === "CREDIT") {
        const pay =
          parseMoneyToCents(mapped.amount) ??
          parseMoneyToCents(mapped.credit) ??
          parseMoneyToCents(mapped.debit);
        if (pay === null) continue;
        movement = -Math.abs(pay);
        creditCents += Math.abs(pay);
      } else if (classification === "INVOICE") {
        const inv =
          parseMoneyToCents(mapped.amount) ??
          parseMoneyToCents(mapped.debit) ??
          parseMoneyToCents(mapped.credit);
        if (inv === null) continue;
        movement = Math.abs(inv);
        debitCents += Math.abs(inv);
      } else if (classification === "ADJUSTMENT") {
        skippedUnsupported.push({
          reason: "Adjustment excluded until confirmed destination is unambiguous",
          detail: accountRef,
        });
        continue;
      } else {
        continue;
      }

      if (openingAuthoritative && pre) continue;

      const pos = ensure(accountRef);
      pos.postCutoverCents += movement;
      pos.netCents += movement;
      transactionCount += 1;
    }
  }

  const netCents = [...byAccount.values()].reduce((s, a) => s + a.netCents, 0);

  return {
    totals: {
      debitCents,
      creditCents,
      netCents,
      accountCount: byAccount.size,
      transactionCount,
      openingBalanceCount,
    },
    byAccount,
    skippedUnsupported,
  };
}
