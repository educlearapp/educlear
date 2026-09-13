/**
 * Staff Admissions workflow mutations (OA-03G).
 * Action-oriented transitions — never accept arbitrary status from the client.
 * No Learner / Parent / FamilyAccount / billing side effects.
 */
import type {
  AdmissionApplicationStatus,
  AdmissionPaymentStatus,
  Prisma,
  PrismaClient,
} from "@prisma/client";

import {
  findInformationSuppliedForCycle,
  getCurrentInfoRequestCycle,
} from "./applicantInfoResponseService";
import {
  canAdministerAdmissionPayment,
  canMakeAdmissionDecision,
} from "./admissionsDecisionAuth";
import { gradeIsAccepted } from "./resolvePublicAdmissions";
import {
  deriveDocumentCompleteness,
  getStaffApplicationDetail,
  parseRequiredDocumentTypes,
  StaffAdmissionsError,
  type StaffApplicationDetail,
} from "./staffAdmissionsReadService";
import { validateApplicationForSubmit } from "./submitApplicationService";

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export type StaffWorkflowActor = {
  userId: string;
  schoolId: string;
  appRole: string;
  hasAdmissionsEdit: boolean;
  hasAdmissionsManage: boolean;
};

export type WorkflowActionResult = {
  application: StaffApplicationDetail;
  action: string;
  idempotent: boolean;
};

const TERMINAL_APP = new Set<AdmissionApplicationStatus>([
  "ACCEPTED",
  "DECLINED",
  "WITHDRAWN",
  "CANCELLED",
]);

/** Pure transition policy for unit tests. */
export function assertApplicationTransition(
  from: AdmissionApplicationStatus | string,
  action:
    | "start_review"
    | "request_info"
    | "resume_review"
    | "accept"
    | "reject"
): { allowed: boolean; to?: AdmissionApplicationStatus; code?: string } {
  const status = String(from) as AdmissionApplicationStatus;

  // Idempotent terminal re-reads (same final decision only)
  if (status === "ACCEPTED" && action === "accept") {
    return { allowed: true, to: "ACCEPTED" };
  }
  if (status === "DECLINED" && action === "reject") {
    return { allowed: true, to: "DECLINED" };
  }

  if (TERMINAL_APP.has(status)) {
    return { allowed: false, code: "APPLICATION_TERMINAL" };
  }
  switch (action) {
    case "start_review":
      if (status === "UNDER_REVIEW") return { allowed: true, to: "UNDER_REVIEW" }; // idempotent
      if (status === "SUBMITTED") return { allowed: true, to: "UNDER_REVIEW" };
      return { allowed: false, code: "INVALID_TRANSITION" };
    case "request_info":
      if (status === "INFO_REQUESTED") return { allowed: true, to: "INFO_REQUESTED" };
      if (status === "SUBMITTED" || status === "UNDER_REVIEW") {
        return { allowed: true, to: "INFO_REQUESTED" };
      }
      return { allowed: false, code: "INVALID_TRANSITION" };
    case "resume_review":
      if (status === "UNDER_REVIEW") return { allowed: true, to: "UNDER_REVIEW" };
      if (status === "INFO_REQUESTED") return { allowed: true, to: "UNDER_REVIEW" };
      return { allowed: false, code: "INVALID_TRANSITION" };
    case "accept":
    case "reject":
      if (status === "UNDER_REVIEW") {
        return { allowed: true, to: action === "accept" ? "ACCEPTED" : "DECLINED" };
      }
      return { allowed: false, code: "INVALID_TRANSITION" };
    default:
      return { allowed: false, code: "INVALID_TRANSITION" };
  }
}

export function assertPaymentTransition(
  from: AdmissionPaymentStatus | string,
  action: "verify" | "reject_pop" | "waive"
): { allowed: boolean; to?: AdmissionPaymentStatus; code?: string } {
  const status = String(from) as AdmissionPaymentStatus;
  if (status === "NOT_REQUIRED") {
    return { allowed: false, code: "FEE_NOT_REQUIRED" };
  }
  switch (action) {
    case "verify":
      if (status === "VERIFIED") return { allowed: true, to: "VERIFIED" };
      if (status === "PROOF_UPLOADED" || status === "UNDER_VERIFICATION") {
        return { allowed: true, to: "VERIFIED" };
      }
      return { allowed: false, code: "INVALID_PAYMENT_TRANSITION" };
    case "reject_pop":
      if (status === "REJECTED") return { allowed: true, to: "REJECTED" };
      if (status === "PROOF_UPLOADED" || status === "UNDER_VERIFICATION") {
        return { allowed: true, to: "REJECTED" };
      }
      return { allowed: false, code: "INVALID_PAYMENT_TRANSITION" };
    case "waive":
      if (status === "WAIVED") return { allowed: true, to: "WAIVED" };
      if (status === "VERIFIED") {
        return { allowed: false, code: "PAYMENT_ALREADY_VERIFIED" };
      }
      if (
        status === "AWAITING_PAYMENT" ||
        status === "PROOF_UPLOADED" ||
        status === "UNDER_VERIFICATION" ||
        status === "REJECTED"
      ) {
        return { allowed: true, to: "WAIVED" };
      }
      return { allowed: false, code: "INVALID_PAYMENT_TRANSITION" };
    default:
      return { allowed: false, code: "INVALID_PAYMENT_TRANSITION" };
  }
}

/** Acceptance payment gate for requirePaymentVerifiedBeforeAccept. */
export function paymentAllowsAcceptance(input: {
  requirePaymentVerifiedBeforeAccept: boolean;
  feeRequired: boolean;
  paymentStatus: AdmissionPaymentStatus | string | null;
}): { ok: boolean; code?: string; message?: string } {
  const status = String(input.paymentStatus || (input.feeRequired ? "AWAITING_PAYMENT" : "NOT_REQUIRED"));
  if (!input.feeRequired || status === "NOT_REQUIRED") {
    return { ok: true };
  }
  if (!input.requirePaymentVerifiedBeforeAccept) {
    // Fee required but school does not gate accept on verification
    return { ok: true };
  }
  if (status === "VERIFIED" || status === "WAIVED") {
    return { ok: true };
  }
  return {
    ok: false,
    code: "PAYMENT_NOT_VERIFIED",
    message: `Cannot accept while payment status is ${status}`,
  };
}

function requireWorkflowEdit(actor: StaffWorkflowActor) {
  if (!actor.hasAdmissionsEdit && !actor.hasAdmissionsManage) {
    throw new StaffAdmissionsError("Admissions edit permission required", 403, "ADMISSIONS_FORBIDDEN");
  }
}

function requirePaymentAdmin(actor: StaffWorkflowActor) {
  if (
    !canAdministerAdmissionPayment(
      actor.appRole,
      actor.hasAdmissionsEdit || actor.hasAdmissionsManage
    )
  ) {
    throw new StaffAdmissionsError(
      "Admissions payment administration permission required",
      403,
      "ADMISSIONS_PAYMENT_FORBIDDEN"
    );
  }
}

function requireFinalDecision(actor: StaffWorkflowActor) {
  if (!actor.hasAdmissionsManage || !canMakeAdmissionDecision(actor.appRole)) {
    throw new StaffAdmissionsError(
      "Admissions final decision permission required",
      403,
      "ADMISSIONS_DECISION_FORBIDDEN"
    );
  }
}

async function loadDetail(
  prisma: PrismaClient,
  actor: StaffWorkflowActor,
  applicationId: string
): Promise<StaffApplicationDetail> {
  return getStaffApplicationDetail(prisma, actor.schoolId, applicationId, {
    includeMedicalDetails: actor.hasAdmissionsManage,
    includeStaffNotes: actor.hasAdmissionsEdit || actor.hasAdmissionsManage,
  });
}

async function lockApplication(
  tx: Prisma.TransactionClient,
  schoolId: string,
  applicationId: string
): Promise<{ id: string; status: AdmissionApplicationStatus }> {
  const rows = await tx.$queryRaw<Array<{ id: string; status: string }>>`
    SELECT id, status::text AS status
    FROM "AdmissionApplication"
    WHERE id = ${applicationId} AND "schoolId" = ${schoolId}
    FOR UPDATE
  `;
  const row = rows[0];
  if (!row) {
    throw new StaffAdmissionsError("Application not found", 404, "APPLICATION_NOT_FOUND");
  }
  return { id: row.id, status: row.status as AdmissionApplicationStatus };
}

async function writeStatusChange(
  tx: Prisma.TransactionClient,
  input: {
    schoolId: string;
    applicationId: string;
    fromStatus: AdmissionApplicationStatus;
    toStatus: AdmissionApplicationStatus;
    actorUserId: string;
    reason?: string | null;
    eventType: string;
    metadataJson?: Record<string, unknown>;
    statusReason?: string | null;
    extraAppData?: Record<string, unknown>;
  }
) {
  await tx.admissionApplication.update({
    where: { id: input.applicationId },
    data: {
      status: input.toStatus,
      ...(input.statusReason !== undefined ? { statusReason: input.statusReason } : {}),
      ...(input.extraAppData || {}),
    },
  });
  if (input.fromStatus !== input.toStatus) {
    await tx.admissionStatusHistory.create({
      data: {
        schoolId: input.schoolId,
        applicationId: input.applicationId,
        fromStatus: input.fromStatus,
        toStatus: input.toStatus,
        actorType: "STAFF",
        actorUserId: input.actorUserId,
        reason: input.reason ?? null,
      },
    });
  }
  await tx.admissionAuditEvent.create({
    data: {
      schoolId: input.schoolId,
      applicationId: input.applicationId,
      eventType: input.eventType,
      actorType: "STAFF",
      actorUserId: input.actorUserId,
      metadataJson: {
        fromStatus: input.fromStatus,
        toStatus: input.toStatus,
        ...(input.metadataJson || {}),
      },
    },
  });
}

export async function startApplicationReview(
  prisma: PrismaClient,
  actor: StaffWorkflowActor,
  applicationId: string
): Promise<WorkflowActionResult> {
  requireWorkflowEdit(actor);
  const appId = clean(applicationId);

  const result = await prisma.$transaction(async (tx) => {
    const locked = await lockApplication(tx, actor.schoolId, appId);
    const transition = assertApplicationTransition(locked.status, "start_review");
    if (!transition.allowed || !transition.to) {
      throw new StaffAdmissionsError(
        "Cannot start review from the current application status",
        409,
        transition.code || "INVALID_TRANSITION"
      );
    }
    if (locked.status === "UNDER_REVIEW") {
      return { idempotent: true };
    }
    await writeStatusChange(tx, {
      schoolId: actor.schoolId,
      applicationId: locked.id,
      fromStatus: locked.status,
      toStatus: "UNDER_REVIEW",
      actorUserId: actor.userId,
      reason: "Staff started review",
      eventType: "REVIEW_STARTED",
    });
    return { idempotent: false };
  });

  return {
    application: await loadDetail(prisma, actor, appId),
    action: "start_review",
    idempotent: result.idempotent,
  };
}

export async function requestApplicationInfo(
  prisma: PrismaClient,
  actor: StaffWorkflowActor,
  applicationId: string,
  body: { message?: string; internalNote?: string }
): Promise<WorkflowActionResult> {
  requireWorkflowEdit(actor);
  const appId = clean(applicationId);
  const message = clean(body.message);
  if (!message) {
    throw new StaffAdmissionsError(
      "An applicant-facing request message is required",
      400,
      "MESSAGE_REQUIRED"
    );
  }
  const internalNote = clean(body.internalNote);

  const result = await prisma.$transaction(async (tx) => {
    const locked = await lockApplication(tx, actor.schoolId, appId);
    const transition = assertApplicationTransition(locked.status, "request_info");
    if (!transition.allowed || !transition.to) {
      throw new StaffAdmissionsError(
        "Cannot request information from the current application status",
        409,
        transition.code || "INVALID_TRANSITION"
      );
    }
    const already = locked.status === "INFO_REQUESTED";
    await writeStatusChange(tx, {
      schoolId: actor.schoolId,
      applicationId: locked.id,
      fromStatus: locked.status,
      toStatus: "INFO_REQUESTED",
      actorUserId: actor.userId,
      reason: message,
      statusReason: message,
      eventType: already ? "INFO_REQUEST_UPDATED" : "INFO_REQUESTED",
      metadataJson: { hasInternalNote: Boolean(internalNote) },
    });
    if (internalNote) {
      await tx.admissionStaffNote.create({
        data: {
          schoolId: actor.schoolId,
          applicationId: locked.id,
          authorUserId: actor.userId,
          body: internalNote,
        },
      });
    }
    return { idempotent: already };
  });

  return {
    application: await loadDetail(prisma, actor, appId),
    action: "request_info",
    idempotent: result.idempotent,
  };
}

export async function resumeApplicationReview(
  prisma: PrismaClient,
  actor: StaffWorkflowActor,
  applicationId: string
): Promise<WorkflowActionResult> {
  requireWorkflowEdit(actor);
  const appId = clean(applicationId);

  const result = await prisma.$transaction(async (tx) => {
    const locked = await lockApplication(tx, actor.schoolId, appId);
    const transition = assertApplicationTransition(locked.status, "resume_review");
    if (!transition.allowed || !transition.to) {
      throw new StaffAdmissionsError(
        "Cannot resume review from the current application status",
        409,
        transition.code || "INVALID_TRANSITION"
      );
    }
    if (locked.status === "UNDER_REVIEW") {
      return { idempotent: true };
    }

    const cycle = await getCurrentInfoRequestCycle(tx, actor.schoolId, locked.id);
    if (!cycle) {
      throw new StaffAdmissionsError(
        "No active information request cycle found",
        409,
        "NO_INFO_REQUEST_CYCLE"
      );
    }
    const supplied = await findInformationSuppliedForCycle(
      tx,
      actor.schoolId,
      locked.id,
      cycle.historyId
    );
    if (!supplied) {
      throw new StaffAdmissionsError(
        "Applicant has not marked information as supplied for the current request",
        409,
        "APPLICANT_RESPONSE_REQUIRED"
      );
    }

    await writeStatusChange(tx, {
      schoolId: actor.schoolId,
      applicationId: locked.id,
      fromStatus: locked.status,
      toStatus: "UNDER_REVIEW",
      actorUserId: actor.userId,
      reason: "Staff resumed review after information request",
      eventType: "REVIEW_RESUMED",
      metadataJson: {
        infoRequestHistoryId: cycle.historyId,
        informationSuppliedEventId: supplied.id,
      },
    });
    return { idempotent: false };
  });

  return {
    application: await loadDetail(prisma, actor, appId),
    action: "resume_review",
    idempotent: result.idempotent,
  };
}

export async function verifyAdmissionPayment(
  prisma: PrismaClient,
  actor: StaffWorkflowActor,
  applicationId: string,
  now: Date = new Date()
): Promise<WorkflowActionResult> {
  requirePaymentAdmin(actor);
  const appId = clean(applicationId);

  const result = await prisma.$transaction(async (tx) => {
    const locked = await lockApplication(tx, actor.schoolId, appId);
    if (locked.status === "DECLINED" || locked.status === "WITHDRAWN" || locked.status === "CANCELLED") {
      throw new StaffAdmissionsError(
        "Cannot verify payment for a terminal application",
        409,
        "APPLICATION_TERMINAL"
      );
    }

    const fee = await tx.admissionFeeRecord.findUnique({ where: { applicationId: locked.id } });
    if (!fee || !fee.required) {
      throw new StaffAdmissionsError("No admission fee requires verification", 400, "FEE_NOT_REQUIRED");
    }

    const transition = assertPaymentTransition(fee.paymentStatus, "verify");
    if (!transition.allowed || !transition.to) {
      throw new StaffAdmissionsError(
        "Cannot verify payment from the current payment status",
        409,
        transition.code || "INVALID_PAYMENT_TRANSITION"
      );
    }
    if (fee.paymentStatus === "VERIFIED") {
      return { idempotent: true };
    }
    if (!fee.latestProofDocumentId) {
      throw new StaffAdmissionsError(
        "Proof of payment is required before verification",
        400,
        "PROOF_REQUIRED"
      );
    }
    const proof = await tx.admissionDocument.findFirst({
      where: {
        id: fee.latestProofDocumentId,
        applicationId: locked.id,
        schoolId: actor.schoolId,
        deletedAt: null,
        documentType: "proof_of_payment",
      },
    });
    if (!proof) {
      throw new StaffAdmissionsError(
        "Proof of payment is required before verification",
        400,
        "PROOF_REQUIRED"
      );
    }

    const fromStatus = fee.paymentStatus;
    await tx.admissionFeeRecord.update({
      where: { applicationId: locked.id },
      data: {
        paymentStatus: "VERIFIED",
        verifiedAt: now,
        verifiedByUserId: actor.userId,
        // Do not set waived* for verified payments
        waivedAt: null,
        waivedByUserId: null,
        waiveReason: null,
      },
    });
    await tx.admissionPaymentHistory.create({
      data: {
        schoolId: actor.schoolId,
        applicationId: locked.id,
        fromStatus,
        toStatus: "VERIFIED",
        actorType: "STAFF",
        actorUserId: actor.userId,
        reason: "Payment verified",
      },
    });
    await tx.admissionAuditEvent.create({
      data: {
        schoolId: actor.schoolId,
        applicationId: locked.id,
        eventType: "PAYMENT_VERIFIED",
        actorType: "STAFF",
        actorUserId: actor.userId,
        metadataJson: {
          fromStatus,
          toStatus: "VERIFIED",
          proofDocumentId: proof.id,
        },
      },
    });
    return { idempotent: false };
  });

  return {
    application: await loadDetail(prisma, actor, appId),
    action: "payment_verify",
    idempotent: result.idempotent,
  };
}

export async function rejectAdmissionProofOfPayment(
  prisma: PrismaClient,
  actor: StaffWorkflowActor,
  applicationId: string,
  body: { reason?: string },
  now: Date = new Date()
): Promise<WorkflowActionResult> {
  requirePaymentAdmin(actor);
  const appId = clean(applicationId);
  const reason = clean(body.reason);
  if (!reason) {
    throw new StaffAdmissionsError("A rejection reason is required", 400, "REASON_REQUIRED");
  }

  const result = await prisma.$transaction(async (tx) => {
    const locked = await lockApplication(tx, actor.schoolId, appId);
    if (locked.status === "DECLINED" || locked.status === "WITHDRAWN" || locked.status === "CANCELLED") {
      throw new StaffAdmissionsError(
        "Cannot reject proof for a terminal application",
        409,
        "APPLICATION_TERMINAL"
      );
    }
    const fee = await tx.admissionFeeRecord.findUnique({ where: { applicationId: locked.id } });
    if (!fee || !fee.required) {
      throw new StaffAdmissionsError("No admission fee requires proof rejection", 400, "FEE_NOT_REQUIRED");
    }
    const transition = assertPaymentTransition(fee.paymentStatus, "reject_pop");
    if (!transition.allowed || !transition.to) {
      throw new StaffAdmissionsError(
        "Cannot reject proof from the current payment status",
        409,
        transition.code || "INVALID_PAYMENT_TRANSITION"
      );
    }
    if (fee.paymentStatus === "REJECTED") {
      return { idempotent: true };
    }

    const fromStatus = fee.paymentStatus;
    // Preserve latestProofDocumentId — do not delete the document
    await tx.admissionFeeRecord.update({
      where: { applicationId: locked.id },
      data: {
        paymentStatus: "REJECTED",
        rejectedAt: now,
        rejectionReason: reason,
        verifiedAt: null,
        verifiedByUserId: null,
      },
    });
    await tx.admissionPaymentHistory.create({
      data: {
        schoolId: actor.schoolId,
        applicationId: locked.id,
        fromStatus,
        toStatus: "REJECTED",
        actorType: "STAFF",
        actorUserId: actor.userId,
        reason,
      },
    });
    await tx.admissionAuditEvent.create({
      data: {
        schoolId: actor.schoolId,
        applicationId: locked.id,
        eventType: "PROOF_OF_PAYMENT_REJECTED",
        actorType: "STAFF",
        actorUserId: actor.userId,
        metadataJson: {
          fromStatus,
          toStatus: "REJECTED",
          proofDocumentId: fee.latestProofDocumentId,
        },
      },
    });
    return { idempotent: false };
  });

  return {
    application: await loadDetail(prisma, actor, appId),
    action: "payment_reject",
    idempotent: result.idempotent,
  };
}

export async function waiveAdmissionFee(
  prisma: PrismaClient,
  actor: StaffWorkflowActor,
  applicationId: string,
  body: { reason?: string },
  now: Date = new Date()
): Promise<WorkflowActionResult> {
  requirePaymentAdmin(actor);
  const appId = clean(applicationId);
  const reason = clean(body.reason);
  if (!reason) {
    throw new StaffAdmissionsError("A waiver reason is required", 400, "REASON_REQUIRED");
  }

  const result = await prisma.$transaction(async (tx) => {
    const locked = await lockApplication(tx, actor.schoolId, appId);
    if (locked.status === "DECLINED" || locked.status === "WITHDRAWN" || locked.status === "CANCELLED") {
      throw new StaffAdmissionsError(
        "Cannot waive fee for a terminal application",
        409,
        "APPLICATION_TERMINAL"
      );
    }
    const fee = await tx.admissionFeeRecord.findUnique({ where: { applicationId: locked.id } });
    if (!fee || !fee.required) {
      throw new StaffAdmissionsError("No admission fee to waive", 400, "FEE_NOT_REQUIRED");
    }
    const transition = assertPaymentTransition(fee.paymentStatus, "waive");
    if (!transition.allowed || !transition.to) {
      throw new StaffAdmissionsError(
        "Cannot waive fee from the current payment status",
        409,
        transition.code || "INVALID_PAYMENT_TRANSITION"
      );
    }
    if (fee.paymentStatus === "WAIVED") {
      return { idempotent: true };
    }

    const fromStatus = fee.paymentStatus;
    await tx.admissionFeeRecord.update({
      where: { applicationId: locked.id },
      data: {
        paymentStatus: "WAIVED",
        waivedAt: now,
        waivedByUserId: actor.userId,
        waiveReason: reason,
        // Explicitly not VERIFIED
        verifiedAt: null,
        verifiedByUserId: null,
      },
    });
    await tx.admissionPaymentHistory.create({
      data: {
        schoolId: actor.schoolId,
        applicationId: locked.id,
        fromStatus,
        toStatus: "WAIVED",
        actorType: "STAFF",
        actorUserId: actor.userId,
        reason,
      },
    });
    await tx.admissionAuditEvent.create({
      data: {
        schoolId: actor.schoolId,
        applicationId: locked.id,
        eventType: "FEE_WAIVED",
        actorType: "STAFF",
        actorUserId: actor.userId,
        metadataJson: { fromStatus, toStatus: "WAIVED" },
      },
    });
    return { idempotent: false };
  });

  return {
    application: await loadDetail(prisma, actor, appId),
    action: "payment_waive",
    idempotent: result.idempotent,
  };
}

async function assertAcceptanceGates(
  prisma: PrismaClient,
  schoolId: string,
  applicationId: string
): Promise<void> {
  const app = await prisma.admissionApplication.findFirst({
    where: { id: applicationId, schoolId },
    include: {
      learnerCandidate: true,
      guardians: true,
      answers: true,
      documents: { where: { deletedAt: null }, select: { documentType: true } },
      feeRecord: true,
    },
  });
  if (!app) {
    throw new StaffAdmissionsError("Application not found", 404, "APPLICATION_NOT_FOUND");
  }

  const settings = await prisma.schoolAdmissionsSettings.findUnique({ where: { schoolId } });
  if (!settings) {
    throw new StaffAdmissionsError("Admissions settings not found", 404, "SETTINGS_NOT_FOUND");
  }

  const dataErrors = validateApplicationForSubmit({ app, settings });
  if (dataErrors.length) {
    throw new StaffAdmissionsError(
      "Application data is incomplete for acceptance",
      400,
      "ACCEPTANCE_DATA_INCOMPLETE",
      dataErrors
    );
  }

  if (!app.privacyAcceptedAt || !app.declarationsAcceptedAt) {
    throw new StaffAdmissionsError(
      "Declarations/consents are required for acceptance",
      400,
      "CONSENT_REQUIRED"
    );
  }

  if (!gradeIsAccepted(settings, app.requestedGrade)) {
    throw new StaffAdmissionsError(
      "Requested grade is not accepted for this school",
      400,
      "GRADE_NOT_ACCEPTED"
    );
  }

  const requiredTypes = parseRequiredDocumentTypes(settings.requiredDocuments);
  const completeness = deriveDocumentCompleteness({
    requiredDocumentTypes: requiredTypes,
    activeDocumentTypes: app.documents.map((d) => d.documentType),
  });
  if (!completeness.documentsComplete) {
    throw new StaffAdmissionsError(
      "Required documents are incomplete",
      400,
      "DOCUMENTS_INCOMPLETE",
      completeness.missingDocumentTypes.map((t) => ({
        field: `documents.${t}`,
        message: `Missing required document: ${t}`,
      }))
    );
  }

  const payGate = paymentAllowsAcceptance({
    requirePaymentVerifiedBeforeAccept: Boolean(settings.requirePaymentVerifiedBeforeAccept),
    feeRequired: Boolean(app.feeRecord?.required ?? app.feeRequired),
    paymentStatus: app.feeRecord?.paymentStatus ?? null,
  });
  if (!payGate.ok) {
    throw new StaffAdmissionsError(
      payGate.message || "Payment verification required before acceptance",
      409,
      payGate.code || "PAYMENT_NOT_VERIFIED"
    );
  }
}

// Extend StaffAdmissionsError to carry details — check if it already supports details
export async function acceptAdmissionApplication(
  prisma: PrismaClient,
  actor: StaffWorkflowActor,
  applicationId: string,
  now: Date = new Date()
): Promise<WorkflowActionResult> {
  requireFinalDecision(actor);
  const appId = clean(applicationId);

  // Pre-check gates outside lock for clearer errors; re-check after lock for races
  await assertAcceptanceGates(prisma, actor.schoolId, appId);

  const result = await prisma.$transaction(async (tx) => {
    const locked = await lockApplication(tx, actor.schoolId, appId);
    if (locked.status === "ACCEPTED") {
      return { idempotent: true };
    }
    const transition = assertApplicationTransition(locked.status, "accept");
    if (!transition.allowed || transition.to !== "ACCEPTED") {
      throw new StaffAdmissionsError(
        "Cannot accept application from the current status",
        409,
        transition.code || "INVALID_TRANSITION"
      );
    }

    // Re-validate inside transaction against current rows
    const fee = await tx.admissionFeeRecord.findUnique({ where: { applicationId: locked.id } });
    const settings = await tx.schoolAdmissionsSettings.findUniqueOrThrow({
      where: { schoolId: actor.schoolId },
    });
    const payGate = paymentAllowsAcceptance({
      requirePaymentVerifiedBeforeAccept: Boolean(settings.requirePaymentVerifiedBeforeAccept),
      feeRequired: Boolean(fee?.required),
      paymentStatus: fee?.paymentStatus ?? null,
    });
    if (!payGate.ok) {
      throw new StaffAdmissionsError(
        payGate.message || "Payment verification required before acceptance",
        409,
        payGate.code || "PAYMENT_NOT_VERIFIED"
      );
    }

    const docs = await tx.admissionDocument.findMany({
      where: { applicationId: locked.id, schoolId: actor.schoolId, deletedAt: null },
      select: { documentType: true },
    });
    const completeness = deriveDocumentCompleteness({
      requiredDocumentTypes: parseRequiredDocumentTypes(settings.requiredDocuments),
      activeDocumentTypes: docs.map((d) => d.documentType),
    });
    if (!completeness.documentsComplete) {
      throw new StaffAdmissionsError("Required documents are incomplete", 400, "DOCUMENTS_INCOMPLETE");
    }

    await writeStatusChange(tx, {
      schoolId: actor.schoolId,
      applicationId: locked.id,
      fromStatus: locked.status,
      toStatus: "ACCEPTED",
      actorUserId: actor.userId,
      reason: "Application accepted",
      eventType: "APPLICATION_ACCEPTED",
      extraAppData: {
        acceptedAt: now,
        acceptedByUserId: actor.userId,
        declinedAt: null,
      },
    });
    return { idempotent: false };
  });

  return {
    application: await loadDetail(prisma, actor, appId),
    action: "accept",
    idempotent: result.idempotent,
  };
}

export async function rejectAdmissionApplication(
  prisma: PrismaClient,
  actor: StaffWorkflowActor,
  applicationId: string,
  body: { reason?: string },
  now: Date = new Date()
): Promise<WorkflowActionResult> {
  requireFinalDecision(actor);
  const appId = clean(applicationId);
  const reason = clean(body.reason);
  if (!reason) {
    throw new StaffAdmissionsError("A rejection reason is required", 400, "REASON_REQUIRED");
  }

  const result = await prisma.$transaction(async (tx) => {
    const locked = await lockApplication(tx, actor.schoolId, appId);
    if (locked.status === "DECLINED") {
      return { idempotent: true };
    }
    const transition = assertApplicationTransition(locked.status, "reject");
    if (!transition.allowed || transition.to !== "DECLINED") {
      throw new StaffAdmissionsError(
        "Cannot reject application from the current status",
        409,
        transition.code || "INVALID_TRANSITION"
      );
    }
    await writeStatusChange(tx, {
      schoolId: actor.schoolId,
      applicationId: locked.id,
      fromStatus: locked.status,
      toStatus: "DECLINED",
      actorUserId: actor.userId,
      reason,
      statusReason: reason,
      eventType: "APPLICATION_DECLINED",
      extraAppData: {
        declinedAt: now,
        acceptedAt: null,
        acceptedByUserId: null,
      },
    });
    return { idempotent: false };
  });

  return {
    application: await loadDetail(prisma, actor, appId),
    action: "reject",
    idempotent: result.idempotent,
  };
}
