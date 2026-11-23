import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  parseReferralRequest,
  parseCounterReferral,
  referralPath,
} from "../src/referrals/forms.ts";

import { smallJson } from "../src/auth/file-proxy.ts";
const readReferralBody = (request) => smallJson(request, 64 * 1024);

const id = crypto.randomUUID(),
  org = crypto.randomUUID(),
  clinic = crypto.randomUUID();
const input = {
  guardianId: id,
  destination: { organizationId: org, clinicId: clinic },
  reason: "  Cardiology  ",
  summary: "  History\nSecond line ",
};
test("a clinic referral preserves the explicitly chosen guardian and compound destination", () => {
  assert.deepEqual(parseReferralRequest(input), {
    ...input,
    reason: "Cardiology",
    summary: "History\nSecond line",
  });
  for (const change of [
    { guardianId: "all" },
    { destination: { clinicId: clinic } },
    { reason: "  " },
    { reason: "a\nb" },
    { reason: "r".repeat(251) },
    { summary: "s".repeat(8001) },
  ])
    assert.equal(parseReferralRequest({ ...input, ...change }), null);
  assert.equal(parseReferralRequest({ ...input, summary: "" }).summary, "");
});
test("a counter-referral sends only the response text and exact reviewed revision", () => {
  assert.deepEqual(parseCounterReferral({ revision: 2, summary: " Follow up in 10 days. " }), {
    revision: 2,
    summary: "Follow up in 10 days.",
  });
  for (const body of [
    { revision: 0, summary: "x" },
    { revision: "2", summary: "x" },
    { revision: 2, summary: " \n " },
    { revision: 2, summary: "x\u0000y" },
  ])
    assert.equal(parseCounterReferral(body), null);
});
test("referral paging preserves direction and the patient scope", () => {
  const scope = { organizationId: org, clinicId: clinic };
  assert.equal(
    referralPath(scope, undefined, "outgoing", 2),
    `/organizations/${org}/clinics/${clinic}/referrals?direction=outgoing&page=2`,
  );
  assert.equal(
    referralPath(scope, id, "outgoing", 2),
    `/organizations/${org}/clinics/${clinic}/patients/${id}/referrals?page=2`,
  );
});
test("multibyte clinical summaries can reach their supported length, oversized JSON is rejected", async () => {
  const incoming = (data) =>
    new Request("https://staff.example", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  const valid = { revision: 2, summary: "猫".repeat(8000) };
  assert.deepEqual(await readReferralBody(incoming(valid)), valid);
  assert.equal(await readReferralBody(incoming({ data: "x".repeat(130 * 1024) })), null);
});

test("referral catalogs carry the same labels, status names and interpolation fields", () => {
  const read = (locale) =>
    JSON.parse(
      readFileSync(
        new URL(`../../../packages/i18n/locales/web-referrals.${locale}.json`, import.meta.url),
        "utf8",
      ),
    );
  const en = read("en"),
    es = read("es");
  assert.deepEqual(Object.keys(en).sort(), Object.keys(es).sort());
  for (const key of Object.keys(en)) {
    assert.ok(es[key].trim());
    assert.deepEqual(en[key].match(/\{\w+\}/g), es[key].match(/\{\w+\}/g));
  }
});
