"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../prisma");
const supplierAccountingService_1 = require("../services/supplierAccountingService");
const supplierInvoiceMatcher_1 = require("../utils/supplierInvoiceMatcher");
const router = (0, express_1.Router)();
function mapSupplier(row, outstandingBalance = 0) {
    return {
        id: row.id,
        schoolId: row.schoolId,
        supplierName: row.supplierName,
        name: row.supplierName,
        contactPerson: row.contactPerson,
        email: row.email,
        phone: row.phone,
        vatNumber: row.vatNumber,
        address: row.address,
        status: row.status === "active" ? "Active" : "Inactive",
        outstandingBalance,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}
function mapInvoice(row) {
    const statusLabel = {
        pending: "Pending",
        approved: "Approved",
        partially_paid: "Partially Paid",
        paid: "Paid",
    };
    return {
        id: row.id,
        schoolId: row.schoolId,
        supplierId: row.supplierId,
        supplierName: row.supplier.supplierName,
        invoiceNumber: row.invoiceNumber,
        invoiceDate: row.invoiceDate.toISOString().slice(0, 10),
        dueDate: row.dueDate.toISOString().slice(0, 10),
        subtotal: Number(row.subtotal),
        vatAmount: Number(row.vatAmount),
        totalAmount: Number(row.totalAmount),
        outstandingAmount: Number(row.outstandingAmount),
        amount: Number(row.subtotal),
        status: row.status,
        statusLabel: statusLabel[row.status],
        notes: row.notes,
        linkedBankTransactionId: row.linkedBankTransactionId,
        lines: row.lines.map((l) => ({
            id: l.id,
            description: l.description,
            quantity: Number(l.quantity),
            unitPrice: Number(l.unitPrice),
            lineTotal: Number(l.lineTotal),
            expenseCategoryId: l.expenseCategoryId,
            expenseCategoryName: l.expenseCategory?.name || "",
        })),
        payments: row.payments.map((p) => ({
            id: p.id,
            paymentDate: p.paymentDate.toISOString().slice(0, 10),
            amount: Number(p.amount),
            reference: p.reference,
            method: p.method,
            notes: p.notes,
            bankTransactionId: p.bankTransactionId,
            createdAt: p.createdAt.toISOString(),
        })),
        paidAmount: row.payments.reduce((s, p) => s + Number(p.amount), 0),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}
const invoiceInclude = {
    supplier: true,
    lines: { include: { expenseCategory: true } },
    payments: { orderBy: { paymentDate: "desc" } },
};
// ─── Expense categories ───────────────────────────────────────────────────────
router.get("/expense-categories", async (req, res) => {
    try {
        const schoolId = String(req.query.schoolId || "").trim();
        if (!schoolId)
            return res.status(400).json({ success: false, error: "Missing schoolId" });
        const categories = await (0, supplierAccountingService_1.ensureExpenseCategories)(schoolId);
        return res.json({ success: true, categories });
    }
    catch (error) {
        console.error("[accounting] GET expense-categories failed:", error);
        return res.status(500).json({ success: false, error: "Server error" });
    }
});
// ─── Suppliers ────────────────────────────────────────────────────────────────
router.get("/suppliers", async (req, res) => {
    try {
        const schoolId = String(req.query.schoolId || "").trim();
        const search = String(req.query.search || "").trim().toLowerCase();
        const status = String(req.query.status || "").trim();
        const page = Math.max(1, Number(req.query.page) || 1);
        const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize) || 10));
        if (!schoolId)
            return res.status(400).json({ success: false, error: "Missing schoolId" });
        const outstandingMap = await (0, supplierAccountingService_1.supplierOutstandingTotals)(schoolId);
        const where = { schoolId };
        if (status === "Active")
            where.status = "active";
        if (status === "Inactive" || status === "Disabled")
            where.status = "inactive";
        let rows = await prisma_1.prisma.supplier.findMany({
            where,
            orderBy: { supplierName: "asc" },
        });
        if (search) {
            rows = rows.filter((s) => s.supplierName.toLowerCase().includes(search) ||
                s.email.toLowerCase().includes(search) ||
                s.contactPerson.toLowerCase().includes(search) ||
                s.phone.toLowerCase().includes(search));
        }
        const totalItems = rows.length;
        const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
        const safePage = Math.min(page, totalPages);
        const items = rows
            .slice((safePage - 1) * pageSize, safePage * pageSize)
            .map((s) => mapSupplier(s, outstandingMap.get(s.id) || 0));
        return res.json({
            success: true,
            suppliers: items,
            page: safePage,
            totalPages,
            totalItems,
        });
    }
    catch (error) {
        console.error("[accounting] GET suppliers failed:", error);
        return res.status(500).json({ success: false, error: "Server error" });
    }
});
router.post("/suppliers", async (req, res) => {
    try {
        const schoolId = String(req.body?.schoolId || "").trim();
        const supplierName = String(req.body?.supplierName || req.body?.name || "").trim();
        if (!schoolId || !supplierName) {
            return res.status(400).json({ success: false, error: "schoolId and supplierName are required" });
        }
        const statusRaw = String(req.body?.status || "Active").trim();
        const status = statusRaw === "Inactive" || statusRaw === "Disabled" ? "inactive" : "active";
        const row = await prisma_1.prisma.supplier.create({
            data: {
                id: (0, supplierAccountingService_1.newId)("sup"),
                schoolId,
                supplierName,
                contactPerson: String(req.body?.contactPerson || "").trim(),
                email: String(req.body?.email || "").trim(),
                phone: String(req.body?.phone || "").trim(),
                vatNumber: String(req.body?.vatNumber || "").trim(),
                address: String(req.body?.address || "").trim(),
                status,
            },
        });
        return res.status(201).json({ success: true, supplier: mapSupplier(row, 0) });
    }
    catch (error) {
        console.error("[accounting] POST suppliers failed:", error);
        return res.status(500).json({ success: false, error: "Server error" });
    }
});
router.patch("/suppliers/:id", async (req, res) => {
    try {
        const schoolId = String(req.body?.schoolId || "").trim();
        const id = String(req.params.id || "").trim();
        if (!schoolId)
            return res.status(400).json({ success: false, error: "Missing schoolId" });
        const existing = await prisma_1.prisma.supplier.findFirst({ where: { id, schoolId } });
        if (!existing)
            return res.status(404).json({ success: false, error: "Supplier not found" });
        const data = {};
        if (req.body?.supplierName !== undefined || req.body?.name !== undefined) {
            data.supplierName = String(req.body.supplierName || req.body.name).trim();
        }
        if (req.body?.contactPerson !== undefined)
            data.contactPerson = String(req.body.contactPerson).trim();
        if (req.body?.email !== undefined)
            data.email = String(req.body.email).trim();
        if (req.body?.phone !== undefined)
            data.phone = String(req.body.phone).trim();
        if (req.body?.vatNumber !== undefined)
            data.vatNumber = String(req.body.vatNumber).trim();
        if (req.body?.address !== undefined)
            data.address = String(req.body.address).trim();
        if (req.body?.status !== undefined) {
            const s = String(req.body.status).trim();
            data.status = s === "Inactive" || s === "Disabled" ? "inactive" : "active";
        }
        const row = await prisma_1.prisma.supplier.update({ where: { id }, data });
        const outstandingMap = await (0, supplierAccountingService_1.supplierOutstandingTotals)(schoolId);
        return res.json({
            success: true,
            supplier: mapSupplier(row, outstandingMap.get(row.id) || 0),
        });
    }
    catch (error) {
        console.error("[accounting] PATCH suppliers failed:", error);
        return res.status(500).json({ success: false, error: "Server error" });
    }
});
// ─── Supplier invoices ────────────────────────────────────────────────────────
router.get("/supplier-invoices", async (req, res) => {
    try {
        const schoolId = String(req.query.schoolId || "").trim();
        const search = String(req.query.search || "").trim().toLowerCase();
        const status = String(req.query.status || "").trim();
        const supplierId = String(req.query.supplierId || "").trim();
        const page = Math.max(1, Number(req.query.page) || 1);
        const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize) || 10));
        if (!schoolId)
            return res.status(400).json({ success: false, error: "Missing schoolId" });
        const where = { schoolId };
        if (status)
            where.status = status;
        if (supplierId)
            where.supplierId = supplierId;
        let rows = await prisma_1.prisma.supplierInvoice.findMany({
            where,
            include: invoiceInclude,
            orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
        });
        if (search) {
            rows = rows.filter((inv) => inv.invoiceNumber.toLowerCase().includes(search) ||
                inv.supplier.supplierName.toLowerCase().includes(search) ||
                inv.notes.toLowerCase().includes(search));
        }
        const totalItems = rows.length;
        const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
        const safePage = Math.min(page, totalPages);
        const items = rows.slice((safePage - 1) * pageSize, safePage * pageSize).map(mapInvoice);
        return res.json({
            success: true,
            invoices: items,
            page: safePage,
            totalPages,
            totalItems,
        });
    }
    catch (error) {
        console.error("[accounting] GET supplier-invoices failed:", error);
        return res.status(500).json({ success: false, error: "Server error" });
    }
});
router.get("/supplier-invoices/open", async (req, res) => {
    try {
        const schoolId = String(req.query.schoolId || "").trim();
        if (!schoolId)
            return res.status(400).json({ success: false, error: "Missing schoolId" });
        const rows = await prisma_1.prisma.supplierInvoice.findMany({
            where: {
                schoolId,
                status: { in: ["approved", "partially_paid", "pending"] },
                outstandingAmount: { gt: 0 },
            },
            include: invoiceInclude,
            orderBy: { dueDate: "asc" },
        });
        return res.json({ success: true, invoices: rows.map(mapInvoice) });
    }
    catch (error) {
        console.error("[accounting] GET open invoices failed:", error);
        return res.status(500).json({ success: false, error: "Server error" });
    }
});
router.post("/supplier-invoices", async (req, res) => {
    try {
        const schoolId = String(req.body?.schoolId || "").trim();
        const supplierId = String(req.body?.supplierId || "").trim();
        if (!schoolId || !supplierId) {
            return res.status(400).json({ success: false, error: "schoolId and supplierId are required" });
        }
        const supplier = await prisma_1.prisma.supplier.findFirst({ where: { id: supplierId, schoolId } });
        if (!supplier)
            return res.status(404).json({ success: false, error: "Supplier not found" });
        const invoiceDate = (0, supplierAccountingService_1.parseIsoDate)(req.body?.invoiceDate);
        const dueDate = (0, supplierAccountingService_1.parseIsoDate)(req.body?.dueDate) || invoiceDate;
        if (!invoiceDate)
            return res.status(400).json({ success: false, error: "Invalid invoiceDate" });
        const linesInput = Array.isArray(req.body?.lines) ? req.body.lines : [];
        const lineRows = linesInput.map((raw) => {
            const qty = (0, supplierAccountingService_1.roundMoney)(raw.quantity ?? 1) || 1;
            const unitPrice = (0, supplierAccountingService_1.roundMoney)(raw.unitPrice);
            const lineTotal = (0, supplierAccountingService_1.roundMoney)(raw.lineTotal ?? qty * unitPrice);
            return {
                id: (0, supplierAccountingService_1.newId)("sline"),
                description: String(raw.description || "").trim() || "Line item",
                quantity: qty,
                unitPrice,
                lineTotal,
                expenseCategoryId: String(raw.expenseCategoryId || "").trim() || null,
            };
        });
        const subtotal = lineRows.length > 0
            ? (0, supplierAccountingService_1.roundMoney)(lineRows.reduce((s, l) => s + l.lineTotal, 0))
            : (0, supplierAccountingService_1.roundMoney)(req.body?.subtotal ?? req.body?.amount);
        const vatAmount = (0, supplierAccountingService_1.roundMoney)(req.body?.vatAmount);
        const totalAmount = (0, supplierAccountingService_1.roundMoney)(req.body?.totalAmount ?? subtotal + vatAmount);
        const autoApprove = Boolean(req.body?.autoApprove);
        const status = autoApprove ? "approved" : "pending";
        const invoice = await prisma_1.prisma.supplierInvoice.create({
            data: {
                id: (0, supplierAccountingService_1.newId)("sinv"),
                schoolId,
                supplierId,
                invoiceNumber: String(req.body?.invoiceNumber || "").trim(),
                invoiceDate,
                dueDate: dueDate || invoiceDate,
                subtotal,
                vatAmount,
                totalAmount,
                outstandingAmount: totalAmount,
                status,
                notes: String(req.body?.notes || "").trim(),
                lines: lineRows.length ? { create: lineRows } : undefined,
            },
            include: invoiceInclude,
        });
        if (status === "approved") {
            const cat = invoice.lines[0]?.expenseCategory?.name ||
                (await (0, supplierAccountingService_1.ensureExpenseCategories)(schoolId)).find((c) => c.id === invoice.lines[0]?.expenseCategoryId)
                    ?.name ||
                "Other";
            await (0, supplierAccountingService_1.postSupplierInvoiceApprovalJournal)(invoice, cat);
        }
        return res.status(201).json({ success: true, invoice: mapInvoice(invoice) });
    }
    catch (error) {
        console.error("[accounting] POST supplier-invoices failed:", error);
        return res.status(500).json({ success: false, error: "Server error" });
    }
});
router.post("/supplier-invoices/:id/approve", async (req, res) => {
    try {
        const schoolId = String(req.body?.schoolId || "").trim();
        const id = String(req.params.id || "").trim();
        if (!schoolId)
            return res.status(400).json({ success: false, error: "Missing schoolId" });
        const invoice = await prisma_1.prisma.supplierInvoice.findFirst({
            where: { id, schoolId },
            include: invoiceInclude,
        });
        if (!invoice)
            return res.status(404).json({ success: false, error: "Invoice not found" });
        if (invoice.status === "paid") {
            return res.status(400).json({ success: false, error: "Invoice is already paid" });
        }
        const updated = await prisma_1.prisma.supplierInvoice.update({
            where: { id },
            data: { status: "approved", outstandingAmount: invoice.totalAmount },
            include: invoiceInclude,
        });
        const catName = updated.lines[0]?.expenseCategory?.name || "Other";
        const journal = await (0, supplierAccountingService_1.postSupplierInvoiceApprovalJournal)(updated, catName);
        return res.json({
            success: true,
            invoice: mapInvoice(updated),
            journal: journal && !journal.duplicate ? (0, supplierAccountingService_1.mapJournalToApi)(journal.journal) : null,
        });
    }
    catch (error) {
        console.error("[accounting] POST approve invoice failed:", error);
        return res.status(500).json({ success: false, error: "Server error" });
    }
});
router.post("/supplier-invoices/:id/payments", async (req, res) => {
    try {
        const schoolId = String(req.body?.schoolId || "").trim();
        const id = String(req.params.id || "").trim();
        const amount = (0, supplierAccountingService_1.roundMoney)(req.body?.amount);
        const paymentDate = (0, supplierAccountingService_1.parseIsoDate)(req.body?.paymentDate) || new Date();
        const bankTransactionId = String(req.body?.bankTransactionId || "").trim() || null;
        if (!schoolId || amount <= 0) {
            return res.status(400).json({ success: false, error: "schoolId and positive amount are required" });
        }
        const invoice = await prisma_1.prisma.supplierInvoice.findFirst({
            where: { id, schoolId },
            include: invoiceInclude,
        });
        if (!invoice)
            return res.status(404).json({ success: false, error: "Invoice not found" });
        if (invoice.status === "pending") {
            return res.status(400).json({ success: false, error: "Approve invoice before recording payment" });
        }
        const payment = await prisma_1.prisma.supplierInvoicePayment.create({
            data: {
                id: (0, supplierAccountingService_1.newId)("spay"),
                schoolId,
                invoiceId: id,
                paymentDate,
                amount,
                reference: String(req.body?.reference || "").trim(),
                method: String(req.body?.method || "EFT").trim(),
                notes: String(req.body?.notes || "").trim(),
                bankTransactionId,
            },
        });
        const updated = await (0, supplierAccountingService_1.recalcInvoiceOutstanding)(id);
        if (!updated)
            return res.status(500).json({ success: false, error: "Failed to update invoice" });
        if (bankTransactionId) {
            await prisma_1.prisma.supplierInvoice.update({
                where: { id },
                data: { linkedBankTransactionId: bankTransactionId },
            });
        }
        const journal = await (0, supplierAccountingService_1.postSupplierPaymentJournal)({
            schoolId,
            invoice: updated,
            paymentId: payment.id,
            amount,
            paymentDate,
            reference: payment.reference,
        });
        return res.json({
            success: true,
            invoice: mapInvoice(updated),
            payment,
            journal: journal && !journal.duplicate ? (0, supplierAccountingService_1.mapJournalToApi)(journal.journal) : null,
        });
    }
    catch (error) {
        console.error("[accounting] POST invoice payment failed:", error);
        return res.status(500).json({ success: false, error: "Server error" });
    }
});
// ─── Bank supplier match ──────────────────────────────────────────────────────
router.get("/bank-match/suggestions", async (req, res) => {
    try {
        const schoolId = String(req.query.schoolId || "").trim();
        const description = String(req.query.description || "");
        const reference = String(req.query.reference || "");
        const amount = Math.abs(Number(req.query.amount) || 0);
        if (!schoolId)
            return res.status(400).json({ success: false, error: "Missing schoolId" });
        const suppliers = await prisma_1.prisma.supplier.findMany({ where: { schoolId, status: "active" } });
        const openInvoices = await prisma_1.prisma.supplierInvoice.findMany({
            where: {
                schoolId,
                status: { in: ["approved", "partially_paid"] },
                outstandingAmount: { gt: 0 },
            },
            include: { supplier: true },
        });
        const invoiceInputs = openInvoices.map((inv) => ({
            id: inv.id,
            invoiceNumber: inv.invoiceNumber,
            totalAmount: inv.totalAmount,
            outstandingAmount: inv.outstandingAmount,
            supplierId: inv.supplierId,
            status: inv.status,
            supplierName: inv.supplier.supplierName,
        }));
        const best = (0, supplierInvoiceMatcher_1.matchSupplierInvoicesForBankLine)(description, reference, amount, suppliers, invoiceInputs);
        const suggestions = (0, supplierInvoiceMatcher_1.suggestSupplierInvoicesForBankLine)(description, reference, amount, suppliers, invoiceInputs);
        return res.json({ success: true, best, suggestions });
    }
    catch (error) {
        console.error("[accounting] GET bank-match suggestions failed:", error);
        return res.status(500).json({ success: false, error: "Server error" });
    }
});
router.post("/bank-match/accept", async (req, res) => {
    try {
        const schoolId = String(req.body?.schoolId || "").trim();
        const invoiceId = String(req.body?.invoiceId || "").trim();
        const bankTransactionId = String(req.body?.bankTransactionId || "").trim();
        const amount = (0, supplierAccountingService_1.roundMoney)(req.body?.amount);
        const paymentDate = (0, supplierAccountingService_1.parseIsoDate)(req.body?.paymentDate) || new Date();
        const reference = String(req.body?.reference || "").trim();
        if (!schoolId || !invoiceId || !bankTransactionId || amount <= 0) {
            return res.status(400).json({
                success: false,
                error: "schoolId, invoiceId, bankTransactionId and amount are required",
            });
        }
        const txn = await prisma_1.prisma.bankTransaction.findFirst({
            where: { id: bankTransactionId, schoolId },
        });
        if (!txn)
            return res.status(404).json({ success: false, error: "Bank transaction not found" });
        let invoice = await prisma_1.prisma.supplierInvoice.findFirst({
            where: { id: invoiceId, schoolId },
            include: invoiceInclude,
        });
        if (!invoice)
            return res.status(404).json({ success: false, error: "Invoice not found" });
        if (invoice.status === "pending") {
            invoice = await prisma_1.prisma.supplierInvoice.update({
                where: { id: invoiceId },
                data: { status: "approved", outstandingAmount: invoice.totalAmount },
                include: invoiceInclude,
            });
            const catName = invoice.lines[0]?.expenseCategory?.name || "Other";
            await (0, supplierAccountingService_1.postSupplierInvoiceApprovalJournal)(invoice, catName);
        }
        const payment = await prisma_1.prisma.supplierInvoicePayment.create({
            data: {
                id: (0, supplierAccountingService_1.newId)("spay"),
                schoolId,
                invoiceId,
                paymentDate,
                amount,
                reference: reference || txn.reference || txn.description.slice(0, 80),
                method: "Bank Import",
                notes: "Matched from bank statement",
                bankTransactionId,
            },
        });
        const updated = await (0, supplierAccountingService_1.recalcInvoiceOutstanding)(invoiceId);
        if (!updated)
            return res.status(500).json({ success: false, error: "Invoice update failed" });
        await prisma_1.prisma.supplierInvoice.update({
            where: { id: invoiceId },
            data: { linkedBankTransactionId: bankTransactionId },
        });
        const paymentJournal = await (0, supplierAccountingService_1.postSupplierPaymentJournal)({
            schoolId,
            invoice: updated,
            paymentId: payment.id,
            amount,
            paymentDate,
            reference: payment.reference,
        });
        await prisma_1.prisma.bankTransaction.update({
            where: { id: bankTransactionId },
            data: {
                reviewStatus: "posted",
                matchStatus: "matched",
                supplierId: updated.supplierId,
                suggestedSupplierName: updated.supplier.supplierName,
                suggestedInvoiceId: invoiceId,
                suggestedInvoiceNumber: updated.invoiceNumber,
                expenseNotes: `Paid supplier invoice ${updated.invoiceNumber}`,
            },
        });
        return res.json({
            success: true,
            invoice: mapInvoice(updated),
            journal: paymentJournal && !paymentJournal.duplicate
                ? (0, supplierAccountingService_1.mapJournalToApi)(paymentJournal.journal)
                : null,
        });
    }
    catch (error) {
        console.error("[accounting] POST bank-match accept failed:", error);
        return res.status(500).json({ success: false, error: "Server error" });
    }
});
// ─── Creditors ageing ─────────────────────────────────────────────────────────
router.get("/creditors-ageing", async (req, res) => {
    try {
        const schoolId = String(req.query.schoolId || "").trim();
        const search = String(req.query.search || "").trim().toLowerCase();
        const asOf = (0, supplierAccountingService_1.parseIsoDate)(req.query.asOf) || new Date();
        const page = Math.max(1, Number(req.query.page) || 1);
        const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize) || 10));
        if (!schoolId)
            return res.status(400).json({ success: false, error: "Missing schoolId" });
        const invoices = await prisma_1.prisma.supplierInvoice.findMany({
            where: {
                schoolId,
                status: { in: ["approved", "partially_paid", "pending"] },
                outstandingAmount: { gt: 0 },
            },
            include: { supplier: true },
            orderBy: { dueDate: "asc" },
        });
        const bySupplier = new Map();
        const asOfMs = asOf.getTime();
        for (const inv of invoices) {
            const outstanding = Number(inv.outstandingAmount);
            if (outstanding <= 0)
                continue;
            const dueMs = inv.dueDate.getTime();
            const daysPast = Math.floor((asOfMs - dueMs) / (1000 * 60 * 60 * 24));
            let bucket = "current";
            if (daysPast > 90)
                bucket = "days90plus";
            else if (daysPast > 60)
                bucket = "days60";
            else if (daysPast > 30)
                bucket = "days30";
            const key = inv.supplierId;
            const existing = bySupplier.get(key) || {
                supplierId: inv.supplierId,
                supplierName: inv.supplier.supplierName,
                current: 0,
                days30: 0,
                days60: 0,
                days90plus: 0,
                total: 0,
            };
            existing[bucket] = (0, supplierAccountingService_1.roundMoney)(existing[bucket] + outstanding);
            existing.total = (0, supplierAccountingService_1.roundMoney)(existing.total + outstanding);
            bySupplier.set(key, existing);
        }
        let rows = [...bySupplier.values()];
        if (search) {
            rows = rows.filter((r) => r.supplierName.toLowerCase().includes(search));
        }
        rows.sort((a, b) => b.total - a.total);
        const totals = rows.reduce((acc, r) => ({
            current: (0, supplierAccountingService_1.roundMoney)(acc.current + r.current),
            days30: (0, supplierAccountingService_1.roundMoney)(acc.days30 + r.days30),
            days60: (0, supplierAccountingService_1.roundMoney)(acc.days60 + r.days60),
            days90plus: (0, supplierAccountingService_1.roundMoney)(acc.days90plus + r.days90plus),
            total: (0, supplierAccountingService_1.roundMoney)(acc.total + r.total),
        }), { current: 0, days30: 0, days60: 0, days90plus: 0, total: 0 });
        const totalItems = rows.length;
        const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
        const safePage = Math.min(page, totalPages);
        const items = rows.slice((safePage - 1) * pageSize, safePage * pageSize);
        return res.json({
            success: true,
            rows: items,
            totals,
            asOf: asOf.toISOString().slice(0, 10),
            page: safePage,
            totalPages,
            totalItems,
        });
    }
    catch (error) {
        console.error("[accounting] GET creditors-ageing failed:", error);
        return res.status(500).json({ success: false, error: "Server error" });
    }
});
// ─── Journals (sync for financial statements) ─────────────────────────────────
router.get("/journals", async (req, res) => {
    try {
        const schoolId = String(req.query.schoolId || "").trim();
        if (!schoolId)
            return res.status(400).json({ success: false, error: "Missing schoolId" });
        const journals = await prisma_1.prisma.accountingJournal.findMany({
            where: { schoolId },
            include: { lines: true },
            orderBy: { date: "desc" },
        });
        return res.json({
            success: true,
            journals: journals.map(supplierAccountingService_1.mapJournalToApi),
        });
    }
    catch (error) {
        console.error("[accounting] GET journals failed:", error);
        return res.status(500).json({ success: false, error: "Server error" });
    }
});
exports.default = router;
