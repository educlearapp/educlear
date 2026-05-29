"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const kideesysChildClassifier_1 = require("./kideesysChildClassifier");
(0, vitest_1.describe)("classifyKidESysChildRow", () => {
    (0, vitest_1.it)("marks child_active No as HISTORICAL", () => {
        const result = (0, kideesysChildClassifier_1.classifyKidESysChildRow)({
            child_active: "No",
            classroom: "Grade 8A",
        });
        (0, vitest_1.expect)(result.enrollmentStatus).toBe("HISTORICAL");
    });
    (0, vitest_1.it)("marks No Classroom as HISTORICAL even when child_active Yes", () => {
        const result = (0, kideesysChildClassifier_1.classifyKidESysChildRow)({
            child_active: "Yes",
            classroom: "No Classroom",
        });
        (0, vitest_1.expect)(result.enrollmentStatus).toBe("HISTORICAL");
    });
    (0, vitest_1.it)("marks child_active Yes with valid classroom as ACTIVE", () => {
        const result = (0, kideesysChildClassifier_1.classifyKidESysChildRow)({
            child_active: "Yes",
            classroom: "Creche 2026",
        });
        (0, vitest_1.expect)(result.enrollmentStatus).toBe("ACTIVE");
        (0, vitest_1.expect)(result.hasValidClassroom).toBe(true);
    });
});
