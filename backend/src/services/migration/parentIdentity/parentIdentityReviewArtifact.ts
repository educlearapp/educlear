/**
 * Structured migration review artifact (file-based; no schema change).
 * Operators resolve REVIEW/CONFLICT via resolutions passed into APPLY.
 */

import fs from "fs";
import path from "path";
import type {
  ParentIdentityPreflightReport,
  ParentIdentityResolution,
  ParentIdentityResolutionKind,
} from "./parentIdentityTypes";

export type ParentIdentityReviewArtifact = {
  generatedAt: string;
  status: ParentIdentityPreflightReport["status"];
  message: string;
  counts: ParentIdentityPreflightReport["counts"];
  metrics: ParentIdentityPreflightReport["metrics"];
  /** Conceptual resolution options for REVIEW rows. */
  reviewResolutionOptions: ParentIdentityResolutionKind[];
  reviewQueue: Array<{
    itemKey: string;
    decision: "REVIEW_REQUIRED";
    sourceNameExact: string;
    incoming: ParentIdentityPreflightReport["items"][number]["incoming"];
    reasons: string[];
    candidates: ParentIdentityPreflightReport["items"][number]["candidates"];
    recommendedResolutions: ParentIdentityResolutionKind[];
  }>;
  conflictQueue: Array<{
    itemKey: string;
    decision: "CONFLICT";
    sourceNameExact: string;
    incoming: ParentIdentityPreflightReport["items"][number]["incoming"];
    conflictReasons: string[];
    candidates: ParentIdentityPreflightReport["items"][number]["candidates"];
    note: string;
  }>;
  readyToReuse: Array<{
    itemKey: string;
    sourceNameExact: string;
    reuseParentId: string | null;
    reasons: string[];
  }>;
  readyToCreate: Array<{
    itemKey: string;
    sourceNameExact: string;
    reasons: string[];
  }>;
  /** Empty template operators fill before re-running APPLY. */
  resolutionTemplate: ParentIdentityResolution[];
};

export function buildParentIdentityReviewArtifact(
  report: ParentIdentityPreflightReport
): ParentIdentityReviewArtifact {
  const reviewQueue = report.items
    .filter((i) => i.decision === "REVIEW_REQUIRED")
    .map((i) => ({
      itemKey: i.itemKey,
      decision: "REVIEW_REQUIRED" as const,
      sourceNameExact: i.sourceNameExact,
      incoming: i.incoming,
      reasons: i.reasons,
      candidates: i.candidates,
      recommendedResolutions: [
        "LINK_TO_EXISTING_PARENT",
        "CREATE_AS_NEW_PARENT",
        "SKIP_HOLD",
      ] as ParentIdentityResolutionKind[],
    }));

  const conflictQueue = report.items
    .filter((i) => i.decision === "CONFLICT")
    .map((i) => ({
      itemKey: i.itemKey,
      decision: "CONFLICT" as const,
      sourceNameExact: i.sourceNameExact,
      incoming: i.incoming,
      conflictReasons: i.conflictReasons,
      candidates: i.candidates,
      note: "Do not auto-resolve. Require explicit authorised review before APPLY.",
    }));

  return {
    generatedAt: new Date().toISOString(),
    status: report.status,
    message: report.message,
    counts: report.counts,
    metrics: report.metrics,
    reviewResolutionOptions: [
      "LINK_TO_EXISTING_PARENT",
      "CREATE_AS_NEW_PARENT",
      "SKIP_HOLD",
    ],
    reviewQueue,
    conflictQueue,
    readyToReuse: report.items
      .filter((i) => i.decision === "REUSE_EXISTING")
      .map((i) => ({
        itemKey: i.itemKey,
        sourceNameExact: i.sourceNameExact,
        reuseParentId: i.reuseParentId,
        reasons: i.reasons,
      })),
    readyToCreate: report.items
      .filter((i) => i.decision === "CREATE_NEW")
      .map((i) => ({
        itemKey: i.itemKey,
        sourceNameExact: i.sourceNameExact,
        reasons: i.reasons,
      })),
    resolutionTemplate: [
      ...reviewQueue.map((r) => ({
        itemKey: r.itemKey,
        kind: "SKIP_HOLD" as const,
        existingParentId: null,
        note: "Replace kind with LINK_TO_EXISTING_PARENT or CREATE_AS_NEW_PARENT",
      })),
      ...conflictQueue.map((c) => ({
        itemKey: c.itemKey,
        kind: "SKIP_HOLD" as const,
        existingParentId: null,
        note: "CONFLICT requires authorised explicit resolution — do not auto-merge",
      })),
    ],
  };
}

/** Write review artifact JSON next to migration output (local path). */
export function writeParentIdentityReviewArtifact(
  report: ParentIdentityPreflightReport,
  outPath: string
): string {
  const artifact = buildParentIdentityReviewArtifact(report);
  const dir = path.dirname(outPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(artifact, null, 2), "utf8");
  return outPath;
}
