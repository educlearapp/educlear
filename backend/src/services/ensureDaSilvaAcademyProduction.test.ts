import { describe, expect, it } from "vitest";

import { buildLearnerMatchKey } from "./daSilvaMigration/parsers";
import {
  classDisplayFromMatchKeySuffix,
  shouldSkipDaSilvaStartupImport,
} from "./ensureDaSilvaAcademyProduction";

function displayForImportedClass(className: string): string {
  const matchKey = buildLearnerMatchKey("Test Learner", className);
  return classDisplayFromMatchKeySuffix(matchKey.slice(matchKey.indexOf("|") + 1).trim());
}

describe("classDisplayFromMatchKeySuffix", () => {
  it("does not leak the empty-grade delimiter into Grade R stream labels", () => {
    expect(classDisplayFromMatchKeySuffix("|grade ra")).toBe("Grade RA");
    expect(classDisplayFromMatchKeySuffix("|grade rb")).toBe("Grade RB");
    expect(displayForImportedClass("Grade RA")).toBe("Grade RA");
    expect(displayForImportedClass("Grade RB")).toBe("Grade RB");
    expect(displayForImportedClass("Grade Rb")).toBe("Grade RB");
  });

  it("strips only the single leading delimiter for other gradeless labels", () => {
    expect(classDisplayFromMatchKeySuffix("|butterflies")).toBe("Butterflies");
    expect(classDisplayFromMatchKeySuffix("|red|blue")).toBe("Red|blue");
    expect(classDisplayFromMatchKeySuffix("||special")).toBe("|special");
  });

  it("keeps existing grade|stream, creche and empty reconstructions unchanged", () => {
    expect(classDisplayFromMatchKeySuffix("1|a")).toBe(displayForImportedClass("Grade 1A"));
    expect(classDisplayFromMatchKeySuffix("6|b")).toBe(displayForImportedClass("Grade 6B"));
    expect(classDisplayFromMatchKeySuffix("ps|creche")).toBe("Creche");
    expect(classDisplayFromMatchKeySuffix("|pre-school creche")).toBe("Creche");
    expect(classDisplayFromMatchKeySuffix("")).toBe("Unassigned");
  });
});

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
