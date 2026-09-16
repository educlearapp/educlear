import { Router } from "express";
import type { SchoolModuleGateRequest } from "../middleware/requireSchoolModule";
import { prisma } from "../prisma";
import {
  createBulkStatementEmailJob,
  retryFailedBulkStatementEmailJob,
  serializeBulkStatementEmailJob,
  type BulkStatementEmailRecipientInput,
} from "../services/bulkStatementEmailJobService";
import { tickBulkStatementEmailJobProcessor } from "../services/bulkStatementEmailJobProcessor";

const router = Router();

function authSchoolId(req: SchoolModuleGateRequest): string {
  return String(req.schoolModuleAuth?.authorizedSchoolId || "").trim();
}

function authUserId(req: SchoolModuleGateRequest): string {
  return String(req.schoolModuleAuth?.userId || "").trim();
}

router.post("/", async (req: SchoolModuleGateRequest, res) => {
  try {
    const schoolId = authSchoolId(req);
    const bodySchoolId = String(req.body?.schoolId || "").trim();
    if (!schoolId || (bodySchoolId && bodySchoolId !== schoolId)) {
      return res.status(403).json({ success: false, error: "School access denied" });
    }

    const recipientsRaw = Array.isArray(req.body?.recipients) ? req.body.recipients : [];
    const recipients: BulkStatementEmailRecipientInput[] = recipientsRaw.map((r: any) => ({
      accountNo: String(r?.accountNo || "").trim(),
      learnerId: String(r?.learnerId || "").trim(),
      learnerName: String(r?.learnerName || "").trim(),
      parentId: String(r?.parentId || "").trim(),
      contactName: String(r?.contactName || "").trim(),
      relationship: String(r?.relationship || "").trim(),
      email: String(r?.email || "").trim(),
      skipped: Boolean(r?.skipped),
      skipReason: r?.skipReason != null ? String(r.skipReason) : undefined,
    }));

    const job = await createBulkStatementEmailJob(prisma, {
      schoolId,
      createdBy: authUserId(req),
      subject: String(req.body?.subject || "").trim(),
      htmlBody: String(req.body?.html || req.body?.htmlBody || "").trim(),
      messagePlain: String(req.body?.messagePlain || req.body?.message || "").trim(),
      statementPeriod: String(req.body?.statementPeriod || req.body?.period || "All Time").trim(),
      filterSnapshot:
        req.body?.filterSnapshot && typeof req.body.filterSnapshot === "object"
          ? req.body.filterSnapshot
          : null,
      recipients,
    });

    // Kick the recoverable processor without blocking the response.
    void tickBulkStatementEmailJobProcessor(prisma);

    return res.status(201).json({
      success: true,
      job: serializeBulkStatementEmailJob(job, { includeRecipients: true }),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to create bulk statement email job";
    const status = message.includes("No eligible") || message.includes("Missing") ? 400 : 500;
    console.error("[bulk-statement-email-jobs] create failed:", error);
    return res.status(status).json({ success: false, error: message });
  }
});

router.get("/", async (req: SchoolModuleGateRequest, res) => {
  try {
    const schoolId = authSchoolId(req);
    const querySchoolId = String(req.query?.schoolId || "").trim();
    if (!schoolId || (querySchoolId && querySchoolId !== schoolId)) {
      return res.status(403).json({ success: false, error: "School access denied" });
    }
    const take = Math.min(50, Math.max(1, Number(req.query?.limit) || 20));
    const jobs = await prisma.bulkStatementEmailJob.findMany({
      where: { schoolId },
      orderBy: { createdAt: "desc" },
      take,
    });
    return res.json({
      success: true,
      jobs: jobs.map((job) => serializeBulkStatementEmailJob(job, { includeRecipients: false })),
    });
  } catch (error) {
    console.error("[bulk-statement-email-jobs] list failed:", error);
    return res.status(500).json({ success: false, error: "Failed to list jobs" });
  }
});

router.get("/:id", async (req: SchoolModuleGateRequest, res) => {
  try {
    const schoolId = authSchoolId(req);
    const querySchoolId = String(req.query?.schoolId || "").trim();
    if (!schoolId || (querySchoolId && querySchoolId !== schoolId)) {
      return res.status(403).json({ success: false, error: "School access denied" });
    }
    const id = String(req.params.id || "").trim();
    const job = await prisma.bulkStatementEmailJob.findFirst({
      where: { id, schoolId },
      include: { recipients: { orderBy: [{ accountNo: "asc" }, { contactName: "asc" }] } },
    });
    if (!job) return res.status(404).json({ success: false, error: "Job not found" });
    return res.json({
      success: true,
      job: serializeBulkStatementEmailJob(job, { includeRecipients: true }),
    });
  } catch (error) {
    console.error("[bulk-statement-email-jobs] get failed:", error);
    return res.status(500).json({ success: false, error: "Failed to load job" });
  }
});

router.post("/:id/retry-failed", async (req: SchoolModuleGateRequest, res) => {
  try {
    const schoolId = authSchoolId(req);
    const bodySchoolId = String(req.body?.schoolId || "").trim();
    if (!schoolId || (bodySchoolId && bodySchoolId !== schoolId)) {
      return res.status(403).json({ success: false, error: "School access denied" });
    }
    const id = String(req.params.id || "").trim();
    const recipientIds = Array.isArray(req.body?.recipientIds)
      ? req.body.recipientIds.map((x: unknown) => String(x || "").trim()).filter(Boolean)
      : undefined;

    const result = await retryFailedBulkStatementEmailJob(prisma, {
      jobId: id,
      schoolId,
      recipientIds,
    });

    void tickBulkStatementEmailJobProcessor(prisma);

    const job = await prisma.bulkStatementEmailJob.findFirst({
      where: { id, schoolId },
      include: { recipients: { orderBy: [{ accountNo: "asc" }, { contactName: "asc" }] } },
    });
    if (!job) return res.status(404).json({ success: false, error: "Job not found" });

    return res.json({
      success: true,
      requeued: result.requeued,
      job: serializeBulkStatementEmailJob(job, { includeRecipients: true }),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to retry failed recipients";
    const status = message.includes("not found") ? 404 : 500;
    console.error("[bulk-statement-email-jobs] retry-failed:", error);
    return res.status(status).json({ success: false, error: message });
  }
});

export default router;
