/** Escape a cell for CSV (RFC-style quoting). */
export function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function buildCsvContent(headers: string[], rows: string[][]): string {
  const headerLine = headers.map(csvCell).join(",");
  const body = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  return `${headerLine}\n${body}\n`;
}
