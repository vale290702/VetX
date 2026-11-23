import type { components } from "@vetx/api-client";
import units from "@vetx/fiscal-cr/unit-codes" with { type: "json" };
import tariffs from "@vetx/fiscal-cr/vat-tariffs" with { type: "json" };
import { money, type Sale } from "./billing-forms.ts";
type S = components["schemas"];
export type Draft = S["FiscalDraftDto"];
export type FiscalRecord = S["FiscalRecordDto"];
export type FiscalStatus = S["FiscalStatusDto"];
export type Environment = FiscalRecord["environment"];
export type Artifact = "invoice" | "receipt";
export function xmlFormat(kind: Artifact, key: string) {
  const name = /^\d{50}$/.test(key) ? key + "-" + kind : "VetX-" + kind;
  return { extension: "xml", mimeType: "application/xml", uti: "public.xml", name };
}
export type LineFields = {
  category: "" | "goods" | "service";
  unitCode: string;
  vatTariffCode: string;
  registration: string;
  form: string;
};
export type Fields = {
  name: string;
  identityType: "" | Draft["recipient"]["identity"]["type"];
  number: string;
  email: string;
  activity: string;
  terms: "01" | "02";
  days: string;
  exchangeRate: string;
  lines: LineFields[];
};
export const identities = ["01", "02", "03", "04", "05", "06"] as const;
export const issueCodes = [
  "configuration",
  "authentication",
  "invalid_submission",
  "rate_limited",
  "unconfirmed",
  "unexpected_response",
  "unavailable",
  "invalid_snapshot",
  "authority_error",
] as const;
export const unitCodes: readonly string[] = units;
export const paidInFull = (sale: Sale) => /^0(?:\.0+)?$/.test(sale.balance);
export function matchingTariffs(rate: string) {
  const normalized = rate.replace(/(\.\d*?[1-9])0+$|\.0+$/, "$1");
  return (Object.keys(tariffs) as (keyof typeof tariffs)[]).filter(
    (code) => tariffs[code] === normalized,
  );
}
export function newFiscalDraft(sale: Sale): Fields {
  return {
    name: "",
    identityType: "",
    number: "",
    email: "",
    activity: "",
    terms: paidInFull(sale) ? "01" : "02",
    days: "",
    exchangeRate: sale.currency === "CRC" ? "1" : "",
    lines: sale.lines.map((line) => {
      const available = matchingTariffs(line.taxRate);
      return {
        category: "",
        unitCode: unitCodes.includes(line.unit) ? line.unit : "",
        vatTariffCode: available.length === 1 ? available[0]! : "",
        registration: "",
        form: "",
      };
    }),
  };
}
function clean(value: string, min: number, max: number) {
  return value.length >= min && value.length <= max && !/\p{Cc}/u.test(value);
}
export function prepareFiscal(sale: Sale, fields: Fields): Draft | undefined {
  const { terms, identityType } = fields,
    name = fields.name.trim(),
    number = fields.number.trim(),
    email = fields.email.trim(),
    activity = fields.activity.trim(),
    days = fields.days.trim(),
    exchangeRate = money(fields.exchangeRate);
  if (
    !clean(name, 3, 100) ||
    !identityType ||
    !identities.includes(identityType) ||
    !/^\d{1,12}$/.test(number)
  )
    return;
  if (email && (!clean(email, 3, 160) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return;
  if (activity && !/^\d{6}$/.test(activity)) return;
  if (
    !exchangeRate ||
    /^0(?:\.0+)?$/.test(exchangeRate) ||
    (sale.currency === "CRC" && !/^1(?:\.0+)?$/.test(exchangeRate))
  )
    return;
  if (terms === "01" ? !paidInFull(sale) : !/^([1-9]\d{0,4})$/.test(days)) return;
  if (!fields.lines.length || fields.lines.length !== sale.lines.length) return;
  const lines: Draft["lines"] = [];
  for (const [index, line] of fields.lines.entries()) {
    const tariff = matchingTariffs(sale.lines[index]!.taxRate).find(
        (t) => t === line.vatTariffCode,
      ),
      category = line.category;
    if (
      !tariff ||
      !unitCodes.includes(line.unitCode) ||
      (category !== "goods" && category !== "service")
    )
      return;
    const registration = line.registration.trim(),
      form = line.form.trim();
    if ((registration || form) && (!clean(registration, 1, 100) || !clean(form, 1, 3))) return;
    lines.push({
      unitCode: line.unitCode as Draft["lines"][number]["unitCode"],
      vatTariffCode: tariff,
      category,
      ...(registration ? { medicine: { registration, form } } : {}),
    });
  }
  return {
    recipient: { name, identity: { type: identityType, number }, ...(email ? { email } : {}) },
    ...(activity ? { recipientActivity: activity } : {}),
    terms: terms === "01" ? { code: "01" } : { code: "02", days: Number(days) },
    exchangeRate,
    lines,
  };
}
