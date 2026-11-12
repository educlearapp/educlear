/**
 * Kid-e-Sys–aligned statement amount formatting.
 * - Charges/invoices: positive (R1,234.56)
 * - Payments/credits: negative with leading minus (-R309.30)
 * - Balances: minus only when the account is in credit
 * - No CR labels, brackets, or reversed debit/credit columns
 */

export function normaliseStatementNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/** Signed statement amount: amountIn (debit) − amountOut (credit). */
export function signedStatementAmount(amountIn: unknown, amountOut: unknown): number {
  return normaliseStatementNumber(amountIn) - normaliseStatementNumber(amountOut);
}

function formatAbsoluteMoney(value: number): string {
  const abs = Math.abs(normaliseStatementNumber(value));
  // Fixed en-US grouping so credits/owing match Kid-e-Sys examples (R3,190.70 / -R309.30),
  // independent of host locale. Presentation only — does not alter the numeric value.
  return abs.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Formats a signed rand amount for statement Amount / Balance columns.
 * Examples: R3,190.70 | -R309.30 | R0.00
 */
export function formatStatementSignedMoney(value: unknown): string {
  const n = normaliseStatementNumber(value);
  const body = formatAbsoluteMoney(n);
  if (n < 0) return `-R${body}`;
  return `R${body}`;
}

/** Amount column: blank when there is no movement (e.g. Balance Brought Forward). */
export function formatStatementAmountCell(value: unknown | null | undefined): string {
  if (value === null || value === undefined) return "";
  return formatStatementSignedMoney(value);
}

/** Balance column: always show a signed money value (or em dash when unknown). */
export function formatStatementBalanceCell(value: unknown | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return formatStatementSignedMoney(value);
}
