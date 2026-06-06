# Emergency Persistent Disk + Phase-1 Restore Runbook

**Status:** P0 — execute before any further backend deploy  
**School:** Da Silva Academy `cmpideqeq0000108xb6ouv9zi`  
**Artifacts:** `backend/storage/emergency-restore-2026-06-06T08-55-30-773Z/` only

---

## Root cause

Render deploy replaced the container filesystem. Production reverted to git-bundled `backend/data/` (346 accounts, old ledger). Runtime payments and the Phase-1 344 restore were lost.

**Permanent fix:** Attach a Render persistent disk at `backend/data/` so billing JSON survives deploys.

---

## STOP — do not deploy until disk is attached and seeded

| Step | Action | Done |
|------|--------|------|
| 0 | Read this runbook end-to-end | ☐ |
| 1 | Attach persistent disk (below) | ☐ |
| 2 | Seed Phase-1 data onto disk (Render shell) | ☐ |
| 3 | Verify acceptance (read-only script) | ☐ |
| 4 | Deploy backend + frontend **together** (transactions endpoint) | ☐ |

**Forbidden until stable:** migration, top-up import, baseline refresh from other files, recalculation from 346 data.

---

## Step 1 — Attach Render persistent disk

### Blueprint (`render.yaml`)

`educlear-backend` now declares:

```yaml
disk:
  name: educlear-billing-data
  mountPath: /opt/render/project/src/backend/data
  sizeGB: 1
```

### Dashboard (if not using blueprint sync)

1. Render → **educlear-backend** → **Disks** → **Add disk**
2. **Mount path:** `/opt/render/project/src/backend/data`
3. **Size:** 1 GB (minimum)
4. **Save**

### First deploy with disk (disk attach only)

- Commit includes `render.yaml` disk block only (+ scripts/docs).
- Deploy **backend once** to activate the mount.
- **Expect:** Service may fail startup if disk is empty — that is OK. Proceed immediately to Step 2.

> **Do not** run a full feature deploy until Step 2 seed + Step 3 verification pass.

---

## Step 2 — Seed Phase-1 accepted state onto disk

**Run on Render Shell** (backend service, after disk mount):

```bash
cd /opt/render/project/src/backend

CONFIRM_PHASE1_BILLING_DISK_SEED=true \
npx tsx scripts/seed-phase1-billing-disk.ts --apply --target data
```

This writes **only** from:

| Artifact | Target |
|----------|--------|
| `storage/emergency-restore-2026-06-06T08-55-30-773Z/payload.json` | `data/family-account-age-analysis.json` (344 accounts) |
| `storage/emergency-restore-2026-06-06T08-55-30-773Z/billing-ledger-production-backup.json` | `data/billing-ledger.json` |

Also:

- Removes accidental **AFR002 undo** (`undo-corr-pay-d26e139c…`) and restores manual payment active
- Includes **DIK001 R1** persistence test entry (balance **R499**) unless `--skip-dik001-persist-test`
- Excludes **JAC001**, **LET007**
- Includes **MAM004** `pay-mam004-restore-20260606-single` (R3,000 manual)

Restart backend after seed:

```bash
# Render dashboard → Manual Deploy → Clear build cache → Deploy
# OR trigger restart from dashboard
```

### Optional — update git-bundled fallback (local, before commit)

```bash
cd backend
CONFIRM_PHASE1_BILLING_DISK_SEED=true \
npx tsx scripts/seed-phase1-billing-disk.ts --apply --target data --write-repo-data
```

Commit updated `backend/data/family-account-age-analysis.json` and `backend/data/billing-ledger.json` so build-time assets match Phase-1 (disk remains source of truth on Render).

---

## Step 3 — Verify (read-only)

From local machine:

```bash
cd backend
npx tsx scripts/verify-phase1-billing-acceptance.ts
```

**Pass criteria:**

| Check | Expected |
|-------|----------|
| Accounts | **344** |
| JAC001 / LET007 | **absent** |
| MAM004 balance | **R1,500** |
| DIK001 balance | **R499** (with R1 test) or **R500** (with `--skip-dik001-persist-test`) |
| AFR002 balance | **R−130** |
| Top cards | Phase-1 ± R1 on outstanding/net if DIK001 test kept |
| Undo corrections in ledger | **0** |
| MAM004 restore payment | **present** |

---

## Step 4 — Deploy backend + frontend together

After Step 3 passes:

1. **Backend** — deploy commit that includes:
   - Persistent disk in `render.yaml` (already attached)
   - `GET /api/statements/transactions` (Statement Manage fix)
   - Phase-1 seed scripts (already on disk; code deploy must not wipe disk)

2. **Frontend** — deploy paired build with `fetchStatementAccountTransactions` wired to `/api/statements/transactions`

3. Record SHAs + `VITE_FEE_CHECK_BUILD_ID` in deploy log.

4. Post-deploy read-only checks:

```bash
curl -sS "https://educlear-backend.onrender.com/api/payments/env" | jq '.gitCommit'
curl -sS "https://educlear-backend.onrender.com/api/statements?schoolId=cmpideqeq0000108xb6ouv9zi" | jq '.accounts | length'
curl -sS "https://educlear-backend.onrender.com/api/statements/transactions?schoolId=cmpideqeq0000108xb6ouv9zi&accountNo=DIK001&period=all" | jq '.count'
npx tsx scripts/verify-phase1-billing-acceptance.ts
```

---

## Step 5 — PostgreSQL billing migration (after stable)

**Not in this runbook.** Plan only:

- See [billing-ledger-persistence-plan.md](./billing-ledger-persistence-plan.md) Path B
- Dual-write → migrate → retire JSON authority
- Execute only after 344 state stable on persistent disk for ≥1 week with successful deploy drill

---

## Rollback

Phase-0 backup in same artifact directory:

- `billing-ledger-production-backup.json`
- `statements-pre-restore.json`
- `payload.json`

Re-run seed script with `--apply` to restore accepted Phase-1 state onto disk.

---

## Files production reads (runtime)

All under **`backend/data/`** on persistent disk:

| File | Purpose |
|------|---------|
| `billing-ledger.json` | Payment/invoice ledger |
| `family-account-age-analysis.json` | 344 account baselines |
| `payment-allocations.json` | Allocation lines |
| `kidesys-transaction-history.json` | Kid-e-Sys display history |
| `learner-billing-plans.json` | Billing plans |
| Other `data/*.json` | Access, banking, legal, comms |

PostgreSQL: learners, family account metadata, top-up batch rows (metadata only — not ledger authority).
