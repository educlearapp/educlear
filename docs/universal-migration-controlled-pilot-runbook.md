# Universal Migration — Controlled Pilot Operator Runbook

**Audience:** Trained EduClear Super Admin  
**Rule:** Deployment does **not** authorize migration. A separate explicit approval is required for Pilot #1.

---

## Before you start

1. Confirm the **exact school name** with leadership.
2. Confirm **pre-pilot backup** completed and verified (DB + school snapshot).
3. Confirm backend **persistent disk** (`backend/data`) is healthy.
4. Confirm you have the school’s **original export files** (same package rehearsed on a disposable school).
5. Prefer a quiet **migration window** so finance does not drift after export.

---

## Operator steps

1. **Confirm correct school** in Migration Center.
2. **Confirm backup completed** (record backup id/timestamp).
3. **Upload** the supplied school files.
4. **Wait** for EduClear automatic analysis (“Analysing school information…”).
5. **Review Needs Attention** — only genuine exceptions.
6. Resolve genuine exceptions (do not guess).
7. Confirm status is **Ready to Migrate**.
8. Press **Complete Migration ONCE**.
9. Wait for the final result.
10. Verify the final evidence pack (learners/parents/academic/finance/statements/Fee Check/Accept).

Normal path:

**UPLOAD → REVIEW EXCEPTIONS (if any) → COMPLETE MIGRATION**

Do **not** open Advanced Tools unless support asks you to.

---

## Finance hard gate (if finance was supplied)

Migration is **not** successful unless all are true:

- Finance difference = **R0.00**
- Statement Authority = **MATCH**
- Fee Check Authority = **MATCH**
- Accept / terminal = **COMPLETE_ACCEPTED**

---

## STOP immediately if

- Wrong school selected
- Files look like they belong to another school
- Unexpected large learner/parent count mismatch
- Finance difference is not R0.00
- Statements or Fee Check do not MATCH
- Status is BLOCKED / FAILED and retry state is unclear
- Duplicate records appear
- Source fingerprint changes unexpectedly mid-flight
- Persistent lock/storage unavailable
- System asks for destructive schema action
- You are unsure which parent/class/account match is correct

**No guessing. Stop and escalate.**

---

## After Complete Migration

1. Do **not** re-upload or replace files unless instructed.
2. Capture post-migration counts and finance totals.
3. Spot-check learner list, parent links, classes, statements, Fee Check.
4. Retain the pilot audit package (no secrets).
5. Only then hand the school to operators for normal use.
