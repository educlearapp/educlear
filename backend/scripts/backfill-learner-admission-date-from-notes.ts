/**
 * Controlled local/reviewed backfill: Learner.notes "Enrolment date: YYYY-MM-DD" → admissionDate.
 *
 * Rules:
 * - Only when admissionDate IS NULL
 * - Strict regex + valid calendar date
 * - No createdAt fallback
 * - No overwrite
 * - Idempotent
 *
 * DO NOT run against production unless explicitly approved.
 *
 * Usage (local):
 *   npx tsx scripts/backfill-learner-admission-date-from-notes.ts --dry-run
 *   npx tsx scripts/backfill-learner-admission-date-from-notes.ts --apply
 */
import { PrismaClient } from "@prisma/client";
import {
  ENROLMENT_DATE_NOTES_REGEX,
  parseOptionalDateOnlyField,
} from "../src/utils/optionalProfileFields";

const prisma = new PrismaClient();

async function main() {
  const apply = process.argv.includes("--apply");
  const dryRun = !apply || process.argv.includes("--dry-run");

  const candidates = await prisma.learner.findMany({
    where: {
      admissionDate: null,
      notes: { contains: "Enrolment date:" },
    },
    select: { id: true, schoolId: true, notes: true, admissionDate: true },
  });

  let wouldUpdate = 0;
  let skippedInvalid = 0;
  const updates: { id: string; admissionDate: Date }[] = [];

  for (const row of candidates) {
    const match = String(row.notes || "").match(ENROLMENT_DATE_NOTES_REGEX);
    if (!match?.[1]) {
      skippedInvalid += 1;
      continue;
    }
    try {
      const date = parseOptionalDateOnlyField(match[1], "admissionDate");
      if (!date) {
        skippedInvalid += 1;
        continue;
      }
      wouldUpdate += 1;
      updates.push({ id: row.id, admissionDate: date });
    } catch {
      skippedInvalid += 1;
    }
  }

  console.log(
    JSON.stringify(
      {
        mode: dryRun ? "dry-run" : "apply",
        candidatesWithNotesPattern: candidates.length,
        wouldUpdate,
        skippedInvalid,
      },
      null,
      2
    )
  );

  if (dryRun || !apply) {
    console.log("Dry run only — pass --apply to write. Production: do not run without approval.");
    return;
  }

  let updated = 0;
  for (const u of updates) {
    const result = await prisma.learner.updateMany({
      where: { id: u.id, admissionDate: null },
      data: { admissionDate: u.admissionDate },
    });
    updated += result.count;
  }
  console.log(JSON.stringify({ updated }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
