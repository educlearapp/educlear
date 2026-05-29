import fs from "fs";
import os from "os";
import path from "path";

import {
  parseSasamsClassListDirectory,
  parseSasamsLearnerRegister,
  type SasamsParsedLearner,
} from "../daSilvaMigration/sasamsParsers";
import { resolveSpreadsheetPathForParsing } from "./spreadsheetUpload";

function isLearnerRegisterFile(fileName: string): boolean {
  return /learner[\s_-]*register/i.test(fileName);
}

export function parseSasamsLearnerUploadFile(uploadPath: string): SasamsParsedLearner[] {
  const baseName = path.basename(uploadPath);
  const { parsePath, cleanup } = resolveSpreadsheetPathForParsing(uploadPath);

  try {
    if (isLearnerRegisterFile(baseName)) {
      return parseSasamsLearnerRegister(parsePath);
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "educlear-sasams-cls-"));
    try {
      const ext = path.extname(parsePath) || ".xls";
      const dest = path.join(tmpDir, `upload${ext}`);
      fs.copyFileSync(parsePath, dest);
      const { learners } = parseSasamsClassListDirectory(tmpDir);
      return learners;
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  } finally {
    cleanup();
  }
}
