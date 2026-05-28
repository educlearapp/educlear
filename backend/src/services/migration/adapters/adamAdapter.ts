import type { MigrationAdapter } from "../types/MigrationAdapter";

export const adamAdapter: MigrationAdapter = {
  source: "adam",

  async detect(_files: string[]): Promise<boolean> {
    // TODO: Detect ADAM export formats.
    return false;
  },

  async parse(_files: string[]): Promise<unknown> {
    // TODO: Parse ADAM exports.
    return null;
  },

  async map(_data: unknown): Promise<unknown> {
    // TODO: Map ADAM data to EduClear entities.
    return null;
  },

  async validate(_mapped: unknown): Promise<unknown> {
    // TODO: Validate ADAM mapped payload.
    return null;
  },

  async stage(_validated: unknown): Promise<unknown> {
    // TODO: Stage ADAM migration bundle.
    return null;
  },
};
