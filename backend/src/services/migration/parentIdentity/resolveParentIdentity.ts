/**
 * Authoritative migration parent identity resolver.
 *
 * ONE REAL PERSON = ONE Parent record.
 * Surname / first name are NEVER unique identity keys.
 * Cell or email alone NEVER auto-merge.
 * familyAccountId is NOT part of person identity.
 *
 * Decisions: REUSE_EXISTING | CREATE_NEW | REVIEW_REQUIRED | CONFLICT
 * Never silently guesses a merge under ambiguity.
 */

import {
  firstNamesCompatible,
  maskCellphone,
  maskEmail,
  maskIdentityNumber,
  normalizeParentCellphone,
  normalizeParentEmail,
  normalizeParentIdentityNumber,
  sourceIdentityKey,
} from "./normalizeParentIdentity";
import type {
  ExistingParentCandidate,
  IncomingParentIdentity,
  ParentIdentityCandidateView,
  ParentIdentityDecision,
  ParentIdentityMatchReason,
} from "./parentIdentityTypes";

export type ResolveParentIdentityInput = {
  incoming: IncomingParentIdentity;
  candidates: ExistingParentCandidate[];
  /**
   * In-run map of `${SOURCE}::${sourceParentId}` → EduClear Parent.id
   * Enables Level 2 without schema changes.
   */
  sourceParentIdMap?: Map<string, string>;
};

function candidateView(
  c: ExistingParentCandidate,
  matchReasons: ParentIdentityMatchReason[],
  conflictReasons: ParentIdentityMatchReason[]
): ParentIdentityCandidateView {
  return {
    parentId: c.id,
    firstName: c.firstName,
    surname: c.surname,
    maskedIdNumber: maskIdentityNumber(c.idNumber),
    maskedCellphone: maskCellphone(c.cellNo),
    maskedEmail: maskEmail(c.email),
    matchReasons,
    conflictReasons,
  };
}

function uniqueReasons(list: ParentIdentityMatchReason[]): ParentIdentityMatchReason[] {
  return [...new Set(list)];
}

/**
 * Resolve whether an incoming source parent should reuse an existing Parent,
 * create new, require review, or conflict.
 */
export function resolveParentIdentity(input: ResolveParentIdentityInput): ParentIdentityDecision {
  const { incoming, candidates } = input;
  const sourceParentIdMap = input.sourceParentIdMap || new Map<string, string>();

  const inId = normalizeParentIdentityNumber(incoming.idNumber);
  const inEmail = normalizeParentEmail(incoming.email);
  const inCell = normalizeParentCellphone(incoming.cellNo);
  const srcKey = sourceIdentityKey(incoming.sourceSystem, incoming.sourceParentId);

  const reasons: ParentIdentityMatchReason[] = [];
  const conflictReasons: ParentIdentityMatchReason[] = [];
  const views: ParentIdentityCandidateView[] = [];

  // --- Level 2: stable source parent id already mapped this run / prior mapping ---
  if (srcKey && sourceParentIdMap.has(srcKey)) {
    const mappedId = sourceParentIdMap.get(srcKey)!;
    const mapped = candidates.find((c) => c.id === mappedId);
    reasons.push("STABLE_SOURCE_PARENT_ID");
    if (mapped) {
      views.push(candidateView(mapped, ["STABLE_SOURCE_PARENT_ID"], []));
    }
    return {
      decision: "REUSE_EXISTING",
      parentId: mappedId,
      confidence: "HIGH",
      reasons: uniqueReasons(reasons),
      conflictReasons: [],
      candidates: views,
      recommendedAction: "REUSE",
    };
  }

  // Annotate each candidate
  type Scored = {
    candidate: ExistingParentCandidate;
    match: ParentIdentityMatchReason[];
    conflict: ParentIdentityMatchReason[];
    candId: string | null;
    cellMatch: boolean;
    emailMatch: boolean;
    firstCompatible: boolean;
  };

  const scored: Scored[] = candidates.map((c) => {
    const candId = normalizeParentIdentityNumber(c.idNumber);
    const candEmail = normalizeParentEmail(c.email);
    const candCell = normalizeParentCellphone(c.cellNo);
    const match: ParentIdentityMatchReason[] = [];
    const conflict: ParentIdentityMatchReason[] = [];

    const cellMatch = Boolean(inCell && candCell && inCell === candCell);
    const emailMatch = Boolean(inEmail && candEmail && inEmail === candEmail);
    const firstCompatible = firstNamesCompatible(incoming.firstName, c.firstName);

    if (inId && candId && inId === candId) match.push("EXACT_IDENTITY_NUMBER");
    if (inId && candId && inId !== candId) conflict.push("CONFLICTING_IDENTITY_NUMBERS");
    if (emailMatch) {
      match.push("NORMALIZED_EMAIL_MATCH");
      const rawIn = String(incoming.email || "").trim();
      const rawCand = String(c.email || "").trim();
      if (rawIn && rawCand && rawIn !== rawCand) match.push("EMAIL_CASE_NORMALIZED");
    }
    if (cellMatch) {
      match.push("NORMALIZED_CELLPHONE_MATCH");
      const rawIn = String(incoming.cellNo || "").replace(/\D/g, "");
      const rawCand = String(c.cellNo || "").replace(/\D/g, "");
      if (rawIn && rawCand && rawIn !== rawCand) match.push("CELLPHONE_FORMAT_NORMALIZED");
    }
    if (firstCompatible) match.push("COMPATIBLE_FIRST_NAME");

    // Surname difference is never a conflict and never required
    const inSur = String(incoming.surname || "").trim().toLowerCase();
    const cSur = String(c.surname || "").trim().toLowerCase();
    if (inSur && cSur && inSur !== cSur && (match.includes("EXACT_IDENTITY_NUMBER") || (cellMatch && emailMatch))) {
      match.push("SURNAME_DIFFERENCE_IGNORED");
    }

    return { candidate: c, match, conflict, candId, cellMatch, emailMatch, firstCompatible };
  });

  // --- CONFLICT: contact overlap with disagreeing non-empty IDs ---
  const conflictHits = scored.filter(
    (s) =>
      s.conflict.includes("CONFLICTING_IDENTITY_NUMBERS") &&
      (s.cellMatch || s.emailMatch || s.match.includes("COMPATIBLE_FIRST_NAME"))
  );
  if (conflictHits.length) {
    for (const s of conflictHits) {
      views.push(candidateView(s.candidate, s.match, s.conflict));
      conflictReasons.push(...s.conflict);
    }
    return {
      decision: "CONFLICT",
      parentId: null,
      confidence: "HIGH",
      reasons: ["CONFLICTING_IDENTITY_NUMBERS"],
      conflictReasons: uniqueReasons(conflictReasons),
      candidates: views,
      recommendedAction: "CONFLICT",
    };
  }

  // Also: incoming ID matches one parent, but another parent shares cell with a different ID already handled above.
  // If incoming has ID that matches exactly one candidate → Level 1 REUSE regardless of surname.
  const idHits = scored.filter((s) => s.match.includes("EXACT_IDENTITY_NUMBER"));
  if (inId && idHits.length === 1) {
    const hit = idHits[0]!;
    reasons.push(...hit.match);
    views.push(candidateView(hit.candidate, hit.match, hit.conflict));
    return {
      decision: "REUSE_EXISTING",
      parentId: hit.candidate.id,
      confidence: "HIGH",
      reasons: uniqueReasons(reasons),
      conflictReasons: [],
      candidates: views,
      recommendedAction: "REUSE",
    };
  }
  if (inId && idHits.length > 1) {
    // Duplicate existing Parents sharing same ID — should be impossible under @unique; treat as conflict.
    for (const s of idHits) views.push(candidateView(s.candidate, s.match, s.conflict));
    return {
      decision: "CONFLICT",
      parentId: null,
      confidence: "HIGH",
      reasons: ["AMBIGUOUS_CANDIDATES", "EXACT_IDENTITY_NUMBER"],
      conflictReasons: ["AMBIGUOUS_CANDIDATES"],
      candidates: views,
      recommendedAction: "CONFLICT",
    };
  }

  // Incoming has ID that does not match any candidate ID, but contact matches a candidate that HAS a different ID → CONFLICT
  if (inId) {
    const contactWithOtherId = scored.filter(
      (s) => (s.cellMatch || s.emailMatch) && s.candId && s.candId !== inId
    );
    if (contactWithOtherId.length) {
      for (const s of contactWithOtherId) {
        views.push(
          candidateView(s.candidate, s.match, [
            ...s.conflict,
            "CONFLICTING_IDENTITY_NUMBERS",
          ])
        );
      }
      return {
        decision: "CONFLICT",
        parentId: null,
        confidence: "HIGH",
        reasons: ["CONFLICTING_IDENTITY_NUMBERS"],
        conflictReasons: ["CONFLICTING_IDENTITY_NUMBERS"],
        candidates: views,
        recommendedAction: "CONFLICT",
      };
    }
  }

  // --- Level 3: strong corroboration without ID ---
  // Threshold: normalized cell AND normalized email AND compatible first name.
  // No conflicting identity numbers (already filtered).
  // Different Kid-e-Sys sourceParentId does NOT block this (DIFFERENT_SOURCE_PARENT_ID_IGNORED).
  const strongHits = scored.filter(
    (s) => s.cellMatch && s.emailMatch && s.firstCompatible && !s.conflict.length
  );
  if (strongHits.length === 1) {
    const hit = strongHits[0]!;
    reasons.push(...hit.match);
    if (
      incoming.sourceParentId &&
      srcKey &&
      // mapped under a different key earlier would have returned; note multi parent_id case
      true
    ) {
      reasons.push("DIFFERENT_SOURCE_PARENT_ID_IGNORED");
    }
    views.push(candidateView(hit.candidate, hit.match, hit.conflict));
    return {
      decision: "REUSE_EXISTING",
      parentId: hit.candidate.id,
      confidence: "HIGH",
      reasons: uniqueReasons(reasons),
      conflictReasons: [],
      candidates: views,
      recommendedAction: "REUSE",
    };
  }
  if (strongHits.length > 1) {
    for (const s of strongHits) views.push(candidateView(s.candidate, s.match, s.conflict));
    return {
      decision: "REVIEW_REQUIRED",
      parentId: null,
      confidence: "MEDIUM",
      reasons: ["AMBIGUOUS_CANDIDATES", "NORMALIZED_CELLPHONE_MATCH", "NORMALIZED_EMAIL_MATCH"],
      conflictReasons: ["AMBIGUOUS_CANDIDATES"],
      candidates: views,
      recommendedAction: "REVIEW",
    };
  }

  // --- Level 4: single contact match ---
  const cellOnly = scored.filter((s) => s.cellMatch && !s.emailMatch);
  const emailOnly = scored.filter((s) => s.emailMatch && !s.cellMatch);
  const singleContact = [...cellOnly, ...emailOnly].filter((s) => !s.conflict.length);

  if (singleContact.length) {
    for (const s of singleContact) {
      const m: ParentIdentityMatchReason[] = [...s.match, "SINGLE_CONTACT_ONLY"];
      views.push(candidateView(s.candidate, m, s.conflict));
    }
    // Special: cell + compatible first, no email on either side, no IDs → still REVIEW (Test 9)
    return {
      decision: "REVIEW_REQUIRED",
      parentId: null,
      confidence: "LOW",
      reasons: uniqueReasons([
        ...singleContact.flatMap((s) => s.match),
        "SINGLE_CONTACT_ONLY",
        "NO_STRONG_IDENTITY",
      ]),
      conflictReasons: [],
      candidates: views,
      recommendedAction: "REVIEW",
    };
  }

  // Both cell and email match but first name incompatible → REVIEW (possible shared household contact)
  const contactBothNameMismatch = scored.filter(
    (s) => s.cellMatch && s.emailMatch && !s.firstCompatible && !s.conflict.length
  );
  if (contactBothNameMismatch.length) {
    for (const s of contactBothNameMismatch) {
      views.push(candidateView(s.candidate, [...s.match, "SINGLE_CONTACT_ONLY"], s.conflict));
    }
    return {
      decision: "REVIEW_REQUIRED",
      parentId: null,
      confidence: "MEDIUM",
      reasons: ["NORMALIZED_CELLPHONE_MATCH", "NORMALIZED_EMAIL_MATCH", "NO_STRONG_IDENTITY"],
      conflictReasons: [],
      candidates: views,
      recommendedAction: "REVIEW",
    };
  }

  // --- Level 5: name-only signal among candidates (never auto-reuse) ---
  const nameOnly = scored.filter(
    (s) =>
      s.firstCompatible &&
      !s.cellMatch &&
      !s.emailMatch &&
      !s.match.includes("EXACT_IDENTITY_NUMBER")
  );
  if (nameOnly.length) {
    for (const s of nameOnly) {
      views.push(candidateView(s.candidate, ["NAME_ONLY", "COMPATIBLE_FIRST_NAME"], s.conflict));
    }
    return {
      decision: "CREATE_NEW",
      parentId: null,
      confidence: "LOW",
      reasons: ["NAME_ONLY"],
      conflictReasons: [],
      candidates: views,
      recommendedAction: "CREATE",
    };
  }

  // No evidence of an existing person → create new
  return {
    decision: "CREATE_NEW",
    parentId: null,
    confidence: "HIGH",
    reasons: ["NO_STRONG_IDENTITY"],
    conflictReasons: [],
    candidates: [],
    recommendedAction: "CREATE",
  };
}
