import fs from "fs";
import os from "os";
import path from "path";
import * as XLSX from "xlsx";

import { readMigrationSpreadsheetMatrix } from "../../utils/migrationLearnerFileParser";

const ACCEPTED = /\.(csv|xls|xlsx)$/i;

export function isAcceptedMigrationSpreadsheet(fileName: string): boolean {
  return ACCEPTED.test(String(fileName || ""));
}

/** Kid-e-Sys XML/XLS parsers need a workbook path — convert CSV to a temp .xlsx when required. */
export function resolveSpreadsheetPathForParsing(filePath: string): {
  parsePath: string;
  cleanup: () => void;
} {
  const lower = path.basename(filePath).toLowerCase();
  if (!lower.endsWith(".csv")) {
    return { parsePath: filePath, cleanup: () => undefined };
  }

  const buffer = fs.readFileSync(filePath);
  const matrix = readMigrationSpreadsheetMatrix(buffer, path.basename(filePath));
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(matrix.length ? matrix : [[""]]);
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const tmpPath = path.join(
    os.tmpdir(),
    `educlear-mig-${Date.now()}-${Math.random().toString(36).slice(2)}.xlsx`
  );
  XLSX.writeFile(wb, tmpPath);
  return {
    parsePath: tmpPath,
    cleanup: () => {
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      } catch {
        /* ignore */
      }
    },
  };
}
