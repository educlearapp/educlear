import type { MigrationAdapter } from "../types/MigrationAdapter";

export const edadminAdapter: MigrationAdapter = {
  source: "edadmin",

  async detect(_files: string[]): Promise<boolean> {
    // TODO: Detect Ed-admin export formats.
    return false;
  },

  async parse(_files: string[]): Promise<unknown> {
    // TODO: Parse Ed-admin exports.
    return null;
  },

  async map(_data: unknown): Promise<unknown> {
    // TODO: Map Ed-admin data to EduClear entities.
    return null;
  },

  async validate(_mapped: unknown): Promise<unknown> {
    // TODO: Validate Ed-admin mapped payload.
    return null;
  },

  async stage(_validated: unknown): Promise<unknown> {
    // TODO: Stage Ed-admin migration bundle.
    return null;
  },
};
