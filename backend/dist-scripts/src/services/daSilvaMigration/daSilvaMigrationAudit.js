"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.auditReportPath = auditReportPath;
exports.writeDaSilvaMigrationAudit = writeDaSilvaMigrationAudit;
exports.loadDaSilvaMigrationAudit = loadDaSilvaMigrationAudit;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const STAGING_ROOT = path_1.default.join(process.cwd(), "uploads", "migration-staging");
function auditReportPath(schoolId, projectId, phase) {
    return path_1.default.join(STAGING_ROOT, schoolId, `dasilva-${projectId}.audit-${phase}.json`);
}
function writeDaSilvaMigrationAudit(schoolId, projectId, report) {
    const file = auditReportPath(schoolId, projectId, report.phase);
    fs_1.default.mkdirSync(path_1.default.dirname(file), { recursive: true });
    fs_1.default.writeFileSync(file, JSON.stringify(report, null, 2), "utf8");
    return file;
}
function loadDaSilvaMigrationAudit(schoolId, projectId, phase) {
    const file = auditReportPath(schoolId, projectId, phase);
    if (!fs_1.default.existsSync(file))
        return null;
    return JSON.parse(fs_1.default.readFileSync(file, "utf8"));
}
