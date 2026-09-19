/**
 * Parent lookup rate limit. No database.
 * Run: npx tsx src/middleware/parentPortalLookupRateLimit.unit.test.ts
 */
import assert from "assert";
import express from "express";
import http from "http";

import { PARENT_PORTAL_LOOKUP_NOT_FOUND } from "../services/parentPortalLookup";
import {
  PARENT_LOOKUP_LIMIT,
  rateLimitParentPortalLookup,
  resetParentPortalLookupRateLimit,
} from "./parentPortalLookupRateLimit";

function app() {
  const router = express.Router();
  router.get("/lookup-by-cell", rateLimitParentPortalLookup, (req, res) => {
    const schoolId = String(req.query.schoolId || "");
    const cellNo = String(req.query.cellNo || "");
    if (!schoolId || !cellNo) {
      return res.status(400).json({ success: false, error: "schoolId and cellNo are required" });
    }
    return res.status(404).json({ success: false, error: PARENT_PORTAL_LOOKUP_NOT_FOUND });
  });
  const serverApp = express();
  serverApp.use("/api/parent-portal", router);
  return serverApp;
}

async function listen(handler: express.Express) {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

async function main() {
  resetParentPortalLookupRateLimit();
  const srv = await listen(app());
  try {
    const first = await fetch(
      `${srv.base}/api/parent-portal/lookup-by-cell?schoolId=school-a&cellNo=0820000001`
    );
    assert.equal(first.status, 404);
    const firstBody = await first.json();
    assert.equal(firstBody.error, PARENT_PORTAL_LOOKUP_NOT_FOUND);
    assert.equal(JSON.stringify(firstBody).includes("parent"), false);
    assert.ok(!/email|exists|found parent/i.test(PARENT_PORTAL_LOOKUP_NOT_FOUND));

    let lastStatus = 0;
    let lastText = "";
    for (let i = 0; i < PARENT_LOOKUP_LIMIT + 2; i++) {
      const school = i % 2 === 0 ? "school-a" : "school-b";
      const res = await fetch(
        `${srv.base}/api/parent-portal/lookup-by-cell?schoolId=${school}&cellNo=082000${i}`
      );
      lastStatus = res.status;
      lastText = await res.text();
    }
    assert.equal(lastStatus, 429);
    const limited = JSON.parse(lastText);
    assert.equal(limited.success, false);
    assert.equal(limited.error, "Lookup failed");
    assert.equal(limited.code, "RATE_LIMITED");
    assert.equal(lastText.includes("school-a"), false);
    assert.equal(lastText.includes("school-b"), false);
    assert.equal(lastText.includes("082"), false);
    assert.equal(lastText.includes("learners"), false);

    const otherCell = await fetch(
      `${srv.base}/api/parent-portal/lookup-by-cell?schoolId=school-b&cellNo=0839999999`
    );
    const otherText = await otherCell.text();
    assert.equal(otherCell.status, 429);
    assert.equal(otherText, lastText);

    console.log("parentPortalLookupRateLimit.unit.test: PASS");
  } finally {
    resetParentPortalLookupRateLimit();
    await srv.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
