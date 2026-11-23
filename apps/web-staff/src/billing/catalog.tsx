"use client";
import { useState } from "react";
import { Amount, BillingForm, Currency, Picker } from "./controls";
import { billingMessages } from "./messages.ts";
import { decimal, scaled, type Context, type Price, type StockItem } from "./model.ts";
export function PriceForm({ ctx, price }: { ctx: Context; price?: Price }) {
  const t = billingMessages(ctx.locale),
    label = t(price ? "editPrice" : "addPrice");
  const [stock, setStock] = useState(Boolean(price?.stockItemId));
  const [item, setItem] = useState<Pick<StockItem, "id" | "name" | "sku" | "unit"> | null>(
    price?.stockItemId
      ? { id: price.stockItemId, name: t("linkedItem"), sku: price.stockItemId, unit: price.unit }
      : null,
  );
  function prepare(form: FormData) {
    const unitPrice = decimal(form.get("unitPrice"), 5),
      taxRate = decimal(form.get("taxRate"), 5);
    if (!unitPrice || !taxRate || scaled(taxRate, 5) > 10000000n || (stock && !item)) return null;
    return {
      name: form.get("name"),
      unit: stock ? item!.unit : form.get("unit"),
      unitPrice,
      taxRate,
      stockItemId: stock ? item!.id : null,
      cabys: form.get("cabys"),
      currency: form.get("currency"),
      revision: price?.revision ?? 0,
    };
  }
  return (
    <details className="directory-disclosure">
      <summary>{label}</summary>
      <BillingForm
        ctx={ctx}
        resource="prices/{id}"
        id={price?.id}
        label={label}
        submitLabel={t("savePrice")}
        prepare={prepare}
      >
        <label>
          {t("name")}
          <input name="name" required maxLength={120} defaultValue={price?.name} />
        </label>
        <label>
          {t("priceType")}
          <select
            value={stock ? "stock" : "service"}
            onChange={(e) => setStock(e.target.value === "stock")}
          >
            <option value="service">{t("service")}</option>
            <option value="stock">{t("stock")}</option>
          </select>
        </label>
        {stock && (
          <Picker
            ctx={ctx}
            label={t("stockItem")}
            resource="items"
            field="items"
            searchable
            selected={item}
            onPick={setItem}
            optionKey={(row) => row.id}
            describe={(row) => row.name + " · " + row.sku + " · " + row.unit}
          />
        )}
        <label>
          {t("unit")}{" "}
          {stock ? (
            <input readOnly value={item?.unit ?? ""} />
          ) : (
            <input name="unit" required maxLength={40} defaultValue={price?.unit} />
          )}
        </label>
        <Currency ctx={ctx} value={price?.currency} />
        <Amount label={t("unitPrice")} name="unitPrice" value={price?.unitPrice} />
        <Amount label={t("taxRate")} name="taxRate" value={price?.taxRate ?? "0"} />
        <label>
          {t("cabys")}
          <input
            name="cabys"
            required
            inputMode="numeric"
            pattern="[0-9]{13}"
            maxLength={13}
            defaultValue={price?.cabys}
          />
        </label>
      </BillingForm>
    </details>
  );
}
