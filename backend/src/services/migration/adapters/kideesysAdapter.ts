import type { MigrationAdapter } from "../types/MigrationAdapter";
import { detectKidESysExports } from "./kideesysDetection";
import { KIDEESYS_ADAPTER_METADATA } from "./kideesysMetadata";

export { KIDEESYS_ADAPTER_METADATA };

/**
 * Kid-e-Sys Adapter v1 — detection and normalization only.
 * Legacy Kid-e-Sys migration routes and services are unchanged.
 */
export const kideesysAdapter: MigrationAdapter = {
  source: "kideesys",

  async detect(files: string[]): Promise<boolean> {
    const filenames = (files || []).map((f) => String(f).trim()).filter(Boolean);
    if (filenames.length === 0) return false;
    return detectKidESysExports(filenames);
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
