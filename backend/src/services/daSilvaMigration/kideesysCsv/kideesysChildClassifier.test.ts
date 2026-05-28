import { describe, expect, it } from "vitest";

import { classifyKidESysChildRow } from "./kideesysChildClassifier";

describe("classifyKidESysChildRow", () => {
  it("marks child_active No as HISTORICAL", () => {
    const result = classifyKidESysChildRow({
      child_active: "No",
      classroom: "Grade 8A",
    });
    expect(result.enrollmentStatus).toBe("HISTORICAL");
  });

  it("marks No Classroom as HISTORICAL even when child_active Yes", () => {
    const result = classifyKidESysChildRow({
      child_active: "Yes",
      classroom: "No Classroom",
    });
    expect(result.enrollmentStatus).toBe("HISTORICAL");
  });

  it("marks child_active Yes with valid classroom as ACTIVE", () => {
    const result = classifyKidESysChildRow({
      child_active: "Yes",
      classroom: "Creche 2026",
    });
    expect(result.enrollmentStatus).toBe("ACTIVE");
    expect(result.hasValidClassroom).toBe(true);
  });
});
