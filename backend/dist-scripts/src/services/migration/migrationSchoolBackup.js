"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMigrationSchoolBackup = createMigrationSchoolBackup;
exports.restoreMigrationSchoolBackup = restoreMigrationSchoolBackup;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const prisma_1 = require("../../prisma");
const migrationProjectPaths_1 = require("./migrationProjectPaths");
async function createMigrationSchoolBackup(schoolId, projectId) {
    const [learners, parents, parentLearnerLinks, familyAccounts, classrooms] = await Promise.all([
        prisma_1.prisma.learner.findMany({ where: { schoolId } }),
        prisma_1.prisma.parent.findMany({ where: { schoolId } }),
        prisma_1.prisma.parentLearnerLink.findMany({ where: { schoolId } }),
        prisma_1.prisma.familyAccount.findMany({ where: { schoolId } }),
        prisma_1.prisma.classroom.findMany({ where: { schoolId } }),
    ]);
    const backup = {
        schoolId,
        projectId,
        createdAt: new Date().toISOString(),
        learners,
        parents,
        parentLearnerLinks,
        familyAccounts,
        classrooms,
    };
    const dir = (0, migrationProjectPaths_1.migrationSchoolBackupsDir)(schoolId);
    fs_1.default.mkdirSync(dir, { recursive: true });
    const filename = `pre-import-${projectId}-${Date.now()}.json`;
    const filePath = path_1.default.join(dir, filename);
    fs_1.default.writeFileSync(filePath, JSON.stringify(backup, null, 2), "utf8");
    return filePath;
}
async function restoreMigrationSchoolBackup(backupPath) {
    const resolved = path_1.default.resolve(backupPath);
    if (!fs_1.default.existsSync(resolved)) {
        throw new Error(`Backup not found: ${backupPath}`);
    }
    const backup = JSON.parse(fs_1.default.readFileSync(resolved, "utf8"));
    const schoolId = backup.schoolId;
    await prisma_1.prisma.$transaction(async (tx) => {
        await tx.parentLearnerLink.deleteMany({ where: { schoolId } });
        await tx.learner.deleteMany({ where: { schoolId } });
        await tx.parent.deleteMany({ where: { schoolId } });
        await tx.familyAccount.deleteMany({ where: { schoolId } });
        await tx.classroom.deleteMany({ where: { schoolId } });
        for (const row of backup.classrooms) {
            const { id, ...data } = row;
            await tx.classroom.create({ data: { ...data, id } });
        }
        for (const row of backup.familyAccounts) {
            const { id, ...data } = row;
            await tx.familyAccount.create({ data: { ...data, id } });
        }
        for (const row of backup.parents) {
            const { id, ...data } = row;
            await tx.parent.create({ data: { ...data, id } });
        }
        for (const row of backup.learners) {
            const { id, ...data } = row;
            await tx.learner.create({ data: { ...data, id } });
        }
        for (const row of backup.parentLearnerLinks) {
            const { id, ...data } = row;
            await tx.parentLearnerLink.create({ data: { ...data, id } });
        }
    }, { maxWait: 30000, timeout: 300000 });
}
