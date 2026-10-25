/**
 * Phase 2 hardening — effective lifecycle / staff filter helpers (no DB / no network).
 * Run: npx tsx src/services/schoolAnnouncementLifecycle.unit.test.ts
 */
import assert from "assert";
import {
  lifecycleToIsDraft,
  parentVisibleNoticeWhere,
  presentAnnouncement,
  resolveNoticeLifecycle,
  staffLifecycleWhere,
} from "./schoolAnnouncementService";

assert.equal(resolveNoticeLifecycle({ isDraft: true, lifecycleStatus: "PUBLISHED" }), "DRAFT");
assert.equal(resolveNoticeLifecycle({ isDraft: true, lifecycleStatus: "UNPUBLISHED" }), "DRAFT");
assert.equal(resolveNoticeLifecycle({ isDraft: true, lifecycleStatus: "ARCHIVED" }), "DRAFT");
assert.equal(resolveNoticeLifecycle({ isDraft: false, lifecycleStatus: "PUBLISHED" }), "PUBLISHED");
assert.equal(resolveNoticeLifecycle({ isDraft: false, lifecycleStatus: "UNPUBLISHED" }), "UNPUBLISHED");
assert.equal(resolveNoticeLifecycle({ isDraft: false, lifecycleStatus: "DRAFT" }), "DRAFT");
assert.equal(resolveNoticeLifecycle({ isDraft: false, lifecycleStatus: "ARCHIVED" }), "ARCHIVED");
assert.equal(resolveNoticeLifecycle({ isDraft: false }), "PUBLISHED");

const presented = presentAnnouncement({
  id: "n1",
  isDraft: true,
  lifecycleStatus: "PUBLISHED" as const,
  title: "Legacy draft",
});
assert.equal(presented.lifecycleStatus, "DRAFT");
assert.equal(presented.isDraft, true);
assert.equal(lifecycleToIsDraft("PUBLISHED"), false);

const draftFilter = staffLifecycleWhere("DRAFT");
assert.ok(Array.isArray((draftFilter as { OR?: unknown[] }).OR));
const publishedFilter = staffLifecycleWhere("PUBLISHED");
assert.deepEqual(publishedFilter, { lifecycleStatus: "PUBLISHED", isDraft: false });
const unpublishedFilter = staffLifecycleWhere("UNPUBLISHED");
assert.deepEqual(unpublishedFilter, { lifecycleStatus: "UNPUBLISHED", isDraft: false });

const parentGate = parentVisibleNoticeWhere();
assert.equal(parentGate.lifecycleStatus, "PUBLISHED");
assert.equal(parentGate.isDraft, false);

console.log("schoolAnnouncementLifecycle.unit.test: PASS");
