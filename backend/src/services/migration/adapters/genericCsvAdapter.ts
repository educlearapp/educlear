import type { MigrationAdapter } from "../types/MigrationAdapter";
import { parseMigrationLearnerFileBuffer } from "../../../utils/migrationLearnerFileParser";
import fs from "fs/promises";
import path from "path";
import { normalizeGenericExcelColumn } from "./genericExcelNormalization";
import type { MigrationTargetField } from "../types/MigrationTargetField";

export const GENERIC_CSV_ADAPTER_METADATA = {
  id: "generic-csv",
  label: "Generic CSV",
  description: "Comma-separated exports and manual CSV templates",
};

function detectCsvFiles(files: string[]): boolean {
  return files.some((f) => /\.csv$/i.test(String(f || "")));
}

export const genericCsvAdapter: MigrationAdapter = {
  source: "generic-csv",

  async detect(files: string[]): Promise<boolean> {
    return detectCsvFiles(files);
  },

  async parse(files: string[]): Promise<{ files: Array<{ path: string; rows: Record<string, string>[] }> }> {
    const out: Array<{ path: string; rows: Record<string, string>[] }> = [];
    for (const filePath of files) {
      const buffer = await fs.readFile(filePath);
      const parsed = parseMigrationLearnerFileBuffer(buffer, path.basename(filePath));
      out.push({ path: filePath, rows: parsed.rows });
    }
    return { files: out };
  },

  async map(data: unknown): Promise<{ mappings: Array<{ sourceColumn: string; targetField: MigrationTargetField }> }> {
    const parsed = data as { files: Array<{ rows: Record<string, string>[] }> };
    const mappings: Array<{ sourceColumn: string; targetField: MigrationTargetField }> = [];
    const first = parsed.files[0]?.rows[0];
    if (!first) return { mappings };
    for (const col of Object.keys(first)) {
      const target = normalizeGenericExcelColumn(col);
      if (target) mappings.push({ sourceColumn: col, targetField: target as MigrationTargetField });
    }
    return { mappings };
  },

  async validate(mapped: unknown): Promise<{ ok: boolean }> {
    const m = mapped as { mappings: unknown[] };
    return { ok: Array.isArray(m.mappings) && m.mappings.length > 0 };
  },

  async stage(validated: unknown): Promise<unknown> {
    return validated;
  },
};
