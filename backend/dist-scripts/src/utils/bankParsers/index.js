"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectBankFromStatement = detectBankFromStatement;
exports.parseWithBankParser = parseWithBankParser;
exports.parseBankStatementBuffer = parseBankStatementBuffer;
const bankStatementParser_1 = require("../bankStatementParser");
/** Detect bank from CSV headers / filename (parser-specific layouts plug in here). */
function detectBankFromStatement(content, fileName) {
    const name = String(fileName || "").toLowerCase();
    const firstLine = content.split(/\r?\n/)[0]?.toLowerCase() || "";
    if (name.includes("fnb") || firstLine.includes("fnb") || firstLine.includes("first national")) {
        return { bankName: "FNB", parserId: "fnb" };
    }
    if (name.includes("standard") ||
        firstLine.includes("standard bank") ||
        firstLine.includes("stanbic")) {
        return { bankName: "Standard Bank", parserId: "standard_bank" };
    }
    if (name.includes("tyme") || firstLine.includes("tymebank") || firstLine.includes("tyme bank")) {
        return { bankName: "TymeBank", parserId: "tymebank" };
    }
    return { bankName: "", parserId: "generic_csv" };
}
/**
 * Route parse to bank-specific normalisers. Phase 1: all CSV variants use the generic
 * column mapper so existing imports keep working; bank id is stored on the batch.
 */
function parseWithBankParser(parserId, content) {
    switch (parserId) {
        case "ofx":
            return (0, bankStatementParser_1.parseOfxBankStatement)(content);
        case "standard_bank":
        case "fnb":
        case "tymebank":
        case "generic_csv":
        default:
            return (0, bankStatementParser_1.parseCsvBankStatement)(content);
    }
}
function parseBankStatementBuffer(buffer, originalName, mimeType) {
    const name = String(originalName || "").toLowerCase();
    const mime = String(mimeType || "").toLowerCase();
    const text = buffer.toString("utf8");
    if (name.endsWith(".ofx") || name.endsWith(".qfx") || text.includes("<OFX")) {
        const parsed = (0, bankStatementParser_1.parseOfxBankStatement)(text);
        if (!parsed.ok)
            return { ...parsed, bankName: "", parserId: "ofx" };
        return { ...parsed, bankName: "", parserId: "ofx" };
    }
    const detected = detectBankFromStatement(text, originalName);
    const parsed = parseWithBankParser(detected.parserId, text);
    if (!parsed.ok)
        return { ...parsed, bankName: detected.bankName, parserId: detected.parserId };
    return {
        ...parsed,
        bankName: detected.bankName,
        parserId: detected.parserId,
    };
}
