import type { MigrationAdapter } from "../types/MigrationAdapter";
import { detectSASAMSExports } from "./sasamsDetection";
import { SASAMS_ADAPTER_METADATA } from "./sasamsMetadata";

export { SASAMS_ADAPTER_METADATA };

/**
 * SA-SAMS Adapter v1 — detection and normalization for Universal Migration.
 */
export const sasamsAdapter: MigrationAdapter = {
  source: "sasams",

  async detect(files: string[]): Promise<boolean> {
    const filenames = (files || []).map((f) => String(f).trim()).filter(Boolean);
    if (filenames.length === 0) return false;
    return detectSASAMSExports(filenames);
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
