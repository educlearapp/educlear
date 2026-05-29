# Final Migration Preparation Audit

**School:** Da Silva Academy (`cmpideqeq0000108xb6ouv9zi`)  
**Last updated:** 2026-05-24  
**Verdict:** See [Migration readiness verdict](#migration-readiness-verdict) at the end.

This document is the go-live checklist and blocker log for the protected Da Silva final import.

---

## Migration readiness verdict

<!-- Updated by audit re-run: scripts/audit-migration-readiness.sh or manual review -->

| Gate | Status |
|------|--------|
| Login authentication | **PASS** (owner linked; browser verified 2026-05-24) |
| School profile API round-trip | **PASS** (2026-05-24 — all 8 fields after `postalAddress` migration + backend restart) |
| School profile browser verification | **PENDING** — owner must complete [Browser verification](#browser-verification-record-results-here) |
| Live environment configured | **PENDING** — production host only |
| Data sync to live | **PENDING** |
| Post-migration smoke test | **PENDING** |
| Da Silva final import gate | **PENDING** — `npx tsx scripts/da-silva-final-import-gate-preview.ts` |

---

## 1. PRE-MIGRATION BACKUP

Run on the **source** environment immediately before cutover. Store artifacts off-server (encrypted storage).

### PostgreSQL dump

```bash
# Replace connection details; do not commit dumps to git
pg_dump "$DATABASE_URL" -Fc -f "educlear-pre-migrate-$(date +%Y%m%d-%H%M).dump"
```

Verify: `pg_restore -l educlear-pre-migrate-*.dump | head`

### `backend/data` backup

```bash
cd /path/to/EduClear/backend
tar -czf "educlear-data-$(date +%Y%m%d-%H%M).tar.gz" data/
```

**Critical JSON files for Da Silva:**

| File | Purpose |
|------|---------|
| `data/billing-ledger.json` | Ledger / allocations |
| `data/kidesys-transaction-history.json` | Kid-e-Sys history mirror |
| `data/user-access.json` | Owner / role permissions |
| `data/learner-billing-plans.json` | Per-learner plans |
| `data/banking-imports.json` | Banking import state |
| `data/communication-store.json` | Comms credits usage |
| `data/family-account-audit.json` | Family account audit |

### `uploads/school-logos` backup

```bash
cd /path/to/EduClear/backend
tar -czf "educlear-school-logos-$(date +%Y%m%d-%H%M).tar.gz" uploads/school-logos/
```

Da Silva logo on disk (if present): `uploads/school-logos/da-silva-academy-logo.png`

---

## 2. LIVE ENVIRONMENT

Set on the **production** backend host (Render / VPS). Never commit real secrets.

| Variable | Required | Notes |
|----------|----------|--------|
| `DATABASE_URL` | **Yes** | PostgreSQL connection string for live DB |
| `JWT_SECRET` | **Yes** | Strong random secret; changing it invalidates sessions |
| `PUBLIC_API_URL` | **Yes** | Public base URL, e.g. `https://api.educlear.co.za` — used for logo URLs in email/PDF |
| `VITE_API_URL` | **Yes** (frontend build) | Same origin as API the browser calls, e.g. `https://api.educlear.co.za` |
| `PAYFAST_MERCHANT_ID` | **Yes** (subscriptions) | Live or sandbox merchant ID |
| `PAYFAST_MERCHANT_KEY` | **Yes** | |
| `PAYFAST_PASSPHRASE` | **Yes** | ITN signature validation |
| `PAYFAST_RETURN_URL` | **Yes** | e.g. `https://app.educlear.co.za/subscription/status?payment=return` |
| `PAYFAST_CANCEL_URL` | **Yes** | |
| `PAYFAST_NOTIFY_URL` | **Yes** | Must hit live backend, e.g. `https://api.educlear.co.za/api/payfast/notify` |
| `SUPER_ADMIN_EMAILS` | **Yes** | Comma-separated; includes platform admin + migration access |

**Optional / migration-only:**

| Variable | When |
|----------|------|
| `CONFIRM_DA_SILVA_FINAL_IMPORT=true` | Only on server during **one** final import run |
| `DA_SILVA_OWNER_PASSWORD` | Local scripts only; never on live unless seeding owner |

Reference template: `backend/.env.example`

---

## 3. LIVE DEPLOY

Order matters. Run from repo root unless noted.

```bash
# 1. Dependencies
cd backend && npm ci
cd ../frontend && npm ci

# 2. Backend build
cd ../backend && npm run build

# 3. Database migrations (never migrate reset)
npx prisma migrate deploy

# 4. Seed EduClear subscription packages (idempotent)
npm run seed:packages

# 5. Frontend build (VITE_API_URL must be set for production API)
cd ../frontend
VITE_API_URL="https://YOUR_API_HOST" npm run build

# 6. Static deploy — upload frontend/dist to CDN/host
# 7. Start / restart backend (Render deploy or process manager)
```

Post-deploy on server:

```bash
cd backend
npx tsx scripts/audit-login-auth.ts
npx tsx scripts/audit-school-profile-roundtrip.ts
npx tsx scripts/verify-school-logo.ts   # optional PDF logo check
```

---

## 4. DATA SYNC

Copy from **source** to **live** `backend/` tree (or restore tarball from §1). Restart backend after JSON changes.

| Asset | Source | Live path |
|-------|--------|-----------|
| Billing ledger | `data/billing-ledger.json` | same |
| Kid-e-Sys history | `data/kidesys-transaction-history.json` | same |
| User access | `data/user-access.json` | same |
| Learner billing plans | `data/learner-billing-plans.json` | same |
| School logos | `uploads/school-logos/*` | same |

**Prisma / SQL (not file sync):** schools, users, learners, subscriptions — via migration import scripts, not manual JSON copy.

After sync:

```bash
npx tsx scripts/validate-statements-overview.ts   # if configured for school
npx tsx scripts/kidesys-history-proof.ts          # history integrity
```

---

## 5. POST-MIGRATION SMOKE TEST

Check each on **live** URL with Da Silva owner login (`dasilvaacademy@gmail.com`). Record PASS/FAIL.

| # | Area | What to verify |
|---|------|----------------|
| 1 | Login | `POST /auth/login` → dashboard, correct `schoolId` |
| 2 | Statements | Open statements list; balances load |
| 3 | Invoices | Invoice run / document generation |
| 4 | Payments | Create or view payment; ledger updates |
| 5 | Package display | Subscription package name/status visible |
| 6 | Pagination | Long lists paginate (statements/payments) |
| 7 | Logo | Header + PDF/statement logo renders |
| 8 | School profile persistence | [Browser verification](#browser-verification-record-results-here) |
| 9 | PayFast | Checkout initiates; ITN reachable (sandbox or live) |
| 10 | Subscription gate | Gate blocks/allows per subscription state |
| 11 | Dashboard access | Main school dashboard sections load |

---

## 6. ROLLBACK PLAN

If cutover fails, execute in order:

1. **Restore DB** — `pg_restore -d "$DATABASE_URL" --clean --if-exists educlear-pre-migrate-*.dump` (or provider snapshot restore).
2. **Restore data tarball** — extract `educlear-data-*.tar.gz` → `backend/data/`.
3. **Restore uploads** — extract `educlear-school-logos-*.tar.gz` → `backend/uploads/school-logos/`.
4. **Rollback deployment** — redeploy previous backend + frontend build artifacts; revert `DATABASE_URL` if DB was switched.

Remove `CONFIRM_DA_SILVA_FINAL_IMPORT` from live env after rollback.

---

## LOGIN AUTHENTICATION — VERIFIED

**Status:** **RESOLVED** — **LOGIN VERIFIED: YES**

**Do not:** reset password or change the owner user record.

| Item | Value |
|------|--------|
| Login API | `POST /auth/login` (alias `POST /api/auth/login`) |
| Account | `dasilvaacademy@gmail.com` |
| schoolId | `cmpideqeq0000108xb6ouv9zi` |
| User id | `cmpimyjkj00013lhz6kkxr9xu` |
| Role | `SCHOOL_ADMIN` (Owner in `user-access.json`) |

```bash
cd backend
npx tsx scripts/audit-login-auth.ts
```

Reports: `login-auth-audit.json`, `login-auth-audit.txt`

---

## SCHOOL PROFILE PERSISTENCE

**Scope:** All fields below must round-trip **PostgreSQL `School` row** via `GET/PUT /api/schools/:id` — not localStorage-only.

### API contract

| Action | Endpoint |
|--------|----------|
| Load | `GET /api/schools/:schoolId` |
| Save | `PUT /api/schools/:schoolId` |
| Logo upload | `POST /api/upload-logo` → then `PUT` with `logoUrl` |

### Field mapping (UI → DB)

| UI label | Form field(s) | DB column |
|----------|---------------|-----------|
| School / business name | `businessName` | `name` |
| Email | `registeredEmail` / `contactEmail` | `email` |
| Tel | `telNo` | `phone` |
| Cell | `cellNo` | `cellNo` |
| Physical address | `physicalAddress1`–`4` | `address` (newline-separated) |
| Postal address | `postalAddress1`–`4` | `postalAddress` (newline-separated) |
| Banking details | `bankingLine1`–`4` | `bankingDetails` (newline-separated) |
| Logo | Upload + preview | `logoUrl` (+ file under `uploads/school-logos/`) |

**Not persisted on this screen:** package, packageUntil, automaticRenew, automaticBilling, fax, password fields.

**Fix (2026-05-24):** `postalAddress` column + API/frontend mapping (was UI-only; postal lines were discarded on save).

### Automated API round-trip

After `prisma migrate deploy` and backend restart:

```bash
cd backend
npx prisma migrate deploy
npm run build && npm run dev   # or restart production process
npx tsx scripts/audit-school-profile-roundtrip.ts
```

Script writes PASS/FAIL per field to stdout; restores prior DB values after probe.

### Browser verification (record results here)

**Prerequisites:** Backend restarted after migrate; frontend hard-refreshed (Cmd+Shift+R). Logged in as `dasilvaacademy@gmail.com`.

**Steps:**

1. Open **School Profile** (dashboard → profile).
2. Note current values (or screenshot).
3. Set a unique **test marker** per field, e.g. suffix `MIGRATE-TEST-20260524`:
   - General tab: business name (optional — use suffix only if safe)
   - Contact: email, tel, cell
   - Address: one physical line + one postal line
   - Billing: banking line 1
   - Logo: upload a small test PNG **or** confirm existing logo still shows
4. Click **Save** — expect “Profile saved”.
5. **Hard refresh** browser (Cmd+Shift+R / Ctrl+Shift+R).
6. Open DevTools → Network → confirm reload calls `GET /api/schools/cmpideqeq0000108xb6ouv9zi` and response JSON contains your test values.
7. Confirm form displays the same values (not blanks / old values).
8. Revert test values and save again (leave production-ready data).

| Field | API round-trip (2026-05-24) | Browser (GET after hard refresh) |
|-------|------------------------------|----------------------------------|
| School name | **PASS** | **PENDING** |
| Email | **PASS** | **PENDING** |
| Tel | **PASS** | **PENDING** |
| Cell | **PASS** | **PENDING** |
| Physical address | **PASS** | **PENDING** |
| Postal address | **PASS** | **PENDING** |
| Banking details | **PASS** | **PENDING** |
| Logo | **PASS** | **PENDING** |

**Owner:** After browser test, replace `PENDING` with `PASS` or `FAIL` in the table above and update [Migration readiness verdict](#migration-readiness-verdict).

---

## Da Silva final import gate

Preview only (no DB writes):

```bash
cd backend
npx tsx scripts/da-silva-final-import-gate-preview.ts [path-to-desktop-export]
```

Requires Kid-e-Sys export layout on desktop. Expected snapshot: `daSilvaFinalImportGate.ts` (`DA_SILVA_FINAL_IMPORT_EXPECTED`).

Live import additionally requires `CONFIRM_DA_SILVA_FINAL_IMPORT=true` on server.

---

## Related scripts

| Script | Purpose |
|--------|---------|
| `scripts/audit-login-auth.ts` | Owner + login route audit |
| `scripts/audit-school-profile-roundtrip.ts` | PUT/GET field persistence |
| `scripts/verify-school-logo.ts` | logoUrl → disk → PDF |
| `scripts/da-silva-final-import-gate-preview.ts` | Import count gate |
| `scripts/school-data-cleanup.ts` | Pre-import cleanup dry-run |
| `src/services/daSilvaMigration/daSilvaFinalImportGate.ts` | Import blocker logic |
