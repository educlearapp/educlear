# Billing Ledger Persistence — Technical Plan

**Status:** Planning only — **do not implement without explicit approval**  
**Related:** [Production incident post-mortem (2026-06-04)](./production-incident-2026-06-04-rollback-postmortem.md), [Permanent Deployment Rules](./permanent-deployment-rules.md)  
**Context:** Top-up recovery (2026-06-04) proved that `backend/data/billing-ledger.json` on Render is **not durable** across backend deploys.

---

## Problem

- Billing ledger state lives in **`backend/data/billing-ledger.json`** on the backend container filesystem.
- Render web service **`educlear-backend`** has **no persistent disk** attached today.
- Each backend deploy/restart can replace runtime JSON with the **git-bundled** copy, wiping live rows (e.g. **92** `kidesys_topup` payments) while Postgres migration batch metadata survives.

**Root cause:** Non-persistent container filesystem for authoritative billing data.

---

## Short term (Render ops — no schema migration)

**Goal:** Survive deploys and restarts without losing ledger file state.

| Step | Action |
|------|--------|
| 1 | Attach a **Render persistent disk** to `educlear-backend` mounted at `data/` (or `backend/data/` per service working directory). |
| 2 | One-time: copy current production `billing-ledger.json` into the mounted path **before** enabling disk (read-only export from running instance or approved backup). |
| 3 | Document mount path in Render service settings and in deploy runbook. |
| 4 | Enforce **pre-deploy backup** of `billing-ledger.json` (see deployment rules §11). |
| 5 | Post-deploy: verify `kidesys_topup` row count and spot-check accounts (DUP001, ALI002). |

**Out of scope for short term:** PostgreSQL ledger tables, application code changes to dual-write, or migration scripts.

**Risk if skipped:** Any backend deploy can zero or regress top-up (and other JSON-only) ledger rows again.

---

## Long term (application + database)

**Goal:** Single durable source of truth; JSON file becomes backup/export only or is retired.

| Phase | Action |
|-------|--------|
| A | Design `BillingLedgerEntry` (or equivalent) Prisma models aligned with current JSON shape (`kidesys_topup`, balances, history pointers). |
| B | Implement read path: Postgres primary, JSON fallback during transition. |
| C | Implement write path: transactional Postgres writes; optional async JSON snapshot for audit. |
| D | One-time migration: import production JSON + reconcile with existing `MigrationTopupPaymentRow` batch metadata. |
| E | Remove JSON as runtime authority; keep export/backup job only. |

**Constraints until approved:**

- No ledger migration in production without dry-run, rollback plan, and read-only baseline.
- No payment/invoice re-import for “fixing” data after manual corrections (see top-up recovery notes).

---

## Verification anchors (Da Silva production)

Use after any backend deploy or ledger-affecting change (read-only):

| Check | Expected |
|-------|----------|
| Statement accounts | **344** |
| DUP001 balance | **R-12,200** (last payment **R3,500** on **2026-06-03**) |
| ALI002 balance | **R4,000** (last payment **R3,000** on **2026-06-04**) |
| `kidesys_topup` in ledger | Matches last known count (post-recovery: **92** imported rows) |

---

## Decision log

| Date | Decision |
|------|----------|
| 2026-06-04 | Document plan only; no Render disk attach and no Postgres migration tonight. |
| 2026-06-04 | Top-up recovery completed via `restore-topup-payments-from-batch.ts`; manual payment fixes must not be overwritten by restore/re-import. |

---

*This document does not authorize production writes, deploys, or infrastructure changes.*
