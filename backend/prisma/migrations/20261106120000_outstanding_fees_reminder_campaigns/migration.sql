-- Additive outstanding-fees reminder campaign tables.
-- Creates tables and indexes only. Does not change statement SMS history or billing rows.
-- Rollback: DROP TABLE "OutstandingFeesReminderRecipient"; DROP TABLE "OutstandingFeesReminderCampaign";

CREATE TABLE "OutstandingFeesReminderCampaign" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "messageType" TEXT NOT NULL,
    "billingPeriod" TEXT NOT NULL,
    "campaignKey" TEXT NOT NULL,
    "sendInstanceId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "messageTemplate" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "actorUserId" TEXT NOT NULL DEFAULT '',
    "authorizationText" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "OutstandingFeesReminderCampaign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OutstandingFeesReminderRecipient" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "recipientKey" TEXT NOT NULL,
    "familyAccountId" TEXT NOT NULL,
    "accountNo" TEXT NOT NULL,
    "phoneHash" TEXT NOT NULL,
    "mobileMasked" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "encoding" TEXT NOT NULL,
    "units" INTEGER NOT NULL,
    "segments" INTEGER NOT NULL,
    "credits" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "providerDetail" TEXT NOT NULL DEFAULT '',
    "providerCalled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "OutstandingFeesReminderRecipient_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OutstandingFeesReminderCampaign_schoolId_sendInstanceId_key"
  ON "OutstandingFeesReminderCampaign"("schoolId", "sendInstanceId");

CREATE INDEX "OutstandingFeesReminderCampaign_schoolId_billingPeriod_messageType_idx"
  ON "OutstandingFeesReminderCampaign"("schoolId", "billingPeriod", "messageType");

CREATE INDEX "OutstandingFeesReminderCampaign_schoolId_campaignKey_idx"
  ON "OutstandingFeesReminderCampaign"("schoolId", "campaignKey");

CREATE UNIQUE INDEX "OutstandingFeesReminderRecipient_campaignId_recipientKey_key"
  ON "OutstandingFeesReminderRecipient"("campaignId", "recipientKey");

CREATE INDEX "OutstandingFeesReminderRecipient_schoolId_phoneHash_status_idx"
  ON "OutstandingFeesReminderRecipient"("schoolId", "phoneHash", "status");

ALTER TABLE "OutstandingFeesReminderRecipient"
  ADD CONSTRAINT "OutstandingFeesReminderRecipient_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "OutstandingFeesReminderCampaign"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
