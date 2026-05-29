"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.exportMigrationSignoffCsv = exportMigrationSignoffCsv;
exports.exportMigrationSignoffPdf = exportMigrationSignoffPdf;
exports.exportMigrationSignoffPack = exportMigrationSignoffPack;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const pdfkit_1 = __importDefault(require("pdfkit"));
const migrationReportCsv_1 = require("./migrationReportCsv");
const migrationSignoffStore_1 = require("./migrationSignoffStore");
const SIGNOFFS_DIR = path_1.default.join(process.cwd(), "storage", "migration-signoffs");
const INK = "#0a0a0a";
const MUTED = "#6b7280";
const GOLD = "#d4af37";
const PASS_COLOR = "#15803d";
const WARNING_COLOR = "#b45309";
const FAIL_COLOR = "#b91c1c";
function timestampForFilename(date = new Date()) {
    return date.toISOString().replace(/[:.]/g, "-");
}
function formatCountsLine(counts) {
    return `learners ${counts.learners}, parents ${counts.parents}, billing ${counts.billingAccounts}, transactions ${counts.transactions}, classrooms ${counts.classrooms}, links ${counts.parentLearnerLinks}`;
}
function reconciliationLabel(status) {
    if (status === "pass")
        return "PASS";
    if (status === "warning")
        return "WARNING";
    return "FAIL";
}
function statusColor(status) {
    if (status === "pass" || status === "approved")
        return PASS_COLOR;
    if (status === "warning" || status === "draft")
        return WARNING_COLOR;
    return FAIL_COLOR;
}
function writeFileAtomic(absolutePath, content) {
    const tmpPath = `${absolutePath}.${process.pid}.tmp`;
    fs_1.default.writeFileSync(tmpPath, content);
    fs_1.default.renameSync(tmpPath, absolutePath);
}
function exportMigrationSignoffCsv(pack) {
    (0, migrationSignoffStore_1.ensureMigrationSignoffsDir)();
    const headers = ["Field", "Value"];
    const rows = [
        ["Sign-off ID", pack.signoffId],
        ["Batch ID", pack.batchId],
        ["Stage ID", pack.stageId],
        ["School", pack.schoolName],
        ["School ID", pack.schoolId],
        ["Operator", pack.operatorName],
        ["Operator email", pack.operatorEmail],
        ["Created at", pack.createdAt],
        ["Reconciled at", pack.reconciledAt],
        ["Sign-off status", pack.signoffStatus],
        ["Reconciliation status", reconciliationLabel(pack.reconciliationStatus)],
        ["Migration status", pack.migrationStatus],
        ["Approved for go-live", pack.approvedForGoLive ? "YES" : "NO"],
        ["Approval confirmed", pack.approvalConfirmed ? "YES" : "NO"],
        ["Notes", pack.notes || ""],
        ["Created counts", formatCountsLine(pack.counts.created)],
        ["Skipped counts", formatCountsLine(pack.counts.skipped)],
        ["Failed counts", formatCountsLine(pack.counts.failed)],
        ...pack.warnings.map((w, i) => [`Warning ${i + 1}`, w]),
        ...pack.exportedReports.map((r) => [r.label, r.downloadPath]),
    ];
    const csv = (0, migrationReportCsv_1.buildCsvContent)(headers, rows);
    const safeId = pack.signoffId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 32);
    const filename = `signoff-${safeId}-${timestampForFilename()}.csv`;
    const absolutePath = path_1.default.join(SIGNOFFS_DIR, filename);
    writeFileAtomic(absolutePath, csv);
    return {
        filename,
        downloadPath: `/api/migration/signoffs/files/${filename}`,
        absolutePath,
    };
}
async function generateSignoffPdfBuffer(pack) {
    const doc = new pdfkit_1.default({ size: "A4", margin: 48 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    const pageW = doc.page.width;
    const margin = 48;
    const contentW = pageW - margin * 2;
    let y = margin;
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(22);
    doc.text("EduClear", margin, y, { width: contentW * 0.5 });
    doc.fontSize(14).fillColor(GOLD).text("Migration Sign-Off", margin, y, { width: contentW, align: "right" });
    y += 28;
    doc.strokeColor(GOLD).lineWidth(2).moveTo(margin, y).lineTo(pageW - margin, y).stroke();
    y += 18;
    const fields = [
        ["School", pack.schoolName],
        ["Batch", pack.batchId],
        ["Stage", pack.stageId],
        ["Operator", `${pack.operatorName} <${pack.operatorEmail}>`],
        ["Date", new Date(pack.createdAt).toLocaleString("en-ZA")],
        ["Reconciled", new Date(pack.reconciledAt).toLocaleString("en-ZA")],
        ["Reconciliation", reconciliationLabel(pack.reconciliationStatus)],
        ["Migration status", pack.migrationStatus],
        ["Sign-off status", pack.signoffStatus.toUpperCase()],
        ["Go-live approved", pack.approvedForGoLive ? "YES" : "NO"],
    ];
    doc.font("Helvetica").fontSize(10).fillColor(INK);
    for (const [label, value] of fields) {
        doc.font("Helvetica-Bold").text(`${label}:`, margin, y, { continued: true, width: 120 });
        const statusField = label === "Reconciliation";
        doc
            .font("Helvetica")
            .fillColor(statusField ? statusColor(pack.reconciliationStatus) : INK)
            .text(` ${value}`, { width: contentW - 120 });
        y = doc.y + 6;
    }
    y += 8;
    doc.strokeColor(GOLD).lineWidth(1).moveTo(margin, y).lineTo(pageW - margin, y).stroke();
    y += 14;
    doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text("Counts", margin, y);
    y += 16;
    doc.font("Helvetica").fontSize(9).fillColor(MUTED);
    doc.text(`Created: ${formatCountsLine(pack.counts.created)}`, margin, y, { width: contentW });
    y = doc.y + 4;
    doc.text(`Skipped: ${formatCountsLine(pack.counts.skipped)}`, margin, y, { width: contentW });
    y = doc.y + 4;
    doc.text(`Failed: ${formatCountsLine(pack.counts.failed)}`, margin, y, { width: contentW });
    y = doc.y + 12;
    if (pack.warnings.length > 0) {
        doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text("Warnings", margin, y);
        y += 14;
        doc.font("Helvetica").fontSize(8.5).fillColor(WARNING_COLOR);
        for (const w of pack.warnings.slice(0, 24)) {
            doc.text(`• ${w}`, margin, y, { width: contentW });
            y = doc.y + 4;
            if (y > doc.page.height - 120) {
                doc.addPage();
                y = margin;
            }
        }
        y += 8;
    }
    doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text("Attached reports", margin, y);
    y += 14;
    doc.font("Helvetica").fontSize(8.5).fillColor(MUTED);
    if (pack.exportedReports.length === 0) {
        doc.text("No exported report paths recorded.", margin, y, { width: contentW });
        y = doc.y + 8;
    }
    else {
        for (const report of pack.exportedReports) {
            doc.text(`• ${report.label}: ${report.filename}`, margin, y, { width: contentW });
            y = doc.y + 4;
        }
    }
    if (pack.notes) {
        y += 10;
        doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text("Notes", margin, y);
        y += 14;
        doc.font("Helvetica").fontSize(9).fillColor(INK).text(pack.notes, margin, y, { width: contentW });
        y = doc.y + 8;
    }
    const footerY = doc.page.height - 56;
    doc.strokeColor(GOLD).lineWidth(0.5).moveTo(margin, footerY).lineTo(pageW - margin, footerY).stroke();
    doc
        .font("Helvetica")
        .fontSize(7.5)
        .fillColor(MUTED)
        .text("Migration powered by EduClear Universal Migration Framework", margin, footerY + 10, {
        width: contentW,
        align: "center",
    });
    doc.end();
    return new Promise((resolve, reject) => {
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);
    });
}
async function exportMigrationSignoffPdf(pack) {
    (0, migrationSignoffStore_1.ensureMigrationSignoffsDir)();
    const buffer = await generateSignoffPdfBuffer(pack);
    const safeId = pack.signoffId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 32);
    const filename = `signoff-${safeId}-${timestampForFilename()}.pdf`;
    const absolutePath = path_1.default.join(SIGNOFFS_DIR, filename);
    writeFileAtomic(absolutePath, buffer);
    return {
        filename,
        downloadPath: `/api/migration/signoffs/files/${filename}`,
        absolutePath,
    };
}
async function exportMigrationSignoffPack(pack) {
    const csv = exportMigrationSignoffCsv(pack);
    const pdf = await exportMigrationSignoffPdf(pack);
    return { csv, pdf };
}
