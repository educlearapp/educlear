/**
 * Applicant information-request response (OA-03H).
 * Marks that the applicant has supplied requested information.
 * Does NOT change application status — staff resume-review owns INFO_REQUESTED → UNDER_REVIEW.
 * No schema change: uses AdmissionAuditEvent + AdmissionStatusHistory cycle identity.
 */
import type { Prisma, PrismaClient } from "@prisma/client";

import {
  loadOwnedApplicationForApplicant,
  serializeApplicantApplication,
  type ApplicantApplicationView,
} from "./draftApplicationService";
import { PublicAdmissionsError } from "./resolvePublicAdmissions";

export const INFORMATION_SUPPLIED_EVENT = "INFORMATION_SUPPLIED";

type Db = PrismaClient | Prisma.TransactionClient;

export type InfoRequestCycle = {
  historyId: string;
  createdAt: Date;
  reason: string | null;
};

/**
 * Current info-request cycle = latest status-history row with toStatus INFO_REQUESTED.
 * A new staff request-info after resume creates a new history row → new cycle.
 */
export async function getCurrentInfoRequestCycle(
  db: Db,
  schoolId: string,
  applicationId: string
): Promise<InfoRequestCycle | null> {
  const row = await db.admissionStatusHistory.findFirst({
    where: {
      schoolId,
      applicationId,
      toStatus: "INFO_REQUESTED",
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true, reason: true },
  });
  if (!row) return null;
  return { historyId: row.id, createdAt: row.createdAt, reason: row.reason };
}

export async function findInformationSuppliedForCycle(
  db: Db,
  schoolId: string,
  applicationId: string,
  cycleHistoryId: string
): Promise<{ id: string; createdAt: Date } | null> {
  const events = await db.admissionAuditEvent.findMany({
    where: {
      schoolId,
      applicationId,
      eventType: INFORMATION_SUPPLIED_EVENT,
      actorType: "APPLICANT",
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  for (const e of events) {
    const meta = e.metadataJson;
    if (meta && typeof meta === "object" && !Array.isArray(meta)) {
      const id = String((meta as Record<string, unknown>).infoRequestHistoryId || "");
      if (id === cycleHistoryId) {
        return { id: e.id, createdAt: e.createdAt };
      }
    }
  }
  return null;
}

export type MarkInformationSuppliedResult = {
  application: ApplicantApplicationView;
  idempotent: boolean;
  informationSuppliedAt: string;
  infoRequestHistoryId: string;
};

/**
 * Applicant declares information has been supplied for the current request cycle.
 * Status remains INFO_REQUESTED.
 */
export async function markInformationSupplied(
  prisma: PrismaClient,
  schoolSlug: string,
  publicAccessId: string,
  accessToken: string | null | undefined,
  now: Date = new Date()
): Promise<MarkInformationSuppliedResult> {
  const { app, schoolId } = await loadOwnedApplicationForApplicant(
    prisma,
    schoolSlug,
    publicAccessId,
    accessToken,
    now
  );

  if (app.status !== "INFO_REQUESTED") {
    throw new PublicAdmissionsError(
      "Information can only be marked supplied while the application is awaiting information",
      409,
      "INVALID_STATUS"
    );
  }

  const cycle = await getCurrentInfoRequestCycle(prisma, schoolId, app.id);
  if (!cycle) {
    throw new PublicAdmissionsError(
      "No active information request found for this application",
      409,
      "NO_INFO_REQUEST_CYCLE"
    );
  }

  const existing = await findInformationSuppliedForCycle(prisma, schoolId, app.id, cycle.historyId);
  if (existing) {
    return {
      application: serializeApplicantApplication(app),
      idempotent: true,
      informationSuppliedAt: existing.createdAt.toISOString(),
      infoRequestHistoryId: cycle.historyId,
    };
  }

  const created = await prisma.$transaction(async (tx) => {
    // Re-check status under row lock
    const locked = await tx.$queryRaw<Array<{ id: string; status: string }>>`
      SELECT id, status::text AS status
      FROM "AdmissionApplication"
      WHERE id = ${app.id} AND "schoolId" = ${schoolId}
      FOR UPDATE
    `;
    const row = locked[0];
    if (!row || row.status !== "INFO_REQUESTED") {
      throw new PublicAdmissionsError(
        "Information can only be marked supplied while the application is awaiting information",
        409,
        "INVALID_STATUS"
      );
    }

    // Idempotent race: another concurrent request may have written the event
    const prior = await tx.admissionAuditEvent.findMany({
      where: {
        schoolId,
        applicationId: app.id,
        eventType: INFORMATION_SUPPLIED_EVENT,
        actorType: "APPLICANT",
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    for (const e of prior) {
      const meta = e.metadataJson;
      if (meta && typeof meta === "object" && !Array.isArray(meta)) {
        if (String((meta as Record<string, unknown>).infoRequestHistoryId || "") === cycle.historyId) {
          return { event: e, idempotent: true as const };
        }
      }
    }

    const event = await tx.admissionAuditEvent.create({
      data: {
        schoolId,
        applicationId: app.id,
        eventType: INFORMATION_SUPPLIED_EVENT,
        actorType: "APPLICANT",
        metadataJson: {
          infoRequestHistoryId: cycle.historyId,
          infoRequestAt: cycle.createdAt.toISOString(),
        },
      },
    });
    await tx.admissionApplication.update({
      where: { id: app.id },
      data: { lastApplicantActivityAt: now },
      // status intentionally unchanged
    });
    return { event, idempotent: false as const };
  });

  const refreshed = await prisma.admissionApplication.findUniqueOrThrow({
    where: { id: app.id },
    include: {
      learnerCandidate: true,
      guardians: { orderBy: { sortOrder: "asc" as const } },
      answers: true,
      feeRecord: true,
    },
  });

  return {
    application: serializeApplicantApplication(refreshed),
    idempotent: created.idempotent,
    informationSuppliedAt: created.event.createdAt.toISOString(),
    infoRequestHistoryId: cycle.historyId,
  };
}
