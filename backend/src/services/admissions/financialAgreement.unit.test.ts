/**
 * Financial agreement unit tests (no database).
 * Run: npx ts-node --transpile-only src/services/admissions/financialAgreement.unit.test.ts
 */
import assert from "assert";
import fs from "fs";
import path from "path";
import zlib from "zlib";

import {
  bothFinancialDocumentsPublished,
  canonicalizeLegalBody,
  financialAgreementSubmitErrors,
  hashLegalBody,
  normalizeSignerName,
  pngHasVisibleInk,
  validateFinancialSignaturePng,
} from "./financialAgreementService";
import { PublicAdmissionsError } from "./resolvePublicAdmissions";

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) {
      const mask = -(c & 1);
      c = (c >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

export function rgbPng(
  width: number,
  height: number,
  paint: (x: number, y: number) => [number, number, number]
): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc(height * (1 + width * 3));
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    raw[offset] = 0;
    offset += 1;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = paint(x, y);
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      offset += 3;
    }
  }
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function expectCode(fn: () => void, code: string) {
  try {
    fn();
    assert.fail(`expected ${code}`);
  } catch (err) {
    assert.ok(err instanceof PublicAdmissionsError);
    assert.strictEqual(err.code, code);
  }
}

function main() {
  assert.strictEqual(canonicalizeLegalBody("a\r\nb\rc"), "a\nb\nc");
  const canonical = canonicalizeLegalBody("Policy line\r\n");
  assert.strictEqual(hashLegalBody(canonical), hashLegalBody("Policy line\n"));
  assert.notStrictEqual(hashLegalBody("Policy line\n"), hashLegalBody("Policy line\n "));
  assert.strictEqual(normalizeSignerName("  Mary   Jane  "), "mary jane");
  assert.strictEqual(normalizeSignerName("Mary\u2019s Jane"), "mary's jane");

  const blank = rgbPng(2, 2, () => [255, 255, 255]);
  const ink = rgbPng(2, 2, (x, y) => (x === 0 && y === 0 ? [0, 0, 0] : [255, 255, 255]));
  assert.strictEqual(pngHasVisibleInk(blank), false);
  assert.strictEqual(pngHasVisibleInk(ink), true);
  expectCode(() => validateFinancialSignaturePng(Buffer.alloc(0), 1), "SIGNATURE_REQUIRED");
  expectCode(() => validateFinancialSignaturePng(ink, 0), "SIGNATURE_STROKE_REQUIRED");
  expectCode(() => validateFinancialSignaturePng(blank, 1), "SIGNATURE_BLANK");
  expectCode(
    () => validateFinancialSignaturePng(Buffer.concat([ink, Buffer.alloc(200 * 1024)]), 1),
    "FILE_TOO_LARGE"
  );
  expectCode(
    () => validateFinancialSignaturePng(Buffer.from([0xff, 0xd8, 0xff, 0x00]), 1),
    "INVALID_SIGNATURE_TYPE"
  );
  validateFinancialSignaturePng(ink, 1);

  const documents = [
    { kind: "FINANCIAL_POLICY", title: "Policy", contentSha256: "hash-policy" },
    { kind: "FINANCIAL_DECLARATION", title: "Declaration", contentSha256: "hash-declaration" },
  ];
  const guardian = {
    id: "g1",
    firstName: "Mary",
    surname: "Jane",
    isPayingPerson: true,
  };
  const acceptance = {
    kind: "FINANCIAL_POLICY",
    contentSha256: "hash-policy",
    signerGuardianId: "g1",
    signerFullNameSnapshot: "Mary Jane",
    typedSignerName: "mary jane",
    signatureFileKey: "school/app/sig.png",
  };
  assert.deepStrictEqual(
    financialAgreementSubmitErrors({ documents: [], acceptances: [], guardians: [] }),
    []
  );
  assert.strictEqual(bothFinancialDocumentsPublished([documents[0]]), false);
  assert.ok(
    financialAgreementSubmitErrors({
      documents,
      acceptances: [],
      guardians: [{ ...guardian, isPayingPerson: false }],
    }).some((error) => error.field === "guardians.isPayingPerson")
  );
  assert.ok(
    financialAgreementSubmitErrors({
      documents,
      acceptances: [],
      guardians: [guardian, { ...guardian, id: "g2", isPayingPerson: true }],
    }).some((error) => error.message.includes("Exactly one"))
  );
  assert.ok(
    financialAgreementSubmitErrors({
      documents,
      acceptances: [{ ...acceptance, contentSha256: "old" }, { ...acceptance, kind: "FINANCIAL_DECLARATION" }],
      guardians: [guardian],
    }).some((error) => error.message.includes("signed again"))
  );
  assert.strictEqual(
    financialAgreementSubmitErrors({
      documents,
      acceptances: [
        acceptance,
        { ...acceptance, kind: "FINANCIAL_DECLARATION", contentSha256: "hash-declaration" },
      ],
      guardians: [guardian],
    }).length,
    0
  );

  const root = path.resolve(__dirname, "../../..");
  const migration = fs.readFileSync(
    path.join(root, "prisma/migrations/20260921160000_admissions_financial_agreement/migration.sql"),
    "utf8"
  );
  assert.ok(!/INSERT INTO/i.test(migration));
  assert.match(migration, /financialAgreementRequired" BOOLEAN NOT NULL DEFAULT false/);
  assert.match(migration, /WHERE "supersededAt" IS NULL/);
  const publicRoutes = fs.readFileSync(path.join(root, "src/routes/publicAdmissions.ts"), "utf8");
  const paymentBlock = publicRoutes.split("payment-proof")[1] || "";
  assert.ok(!paymentBlock.includes("signFinancialAgreement"));
  assert.ok(!paymentBlock.includes("financialAgreement"));
  const proof = fs.readFileSync(
    path.join(root, "src/services/admissions/admissionsDocumentService.ts"),
    "utf8"
  );
  assert.ok(!proof.includes("financialAgreement"));
  const payfastDir = path.join(root, "src");
  const payfastHits: string[] = [];
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        walk(full);
      } else if (/payfast/i.test(entry.name) && entry.name.endsWith(".ts")) {
        payfastHits.push(fs.readFileSync(full, "utf8"));
      }
    }
  }
  walk(payfastDir);
  assert.ok(payfastHits.length > 0);
  for (const source of payfastHits) {
    assert.ok(!source.includes("financialAgreement"));
    assert.ok(!source.includes("SchoolAdmissionsLegalDocument"));
  }

  console.log("financial agreement unit tests passed");
}

main();
