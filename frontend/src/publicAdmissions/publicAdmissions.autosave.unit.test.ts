/**
 * Draft autosave + same-device backup unit tests.
 * Run: npx tsx src/publicAdmissions/publicAdmissions.autosave.unit.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  autosaveRetryDelayMs,
  classifySaveFailure,
  draftSaveStatusText,
  isRetryableSaveFailure,
  SingleFlightSaver,
} from "./draftAutosave";
import {
  clearDraftBackup,
  draftBackupStorageKey,
  DRAFT_BACKUP_TTL_MS,
  emptyAgreementSelections,
  mergeBackupIntoServerForm,
  pruneExpiredDraftBackups,
  readDraftBackup,
  stripSensitiveDraftFields,
  writeDraftBackup,
} from "./draftLocalBackup";
import { createEmptyDraftForm } from "./draftFormState";
import { PublicAdmissionsApiError } from "./publicAdmissionsApi";
import type { DraftApplicationFormState } from "./publicAdmissionsTypes";

class MemoryStorage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return Array.from(this.map.keys())[i] ?? null;
  }
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
}

function filledForm(): DraftApplicationFormState {
  const form = createEmptyDraftForm(null);
  return {
    ...form,
    intakeYear: 2027,
    requestedGrade: "Grade 1",
    learner: {
      ...form.learner,
      firstName: "Test",
      lastName: "Learner",
      birthDate: "2020-01-01",
      idNumber: "2001015000000",
      homeAddress: "1 Test Road",
    },
    guardians: [
      {
        ...form.guardians[0],
        firstName: "Test",
        surname: "Guardian",
        idNumber: "8001015000000",
        email: "guardian@example.invalid",
        isPrimary: true,
        isPayingPerson: true,
      },
    ],
  };
}

const now = new Date("2026-10-14T10:00:00.000Z");

// --- Backup: scoped, privacy-stripped, expiring ---------------------------------------
{
  const storage = new MemoryStorage();
  const form = filledForm();
  const agreements = { ...emptyAgreementSelections(), privacyAccepted: true };
  assert.ok(
    writeDraftBackup({ publicSlug: "School-A", publicAccessId: "pa1", form, agreements }, now, storage)
  );
  const key = draftBackupStorageKey("school-a", "pa1");
  assert.equal(key, "educlear.publicAdmissions.draftBackup.school-a.pa1", "scoped to school + draft");
  const raw = storage.getItem(key)!;
  assert.ok(!raw.includes("2001015000000"), "learner ID number never stored");
  assert.ok(!raw.includes("8001015000000"), "guardian ID number never stored");
  assert.ok(!/accessToken|token/i.test(raw), "no access token in backup");
  assert.ok(raw.includes("1 Test Road"), "typed details kept");

  const back = readDraftBackup("school-a", "pa1", now, storage);
  assert.ok(back, "readable");
  assert.equal(back!.form.learner.firstName, "Test");
  assert.equal(back!.form.learner.idNumber, "");
  assert.equal(back!.agreements.privacyAccepted, true);

  assert.equal(readDraftBackup("school-b", "pa1", now, storage), null, "other school cannot read");
  assert.equal(readDraftBackup("school-a", "pa2", now, storage), null, "other draft cannot read");

  const later = new Date(now.getTime() + DRAFT_BACKUP_TTL_MS + 1000);
  assert.equal(readDraftBackup("school-a", "pa1", later, storage), null, "expired backup ignored");
  assert.equal(storage.getItem(key), null, "expired backup removed");

  writeDraftBackup({ publicSlug: "school-a", publicAccessId: "pa1", form, agreements }, now, storage);
  clearDraftBackup("school-a", "pa1", storage);
  assert.equal(storage.getItem(key), null, "cleared after confirmed save");

  storage.setItem(key, "{not json");
  assert.equal(readDraftBackup("school-a", "pa1", now, storage), null, "corrupt backup tolerated");

  writeDraftBackup({ publicSlug: "school-a", publicAccessId: "old", form, agreements }, now, storage);
  writeDraftBackup(
    { publicSlug: "school-a", publicAccessId: "new", form, agreements },
    new Date(now.getTime() + DRAFT_BACKUP_TTL_MS),
    storage
  );
  storage.setItem("unrelated.key", "keep");
  pruneExpiredDraftBackups(new Date(now.getTime() + DRAFT_BACKUP_TTL_MS + 1), storage);
  assert.equal(storage.getItem(draftBackupStorageKey("school-a", "old")), null, "prunes expired");
  assert.ok(storage.getItem(draftBackupStorageKey("school-a", "new")), "keeps live backup");
  assert.equal(storage.getItem("unrelated.key"), "keep", "does not touch other keys");

  assert.equal(writeDraftBackup({ publicSlug: "", publicAccessId: "x", form, agreements }, now, storage), false);
  assert.equal(writeDraftBackup({ publicSlug: "a", publicAccessId: "x", form, agreements }, now, null), false);

  const stripped = stripSensitiveDraftFields(form);
  assert.equal(stripped.learner.idNumber, "");
  assert.equal(form.learner.idNumber, "2001015000000", "strip does not mutate input");
}

// --- Merge: unsaved entries win, ID numbers come from the server -----------------------
{
  const server = filledForm();
  const backup = stripSensitiveDraftFields(filledForm());
  backup.learner.homeAddress = "2 Newer Street";
  backup.guardians[0].cellNo = "0820000000";
  const merged = mergeBackupIntoServerForm(server, backup);
  assert.equal(merged.learner.homeAddress, "2 Newer Street", "unsaved local entry restored");
  assert.equal(merged.learner.idNumber, "2001015000000", "learner ID from server");
  assert.equal(merged.guardians[0].idNumber, "8001015000000", "guardian ID from server by name");
  assert.equal(merged.guardians[0].cellNo, "0820000000");

  const renamed = stripSensitiveDraftFields(filledForm());
  renamed.guardians[0].surname = "Changed";
  assert.equal(
    mergeBackupIntoServerForm(server, renamed).guardians[0].idNumber,
    "8001015000000",
    "same guardian count keeps ID by position"
  );

  const added = stripSensitiveDraftFields(filledForm());
  added.guardians = [
    { ...added.guardians[0], firstName: "Other", surname: "Person", clientKey: "x" },
    { ...added.guardians[0], clientKey: "y" },
  ];
  const mergedAdded = mergeBackupIntoServerForm(server, added);
  assert.equal(mergedAdded.guardians[0].idNumber, "", "unmatched new guardian has no borrowed ID");
  assert.equal(mergedAdded.guardians[1].idNumber, "8001015000000", "matched by name");
}

// --- Single-flight saver: no overlapping saves, queued save uses latest data -----------
await (async () => {
  let current = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  const sent: number[] = [];
  const releases: Array<() => void> = [];
  const saver = new SingleFlightSaver(async () => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    sent.push(current);
    await new Promise<void>((resolve) => releases.push(resolve));
    inFlight -= 1;
    return true;
  });

  current = 1;
  const first = saver.flush();
  current = 2;
  const second = saver.flush();
  current = 3;
  const third = saver.flush();
  assert.equal(saver.busy, true);
  assert.equal(sent.length, 1, "only one request in flight");
  releases.shift()!();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(sent.length, 2, "queued save runs after the first completes");
  assert.deepEqual(sent, [1, 3], "queued save sends the latest data, not an intermediate copy");
  releases.shift()!();
  const results = await Promise.all([first, second, third]);
  assert.deepEqual(results, [true, true, true]);
  assert.equal(maxInFlight, 1, "never two saves at once");
  assert.equal(saver.busy, false);
})();

await (async () => {
  let calls = 0;
  const saver = new SingleFlightSaver(async () => {
    calls += 1;
    throw new TypeError("Failed to fetch");
  });
  assert.equal(await saver.flush(), false, "network failure resolves false, never throws");
  assert.equal(calls, 1);
  assert.equal(await saver.flush(), false, "can retry after failure");
  assert.equal(calls, 2);
})();

// --- Failure classification + retry timing --------------------------------------------
assert.equal(classifySaveFailure(new TypeError("Failed to fetch")), "network");
assert.equal(classifySaveFailure(new PublicAdmissionsApiError("x", 503)), "server");
assert.equal(classifySaveFailure(new PublicAdmissionsApiError("x", 429)), "server");
assert.equal(classifySaveFailure(new PublicAdmissionsApiError("x", 400, "VALIDATION_ERROR")), "rejected");
assert.equal(classifySaveFailure(new PublicAdmissionsApiError("x", 404)), "session");
assert.ok(isRetryableSaveFailure("network") && isRetryableSaveFailure("server"));
assert.ok(!isRetryableSaveFailure("rejected") && !isRetryableSaveFailure("session"));
assert.equal(autosaveRetryDelayMs(0), 2000);
assert.equal(autosaveRetryDelayMs(1), 5000);
assert.equal(autosaveRetryDelayMs(99), 30000, "retry delay is capped");

// --- Status text never claims persistence without confirmation -------------------------
const t = new Date(2026, 9, 14, 9, 5);
const base = { lastConfirmedAt: null, offline: false, retryScheduled: false };
assert.notEqual(draftSaveStatusText({ ...base, saveState: "clean" }), "All changes saved");
assert.equal(draftSaveStatusText({ ...base, saveState: "clean", lastConfirmedAt: t }), "All changes saved");
assert.equal(draftSaveStatusText({ ...base, saveState: "saving" }), "Saving…");
assert.equal(draftSaveStatusText({ ...base, saveState: "saved", lastConfirmedAt: t }), "Saved at 09:05");
assert.equal(draftSaveStatusText({ ...base, saveState: "dirty" }), "Unsaved changes");
assert.equal(draftSaveStatusText({ ...base, saveState: "failed" }), "Save failed");
assert.equal(draftSaveStatusText({ ...base, saveState: "failed", retryScheduled: true }), "Save failed — retrying");
assert.equal(draftSaveStatusText({ ...base, saveState: "failed", offline: true }), "Offline — not saved yet");
for (const s of ["dirty", "saving", "failed"] as const) {
  assert.ok(
    !/All changes saved/.test(draftSaveStatusText({ ...base, saveState: s, lastConfirmedAt: t })),
    `${s} never shows All changes saved`
  );
}

// --- Apply page wiring guards ---------------------------------------------------------
const here = path.dirname(fileURLToPath(import.meta.url));
const applySrc = fs.readFileSync(path.join(here, "PublicAdmissionsApplyPage.tsx"), "utf8");
assert.ok(/SingleFlightSaver/.test(applySrc), "apply page uses single-flight saver");
assert.ok(/AUTOSAVE_DEBOUNCE_MS/.test(applySrc), "debounced autosave wired");
assert.ok(/beforeunload/.test(applySrc), "leave warning wired");
assert.ok(/visibilitychange/.test(applySrc), "saves when the app is backgrounded");
assert.ok(/addEventListener\("online"/.test(applySrc), "retries when connectivity returns");
assert.ok(/writeDraftBackup/.test(applySrc) && /readDraftBackup/.test(applySrc), "backup wired");
assert.ok(/clearDraftBackup/.test(applySrc), "backup cleared after confirmed save / submit");
assert.ok(!/"All changes saved"/.test(applySrc), "apply page does not hard-code All changes saved");
assert.ok(/Date of birth <span className="pa-req">\*<\/span>/.test(applySrc), "DOB marked mandatory");

console.log("✓ public admissions autosave/backup unit tests passed");
