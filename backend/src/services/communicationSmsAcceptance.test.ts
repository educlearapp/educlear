/**
 * Communication Centre WinSMS acceptance. No live SMS.
 * Run: node --import tsx src/services/communicationSmsAcceptance.test.ts
 */
import assert from "node:assert/strict";
import { classifyCommunicationSmsSend } from "./communicationSmsAcceptance";

const prepared = [
  { contactId: "c1", clientMessageId: "sms-1-c1" },
  { contactId: "c2", clientMessageId: "sms-1-c2" },
  { contactId: "c3", clientMessageId: "sms-1-c3" },
];

function testFullAcceptanceIsNotDelivery() {
  const result = classifyCommunicationSmsSend({
    prepared,
    providerResponse: {
      statusCode: 200,
      recipients: prepared.map((row) => ({ clientMessageId: row.clientMessageId, accepted: true })),
    },
  });
  assert.equal(result.accepted, 3);
  assert.equal(result.delivered, 0);
  assert.equal(result.campaignStatus, "Sent");
  assert.deepEqual(
    result.contacts.map((contact) => contact.status),
    ["Accepted", "Accepted", "Accepted"]
  );
  console.log("  ✓ HTTP 200 with accepted=true is Accepted, not Delivered");
}

function testPartialAcceptance() {
  const result = classifyCommunicationSmsSend({
    prepared,
    invalidContactIds: ["c0"],
    providerResponse: {
      statusCode: 200,
      recipients: [
        { clientMessageId: "sms-1-c1", accepted: true, deliveryStatus: "Delivered" },
        { clientMessageId: "sms-1-c2", accepted: false, acceptError: "BADDEST" },
        { clientMessageId: "sms-1-c3", accepted: true, deliveryStatus: "Pending" },
      ],
    },
  });
  assert.equal(result.delivered, 1);
  assert.equal(result.rejected, 1);
  assert.equal(result.pending, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.campaignStatus, "Sent");
  assert.equal(result.contacts.find((contact) => contact.contactId === "c0")?.status, "Failed");
  assert.equal(result.contacts.find((contact) => contact.contactId === "c2")?.detail?.includes("082"), false);
  console.log("  ✓ partial acceptance keeps delivered, rejected, pending and invalid numbers apart");
}

function testHttp200WithoutRecipientsIsUnknown() {
  const result = classifyCommunicationSmsSend({
    prepared: [prepared[0]],
    providerResponse: { statusCode: 200, creditBalance: 10 },
  });
  assert.equal(result.accepted, 0);
  assert.equal(result.unknown, 1);
  assert.equal(result.campaignStatus, "Unknown");
  assert.match(result.contacts[0].detail || "", /HTTP success was not treated as acceptance/);
  console.log("  ✓ HTTP 200 without a recipient result is Unknown");
}

function testRejectionAndNetwork() {
  const rejected = classifyCommunicationSmsSend({
    prepared: [prepared[0], prepared[1]],
    providerError: { statusCode: 422 },
  });
  assert.equal(rejected.rejected, 2);
  assert.equal(rejected.accepted, 0);
  assert.equal(rejected.campaignStatus, "Failed");

  const network = classifyCommunicationSmsSend({
    prepared: [prepared[0]],
    providerError: { statusCode: 0 },
  });
  assert.equal(network.unknown, 1);
  assert.equal(network.rejected, 0);
  assert.match(network.contacts[0].detail || "", /may already have been submitted/);

  const malformed = classifyCommunicationSmsSend({
    prepared: [prepared[0]],
    providerResponse: { statusCode: 200, recipients: [{ clientMessageId: "sms-1-c1" }] },
  });
  assert.equal(malformed.unknown, 1);
  console.log("  ✓ provider refusal, network loss and malformed rows stay distinct");
}

function classifyOne(deliveryStatus: string, accepted?: boolean) {
  return classifyCommunicationSmsSend({
    prepared: [prepared[0]],
    providerResponse: {
      recipients: [
        {
          clientMessageId: "sms-1-c1",
          ...(accepted === undefined ? {} : { accepted }),
          deliveryStatus,
        },
      ],
    },
  }).contacts[0].status;
}

function testDeliveryStatusVariations() {
  for (const status of ["Delivered", "DELIVRD", "delivery successful", "Delivered to handset"]) {
    assert.equal(classifyOne(status, true), "Delivered", status);
  }
  for (const status of ["undelivered", "UNDELIV", "delivery failed", "delivery_failed", "rejected", "expired", "not delivered"]) {
    assert.notEqual(classifyOne(status, true), "Delivered", status);
    assert.equal(classifyOne(status, true), "Failed", status);
  }
  const acceptedOnly = classifyCommunicationSmsSend({
    prepared: [prepared[0]],
    providerResponse: { recipients: [{ clientMessageId: "sms-1-c1", accepted: true }] },
  });
  assert.equal(acceptedOnly.contacts[0].status, "Accepted");
  assert.equal(acceptedOnly.delivered, 0);
  assert.equal(classifyOne("in transit", true), "Unknown");
  assert.equal(
    classifyCommunicationSmsSend({
      prepared: [prepared[0]],
      providerResponse: { recipients: [{ clientMessageId: "sms-1-c1" }] },
    }).contacts[0].status,
    "Unknown"
  );
  console.log("  ✓ delivery words are explicit; undelivered is never Delivered");
}

function main() {
  console.log("communicationSmsAcceptance.test.ts");
  testFullAcceptanceIsNotDelivery();
  testPartialAcceptance();
  testHttp200WithoutRecipientsIsUnknown();
  testRejectionAndNetwork();
  testDeliveryStatusVariations();
  console.log("communicationSmsAcceptance.test.ts: OK");
}

main();
