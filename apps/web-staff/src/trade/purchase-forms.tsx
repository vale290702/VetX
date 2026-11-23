"use client";
import { Button } from "@vetx/ui-web";
import { useRef, useState } from "react";
import { Write, Disclosure, Picker, Quantity, type Context } from "./controls";
import { tradeMessages } from "./messages.ts";
import { remaining, type Choices, type Schema } from "./forms.ts";
import { stockQuantity } from "../inventory/forms.ts";
export function SupplierForm({
  ctx,
  supplier,
}: {
  ctx: Context;
  supplier?: Schema["SupplierDto"];
}) {
  const t = tradeMessages(ctx.locale),
    label = t(supplier ? "editSupplier" : "addSupplier");
  return (
    <Disclosure label={label}>
      <Write
        ctx={ctx}
        action="supplier"
        id={supplier?.id}
        label={label}
        fields={(d) => ({ name: d.get("name"), revision: supplier?.revision ?? 0 })}
      >
        <label>
          {t("supplierName")}
          <input name="name" maxLength={120} required defaultValue={supplier?.name} />
        </label>
      </Write>
    </Disclosure>
  );
}
type OptionProps = { ctx: Context; catalog: Choices; suppliers: Choices };
export function OrderForm({ ctx, catalog, suppliers }: OptionProps) {
  const t = tradeMessages(ctx.locale),
    label = t("order");
  if (!catalog.options.length || !suppliers.options.length)
    return <p>{t(!catalog.options.length ? "noItems" : "noSuppliers")}</p>;
  return (
    <Disclosure label={label}>
      <PurchaseLines ctx={ctx} catalog={catalog} suppliers={suppliers} />
    </Disclosure>
  );
}
export function ReceiptForm({
  ctx,
  order,
  locations,
}: {
  ctx: Context;
  order: Schema["PurchaseOrderDto"];
  locations: Choices;
}) {
  const t = tradeMessages(ctx.locale);
  if (!locations.options.length) return <p>{t("noLocations")}</p>;
  return (
    <Disclosure label={t("receive")}>
      <PurchaseLines ctx={ctx} order={order} locations={locations} />
    </Disclosure>
  );
}
function PurchaseLines(
  props: OptionProps | { ctx: Context; order: Schema["PurchaseOrderDto"]; locations: Choices },
) {
  const { ctx } = props,
    t = tradeMessages(ctx.locale),
    receipt = "order" in props,
    label = t(receipt ? "receive" : "order"),
    [rows, setRows] = useState([0]),
    seq = useRef(1);
  function reset() {
    setRows([seq.current++]);
  }
  return (
    <Write
      ctx={ctx}
      action={receipt ? "receipt" : "order"}
      label={label}
      onSaved={reset}
      fields={(data) => {
        const lines = rows.map((n) => ({
          itemId: data.get("item" + n),
          quantity: data.get("quantity" + n),
          ...(receipt
            ? { warehouseId: data.get("warehouse" + n), lot: data.get("lot" + n) }
            : { expectedUnit: data.get("unit" + n) }),
        }));
        return receipt
          ? { orderId: props.order.id, lines }
          : { supplierId: data.get("supplier"), lines };
      }}
    >
      {!receipt && (
        <Picker
          ctx={ctx}
          kind="suppliers"
          initial={props.suppliers}
          name="supplier"
          label={t("supplier")}
        />
      )}
      {rows.map((id, index) => (
        <fieldset key={id} className="directory-form">
          <legend>{t("line", { n: index + 1 })}</legend>
          {receipt ? (
            <>
              <label>
                {t("item")}
                <select required name={"item" + id} defaultValue="">
                  <option disabled value="">
                    {t("select")}
                  </option>
                  {props.order.lines
                    .filter((l) => remaining(l.quantity, l.receivedQuantity) !== "0.000")
                    .map((l) => (
                      <option key={l.itemId} value={l.itemId}>
                        {l.itemName} · {l.unit} · {t("remaining")}{" "}
                        {stockQuantity(remaining(l.quantity, l.receivedQuantity), ctx.locale)}
                      </option>
                    ))}
                </select>
              </label>
              <Picker
                ctx={ctx}
                kind="warehouses"
                initial={props.locations}
                name={"warehouse" + id}
                label={t("warehouse")}
              />
              <label>
                {t("lot")}
                <input name={"lot" + id} maxLength={120} />
              </label>
            </>
          ) : (
            <Picker
              ctx={ctx}
              kind="items"
              initial={props.catalog}
              name={"item" + id}
              unitName={"unit" + id}
              quantityName={"quantity" + id}
              label={t("item")}
            />
          )}
          {receipt && <Quantity ctx={ctx} name={"quantity" + id} />}
          {rows.length > 1 && (
            <Button type="button" onClick={() => setRows((r) => r.filter((n) => n !== id))}>
              {t("remove", { n: index + 1 })}
            </Button>
          )}
        </fieldset>
      ))}
      {rows.length < 100 && (
        <Button type="button" onClick={() => setRows([...rows, seq.current++])}>
          {t("addLine")}
        </Button>
      )}
    </Write>
  );
}
export function ReturnForm({
  ctx,
  orderId,
  line,
  unit,
}: {
  ctx: Context;
  orderId: string;
  line: Schema["ReceiptLineDto"];
  unit?: string;
}) {
  const t = tradeMessages(ctx.locale);
  return (
    <Disclosure label={t("return")}>
      <Write
        ctx={ctx}
        action="return"
        label={t("return")}
        fields={(d) => ({
          orderId,
          receiptMovementId: line.movementId,
          quantity: d.get("quantity"),
          reason: d.get("reason"),
        })}
      >
        <small>{t("remainingHelp")}</small>
        <Quantity ctx={ctx} unit={unit} />
        <label>
          {t("reason")}
          <input name="reason" maxLength={250} required />
        </label>
      </Write>
    </Disclosure>
  );
}
