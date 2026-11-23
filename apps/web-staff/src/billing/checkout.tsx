"use client";
import { Button } from "@vetx/ui-web";
import { useState } from "react";
import { BillingForm, Picker } from "./controls";
import { billingMessages } from "./messages.ts";
import {
  decimal,
  formatAmount,
  lineAmounts,
  scaled,
  unscale,
  type Context,
  type Schema,
  type Price,
  type Balance,
  type Warehouse,
} from "./model.ts";
type Patient = { id: string; name: string; species: string };
type Line = { key: string; price: Price; quantity: string; stock: Balance | null };
export function Checkout({ ctx }: { ctx: Context }) {
  const t = billingMessages(ctx.locale);
  const [price, setPrice] = useState<Price | null>(null),
    [warehouse, setWarehouse] = useState<Warehouse | null>(null),
    [stock, setStock] = useState<Balance | null>(null);
  const [patient, setPatient] = useState<Patient | null>(null),
    [lines, setLines] = useState<Line[]>([]),
    [quantity, setQuantity] = useState("1"),
    [problem, setProblem] = useState<"invalid" | "notEnough" | "currencyMismatch" | null>(null);
  const currency = lines[0]?.price.currency;
  function add() {
    const qty = decimal(quantity, 3);
    if (
      !price ||
      !qty ||
      scaled(qty, 3) <= 0n ||
      lines.length >= 1000 ||
      (price.stockItemId &&
        (!stock || stock.itemId !== price.stockItemId || stock.warehouseId !== warehouse?.id))
    ) {
      setProblem("invalid");
      return;
    }
    if (currency && currency !== price.currency) {
      setProblem("currencyMismatch");
      return;
    }
    if (stock) {
      const reserved = lines
        .filter(
          (l) =>
            l.stock?.warehouseId === stock.warehouseId &&
            l.stock?.itemId === stock.itemId &&
            l.stock?.lot === stock.lot,
        )
        .reduce((a, l) => a + scaled(l.quantity, 3), 0n);
      if (reserved + scaled(qty, 3) > scaled(stock.quantity, 3)) {
        setProblem("notEnough");
        return;
      }
    }
    setLines([...lines, { key: crypto.randomUUID(), price, quantity: qty, stock }]);
    setProblem(null);
    setPrice(null);
    setStock(null);
    setWarehouse(null);
    setQuantity("1");
  }
  const totals = lines.reduce(
    (a, l) => {
      const n = lineAmounts(l.price.unitPrice, l.quantity, l.price.taxRate);
      return { net: a.net + n.net, tax: a.tax + n.tax, total: a.total + n.total };
    },
    { net: 0n, tax: 0n, total: 0n },
  );
  const money = (n: bigint) => (currency ?? "") + " " + formatAmount(unscale(n, 5), ctx.locale);
  function prepare(): Schema["SaleInputDto"] | null {
    if (!currency || !lines.length || totals.total >= 1000000000000000000n || price) return null;
    return {
      currency,
      patientId: patient?.id ?? null,
      lines: lines.map((l) => ({
        priceId: l.price.id,
        priceRevision: l.price.revision,
        quantity: l.quantity,
        warehouseId: l.stock?.warehouseId ?? null,
        lot: l.stock?.lot ?? "",
      })),
    };
  }
  return (
    <BillingForm
      ctx={ctx}
      resource="sales/{id}"
      label={t("recordSale")}
      prepare={prepare}
      onSaved={(id) => window.location.assign(ctx.pagePath + "?sale=" + id)}
    >
      <Picker<Patient>
        ctx={ctx}
        label={t("patient")}
        resource="patients"
        field="patients"
        searchable
        optional
        selected={patient}
        onPick={setPatient}
        optionKey={(row) => row.id}
        describe={(row) => row.name + " · " + row.species}
      />
      <Picker<Price>
        ctx={ctx}
        label={t("price")}
        resource="prices"
        field="prices"
        searchable
        selected={price}
        onPick={(p) => {
          setPrice(p);
          setStock(null);
          setWarehouse(null);
          setProblem(null);
        }}
        optionKey={(p) => p.id}
        describe={(p) =>
          p.name + " · " + p.currency + " " + formatAmount(p.unitPrice, ctx.locale) + " / " + p.unit
        }
      />
      {price && (
        <>
          <p>
            {t("taxRate")} · {formatAmount(price.taxRate, ctx.locale)}%
          </p>
          {price.stockItemId && (
            <>
              <Picker<Warehouse>
                ctx={ctx}
                label={t("warehouse")}
                resource="warehouses"
                field="warehouses"
                selected={warehouse}
                onPick={(w) => {
                  setWarehouse(w);
                  setStock(null);
                }}
                optionKey={(w) => w.id}
                describe={(w) => w.name}
              />
              {warehouse && (
                <Picker<Balance>
                  key={warehouse.id + price.id}
                  ctx={ctx}
                  label={t("lot")}
                  resource={"balances/" + warehouse.id}
                  field="balances"
                  selected={stock}
                  onPick={setStock}
                  include={(b) => b.itemId === price.stockItemId && scaled(b.quantity, 3) > 0n}
                  optionKey={(b) => "lot-" + b.lot}
                  describe={(b) => (b.lot || t("noLot")) + " · " + b.quantity + " " + b.unit}
                />
              )}
            </>
          )}
          <label>
            {t("quantity", { unit: price.unit })}
            <input
              value={quantity}
              inputMode="decimal"
              onChange={(e) => setQuantity(e.target.value)}
              maxLength={18}
            />
          </label>
          <Button type="button" onClick={add}>
            {t("addLine")}
          </Button>
        </>
      )}
      {problem && <p role="alert">{t(problem)}</p>}
      {lines.length > 0 ? (
        <>
          <ul className="directory-list">
            {lines.map((l) => (
              <li key={l.key}>
                <strong>{l.price.name}</strong>
                <p>
                  {l.quantity} {l.price.unit} × {l.price.currency}{" "}
                  {formatAmount(l.price.unitPrice, ctx.locale)} · {l.price.taxRate}%
                </p>
                {l.stock && (
                  <p>
                    {l.stock.warehouseName} · {l.stock.lot || t("noLot")}
                  </p>
                )}
                <p>{money(lineAmounts(l.price.unitPrice, l.quantity, l.price.taxRate).total)}</p>
                <Button
                  type="button"
                  onClick={() => setLines(lines.filter((x) => x.key !== l.key))}
                >
                  {t("removeLine", { name: l.price.name })}
                </Button>
              </li>
            ))}
          </ul>
          <dl className="patient-demographics">
            {(["net", "tax", "total"] as const).map((k) => (
              <div key={k}>
                <dt>{t(k)}</dt>
                <dd>{money(totals[k])}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : (
        <p>{t("emptyCart")}</p>
      )}
    </BillingForm>
  );
}
