import assert from "node:assert/strict";
import { test } from "node:test";
import { HaciendaError } from "@vetx/fiscal-cr";
import { deliverOne } from "../dist/delivery.js";
const key = "0".repeat(50);
const signed = Buffer.from("<signed/>");
function setup(state = "pending", options = {}) {
  const events = [];
  const job = {
    key,
    state,
    lease: "lease",
    signed: state === "pending" ? null : signed.toString("base64"),
    snapshot: {
      issuer: { identity: { type: "02", number: "1" } },
      recipient: { identity: { type: "01", number: "2" } },
      issuedAt: "2026-11-22T09:00:00-06:00",
    },
  };
  const jobs = {
    claim: async () => job,
    save: async (j, b) => {
      assert.equal(j.lease, job.lease);
      assert.deepEqual(b, signed);
      events.push("saved");
      return options.saved !== false;
    },
    startDelivery: async () => {
      events.push("sending");
      return options.leased !== false;
    },
    finish: async (j, s, issue, delay, receipt) => {
      events.push({ s, issue, delay, receipt });
      return true;
    },
  };
  const issuer = async () => ({
    prepare: async () => {
      events.push("prepared");
      return { key, signedXml: signed };
    },
    reception: {
      status: async () => {
        events.push("lookup");
        return options.status ?? null;
      },
      submit: async (envelope) => {
        events.push("post");
        assert.deepEqual(envelope.signedXml, signed);
        if (options.error) throw options.error;
        return options.result ?? { key, status: "submitted" };
      },
    },
  });
  return { events, run: () => deliverOne(jobs, issuer, 5) };
}
test("signature and sending intent are durable before transmission; lost leases stop before POST", async () => {
  const complete = setup();
  await complete.run();
  assert.deepEqual(complete.events, [
    "prepared",
    "saved",
    "sending",
    "post",
    { s: "submitted", issue: null, delay: 5, receipt: undefined },
  ]);
  for (const state of [{ saved: false }, { leased: false }]) {
    const lost = setup("pending", state);
    await lost.run();
    assert.ok(!lost.events.includes("post"));
  }
});
test("recovery checks sending keys and retains authority receipts without posting them again", async () => {
  const accepted = setup("sending", {
    status: { key, reportedAt: "2026-11-22T12:00:00Z", state: "aceptado", receiptXml: signed },
  });
  await accepted.run();
  assert.deepEqual(accepted.events, [
    "lookup",
    { s: "accepted", issue: null, delay: 0, receipt: signed },
  ]);
  for (const phase of ["submitted", "processing"]) {
    const delayed = setup(phase);
    await delayed.run();
    assert.deepEqual(delayed.events, [
      "lookup",
      { s: "defer", issue: "unconfirmed", delay: 5, receipt: undefined },
    ]);
  }
  const unknown = setup("sending", { error: new HaciendaError("rate_limited", 20) });
  await unknown.run();
  assert.deepEqual(unknown.events, [
    "lookup",
    "sending",
    "post",
    { s: "defer", issue: "rate_limited", delay: 20, receipt: undefined },
  ]);
});

test("a known decision is recorded as soon as submit returns it", async () => {
  for (const receiptXml of [undefined, signed]) {
    const result = { key, status: "known", state: "aceptado", receiptXml };
    const delivery = setup("signed", { result });
    await delivery.run();
    assert.deepEqual(delivery.events, [
      "sending",
      "post",
      { s: "accepted", issue: null, delay: receiptXml ? 0 : 5, receipt: receiptXml },
    ]);
  }
});
