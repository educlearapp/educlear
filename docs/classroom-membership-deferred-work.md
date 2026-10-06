# Classroom membership — deferred technical work

Canonical classroom membership lives in `backend/src/utils/classroomMembership.ts`
(exact name → case/space-insensitive key → legacy "Grade / Section" alias; ACTIVE learners only).

## Deferred: legal / debt-letter recipient selection

- File: `backend/src/routes/legalBillingDocuments.ts` (class filter, exact `className` match).
- Status: **intentionally unchanged** in the learner/classroom membership change set.
- Reason: legal and debt-letter recipients carry billing/legal impact; changing who receives a
  letter needs its own review and approval.
- Follow-up: route the class filter through `loadSchoolClassMembership(schoolId).spellingsFor(label)`
  (or the resolver) with dedicated tests showing the recipient list before and after.

## Deferred: Da Silva pipe-prefixed classroom labels in production

- Production records `|Grade RA` and `|grade Rb` (16 learners each) are left as-is pending approval.
- Origin: `classDisplayFromMatchKeySuffix` in `ensureDaSilvaAcademyProduction.ts` turned the
  empty-grade match-key delimiter (`|grade ra`) into the display name `|grade Ra`. Fixed locally.
- Before cleaning production: confirm `DA_SILVA_ALLOW_STARTUP_IMPORT` is not `true` on the
  production backend (otherwise a restart re-runs the manifest import and rewrites `className`/`grade`).

## Noted, not changed: manifest import maps "Grade R" to "Creche"

- `classDisplayFromMatchKeySuffix` returns `Creche` for any `ps|...` key, including `ps|grade-r`.
  Only affects the dormant Da Silva manifest import; needs a product decision before changing.
