/**
 * AccountAbility adapter stub — Phase 1.
 *
 * No export samples have been received yet. This adapter exists so the Universal
 * Migration Centre can register the source system without inventing field mappings.
 * detect() always returns false until real exports are analysed.
 */

import type { MigrationAdapter } from "../types/MigrationAdapter";

export const ACCOUNTABILITY_ADAPTER_STATUS = "planned" as const;

export const ACCOUNTABILITY_UNSUPPORTED_REASON =
  "AccountAbility export samples have not been received. " +
  "No field mappings, parsers, or staging rules are enabled. " +
  "Upload will be flagged as unsupported until samples are analysed.";

export const accountabilityAdapter: MigrationAdapter = {
  source: "accountability",

  async detect(_files: string[]): Promise<boolean> {
    // Do not invent detection heuristics before real export samples arrive.
    return false;
  },

  async parse(_files: string[]): Promise<unknown> {
    return {
      supported: false,
      reason: ACCOUNTABILITY_UNSUPPORTED_REASON,
      records: [],
    };
  },

  async map(_data: unknown): Promise<unknown> {
    return {
      supported: false,
      reason: ACCOUNTABILITY_UNSUPPORTED_REASON,
      mapped: [],
      unmappedSourceFields: [],
      skipped: [],
      flaggedForReview: [
        {
          code: "ACCOUNTABILITY_SAMPLES_PENDING",
          message: ACCOUNTABILITY_UNSUPPORTED_REASON,
        },
      ],
    };
  },

  async validate(_mapped: unknown): Promise<unknown> {
    return {
      canProceed: false,
      errors: [ACCOUNTABILITY_UNSUPPORTED_REASON],
      warnings: [],
    };
  },

  async stage(_validated: unknown): Promise<unknown> {
    // Never stage AccountAbility data until real mappings exist.
    throw new Error(ACCOUNTABILITY_UNSUPPORTED_REASON);
  },
};
