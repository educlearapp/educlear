import fs from "fs";
import path from "path";
import { prisma } from "../prisma";

const DATA_DIR = path.join(process.cwd(), "data");

const JSON_STORE_FILES = [
  "billing-ledger.json",
  "learner-billing-plans.json",
  "kidesys-transaction-history.json",
  "user-access.json",
  "family-account-audit.json",
  "banking-imports.json",
  "communication-store.json",
  "legal-document-history.json",
] as const;

export type SchoolPurgeCountMap = Record<string, number>;

export type JsonStoreImpact = {
  file: string;
  action: string;
  detail: string;
};

/** Remove imported school operational data; keeps School row and users. */
export async function purgeImportedSchoolData(schoolId: string): Promise<SchoolPurgeCountMap> {
  const removed: SchoolPurgeCountMap = {};

  const run = async (key: string, fn: () => Promise<{ count: number }>) => {
    const r = await fn();
    if (r.count) removed[key] = r.count;
  };

  await run("communicationRecipient", () =>
    prisma.communicationRecipient.deleteMany({ where: { message: { schoolId } } })
  );
  await run("communicationLog", () => prisma.communicationLog.deleteMany({ where: { schoolId } }));
  await run("communicationMessage", () =>
    prisma.communicationMessage.deleteMany({ where: { schoolId } })
  );
  await run("communicationCampaign", () =>
    prisma.communicationCampaign.deleteMany({ where: { schoolId } })
  );
  await run("communicationTemplate", () =>
    prisma.communicationTemplate.deleteMany({ where: { schoolId } })
  );
  await run("parentTeacherMessage", () =>
    prisma.parentTeacherMessage.deleteMany({ where: { schoolId } })
  );
  await run("parentTeacherThread", () =>
    prisma.parentTeacherThread.deleteMany({ where: { schoolId } })
  );
  await run("parentLearnerLink", () =>
    prisma.parentLearnerLink.deleteMany({ where: { schoolId } })
  );
  await run("learnerIncident", () => prisma.learnerIncident.deleteMany({ where: { schoolId } }));
  await run("learnerResult", () => prisma.learnerResult.deleteMany({ where: { schoolId } }));
  await run("learnerReport", () => prisma.learnerReport.deleteMany({ where: { schoolId } }));
  await run("billingDepositAllocation", () =>
    prisma.billingDepositAllocation.deleteMany({ where: { deposit: { schoolId } } })
  );
  await run("billingDepositHistoryEntry", () =>
    prisma.billingDepositHistoryEntry.deleteMany({ where: { deposit: { schoolId } } })
  );
  await run("billingDeposit", () => prisma.billingDeposit.deleteMany({ where: { schoolId } }));
  await run("bankTransaction", () => prisma.bankTransaction.deleteMany({ where: { schoolId } }));
  await run("bankStatementImport", () =>
    prisma.bankStatementImport.deleteMany({ where: { schoolId } })
  );
  await run("accountingJournalLine", () =>
    prisma.accountingJournalLine.deleteMany({ where: { journal: { schoolId } } })
  );
  await run("accountingJournal", () =>
    prisma.accountingJournal.deleteMany({ where: { schoolId } })
  );
  await run("supplierInvoicePayment", () =>
    prisma.supplierInvoicePayment.deleteMany({ where: { invoice: { schoolId } } })
  );
  await run("supplierInvoiceLine", () =>
    prisma.supplierInvoiceLine.deleteMany({ where: { invoice: { schoolId } } })
  );
  await run("supplierInvoice", () => prisma.supplierInvoice.deleteMany({ where: { schoolId } }));
  await run("supplier", () => prisma.supplier.deleteMany({ where: { schoolId } }));
  await run("expenseCategory", () => prisma.expenseCategory.deleteMany({ where: { schoolId } }));
  await run("payslip", () => prisma.payslip.deleteMany({ where: { schoolId } }));
  await run("payrollEmailLog", () => prisma.payrollEmailLog.deleteMany({ where: { schoolId } }));
  await run("payrollItem", () =>
    prisma.payrollItem.deleteMany({
      where: { payrollRunEmployee: { payrollRun: { schoolId } } },
    })
  );
  await run("payrollRunEmployee", () =>
    prisma.payrollRunEmployee.deleteMany({ where: { payrollRun: { schoolId } } })
  );
  await run("payrollRun", () => prisma.payrollRun.deleteMany({ where: { schoolId } }));
  await run("payrollSetting", () => prisma.payrollSetting.deleteMany({ where: { schoolId } }));
  await run("learner", () => prisma.learner.deleteMany({ where: { schoolId } }));
  await run("parentOnboarding", () => prisma.parentOnboarding.deleteMany({ where: { schoolId } }));
  await run("parentOutreachQueue", () =>
    prisma.parentOutreachQueue.deleteMany({ where: { schoolId } })
  );
  await run("parentNotification", () =>
    prisma.parentNotification.deleteMany({ where: { schoolId } })
  );
  await run("pushSubscription", () => prisma.pushSubscription.deleteMany({ where: { schoolId } }));
  await run("parent", () => prisma.parent.deleteMany({ where: { schoolId } }));
  await run("familyAccount", () => prisma.familyAccount.deleteMany({ where: { schoolId } }));
  await run("homeworkPost", () => prisma.homeworkPost.deleteMany({ where: { schoolId } }));
  await run("schoolNotice", () => prisma.schoolNotice.deleteMany({ where: { schoolId } }));
  await run("parentDocument", () => prisma.parentDocument.deleteMany({ where: { schoolId } }));
  await run("classroom", () => prisma.classroom.deleteMany({ where: { schoolId } }));
  await run("employee", () => prisma.employee.deleteMany({ where: { schoolId } }));
  await run("letter", () => prisma.letter.deleteMany({ where: { schoolId } }));
  await run("letterTemplate", () => prisma.letterTemplate.deleteMany({ where: { schoolId } }));
  await run("feeStructure", () => prisma.feeStructure.deleteMany({ where: { schoolId } }));
  await run("schoolFeeSetting", () => prisma.schoolFeeSetting.deleteMany({ where: { schoolId } }));
  await run("teacherPerformance", () =>
    prisma.teacherPerformance.deleteMany({ where: { schoolId } })
  );
  await run("billingSettings", () => prisma.billingSettings.deleteMany({ where: { schoolId } }));
  await run("schoolEmailSettings", () =>
    prisma.schoolEmailSettings.deleteMany({ where: { schoolId } })
  );
  await run("schoolCommunicationProfile", () =>
    prisma.schoolCommunicationProfile.deleteMany({ where: { schoolId } })
  );

  return removed;
}

export function clearJsonStoresForSchools(schoolIds: string[]): JsonStoreImpact[] {
  const idSet = new Set(schoolIds);
  const applied: JsonStoreImpact[] = [];

  for (const file of JSON_STORE_FILES) {
    const filePath = path.join(DATA_DIR, file);
    if (!fs.existsSync(filePath)) continue;

    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    let changed = false;

    if (file === "billing-ledger.json" && parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown[]>;
      for (const sid of schoolIds) {
        if (obj[sid]) {
          applied.push({
            file,
            action: "removed",
            detail: `${sid}: ${obj[sid].length} ledger entries`,
          });
          delete obj[sid];
          changed = true;
        }
      }
      if (changed) fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf8");
      continue;
    }

    if (file === "learner-billing-plans.json" && parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, Record<string, unknown>>;
      for (const sid of schoolIds) {
        if (obj[sid]) {
          applied.push({
            file,
            action: "removed",
            detail: `${sid}: ${Object.keys(obj[sid]).length} learner plan(s)`,
          });
          delete obj[sid];
          changed = true;
        }
      }
      if (changed) fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf8");
      continue;
    }

    if (file === "kidesys-transaction-history.json" && parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown[]>;
      for (const sid of schoolIds) {
        if (obj[sid]) {
          applied.push({
            file,
            action: "removed",
            detail: `${sid}: ${obj[sid].length} history row(s)`,
          });
          delete obj[sid];
          changed = true;
        }
      }
      if (changed) fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf8");
      continue;
    }

    if (file === "user-access.json" && parsed && typeof parsed === "object") {
      const store = parsed as { users: Record<string, { schoolId?: string }> };
      const before = Object.keys(store.users).length;
      for (const [uid, meta] of Object.entries(store.users)) {
        if (idSet.has(String(meta.schoolId || ""))) delete store.users[uid];
      }
      const removed = before - Object.keys(store.users).length;
      if (removed) {
        applied.push({ file, action: "removed", detail: `${removed} user access record(s)` });
        fs.writeFileSync(filePath, JSON.stringify(store, null, 2), "utf8");
      }
      continue;
    }

    if (file === "family-account-audit.json" && parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown[]>;
      for (const sid of schoolIds) {
        if (obj[sid]) {
          applied.push({ file, action: "removed", detail: `${sid}: ${obj[sid].length} audit row(s)` });
          delete obj[sid];
          changed = true;
        }
      }
      if (changed) fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf8");
      continue;
    }

    if (file === "banking-imports.json" && parsed && typeof parsed === "object") {
      const obj = parsed as { imports: Array<{ schoolId?: string }> };
      const before = obj.imports.length;
      obj.imports = obj.imports.filter((r) => !idSet.has(String(r.schoolId || "")));
      const removed = before - obj.imports.length;
      if (removed) {
        applied.push({ file, action: "filtered", detail: `${removed} import(s)` });
        fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf8");
      }
      continue;
    }

    if (file === "communication-store.json" && parsed && typeof parsed === "object") {
      const obj = parsed as { schools: Record<string, unknown> };
      for (const sid of schoolIds) {
        if (obj.schools[sid]) {
          applied.push({ file, action: "removed", detail: sid });
          delete obj.schools[sid];
          changed = true;
        }
      }
      if (changed) fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf8");
      continue;
    }

    if (file === "legal-document-history.json" && Array.isArray(parsed)) {
      const arr = parsed as Array<{ schoolId?: string }>;
      const before = arr.length;
      const next = arr.filter((r) => !idSet.has(String(r.schoolId || "")));
      const removed = before - next.length;
      if (removed) {
        applied.push({ file, action: "filtered", detail: `${removed} row(s)` });
        fs.writeFileSync(filePath, JSON.stringify(next, null, 2), "utf8");
      }
    }
  }

  return applied;
}
