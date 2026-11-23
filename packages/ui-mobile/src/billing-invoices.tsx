import { Activity, useCallback, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Action, Field } from "./controls";
import type { ClinicPatientProps } from "./patient-form";
import { PatientReadState, usePatientRead } from "./patient-controls";
import { BillingRows, GoBack, Heading, Submit, Totals, useBillingWrite } from "./billing-controls";
import { FiscalInvoice } from "./fiscal";
import { Drawers } from "./billing-drawers";
import {
  formatDecimal,
  paymentBody,
  type PaymentInput,
  type Sale,
  type Shift,
} from "./billing-forms";
export function Invoices(
  props: ClinicPatientProps & { back: () => void; openSale: (id: string) => void },
) {
  const { t, i18n } = useTranslation(),
    { styles, client, scope } = props;
  const load = useCallback(
    async (p: number) => {
      const r = await client.billing.sales(scope, p);
      return { rows: r.sales, hasNextPage: r.hasNextPage };
    },
    [client, scope],
  );
  return (
    <View style={styles.section}>
      <GoBack styles={styles} onPress={props.back} />
      <Heading styles={styles}>{t("nativeBilling.invoices")}</Heading>
      <BillingRows
        styles={styles}
        load={load}
        empty={t("nativeBilling.emptySales")}
        render={(s) => (
          <>
            <Heading styles={styles}>{t("nativeBilling.invoice", { number: s.number })}</Heading>
            <Text style={styles.support}>
              {new Date(s.recordedAt).toLocaleString(i18n.language)}
            </Text>
            <Text style={styles.support}>
              {t("nativeBilling.totals.total", {
                amount: formatDecimal(s.total, i18n.language),
                currency: s.currency,
              })}
            </Text>
            <Text style={styles.support}>
              {t("nativeBilling.totals.balance", {
                amount: formatDecimal(s.balance, i18n.language),
                currency: s.currency,
              })}
            </Text>
            <Action
              styles={styles}
              label={t("nativeBilling.openInvoice", { number: s.number })}
              onPress={() => props.openSale(s.id)}
            />
          </>
        )}
      />
    </View>
  );
}
export function Invoice(
  props: ClinicPatientProps & { id: string; admin: boolean | undefined; back: () => void },
) {
  const { t, i18n } = useTranslation(),
    { styles, scope, client, id, back } = props,
    [detail, setDetail] = useState<{ screen: "payment" | "fiscal"; sale: Sale }>();
  const { result, reload } = usePatientRead(
    useCallback(() => client.billing.sale(scope, id), [client, scope, id]),
  );
  const load = useCallback(
    async (p: number) => {
      const r = await client.billing.payments(scope, id, p);
      return { rows: r.payments, hasNextPage: r.hasNextPage };
    },
    [scope, client, id],
  );
  const verifiedSale = result && "value" in result ? result.value : undefined;
  const error = result && "error" in result ? result.error : undefined;
  if (detail && error === "denied") setDetail(undefined);
  if (detail && error !== "denied") {
    const detailProps = {
      ...props,
      sale: verifiedSale ?? detail.sale,
      back: () => {
        setDetail(undefined);
        reload();
      },
    };
    return (
      <>
        {!verifiedSale && <PatientReadState styles={styles} error={error} retry={reload} />}
        <Activity mode={verifiedSale ? "visible" : "hidden"}>
          {detail.screen === "fiscal" ? (
            <FiscalInvoice {...detailProps} />
          ) : (
            <PaymentForm {...detailProps} />
          )}
        </Activity>
      </>
    );
  }
  if (!verifiedSale)
    return (
      <View style={styles.section}>
        <GoBack styles={styles} onPress={back} />
        <PatientReadState styles={styles} error={error} retry={reload} />
      </View>
    );
  const sale = verifiedSale;
  return (
    <View style={styles.section}>
      <GoBack styles={styles} onPress={back} />
      <Heading styles={styles}>{t("nativeBilling.invoice", { number: sale.number })}</Heading>
      <Text style={styles.support}>
        {t("nativeBilling.recordedBy", {
          when: new Date(sale.recordedAt).toLocaleString(i18n.language),
          actor: sale.author.subject,
        })}
      </Text>
      <Text selectable style={styles.support}>
        {sale.id}
      </Text>
      {sale.patientId && (
        <Text style={styles.support}>{t("nativeBilling.patient", { name: sale.patientId })}</Text>
      )}
      {sale.lines.map((l, i) => (
        <View style={styles.row} key={i}>
          <Heading styles={styles}>{l.name}</Heading>
          <Text style={styles.support}>
            {t("nativeBilling.cartLine", {
              quantity: formatDecimal(l.quantity, i18n.language),
              unit: l.unit,
              amount: formatDecimal(l.unitPrice, i18n.language),
              currency: sale.currency,
            })}
          </Text>
          <Text style={styles.support}>
            {t("nativeBilling.lineTax", {
              rate: formatDecimal(l.taxRate, i18n.language),
              cabys: l.cabys,
            })}
          </Text>
          {l.movementId && (
            <Text selectable style={styles.support}>
              {t("nativeBilling.stockAudit", {
                lot: l.lot || t("nativeBilling.noLot"),
                movement: l.movementId,
              })}
            </Text>
          )}
          <Totals styles={styles} values={l} currency={sale.currency} />
        </View>
      ))}
      <Totals styles={styles} values={sale} currency={sale.currency} />
      <Action styles={styles} label={t("nativeBilling.refreshInvoice")} onPress={reload} />
      {!/^0(?:\.0+)?$/.test(sale.balance) && (
        <Action
          styles={styles}
          primary
          label={t("nativeBilling.addPayment")}
          onPress={() => setDetail({ screen: "payment", sale })}
        />
      )}
      <Action
        styles={styles}
        label={t("nativeFiscal.electronicInvoice")}
        onPress={() => setDetail({ screen: "fiscal", sale })}
      />
      <Heading styles={styles}>{t("nativeBilling.payments")}</Heading>
      <BillingRows
        styles={styles}
        load={load}
        empty={t("nativeBilling.emptyPayments")}
        render={(p) => (
          <>
            <Heading styles={styles}>
              {t(`nativeBilling.methods.${p.method}`) +
                " · " +
                formatDecimal(p.amount, i18n.language) +
                " " +
                p.currency}
            </Heading>
            <Text style={styles.support}>
              {t("nativeBilling.recordedBy", {
                when: new Date(p.recordedAt).toLocaleString(i18n.language),
                actor: p.author.subject,
              })}
            </Text>
            {!!p.reference && (
              <Text selectable style={styles.support}>
                {t("nativeBilling.referenceValue", { value: p.reference })}
              </Text>
            )}
          </>
        )}
      />
    </View>
  );
}
function PaymentForm(props: ClinicPatientProps & { sale: Sale; back: () => void }) {
  const { t, i18n } = useTranslation(),
    { styles, sale, account, scope, client, back } = props,
    [method, setMethod] = useState<PaymentInput["method"]>("CASH"),
    [amount, setAmount] = useState(""),
    [reference, setReference] = useState(""),
    [shift, setShift] = useState<Shift>(),
    [picking, setPicking] = useState(false);
  const write = useBillingWrite(
    account,
    (id: string, b: PaymentInput) => client.billing.pay(scope, sale.id, id, b),
    back,
  );
  const locked = !!write.pending,
    body = paymentBody(sale, account, method, amount, reference, shift);
  if (picking)
    return (
      <Drawers
        {...props}
        currency={sale.currency}
        choose={(s) => {
          setShift(s);
          setPicking(false);
        }}
        back={() => setPicking(false)}
      />
    );
  return (
    <View style={styles.section}>
      <GoBack styles={styles} onPress={back} disabled={locked} />
      <Heading styles={styles}>{t("nativeBilling.addPayment") + " · " + sale.number}</Heading>
      {write.issue !== "denied" && (
        <>
          <Text style={styles.heading}>
            {t("nativeBilling.totals.balance", {
              amount: formatDecimal(sale.balance, i18n.language),
              currency: sale.currency,
            })}
          </Text>
          <View style={styles.actions}>
            {(["CASH", "CARD", "TRANSFER"] as const).map((m) => (
              <Action
                key={m}
                styles={styles}
                role="radio"
                selected={method === m}
                disabled={locked}
                label={t(`nativeBilling.methods.${m}`)}
                onPress={() => setMethod(m)}
              />
            ))}
          </View>
          <Field
            styles={styles}
            disabled={locked}
            identifier
            inputMode="decimal"
            label={t("nativeBilling.paymentAmount", { currency: sale.currency })}
            value={amount}
            onChange={setAmount}
            maxLength={19}
          />
          {method === "CASH" ? (
            <Action
              styles={styles}
              disabled={locked}
              label={
                shift
                  ? t("nativeBilling.chosenDrawer", { name: shift.label })
                  : t("nativeBilling.pickDrawer", { currency: sale.currency })
              }
              onPress={() => setPicking(true)}
            />
          ) : (
            <Field
              styles={styles}
              disabled={locked}
              identifier
              label={t("nativeBilling.reference")}
              value={reference}
              onChange={setReference}
              maxLength={120}
            />
          )}
        </>
      )}
      <Submit
        styles={styles}
        state={write}
        valid={!!body}
        label={t("nativeBilling.addPayment")}
        onPress={() => write.submit(body)}
      />
      {write.issue === "conflict" && (
        <Action styles={styles} label={t("nativeBilling.refreshInvoice")} onPress={back} />
      )}
    </View>
  );
}
