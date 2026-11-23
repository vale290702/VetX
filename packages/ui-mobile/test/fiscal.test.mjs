import assert from "node:assert/strict";
import { test } from "node:test";
import { newFiscalDraft, prepareFiscal, matchingTariffs } from "../src/fiscal-forms.ts";
import { createFiscal } from "../src/fiscal-client.ts";
import { createPatientTransport } from "../src/patient-transport.ts";
const sale = {
  id: "sale",
  currency: "CRC",
  balance: "8.00000",
  lines: [{ unit: "Unid", taxRate: "4.00000", name: "Care", cabys: "1234567890123" }],
};
const recipient = {
  name: " Alicia M. ",
  identityType: "01",
  number: "001234567",
  email: "",
  activity: "",
};
function draft() {
  const fields = newFiscalDraft(sale);
  return {
    ...fields,
    ...recipient,
    days: "30",
    lines: [{ ...fields.lines[0], category: "service", vatTariffCode: "06" }],
  };
}
test("credit, recipient, medicine and ambiguous VAT classifications retain reviewed values", () => {
  assert.deepEqual(matchingTariffs("4.00000"), ["04", "06"]);
  const initial = newFiscalDraft(sale);
  assert.equal(initial.terms, "02");
  assert.equal(initial.exchangeRate, "1");
  assert.equal(initial.lines[0].unitCode, "Unid");
  assert.equal(initial.lines[0].vatTariffCode, "");
  const input = draft();
  assert.deepEqual(prepareFiscal(sale, input), {
    recipient: { name: "Alicia M.", identity: { type: "01", number: "001234567" } },
    terms: { code: "02", days: 30 },
    exchangeRate: "1",
    lines: [{ unitCode: "Unid", vatTariffCode: "06", category: "service" }],
  });
  for (const change of [
    { terms: "01" },
    { days: "0" },
    { days: "3e2" },
    { exchangeRate: "2" },
    { activity: "12345" },
    { email: "x" },
    { identityType: "XX" },
    { lines: [{ ...input.lines[0], unitCode: "box" }] },
    { lines: [{ ...input.lines[0], vatTariffCode: "08" }] },
    { lines: [{ ...input.lines[0], registration: "123", form: "" }] },
  ])
    assert.equal(prepareFiscal(sale, { ...input, ...change }), undefined);
  const paid = { ...sale, currency: "USD", balance: "0.00000" };
  const valid = prepareFiscal(paid, {
    ...input,
    email: "person@example.org",
    activity: "012345",
    terms: "01",
    exchangeRate: "512,56789",
    lines: [{ ...input.lines[0], registration: "ABC", form: "01" }],
  });
  assert.deepEqual(valid.terms, { code: "01" });
  assert.equal(valid.exchangeRate, "512.56789");
  assert.deepEqual(valid.lines[0].medicine, { registration: "ABC", form: "01" });
  assert.equal(valid.recipientActivity, "012345");
  assert.deepEqual(matchingTariffs("0.00000"), []);
});
test("status, queue, administrator retry and private XML use the live scoped grant and explicit environment", async () => {
  const scope = { subject: "staff", organizationId: "org", clinicId: "clinic" },
    calls = [],
    signal = new AbortController().signal;
  const session = {
    forOrganization: (subject, org, work) => {
      assert.equal(subject, "staff");
      assert.equal(org, "org");
      return work("verified", signal);
    },
  };
  const api = createFiscal(
    createPatientTransport(session, "https://vetx.test", async (url, init) => {
      const r = new Request(url, init);
      assert.equal(init.signal, signal);
      assert.equal(r.headers.get("Authorization"), "Bearer verified");
      assert.equal(init.redirect, "error");
      assert.equal(init.credentials, "omit");
      calls.push(r);
      if (url.includes("/artifacts/"))
        return new Response("<xml/>", {
          headers: { "Content-Type": "application/xml", "Content-Length": "6" },
        });
      return Response.json({});
    }),
  );
  const input = prepareFiscal(sale, draft());
  await api.status(scope, "sale", "sandbox");
  await api.issue(scope, "sale", "production", input);
  await api.retry(scope, "sale", "production");
  for (const kind of ["invoice", "receipt"])
    assert.equal(
      new TextDecoder().decode(await api.artifact(scope, "sale", "production", kind)),
      "<xml/>",
    );
  assert.deepEqual(
    calls.map((r) => r.method + " " + new URL(r.url).pathname.split("/fiscal/")[1]),
    [
      "GET sandbox",
      "PUT production",
      "PUT production/retry",
      "GET production/artifacts/invoice",
      "GET production/artifacts/receipt",
    ],
  );
  assert.deepEqual(await calls[1].json(), input);
});
test("artifact errors and unexpected payloads cannot reach the native file handoff", async () => {
  const scope = { subject: "s", organizationId: "o", clinicId: "c" };
  for (const response of [
    new Response("denied", { status: 403 }),
    new Response("<html/>", { headers: { "Content-Type": "text/html" } }),
    new Response("", { headers: { "Content-Type": "application/xml" } }),
    new Response("abc", { headers: { "Content-Type": "application/xml", "Content-Length": "6" } }),
  ]) {
    const api = createFiscal(
      createPatientTransport(
        { forOrganization: (_s, _o, work) => work("token", new AbortController().signal) },
        "https://vet.test",
        async () => response,
      ),
    );
    await assert.rejects(() => api.artifact(scope, "sale", "sandbox", "invoice"));
  }
});
