import { Router } from "express";



import { PrismaClient } from "@prisma/client";

import { getSurnamePrefix, resolveLearnerAccountNo } from "../utils/learnerIdentity";
import {
  allocateFamilyAccountRef,
  isFamilyAccountRefCollision,
} from "../services/allocateFamilyAccountRef";
import {
  FinanceAccountBaselineError,
  registerFinanceAccountForLearner,
} from "../services/financeAccountBaseline";
import {
  FamilyAccountMergedError,
  assertFamilyAccountAcceptsNewBillingWrites,
} from "../services/familyAccountLifecycle";
import { normalizeLearnerEnrollmentStatusUpdate } from "../utils/learnerEnrollment";
import { normalizeLearnerGender } from "../utils/learnerGender";
import {
  clearLearnerBillingPlanExplicitlyEmpty,
  markLearnerBillingPlanExplicitlyEmpty,
  readExplicitlyEmptyBillingPlanLearnerIds,
  readLearnerBillingPlanFromDb,
  readSchoolBillingPlansResolved,
  removeLearnerBillingPlanFromDb,
  upsertLearnerBillingPlanToDb,
} from "../services/learnerBillingPlanDbStore";
import {
  buildBillingPlanLookupIndexes,
  removeLearnerBillingPlan,
  resolveLearnerBillingPlanItems,
  upsertLearnerBillingPlan,
  type StoredBillingPlanItem,
} from "../utils/learnerBillingPlanStore";
import { ParentIdConflictError } from "../utils/parentIdConflict";
import { ParentPossibleMatchError } from "../services/applicationParentIdentity";
import { saveParentLinks } from "../services/parentLinkService";
import { assertLearnerCreateAllowed } from "../services/learnerLimitEnforcement";
import { resolveParentStaffAuth } from "../middleware/requireParentStaffAuth";
import {
  CrossSchoolFamilyAccountError,
  LearnerIdentityConflictError,
  alignParentsToCanonicalFamily,
  registerLearner,
  reactivateHistoricalLearner,
  updateLearnerEnrollmentStatus,
} from "../services/learnerRegistrationService";
import { conflictPayload } from "../services/learnerIdentityGuard";
import {
  ALLERGIES_MAX_LENGTH,
  MEDICAL_ALERT_MAX_LENGTH,
  OptionalProfileFieldError,
  formatDateOnlyUtc,
  parseOptionalDateOnlyField,
  parseOptionalTrimmedText,
  resolveAuthoritativeAdmissionDateYmd,
} from "../utils/optionalProfileFields";

const router = Router();



const prisma = new PrismaClient();



function cleanString(value: any) {



  return typeof value === "string" ? value.trim() : "";



}

function parseBillingPlanItemsFromBody(raw: unknown): StoredBillingPlanItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((fee: any) => ({
      feeDescription: String(
        fee?.feeDescription || fee?.description || fee?.name || fee?.title || ""
      ).trim(),
      amount: Number(fee?.amount ?? fee?.price ?? fee?.value ?? 0),
    }))
    .filter((fee: StoredBillingPlanItem) => fee.feeDescription);
}

export function mapParentForClient(link: { parent: any; relation?: string | null; isPrimary?: boolean; isPayingPerson?: boolean; billingStatement?: boolean; billingInvoice?: boolean; billingReceipt?: boolean }) {
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

async function rollbackLearnerRegistration(input: {
  learnerId?: string;
  familyAccountId?: string;
}) {
  const learnerId = String(input.learnerId || "").trim();
  const familyAccountId = String(input.familyAccountId || "").trim();

  if (learnerId) {
    await prisma.learner.delete({ where: { id: learnerId } }).catch(() => undefined);
  }

  if (familyAccountId) {
    const linkedCount = await prisma.learner.count({ where: { familyAccountId } });
    if (linkedCount === 0) {
      await prisma.familyAccount.delete({ where: { id: familyAccountId } }).catch(() => undefined);
    }
  }
}

async function createLearnerOnExistingFamilyAccount({
  schoolId,
  learner,
  familyAccount,
}: {
  schoolId: string;
  learner: any;
  familyAccount: { id: string; accountRef: string; familyName: string; createdAt?: Date };
}) {
  const learnerSurname = cleanString(learner.surname || learner.lastName);
  const accountNo = String(familyAccount.accountRef || "").trim().toUpperCase();

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

  try {
    registerFinanceAccountForLearner({
      schoolId,
      learnerId: newLearner.id,
      familyAccountId: familyAccount.id,
      accountRef: accountNo,
      accountHolder: familyAccount.familyName,
      createdAt: familyAccount.createdAt,
    });
  } catch (error) {
    await rollbackLearnerRegistration({ learnerId: newLearner.id });
    throw error;
  }

  return {
    accountNo,
    familyAccount,
    learner: newLearner,
  };
}

function normaliseParents(body: any) {



  const directParents = Array.isArray(body.parents) ? body.parents : [];



  const learnerParents = Array.isArray(body.learner?.parents) ? body.learner.parents : [];



  const singleParent = body.parent && typeof body.parent === "object" ? [body.parent] : [];



  return [...directParents, ...learnerParents, ...singleParent].filter(



    (p) => p && typeof p === "object"



  );



}



export function mapLearnerDetailForClient(learner: {
  id: string;
  schoolId: string;
  familyAccountId: string | null;
  firstName: string;
  lastName: string;
  birthDate: Date | null;
  gender: string | null;
  idNumber: string | null;
  homeLanguage: string | null;
  citizenship: string | null;
  grade: string;
  className: string | null;
  enrollmentStatus?: string;
  admissionNo: string | null;
  admissionDate?: Date | null;
  allergies?: string | null;
  medicalAlert?: string | null;
  tuitionFee: number;
  transportFee: number;
  otherFee: number;
  totalFee: number;
  createdAt: Date;
  notes?: string | null;
  familyAccount?: { id?: string; accountRef?: string; familyName?: string } | null;
  links?: Array<{
    relation?: string | null;
    isPrimary?: boolean;
    isPayingPerson?: boolean;
    billingStatement?: boolean;
    billingInvoice?: boolean;
    billingReceipt?: boolean;
    parent: any;
  }>;
}) {
  const accountNo = resolveLearnerAccountNo(learner);
  const firstName = learner.firstName || "";
  const lastName = learner.lastName || "";
  const notes = learner.notes || "";
  const enrollmentDate = resolveAuthoritativeAdmissionDateYmd(learner);
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
    gender: normalizeLearnerGender(learner.gender) || learner.gender || "",
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
    admissionDate: formatDateOnlyUtc(learner.admissionDate ?? null),
    enrollmentDate,
    enrolmentDate: enrollmentDate,
    notes,
    tuitionFee: learner.tuitionFee ?? 0,
    transportFee: learner.transportFee ?? 0,
    otherFee: learner.otherFee ?? 0,
    totalFee: learner.totalFee ?? 0,
    createdAt: learner.createdAt,
    parents: learner.links?.map((link) => mapParentForClient(link)) || [],
  };
}

/** Authenticated staff-only medical + parent DOB for Manage Learner (not on legacy unauth GETs). */
router.get("/:id/sensitive-fields", async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.learner.findUnique({
      where: { id },
      select: { schoolId: true },
    });
    if (!existing) {
      return res.status(404).json({ success: false, error: "Learner not found" });
    }

    const authDecision = await resolveParentStaffAuth(req, {
      requestSchoolId: existing.schoolId,
      requirePermission: { module: "learners", action: "view" },
    });
    if (!authDecision.allowed) {
      return res.status(authDecision.status).json({
        success: false,
        error: authDecision.error,
        code: authDecision.code || null,
        message: authDecision.error,
      });
    }
    if (existing.schoolId !== authDecision.auth.authorizedSchoolId) {
      return res.status(403).json({
        success: false,
        error: "Learner is not in your school",
        code: "SCHOOL_MISMATCH",
      });
    }

    const learner = await prisma.learner.findUnique({
      where: { id },
      include: {
        links: { include: { parent: true } },
      },
    });
    if (!learner) {
      return res.status(404).json({ success: false, error: "Learner not found" });
    }

    return res.json({
      success: true,
      allergies: learner.allergies || "",
      medicalAlert: learner.medicalAlert || "",
      parents: (learner.links || []).map((link) => ({
        id: link.parent.id,
        birthDate: formatDateOnlyUtc(link.parent.birthDate ?? null),
        dateOfBirth: formatDateOnlyUtc(link.parent.birthDate ?? null),
      })),
    });
  } catch (error) {
    console.error("Error fetching learner sensitive fields:", error);
    return res.status(500).json({ success: false, error: "Failed to fetch sensitive fields" });
  }
});

router.put("/:id/sensitive-fields", async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.learner.findUnique({
      where: { id },
      select: { schoolId: true },
    });
    if (!existing) {
      return res.status(404).json({ success: false, error: "Learner not found" });
    }

    const authDecision = await resolveParentStaffAuth(req, {
      requestSchoolId: existing.schoolId,
      requirePermission: { module: "learners", action: "edit" },
    });
    if (!authDecision.allowed) {
      return res.status(authDecision.status).json({
        success: false,
        error: authDecision.error,
        code: authDecision.code || null,
        message: authDecision.error,
      });
    }
    if (existing.schoolId !== authDecision.auth.authorizedSchoolId) {
      return res.status(403).json({
        success: false,
        error: "Learner is not in your school",
        code: "SCHOOL_MISMATCH",
      });
    }

    const data: { allergies?: string | null; medicalAlert?: string | null } = {};
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "allergies")) {
      data.allergies = parseOptionalTrimmedText(req.body.allergies, {
        maxLength: ALLERGIES_MAX_LENGTH,
        fieldLabel: "allergies",
      });
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "medicalAlert")) {
      data.medicalAlert = parseOptionalTrimmedText(req.body.medicalAlert, {
        maxLength: MEDICAL_ALERT_MAX_LENGTH,
        fieldLabel: "medicalAlert",
      });
    }
    if (Object.keys(data).length === 0) {
      return res.status(400).json({ success: false, error: "No sensitive fields to update" });
    }

    const updated = await prisma.learner.update({
      where: { id },
      data,
      select: { id: true, allergies: true, medicalAlert: true },
    });

    return res.json({
      success: true,
      allergies: updated.allergies || "",
      medicalAlert: updated.medicalAlert || "",
    });
  } catch (error) {
    console.error("Error updating learner sensitive fields:", error);
    if (error instanceof OptionalProfileFieldError) {
      return res.status(400).json({ success: false, error: error.message });
    }
    return res.status(500).json({ success: false, error: "Failed to update sensitive fields" });
  }
});

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

    const accountNo = resolveLearnerAccountNo(learner);
    let billingPlansByLearner: Awaited<ReturnType<typeof readSchoolBillingPlansResolved>> = {};
    try {
      billingPlansByLearner = await readSchoolBillingPlansResolved(learner.schoolId);
    } catch (billingErr) {
      console.error("[GET /api/learners/:id] billingPlans read failed", billingErr);
    }
    const explicitlyEmptyLearnerIds = await readExplicitlyEmptyBillingPlanLearnerIds(
      learner.schoolId
    );
    const billingPlanIndexes = buildBillingPlanLookupIndexes(billingPlansByLearner, [
      {
        id: learner.id,
        admissionNo: learner.admissionNo || accountNo,
        idNumber: learner.idNumber,
      },
    ]);
    const billingPlan = resolveLearnerBillingPlanItems(
      {
        id: learner.id,
        admissionNo: learner.admissionNo || accountNo,
        idNumber: learner.idNumber,
      },
      billingPlansByLearner,
      billingPlanIndexes,
      explicitlyEmptyLearnerIds
    );

    return res.status(200).json({
      success: true,
      billingPlan,
      learner: {
        ...mapLearnerDetailForClient(learner),
        billingPlan,
      },
    });
  } catch (error) {
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



    const includeHistorical =
      String(req.query.includeHistorical || "").toLowerCase() === "true";

    let billingPlansByLearner: Awaited<ReturnType<typeof readSchoolBillingPlansResolved>> = {};
    try {
      billingPlansByLearner = await readSchoolBillingPlansResolved(String(schoolId));
    } catch (billingErr) {
      console.error("[GET /api/learners] billingPlans read failed", billingErr);
    }

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

    const explicitlyEmptyLearnerIds = await readExplicitlyEmptyBillingPlanLearnerIds(
      String(schoolId)
    );
    const billingPlanIndexes = buildBillingPlanLookupIndexes(billingPlansByLearner, [
      ...learners.map((l) => ({
        id: l.id,
        admissionNo: l.admissionNo,
        idNumber: l.idNumber,
      })),
    ]);

    const learnersWithParents = learners.map((learner) => {



      const accountNo = resolveLearnerAccountNo(learner);
      const billingPlan = resolveLearnerBillingPlanItems(
        {
          id: learner.id,
          admissionNo: learner.admissionNo || accountNo,
          idNumber: learner.idNumber,
        },
        billingPlansByLearner,
        billingPlanIndexes,
        explicitlyEmptyLearnerIds
      );

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

        gender: normalizeLearnerGender(learner.gender) || learner.gender || "",

        enrollmentStatus: learner.enrollmentStatus,

        homeLanguage: learner.homeLanguage || "",

        citizenship: learner.citizenship || "",

        idNumber: learner.idNumber || "",



        grade: learner.grade || "",



        className: learner.className || "",



        classroom: learner.className || "",



        classroomName: learner.className || "",

        admissionDate: formatDateOnlyUtc(learner.admissionDate ?? null),
        enrollmentDate: resolveAuthoritativeAdmissionDateYmd(learner),
        enrolmentDate: resolveAuthoritativeAdmissionDateYmd(learner),



        admissionNo: learner.admissionNo || accountNo,



        tuitionFee: learner.tuitionFee || 0,



        transportFee: learner.transportFee || 0,



        otherFee: learner.otherFee || 0,



        totalFee: learner.totalFee || 0,



        createdAt: learner.createdAt,



        parents: learner.links?.map((link) => mapParentForClient(link)) || [],

        billingPlan,

      };



    });

    return res.status(200).json({



      success: true,



      learners: learnersWithParents,



    });



  } catch (error) {



    console.error("GET LEARNERS ERROR:", error);



    return res.status(500).json({



      success: false,



      error: "Failed to fetch learners",



    });



  }



});



async function createLearnerWithAccount({
  schoolId,
  learner,
}: {
  schoolId: string;
  learner: any;
}) {
  const learnerSurname = cleanString(learner.surname || learner.lastName);

  let familyAccount: {
    id: string;
    accountRef: string;
    accountNo: string | null;
    familyName: string;
    createdAt: Date;
  } | null = null;
  let accountNo = "";
  let newLearner: Awaited<ReturnType<typeof prisma.learner.create>> | null = null;

  for (let attempt = 0; attempt < 5; attempt++) {
    accountNo = await allocateFamilyAccountRef(schoolId, learnerSurname);
    try {
      familyAccount = await prisma.familyAccount.create({
        data: {
          schoolId,
          accountRef: accountNo,
          accountNo,
          familyName: learnerSurname,
        },
      });
      break;
    } catch (error) {
      if (isFamilyAccountRefCollision(error)) continue;
      throw error;
    }
  }

  if (!familyAccount) {
    throw new Error(
      `Failed to create family account for surname prefix ${getSurnamePrefix(learnerSurname)}`
    );
  }

  try {
    newLearner = await prisma.learner.create({
      data: {
        schoolId,
        familyAccountId: familyAccount.id,
        firstName: cleanString(learner.firstName),
        lastName: learnerSurname,
        birthDate: learner.birthDate ? new Date(learner.birthDate) : null,
        gender: cleanString(learner.gender),
        idNumber: cleanString(learner.idNumber) || null,
        grade: cleanString(learner.grade),
        className:
          cleanString(learner.className || learner.classroom || learner.classroomName) || null,
        admissionNo: accountNo,
        tuitionFee: Number(learner.tuitionFee) || 0,
        transportFee: Number(learner.transportFee) || 0,
        otherFee: Number(learner.otherFee) || 0,
        totalFee: Number(learner.totalFee) || 0,
      },
    });

    registerFinanceAccountForLearner({
      schoolId,
      learnerId: newLearner.id,
      familyAccountId: familyAccount.id,
      accountRef: accountNo,
      accountHolder: familyAccount.familyName,
      createdAt: familyAccount.createdAt,
    });
  } catch (error) {
    await rollbackLearnerRegistration({
      learnerId: newLearner?.id,
      familyAccountId: familyAccount.id,
    });
    throw error;
  }

  return {
    accountNo,
    familyAccount,
    learner: newLearner,
  };
}

router.post("/", async (req, res) => {



  try {

    const authDecision = await resolveParentStaffAuth(req, {
      requirePermission: { module: "learners", action: "create" },
    });
    if (!authDecision.allowed) {
      return res.status(authDecision.status).json({
        success: false,
        error: authDecision.error,
        code: authDecision.code || null,
        message: authDecision.error,
      });
    }
    const staffAuth = authDecision.auth;



    const learner = req.body.learner || req.body;



    if (!learner) {



      return res.status(400).json({



        success: false,



        error: "Missing learner data",



      });



    }



    const requestedSchoolId = cleanString(learner.schoolId || req.body.schoolId);
    if (!requestedSchoolId) {
      return res.status(400).json({
        success: false,
        error: "Missing schoolId",
      });
    }
    if (requestedSchoolId !== staffAuth.authorizedSchoolId) {
      return res.status(403).json({
        success: false,
        error: "Request schoolId does not match authenticated school",
        code: "SCHOOL_MISMATCH",
      });
    }

    const school = await prisma.school.findUnique({
      where: { id: staffAuth.authorizedSchoolId },
    });



    if (!school) {
      return res.status(400).json({
        success: false,
        error: "No school found for authenticated user.",
      });
    }

    const learnerLimitGate = await assertLearnerCreateAllowed(school.id);
    if (!learnerLimitGate.allowed) {
      return res.status(learnerLimitGate.status).json({
        success: false,
        error: learnerLimitGate.error,
        code: learnerLimitGate.code,
        learnerCapacity: {
          learnerLimit: learnerLimitGate.capacity.learnerLimit,
          activeLearnerCount: learnerLimitGate.capacity.activeLearnerCount,
          commercialPackageCode: learnerLimitGate.capacity.commercialPackageCode,
          learnerCapacityLabel: learnerLimitGate.capacity.learnerCapacityLabel,
        },
      });
    }



    const existingFamilyAccountId = cleanString(
      req.body.existingFamilyAccountId ||
        req.body.familyAccountId ||
        learner.existingFamilyAccountId ||
        learner.familyAccountId
    );

    const main = await registerLearner({
      schoolId: school.id,
      learner: {
        ...learner,
        schoolId: school.id,
      },
      existingFamilyAccountId: existingFamilyAccountId || null,
    });



    const parents = normaliseParents(req.body);



    await saveParentLinks({



      schoolId: school.id,



      learnerId: main.learner.id,



      familyAccountId: main.familyAccount.id,



      parents,



      trustedIsOwnerAdmin: staffAuth.isOwnerAdmin,



    });
    await alignParentsToCanonicalFamily({
      schoolId: school.id,
      learnerIds: [main.learner.id],
      canonicalFamilyAccountId: main.familyAccount.id,
    });



    const siblings = Array.isArray(req.body.siblings) ? req.body.siblings : [];



    const createdSiblings = [];



    for (const sibling of siblings) {



      const siblingFirstName = cleanString(sibling.firstName);



      const siblingSurname = cleanString(sibling.surname || sibling.lastName);



      const siblingGrade = cleanString(sibling.grade);



      if (!siblingFirstName || !siblingSurname || !siblingGrade) continue;



      const createdSibling = await registerLearner({
        schoolId: school.id,
        learner: {
          ...sibling,
          schoolId: school.id,
          firstName: siblingFirstName,
          lastName: siblingSurname,
          grade: siblingGrade,
        },
        existingFamilyAccountId: main.familyAccount.id,
      });



      await saveParentLinks({



        schoolId: school.id,



        learnerId: createdSibling.learner.id,



        familyAccountId: createdSibling.familyAccount.id,



        parents,



        trustedIsOwnerAdmin: staffAuth.isOwnerAdmin,



      });
      await alignParentsToCanonicalFamily({
        schoolId: school.id,
        learnerIds: [createdSibling.learner.id],
        canonicalFamilyAccountId: createdSibling.familyAccount.id,
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



      createdNewFamilyAccount: main.createdNewFamilyAccount,



      learnerId: main.learner.id,



      learner: {



        ...main.learner,



        accountNo: main.accountNo,



        accountNumber: main.accountNo,



      },



      siblings: createdSiblings,



    });



  } catch (error) {
    console.error("SAVE LEARNER ERROR:", error);

    if (error instanceof ParentIdConflictError) {
      return res.status(409).json(error.body);
    }
    if (error instanceof ParentPossibleMatchError) {
      return res.status(409).json(error.body);
    }
    if (error instanceof LearnerIdentityConflictError) {
      return res.status(409).json(conflictPayload(error));
    }
    if (error instanceof CrossSchoolFamilyAccountError) {
      return res.status(400).json({ success: false, error: error.message, code: error.code });
    }
    const err = error as { statusCode?: number; code?: string; message?: string };
    if (err?.statusCode === 403 || err?.statusCode === 404) {
      return res.status(err.statusCode).json({
        success: false,
        error: err.message || "Forbidden",
        code: err.code || null,
        message: err.message || "Forbidden",
      });
    }

    if (error instanceof FinanceAccountBaselineError) {
      return res.status(500).json({
        success: false,
        error: error.message,
        code: error.code,
        schoolId: error.schoolId,
        accountRef: error.accountRef,
        learnerId: error.learnerId,
        familyAccountId: error.familyAccountId,
      });
    }

    return res.status(500).json({
      success: false,
      error: "Failed to save learner",
    });
  }



});



router.patch("/:id/billing-plan", async (req, res) => {
  try {
    const authDecision = await resolveParentStaffAuth(req, {
      requirePermission: { module: "billingPlans", action: "edit" },
    });
    if (!authDecision.allowed) {
      return res.status(authDecision.status).json({
        success: false,
        error: authDecision.error,
        code: authDecision.code || null,
        message: authDecision.error,
      });
    }
    const staffAuth = authDecision.auth;
    const { id } = req.params;

    // Client schoolId is optional; JWT authorizedSchoolId is authoritative.
    const bodySchoolId = cleanString(req.body?.schoolId);
    const querySchoolId = cleanString(req.query?.schoolId);
    if (
      (bodySchoolId && bodySchoolId !== staffAuth.authorizedSchoolId) ||
      (querySchoolId && querySchoolId !== staffAuth.authorizedSchoolId)
    ) {
      return res.status(403).json({
        success: false,
        error: "Request schoolId does not match authenticated school",
        code: "SCHOOL_MISMATCH",
      });
    }

    const learner = await prisma.learner.findFirst({
      where: { id, schoolId: staffAuth.authorizedSchoolId },
      select: {
        id: true,
        schoolId: true,
        familyAccountId: true,
        familyAccount: { select: { accountRef: true } },
      },
    });

    if (!learner) {
      return res.status(404).json({ success: false, error: "Learner not found" });
    }

    try {
      await assertFamilyAccountAcceptsNewBillingWrites({
        schoolId: learner.schoolId,
        familyAccountId: learner.familyAccountId || undefined,
        accountRef: learner.familyAccount?.accountRef,
      });
    } catch (error) {
      if (error instanceof FamilyAccountMergedError) {
        return res.status(409).json({
          success: false,
          error: error.message,
          errorCode: error.errorCode,
        });
      }
      throw error;
    }

    if (!Array.isArray(req.body?.billingPlan)) {
      return res.status(400).json({ success: false, error: "billingPlan array required" });
    }

    const linesBefore = (
      await readLearnerBillingPlanFromDb(learner.schoolId, learner.id)
    ).length;
    const items = parseBillingPlanItemsFromBody(req.body.billingPlan);

    if (items.length === 0) {
      await removeLearnerBillingPlanFromDb(learner.schoolId, learner.id);
      removeLearnerBillingPlan(learner.schoolId, learner.id);
      await markLearnerBillingPlanExplicitlyEmpty(learner.schoolId, learner.id);
    } else {
      await upsertLearnerBillingPlanToDb(learner.schoolId, learner.id, items);
      upsertLearnerBillingPlan(learner.schoolId, learner.id, items);
      await clearLearnerBillingPlanExplicitlyEmpty(learner.schoolId, learner.id);
    }

    const billingPlan = await readLearnerBillingPlanFromDb(learner.schoolId, learner.id);

    console.log(
      `[billing-plan] PATCH learnerId=${learner.id} schoolId=${learner.schoolId} linesBefore=${linesBefore} linesAfter=${billingPlan.length} explicitlyEmpty=${items.length === 0}`
    );

    return res.json({ success: true, billingPlan });
  } catch (error) {
    console.error("[billing-plan] PATCH failed", error);
    return res.status(500).json({ success: false, error: "Failed to update billing plan" });
  }
});

router.patch("/:id/enrollment-status", async (req, res) => {
  try {
    const authDecision = await resolveParentStaffAuth(req, {
      requirePermission: { module: "learners", action: "edit" },
    });
    if (!authDecision.allowed) {
      return res.status(authDecision.status).json({
        success: false,
        error: authDecision.error,
        code: authDecision.code || null,
        message: authDecision.error,
      });
    }
    const staffAuth = authDecision.auth;
    const { id } = req.params;
    // Client schoolId is optional; JWT authorizedSchoolId is authoritative.
    // If body and/or query supply schoolId, neither may contradict the JWT school.
    const bodySchoolId = cleanString(req.body?.schoolId);
    const querySchoolId = cleanString(req.query?.schoolId);
    if (
      (bodySchoolId && bodySchoolId !== staffAuth.authorizedSchoolId) ||
      (querySchoolId && querySchoolId !== staffAuth.authorizedSchoolId)
    ) {
      return res.status(403).json({
        success: false,
        error: "Request schoolId does not match authenticated school",
        code: "SCHOOL_MISMATCH",
      });
    }

    const updatedLearner = await updateLearnerEnrollmentStatus({
      schoolId: staffAuth.authorizedSchoolId,
      learnerId: id,
      enrollmentStatus: req.body?.enrollmentStatus,
    });

    return res.json({
      success: true,
      learner: mapLearnerDetailForClient(updatedLearner),
    });
  } catch (error) {
    console.error("UPDATE LEARNER ENROLLMENT STATUS ERROR:", error);
    const message = error instanceof Error ? error.message : "Failed to update learner enrollment status";
    const status = /not found/i.test(message) ? 404 : 400;
    return res.status(status).json({
      success: false,
      error: message,
    });
  }
});

router.post("/:id/reactivate", async (req, res) => {
  try {
    const authDecision = await resolveParentStaffAuth(req, {
      requirePermission: { module: "learners", action: "create" },
    });
    if (!authDecision.allowed) {
      return res.status(authDecision.status).json({
        success: false,
        error: authDecision.error,
        code: authDecision.code || null,
        message: authDecision.error,
      });
    }
    const staffAuth = authDecision.auth;
    const { id } = req.params;
    const schoolId = cleanString(req.body?.schoolId || req.query?.schoolId);
    if (!schoolId) {
      return res.status(400).json({ success: false, error: "Missing schoolId" });
    }
    if (schoolId !== staffAuth.authorizedSchoolId) {
      return res.status(403).json({
        success: false,
        error: "Request schoolId does not match authenticated school",
        code: "SCHOOL_MISMATCH",
      });
    }
    const learnerLimitGate = await assertLearnerCreateAllowed(schoolId);
    if (!learnerLimitGate.allowed) {
      return res.status(learnerLimitGate.status).json({
        success: false,
        error: learnerLimitGate.error,
        code: learnerLimitGate.code,
        learnerCapacity: {
          learnerLimit: learnerLimitGate.capacity.learnerLimit,
          activeLearnerCount: learnerLimitGate.capacity.activeLearnerCount,
          commercialPackageCode: learnerLimitGate.capacity.commercialPackageCode,
          learnerCapacityLabel: learnerLimitGate.capacity.learnerCapacityLabel,
        },
      });
    }
    const updatedLearner = await reactivateHistoricalLearner({
      schoolId,
      learnerId: id,
      familyAccountId: req.body?.familyAccountId || req.body?.existingFamilyAccountId || null,
    });
    return res.json({
      success: true,
      learner: mapLearnerDetailForClient(updatedLearner),
    });
  } catch (error) {
    console.error("REACTIVATE LEARNER ERROR:", error);
    if (error instanceof CrossSchoolFamilyAccountError) {
      return res.status(400).json({ success: false, error: error.message, code: error.code });
    }
    const message = error instanceof Error ? error.message : "Failed to reactivate learner";
    const status = /not found/i.test(message) ? 404 : 400;
    return res.status(status).json({ success: false, error: message });
  }
});

router.put("/:id", async (req, res) => {



  try {



    const { id } = req.params;

    const hasParentsPayload =
      Array.isArray(req.body?.parents) ||
      Array.isArray(req.body?.learner?.parents) ||
      (req.body?.parent && typeof req.body.parent === "object");

    // SEC-02B: every generic PUT mutation requires learners.edit + JWT school bind.
    // Parents presence never decides whether authentication is required.
    const authDecision = await resolveParentStaffAuth(req, {
      requirePermission: { module: "learners", action: "edit" },
    });
    if (!authDecision.allowed) {
      return res.status(authDecision.status).json({
        success: false,
        error: authDecision.error,
        code: authDecision.code || null,
        message: authDecision.error,
      });
    }
    const staffAuth = authDecision.auth;
    const trustedIsOwnerAdmin = staffAuth.isOwnerAdmin;
    const authorizedSchoolId = staffAuth.authorizedSchoolId;

    if (hasParentsPayload && !staffAuth.canEditParents) {
      return res.status(403).json({
        success: false,
        error: "Permission denied: parents.edit",
        code: "FORBIDDEN_PERMISSION",
        message: "Permission denied: parents.edit",
      });
    }

    // Generic PUT must not mutate billing plans — dedicated PATCH /:id/billing-plan.
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "billingPlan")) {
      return res.status(400).json({
        success: false,
        error:
          "billingPlan must be updated via PATCH /api/learners/:id/billing-plan",
        code: "USE_BILLING_PLAN_ENDPOINT",
      });
    }

    const {



      firstName,



      lastName,



      surname,



      birthDate,



      gender,



      idNumber,



      grade,



      className,



      classroom,



      classroomName,



      admissionNo,



      tuitionFee,



      transportFee,



      otherFee,



      totalFee,

      admissionDate,
      enrolmentDate,
      enrollmentDate,
      allergies,
      medicalAlert,

    } = req.body;



    const existingLearner = await prisma.learner.findFirst({



      where: { id, schoolId: authorizedSchoolId },



    });



    if (!existingLearner) {



      return res.status(404).json({



        success: false,



        error: "Learner not found",



      });



    }

    // Medical fields must not be writable via legacy PUT.
    // Use PUT /api/learners/:id/sensitive-fields instead.
    if (allergies !== undefined || medicalAlert !== undefined) {
      return res.status(400).json({
        success: false,
        error:
          "allergies and medicalAlert must be updated via PUT /api/learners/:id/sensitive-fields",
        code: "USE_SENSITIVE_FIELDS_ENDPOINT",
      });
    }
    let parsedAdmissionDate: Date | null | undefined = undefined;
    if (admissionDate !== undefined || enrolmentDate !== undefined || enrollmentDate !== undefined) {
      parsedAdmissionDate = parseOptionalDateOnlyField(
        admissionDate ?? enrolmentDate ?? enrollmentDate,
        "admissionDate"
      );
    }



    const updatedLearner = await prisma.learner.update({



      where: { id: existingLearner.id },



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

        ...(parsedAdmissionDate !== undefined && { admissionDate: parsedAdmissionDate }),



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

    // Only rewrite parent rows when the client explicitly sent a parents payload.
    // Learner-only updates must not touch Parent.idNumber / Parent.email.
    if (hasParentsPayload) {
      await saveParentLinks({
        schoolId: updatedLearner.schoolId,
        learnerId: updatedLearner.id,
        familyAccountId: updatedLearner.familyAccountId,
        parents,
        trustedIsOwnerAdmin,
      });
    }

    // Read-only: generic PUT no longer writes billing plan lines (SEC-02B).
    const billingPlan = await readLearnerBillingPlanFromDb(
      updatedLearner.schoolId,
      updatedLearner.id
    );



    const refreshedLearner = await prisma.learner.findUnique({



      where: { id: existingLearner.id },



      include: {



        familyAccount: true,



        links: {



          include: {



            parent: true,



          },



        },



      },



    });



    if (!refreshedLearner) {
      return res.status(500).json({ success: false, error: "Failed to refresh learner" });
    }

    return res.json({
      success: true,
      billingPlan,
      learner: {
        ...mapLearnerDetailForClient(refreshedLearner),
        billingPlan,
        parents: refreshedLearner.links?.map((link) => mapParentForClient(link)) || [],
      },
    });



  } catch (error) {



    console.error("UPDATE LEARNER ERROR:", error);

    if (error instanceof ParentIdConflictError) {
      return res.status(409).json(error.body);
    }
    if (error instanceof ParentPossibleMatchError) {
      return res.status(409).json(error.body);
    }
    const err = error as { statusCode?: number; code?: string; message?: string };
    if (err?.statusCode === 403 || err?.statusCode === 404) {
      return res.status(err.statusCode).json({
        success: false,
        error: err.message || "Forbidden",
        code: err.code || null,
        message: err.message || "Forbidden",
      });
    }

    if (error instanceof OptionalProfileFieldError) {
      return res.status(400).json({ success: false, error: error.message, message: error.message });
    }



    return res.status(500).json({



      success: false,



      error: "Failed to update learner",



    });



  }



});



export default router;