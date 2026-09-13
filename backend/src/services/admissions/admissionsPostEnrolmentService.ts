/**
 * OA-04E — derived post-enrolment checklist summary (read-only, zero side effects).
 */
import type { PrismaClient } from "@prisma/client";
import { readLearnerBillingPlanFromDb } from "../learnerBillingPlanDbStore";
import { readSchoolFamilyAccountAgeAnalysisSnapshots } from "../../utils/familyAccountAgeAnalysisStore";

export type PostEnrolmentPlacementStatus = "COMPLETE" | "ACTION_RECOMMENDED";
export type PostEnrolmentBillingStatus = "ASSIGNED" | "REQUIRED";
export type PostEnrolmentFinanceStatus = "READY" | "BASELINE_MISSING" | "ACCOUNT_MISSING";
export type PostEnrolmentPortalStatus = "READY" | "ONBOARDING_REQUIRED" | "CONTACT_REQUIRED";
export type PostEnrolmentInvoicingStatus = "WAITING_FOR_BILLING_PLAN" | "READY_FOR_FUTURE_INVOICE_RUN";

export type PostEnrolmentSummary = {
  learner: {
    id: string;
    firstName: string;
    lastName: string;
    admissionNo: string | null;
    grade: string;
    className: string | null;
    enrollmentStatus: string;
  };
  family: {
    id: string;
    accountRef: string;
    accountNo: string;
    familyName: string;
    mode: "created" | "reused" | "unknown";
  } | null;
  placement: {
    status: PostEnrolmentPlacementStatus;
    label: string;
    grade: string;
    className: string | null;
  };
  billingPlan: {
    status: PostEnrolmentBillingStatus;
    label: string;
    lineCount: number;
  };
  finance: {
    status: PostEnrolmentFinanceStatus;
    label: string;
    accountRef: string | null;
    baselinePresent: boolean | null;
    note: string;
  };
  guardians: Array<{
    parentId: string;
    firstName: string;
    surname: string;
    relationship: string | null;
    isPrimary: boolean;
    isPayingPerson: boolean;
    hasEmail: boolean;
    hasCellNo: boolean;
    portalStatus: PostEnrolmentPortalStatus;
    portalLabel: string;
    onboardingStatus: string | null;
  }>;
  invoicing: {
    status: PostEnrolmentInvoicingStatus;
    label: string;
    note: string;
  };
  admissionFee: {
    required: boolean;
    paymentStatus: string | null;
    label: string;
    note: string;
  };
};

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function portalStatusForParent(input: {
  cellNo: string | null | undefined;
  email: string | null | undefined;
  onboardingStatus: string | null | undefined;
}): { portalStatus: PostEnrolmentPortalStatus; portalLabel: string } {
  const hasCell = Boolean(clean(input.cellNo));
  const hasEmail = Boolean(clean(input.email));
  if (!hasCell && !hasEmail) {
    return {
      portalStatus: "CONTACT_REQUIRED",
      portalLabel: "Contact details required",
    };
  }
  const status = clean(input.onboardingStatus).toUpperCase();
  if (status === "REGISTERED" || status === "LINKED" || status === "ACTIVE") {
    return { portalStatus: "READY", portalLabel: "Parent Portal ready" };
  }
  return {
    portalStatus: "ONBOARDING_REQUIRED",
    portalLabel: "Parent onboarding required",
  };
}

/**
 * Build observational post-enrolment summary for a converted application.
 * Must not mutate DB, finance files, parents, or portal state.
 */
export async function buildPostEnrolmentSummary(
  prisma: PrismaClient,
  schoolId: string,
  input: {
    applicationId: string;
    promotedLearnerId: string;
    promotedFamilyAccountId: string | null;
    feeRequired: boolean;
    paymentStatus: string | null;
  }
): Promise<PostEnrolmentSummary | null> {
  const sid = clean(schoolId);
  const learnerId = clean(input.promotedLearnerId);
  if (!sid || !learnerId) return null;

  const learner = await prisma.learner.findFirst({
    where: { id: learnerId, schoolId: sid },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      admissionNo: true,
      grade: true,
      className: true,
      enrollmentStatus: true,
      familyAccountId: true,
    },
  });
  if (!learner) return null;

  const familyId = clean(input.promotedFamilyAccountId) || clean(learner.familyAccountId);
  const family = familyId
    ? await prisma.familyAccount.findFirst({
        where: { id: familyId, schoolId: sid },
        select: {
          id: true,
          accountRef: true,
          accountNo: true,
          familyName: true,
          createdAt: true,
        },
      })
    : null;

  let familyMode: "created" | "reused" | "unknown" = "unknown";
  const convertAudit = await prisma.admissionAuditEvent.findFirst({
    where: {
      schoolId: sid,
      applicationId: clean(input.applicationId),
      eventType: "APPLICATION_CONVERTED",
    },
    orderBy: { createdAt: "desc" },
    select: { metadataJson: true },
  });
  const meta = (convertAudit?.metadataJson || {}) as Record<string, unknown>;
  if (meta.familyMode === "created" || meta.familyMode === "reused") {
    familyMode = meta.familyMode;
  }

  const className = clean(learner.className) || null;
  const grade = clean(learner.grade) || "";
  const placementStatus: PostEnrolmentPlacementStatus = className
    ? "COMPLETE"
    : "ACTION_RECOMMENDED";

  const planLines = await readLearnerBillingPlanFromDb(sid, learner.id);
  const billingAssigned = planLines.length > 0;

  let baselinePresent: boolean | null = null;
  let financeStatus: PostEnrolmentFinanceStatus = "ACCOUNT_MISSING";
  let financeLabel = "Family account missing";
  let financeNote =
    "Canonical FamilyAccount was not found for this conversion. Investigate before finance workflows.";

  if (family) {
    const snapshots = readSchoolFamilyAccountAgeAnalysisSnapshots(sid);
    baselinePresent = Boolean(snapshots[family.accountRef]);
    if (baselinePresent) {
      financeStatus = "READY";
      financeLabel = "Finance account ready";
      financeNote =
        "Family account exists and appears in the finance age-analysis index (opening baseline present).";
    } else {
      financeStatus = "BASELINE_MISSING";
      financeLabel = "Finance setup needs attention";
      financeNote =
        "Family account exists, but no age-analysis baseline snapshot was found for this accountRef. Enrolment is still complete — follow up if statements omit the account. Conversion-time FINANCE_BASELINE_SYNC_FAILED is not stored as durable DB state.";
    }
  }

  const links = await prisma.parentLearnerLink.findMany({
    where: { learnerId: learner.id, schoolId: sid },
    orderBy: [{ isPrimary: "desc" }, { id: "asc" }],
    select: {
      isPrimary: true,
      isPayingPerson: true,
      relation: true,
      parent: {
        select: {
          id: true,
          firstName: true,
          surname: true,
          cellNo: true,
          email: true,
          onboarding: { select: { status: true } },
        },
      },
    },
  });

  const guardians = links.map((link) => {
    const portal = portalStatusForParent({
      cellNo: link.parent.cellNo,
      email: link.parent.email,
      onboardingStatus: link.parent.onboarding?.status || null,
    });
    return {
      parentId: link.parent.id,
      firstName: link.parent.firstName,
      surname: link.parent.surname,
      relationship: link.relation || null,
      isPrimary: Boolean(link.isPrimary),
      isPayingPerson: Boolean(link.isPayingPerson),
      hasEmail: Boolean(clean(link.parent.email)),
      hasCellNo: Boolean(clean(link.parent.cellNo)),
      portalStatus: portal.portalStatus,
      portalLabel: portal.portalLabel,
      onboardingStatus: link.parent.onboarding?.status || null,
    };
  });

  const paymentStatus = input.paymentStatus ? clean(input.paymentStatus) : null;

  return {
    learner: {
      id: learner.id,
      firstName: learner.firstName,
      lastName: learner.lastName,
      admissionNo: learner.admissionNo,
      grade,
      className,
      enrollmentStatus: learner.enrollmentStatus,
    },
    family: family
      ? {
          id: family.id,
          accountRef: family.accountRef,
          accountNo: family.accountNo || family.accountRef,
          familyName: family.familyName,
          mode: familyMode,
        }
      : null,
    placement: {
      status: placementStatus,
      label: className
        ? "Grade and class recorded"
        : "Grade recorded — class not yet assigned",
      grade,
      className,
    },
    billingPlan: {
      status: billingAssigned ? "ASSIGNED" : "REQUIRED",
      label: billingAssigned ? "Billing plan assigned" : "Billing plan required",
      lineCount: planLines.length,
    },
    finance: {
      status: financeStatus,
      label: financeLabel,
      accountRef: family?.accountRef || null,
      baselinePresent,
      note: financeNote,
    },
    guardians,
    invoicing: {
      status: billingAssigned ? "READY_FOR_FUTURE_INVOICE_RUN" : "WAITING_FOR_BILLING_PLAN",
      label: billingAssigned
        ? "Ready for future invoice run"
        : "Waiting for billing plan",
      note: "Invoicing is handled through normal Invoice Runs after the learner's billing plan is confirmed. No invoice is claimed here.",
    },
    admissionFee: {
      required: Boolean(input.feeRequired),
      paymentStatus,
      label: paymentStatus
        ? `Admission fee: ${paymentStatus.replace(/_/g, " ")}`
        : input.feeRequired
          ? "Admission fee: pending"
          : "Admission fee: not required",
      note: "Application-scoped only. VERIFIED does not mean paid on the FamilyAccount ledger.",
    },
  };
}
