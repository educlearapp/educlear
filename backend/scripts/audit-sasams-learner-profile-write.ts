/**
 * Audit SA-SAMS learner profile fields written to DB after import.
 *
 * Usage:
 *   cd backend
 *   npx tsx scripts/import-sasams-school-data.ts --schoolId <id> --source "/path/to/sasams" --apply
 *   npx tsx scripts/audit-sasams-learner-profile-write.ts --schoolId <id>
 */
import "dotenv/config";

import { prisma } from "../src/prisma";

function arg(name: string): string | null {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return null;
  const v = process.argv[idx + 1];
  return v ? String(v).trim() : null;
}

async function main(): Promise<void> {
  const schoolId = arg("schoolId");
  if (!schoolId) {
    console.error("Usage: npx tsx scripts/audit-sasams-learner-profile-write.ts --schoolId <id>");
    process.exit(1);
  }

  const learners = await prisma.learner.findMany({
    where: { schoolId },
    select: {
      id: true,
      birthDate: true,
      gender: true,
      idNumber: true,
      homeLanguage: true,
      citizenship: true,
      enrollmentStatus: true,
    },
  });

  const active = learners.filter((l) => l.enrollmentStatus === "ACTIVE");

  const auditPass =
    active.length > 0 &&
    active.every((l) => Boolean(l.birthDate)) &&
    active.every((l) => Boolean(String(l.gender || "").trim()));

  console.log(`Learners imported: ${active.length}`);
  console.log(`DOB written: ${active.filter((l) => Boolean(l.birthDate)).length}`);
  console.log(`Gender written: ${active.filter((l) => Boolean(String(l.gender || "").trim())).length}`);
  console.log(`ID numbers written: ${active.filter((l) => Boolean(String(l.idNumber || "").trim())).length}`);
  console.log(
    `Home language written: ${active.filter((l) => Boolean(String(l.homeLanguage || "").trim())).length}`
  );
  console.log(
    `Citizenship written: ${active.filter((l) => Boolean(String(l.citizenship || "").trim())).length}`
  );
  console.log(`Audit ${auditPass ? "PASS" : "FAIL"}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

