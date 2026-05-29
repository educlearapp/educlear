"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.matchSupplierInvoicesForBankLine = matchSupplierInvoicesForBankLine;
exports.suggestSupplierInvoicesForBankLine = suggestSupplierInvoicesForBankLine;
function normaliseText(value) {
    return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
}
function normaliseBlob(description, reference) {
    return normaliseText(`${description || ""} ${reference || ""}`).replace(/\s+/g, " ").trim();
}
function amountMatches(bankAmount, outstanding, total) {
    const amt = Math.round(bankAmount * 100) / 100;
    const out = Math.round(Number(outstanding) * 100) / 100;
    const tot = Math.round(Number(total) * 100) / 100;
    if (amt <= 0)
        return false;
    if (Math.abs(amt - out) < 0.02)
        return true;
    if (Math.abs(amt - tot) < 0.02)
        return true;
    if (out > 0 && amt <= out + 0.02)
        return true;
    return false;
}
function matchSupplierInvoicesForBankLine(description, reference, amount, suppliers, openInvoices) {
    const blob = normaliseBlob(description, reference);
    const bankAmount = Math.abs(amount);
    if (!blob || bankAmount <= 0 || !openInvoices.length)
        return null;
    const supplierById = new Map(suppliers.map((s) => [s.id, s.supplierName]));
    let best = null;
    for (const inv of openInvoices) {
        if (inv.status === "paid")
            continue;
        const outstanding = Number(inv.outstandingAmount);
        if (outstanding <= 0)
            continue;
        const supplierName = supplierById.get(inv.supplierId) || "";
        let score = 0;
        const reasons = [];
        const invNo = String(inv.invoiceNumber || "").trim();
        if (invNo.length >= 3) {
            const invKey = normaliseText(invNo).replace(/\s+/g, "");
            const blobCompact = blob.replace(/\s+/g, "");
            if (blobCompact.includes(invKey) || blob.includes(normaliseText(invNo))) {
                score += 50;
                reasons.push(`Invoice number "${invNo}" found`);
            }
        }
        if (supplierName.length >= 3) {
            const nameKey = normaliseText(supplierName).replace(/\s+/g, " ");
            if (nameKey && blob.includes(nameKey)) {
                score += 35;
                reasons.push(`Supplier "${supplierName}" found`);
            }
        }
        if (amountMatches(bankAmount, outstanding, Number(inv.totalAmount))) {
            score += 30;
            reasons.push("Amount matches outstanding balance");
        }
        if (score < 40)
            continue;
        const hit = {
            invoiceId: inv.id,
            invoiceNumber: invNo,
            supplierId: inv.supplierId,
            supplierName,
            score: Math.min(100, score),
            reason: reasons.join("; "),
        };
        if (!best || hit.score > best.score)
            best = hit;
    }
    return best;
}
function suggestSupplierInvoicesForBankLine(description, reference, amount, suppliers, openInvoices) {
    const blob = normaliseBlob(description, reference);
    const bankAmount = Math.abs(amount);
    const supplierById = new Map(suppliers.map((s) => [s.id, s.supplierName]));
    const hits = [];
    for (const inv of openInvoices) {
        if (inv.status === "paid")
            continue;
        const outstanding = Number(inv.outstandingAmount);
        if (outstanding <= 0)
            continue;
        let score = 0;
        const reasons = [];
        const supplierName = supplierById.get(inv.supplierId) || "";
        const invNo = String(inv.invoiceNumber || "").trim();
        if (invNo.length >= 3 && blob.includes(normaliseText(invNo))) {
            score += 40;
            reasons.push("Invoice number match");
        }
        if (supplierName.length >= 3 && blob.includes(normaliseText(supplierName))) {
            score += 25;
            reasons.push("Supplier name match");
        }
        if (amountMatches(bankAmount, outstanding, Number(inv.totalAmount))) {
            score += 25;
            reasons.push("Amount match");
        }
        if (score < 25)
            continue;
        hits.push({
            invoiceId: inv.id,
            invoiceNumber: invNo,
            supplierId: inv.supplierId,
            supplierName,
            score: Math.min(100, score),
            reason: reasons.join("; "),
        });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, 8);
}
