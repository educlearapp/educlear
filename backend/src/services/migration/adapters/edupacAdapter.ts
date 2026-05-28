import type { MigrationAdapter } from "../types/MigrationAdapter";

export const edupacAdapter: MigrationAdapter = {
  source: "edupac",

  async detect(_files: string[]): Promise<boolean> {
    // TODO: Detect Edupac export formats.
    return false;
  },

  async parse(_files: string[]): Promise<unknown> {
    // TODO: Parse Edupac exports.
    return null;
  },

  async map(_data: unknown): Promise<unknown> {
    // TODO: Map Edupac data to EduClear entities.
    return null;
  },

  async validate(_mapped: unknown): Promise<unknown> {
    // TODO: Validate Edupac mapped payload.
    return null;
  },

  async stage(_validated: unknown): Promise<unknown> {
    // TODO: Stage Edupac migration bundle.
    return null;
  },
};
