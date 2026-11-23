"use client";
import { useState } from "react";
import units from "@vetx/fiscal-cr/unit-codes";
import tariffRates from "@vetx/fiscal-cr/vat-tariffs";
import { BillingForm } from "./controls";
import { billingMessages } from "./messages.ts";
import { decimal, scaled, type Schema, type Sale, type Context } from "./model.ts";

type Draft = Schema["FiscalDraftDto"];
export type Environment = Schema["FiscalRecordDto"]["environment"];
const identities = ["01", "02", "03", "04", "05", "06"] as const;
const tariffs = Object.entries(tariffRates) as [keyof typeof tariffRates, string][];
function matching(rate: string) {
  return tariffs.filter(([, v]) => scaled(v, 5) === scaled(rate, 5));
}
const text = (data: FormData, key: string) => String(data.get(key) ?? "").trim();

export function FiscalForm({
  ctx,
  sale,
  environment,
}: {
  ctx: Context;
  sale: Sale;
  environment: Environment;
}) {
  const t = billingMessages(ctx.locale),
    paid = scaled(sale.balance, 5) === 0n;
  const [terms, setTerms] = useState<"01" | "02">(paid ? "01" : "02");
  function prepare(f: FormData): Draft | null {
    const name = text(f, "name"),
      number = text(f, "number"),
      type = identities.find((v) => v === text(f, "type")),
      activity = text(f, "activity"),
      email = text(f, "email");
    const rate = decimal(f.get("exchangeRate"), 5),
      days = Number(f.get("days"));
    if (
      !type ||
      name.length < 3 ||
      !/^\d{1,12}$/.test(number) ||
      !rate ||
      scaled(rate, 5) <= 0n ||
      (sale.currency === "CRC" && scaled(rate, 5) !== 100000n) ||
      (terms === "02" && (!Number.isInteger(days) || days < 1 || days > 99999)) ||
      (terms === "01" && !paid)
    )
      return null;
    const lines: Draft["lines"] = [];
    for (const [n, line] of sale.lines.entries()) {
      const unit = text(f, "unit-" + n),
        category = text(f, "category-" + n),
        tariff = matching(line.taxRate).find(([k]) => k === text(f, "vat-" + n))?.[0];
      const registration = text(f, "reg-" + n),
        form = text(f, "form-" + n);
      if (
        !units.includes(unit) ||
        (category !== "goods" && category !== "service") ||
        !tariff ||
        Boolean(registration) !== Boolean(form)
      )
        return null;
      lines.push({
        unitCode: unit as Draft["lines"][number]["unitCode"],
        category,
        vatTariffCode: tariff,
        ...(registration ? { medicine: { registration, form } } : {}),
      });
    }
    return {
      recipient: { name, identity: { type, number }, ...(email ? { email } : {}) },
      ...(activity ? { recipientActivity: activity } : {}),
      exchangeRate: rate,
      terms: terms === "02" ? { code: terms, days } : { code: terms },
      lines,
    };
  }
  if (sale.lines.some((line) => !matching(line.taxRate).length))
    return <p>{t("unsupportedSale")}</p>;
  return (
    <details className="directory-disclosure">
      <summary>{t("prepareInvoice")}</summary>
      <BillingForm
        ctx={ctx}
        id={sale.id}
        resource={`sales/${sale.id}/fiscal/${environment}`}
        label={t(environment === "sandbox" ? "issueSandbox" : "issueProduction")}
        prepare={prepare}
        errors={{ invalid: t("invalidFiscal"), conflict: t("fiscalConflict") }}
      >
        <label>
          {t("recipient")}
          <input name="name" required minLength={3} maxLength={100} />
        </label>
        <label>
          {t("idType")}
          <select name="type" required defaultValue="">
            <option value="">{t("select")}</option>
            {identities.map((code) => (
              <option key={code} value={code}>
                {t(`id${code}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("idNumber")}
          <input name="number" inputMode="numeric" pattern="[0-9]{1,12}" required maxLength={12} />
        </label>
        <label>
          {t("recipientEmail")}
          <input type="email" name="email" maxLength={160} />
        </label>
        <label>
          {t("recipientActivity")}
          <input name="activity" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} />
        </label>
        <label>
          {t("terms")}
          <select value={terms} onChange={(e) => setTerms(e.target.value === "01" ? "01" : "02")}>
            <option value="01" disabled={!paid}>
              {t("immediate")}
            </option>
            <option value="02">{t("credit")}</option>
          </select>
        </label>
        {terms === "02" && (
          <label>
            {t("creditDays")}
            <input type="number" name="days" required min={1} max={99999} step={1} />
          </label>
        )}
        <label>
          {t("exchangeRate", { currency: sale.currency })}
          <input
            name="exchangeRate"
            required
            inputMode="decimal"
            readOnly={sale.currency === "CRC"}
            defaultValue={sale.currency === "CRC" ? "1" : ""}
          />
        </label>
        {sale.lines.map((line, n) => {
          const choices = matching(line.taxRate);
          return (
            <fieldset className="care-fields" key={n}>
              <legend>{t("invoiceLine", { n: n + 1, name: line.name })}</legend>
              <p>
                {t("cabys")} {line.cabys} · {line.taxRate}%
              </p>
              <label>
                {t("fiscalCategory")}
                <select required name={"category-" + n} defaultValue="">
                  <option value="">{t("select")}</option>
                  <option value="goods">{t("goods")}</option>
                  <option value="service">{t("service")}</option>
                </select>
              </label>
              <label>
                {t("fiscalUnit")}
                <select
                  name={"unit-" + n}
                  required
                  defaultValue={units.includes(line.unit) ? line.unit : ""}
                >
                  <option value="">{t("select")}</option>
                  {units.map((u) => (
                    <option key={u}>{u}</option>
                  ))}
                </select>
              </label>
              <label>
                {t("vatCode")}
                <select
                  required
                  name={"vat-" + n}
                  defaultValue={choices.length === 1 ? choices[0]![0] : ""}
                >
                  <option value="">{t("select")}</option>
                  {choices.map(([k, v]) => (
                    <option key={k} value={k}>
                      {t(("tariff" + k) as `tariff${typeof k}`, { rate: v })}
                    </option>
                  ))}
                </select>
              </label>
              <details className="directory-disclosure">
                <summary>{t("medicineFields")}</summary>
                <label>
                  {t("registration")}
                  <input name={"reg-" + n} maxLength={100} />
                </label>
                <label>
                  {t("dosageForm")}
                  <input name={"form-" + n} maxLength={3} />
                </label>
              </details>
            </fieldset>
          );
        })}
      </BillingForm>
    </details>
  );
}
export function RetryFiscal({
  ctx,
  saleId,
  environment,
}: {
  ctx: Context;
  saleId: string;
  environment: Environment;
}) {
  const t = billingMessages(ctx.locale);
  return (
    <BillingForm
      ctx={ctx}
      label={t("retryInvoice")}
      id={saleId}
      resource={`sales/${saleId}/fiscal/${environment}/retry`}
      prepare={() => ({})}
      errors={{ conflict: t("fiscalConflict") }}
    >
      <small>{t("retryHelp")}</small>
    </BillingForm>
  );
}
