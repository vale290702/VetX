"use client";
import { useState } from "react";
import { Amount, BillingForm, Currency, Picker } from "./controls";
import { billingMessages } from "./messages.ts";
import { decimal, scaled, type Context, type Sale, type Shift, type Payment } from "./model.ts";
export function PaymentForm({ ctx, sale }: { ctx: Context; sale: Sale }) {
  const t = billingMessages(ctx.locale),
    [method, setMethod] = useState<Payment["method"]>("CARD"),
    [shift, setShift] = useState<Shift | null>(null);
  return (
    <details className="directory-disclosure">
      <summary>{t("addPayment")}</summary>
      <BillingForm
        ctx={ctx}
        resource={"sales/" + sale.id + "/payments/{id}"}
        label={t("recordPayment")}
        prepare={(form) => {
          const amount = decimal(form.get("amount"), 5);
          if (
            !amount ||
            scaled(amount, 5) <= 0n ||
            scaled(amount, 5) > scaled(sale.balance, 5) ||
            (method === "CASH" && !shift)
          )
            return null;
          return {
            amount,
            method,
            reference: method === "CASH" ? "" : String(form.get("reference") ?? "").trim(),
            shiftId: method === "CASH" ? shift!.id : null,
          };
        }}
      >
        <label>
          {t("method")}
          <select value={method} onChange={(e) => setMethod(e.target.value as Payment["method"])}>
            {(["CARD", "TRANSFER", "CASH"] as const).map((k) => (
              <option value={k} key={k}>
                {t(k)}
              </option>
            ))}
          </select>
        </label>
        <Amount
          label={t("amount", { currency: sale.currency })}
          name="amount"
          value={sale.balance}
        />
        {method === "CASH" ? (
          <Picker<Shift>
            ctx={ctx}
            resource="shifts"
            field="shifts"
            label={t("openDrawer")}
            selected={shift}
            onPick={setShift}
            include={(s) =>
              s.currency === sale.currency &&
              !s.closedAt &&
              s.cashier.subject === ctx.subject &&
              s.cashier.issuer === ctx.issuer
            }
            optionKey={(s) => s.id}
            describe={(s) => s.label + " · " + s.currency}
          />
        ) : (
          <label>
            {t("reference")}
            <input required maxLength={120} name="reference" />
            <small>{t("externalHint")}</small>
          </label>
        )}
      </BillingForm>
    </details>
  );
}
export function DrawerForm({ ctx, shift }: { ctx: Context; shift?: Shift }) {
  const t = billingMessages(ctx.locale),
    label = t(shift ? "closeDrawer" : "openNewDrawer");
  return (
    <details className="directory-disclosure">
      <summary>{label}</summary>
      <BillingForm
        ctx={ctx}
        label={label}
        id={shift?.id}
        resource={shift ? "shifts/{id}/close" : "shifts/{id}"}
        prepare={(f) => {
          if (shift) {
            const counted = decimal(f.get("counted"), 5);
            return counted ? { counted } : null;
          }
          const openingFloat = decimal(f.get("openingFloat"), 5);
          return openingFloat
            ? { openingFloat, currency: f.get("currency"), label: f.get("label") }
            : null;
        }}
      >
        {shift ? (
          <Amount label={t("counted")} name="counted" />
        ) : (
          <>
            <label>
              {t("drawerName")}
              <input required name="label" maxLength={120} />
            </label>
            <Currency ctx={ctx} />
            <Amount label={t("opening")} name="openingFloat" value="0" />
          </>
        )}
      </BillingForm>
    </details>
  );
}
