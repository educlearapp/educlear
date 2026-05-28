import { describe, expect, it } from "vitest";

import { shouldSkipDaSilvaStartupImport } from "./ensureDaSilvaAcademyProduction";

describe("shouldSkipDaSilvaStartupImport", () => {
  it("skips import when learners exist and override env is unset", () => {
    expect(shouldSkipDaSilvaStartupImport(396)).toBe(true);
    expect(shouldSkipDaSilvaStartupImport(1)).toBe(true);
  });

  it("allows import for empty school", () => {
    expect(shouldSkipDaSilvaStartupImport(0)).toBe(false);
  });

  it("allows import when DA_SILVA_ALLOW_STARTUP_IMPORT=true", () => {
    const prev = process.env.DA_SILVA_ALLOW_STARTUP_IMPORT;
    process.env.DA_SILVA_ALLOW_STARTUP_IMPORT = "true";
    try {
      expect(shouldSkipDaSilvaStartupImport(396)).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.DA_SILVA_ALLOW_STARTUP_IMPORT;
      else process.env.DA_SILVA_ALLOW_STARTUP_IMPORT = prev;
    }
  });
});
