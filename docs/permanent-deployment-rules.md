# EduClear Permanent Deployment Rules

**Status:** Mandatory for all production deploys, rollbacks, smoke tests, and production data changes.  
**Related:** [Production incident post-mortem (2026-06-04)](./production-incident-2026-06-04-rollback-postmortem.md)

**Live Da Silva Academy school id (writes forbidden unless explicitly approved):** `cmpideqeq0000108xb6ouv9zi`

**Known stable rollback commit (verify before use):** `32715bd89336da60b8ddddf1961b54b971bbce48`

---

## 1. No production writes for testing

Never test invoices, payments, profile updates, users, or billing changes on **Da Silva Academy production** unless explicitly approved in writing for that specific operation.

- Use **EduClear Test School** for all write smoke tests.
- Production scripts must be **read-only by default**.
- Any production write requires explicit approval **and** `CONFIRM_PRODUCTION_WRITE=true` (when implemented).

---

## 2. Backend and frontend deploy together

Never roll back or deploy only one side unless confirmed safe for that exact commit pair.

| Service | Render name | Production URL |
|---------|-------------|----------------|
| Backend | `educlear-backend` | `https://educlear-backend.onrender.com` |
| Frontend | `educlear-frontend` | `https://educlear-frontend.onrender.com` |

Record both commit SHAs and `VITE_FEE_CHECK_BUILD_ID` (or equivalent build marker) in the deploy log.

---

## 3. No cache clearing before successful fetch

Keep **last-good** statement/billing display data.

- Do not call `clearSchoolBillingDisplayCache` (or equivalent) until a successful API response has repopulated the cache.
- If the API fails, **show an error** — do not show blank grids, empty forms, or zeroed totals from a failed load.

---

## 4. Never show 0 accounts from a failed sync

Statements must **not** show **0 accounts** unless the API **confirms 0 real accounts** for that school.

- Failed fetch, timeout, or empty response after cache clear = **error state**, not “0 accounts”.
- Do not apply Da Silva summary baseline overlay when `accountsCount === 0` from a failed or empty sync.

**Da Silva production expectation after a healthy deploy:** **344** statement accounts.

---

## 5. No dummy data in production

Never save values like these to live school data:

- `"x"`, `test`, `prod-smoke`, placeholder notes
- `R0.01` or other fake payment amounts used only for testing
- Fake profile name/email/phone/address
- Unapproved email typos (e.g. `gmail.co` instead of `gmail.com`)

Never run profile `PUT` against production with placeholder values.

---

## 6. Always verify after deploy

Required post-deploy checks (read-only API + UI):

| Check | Pass criteria |
|-------|----------------|
| Backend commit | Matches approved deploy/rollback SHA |
| Frontend build | Correct bundle / `VITE_FEE_CHECK_BUILD_ID` / deploy id |
| Statements accounts | **344** accounts for Da Silva (not 0) |
| Statement totals | Sane summary cards (no empty-sync negative overlay) |
| School profile | `name`: Da Silva Academy, `email`: dasilvaacademy@gmail.com, logo URL present |
| Payments | Save payment still updates balance correctly (spot-check one account) |

**Profile API (read-only):**

```http
GET https://educlear-backend.onrender.com/api/schools/cmpideqeq0000108xb6ouv9zi
```

---

## 7. Use a test school for smoke tests

All invoice, payment, and profile **write** tests must use an **EduClear Test School**, **not** Da Silva Academy (`cmpideqeq0000108xb6ouv9zi`).

---

## 8. Read-only production checks first

Before any production change (deploy, repair script, manual API write):

1. Run **read-only** checks only (`GET` school, statements count, current commit/build).
2. Document baseline values.
3. Proceed with writes only after explicit approval.

---

## 9. Rollback plan required

Every deploy must document **before** deployment:

- Last known **stable commit** (backend + frontend)
- Exact **rollback steps** (Render revert SHA, frontend manual static deploy, env vars, cache purge if needed)
- Who approves rollback execution

Frontend rollback reference: `backend/scripts/trigger-frontend-rollback-deploy.mjs` (commit `32715bd` when that is the approved stable point).

---

## 10. If something breaks, stop

**No stacking fixes on broken production.**

1. **Stop** further deploys and hotfixes.
2. **Roll back** to last stable backend + frontend pair.
3. **Investigate** locally or on staging with read-only production checks.
4. Apply a **single** reviewed fix only after rollback is healthy.

---

## Quick pre-deploy checklist

- [ ] Backend `npm run build` passes
- [ ] Frontend `npm run build` passes
- [ ] No unrelated files in commit
- [ ] Rollback SHA and steps written down
- [ ] Read-only production baseline captured
- [ ] **Billing ledger protected** (section 11) — backup taken or persistent disk confirmed
- [ ] Deploy backend **and** frontend together (unless docs-only / approved frontend-only)
- [ ] Post-deploy verification table (section 6) complete

---

## 11. Billing ledger safety (backend deploys)

**Never deploy backend** while the runtime ledger is unprotected: no Render persistent disk for `data/` **and** no fresh backup of `billing-ledger.json`.

### Before backend deploy

- [ ] Export or copy **`billing-ledger.json`** from the running `educlear-backend` instance (or last approved backup) and store with deploy log (timestamp + commit SHA).
- [ ] Confirm Render **persistent disk** is mounted for ledger `data/` **or** accept explicit risk and document why deploy cannot wait.
- [ ] Read-only baseline: statement account count (~**344** for Da Silva), note current `kidesys_topup` count if check script is available.

### After backend deploy

- [ ] Verify **`kidesys_topup`** row count in runtime ledger matches pre-deploy baseline (post top-up recovery: **92** rows).
- [ ] Verify **344** statement accounts (Da Silva).
- [ ] Spot-check balances: **DUP001** **R-12,200**, **ALI002** **R4,000** (read-only UI or API).
- [ ] Do **not** re-run top-up restore/re-import unless a new data loss is confirmed — manual payment fixes after recovery must not be overwritten.

**Technical plan (no implementation by default):** [billing-ledger-persistence-plan.md](./billing-ledger-persistence-plan.md)

---

*Violations of these rules caused the 2026-06-04 production incident. Treat this document as binding operations policy.*
