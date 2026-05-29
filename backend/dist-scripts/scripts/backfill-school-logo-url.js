"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Backfill School.logoUrl when a logo file exists on disk but the DB field is empty.
 *
 * Usage:
 *   npx tsx scripts/backfill-school-logo-url.ts [schoolId]
 *
 * Without schoolId: updates every school that has logoUrl null and at least one file
 * in uploads/school-logos (uses the newest file — intended for single-school dev setups).
 */
require("dotenv/config");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const client_1 = require("@prisma/client");
const schoolLogo_1 = require("../src/utils/schoolLogo");
const prisma = new client_1.PrismaClient();
const LOGO_DIR = path_1.default.join(process.cwd(), "uploads", "school-logos");
function newestLogoFilename() {
    if (!fs_1.default.existsSync(LOGO_DIR))
        return null;
    const files = fs_1.default
        .readdirSync(LOGO_DIR)
        .filter((name) => /\.(png|jpe?g|gif|webp)$/i.test(name))
        .map((name) => {
        const full = path_1.default.join(LOGO_DIR, name);
        return { name, mtime: fs_1.default.statSync(full).mtimeMs };
    })
        .sort((a, b) => b.mtime - a.mtime);
    return files[0]?.name ?? null;
}
async function main() {
    const schoolIdArg = (process.argv[2] || "").trim();
    const filename = newestLogoFilename();
    if (!filename) {
        console.log("No logo files found in uploads/school-logos");
        return;
    }
    const logoUrl = (0, schoolLogo_1.toStoredSchoolLogoUrl)((0, schoolLogo_1.buildPublicSchoolLogoUrl)(filename));
    const schools = schoolIdArg
        ? await prisma.school.findMany({
            where: { id: schoolIdArg },
            select: { id: true, name: true, logoUrl: true },
        })
        : await prisma.school.findMany({
            where: { logoUrl: null },
            select: { id: true, name: true, logoUrl: true },
        });
    if (!schools.length) {
        console.log(schoolIdArg ? `School not found: ${schoolIdArg}` : "No schools with empty logoUrl");
        return;
    }
    for (const school of schools) {
        if (String(school.logoUrl || "").trim()) {
            console.log(`Skip ${school.name} (${school.id}) — logoUrl already set`);
            continue;
        }
        await prisma.school.update({
            where: { id: school.id },
            data: { logoUrl },
        });
        console.log(`Updated ${school.name} (${school.id}) → ${logoUrl}`);
    }
}
main()
    .catch((err) => {
    console.error(err);
    process.exit(1);
})
    .finally(() => prisma.$disconnect());
