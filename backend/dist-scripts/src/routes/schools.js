"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../prisma");
const schoolLogo_1 = require("../utils/schoolLogo");
const router = (0, express_1.Router)();
const schoolSelect = {
    id: true,
    name: true,
    email: true,
    phone: true,
    cellNo: true,
    address: true,
    postalAddress: true,
    bankingDetails: true,
    logoUrl: true,
    primaryColor: true,
    createdAt: true,
};
function optionalTrimmedString(raw) {
    if (raw === null || raw === undefined)
        return null;
    const text = String(raw).trim();
    return text === "" ? null : text;
}
router.get("/", async (_req, res) => {
    try {
        const schools = await prisma_1.prisma.school.findMany({
            select: {
                id: true,
                name: true,
                email: true,
                createdAt: true,
            },
            orderBy: { name: "asc" },
        });
        res.json(schools);
    }
    catch (error) {
        console.error("Error fetching schools:", error);
        res.status(500).json({ error: "Failed to fetch schools" });
    }
});
router.get("/:id", async (req, res) => {
    try {
        const id = String(req.params.id || "").trim();
        if (!id)
            return res.status(400).json({ error: "Missing school id" });
        const school = await prisma_1.prisma.school.findUnique({
            where: { id },
            select: schoolSelect,
        });
        if (!school)
            return res.status(404).json({ error: "School not found" });
        return res.json(school);
    }
    catch (error) {
        console.error("Error fetching school:", error);
        return res.status(500).json({ error: "Failed to fetch school" });
    }
});
router.put("/:id", async (req, res) => {
    try {
        const id = String(req.params.id || "").trim();
        if (!id)
            return res.status(400).json({ error: "Missing school id" });
        const existing = await prisma_1.prisma.school.findUnique({
            where: { id },
            select: { id: true },
        });
        if (!existing)
            return res.status(404).json({ error: "School not found" });
        const name = String(req.body?.name ?? "").trim();
        if (!name)
            return res.status(400).json({ error: "Business name is required" });
        const email = optionalTrimmedString(req.body?.email);
        const phone = optionalTrimmedString(req.body?.phone);
        const cellNo = optionalTrimmedString(req.body?.cellNo);
        const address = optionalTrimmedString(req.body?.address);
        const postalAddress = optionalTrimmedString(req.body?.postalAddress);
        const bankingDetails = optionalTrimmedString(req.body?.bankingDetails);
        const logoUrlRaw = req.body?.logoUrl === undefined ? undefined : optionalTrimmedString(req.body?.logoUrl);
        const logoUrl = logoUrlRaw === undefined ? undefined : logoUrlRaw === null ? null : (0, schoolLogo_1.toStoredSchoolLogoUrl)(logoUrlRaw);
        const school = await prisma_1.prisma.school.update({
            where: { id },
            data: {
                name,
                email,
                phone,
                cellNo,
                address,
                postalAddress,
                bankingDetails,
                ...(logoUrl !== undefined ? { logoUrl } : {}),
            },
            select: schoolSelect,
        });
        return res.json(school);
    }
    catch (error) {
        console.error("Error updating school:", error);
        return res.status(500).json({ error: "Failed to update school" });
    }
});
exports.default = router;
