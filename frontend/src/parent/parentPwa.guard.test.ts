/**
 * Parent PWA foundation guards — manifest, SW privacy, teacher isolation.
 * Run: npx tsx src/parent/parentPwa.guard.test.ts
 */
import assert from "assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(here, "../../public");
const manifest = JSON.parse(fs.readFileSync(path.join(publicDir, "parent-manifest.webmanifest"), "utf8"));
const parentSw = fs.readFileSync(path.join(publicDir, "parent-sw.js"), "utf8");
const teacherSw = fs.readFileSync(path.join(publicDir, "teacher-sw.js"), "utf8");
const teacherManifest = JSON.parse(fs.readFileSync(path.join(publicDir, "teacher-manifest.webmanifest"), "utf8"));
const iconCfg = fs.readFileSync(path.resolve(here, "../pwa/pwaIconConfig.ts"), "utf8");
const headHook = fs.readFileSync(path.resolve(here, "../pwa/usePortalPwaHead.ts"), "utf8");

assert.equal(manifest.scope, "/parent");
assert.equal(manifest.start_url, "/parent");
assert.equal(manifest.display, "standalone");
assert.ok(String(manifest.name).includes("Parent"));
assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 2);

assert.equal(teacherManifest.scope, "/teacher/");
assert.notEqual(manifest.scope, teacherManifest.scope, "parent and teacher PWA scopes must differ");

assert.ok(parentSw.includes('pathname.startsWith("/api/")'), "parent SW must not cache API");
assert.ok(
  parentSw.includes("No authenticated API caching") || parentSw.includes("Never intercept API"),
  "parent SW documents no API cache"
);
assert.equal(/caches\.open\(/.test(parentSw), false, "parent SW must not open caches for offline app shell");
assert.ok(parentSw.includes("You are offline"));
assert.ok(parentSw.includes("panel=alerts"), "SW opens Alerts panel");
assert.ok(parentSw.includes("educlear-parent-open-alerts"), "SW posts open-alerts message");
assert.ok(fs.existsSync(path.join(publicDir, "parent-pwa", "educlear-parent-chime.wav")), "chime asset");

assert.ok(iconCfg.includes('serviceWorkerPath: "/parent-sw.js"'));
assert.ok(iconCfg.includes('serviceWorkerScope: "/parent"'));
assert.ok(iconCfg.includes('serviceWorkerScope: "/teacher/"'));
assert.ok(headHook.includes("push-sw-placeholder.js"), "head hook retires placeholder SW");

for (const name of [
  "educlear-parent-icon-v2-192.png",
  "educlear-parent-icon-v2-512.png",
  "educlear-parent-apple-touch-v2-180.png",
]) {
  assert.ok(fs.existsSync(path.join(publicDir, "parent-pwa", name)), `missing icon ${name}`);
}

assert.ok(!teacherSw.includes("parent-sw"), "teacher SW file stays separate");

console.log("parentPwa.guard.test: PASS");
