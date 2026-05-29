"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseCsvBankStatement = parseCsvBankStatement;
exports.parseOfxBankStatement = parseOfxBankStatement;
exports.parsePdfBankStatementPlaceholder = parsePdfBankStatementPlaceholder;
exports.parseBankStatementFile = parseBankStatementFile;
function normaliseDate(raw) {
    const s = String(raw || "").trim();
    if (!s)
        return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(s))
        return s;
    const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (dmy) {
        const dd = dmy[1].padStart(2, "0");
        const mm = dmy[2].padStart(2, "0");
        let yy = dmy[3];
        if (yy.length === 2)
            yy = `20${yy}`;
        return `${yy}-${mm}-${dd}`;
    }
    const d = new Date(s);
    if (!Number.isNaN(d.getTime()))
        return d.toISOString().slice(0, 10);
    return "";
}
function parseAmount(raw) {
    const cleaned = String(raw || "")
        .replace(/\s/g, "")
        .replace(/R\$/gi, "")
        .replace(/,/g, "");
    const n = Number(cleaned);
    return Number.isFinite(n) ? Math.abs(n) : 0;
}
function splitCsvLine(line) {
    const out = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            inQuotes = !inQuotes;
            continue;
        }
        if (ch === "," && !inQuotes) {
            out.push(cur.trim());
            cur = "";
            continue;
        }
        cur += ch;
    }
    out.push(cur.trim());
    return out;
}
function headerIndex(headers, names) {
    for (const name of names) {
        const idx = headers.findIndex((h) => h.includes(name));
        if (idx >= 0)
            return idx;
    }
    return -1;
}
function parseCsvBankStatement(content) {
    const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length)
        return { ok: false, error: "CSV file is empty" };
    const headers = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
    const dateIdx = headerIndex(headers, ["date", "transaction date", "posting date"]);
    const descIdx = headerIndex(headers, ["description", "narrative", "details", "memo"]);
    const refIdx = headerIndex(headers, ["reference", "ref", "cheque"]);
    const amountIdx = headerIndex(headers, ["amount", "value"]);
    const creditIdx = headerIndex(headers, ["credit", "money in", "deposit"]);
    const debitIdx = headerIndex(headers, ["debit", "money out", "payment"]);
    const transactions = [];
    for (const line of lines.slice(1)) {
        const cols = splitCsvLine(line);
        if (!cols.length)
            continue;
        const date = dateIdx >= 0 ? normaliseDate(cols[dateIdx]) : normaliseDate(cols[0]);
        const description = descIdx >= 0 ? cols[descIdx] : cols[1] || "";
        const reference = refIdx >= 0 ? cols[refIdx] : "";
        let moneyIn = 0;
        let moneyOut = 0;
        if (creditIdx >= 0 || debitIdx >= 0) {
            moneyIn = creditIdx >= 0 ? parseAmount(cols[creditIdx]) : 0;
            moneyOut = debitIdx >= 0 ? parseAmount(cols[debitIdx]) : 0;
        }
        else if (amountIdx >= 0) {
            const amt = parseAmount(cols[amountIdx]);
            const raw = cols[amountIdx];
            if (raw.includes("-") || raw.toLowerCase().includes("dr"))
                moneyOut = amt;
            else
                moneyIn = amt;
        }
        else if (cols.length >= 4) {
            moneyIn = parseAmount(cols[cols.length - 2]);
            moneyOut = parseAmount(cols[cols.length - 1]);
        }
        if (!date && !description && !moneyIn && !moneyOut)
            continue;
        transactions.push({
            date: date || new Date().toISOString().slice(0, 10),
            description: String(description || "").trim(),
            reference: String(reference || "").trim(),
            moneyIn,
            moneyOut,
        });
    }
    if (!transactions.length)
        return { ok: false, error: "No transactions found in CSV" };
    return { ok: true, format: "csv", transactions };
}
function parseOfxBankStatement(content) {
    const transactions = [];
    const blocks = content.split(/<STMTTRN>/i).slice(1);
    for (const block of blocks) {
        const dateRaw = block.match(/<DTPOSTED>(\d{8})/i)?.[1] ||
            block.match(/<DTUSER>(\d{8})/i)?.[1] ||
            "";
        const date = dateRaw ? `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}` : "";
        const amount = parseAmount(block.match(/<TRNAMT>([^<]+)/i)?.[1] || "0");
        const description = block.match(/<MEMO>([^<]+)/i)?.[1] ||
            block.match(/<NAME>([^<]+)/i)?.[1] ||
            "";
        const reference = block.match(/<FITID>([^<]+)/i)?.[1] || block.match(/<REFNUM>([^<]+)/i)?.[1] || "";
        const moneyIn = amount > 0 ? amount : 0;
        const moneyOut = amount < 0 ? Math.abs(amount) : 0;
        transactions.push({
            date: date || new Date().toISOString().slice(0, 10),
            description: String(description).trim(),
            reference: String(reference).trim(),
            moneyIn,
            moneyOut,
        });
    }
    if (!transactions.length)
        return { ok: false, error: "No transactions found in OFX file" };
    return { ok: true, format: "ofx", transactions };
}
function parsePdfBankStatementPlaceholder() {
    return {
        ok: false,
        error: "PDF bank statement import is not available yet. Please upload CSV or OFX. OCR integration is pending.",
    };
}
function parseBankStatementFile(buffer, originalName, mimeType) {
    const name = String(originalName || "").toLowerCase();
    const mime = String(mimeType || "").toLowerCase();
    if (name.endsWith(".pdf") || mime.includes("pdf")) {
        return parsePdfBankStatementPlaceholder();
    }
    const text = buffer.toString("utf8");
    if (name.endsWith(".ofx") || name.endsWith(".qfx") || text.includes("<OFX")) {
        return parseOfxBankStatement(text);
    }
    if (name.endsWith(".csv") || mime.includes("csv") || text.includes(",")) {
        return parseCsvBankStatement(text);
    }
    return { ok: false, error: "Unsupported file type. Use CSV or OFX." };
}
