/**
 * Public OA JSON body size limit — isolated Express fixture tests (no DB).
 * Run: npx tsx src/middleware/publicAdmissionsJsonLimit.unit.test.ts
 */
import assert from "assert";
import express from "express";
import fs from "fs";
import http from "http";
import multer from "multer";
import path from "path";
import type { AddressInfo } from "net";

import {
  PUBLIC_ADMISSIONS_JSON_LIMIT_BYTES,
  publicAdmissionsJsonParser,
} from "./publicAdmissionsJsonLimit";
import { ADMISSIONS_MAX_UPLOAD_BYTES } from "../services/admissions/admissionsFileValidation";

/** Realistic completed OA application body (aligned with public form + answers). */
export function buildRealisticCompletedOaPayload(): Record<string, unknown> {
  return {
    intakeYear: 2027,
    requestedGrade: "Grade 1",
    declaredExistingSibling: true,
    declaredSiblingLearnerName: "Alex Example Sibling",
    declaredSiblingAdmissionNo: "ADM-2024-01234",
    declaredExistingFamily: true,
    learner: {
      firstName: "Jordan",
      lastName: "Applicant",
      birthDate: "2018-05-12",
      gender: "F",
      idNumber: "1805125800085",
      previousSchoolName: "Sunshine Pre-Primary School of Rustenburg",
      homeAddress: "212 Example Street, Rustenburg, North West, 0299",
      homeLanguage: "English",
      citizenship: "South African",
      allergies: "Peanuts (anaphylaxis risk — EpiPen carried by guardian)",
      medicalAlert: "Mild asthma; uses inhaler as needed",
    },
    guardians: [
      {
        title: "Mrs",
        firstName: "Pat",
        surname: "Guardian-Primary",
        relationship: "Mother",
        email: "pat.guardian.primary@example.com",
        cellNo: "0820001001",
        idNumber: "8501015800083",
        isPrimary: true,
        isPayingPerson: true,
        homeAddress: "212 Example Street, Rustenburg, North West, 0299",
        employer: "Example Holdings (Pty) Ltd",
        sortOrder: 0,
      },
      {
        title: "Mr",
        firstName: "Sam",
        surname: "Guardian-Secondary",
        relationship: "Father",
        email: "sam.guardian.secondary@example.com",
        cellNo: "0820001002",
        idNumber: "8302025800084",
        isPrimary: false,
        isPayingPerson: true,
        homeAddress: "212 Example Street, Rustenburg, North West, 0299",
        employer: "Tech Works SA",
        sortOrder: 1,
      },
    ],
    answers: [
      {
        questionKey: "why",
        valueJson:
          "We chose this school because of the academic programme, values, and pastoral care. ".repeat(
            8
          ),
      },
      {
        questionKey: "how_heard",
        valueJson:
          "School website and parent recommendation from current Grade 2 family.",
      },
      {
        questionKey: "extracurricular",
        valueJson:
          "Swimming, choir, and weekend soccer. Interested in coding club if available.",
      },
      {
        questionKey: "additional_info",
        valueJson:
          "Flexible on start date within the first term. Prefer morning orientation if offered.",
      },
    ],
    privacyAccepted: true,
    declarationsAccepted: true,
    privacyNoticeVersion: "v1-test",
  };
}

/** Rich stress fixture: many long custom answers (still well under 256 KiB). */
export function buildRichStressOaPayload(): Record<string, unknown> {
  const base = buildRealisticCompletedOaPayload();
  const answers = [];
  for (let i = 0; i < 25; i += 1) {
    answers.push({
      questionKey: `q_${i}`,
      valueJson: (`Detailed narrative response for question ${i}. `).repeat(40),
    });
  }
  return { ...base, answers };
}

function jsonBytes(payload: unknown): number {
  return Buffer.byteLength(JSON.stringify(payload), "utf8");
}

function createMirrorApp() {
  const app = express();
  // Same order as index.ts: public OA tight parser FIRST, then global 12 MiB.
  app.use("/api/public/admissions", publicAdmissionsJsonParser);
  app.use(express.json({ limit: "12mb" }));

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: ADMISSIONS_MAX_UPLOAD_BYTES, files: 1 },
  });

  app.post("/api/public/admissions/:schoolSlug/applications", (req, res) => {
    res.status(201).json({
      success: true,
      op: "draft_create",
      bytes: Buffer.byteLength(JSON.stringify(req.body || {}), "utf8"),
    });
  });
  app.patch(
    "/api/public/admissions/:schoolSlug/applications/:id",
    (req, res) => {
      res.json({
        success: true,
        op: "draft_update",
        bytes: Buffer.byteLength(JSON.stringify(req.body || {}), "utf8"),
      });
    }
  );
  app.post(
    "/api/public/admissions/:schoolSlug/applications/:id/submit",
    (req, res) => {
      res.json({
        success: true,
        op: "submit",
        bytes: Buffer.byteLength(JSON.stringify(req.body || {}), "utf8"),
      });
    }
  );
  app.post(
    "/api/public/admissions/:schoolSlug/applications/:id/documents",
    upload.single("file"),
    (req, res) => {
      res.status(201).json({
        success: true,
        op: "document_upload",
        fileBytes: req.file?.size ?? 0,
        bodyKeys: Object.keys(req.body || {}),
      });
    }
  );
  app.post(
    "/api/public/admissions/:schoolSlug/applications/:id/payment-proof",
    upload.single("file"),
    (req, res) => {
      res.status(201).json({
        success: true,
        op: "payment_proof_upload",
        fileBytes: req.file?.size ?? 0,
      });
    }
  );
  app.post("/api/admissions/settings", (req, res) => {
    res.json({
      success: true,
      route: "staff",
      bytes: Buffer.byteLength(JSON.stringify(req.body || {}), "utf8"),
    });
  });
  app.post("/api/payfast/create-checkout", (req, res) => {
    res.json({
      success: true,
      route: "payfast",
      bytes: Buffer.byteLength(JSON.stringify(req.body || {}), "utf8"),
    });
  });
  app.post("/api/other/large-json", (req, res) => {
    res.json({
      success: true,
      route: "other",
      bytes: Buffer.byteLength(JSON.stringify(req.body || {}), "utf8"),
    });
  });

  return app;
}

async function withServer(
  app: express.Express,
  fn: (base: string) => Promise<void>
): Promise<void> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  }
}

async function postJson(
  url: string,
  body: unknown
): Promise<{ status: number; json: any }> {
  const raw = JSON.stringify(body);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(raw)) },
    body: raw,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function patchJson(
  url: string,
  body: unknown
): Promise<{ status: number; json: any }> {
  const raw = JSON.stringify(body);
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(raw)) },
    body: raw,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function postMultipart(
  url: string,
  fileBytes: number,
  fieldName = "file",
  filename = "doc.pdf"
): Promise<{ status: number; json: any }> {
  const boundary = "----oaJsonLimitBoundary7MA4YWxkTrZu0gW";
  const preamble = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\n` +
      `Content-Type: application/pdf\r\n\r\n`
  );
  const file = Buffer.alloc(fileBytes, 0x41);
  const closing = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([preamble, file, closing]);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": String(body.length),
    },
    body,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function main() {
  const realistic = buildRealisticCompletedOaPayload();
  const realisticBytes = jsonBytes(realistic);
  const rich = buildRichStressOaPayload();
  const richBytes = jsonBytes(rich);

  console.log("MEASURED realistic completed OA JSON bytes:", realisticBytes);
  console.log(
    "MEASURED realistic completed OA JSON KiB:",
    (realisticBytes / 1024).toFixed(2)
  );
  console.log("MEASURED rich stress OA JSON bytes:", richBytes);
  console.log("MEASURED rich stress OA JSON KiB:", (richBytes / 1024).toFixed(2));
  console.log("SELECTED limit bytes:", PUBLIC_ADMISSIONS_JSON_LIMIT_BYTES);
  console.log(
    "SELECTED limit KiB:",
    PUBLIC_ADMISSIONS_JSON_LIMIT_BYTES / 1024
  );

  assert.ok(
    realisticBytes < 16 * 1024,
    "realistic fixture should be small (~few KiB)"
  );
  assert.ok(
    richBytes < PUBLIC_ADMISSIONS_JSON_LIMIT_BYTES,
    "rich stress fixture must fit under selected limit"
  );
  assert.equal(PUBLIC_ADMISSIONS_JSON_LIMIT_BYTES, 256 * 1024);
  assert.equal(ADMISSIONS_MAX_UPLOAD_BYTES, 8 * 1024 * 1024);

  // Just under 256 KiB (leave margin for JSON quoting overhead).
  const justBelow = {
    pad: "z".repeat(PUBLIC_ADMISSIONS_JSON_LIMIT_BYTES - 64),
  };
  const justBelowBytes = jsonBytes(justBelow);
  assert.ok(
    justBelowBytes < PUBLIC_ADMISSIONS_JSON_LIMIT_BYTES,
    `just-below must be under limit (got ${justBelowBytes})`
  );
  assert.ok(
    justBelowBytes > PUBLIC_ADMISSIONS_JSON_LIMIT_BYTES - 512,
    "just-below should sit near the ceiling"
  );

  const oversized = {
    pad: "x".repeat(PUBLIC_ADMISSIONS_JSON_LIMIT_BYTES + 4096),
  };
  assert.ok(jsonBytes(oversized) > PUBLIC_ADMISSIONS_JSON_LIMIT_BYTES);

  // Multipart file larger than JSON limit but under Multer 8 MiB.
  const multipartBytes = 400 * 1024;
  assert.ok(multipartBytes > PUBLIC_ADMISSIONS_JSON_LIMIT_BYTES);
  assert.ok(multipartBytes < ADMISSIONS_MAX_UPLOAD_BYTES);

  await withServer(createMirrorApp(), async (base) => {
    const slug = "oa-runtime-test";
    const pubId = "pub-1";

    const okCreate = await postJson(
      `${base}/api/public/admissions/${slug}/applications`,
      realistic
    );
    assert.equal(okCreate.status, 201, "realistic create should parse");
    assert.equal(okCreate.json?.success, true);
    assert.equal(okCreate.json?.op, "draft_create");

    const okJustBelowCreate = await postJson(
      `${base}/api/public/admissions/${slug}/applications`,
      justBelow
    );
    assert.equal(
      okJustBelowCreate.status,
      201,
      `just-below create should parse (${justBelowBytes} bytes)`
    );

    const okPatch = await patchJson(
      `${base}/api/public/admissions/${slug}/applications/${pubId}`,
      realistic
    );
    assert.equal(okPatch.status, 200, "realistic PATCH update should parse");
    assert.equal(okPatch.json?.op, "draft_update");

    const okJustBelowPatch = await patchJson(
      `${base}/api/public/admissions/${slug}/applications/${pubId}`,
      justBelow
    );
    assert.equal(okJustBelowPatch.status, 200, "just-below PATCH should parse");

    const okSubmit = await postJson(
      `${base}/api/public/admissions/${slug}/applications/${pubId}/submit`,
      {}
    );
    assert.equal(okSubmit.status, 200, "submit below limit should parse");
    assert.equal(okSubmit.json?.op, "submit");

    const tooBigCreate = await postJson(
      `${base}/api/public/admissions/${slug}/applications`,
      oversized
    );
    assert.equal(tooBigCreate.status, 413);
    assert.deepEqual(tooBigCreate.json, {
      success: false,
      error: "Request body too large",
      code: "BODY_TOO_LARGE",
    });

    const tooBigPatch = await patchJson(
      `${base}/api/public/admissions/${slug}/applications/${pubId}`,
      oversized
    );
    assert.equal(tooBigPatch.status, 413);
    assert.equal(tooBigPatch.json?.code, "BODY_TOO_LARGE");

    const docUpload = await postMultipart(
      `${base}/api/public/admissions/${slug}/applications/${pubId}/documents`,
      multipartBytes
    );
    assert.equal(
      docUpload.status,
      201,
      "multipart document upload must not be blocked by JSON body limit"
    );
    assert.equal(docUpload.json?.op, "document_upload");
    assert.equal(docUpload.json?.fileBytes, multipartBytes);

    const popUpload = await postMultipart(
      `${base}/api/public/admissions/${slug}/applications/${pubId}/payment-proof`,
      multipartBytes,
      "file",
      "proof.pdf"
    );
    assert.equal(
      popUpload.status,
      201,
      "multipart payment-proof upload must not be blocked by JSON body limit"
    );
    assert.equal(popUpload.json?.op, "payment_proof_upload");
    assert.equal(popUpload.json?.fileBytes, multipartBytes);
  });

  // Static scope: index order + multer unchanged.
  const srcRoot = path.join(__dirname, "..");
  const indexSrc = fs.readFileSync(path.join(srcRoot, "index.ts"), "utf8");
  const publicRoute = fs.readFileSync(
    path.join(srcRoot, "routes/publicAdmissions.ts"),
    "utf8"
  );

  const oaIdx = indexSrc.indexOf(
    'app.use("/api/public/admissions", publicAdmissionsJsonParser)'
  );
  const globalIdx = indexSrc.indexOf('app.use(express.json({ limit: "12mb" }))');
  assert.ok(oaIdx >= 0, "public OA JSON parser must be mounted");
  assert.ok(globalIdx >= 0, "global 12mb JSON parser must remain");
  assert.ok(
    oaIdx < globalIdx,
    "public OA JSON parser must be registered BEFORE global 12mb parser"
  );
  assert.ok(
    /limits:\s*\{\s*fileSize:\s*ADMISSIONS_MAX_UPLOAD_BYTES/.test(publicRoute),
    "multer fileSize still ADMISSIONS_MAX_UPLOAD_BYTES (8 MiB)"
  );

  console.log("✓ realistic payload accepted");
  console.log(`✓ just-below limit accepted (${justBelowBytes} bytes)`);
  console.log("✓ oversized OA POST/PATCH → 413 BODY_TOO_LARGE");
  console.log("✓ draft create / update / submit work below limit");
  console.log("✓ multipart document + payment-proof unaffected (>256 KiB file)");
  console.log("✓ parser order: public OA before global 12mb");
  console.log("✓ multer upload limit unchanged at 8 MiB");
  console.log("\nAll publicAdmissionsJsonLimit unit tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
