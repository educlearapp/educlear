/**
 * Staff admissions drafts visibility guards.
 * Run: npx tsx src/admissions/admissions.drafts.unit.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.join(here, rel), "utf8");

const listSrc = read("AdmissionsListPage.tsx");
const badgeSrc = read("AdmissionsStatusBadge.tsx");
const detailSrc = read("AdmissionsDetailPage.tsx");
const typesSrc = read("staffAdmissionsTypes.ts");

const defaultStatus = listSrc.match(/const DEFAULT_STATUS =\s*"([^"]+)"/);
assert.ok(defaultStatus, "default pipeline status list present");
assert.ok(!defaultStatus![1].split(",").includes("DRAFT"), "drafts never in the default pipeline");
assert.ok(/value: "DRAFT", label: "Drafts \(incomplete — not submitted\)"/.test(listSrc), "drafts filter");
assert.ok(/listApplications\(\{ status: DRAFT_STATUS, page: 1, pageSize: 1 \}\)/.test(listSrc), "draft count via existing API");
assert.ok(/not included below/.test(listSrc), "draft count shown separately from admissions");
assert.ok(/They are not admissions/.test(listSrc), "drafts explained as not admissions");
assert.ok(/Started/.test(listSrc) && /Last saved/.test(listSrc), "created + last saved columns");
assert.ok(/lastSavedAt\?: string \| null/.test(typesSrc), "lastSavedAt optional for older API responses");
assert.ok(/"Draft — incomplete"/.test(badgeSrc), "distinct draft badge label");
assert.ok(/status === "DRAFT"/.test(detailSrc) && /incomplete draft/.test(detailSrc), "detail notice");

console.log("✓ staff admissions drafts visibility unit tests passed");
