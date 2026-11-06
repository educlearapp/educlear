/**
 * Historical Communication SMS labels. No store rewrite and no SMS.
 * Run: node --import ./node_modules/tsx/dist/loader.mjs src/communication/smsCampaignStatus.test.ts
 */
import assert from "node:assert/strict";
import { describeCommunicationSmsCampaign } from "./smsCampaignStatus";

function contacts(status: string, count: number, detail?: string) {
  return Array.from({ length: count }, () => ({ status, statusDetail: detail }));
}

function testHistoricalPartialIsNotDelivered() {
  const described = describeCommunicationSmsCampaign({
    status: "Sent",
    contacts: [
      ...contacts("Accepted", 496, "WinSMS accepted this recipient."),
      ...contacts("Rejected", 35, "WinSMS rejected this recipient (BADDEST)."),
      ...contacts("Rejected", 47, "WinSMS rejected this recipient (INSUFFICIENT CREDITS)."),
    ],
  });
  assert.equal(described.label, "Partially accepted");
  assert.notEqual(described.label, "Delivered");
  assert.match(described.detail, /496 accepted/);
  assert.match(described.detail, /82 rejected/);
  assert.match(described.detail, /BADDEST \(35\)/);
  assert.match(described.detail, /INSUFFICIENT CREDITS \(47\)/);
  console.log("  ✓ a stored Sent batch with rejections displays as partially accepted");
}

function testAcceptanceIsNotDelivery() {
  const described = describeCommunicationSmsCampaign({
    status: "Sent",
    contacts: contacts("Accepted", 3),
  });
  assert.equal(described.label, "Accepted by provider");
  assert.equal(described.tone, "accepted");
  console.log("  ✓ acceptance alone is not Delivered");
}

function testDeliveredRequiresEvidenceOnEveryRecipient() {
  const all = describeCommunicationSmsCampaign({
    status: "Sent",
    contacts: contacts("Delivered", 2, "Delivered to handset"),
  });
  assert.equal(all.label, "Delivered");
  const mixed = describeCommunicationSmsCampaign({
    status: "Sent",
    contacts: [...contacts("Delivered", 1), ...contacts("Accepted", 1)],
  });
  assert.equal(mixed.label, "Accepted by provider");
  console.log("  ✓ Delivered requires delivery evidence for every recipient");
}

function testLegacySentStaysHistorical() {
  const described = describeCommunicationSmsCampaign({
    status: "Sent",
    contacts: contacts("Sent", 5),
  });
  assert.equal(described.label, "Sent");
  assert.match(described.detail, /not a delivery receipt/);
  console.log("  ✓ legacy Sent contacts without provider results stay historical");
}

function testRejectedAndUnconfirmed() {
  assert.equal(
    describeCommunicationSmsCampaign({ status: "Sent", contacts: contacts("Rejected", 2, "BADDEST") }).label,
    "All rejected"
  );
  assert.equal(
    describeCommunicationSmsCampaign({ status: "Unknown", contacts: contacts("Pending", 2) }).label,
    "Pending or unconfirmed"
  );
  console.log("  ✓ all rejected and pending stay distinct");
}

function main() {
  console.log("smsCampaignStatus.test.ts");
  testHistoricalPartialIsNotDelivered();
  testAcceptanceIsNotDelivery();
  testDeliveredRequiresEvidenceOnEveryRecipient();
  testLegacySentStaysHistorical();
  testRejectedAndUnconfirmed();
  console.log("smsCampaignStatus.test.ts: OK");
}

main();
