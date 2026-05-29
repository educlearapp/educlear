/**
 * Import Da Silva Prisma rows from production manifest + JSON stores (idempotent upserts).
 * Invoked by da-silva-live-snapshot-replace.ts to avoid circular module imports.
 */
import "dotenv/config";

import {
  DA_SILVA_ACADEMY_SCHOOL_ID,
  setDaSilvaResolvedSchoolId,
} from "../src/services/activateDaSilvaSubscription";
import { importDaSilvaProductionSnapshot } from "../src/services/ensureDaSilvaAcademyProduction";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const schoolId = (process.argv[2] || DA_SILVA_ACADEMY_SCHOOL_ID).trim();
  setDaSilvaResolvedSchoolId(schoolId);
  const stats = await importDaSilvaProductionSnapshot();
  console.log(JSON.stringify(stats));
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
