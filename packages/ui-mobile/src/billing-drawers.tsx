import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Action, Field } from "./controls";
import type { ClinicPatientProps } from "./patient-form";
import { BillingRows, GoBack, Heading, Submit, useBillingWrite } from "./billing-controls";
import {
  difference,
  formatDecimal,
  money,
  myShift,
  shiftBody,
  type Shift,
  type ShiftInput,
} from "./billing-forms";

export function Drawers(
  props: ClinicPatientProps & { back: () => void; currency?: string; choose?: (s: Shift) => void },
) {
  const { t, i18n } = useTranslation(),
    { styles, account, scope, client, currency, choose } = props,
    [edit, setEdit] = useState<Shift | "new">();
  const load = useCallback(
    async (page: number) => {
      const r = await client.billing.shifts(scope, page);
      return {
        rows: r.shifts.filter(
          (s) => myShift(s, account) && (!choose || (!s.closedAt && s.currency === currency)),
        ),
        hasNextPage: r.hasNextPage,
      };
    },
    [client, scope, account, choose, currency],
  );
  if (edit === "new")
    return (
      <OpenDrawer
        {...props}
        done={(shift) => {
          setEdit(undefined);
          choose?.(shift);
        }}
        back={() => setEdit(undefined)}
      />
    );
  if (edit) return <CloseDrawer {...props} shift={edit} back={() => setEdit(undefined)} />;
  return (
    <View style={styles.section}>
      <GoBack styles={styles} onPress={props.back} />
      <Heading styles={styles}>
        {choose ? t("nativeBilling.pickDrawer", { currency }) : t("nativeBilling.drawers")}
      </Heading>
      <Action styles={styles} label={t("nativeBilling.newDrawer")} onPress={() => setEdit("new")} />
      <BillingRows
        styles={styles}
        load={load}
        empty={t("nativeBilling.emptyDrawers")}
        render={(s) => (
          <>
            <Heading styles={styles}>{s.label + " · " + s.currency}</Heading>
            <Text style={styles.support}>
              {t("nativeBilling.opened", {
                when: new Date(s.openedAt).toLocaleString(i18n.language),
              })}
            </Text>
            <Text style={styles.support}>
              {t("nativeBilling.drawerAmounts", {
                opening: formatDecimal(s.openingFloat, i18n.language),
                expected: formatDecimal(s.expected, i18n.language),
                currency: s.currency,
              })}
            </Text>
            {s.closedAt ? (
              <>
                <Text style={styles.support}>
                  {t("nativeBilling.closed", {
                    when: new Date(s.closedAt).toLocaleString(i18n.language),
                  })}
                </Text>
                <Text style={styles.support}>
                  {t("nativeBilling.reconciled", {
                    counted: formatDecimal(s.counted!, i18n.language),
                    difference: formatDecimal(s.difference!, i18n.language),
                    currency: s.currency,
                  })}
                </Text>
              </>
            ) : (
              <Action
                styles={styles}
                label={
                  choose
                    ? t("nativeBilling.useDrawer", { name: s.label })
                    : t("nativeBilling.closeNamed", { name: s.label })
                }
                onPress={() => (choose ? choose(s) : setEdit(s))}
              />
            )}
          </>
        )}
      />
    </View>
  );
}
function OpenDrawer({
  client,
  scope,
  account,
  styles,
  currency,
  done,
  back,
}: ClinicPatientProps & { currency?: string; done: (s: Shift) => void; back: () => void }) {
  const { t } = useTranslation(),
    [name, setName] = useState(""),
    [code, setCode] = useState(currency ?? "CRC"),
    [opening, setOpening] = useState("");
  const write = useBillingWrite<ShiftInput, Shift>(
      account,
      (id, b) => client.billing.open(scope, id, b),
      done,
    ),
    body = shiftBody(name, code, opening),
    locked = !!write.pending;
  return (
    <View style={styles.section}>
      <GoBack styles={styles} onPress={back} disabled={locked} />
      <Heading styles={styles}>{t("nativeBilling.newDrawer")}</Heading>
      {write.issue !== "denied" && (
        <>
          <Field
            styles={styles}
            disabled={locked}
            label={t("nativeBilling.drawerName")}
            value={name}
            onChange={setName}
            maxLength={120}
          />
          <Field
            styles={styles}
            disabled={locked || !!currency}
            identifier
            label={t("nativeBilling.fields.currency")}
            value={code}
            onChange={setCode}
            maxLength={3}
          />
          <Field
            styles={styles}
            disabled={locked}
            identifier
            inputMode="decimal"
            label={t("nativeBilling.opening")}
            value={opening}
            onChange={setOpening}
            maxLength={19}
          />
        </>
      )}
      <Submit
        styles={styles}
        state={write}
        valid={!!body}
        label={t("nativeBilling.newDrawer")}
        onPress={() => write.submit(body)}
      />
      {write.issue === "conflict" && (
        <Action styles={styles} label={t("nativeBilling.reviewDrawers")} onPress={back} />
      )}
    </View>
  );
}
function CloseDrawer({
  client,
  scope,
  account,
  styles,
  shift,
  back,
}: ClinicPatientProps & { shift: Shift; back: () => void }) {
  const { t, i18n } = useTranslation(),
    [counted, setCounted] = useState("");
  const write = useBillingWrite<{ counted: string }, Shift>(
      account,
      (id, b) => client.billing.close(scope, id, b),
      back,
    ),
    parsed = money(counted),
    variance = difference(counted, shift.expected);
  return (
    <View style={styles.section}>
      <GoBack styles={styles} onPress={back} disabled={!!write.pending} />
      <Heading styles={styles}>{t("nativeBilling.closeNamed", { name: shift.label })}</Heading>
      {write.issue !== "denied" && (
        <>
          <Text style={styles.support}>
            {t("nativeBilling.drawerAmounts", {
              opening: formatDecimal(shift.openingFloat, i18n.language),
              expected: formatDecimal(shift.expected, i18n.language),
              currency: shift.currency,
            })}
          </Text>
          <Field
            styles={styles}
            disabled={!!write.pending}
            label={t("nativeBilling.counted", { currency: shift.currency })}
            value={counted}
            onChange={setCounted}
            inputMode="decimal"
            identifier
            maxLength={19}
          />
          {variance && (
            <Text style={styles.support}>
              {t("nativeBilling.variance", {
                value: formatDecimal(variance, i18n.language),
                currency: shift.currency,
              })}
            </Text>
          )}
        </>
      )}
      <Submit
        styles={styles}
        state={write}
        valid={!!parsed}
        label={t("nativeBilling.closeDrawer")}
        onPress={() => write.submit(parsed ? { counted: parsed } : undefined, shift.id)}
      />
      {write.issue === "conflict" && (
        <Action styles={styles} label={t("nativeBilling.reviewDrawers")} onPress={back} />
      )}
    </View>
  );
}
