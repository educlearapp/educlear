import type { MigrationAdapter } from "../types/MigrationAdapter";

export const d6Adapter: MigrationAdapter = {
  source: "d6",

  async detect(_files: string[]): Promise<boolean> {
    // TODO: Detect d6 school management exports.
    return false;
  },

  async parse(_files: string[]): Promise<unknown> {
    // TODO: Parse d6 exports.
    return null;
  },

  async map(_data: unknown): Promise<unknown> {
    // TODO: Map d6 data to EduClear entities.
    return null;
  },

  async validate(_mapped: unknown): Promise<unknown> {
    // TODO: Validate d6 mapped payload.
    return null;
  },

  async stage(_validated: unknown): Promise<unknown> {
    // TODO: Stage d6 migration bundle.
    return null;
  },
};
