/**
 * Durable outstanding-fees reminder campaigns.
 * Production uses Postgres and a per-school transaction lock so concurrent
 * backend instances share one reservation. The JSON file is only the unit-test store.
 * Raw mobile numbers are never written.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";

const REMINDER_MESSAGE_TYPE = "outstanding_fees_reminder";

export type ReminderProviderStatus = "accepted" | "failed" | "pending";

export type StoredRecipient = {
  recipientKey: string;
  familyAccountId: string;
  accountNo: string;
  phoneHash: string;
  mobileMasked: string;
  displayName: string;
  message: string;
  encoding: "gsm" | "ucs2";
  units: number;
  segments: number;
  credits: number;
  status: ReminderProviderStatus;
  providerDetail: string | null;
  providerCalled: boolean;
};

export type ReminderCampaign = {
  campaignId: string;
  messageType: string;
  schoolId: string;
  billingPeriod: string;
  campaignKey: string;
  sendInstanceId: string;
  contentHash: string;
  messageTemplate: string;
  state: "in_progress" | "completed";
  createdAt: string;
  completedAt?: string;
  actorUserId?: string;
  authorizationText?: string;
  recipients: StoredRecipient[];
};

type StoreFile = { campaigns: ReminderCampaign[] };

export type ClaimMutation = {
  campaigns: ReminderCampaign[];
  result: unknown;
};

let testDataDir: string | null = null;

export function setOutstandingFeesReminderDataDirForTests(dataDir: string | null): void {
  testDataDir = dataDir ? path.resolve(dataDir) : null;
}

export function reminderStoreUsesDatabase(): boolean {
  return testDataDir == null;
}

function dataDir(): string {
  return testDataDir ?? path.join(process.cwd(), "data");
}

function storePath(): string {
  return path.join(dataDir(), "outstanding-fees-reminder-campaigns.json");
}

function lockPath(): string {
  return path.join(dataDir(), ".outstanding-fees-reminder-campaigns.lock");
}

function sleepMs(ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* synchronous lock wait for the unit-test file store */
  }
}

function withFileLock<T>(fn: () => T): T {
  fs.mkdirSync(dataDir(), { recursive: true });
  const started = Date.now();
  while (Date.now() - started < 8000) {
    try {
      fs.writeFileSync(lockPath(), String(process.pid), { flag: "wx" });
      try {
        return fn();
      } finally {
        try {
          fs.unlinkSync(lockPath());
        } catch {
          /* ignore */
        }
      }
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code !== "EEXIST") throw error;
      try {
        const stat = fs.statSync(lockPath());
        if (Date.now() - stat.mtimeMs > 30_000) fs.unlinkSync(lockPath());
      } catch {
        /* released */
      }
      sleepMs(15);
    }
  }
  throw new Error("Outstanding fees reminder log is busy. Nothing was sent.");
}

function readStore(): StoreFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath(), "utf8")) as StoreFile;
    return { campaigns: Array.isArray(parsed?.campaigns) ? parsed.campaigns : [] };
  } catch {
    return { campaigns: [] };
  }
}

function writeStore(store: StoreFile) {
  const tmp = `${storePath()}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), "utf8");
  fs.renameSync(tmp, storePath());
}

export function readOutstandingFeesReminderCampaignsForTests(): ReminderCampaign[] {
  return readStore().campaigns;
}

function scoped(
  campaigns: ReminderCampaign[],
  schoolId: string,
  billingPeriod: string,
  messageType = REMINDER_MESSAGE_TYPE
): ReminderCampaign[] {
  return campaigns.filter(
    (campaign) =>
      campaign.schoolId === schoolId &&
      campaign.billingPeriod === billingPeriod &&
      campaign.messageType === messageType
  );
}

function cloneCampaigns(campaigns: ReminderCampaign[]): ReminderCampaign[] {
  return JSON.parse(JSON.stringify(campaigns)) as ReminderCampaign[];
}

async function fileList(
  schoolId: string,
  billingPeriod: string,
  messageType = REMINDER_MESSAGE_TYPE
): Promise<ReminderCampaign[]> {
  return withFileLock(() => scoped(readStore().campaigns, schoolId, billingPeriod, messageType));
}

async function fileTransaction<T>(
  schoolId: string,
  billingPeriod: string,
  messageType: string,
  fn: (campaigns: ReminderCampaign[]) => { campaigns: ReminderCampaign[]; result: T }
): Promise<T> {
  return withFileLock(() => {
    const all = readStore().campaigns;
    const current = cloneCampaigns(scoped(all, schoolId, billingPeriod, messageType));
    const next = fn(current);
    for (const campaign of next.campaigns) {
      if (
        campaign.schoolId !== schoolId ||
        campaign.billingPeriod !== billingPeriod ||
        campaign.messageType !== messageType
      ) {
        throw new Error("Reminder campaign school did not match the locked school.");
      }
    }
    const rest = all.filter(
      (campaign) =>
        !(
          campaign.schoolId === schoolId &&
          campaign.billingPeriod === billingPeriod &&
          campaign.messageType === messageType
        )
    );
    writeStore({ campaigns: [...rest, ...next.campaigns] });
    return next.result;
  });
}

type PrismaCampaignDelegate = {
  findMany: (args: unknown) => Promise<PrismaCampaignRow[]>;
  create: (args: unknown) => Promise<unknown>;
  updateMany: (args: unknown) => Promise<{ count: number }>;
};

type PrismaRecipientDelegate = {
  updateMany: (args: unknown) => Promise<{ count: number }>;
};

type PrismaCampaignRow = {
  id: string;
  schoolId: string;
  messageType: string;
  billingPeriod: string;
  campaignKey: string;
  sendInstanceId: string;
  contentHash: string;
  messageTemplate: string;
  state: string;
  createdAt: Date;
  completedAt: Date | null;
  actorUserId: string;
  authorizationText: string;
  recipients: Array<{
    recipientKey: string;
    familyAccountId: string;
    accountNo: string;
    phoneHash: string;
    mobileMasked: string;
    displayName: string;
    message: string;
    encoding: string;
    units: number;
    segments: number;
    credits: number;
    status: string;
    providerDetail: string;
    providerCalled: boolean;
  }>;
};

type PrismaTx = {
  $executeRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<number>;
  outstandingFeesReminderCampaign: PrismaCampaignDelegate;
  outstandingFeesReminderRecipient: PrismaRecipientDelegate;
};

async function prismaClient(): Promise<{
  $transaction: <T>(fn: (tx: PrismaTx) => Promise<T>, options?: { maxWait?: number; timeout?: number }) => Promise<T>;
  outstandingFeesReminderCampaign: PrismaCampaignDelegate;
  outstandingFeesReminderRecipient: PrismaRecipientDelegate;
}> {
  const loaded = await import("../prisma");
  return loaded.prisma as unknown as Awaited<ReturnType<typeof prismaClient>>;
}

function mapRow(row: PrismaCampaignRow): ReminderCampaign {
  return {
    campaignId: row.id,
    messageType: row.messageType,
    schoolId: row.schoolId,
    billingPeriod: row.billingPeriod,
    campaignKey: row.campaignKey,
    sendInstanceId: row.sendInstanceId,
    contentHash: row.contentHash,
    messageTemplate: row.messageTemplate,
    state: row.state === "completed" ? "completed" : "in_progress",
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : undefined,
    actorUserId: row.actorUserId || undefined,
    authorizationText: row.authorizationText || undefined,
    recipients: row.recipients.map((recipient) => ({
      recipientKey: recipient.recipientKey,
      familyAccountId: recipient.familyAccountId,
      accountNo: recipient.accountNo,
      phoneHash: recipient.phoneHash,
      mobileMasked: recipient.mobileMasked,
      displayName: recipient.displayName,
      message: recipient.message,
      encoding: recipient.encoding === "ucs2" ? "ucs2" : "gsm",
      units: recipient.units,
      segments: recipient.segments,
      credits: recipient.credits,
      status: recipient.status === "accepted" || recipient.status === "failed" ? recipient.status : "pending",
      providerDetail: recipient.providerDetail || null,
      providerCalled: recipient.providerCalled,
    })),
  };
}

async function loadRows(
  db: { outstandingFeesReminderCampaign: PrismaCampaignDelegate },
  schoolId: string,
  billingPeriod: string,
  messageType = REMINDER_MESSAGE_TYPE
) {
  const rows = await db.outstandingFeesReminderCampaign.findMany({
    where: { schoolId, billingPeriod, messageType },
    include: { recipients: true },
  });
  return rows.map(mapRow);
}

function campaignLockKey(schoolId: string, messageType: string): string {
  if (messageType === REMINDER_MESSAGE_TYPE) return `outstanding-fees-reminder:${schoolId}`;
  return `${messageType}:${schoolId}`;
}

async function persistDiff(tx: PrismaTx, schoolId: string, before: ReminderCampaign[], after: ReminderCampaign[]) {
  const previous = new Map(before.map((campaign) => [campaign.campaignId, campaign]));
  for (const campaign of after) {
    if (campaign.schoolId !== schoolId) {
      throw new Error("Reminder campaign school did not match the locked school.");
    }
    const existing = previous.get(campaign.campaignId);
    if (!existing) {
      await tx.outstandingFeesReminderCampaign.create({
        data: {
          id: campaign.campaignId,
          schoolId: campaign.schoolId,
          messageType: campaign.messageType,
          billingPeriod: campaign.billingPeriod,
          campaignKey: campaign.campaignKey,
          sendInstanceId: campaign.sendInstanceId,
          contentHash: campaign.contentHash,
          messageTemplate: campaign.messageTemplate,
          state: campaign.state,
          createdAt: new Date(campaign.createdAt),
          completedAt: campaign.completedAt ? new Date(campaign.completedAt) : null,
          actorUserId: campaign.actorUserId || "",
          authorizationText: campaign.authorizationText || "",
          recipients: {
            create: campaign.recipients.map((recipient) => ({
              id: crypto.randomUUID(),
              schoolId: campaign.schoolId,
              recipientKey: recipient.recipientKey,
              familyAccountId: recipient.familyAccountId,
              accountNo: recipient.accountNo,
              phoneHash: recipient.phoneHash,
              mobileMasked: recipient.mobileMasked,
              displayName: recipient.displayName,
              message: recipient.message,
              encoding: recipient.encoding,
              units: recipient.units,
              segments: recipient.segments,
              credits: recipient.credits,
              status: recipient.status,
              providerDetail: recipient.providerDetail || "",
              providerCalled: recipient.providerCalled,
            })),
          },
        },
      });
      continue;
    }
    if (existing.state !== campaign.state || existing.completedAt !== campaign.completedAt) {
      const updated = await tx.outstandingFeesReminderCampaign.updateMany({
        where: { id: campaign.campaignId, schoolId },
        data: {
          state: campaign.state,
          completedAt: campaign.completedAt ? new Date(campaign.completedAt) : null,
        },
      });
      if (updated.count !== 1) throw new Error("Reminder campaign did not belong to this school.");
    }
  }
}

async function databaseList(
  schoolId: string,
  billingPeriod: string,
  messageType = REMINDER_MESSAGE_TYPE
): Promise<ReminderCampaign[]> {
  const db = await prismaClient();
  return loadRows(db, schoolId, billingPeriod, messageType);
}

async function databaseTransaction<T>(
  schoolId: string,
  billingPeriod: string,
  messageType: string,
  fn: (campaigns: ReminderCampaign[]) => { campaigns: ReminderCampaign[]; result: T }
): Promise<T> {
  const db = await prismaClient();
  const lockKey = campaignLockKey(schoolId, messageType);
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
      const current = await loadRows(tx, schoolId, billingPeriod, messageType);
      const next = fn(cloneCampaigns(current));
      for (const campaign of next.campaigns) {
        if (campaign.schoolId !== schoolId || campaign.billingPeriod !== billingPeriod || campaign.messageType !== messageType) {
          throw new Error("Reminder campaign school did not match the locked school.");
        }
      }
      await persistDiff(tx, schoolId, current, next.campaigns);
      return next.result;
    },
    { maxWait: 8000, timeout: 15000 }
  );
}

async function databaseUpdateRecipient(
  campaignId: string,
  schoolId: string,
  recipientKey: string,
  status: ReminderProviderStatus,
  providerDetail: string | null
) {
  const db = await prismaClient();
  const updated = await db.outstandingFeesReminderRecipient.updateMany({
    where: { campaignId, schoolId, recipientKey },
    data: { status, providerDetail: providerDetail || "" },
  });
  if (updated.count !== 1) {
    throw new Error("Reminder recipient did not belong to this school.");
  }
}

async function databaseComplete(campaignId: string, schoolId: string, completedAt: string) {
  const db = await prismaClient();
  const updated = await db.outstandingFeesReminderCampaign.updateMany({
    where: { id: campaignId, schoolId },
    data: { state: "completed", completedAt: new Date(completedAt) },
  });
  if (updated.count !== 1) {
    throw new Error("Reminder campaign did not belong to this school.");
  }
}

async function databaseFind(
  schoolId: string,
  campaignId: string,
  messageType = REMINDER_MESSAGE_TYPE
): Promise<ReminderCampaign | null> {
  const db = await prismaClient();
  const rows = await db.outstandingFeesReminderCampaign.findMany({
    where: { id: campaignId, schoolId, messageType },
    include: { recipients: true },
  });
  return rows[0] ? mapRow(rows[0]) : null;
}

export const reminderCampaignStore = {
  list(schoolId: string, billingPeriod: string, messageType = REMINDER_MESSAGE_TYPE): Promise<ReminderCampaign[]> {
    return reminderStoreUsesDatabase()
      ? databaseList(schoolId, billingPeriod, messageType)
      : fileList(schoolId, billingPeriod, messageType);
  },
  transaction<T>(
    schoolId: string,
    billingPeriod: string,
    fn: (campaigns: ReminderCampaign[]) => { campaigns: ReminderCampaign[]; result: T },
    messageType = REMINDER_MESSAGE_TYPE
  ): Promise<T> {
    return reminderStoreUsesDatabase()
      ? databaseTransaction(schoolId, billingPeriod, messageType, fn)
      : fileTransaction(schoolId, billingPeriod, messageType, fn);
  },
  async updateRecipient(
    campaignId: string,
    schoolId: string,
    recipientKey: string,
    status: ReminderProviderStatus,
    providerDetail: string | null
  ): Promise<void> {
    if (!reminderStoreUsesDatabase()) {
      withFileLock(() => {
        const store = readStore();
        const campaign = store.campaigns.find((row) => row.campaignId === campaignId && row.schoolId === schoolId);
        const recipient = campaign?.recipients.find((row) => row.recipientKey === recipientKey);
        if (!campaign || !recipient) return;
        recipient.status = status;
        recipient.providerDetail = providerDetail;
        writeStore(store);
      });
      return;
    }
    await databaseUpdateRecipient(campaignId, schoolId, recipientKey, status, providerDetail);
  },
  async complete(campaignId: string, schoolId: string, completedAt: string): Promise<void> {
    if (!reminderStoreUsesDatabase()) {
      withFileLock(() => {
        const store = readStore();
        const campaign = store.campaigns.find((row) => row.campaignId === campaignId && row.schoolId === schoolId);
        if (!campaign) return;
        campaign.state = "completed";
        campaign.completedAt = completedAt;
        writeStore(store);
      });
      return;
    }
    await databaseComplete(campaignId, schoolId, completedAt);
  },
  find(schoolId: string, campaignId: string, messageType = REMINDER_MESSAGE_TYPE): Promise<ReminderCampaign | null> {
    if (!reminderStoreUsesDatabase()) {
      return Promise.resolve(
        withFileLock(
          () =>
            readStore().campaigns.find(
              (row) =>
                row.campaignId === campaignId && row.schoolId === schoolId && row.messageType === messageType
            ) || null
        )
      );
    }
    return databaseFind(schoolId, campaignId, messageType);
  },
};
