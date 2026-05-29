"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const learnerIdentity_1 = require("../utils/learnerIdentity");
const learnerGender_1 = require("../utils/learnerGender");
const learnerBillingPlanStore_1 = require("../utils/learnerBillingPlanStore");
const client_1 = require("@prisma/client");
const router = (0, express_1.Router)();
const prisma = new client_1.PrismaClient();
function mapEnrollmentDisplay(status) {
    if (status === "HISTORICAL") {
        return {
            childStatus: "Historical",
            status: "Historical",
            enrolled: false,
            isEnrolled: false,
        };
    }
    return {
        childStatus: "Enrolled",
        status: "Enrolled",
        enrolled: true,
        isEnrolled: true,
    };
}
router.get("/learners", async (req, res) => {
    try {
        const schoolId = String(req.query.schoolId || "");
        if (!schoolId) {
            return res.status(400).json({
                success: false,
                error: "Missing schoolId",
            });
        }
        const billingPlansByLearner = (0, learnerBillingPlanStore_1.readSchoolBillingPlans)(schoolId);
        const learners = await prisma.learner.findMany({
            where: { schoolId },
            include: {
                familyAccount: true,
                links: {
                    include: { parent: true },
                },
            },
            orderBy: { createdAt: "desc" },
        });
        const result = learners.map((learner) => {
            const primary = learner.links.find((link) => link.isPrimary) || learner.links[0];
            const accountNo = (0, learnerIdentity_1.resolveLearnerAccountNo)(learner);
            const enrollment = mapEnrollmentDisplay(learner.enrollmentStatus);
            const gender = (0, learnerGender_1.normalizeLearnerGender)(learner.gender) || learner.gender || "";
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
                firstName: learner.firstName || "",
                name: learner.firstName || "",
                surname: learner.lastName || "",
                lastName: learner.lastName || "",
                birthDate: learner.birthDate,
                dateOfBirth: learner.birthDate,
                dob: learner.birthDate,
                age: (0, learnerIdentity_1.calculateLearnerAge)(learner.birthDate),
                gender,
                idNumber: learner.idNumber || "",
                homeLanguage: learner.homeLanguage || "",
                citizenship: learner.citizenship || "",
                nationality: learner.citizenship || "",
                enrollmentStatus: learner.enrollmentStatus,
                grade: learner.grade || "",
                classroom: learner.className || learner.grade || "",
                classroomName: learner.className || learner.grade || "",
                className: learner.className || "",
                childStatus: enrollment.childStatus,
                status: enrollment.status,
                enrolled: enrollment.enrolled,
                isEnrolled: enrollment.isEnrolled,
                parents: learner.links.map((link) => ({
                    id: link.parent.id,
                    firstName: link.parent.firstName || "",
                    name: link.parent.firstName || "",
                    surname: link.parent.surname || "",
                    lastName: link.parent.surname || "",
                    relationship: link.relation || link.parent.relationship || "",
                    relation: link.relation || link.parent.relationship || "",
                    idNumber: link.parent.idNumber || "",
                    title: link.parent.title || "",
                    cellNo: link.parent.cellNo || "",
                    cell: link.parent.cellNo || "",
                    phone: link.parent.cellNo || "",
                    email: link.parent.email || "",
                    workNo: link.parent.workNo || "",
                    homeAddress: link.parent.homeAddress || "",
                    notes: link.parent.notes || "",
                    communicationAdministration: link.parent.communicationAdministration ?? true,
                    communicationBilling: link.parent.communicationBilling ?? true,
                    communicationByEmail: link.parent.communicationByEmail ?? true,
                    communicationBySMS: link.parent.communicationBySMS ?? true,
                    communicationByPrint: link.parent.communicationByPrint ?? true,
                    isPayingPerson: link.isPayingPerson ?? false,
                    billingStatement: link.billingStatement ?? true,
                    billingInvoice: link.billingInvoice ?? true,
                    billingReceipt: link.billingReceipt ?? true,
                    isPrimary: link.isPrimary || false,
                })),
                parentName: primary
                    ? `${primary.parent.firstName || ""} ${primary.parent.surname || ""}`.trim()
                    : "",
                parentRelationship: primary?.relation || primary?.parent?.relationship || "",
                parentCell: primary?.parent?.cellNo || "",
                parentEmail: primary?.parent?.email || "",
                billingPlan: billingPlansByLearner[learner.id] || [],
                tuitionFee: learner.tuitionFee ?? 0,
                totalFee: learner.totalFee ?? 0,
            };
        });
        return res.status(200).json({
            success: true,
            learners: result,
        });
    }
    catch (error) {
        console.error("GET REGISTRATION LEARNERS ERROR:", error);
        return res.status(500).json({
            success: false,
            error: "Failed to load registrations",
        });
    }
});
exports.default = router;
