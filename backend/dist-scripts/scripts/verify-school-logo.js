"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Verify School.logoUrl → disk file → PDF embed for a school.
 *
 * Usage:
 *   npx tsx scripts/verify-school-logo.ts [schoolId]
 */
require("dotenv/config");
const fs_1 = __importDefault(require("fs"));
const client_1 = require("@prisma/client");
const statementPdfData_1 = require("../src/services/statementPdfData");
const schoolLogo_1 = require("../src/utils/schoolLogo");
const prisma = new client_1.PrismaClient();
const DEFAULT_SCHOOL_ID = "cmpideqeq0000108xb6ouv9zi";
async function main() {
    const schoolId = (process.argv[2] || DEFAULT_SCHOOL_ID).trim();
    const school = await prisma.school.findUnique({
        where: { id: schoolId },
        select: { id: true, name: true, logoUrl: true },
    });
    if (!school) {
        console.error("School not found:", schoolId);
        process.exit(1);
    }
    console.log("=== School logo verification ===");
    console.log("School:", school.name, `(${school.id})`);
    console.log("School.logoUrl (DB):", school.logoUrl ?? "(empty)");
    const stored = (0, schoolLogo_1.toStoredSchoolLogoUrl)(school.logoUrl);
    if (stored && stored !== school.logoUrl) {
        console.log("Normalized stored path:", stored);
        await prisma.school.update({ where: { id: school.id }, data: { logoUrl: stored } });
        console.log("Updated DB to normalized relative logoUrl");
    }
    const logoUrl = stored || school.logoUrl || "";
    const filePath = logoUrl ? (0, schoolLogo_1.resolveUploadsFilePath)(logoUrl) : null;
    console.log("Resolved file path:", filePath ?? "(none)");
    console.log("File exists:", filePath ? fs_1.default.existsSync(filePath) : false);
    const buffer = await (0, schoolLogo_1.loadSchoolLogoBuffer)(logoUrl);
    console.log("Logo buffer:", buffer ? `${buffer.length} bytes` : "(failed to load)");
    const learner = await prisma.learner.findFirst({
        where: { schoolId },
        select: { id: true, firstName: true, lastName: true },
    });
    if (!learner) {
        console.warn("No learners — skipping PDF generation test");
        return;
    }
    console.log("Test learner:", `${learner.firstName} ${learner.lastName}`.trim(), learner.id);
    const { buffer: pdfBuffer, input } = await (0, statementPdfData_1.buildAndGenerateStatementPdf)({
        schoolId,
        learnerId: learner.id,
        period: "All Time",
    });
    const hasPdfImage = pdfBuffer.includes(Buffer.from("/Image"));
    const outPath = `verify-school-logo-${schoolId}.pdf`;
    fs_1.default.writeFileSync(outPath, pdfBuffer);
    console.log("PDF input school.logoUrl:", input.school.logoUrl ?? "(empty)");
    console.log("Generated PDF:", outPath, `(${pdfBuffer.length} bytes)`);
    console.log("PDF embeds image object:", hasPdfImage);
    console.log(hasPdfImage && buffer ? "PASS — logo loaded and embedded" : "FAIL — check logoUrl and file on disk");
}
main()
    .catch((err) => {
    console.error(err);
    process.exit(1);
})
    .finally(() => prisma.$disconnect());
