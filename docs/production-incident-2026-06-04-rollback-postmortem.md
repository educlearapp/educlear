# EduClear Production Incident — Post-Mortem & Prevention

**Incident date:** 2026-06-04  
**Severity:** P1 (live billing statements unusable; school profile corrupted)  
**Status:** Mitigated via backend rollback, frontend rollback, and manual school profile DB/API repair  
**Document owner:** Engineering / Ops  
**Scope:** Production only (`educlear-backend.onrender.com`, `educlear-frontend.onrender.com`, Da Silva Academy live school)

**Binding policy (ongoing):** [Permanent Deployment Rules](./permanent-deployment-rules.md)

---

## Executive summary

A production deploy introduced frontend billing refresh behavior that **cleared in-memory statement caches before a successful API repopulation**. When statement sync failed or returned an empty list, the Statements UI showed **0 accounts** and summary totals were computed from that empty set. The Da Silva baseline overlay then applied large negative-looking card totals relative to a zero-account live summary.

Separately, the live **School** profile row for Da Silva Academy (`cmpideqeq0000108xb6ouv9zi`) was overwritten during testing to **`name: "x"`** and **`email: null`**, causing blank business information in School Profile.

Recovery required:

1. **Backend rollback** to known-good commit `32715bd`
2. **Frontend rollback** via Render Static Site manual deploy (commit `32715bd`, env `VITE_FEE_CHECK_BUILD_ID=32715bd-rollback`)
3. **School profile repair** restoring approved name, email, and logo URL

No further production deploys or data writes should occur until pre-deploy and production guard checklists below are satisfied.

---

## Timeline

| Time (approx.) | Event |
|----------------|--------|
| Pre-incident | Production stable on backend/frontend aligned around commit **`32715bd`** (`fix(billing): make payment balances authoritative and device consistent`). Da Silva Statements expected **~344 accounts** with Kid-e-Sys-aligned summary cards. |
| Deploy | Bad/live regression deployed, including frontend commit **`f3473ea`** (`fix(billing): align statement summary with visible ledger and refresh in real time`) and/or subsequent commits on `main` before rollback (e.g. **`6551fd7`** Phase 1 launch, other billing/statement refresh changes). |
| User impact | **Statements:** 0 accounts listed; summary cards showed incorrect/negative totals. **School Profile:** business name/email blank or wrong (DB had `name: "x"`, `email: null`). |
| Detection | Operators/users observed empty Statements and blank profile in production while logged into Da Silva Academy. |
| Mitigation — backend | Backend rolled back to **`32715bd89336da60b8ddddf1961b54b971bbce48`**. |
| Mitigation — frontend | Frontend required **Render Static Site manual deploy** (auto-deploy from repo insufficient or out of sync). Rollback script `backend/scripts/trigger-frontend-rollback-deploy.mjs` targets commit **`32715bd`**, sets `VITE_FEE_CHECK_BUILD_ID=32715bd-rollback`, triggers deploy with `clearCache: true`, optional Cloudflare purge. |
| Mitigation — data | School profile row repaired via controlled update (script `repair-da-silva-school-profile.ts` and/or `PUT /api/schools/:id`) to approved values. |
| Post-recovery verification | `GET /api/schools/cmpideqeq0000108xb6ouv9zi` returns `name: Da Silva Academy`, `email: dasilvaacademy@gmail.com`, `logoUrl: /uploads/school-logos/da-silva-academy-logo.png`. Statements must show **344 accounts** (not 0) after rollback. |

---

## Commits involved

| Role | Commit | Message (short) |
|------|--------|-----------------|
| **Stable / rollback target** | `32715bd` (`32715bd89336da60b8ddddf1961b54b971bbce48`) | `fix(billing): make payment balances authoritative and device consistent` |
| **Regression (primary suspect)** | `f3473ea` | `fix(billing): align statement summary with visible ledger and refresh in real time` |
| **Later on regression line** | `6551fd7` | `feat(launch): Phase 1 security, billing accuracy, and portal access controls` |
| **Other nearby** | `bdcffd3`, `02782a9`, etc. | PWA icons, fees lookup — verify if included in failed deploy window |

**Rollback artifacts in repo:**

- `render.yaml` — `VITE_FEE_CHECK_BUILD_ID: 32715bd-rollback`
- `backend/scripts/trigger-frontend-rollback-deploy.mjs` — pins `COMMIT = 32715bd89336da60b8ddddf1961b54b971bbce48`

---

## Root cause analysis

### 1. Statement cache cleared before successful API replacement

`refreshBillingFromApi` in `frontend/src/billing/billingApi.ts` calls **`clearSchoolBillingDisplayCache(schoolId)`** first, then syncs statements/history/ledger. Clearing deletes in-memory statement accounts, summaries, and history (`kidesysTransactionHistory.ts`).

If the network request fails, times out, or returns **HTTP non-OK**, the UI can render with **no cached rows** until a later successful sync.

### 2. Failed statement sync treated as empty success

`syncStatementSummariesFromApi` only writes cache when `rows.length > 0`:

```ts
const rows = await fetchStatements(sid);
if (!rows.length) return; // no write — cache already cleared
```

Combined with (1), a failed or empty response leaves **zero accounts** in memory with no fallback to last-good data.

### 3. Totals calculated from 0 accounts

Summary cards and billing calculations use `statementRows.length` / included account lists. With 0 rows, **`accountsCount` becomes 0** and monetary aggregates collapse or skew.

For Da Silva, **`mergeDaSilvaSummaryWithKidesysBaseline`** (`billingSummaryDisplayOverride.ts`) still applies Kid-e-Sys baseline **deltas** against live totals. When live `accountsCount` is 0 and live monetary sums are 0, card math produces **misleading negative or offset totals** instead of preserving the last known good overview.

### 4. Frontend and backend deployed out of sync

Backend rolled back to `32715bd` while frontend may have remained on a newer build until **manual Render Static Site deploy**. Mismatched API contracts, refresh timing, or bundle behavior can worsen statement/profile symptoms. Deploy **backend and frontend together** from the same known-good commit set.

### 5. School profile data overwritten during testing

Production `School` row was updated (likely via unauthenticated or test **`PUT /api/schools/:id`** with dummy values) to **`name: "x"`**, **`email: null`**. `SchoolProfilePage` on failed GET also resets the form to empty (`createEmptySchoolProfileForm()`), which **looks like blank business info** even when the issue is load failure or bad API data.

**Canonical live school id:** `cmpideqeq0000108xb6ouv9zi` (Da Silva Academy) — must never be used as a write target for smoke or manual API tests.

---

## What was fixed

| Area | Action |
|------|--------|
| **Backend** | Rolled back to commit **`32715bd`** on Render web service `educlear-backend`. |
| **Frontend** | Rolled back via Render Static Site manual deploy to **`32715bd`**, `VITE_FEE_CHECK_BUILD_ID=32715bd-rollback`, production API URL unchanged. |
| **School profile** | Repaired production row: `name: Da Silva Academy`, `email: dasilvaacademy@gmail.com`, `logoUrl: /uploads/school-logos/da-silva-academy-logo.png`. Phone/cell/address/banking left null. No billing/learner/parent/migration data touched. |

---

## Follow-on incident (2026-06-04): Top-up ledger wiped on backend deploy

Deploying backend commit **`62f1b5e`** (`fix(billing): count top-up payments in balance delta`) replaced the **runtime** `backend/data/billing-ledger.json` with the **git-bundled** copy. The Render web service **`educlear-backend`** has **no persistent disk**; billing data is still **JSON file–based** under `process.cwd()/data/`. The previous container held **92** live `kidesys_topup` payment rows (batch `cmpzmiq970029wh6arh0iq3lj` in Postgres); the new container started from repo JSON with **0** top-up rows. **Postgres batch metadata survived**; only the ledger file state was lost. Recovery path: idempotent restore from `MigrationTopupPaymentRow` via `backend/scripts/restore-topup-payments-from-batch.ts` (dry-run first). **Prevention:** attach a persistent disk for `data/`, pre-deploy ledger backup, and/or migrate billing ledger off JSON.

---

## What must never happen again

1. **No production smoke tests that create real invoice, payment, or profile records** on live schools (especially Da Silva).
2. **No deploy without a documented rollback plan** (commit SHA, Render service names, env vars, cache purge steps).
3. **No cache clearing before a successful fetch** repopulates statement/billing display data.
4. **No totals or summary cards from an empty failed sync** — treat 0 accounts after clear+failed sync as an error state, not valid data.
5. **No frontend/backend mismatch deploy** — ship pairs from the same release tag or commit range.
6. **No profile `PUT` tests against production** with placeholder values (`"x"`, null email, test strings).
7. **Never apply Da Silva baseline overlay when `accountsCount === 0` from a failed API** — that masks a data outage as “adjusted” totals.

---

## Pre-deploy checklist

Use this before any production deploy (backend **and** frontend).

### Build & repo hygiene

- [ ] `cd backend && npm ci && npm run build` — **passes**
- [ ] `cd frontend && npm ci && npm run build` — **passes**
- [ ] `git status` — **no unrelated files** staged or committed
- [ ] Changelog / PR lists only intended scope (no accidental billing/profile experiments)

### Local verification

- [ ] Local stack tested against **local DB** or dedicated dev DB
- [ ] Statements load with **non-zero** account count for test school
- [ ] School Profile load/save tested locally (no dummy production values)

### Staging / test school only (writes)

- [ ] All write tests use **`TEST_SCHOOL_ID`** (not `cmpideqeq0000108xb6ouv9zi`)
- [ ] No invoice runs, payments, or profile PUTs against Da Silva live school in test scripts

### Production (read-only first)

- [ ] `GET /api/schools/cmpideqeq0000108xb6ouv9zi` — name/email/logo **before** deploy
- [ ] `GET /api/statements` (or equivalent) — account count **before** deploy (~**344** for Da Silva)
- [ ] Note current frontend bundle marker (`VITE_FEE_CHECK_BUILD_ID` or built asset hash)

### Deploy execution

- [ ] Rollback commit SHA recorded: **`32715bd`** or new approved SHA
- [ ] Deploy **backend and frontend together** (same release)
- [ ] Render: confirm service names `educlear-backend`, `educlear-frontend`
- [ ] After deploy: verify **bundle/hash/commit** in browser (build id env or network tab on main JS)

### Post-deploy verification (production, read-only)

- [ ] Statements: **344 accounts** (not 0) for Da Silva
- [ ] Summary cards: sane totals (no “all zeros then negative overlay” pattern)
- [ ] School Profile: **Da Silva Academy**, **dasilvaacademy@gmail.com**, logo visible
- [ ] `GET /api/schools/cmpideqeq0000108xb6ouv9zi` matches UI

---

## Production guard checklist

Ongoing controls (process + code policy; not all implemented yet).

### Write safety

- [ ] **Disable or block** production-write smoke tests in CI and local scripts by default
- [ ] Require **`CONFIRM_PRODUCTION_WRITE=true`** for any script that mutates production DB/API
- [ ] Require explicit **`TEST_SCHOOL_ID`** for all write tests; forbid Da Silva canonical id in write allowlists

### Statements / billing UI

- [ ] **Keep last-good statement cache** if API fetch fails (do not delete until replacement succeeds)
- [ ] On failed sync: show **error banner**, not empty grid with 0 accounts
- [ ] **Never apply** `mergeDaSilvaSummaryWithKidesysBaseline` when `accountsCount === 0` from failed/empty API
- [ ] Debounce rapid `refreshBillingFromApi` / `BILLING_UPDATED_EVENT` storms (recommended code fix)

### School Profile

- [ ] Profile page must **not blank the form** on failed GET — keep previous values + show error
- [ ] Production profile updates only via approved repair script or authenticated owner flow — never test PUT with `"x"`

### Deploy & ops

- [ ] Every production deploy has rollback commands documented (backend revert SHA, frontend Render manual deploy + `trigger-frontend-rollback-deploy.mjs`)
- [ ] Cloudflare/cache purge steps recorded when frontend assets are sticky

---

## Recommended code fixes (next — do not implement in this incident doc)

Track as follow-up tasks; **not deployed** as part of this post-mortem.

| # | Fix | Rationale |
|---|-----|-----------|
| 1 | **Preserve last-good statement cache on fetch failure** | `clearSchoolBillingDisplayCache` only after successful `writeStatementApiAccounts`; on failure, retain previous memory/local cache. |
| 2 | **Debounce statement refresh events** | Reduce duplicate `refreshBillingFromApi` from `SchoolDashboard`, `Statements`, payments save paths. |
| 3 | **Error banner for failed statement sync** | Visible operator message when `fetchStatements` fails or returns 0 unexpectedly (vs silent empty UI). |
| 4 | **Profile page: do not reset form on failed GET** | `SchoolProfilePage` catch block should set error state, not `createEmptySchoolProfileForm()`. |
| 5 | **Production smoke scripts read-only by default** | Opt-in `CONFIRM_PRODUCTION_WRITE=true`; no invoice/payment/profile creation on prod. |
| 6 | **Separate test school from Da Silva live school** | Hard-coded guard: reject writes when `schoolId === cmpideqeq0000108xb6ouv9zi` unless explicit repair confirm env. |
| 7 | **Guard Da Silva baseline overlay** | Skip `mergeDaSilvaSummaryWithKidesysBaseline` when `live.accountsCount === 0` or sync error flag set. |

**Key files for implementers:**

- `frontend/src/billing/billingApi.ts` — `refreshBillingFromApi`, `syncStatementSummariesFromApi`
- `frontend/src/billing/kidesysTransactionHistory.ts` — `clearSchoolBillingDisplayCache`, memory caches
- `frontend/src/billing/billingSummaryDisplayOverride.ts` — Da Silva baseline merge
- `frontend/src/pages/SchoolProfilePage.tsx` — load error handling
- `backend/src/routes/schools.ts` — `PUT /:id` (consider auth + production write guards)
- `backend/scripts/repair-da-silva-school-profile.ts` — approved profile repair path

---

## Reference: approved Da Silva School profile (post-repair)

| Field | Value |
|-------|--------|
| `schoolId` | `cmpideqeq0000108xb6ouv9zi` |
| `name` | Da Silva Academy |
| `email` | dasilvaacademy@gmail.com |
| `logoUrl` | `/uploads/school-logos/da-silva-academy-logo.png` |

**Verification endpoint:**

```http
GET https://educlear-backend.onrender.com/api/schools/cmpideqeq0000108xb6ouv9zi
```

**Statements sanity check:** Da Silva production should show **344** statement accounts after rollback (Kid-e-Sys migration baseline).

---

## Sign-off

| Role | Name | Date | Notes |
|------|------|------|-------|
| Incident lead | | | |
| Backend owner | | | Rollback `32715bd` |
| Frontend owner | | | Render static rollback |
| Data repair | | | Profile repair only |

---

*This document is informational. It does not authorize deploys or production writes.*
