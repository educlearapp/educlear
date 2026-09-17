import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../prisma";
import {
  applyParentIdentityPreservationForUpdate,
  parentIdentityForCreate,
} from "../utils/parentIdentityPreservation";
import {
  buildParentIdConflictBody,
  isParentIdNumberUniqueTarget,
  ParentIdConflictError,
} from "../utils/parentIdConflict";
import {
  checkApplicationParentIdentity,
  ParentPossibleMatchError,
  requiresExplicitCreateConfirmation,
} from "./applicationParentIdentity";
import { parseOptionalDateOnlyField } from "../utils/optionalProfileFields";

type Db = PrismaClient | Prisma.TransactionClient;

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanBool(value: unknown, fallback: boolean) {
  if (value === undefined || value === null) return fallback;
  return Boolean(value);
}

export function buildParentWriteData(
  rawParent: Record<string, unknown>,
  schoolId: string,
  familyAccountId?: string | null
) {
  const firstName = cleanString(rawParent.firstName || rawParent.name) || "Parent";
  const surname = cleanString(rawParent.surname || rawParent.lastName) || "-";
  const cellNo = cleanString(
    rawParent.cellNo || rawParent.cell || rawParent.phone || rawParent.mobile
  );
  const identity = parentIdentityForCreate(rawParent);
  const relationship = cleanString(rawParent.relationship || rawParent.relation);
  let birthDate: Date | null | undefined = undefined;
  if (rawParent.birthDate !== undefined || rawParent.dateOfBirth !== undefined) {
    birthDate = parseOptionalDateOnlyField(
      rawParent.birthDate ?? rawParent.dateOfBirth,
      "birthDate"
    );
  }
  return {
    schoolId,
    familyAccountId: familyAccountId || null,
    relationship: relationship || null,
    title: cleanString(rawParent.title) || null,
    firstName,
    surname,
    idNumber: identity.idNumber,
    ...(birthDate !== undefined ? { birthDate } : {}),
    cellNo: cellNo || "-",
    workNo: cleanString(rawParent.workNo || rawParent.work || rawParent.workPhone) || null,
    homeAddress: cleanString(rawParent.homeAddress) || null,
    homeNo: cleanString(rawParent.homeNo) || null,
    notes: cleanString(rawParent.notes) || null,
    email: identity.email,
    communicationAdministration: cleanBool(
      rawParent.communicationAdministration ?? rawParent.administrationCommunications,
      true
    ),
    communicationBilling: cleanBool(
      rawParent.communicationBilling ?? rawParent.billingCommunications,
      true
    ),
    communicationByEmail: cleanBool(rawParent.communicationByEmail, true),
    communicationByPrint: cleanBool(rawParent.communicationByPrint, true),
    communicationBySMS: cleanBool(rawParent.communicationBySMS, true),
  };
}

export function buildLinkWriteData(rawParent: Record<string, unknown>) {
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

export async function saveParentLinks({
  schoolId,
  learnerId,
  familyAccountId,
  parents,
  trustedIsOwnerAdmin,
  db = prisma,
}: {
  schoolId: string;
  learnerId: string;
  familyAccountId?: string | null;
  parents: Record<string, unknown>[];
  /** Server-derived Owner/Admin only — never from client role fields. */
  trustedIsOwnerAdmin: boolean;
  db?: Db;
}) {
  for (const rawParent of parents) {
    const parentData = buildParentWriteData(rawParent, schoolId, familyAccountId);
    const linkData = buildLinkWriteData(rawParent);
    const idNumber = cleanString(rawParent.idNumber);
    const existingParentId =
      rawParent.id && !String(rawParent.id).startsWith("local-parent-")
        ? String(rawParent.id).trim()
        : "";

    if (
      !parentData.firstName &&
      parentData.surname === "-" &&
      parentData.cellNo === "-" &&
      !parentData.email &&
      !idNumber
    ) {
      continue;
    }

    let parent = null;

    try {
      if (existingParentId) {
        const owned = await db.parent.findFirst({
          where: { id: existingParentId, schoolId },
          select: { id: true },
        });
        if (!owned) {
          throw Object.assign(new Error("Parent not found in this school"), {
            statusCode: 404,
            code: "PARENT_NOT_FOUND",
          });
        }

        const identityCheck = await checkApplicationParentIdentity({
          prisma: db,
          schoolId,
          incoming: {
            firstName: parentData.firstName,
            surname: parentData.surname,
            idNumber: rawParent.idNumber as string | null | undefined,
            cellNo: parentData.cellNo,
            email: rawParent.email as string | null | undefined,
            relationship: parentData.relationship,
          },
          excludeParentId: existingParentId,
          actorIsOwnerAdmin: trustedIsOwnerAdmin,
        });
        if (identityCheck.decision === "EXISTING_PARENT_MATCH") {
          const body = identityCheck.existingParent
            ? {
                success: false as const,
                code: "PARENT_ID_ALREADY_EXISTS" as const,
                message: identityCheck.message,
                idNumber: idNumber || String(identityCheck.existingParent.idNumber || ""),
                existingParent: identityCheck.existingParent,
              }
            : await buildParentIdConflictBody(db, idNumber || "", schoolId);
          throw new ParentIdConflictError(body);
        }

        const updateData = applyParentIdentityPreservationForUpdate(parentData, rawParent);
        delete (updateData as { familyAccountId?: unknown }).familyAccountId;
        parent = await db.parent.update({
          where: { id: existingParentId },
          data: updateData,
        });
      } else {
        const confirmCreateDespiteMatch = Boolean(
          rawParent.confirmCreateDespiteMatch === true ||
            rawParent.confirmCreateDespiteMatch === "true"
        );
        const identityCheck = await checkApplicationParentIdentity({
          prisma: db,
          schoolId,
          incoming: {
            firstName: parentData.firstName,
            surname: parentData.surname,
            idNumber: rawParent.idNumber as string | null | undefined,
            cellNo: parentData.cellNo,
            email: rawParent.email as string | null | undefined,
            relationship: parentData.relationship,
          },
          excludeParentId: null,
          actorIsOwnerAdmin: trustedIsOwnerAdmin,
        });

        if (identityCheck.decision === "EXISTING_PARENT_MATCH") {
          const body = identityCheck.existingParent
            ? {
                success: false as const,
                code: "PARENT_ID_ALREADY_EXISTS" as const,
                message: identityCheck.message,
                idNumber: idNumber || String(identityCheck.existingParent.idNumber || ""),
                existingParent: identityCheck.existingParent,
              }
            : await buildParentIdConflictBody(db, idNumber || "", schoolId);
          throw new ParentIdConflictError(body);
        }

        if (
          identityCheck.decision === "POSSIBLE_MATCH" &&
          requiresExplicitCreateConfirmation(identityCheck)
        ) {
          if (!confirmCreateDespiteMatch) {
            throw new ParentPossibleMatchError(identityCheck);
          }
          if (!trustedIsOwnerAdmin) {
            throw Object.assign(
              new Error("Only Owner/Admin may create a parent despite a strong possible match."),
              {
                statusCode: 403,
                code: "FORBIDDEN_CREATE_DESPITE_MATCH",
              }
            );
          }
        }

        parent = await db.parent.create({
          data: parentData,
        });
      }
    } catch (error: unknown) {
      if (error instanceof ParentIdConflictError || error instanceof ParentPossibleMatchError) {
        throw error;
      }
      if (isParentIdNumberUniqueTarget(error)) {
        const conflictId =
          idNumber || cleanString((rawParent as { idNumber?: unknown }).idNumber) || "";
        const body = await buildParentIdConflictBody(db, conflictId, schoolId);
        throw new ParentIdConflictError(body);
      }
      throw error;
    }

    await db.parentLearnerLink.upsert({
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
