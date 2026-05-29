"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../prisma");
const learnerIdentity_1 = require("../utils/learnerIdentity");
const billingLedgerStore_1 = require("../utils/billingLedgerStore");
const router = (0, express_1.Router)();
const STATUS_LABELS = {
    ACTIVE: "Active",
    PARTIALLY_ALLOCATED: "Partially Allocated",
    FULLY_ALLOCATED: "Fully Allocated",
    REFUNDED: "Refunded",
    VOID: "Void",
};
function parseIsoDate(value) {
    const raw = String(value || "").trim();
    if (!raw)
        return null;
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match)
        return null;
    const d = new Date(`${match[1]}-${match[2]}-${match[3]}T12:00:00.000Z`);
    return Number.isNaN(d.getTime()) ? null : d;
}
function formatDepositDate(value) {
    return value.toISOString().slice(0, 10);
}
function computeStatus(amount, remainingBalance, current) {
    if (current === "REFUNDED" || current === "VOID")
        return current;
    if (remainingBalance <= 0)
        return "FULLY_ALLOCATED";
    if (remainingBalance < amount)
        return "PARTIALLY_ALLOCATED";
    return "ACTIVE";
}
async function nextDepositNumber(schoolId) {
    const count = await prisma_1.prisma.billingDeposit.count({ where: { schoolId } });
    return `DEP-${String(count + 1).padStart(5, "0")}`;
}
function mapDepositRow(deposit) {
    const accountNo = deposit.familyAccount?.accountRef ||
        deposit.learner.familyAccount?.accountRef ||
        "";
    const accountLabel = deposit.familyAccount?.familyName ||
        deposit.learner.familyAccount?.familyName ||
        accountNo;
    const learnerName = `${deposit.learner.firstName || ""} ${deposit.learner.lastName || ""}`.trim();
    return {
        id: deposit.id,
        depositNumber: deposit.depositNumber,
        schoolId: deposit.schoolId,
        familyAccountId: deposit.familyAccountId,
        learnerId: deposit.learnerId,
        accountNo,
        account: accountLabel || accountNo || "—",
        learnerName: learnerName || "—",
        amount: deposit.amount,
        remainingBalance: deposit.remainingBalance,
        status: deposit.status,
        statusLabel: STATUS_LABELS[deposit.status] || deposit.status,
        reference: deposit.reference || "",
        notes: deposit.notes || "",
        date: formatDepositDate(deposit.depositDate),
        depositDate: formatDepositDate(deposit.depositDate),
        createdAt: deposit.createdAt.toISOString(),
        updatedAt: deposit.updatedAt.toISOString(),
        allocations: deposit.allocations.map((a) => ({
            id: a.id,
            ledgerInvoiceId: a.ledgerInvoiceId,
            invoiceReference: a.invoiceReference || "",
            invoiceDate: a.invoiceDate || "",
            amount: a.amount,
            createdAt: a.createdAt.toISOString(),
        })),
        history: deposit.history.map((h) => ({
            id: h.id,
            action: h.action,
            amount: h.amount,
            description: h.description || "",
            metadata: h.metadata,
            createdAt: h.createdAt.toISOString(),
        })),
    };
}
const depositInclude = {
    learner: {
        select: {
            id: true,
            firstName: true,
            lastName: true,
            familyAccount: { select: { accountRef: true, familyName: true } },
        },
    },
    familyAccount: { select: { accountRef: true, familyName: true } },
    allocations: { orderBy: { createdAt: "desc" } },
    history: { orderBy: { createdAt: "desc" } },
};
function buildOpenInvoices(schoolId, learnerId, accountNo) {
    const ledger = (0, billingLedgerStore_1.readSchoolLedger)(schoolId);
    const invoices = (0, billingLedgerStore_1.listInvoices)(schoolId).filter((e) => e.learnerId === learnerId && (!accountNo || e.accountNo === accountNo));
    return invoices.map((inv) => ({
        id: inv.id,
        ledgerInvoiceId: inv.id,
        invoiceReference: inv.reference || inv.description || inv.id,
        invoiceDate: inv.date,
        dueDate: inv.dueDate || inv.date,
        amount: inv.amount,
        description: inv.description,
    }));
}
// GET /api/deposits?schoolId=...
router.get("/", async (req, res) => {
    try {
        const schoolId = String(req.query.schoolId || "").trim();
        if (!schoolId) {
            return res.status(400).json({ success: false, error: "Missing schoolId" });
        }
        const statusFilter = String(req.query.status || "").trim();
        const search = String(req.query.search || "").trim().toLowerCase();
        const where = { schoolId };
        if (statusFilter) {
            where.status = statusFilter;
        }
        const deposits = await prisma_1.prisma.billingDeposit.findMany({
            where,
            include: depositInclude,
            orderBy: [{ depositDate: "desc" }, { createdAt: "desc" }],
        });
        const rows = deposits
            .map(mapDepositRow)
            .filter((row) => {
            if (!search)
                return true;
            const haystack = [
                row.depositNumber,
                row.account,
                row.accountNo,
                row.learnerName,
                row.reference,
                row.statusLabel,
            ]
                .join(" ")
                .toLowerCase();
            return haystack.includes(search);
        });
        return res.json({ success: true, deposits: rows, total: rows.length });
    }
    catch (error) {
        console.error("[deposits] GET / failed:", error);
        return res.status(500).json({ success: false, error: "Server error" });
    }
});
// GET /api/deposits/:id?schoolId=...
router.get("/:id", async (req, res) => {
    try {
        const schoolId = String(req.query.schoolId || "").trim();
        const id = String(req.params.id || "").trim();
        if (!schoolId || !id) {
            return res.status(400).json({ success: false, error: "Missing schoolId or deposit id" });
        }
        const deposit = await prisma_1.prisma.billingDeposit.findFirst({
            where: { id, schoolId },
            include: depositInclude,
        });
        if (!deposit) {
            return res.status(404).json({ success: false, error: "Deposit not found" });
        }
        const accountNo = deposit.familyAccount?.accountRef ||
            deposit.learner.familyAccount?.accountRef ||
            "";
        const openInvoices = buildOpenInvoices(schoolId, deposit.learnerId, accountNo);
        return res.json({
            success: true,
            deposit: mapDepositRow(deposit),
            openInvoices,
        });
    }
    catch (error) {
        console.error("[deposits] GET /:id failed:", error);
        return res.status(500).json({ success: false, error: "Server error" });
    }
});
// POST /api/deposits
router.post("/", async (req, res) => {
    try {
        const body = (req.body ?? {});
        const schoolId = String(body.schoolId || "").trim();
        const learnerId = String(body.learnerId || "").trim();
        const familyAccountId = String(body.familyAccountId || "").trim() || null;
        const amount = (0, billingLedgerStore_1.normaliseAmount)(body.amount);
        const reference = String(body.reference || "").trim() || null;
        const notes = String(body.notes || "").trim() || null;
        const depositDate = parseIsoDate(body.depositDate || body.date) || new Date();
        if (!schoolId || !learnerId || amount <= 0) {
            return res.status(400).json({
                success: false,
                error: "Missing schoolId, learnerId, or valid amount",
            });
        }
        const learner = await prisma_1.prisma.learner.findFirst({
            where: { id: learnerId, schoolId },
            include: { familyAccount: { select: { id: true, accountRef: true } } },
        });
        if (!learner) {
            return res.status(404).json({ success: false, error: "Learner not found for this school" });
        }
        const resolvedFamilyId = familyAccountId || learner.familyAccountId || learner.familyAccount?.id || null;
        const depositNumber = await nextDepositNumber(schoolId);
        const deposit = await prisma_1.prisma.billingDeposit.create({
            data: {
                schoolId,
                depositNumber,
                familyAccountId: resolvedFamilyId,
                learnerId,
                amount,
                remainingBalance: amount,
                reference,
                notes,
                depositDate,
                status: "ACTIVE",
                history: {
                    create: {
                        schoolId,
                        action: "CREATED",
                        amount,
                        description: `Deposit ${depositNumber} received`,
                    },
                },
            },
            include: depositInclude,
        });
        return res.status(201).json({ success: true, deposit: mapDepositRow(deposit) });
    }
    catch (error) {
        console.error("[deposits] POST / failed:", error);
        return res.status(500).json({ success: false, error: "Server error" });
    }
});
// PUT /api/deposits/:id
router.put("/:id", async (req, res) => {
    try {
        const body = (req.body ?? {});
        const schoolId = String(body.schoolId || "").trim();
        const id = String(req.params.id || "").trim();
        if (!schoolId || !id) {
            return res.status(400).json({ success: false, error: "Missing schoolId or deposit id" });
        }
        const existing = await prisma_1.prisma.billingDeposit.findFirst({
            where: { id, schoolId },
            include: { allocations: true },
        });
        if (!existing) {
            return res.status(404).json({ success: false, error: "Deposit not found" });
        }
        if (existing.status === "VOID" || existing.status === "REFUNDED") {
            return res.status(400).json({ success: false, error: "Deposit cannot be modified" });
        }
        const reference = body.reference !== undefined ? String(body.reference || "").trim() || null : undefined;
        const notes = body.notes !== undefined ? String(body.notes || "").trim() || null : undefined;
        const manualStatus = body.status ? String(body.status).trim() : "";
        let remainingBalance = existing.remainingBalance;
        const allocationRows = Array.isArray(body.allocations) ? body.allocations : [];
        const updates = {};
        if (reference !== undefined)
            updates.reference = reference;
        if (notes !== undefined)
            updates.notes = notes;
        if (allocationRows.length > 0) {
            const ledger = (0, billingLedgerStore_1.readSchoolLedger)(schoolId);
            let totalAllocate = 0;
            for (const row of allocationRows) {
                const ledgerInvoiceId = String(row?.ledgerInvoiceId || row?.invoiceId || "").trim();
                const allocateAmount = (0, billingLedgerStore_1.normaliseAmount)(row?.amount);
                if (!ledgerInvoiceId || allocateAmount <= 0)
                    continue;
                const invoice = ledger.find((e) => e.id === ledgerInvoiceId && e.type === "invoice");
                if (!invoice) {
                    return res.status(400).json({
                        success: false,
                        error: `Invoice ${ledgerInvoiceId} not found`,
                    });
                }
                if (invoice.learnerId !== existing.learnerId) {
                    return res.status(400).json({
                        success: false,
                        error: "Invoice does not belong to this deposit learner",
                    });
                }
                const alreadyAllocated = existing.allocations
                    .filter((a) => a.ledgerInvoiceId === ledgerInvoiceId)
                    .reduce((sum, a) => sum + a.amount, 0);
                if (allocateAmount + alreadyAllocated > invoice.amount + 0.001) {
                    return res.status(400).json({
                        success: false,
                        error: `Allocation exceeds invoice amount for ${invoice.reference || ledgerInvoiceId}`,
                    });
                }
                totalAllocate += allocateAmount;
            }
            if (totalAllocate > remainingBalance + 0.001) {
                return res.status(400).json({
                    success: false,
                    error: "Total allocation exceeds remaining deposit balance",
                });
            }
            for (const row of allocationRows) {
                const ledgerInvoiceId = String(row?.ledgerInvoiceId || row?.invoiceId || "").trim();
                const allocateAmount = (0, billingLedgerStore_1.normaliseAmount)(row?.amount);
                if (!ledgerInvoiceId || allocateAmount <= 0)
                    continue;
                const invoice = ledger.find((e) => e.id === ledgerInvoiceId);
                await prisma_1.prisma.billingDepositAllocation.create({
                    data: {
                        schoolId,
                        depositId: id,
                        ledgerInvoiceId,
                        invoiceReference: invoice.reference || null,
                        invoiceDate: invoice.date || null,
                        amount: allocateAmount,
                    },
                });
                await prisma_1.prisma.billingDepositHistoryEntry.create({
                    data: {
                        schoolId,
                        depositId: id,
                        action: "ALLOCATED",
                        amount: allocateAmount,
                        description: `Allocated ${allocateAmount.toFixed(2)} to invoice ${invoice.reference || ledgerInvoiceId}`,
                        metadata: { ledgerInvoiceId },
                    },
                });
            }
            remainingBalance = Math.max(0, remainingBalance - totalAllocate);
            updates.remainingBalance = remainingBalance;
        }
        let nextStatus = existing.status;
        if (manualStatus === "REFUNDED" || manualStatus === "VOID") {
            nextStatus = manualStatus;
        }
        else {
            nextStatus = computeStatus(existing.amount, remainingBalance, existing.status);
        }
        updates.status = nextStatus;
        const deposit = await prisma_1.prisma.billingDeposit.update({
            where: { id },
            data: updates,
            include: depositInclude,
        });
        const accountNo = (0, learnerIdentity_1.resolveLearnerAccountNo)({
            familyAccount: deposit.familyAccount || deposit.learner.familyAccount,
        });
        const openInvoices = buildOpenInvoices(schoolId, deposit.learnerId, accountNo);
        return res.json({
            success: true,
            deposit: mapDepositRow(deposit),
            openInvoices,
        });
    }
    catch (error) {
        console.error("[deposits] PUT /:id failed:", error);
        return res.status(500).json({ success: false, error: "Server error" });
    }
});
exports.default = router;
