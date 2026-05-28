import fs from "fs";
import path from "path";
import { prisma } from "../../prisma";
import { migrationSchoolBackupsDir } from "./migrationProjectPaths";

export type MigrationSchoolBackup = {
  schoolId: string;
  projectId: string;
  createdAt: string;
  learners: unknown[];
  parents: unknown[];
  parentLearnerLinks: unknown[];
  familyAccounts: unknown[];
  classrooms: unknown[];
};

export async function createMigrationSchoolBackup(
  schoolId: string,
  projectId: string
): Promise<string> {
  const [learners, parents, parentLearnerLinks, familyAccounts, classrooms] =
    await Promise.all([
      prisma.learner.findMany({ where: { schoolId } }),
      prisma.parent.findMany({ where: { schoolId } }),
      prisma.parentLearnerLink.findMany({ where: { schoolId } }),
      prisma.familyAccount.findMany({ where: { schoolId } }),
      prisma.classroom.findMany({ where: { schoolId } }),
    ]);

  const backup: MigrationSchoolBackup = {
    schoolId,
    projectId,
    createdAt: new Date().toISOString(),
    learners,
    parents,
    parentLearnerLinks,
    familyAccounts,
    classrooms,
  };

  const dir = migrationSchoolBackupsDir(schoolId);
  fs.mkdirSync(dir, { recursive: true });
  const filename = `pre-import-${projectId}-${Date.now()}.json`;
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, JSON.stringify(backup, null, 2), "utf8");
  return filePath;
}

export async function restoreMigrationSchoolBackup(backupPath: string): Promise<void> {
  const resolved = path.resolve(backupPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Backup not found: ${backupPath}`);
  }
  const backup = JSON.parse(fs.readFileSync(resolved, "utf8")) as MigrationSchoolBackup;
  const schoolId = backup.schoolId;

  await prisma.$transaction(
    async (tx) => {
      await tx.parentLearnerLink.deleteMany({ where: { schoolId } });
      await tx.learner.deleteMany({ where: { schoolId } });
      await tx.parent.deleteMany({ where: { schoolId } });
      await tx.familyAccount.deleteMany({ where: { schoolId } });
      await tx.classroom.deleteMany({ where: { schoolId } });

      for (const row of backup.classrooms as Array<{ id: string } & Record<string, unknown>>) {
        const { id, ...data } = row;
        await tx.classroom.create({ data: { ...data, id } as never });
      }
      for (const row of backup.familyAccounts as Array<{ id: string } & Record<string, unknown>>) {
        const { id, ...data } = row;
        await tx.familyAccount.create({ data: { ...data, id } as never });
      }
      for (const row of backup.parents as Array<{ id: string } & Record<string, unknown>>) {
        const { id, ...data } = row;
        await tx.parent.create({ data: { ...data, id } as never });
      }
      for (const row of backup.learners as Array<{ id: string } & Record<string, unknown>>) {
        const { id, ...data } = row;
        await tx.learner.create({ data: { ...data, id } as never });
      }
      for (const row of backup.parentLearnerLinks as Array<{ id: string } & Record<string, unknown>>) {
        const { id, ...data } = row;
        await tx.parentLearnerLink.create({ data: { ...data, id } as never });
      }
    },
    { maxWait: 30000, timeout: 300000 }
  );
}
