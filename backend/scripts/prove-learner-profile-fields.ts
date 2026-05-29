/**
 * Proof script: learner + parent profile fields (no billing).
 *
 * Usage:
 *   cd backend
 *   npx tsc
 *   node dist/scripts/prove-learner-profile-fields.js --schoolId <id>
 */
import { PrismaClient } from "@prisma/client";

function arg(name: string): string | null {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return null;
  const v = process.argv[idx + 1];
  return v ? String(v).trim() : null;
}

function isoDate(value: unknown): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function printLine(label: string, value: unknown) {
  const v = String(value ?? "").trim();
  process.stdout.write(`${label}: ${v || "-"}\n`);
}

async function main(): Promise<void> {
  const schoolId = arg("schoolId");
  if (!schoolId) {
    process.stderr.write("Usage: node dist/scripts/prove-learner-profile-fields.js --schoolId <id>\n");
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const learners = await prisma.learner.findMany({
      where: { schoolId },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: {
        links: { include: { parent: true } },
      },
    });

    if (learners.length === 0) {
      process.stdout.write("No learners found for that schoolId.\n");
      return;
    }

    for (const learner of learners) {
      process.stdout.write("\n==============================\n");
      printLine("Learner ID", learner.id);
      printLine("Name", learner.firstName);
      printLine("Surname", learner.lastName);
      printLine("ID Number", learner.idNumber);
      printLine("Birth Date", isoDate(learner.birthDate));
      printLine("Gender", learner.gender);
      printLine("Classroom", learner.className);
      printLine("Home Language", learner.homeLanguage);
      printLine("Citizenship/Nationality", learner.citizenship);

      const parents = (learner.links || []).map((l) => l.parent).filter(Boolean);
      if (!parents.length) {
        process.stdout.write("Parents: -\n");
        continue;
      }

      process.stdout.write("Parents:\n");
      for (const p of parents) {
        process.stdout.write("  - -------------------------\n");
        printLine("  Parent ID", p.id);
        printLine("  Name", p.firstName);
        printLine("  Surname", p.surname);
        printLine("  ID Number", p.idNumber);
        printLine("  Cell", p.cellNo);
        printLine("  Email", p.email);
        printLine("  Work Phone", p.workNo);
        printLine("  Relationship", p.relationship);
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});

