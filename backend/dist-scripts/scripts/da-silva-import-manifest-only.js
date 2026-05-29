"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Import Da Silva Prisma rows from production manifest + JSON stores (idempotent upserts).
 * Invoked by da-silva-live-snapshot-replace.ts to avoid circular module imports.
 */
require("dotenv/config");
const activateDaSilvaSubscription_1 = require("../src/services/activateDaSilvaSubscription");
const ensureDaSilvaAcademyProduction_1 = require("../src/services/ensureDaSilvaAcademyProduction");
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
async function main() {
    const schoolId = (process.argv[2] || activateDaSilvaSubscription_1.DA_SILVA_ACADEMY_SCHOOL_ID).trim();
    (0, activateDaSilvaSubscription_1.setDaSilvaResolvedSchoolId)(schoolId);
    const stats = await (0, ensureDaSilvaAcademyProduction_1.importDaSilvaProductionSnapshot)();
    console.log(JSON.stringify(stats));
}
main()
    .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
})
    .finally(() => prisma.$disconnect());
