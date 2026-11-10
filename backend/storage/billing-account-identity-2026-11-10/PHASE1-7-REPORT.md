# EduClear — Billing Account Identity Correction (Phases 1–7)

**Worktree:** `/Users/tony-/Development/educlear-fix-billing-account-identity`  
**Branch:** `fix/billing-account-identity-contract`  
**Baseline:** `684e0a7` (current production)  
**Original workspace:** untouched (`feature/homesafe-collections-v2` @ `2a72be1`)  
**Status:** Local implementation only — **not deployed**, no migrations, no production data writes.

---

## 1. Root-cause analysis

Fly Eagle statement PDF failures (`Account not found for statement PDF`) are caused by **identifier type confusion**, not missing ledger data.

### Failure chain

1. Statement list rows set `accountNo` to the **ledger join key** (`FamilyAccount.accountRef`). For Fly Eagle that is an Express customer name, not a Kid-e-Sys code. Rows also expose `familyAccountId` and optional `eduClearAccountNo` (e.g. `ABA001`).
2. `StatementManage.resolveSelectedAccountRef` used **Kid-e-Sys-only** `normalizeKidESysAccountRef`, which **drops** Express refs → empty `accountRef` for PDF calls.
3. `persistBillingAccount` / `SchoolDashboard.setActiveBillingAccount` filled gaps with:
   - `learnerId: account.learnerId || account.id || account.accountNo`
   - so a **FamilyAccount id** or **Express accountRef** was sent as `learnerId`.
4. Backend `resolveStatementAccountRef` only resolved:
   - `accountNo` → FamilyAccount by accountNo/accountRef
   - `learnerId` → **Learner.id only**
   - It never treated an untyped string as `FamilyAccount.id` (correct — guessing would be unsafe).
5. Result: Learner lookup fails → `Account not found for statement PDF`.
6. Zero-learner Fly Eagle accounts (~90) are especially exposed: no real learner id, Express ref filtered out, FA id wrongly sent as `learnerId`.

### What is *not* wrong

- Ledger balances / account numbers / family–learner links
- Payment posting (already uses explicit `familyAccountId`)
- Invoice calculation
- Parent portal PDF (uses authenticated parent → real linked `learnerId`)

---

## 2. Affected call sites

| Area | Location | Issue | Minimal-release action |
|------|----------|-------|------------------------|
| Individual Statements UI | `StatementManage.tsx` `persistBillingAccount`, `resolveSelectedAccountRef`, PDF/email | FA id / accountNo stuffed into `learnerId`; Express refs dropped | **Fixed** |
| Statement PDF API | `GET /api/statements/pdf` | No `familyAccountId` / typed identity | **Fixed** (additive) |
| Statement PDF resolve | `statementPdfData.resolveStatementAccountRef` | Untyped `learnerId` only | Legacy preserved; explicit path added |
| Statement email | `POST /api/emails/send-statement` | Same as PDF | **Fixed** (additive) |
| School dashboard selection | `SchoolDashboard.setActiveBillingAccount` | Puts accountNo into learnerId | **Fixed** |
| Finance Hub / Collections | `FinanceHubPage`, `FinanceCollectionsCentre` | `learnerId \|\| id` fallback | **Fixed** (pass `familyAccountId`) |
| SMS statements | Already accepts `familyAccountId` | OK | No change |
| Outstanding / Age Analysis | Uses family/accountRef | List identity OK | Broader typed contract later |
| Invoice runs / bulk PDF | Uses accountRef from run | OK for this release | Separate from this hotfix |
| Payments | `familyAccountId` typed | OK | No change |
| Parent portal | Real learner ids | OK | Later: optional FA identity |
| Admissions → billing | Links FA ids | Out of scope | Separate plan |

### Ambiguous frontend fallback chains (pre-fix)

```text
learnerId: account.learnerId || account.id || account.accountNo
id:        account.id || account.learnerId || account.accountNo
learnerId: snapshot.row.learnerId || snapshot.row.id
```

These mix Learner id, FamilyAccount id, and billing accountRef under one field name.

---

## 3. Recommended permanent account identity design

```typescript
type BillingAccountIdentity =
  | { type: "familyAccountId"; value: string }
  | { type: "accountRef"; value: string }
  | { type: "accountNo"; value: string }
  | { type: "learnerId"; value: string };
```

Central resolver: `backend/src/services/billingAccountIdentity.ts`

1. Requires authenticated `schoolId`
2. Requires explicit `type` + `value`
3. Resolves school-owned FamilyAccount → ledger `accountRef`
4. Verifies school ownership
5. Returns `409 AMBIGUOUS` when multiple distinct refs match
6. Returns `404 NOT_FOUND` for missing **and** cross-tenant (no existence leak)
7. Never silently picks another family
8. Supports zero-learner family accounts

---

## 4. Backward-compatibility strategy

| Rule | Implementation |
|------|----------------|
| Preserve endpoints | Same `GET /pdf`, `POST /send-statement` |
| Preserve ledger refs / account numbers | Resolver returns existing `accountRef`; no rewrites |
| Preserve family/learner relationships | Read-only resolution |
| Migration period | New optional query/body fields; legacy fields unchanged |
| No guessing untyped strings | Untyped `learnerId` still means **Learner.id only** |
| Explicit fields for new callers | `familyAccountId`, `accountIdentityType`, `accountIdentityValue` |
| Ambiguous → controlled error | HTTP 409 + `code: AMBIGUOUS` |
| No payment/invoice calc changes | Out of scope |

If a future change must alter meaning of `learnerId`, introduce a **versioned** endpoint rather than redefining the field.

---

## 5. Minimal safe statement fix (this worktree)

### Backend

- New `billingAccountIdentity.ts` + unit tests
- `BuildStatementPdfOptions` gains `familyAccountId` / typed identity fields
- `resolveAccountStatementScope` uses explicit path when `familyAccountId` or typed envelope present; otherwise legacy `resolveStatementAccountRef`
- Routes accept additive fields; map `BillingAccountResolutionError` to 400/404/409

### Frontend

- Never send FamilyAccount id as `learnerId`
- Source-agnostic account ref (Express + Kid-e-Sys)
- PDF / print / email pass `familyAccountId` when known
- Dashboard / Finance Hub / Collections stop inventing learner ids from account numbers

### Fly Eagle protection (Phase 5)

- No create/delete/merge/link/ledger rewrite
- Zero-learner accounts resolve via `familyAccountId` → `accountRef`
- Unresolved identities error explicitly (404/409), never guess

---

## 6. Regression test results

| Test | Result |
|------|--------|
| `billingAccountIdentity.unit.test.ts` (pure + local DB scenarios 1–4, 8–11) | **OK** |
| `statementAccountIdentity.test.ts` | **OK** |
| `phase2AuthStabilisation.test.ts` | **OK** |
| `statementSourceAgnostic.test.ts` | **OK** |
| Backend `tsc --noEmit` | **OK** |

Scenarios covered by resolver tests: native 1-learner, multi-learner, Fly Eagle dual identity, zero learners, explicit learnerId/FA id/accountNo, missing, ambiguous, cross-school, SA-SAMS reject.

Manual / staging still required before deploy: individual PDF, bulk PDF, email, invoice/payment smoke on **EduClear Test School** (not Da Silva writes).

---

## 7. Proposed release and rollback

### Release (statement-identity only — separate from bulk-PDF `365fe31`)

1. Confirm approval for **paired** backend + frontend deploy from this branch after commit.
2. Pre-deploy: backup `billing-ledger.json` (backend deploy hygiene); record SHAs + frontend build id.
3. Deploy backend then frontend (or as one pair).
4. Read-only verify:
   - Fly Eagle: open a zero-learner account statement PDF + a linked-learner PDF
   - Da Silva: spot-check known account PDF (read-only)
   - Email statement still works
5. Do **not** combine with bulk single-pass PDF performance release.

### Rollback

- Redeploy previous production pair: backend + frontend at `684e0a7`
- No data migration to undo (resolver is additive; no ledger/schema changes)

### Out of scope for this first release (separate reviewed plan)

- Retyping Outstanding / Age Analysis / Invoice Run request contracts
- Parent portal typed FA identity
- Removing legacy `learnerId` query permanently
- Any account merge / learner auto-link / accountNo backfill

---

## Appendix — Full inventory (audit subagent)

A read-only inventory across statements, payments, invoice runs, parent portal, admissions, and migration confirmed:

- Only intentional FA.id acceptors for money/comms today: capture payment + statement/outstanding SMS.
- Highest remaining systemic risks **outside** this minimal release: `resolveLearnerAccountNo` / `getLearnerAccountNo` admission fallbacks (FE/BE order mismatch); `row.learnerId || row.id` where `id` is often FA.id (`billingLedger` mapper); invoice official-ref admission path; parent-portal grouping via admission when FA missing.
- Those belong in a **separate reviewed architecture plan**, not this statement hotfix.

Statement Manage transactions path (audit hotspot #1: `accountNo || learnerId` into `resolveBillingAccountRef`) was closed in this follow-up: same typed `familyAccountId` resolution as PDF; learnerId is never treated as an accountRef.

---

## Files changed (local, uncommitted)

- `backend/src/services/billingAccountIdentity.ts` (new)
- `backend/src/services/billingAccountIdentity.unit.test.ts` (new)
- `backend/src/services/statementPdfData.ts`
- `backend/src/services/statementPdfTypes.ts`
- `backend/src/services/statementEmailService.ts`
- `backend/src/routes/statements.ts`
- `backend/src/routes/emails.ts`
- `frontend/src/billing/StatementManage.tsx`
- `frontend/src/billing/statementDocument.ts`
- `frontend/src/billing/statementAccountIdentity.test.ts` (new)
- `frontend/src/billing/FinanceHubPage.tsx`
- `frontend/src/billing/FinanceCollectionsCentre.tsx`
- `frontend/src/SchoolDashboard.tsx`
