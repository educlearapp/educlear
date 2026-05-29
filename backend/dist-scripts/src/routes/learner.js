"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const client_1 = require("@prisma/client");
const learnerIdentity_1 = require("../utils/learnerIdentity");
const learnerGender_1 = require("../utils/learnerGender");
const router = (0, express_1.Router)();
const prisma = new client_1.PrismaClient();
function cleanString(value) {
    return typeof value === "string" ? value.trim() : "";
}
function cleanBool(value, fallback) {
    if (value === undefined || value === null)
        return fallback;
    return Boolean(value);
}
function buildParentWriteData(rawParent, schoolId, familyAccountId) {
    const firstName = cleanString(rawParent.firstName || rawParent.name) || "Parent";
    const surname = cleanString(rawParent.surname || rawParent.lastName) || "-";
    const cellNo = cleanString(rawParent.cellNo || rawParent.cell || rawParent.phone || rawParent.mobile);
    const email = cleanString(rawParent.email);
    const idNumber = cleanString(rawParent.idNumber);
    const relationship = cleanString(rawParent.relationship || rawParent.relation);
    return {
        schoolId,
        familyAccountId: familyAccountId || null,
        relationship: relationship || null,
        title: cleanString(rawParent.title) || null,
        firstName,
        surname,
        idNumber: idNumber || null,
        cellNo: cellNo || "-",
        workNo: cleanString(rawParent.workNo || rawParent.work || rawParent.workPhone) || null,
        homeAddress: cleanString(rawParent.homeAddress) || null,
        homeNo: cleanString(rawParent.homeNo) || null,
        notes: cleanString(rawParent.notes) || null,
        email: email || null,
        communicationAdministration: cleanBool(rawParent.communicationAdministration ?? rawParent.administrationCommunications, true),
        communicationBilling: cleanBool(rawParent.communicationBilling ?? rawParent.billingCommunications, true),
        communicationByEmail: cleanBool(rawParent.communicationByEmail, true),
        communicationByPrint: cleanBool(rawParent.communicationByPrint, true),
        communicationBySMS: cleanBool(rawParent.communicationBySMS, true),
    };
}
function buildLinkWriteData(rawParent) {
    const relationship = cleanString(rawParent.relationship || rawParent.relation);
    return {
        relation: relationship || null,
        isPrimary: rawParent.isPrimary !== undefined ? Boolean(rawParent.isPrimary) : true,
        isPayingPerson: cleanBool(rawParent.isPayingPerson ?? rawParent.payingPerson, false),
        billingStatement: cleanBool(rawParent.billingStatement ?? rawParent.statement, true),
        billingInvoice: cleanBool(rawParent.billingInvoice ?? rawParent.invoice, true),
        billingReceipt: cleanBool(rawParent.billingReceipt ?? rawParent.receipt, true),
    };
}
function mapParentForClient(link) {
    const p = link.parent;
    return {
        id: p.id,
        firstName: p.firstName || "",
        surname: p.surname || "",
        lastName: p.surname || "",
        name: p.firstName || "",
        idNumber: p.idNumber || "",
        title: p.title || "",
        cellNo: p.cellNo || "",
        cell: p.cellNo || "",
        phone: p.cellNo || "",
        mobile: p.cellNo || "",
        workNo: p.workNo || "",
        work: p.workNo || "",
        workPhone: p.workNo || "",
        homeNo: p.homeNo || "",
        homeAddress: p.homeAddress || "",
        email: p.email || "",
        notes: p.notes || "",
        relationship: link.relation || p.relationship || "",
        relation: link.relation || p.relationship || "",
        isPrimary: link.isPrimary || false,
        communicationAdministration: p.communicationAdministration ?? true,
        communicationBilling: p.communicationBilling ?? true,
        communicationByEmail: p.communicationByEmail ?? true,
        communicationByPrint: p.communicationByPrint ?? true,
        communicationBySMS: p.communicationBySMS ?? true,
        isPayingPerson: link.isPayingPerson ?? false,
        billingStatement: link.billingStatement ?? true,
        billingInvoice: link.billingInvoice ?? true,
        billingReceipt: link.billingReceipt ?? true,
        outstandingAmount: p.outstandingAmount || 0,
        status: p.status || "GREEN",
    };
}
async function createFamilyAccountRef(schoolId, surname) {
    const prefix = (0, learnerIdentity_1.getSurnamePrefix)(surname);
    const existingCount = await prisma.familyAccount.count({
        where: {
            schoolId,
            accountRef: {
                startsWith: prefix,
            },
        },
    });
    return `${prefix}${String(existingCount + 1).padStart(3, "0")}`;
}
function normaliseParents(body) {
    const directParents = Array.isArray(body.parents) ? body.parents : [];
    const learnerParents = Array.isArray(body.learner?.parents) ? body.learner.parents : [];
    const singleParent = body.parent && typeof body.parent === "object" ? [body.parent] : [];
    return [...directParents, ...learnerParents, ...singleParent].filter((p) => p && typeof p === "object");
}
async function saveParentLinks({ schoolId, learnerId, familyAccountId, parents, }) {
    for (const rawParent of parents) {
        const parentData = buildParentWriteData(rawParent, schoolId, familyAccountId);
        const linkData = buildLinkWriteData(rawParent);
        const idNumber = cleanString(rawParent.idNumber);
        if (!parentData.firstName &&
            parentData.surname === "-" &&
            parentData.cellNo === "-" &&
            !parentData.email &&
            !idNumber) {
            continue;
        }
        let parent = null;
        if (rawParent.id && !String(rawParent.id).startsWith("local-parent-")) {
            parent = await prisma.parent.update({
                where: { id: rawParent.id },
                data: parentData,
            });
        }
        else if (idNumber) {
            parent = await prisma.parent.upsert({
                where: { idNumber },
                update: parentData,
                create: { ...parentData, idNumber },
            });
        }
        else {
            parent = await prisma.parent.create({
                data: parentData,
            });
        }
        await prisma.parentLearnerLink.upsert({
            where: {
                parentId_learnerId: {
                    parentId: parent.id,
                    learnerId,
                },
            },
            update: linkData,
            create: {
                schoolId,
                parentId: parent.id,
                learnerId,
                ...linkData,
            },
        });
    }
}
function mapLearnerDetailForClient(learner) {
    const accountNo = (0, learnerIdentity_1.resolveLearnerAccountNo)(learner);
    const firstName = learner.firstName || "";
    const lastName = learner.lastName || "";
    const notes = learner.notes || "";
    const enrollmentDateMatch = notes.match(/Enrolment date:\s*(\d{4}-\d{2}-\d{2})/i);
    const enrollmentDate = enrollmentDateMatch?.[1] || learner.createdAt.toISOString().slice(0, 10);
    return {
        id: learner.id,
        schoolId: learner.schoolId,
        familyAccountId: learner.familyAccountId,
        familyAccount: learner.familyAccount
            ? {
                id: learner.familyAccount.id,
                accountRef: learner.familyAccount.accountRef,
                familyName: learner.familyAccount.familyName,
            }
            : null,
        accountNo,
        accountNumber: accountNo,
        admissionNo: learner.admissionNo || accountNo,
        firstName,
        name: firstName,
        lastName,
        surname: lastName,
        fullName: `${firstName} ${lastName}`.trim(),
        birthDate: learner.birthDate,
        dateOfBirth: learner.birthDate,
        dob: learner.birthDate,
        gender: (0, learnerGender_1.normalizeLearnerGender)(learner.gender) || learner.gender || "",
        enrollmentStatus: learner.enrollmentStatus || "ACTIVE",
        idNumber: learner.idNumber || "",
        idNo: learner.idNumber || "",
        homeLanguage: learner.homeLanguage || "",
        citizenship: learner.citizenship || "",
        nationality: learner.citizenship || "",
        grade: learner.grade || "",
        className: learner.className || "",
        classroom: learner.className || learner.grade || "",
        classroomName: learner.className || learner.grade || "",
        classroomId: null,
        enrollmentDate,
        notes,
        tuitionFee: learner.tuitionFee ?? 0,
        transportFee: learner.transportFee ?? 0,
        otherFee: learner.otherFee ?? 0,
        totalFee: learner.totalFee ?? 0,
        createdAt: learner.createdAt,
        parents: learner.links?.map((link) => mapParentForClient(link)) || [],
    };
}
router.get("/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const learner = await prisma.learner.findUnique({
            where: { id },
            include: {
                familyAccount: true,
                links: { include: { parent: true } },
            },
        });
        if (!learner) {
            return res.status(404).json({ success: false, error: "Learner not found" });
        }
        return res.status(200).json({
            success: true,
            learner: mapLearnerDetailForClient(learner),
        });
    }
    catch (error) {
        console.error("GET LEARNER ERROR:", error);
        return res.status(500).json({ success: false, error: "Failed to fetch learner" });
    }
});
router.get("/", async (req, res) => {
    try {
        const { schoolId } = req.query;
        if (!schoolId) {
            return res.status(400).json({ success: false, error: "Missing schoolId" });
        }
        const includeHistorical = String(req.query.includeHistorical || "").toLowerCase() === "true";
        const learners = await prisma.learner.findMany({
            where: {
                schoolId: String(schoolId),
                ...(includeHistorical ? {} : { enrollmentStatus: "ACTIVE" }),
            },
            include: {
                familyAccount: true,
                links: {
                    include: {
                        parent: true,
                    },
                },
            },
            orderBy: { createdAt: "desc" },
        });
        const learnersWithParents = learners.map((learner) => {
            const accountNo = (0, learnerIdentity_1.resolveLearnerAccountNo)(learner);
            return {
                id: learner.id,
                schoolId: learner.schoolId,
                familyAccountId: learner.familyAccountId,
                accountNo,
                accountNumber: accountNo,
                firstName: learner.firstName || "",
                lastName: learner.lastName || "",
                surname: learner.lastName || "",
                birthDate: learner.birthDate,
                gender: (0, learnerGender_1.normalizeLearnerGender)(learner.gender) || learner.gender || "",
                enrollmentStatus: learner.enrollmentStatus,
                homeLanguage: learner.homeLanguage || "",
                citizenship: learner.citizenship || "",
                idNumber: learner.idNumber || "",
                grade: learner.grade || "",
                className: learner.className || "",
                classroom: learner.className || "",
                classroomName: learner.className || "",
                admissionNo: learner.admissionNo || accountNo,
                tuitionFee: learner.tuitionFee || 0,
                transportFee: learner.transportFee || 0,
                otherFee: learner.otherFee || 0,
                totalFee: learner.totalFee || 0,
                createdAt: learner.createdAt,
                parents: learner.links?.map((link) => mapParentForClient(link)) || [],
            };
        });
        return res.status(200).json({
            success: true,
            learners: learnersWithParents,
        });
    }
    catch (error) {
        console.error("GET LEARNERS ERROR:", error);
        return res.status(500).json({
            success: false,
            error: "Failed to fetch learners",
        });
    }
});
async function createLearnerWithAccount({ schoolId, learner, }) {
    const learnerSurname = cleanString(learner.surname || learner.lastName);
    const accountNo = await createFamilyAccountRef(schoolId, learnerSurname);
    const familyAccount = await prisma.familyAccount.create({
        data: {
            schoolId,
            accountRef: accountNo,
            familyName: learnerSurname,
        },
    });
    const newLearner = await prisma.learner.create({
        data: {
            schoolId,
            familyAccountId: familyAccount.id,
            firstName: cleanString(learner.firstName),
            lastName: learnerSurname,
            birthDate: learner.birthDate ? new Date(learner.birthDate) : null,
            gender: cleanString(learner.gender),
            idNumber: cleanString(learner.idNumber) || null,
            grade: cleanString(learner.grade),
            className: cleanString(learner.className || learner.classroom || learner.classroomName) || null,
            admissionNo: accountNo,
            tuitionFee: Number(learner.tuitionFee) || 0,
            transportFee: Number(learner.transportFee) || 0,
            otherFee: Number(learner.otherFee) || 0,
            totalFee: Number(learner.totalFee) || 0,
        },
    });
    return {
        accountNo,
        familyAccount,
        learner: newLearner,
    };
}
router.post("/", async (req, res) => {
    try {
        const learner = req.body.learner || req.body;
        if (!learner) {
            return res.status(400).json({
                success: false,
                error: "Missing learner data",
            });
        }
        let school = null;
        if (learner.schoolId || req.body.schoolId) {
            school = await prisma.school.findUnique({
                where: { id: learner.schoolId || req.body.schoolId },
            });
        }
        if (!school) {
            school = await prisma.school.findFirst({
                orderBy: { createdAt: "asc" },
            });
        }
        if (!school) {
            return res.status(400).json({
                success: false,
                error: "No school found. Register a school or provide a valid schoolId.",
            });
        }
        const main = await createLearnerWithAccount({
            schoolId: school.id,
            learner: {
                ...learner,
                schoolId: school.id,
            },
        });
        const parents = normaliseParents(req.body);
        await saveParentLinks({
            schoolId: school.id,
            learnerId: main.learner.id,
            familyAccountId: main.familyAccount.id,
            parents,
        });
        const siblings = Array.isArray(req.body.siblings) ? req.body.siblings : [];
        const createdSiblings = [];
        for (const sibling of siblings) {
            const siblingFirstName = cleanString(sibling.firstName);
            const siblingSurname = cleanString(sibling.surname || sibling.lastName);
            const siblingGrade = cleanString(sibling.grade);
            if (!siblingFirstName || !siblingSurname || !siblingGrade)
                continue;
            const createdSibling = await createLearnerWithAccount({
                schoolId: school.id,
                learner: {
                    ...sibling,
                    schoolId: school.id,
                    firstName: siblingFirstName,
                    lastName: siblingSurname,
                    grade: siblingGrade,
                },
            });
            await saveParentLinks({
                schoolId: school.id,
                learnerId: createdSibling.learner.id,
                familyAccountId: createdSibling.familyAccount.id,
                parents,
            });
            createdSiblings.push({
                accountNo: createdSibling.accountNo,
                familyAccountId: createdSibling.familyAccount.id,
                learnerId: createdSibling.learner.id,
                learner: createdSibling.learner,
            });
        }
        return res.status(200).json({
            success: true,
            accountNo: main.accountNo,
            familyReference: main.accountNo,
            familyAccountId: main.familyAccount.id,
            learnerId: main.learner.id,
            learner: {
                ...main.learner,
                accountNo: main.accountNo,
                accountNumber: main.accountNo,
            },
            siblings: createdSiblings,
        });
    }
    catch (error) {
        console.error("SAVE LEARNER ERROR:", error);
        return res.status(500).json({
            success: false,
            error: "Failed to save learner",
        });
    }
});
router.put("/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const { firstName, lastName, surname, birthDate, gender, idNumber, grade, className, classroom, classroomName, admissionNo, tuitionFee, transportFee, otherFee, totalFee, } = req.body;
        const existingLearner = await prisma.learner.findUnique({
            where: { id },
        });
        if (!existingLearner) {
            return res.status(404).json({
                success: false,
                error: "Learner not found",
            });
        }
        const updatedLearner = await prisma.learner.update({
            where: { id },
            data: {
                ...(firstName !== undefined && { firstName: cleanString(firstName) }),
                ...((lastName !== undefined || surname !== undefined) && {
                    lastName: cleanString(lastName ?? surname),
                }),
                ...(birthDate !== undefined && {
                    birthDate: birthDate ? new Date(birthDate) : null,
                }),
                ...(gender !== undefined && { gender: cleanString(gender) }),
                ...(idNumber !== undefined && { idNumber: cleanString(idNumber) || null }),
                ...(grade !== undefined && { grade: cleanString(grade) }),
                ...(className !== undefined && { className: cleanString(className) || null }),
                ...(classroom !== undefined && { className: cleanString(classroom) || null }),
                ...(classroomName !== undefined && { className: cleanString(classroomName) || null }),
                ...(admissionNo !== undefined && { admissionNo: cleanString(admissionNo) || null }),
                ...(tuitionFee !== undefined && { tuitionFee: Number(tuitionFee) || 0 }),
                ...(transportFee !== undefined && { transportFee: Number(transportFee) || 0 }),
                ...(otherFee !== undefined && { otherFee: Number(otherFee) || 0 }),
                ...(totalFee !== undefined && { totalFee: Number(totalFee) || 0 }),
            },
            include: {
                familyAccount: true,
                links: {
                    include: {
                        parent: true,
                    },
                },
            },
        });
        const parents = normaliseParents(req.body);
        await saveParentLinks({
            schoolId: updatedLearner.schoolId,
            learnerId: updatedLearner.id,
            familyAccountId: updatedLearner.familyAccountId,
            parents,
        });
        const refreshedLearner = await prisma.learner.findUnique({
            where: { id },
            include: {
                familyAccount: true,
                links: {
                    include: {
                        parent: true,
                    },
                },
            },
        });
        const accountNo = (0, learnerIdentity_1.resolveLearnerAccountNo)(refreshedLearner);
        return res.json({
            success: true,
            learner: {
                ...refreshedLearner,
                accountNo,
                accountNumber: accountNo,
                parents: refreshedLearner?.links?.map((link) => mapParentForClient(link)) || [],
            },
        });
    }
    catch (error) {
        console.error("UPDATE LEARNER ERROR:", error);
        return res.status(500).json({
            success: false,
            error: "Failed to update learner",
        });
    }
});
exports.default = router;
