import type { MigrationAdapter } from "../types/MigrationAdapter";
import { detectGenericExcelExports } from "./genericExcelDetection";
import { GENERIC_EXCEL_ADAPTER_METADATA } from "./genericExcelMetadata";

export { GENERIC_EXCEL_ADAPTER_METADATA };

/**
 * Generic Excel/CSV Adapter v1 — detection and normalization only.
 * Legacy migration routes and live apply logic are unchanged.
 */
export const genericExcelAdapter: MigrationAdapter = {
  source: "generic-excel",

  async detect(files: string[]): Promise<boolean> {
    const filenames = (files || []).map((f) => String(f).trim()).filter(Boolean);
    if (filenames.length === 0) return false;
    return detectGenericExcelExports(filenames);
  },

  async parse(_files: string[]): Promise<unknown> {
    return null;
  },

  async map(_data: unknown): Promise<unknown> {
    return null;
  },

  async validate(_mapped: unknown): Promise<unknown> {
    return null;
  },

  async stage(_validated: unknown): Promise<unknown> {
    return null;
  },
};
