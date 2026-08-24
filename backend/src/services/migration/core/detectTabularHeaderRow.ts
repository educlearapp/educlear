/**
 * Generic tabular header detection for a worksheet matrix.
 * Does not assume row 1 is the header. Title/cover rows score poorly.
 */

export type DetectedTabularHeader = {
  headerRowIndex: number;
  headers: string[];
  score: number;
};

function cell(row: string[] | undefined, index: number): string {
  return String(row?.[index] ?? "").trim();
}

function filledCells(row: string[] | undefined): string[] {
  return (row || []).map((c) => String(c ?? "").trim()).filter(Boolean);
}

function looksLikeHeaderCell(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (v.length > 80) return false;
  if (/^[0-9.$R€£,\s()-]+$/.test(v)) return false;
  return /[A-Za-z]/.test(v);
}

function uniqueFilledCount(row: string[] | undefined): number {
  const filled = filledCells(row);
  return new Set(filled.map((c) => c.toLowerCase())).size;
}

function dataDensityAfter(matrix: string[][], headerIdx: number, headerFilled: number): number {
  let scored = 0;
  const end = Math.min(matrix.length, headerIdx + 9);
  for (let i = headerIdx + 1; i < end; i++) {
    const n = filledCells(matrix[i]).length;
    if (n >= Math.max(2, Math.ceil(headerFilled * 0.4))) scored += 1;
  }
  return scored;
}

function scoreHeaderCandidate(matrix: string[][], idx: number): number {
  const row = matrix[idx] || [];
  const filled = filledCells(row);
  if (filled.length < 2) return -100;

  const unique = uniqueFilledCount(row);
  const headerish = filled.filter(looksLikeHeaderCell).length;
  let score = unique * 3 + headerish * 2;

  if (headerish / filled.length < 0.55) score -= 10;
  score += dataDensityAfter(matrix, idx, filled.length) * 4;

  const longCells = filled.filter((c) => c.length > 48).length;
  score -= longCells * 3;

  const compact = filled.map((c) => c.toLowerCase().replace(/[^a-z0-9]/g, ""));
  if (compact[0] === "metric" && compact.includes("value")) {
    score -= 2;
  }

  const next = filledCells(matrix[idx + 1]);
  if (next.length === 1 && looksLikeHeaderCell(cell(row, 0)) === false) {
    score -= 6;
  }

  return score;
}

/**
 * Inspect an initial range and pick the most defensible tabular header row.
 * Returns null when no header is defensible (title-only / empty / narrative).
 */
export function detectTabularHeaderRow(
  matrix: string[][],
  scanLimit = 40
): DetectedTabularHeader | null {
  if (!Array.isArray(matrix) || matrix.length === 0) return null;
  const limit = Math.min(matrix.length, Math.max(1, scanLimit));
  let best: DetectedTabularHeader | null = null;

  for (let i = 0; i < limit; i++) {
    const score = scoreHeaderCandidate(matrix, i);
    if (score < 8) continue;
    const headers = (matrix[i] || []).map((h) => String(h ?? "").trim());
    if (!best || score > best.score) {
      best = { headerRowIndex: i, headers, score };
    }
  }

  return best;
}

export function matrixToRecordsFromHeader(
  matrix: string[][],
  headerRowIndex: number
): { headers: string[]; rows: Record<string, string>[]; sourceRowNumbers: number[] } {
  const headers = (matrix[headerRowIndex] || []).map((h) => String(h ?? "").trim());
  const rows: Record<string, string>[] = [];
  const sourceRowNumbers: number[] = [];

  for (let i = headerRowIndex + 1; i < matrix.length; i++) {
    const cells = matrix[i] || [];
    if (cells.every((c) => !String(c ?? "").trim())) continue;
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      if (!h) return;
      row[h] = String(cells[idx] ?? "").trim();
    });
    if (Object.values(row).every((v) => !v)) continue;
    rows.push(row);
    sourceRowNumbers.push(i + 1);
  }

  return { headers: headers.filter(Boolean), rows, sourceRowNumbers };
}
