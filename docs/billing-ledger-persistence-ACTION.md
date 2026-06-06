# Billing Ledger Persistence — ACTION REQUIRED

**Status:** Blocking — production billing data is not durable across backend deploys  
**Created:** 2026-06-06 (post deploy regression + MAM004 payment recovery)  
**Owner:** Engineering / Ops  
**Related:** [billing-ledger-persistence-plan.md](./billing-ledger-persistence-plan.md), [permanent-deployment-rules.md](./permanent-deployment-rules.md)

---

## Incident summary (2026-06-06)

Backend deploy `e5245bd` replaced the runtime container filesystem. Live manual payments that existed only on the Render instance (e.g. MAM004 2026-06-06) were lost because **`billing-ledger.json` is git-bundled and has no persistent disk**.

Production ledger file content now matches `backend/storage/billing-ledger-production-backup-2026-06-05.json` (41,348 entries, identical IDs). Account-count/total regressions (344→346, card totals) were driven by **deployed age-analysis JSON + balance fix code**, not a different ledger backup file.

---

## Permanent fix (choose one path)

### Path A — Render persistent disk (short term, recommended first)

| # | Task | Owner | Done |
|---|------|-------|------|
| 1 | Attach Render **persistent disk** to `educlear-backend` mounted at `data/` (service `rootDir: backend` → path is `backend/data/`) | Ops | ☐ — **`render.yaml` disk block added; runbook: `docs/emergency-persistent-disk-restore-RUNBOOK.md`** |
| 2 | **Before** first deploy with disk: export live `billing-ledger.json` from running instance via `GET /api/invoices/ledger?schoolId=...` and store in deploy log | Ops | ☐ |
| 3 | Copy export into mounted `data/billing-ledger.json` on the instance (Render shell) | Ops | ☐ |
| 4 | Update [permanent-deployment-rules.md](./permanent-deployment-rules.md) §11 with disk mount path + verification | Eng | ☐ |
| 5 | Add pre-deploy hook/check: **abort deploy** if disk not mounted and no fresh ledger backup | Eng | ☐ |

### Path B — PostgreSQL as ledger source of truth (long term)

| # | Task | Owner | Done |
|---|------|-------|------|
| 1 | Design Prisma models for `BillingLedgerEntry` (see persistence plan Phase A) | Eng | ☐ |
| 2 | Dual-write: Postgres primary, JSON async snapshot for audit | Eng | ☐ |
| 3 | One-time migration from production JSON export | Eng + Ops | ☐ |
| 4 | Retire JSON as runtime authority | Eng | ☐ |

---

## Binding deploy rules (until fixed)

1. **Never deploy backend** without exporting production `billing-ledger.json` first.
2. Store export as `backend/storage/billing-ledger-production-backup-YYYY-MM-DD.json`.
3. Post-deploy: verify ledger entry count, `kidesys_topup` count (~92–346 per baseline), 344 statement accounts (Da Silva), DUP001 / ALI002 spot-checks.
4. If live manual payments were taken before deploy, re-apply from export — git bundle alone is not sufficient.

---

## Verification commands (read-only)

```bash
# Ledger entry count
curl -sS "https://educlear-backend.onrender.com/api/invoices/ledger?schoolId=cmpideqeq0000108xb6ouv9zi" | jq '.entries | length'

# Statement accounts + MAM004 spot-check
curl -sS "https://educlear-backend.onrender.com/api/statements?schoolId=cmpideqeq0000108xb6ouv9zi" | jq '[.statements[] | select(.accountNo=="MAM004") | {accountNo,balance,lastPayment,lastPaymentDate}]'

# Backend commit
curl -sS "https://educlear-backend.onrender.com/api/payments/env" | jq '.gitCommit'
```

---

## Decision log

| Date | Decision |
|------|----------|
| 2026-06-04 | Persistence plan documented; disk not attached |
| 2026-06-06 | Deploy wiped runtime-only manual payments; MAM004 R3,000 re-posted via API; **disk attach is now P0** |
