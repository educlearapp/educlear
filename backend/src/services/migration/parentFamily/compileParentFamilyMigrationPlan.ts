/**
 * Compile ParentFamilyMigrationPlan from source files (zero writes).
 * Matching reuses resolveParentIdentity — school-scoped candidates only.
 */

import { createHash, randomUUID } from "crypto";
import { resolveParentIdentity } from "../parentIdentity/resolveParentIdentity";
import {
  normalizeParentCellphone,
  normalizeParentEmail,
  normalizeParentIdentityNumber,
} from "../parentIdentity/normalizeParentIdentity";
import type { ExistingParentCandidate } from "../parentIdentity/parentIdentityTypes";
import { mapParentColumns, splitPersonName } from "./semanticParentDetection";
import { isShellOrJunkParent } from "./shellParentDetection";
import type {
  ParentFamilyDiscovery,
  ParentFamilyMigrationPlan,
  ParentLearnerLinkProposal,
  ParentPersonProposal,
} from "./ParentFamilyMigrationTypes";
import { PARENT_FAMILY_MIGRATION_VERSION } from "./ParentFamilyMigrationTypes";

function learnerKey(row: {
  idNumber?: string | null;
  admissionNo?: string | null;
  name?: string | null;
}): string {
  const id = String(row.idNumber || "").replace(/\D/g, "");
  if (id) return `id:${id}`;
  const adm = String(row.admissionNo || "").trim().toUpperCase();
  if (adm) return `adm:${adm}`;
  return `name:${String(row.name || "").trim().toLowerCase()}`;
}

function mapDecision(
  d: "REUSE_EXISTING" | "CREATE_NEW" | "REVIEW_REQUIRED" | "CONFLICT"
): ParentPersonProposal["matchState"] {
  if (d === "REUSE_EXISTING") return "MATCHED_EXISTING";
  if (d === "CREATE_NEW") return "PROPOSED_NEW";
  if (d === "CONFLICT") return "IDENTITY_CONFLICT";
  return "REVIEW_REQUIRED";
}

function severityForState(
  state: ParentPersonProposal["matchState"],
  isShell: boolean
): ParentPersonProposal["severity"] {
  if (isShell) return "NON_CRITICAL";
  if (state === "IDENTITY_CONFLICT") return "CRITICAL";
  if (state === "REVIEW_REQUIRED") return "CRITICAL";
  if (state === "INSUFFICIENT_EVIDENCE") return "NON_CRITICAL";
  return "INFO";
}

type RawPerson = {
  firstName: string;
  surname: string;
  idNumber: string | null;
  cellNo: string | null;
  email: string | null;
  relationship: string | null;
  learnerKey: string;
  learnerLabel: string;
  learnerIdNumber: string | null;
  admissionNo: string | null;
  sourceFilename: string;
  sourceFileId: string;
  column: string;
};

export function compileParentFamilyMigrationPlan(input: {
  targetSchoolId: string;
  stageId?: string | null;
  sourceAnalysisId?: string | null;
  files: Array<{
    fileId: string;
    filename: string;
    columns: string[];
    rows: Record<string, string>[];
  }>;
  candidates: ExistingParentCandidate[];
  /** Existing learners for canonical link resolution */
  learners: Array<{
    id: string;
    idNumber: string | null;
    admissionNo: string | null;
    firstName: string;
    lastName: string;
  }>;
}): { discovery: ParentFamilyDiscovery; plan: ParentFamilyMigrationPlan } {
  const rawPeople: RawPerson[] = [];

  for (const file of input.files) {
    const col = mapParentColumns(file.columns);
    for (const row of file.rows) {
      const learnerId = col.learnerId ? String(row[col.learnerId] || "").trim() : "";
      const admissionNo = col.admissionNo ? String(row[col.admissionNo] || "").trim() : "";
      const learnerName = col.learnerName ? String(row[col.learnerName] || "").trim() : "";
      const lKey = learnerKey({
        idNumber: learnerId,
        admissionNo,
        name: learnerName,
      });

      const pushPerson = (
        nameFull: string,
        relationship: string | null,
        column: string,
        extras?: { id?: string; cell?: string; email?: string; first?: string; surname?: string }
      ) => {
        let first = extras?.first || "";
        let surname = extras?.surname || "";
        if (!first && !surname && nameFull) {
          const sp = splitPersonName(nameFull);
          first = sp.firstName;
          surname = sp.surname;
        }
        if (!first && !surname && !extras?.id && !extras?.cell && !extras?.email) return;
        rawPeople.push({
          firstName: first,
          surname: surname,
          idNumber: extras?.id || (col.idNumber ? String(row[col.idNumber] || "").trim() : "") || null,
          cellNo: extras?.cell || (col.cellNo ? String(row[col.cellNo] || "").trim() : "") || null,
          email: extras?.email || (col.email ? String(row[col.email] || "").trim() : "") || null,
          relationship: relationship || (col.relationship ? String(row[col.relationship] || "").trim() : "") || null,
          learnerKey: lKey,
          learnerLabel: learnerName || lKey,
          learnerIdNumber: learnerId || null,
          admissionNo: admissionNo || null,
          sourceFilename: file.filename,
          sourceFileId: file.fileId,
          column,
        });
      };

      if (col.motherName && String(row[col.motherName] || "").trim()) {
        pushPerson(String(row[col.motherName]), "Mother", col.motherName);
      }
      if (col.fatherName && String(row[col.fatherName] || "").trim()) {
        pushPerson(String(row[col.fatherName]), "Father", col.fatherName);
      }
      if (col.guardianName && String(row[col.guardianName] || "").trim()) {
        pushPerson(String(row[col.guardianName]), "Guardian", col.guardianName);
      }
      if (col.parentFullName && String(row[col.parentFullName] || "").trim()) {
        pushPerson(String(row[col.parentFullName]), "Parent", col.parentFullName);
      }
      if (col.parentFirstName || col.parentSurname) {
        pushPerson(
          "",
          col.relationship ? String(row[col.relationship!] || "").trim() || "Parent" : "Parent",
          col.parentFirstName || col.parentSurname || "parent",
          {
            first: col.parentFirstName ? String(row[col.parentFirstName] || "").trim() : "",
            surname: col.parentSurname ? String(row[col.parentSurname] || "").trim() : "",
            id: col.idNumber ? String(row[col.idNumber] || "").trim() : "",
            cell: col.cellNo ? String(row[col.cellNo] || "").trim() : "",
            email: col.email ? String(row[col.email] || "").trim() : "",
          }
        );
      }
    }
  }

  // Deduplicate raw people by identity fingerprint within plan (same person + same contacts)
  const personBucket = new Map<string, { raw: RawPerson; learnerKeys: Set<string> }>();
  for (const p of rawPeople) {
    const id = normalizeParentIdentityNumber(p.idNumber) || "";
    const cell = normalizeParentCellphone(p.cellNo) || "";
    const email = normalizeParentEmail(p.email) || "";
    const nameKey = `${p.firstName.trim().toLowerCase()}|${p.surname.trim().toLowerCase()}`;
    const key = id
      ? `id:${id}`
      : cell && email
        ? `ce:${cell}|${email}|${p.firstName.trim().toLowerCase()}`
        : `n:${nameKey}|${cell}|${email}|${p.relationship || ""}`;
    const existing = personBucket.get(key);
    if (existing) {
      existing.learnerKeys.add(p.learnerKey);
    } else {
      personBucket.set(key, { raw: p, learnerKeys: new Set([p.learnerKey]) });
    }
  }

  const people: ParentPersonProposal[] = [];
  const links: ParentLearnerLinkProposal[] = [];
  const reviewItems: ParentFamilyMigrationPlan["reviewItems"] = [];
  const warnings: string[] = [];

  let auto = 0;
  let proposedNew = 0;
  let review = 0;
  let conflicts = 0;
  let insufficient = 0;
  let ignored = 0;

  const learnerByKey = new Map<string, (typeof input.learners)[0]>();
  for (const l of input.learners) {
    const digits = String(l.idNumber || "").replace(/\D/g, "");
    if (digits) learnerByKey.set(`id:${digits}`, l);
    if (l.admissionNo) learnerByKey.set(`adm:${l.admissionNo.trim().toUpperCase()}`, l);
  }

  for (const [, bucket] of personBucket) {
    const p = bucket.raw;
    const shell = isShellOrJunkParent({
      firstName: p.firstName,
      surname: p.surname,
      idNumber: normalizeParentIdentityNumber(p.idNumber),
      cellNo: normalizeParentCellphone(p.cellNo),
      email: normalizeParentEmail(p.email),
      learnerName: p.learnerLabel,
    });

    const proposalId = `pp_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const idNorm = normalizeParentIdentityNumber(p.idNumber);
    const identityKind: ParentPersonProposal["identityKind"] = !idNorm
      ? "NONE"
      : idNorm.length === 13
        ? "SA_ID"
        : "FOREIGN_OR_OTHER";

    if (shell.junk) {
      ignored += 1;
      people.push({
        proposalId,
        displayName: `${p.firstName} ${p.surname}`.trim() || "Incomplete parent",
        firstName: p.firstName,
        surname: p.surname,
        idNumber: idNorm,
        identityKind,
        cellNo: normalizeParentCellphone(p.cellNo),
        email: normalizeParentEmail(p.email),
        relationship: p.relationship,
        matchState: "IGNORED",
        severity: "NON_CRITICAL",
        confidence: "LOW",
        reasons: shell.reasons,
        warnings: shell.reasons,
        evidence: [
          {
            sourceFileId: p.sourceFileId,
            sourceFilename: p.sourceFilename,
            column: p.column,
            sourceValue: `${p.firstName} ${p.surname}`.trim(),
            rowCount: 1,
          },
        ],
        matchedExistingParentId: null,
        candidateSummaries: [],
        learnerKeys: [...bucket.learnerKeys],
        isShellOrJunk: true,
        operatorMessage: "Incomplete or invalid parent source — ignored (not created).",
      });
      continue;
    }

    const decision = resolveParentIdentity({
      incoming: {
        firstName: p.firstName,
        surname: p.surname,
        idNumber: p.idNumber,
        cellNo: p.cellNo,
        email: p.email,
        relationship: p.relationship,
        sourceSystem: "UNKNOWN",
        sourceParentId: null,
        learnerLabel: p.learnerLabel,
        sourceFile: p.sourceFilename,
      },
      candidates: input.candidates,
    });

    let matchState = mapDecision(decision.decision);
    let confidence = decision.confidence as ParentPersonProposal["confidence"];
    const reasons = [
      ...decision.reasons.map(String),
      ...decision.conflictReasons.map(String),
    ];
    const warn: string[] = [];

    // Name-similarity alone never auto-merges — already enforced by resolver.
    // Insufficient evidence: CREATE_NEW with no surname and no contacts → demote
    if (
      matchState === "PROPOSED_NEW" &&
      !idNorm &&
      !normalizeParentCellphone(p.cellNo) &&
      !normalizeParentEmail(p.email) &&
      !p.surname
    ) {
      matchState = "INSUFFICIENT_EVIDENCE";
      confidence = "LOW";
      warn.push("Not enough evidence to create or match a parent safely.");
      insufficient += 1;
    } else if (matchState === "MATCHED_EXISTING") {
      auto += 1;
    } else if (matchState === "PROPOSED_NEW") {
      proposedNew += 1;
    } else if (matchState === "IDENTITY_CONFLICT") {
      conflicts += 1;
      review += 1;
    } else {
      review += 1;
    }

    const candidateSummaries = decision.candidates.map((c) => ({
      label: `${c.firstName} ${c.surname}`.trim(),
      cellphone: c.maskedCellphone,
      email: c.maskedEmail,
      linkedLearners: (c.linkedLearners || []).map((l) => l.label),
      parentId: c.parentId,
    }));

    let operatorMessage = "";
    if (matchState === "MATCHED_EXISTING") {
      operatorMessage = `Matched existing parent ${candidateSummaries[0]?.label || ""}`.trim();
    } else if (matchState === "PROPOSED_NEW") {
      operatorMessage = "No existing match — ready to create as a new parent.";
    } else if (matchState === "IDENTITY_CONFLICT") {
      operatorMessage = "Identity conflict — confirm which parent record to use.";
    } else if (matchState === "INSUFFICIENT_EVIDENCE") {
      operatorMessage = "Not enough information to decide safely.";
    } else if (candidateSummaries.length >= 2) {
      operatorMessage = `We found ${candidateSummaries.length} possible matches — choose one.`;
    } else {
      operatorMessage = "Needs your confirmation before linking.";
    }

    const person: ParentPersonProposal = {
      proposalId,
      displayName: `${p.firstName} ${p.surname}`.trim(),
      firstName: p.firstName,
      surname: p.surname,
      idNumber: idNorm,
      identityKind,
      cellNo: normalizeParentCellphone(p.cellNo),
      email: normalizeParentEmail(p.email),
      relationship: p.relationship,
      matchState,
      severity: severityForState(matchState, false),
      confidence,
      reasons,
      warnings: warn,
      evidence: [
        {
          sourceFileId: p.sourceFileId,
          sourceFilename: p.sourceFilename,
          column: p.column,
          sourceValue: `${p.firstName} ${p.surname}`.trim(),
          rowCount: bucket.learnerKeys.size,
        },
      ],
      matchedExistingParentId: decision.parentId,
      candidateSummaries,
      learnerKeys: [...bucket.learnerKeys],
      isShellOrJunk: false,
      operatorMessage,
    };
    people.push(person);

    if (
      matchState === "REVIEW_REQUIRED" ||
      matchState === "IDENTITY_CONFLICT" ||
      matchState === "INSUFFICIENT_EVIDENCE"
    ) {
      reviewItems.push({
        proposalId,
        kind: "person",
        message: operatorMessage,
        severity: person.severity,
      });
    }

    for (const lk of bucket.learnerKeys) {
      const learner = learnerByKey.get(lk) || null;
      const linkState: ParentLearnerLinkProposal["matchState"] =
        matchState === "MATCHED_EXISTING" || matchState === "PROPOSED_NEW"
          ? matchState
          : matchState === "IGNORED"
            ? "IGNORED"
            : "REVIEW_REQUIRED";
      links.push({
        linkId: `plink_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
        parentProposalId: proposalId,
        learnerKey: lk,
        learnerLabel: learner
          ? `${learner.firstName} ${learner.lastName}`.trim()
          : p.learnerLabel,
        learnerIdNumber: learner?.idNumber || p.learnerIdNumber,
        admissionNo: learner?.admissionNo || p.admissionNo,
        relation: p.relationship,
        canonicalLearnerId: learner?.id || null,
        matchState: linkState,
        severity:
          linkState === "REVIEW_REQUIRED" && !learner
            ? "NON_CRITICAL"
            : linkState === "REVIEW_REQUIRED"
              ? "CRITICAL"
              : "INFO",
        warnings: learner
          ? []
          : ["Learner not found in EduClear yet — link after learners are migrated."],
      });
    }
  }

  const blockingReview = reviewItems.filter((r) => r.severity === "CRITICAL").length;
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        people: people.map((p) => ({
          n: p.displayName,
          id: p.idNumber,
          s: p.matchState,
          m: p.matchedExistingParentId,
          l: p.learnerKeys,
        })),
      })
    )
    .digest("hex")
    .slice(0, 24);

  const discovery: ParentFamilyDiscovery = {
    discoveryId: `pfdisc_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    version: PARENT_FAMILY_MIGRATION_VERSION,
    generatedAt: new Date().toISOString(),
    targetSchoolId: input.targetSchoolId,
    stageId: input.stageId || null,
    sourceParentRecords: people.length + ignored > people.length ? people.length : people.length,
    automaticallyResolved: auto,
    proposedNew,
    reviewRequired: review,
    conflicts,
    insufficientEvidence: insufficient,
    ignoredShell: ignored,
    plainLanguage: [
      `${auto} parent${auto === 1 ? "" : "s"} resolved automatically.`,
      `${proposedNew} new parent${proposedNew === 1 ? "" : "s"} ready to create.`,
      `${review} need${review === 1 ? "s" : ""} your review.`,
      `${ignored} incomplete source record${ignored === 1 ? "" : "s"} ignored.`,
      blockingReview
        ? `${blockingReview} blocking review item${blockingReview === 1 ? "" : "s"} must be resolved before acceptance.`
        : "No blocking parent identity conflicts.",
    ],
  };
  discovery.sourceParentRecords = people.length;

  const plan: ParentFamilyMigrationPlan = {
    planId: `pfplan_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    version: PARENT_FAMILY_MIGRATION_VERSION,
    generatedAt: discovery.generatedAt,
    targetSchoolId: input.targetSchoolId,
    stageId: input.stageId || null,
    sourceAnalysisId: input.sourceAnalysisId || null,
    fingerprint,
    discoveryId: discovery.discoveryId,
    people,
    links,
    warnings,
    reviewItems,
    criticalUnresolvedCount: blockingReview,
    nonCriticalUnresolvedCount: reviewItems.filter((r) => r.severity === "NON_CRITICAL").length,
    metrics: {
      sourceParentRecords: people.length,
      automaticallyResolved: auto,
      proposedNew,
      reviewRequired: review,
      blockingReview,
      ignored,
      manualMappingActionsRequired: 0,
    },
    stale: false,
  };

  return { discovery, plan };
}
