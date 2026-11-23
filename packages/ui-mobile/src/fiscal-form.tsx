import { useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Action, Field, type AccessStyles } from "./controls";
import { Pager } from "./patient-controls";
import { Heading, Submit, useBillingWrite } from "./billing-controls";
import { formatDecimal, type Sale } from "./billing-forms";
import {
  identities,
  matchingTariffs,
  newFiscalDraft,
  paidInFull,
  prepareFiscal,
  unitCodes,
  type Draft,
  type Environment,
  type Fields,
  type FiscalRecord,
  type LineFields,
} from "./fiscal-forms";
import type { ClinicPatientProps } from "./patient-form";

function ChooseUnit({
  styles,
  choose,
  back,
}: {
  styles: AccessStyles;
  choose: (code: string) => void;
  back: () => void;
}) {
  const { t } = useTranslation(),
    [filter, setFilter] = useState(""),
    [page, setPage] = useState(1);
  const all = unitCodes.filter((u) => u.toLowerCase().includes(filter.trim().toLowerCase())),
    size = 12;
  return (
    <View style={styles.section}>
      <Action styles={styles} label={t("nativeBilling.back")} onPress={back} />
      <Field
        styles={styles}
        label={t("nativeFiscal.unitSearch")}
        disabled={false}
        maxLength={32}
        value={filter}
        onChange={(value) => {
          setFilter(value);
          setPage(1);
        }}
      />
      {!all.length && <Text style={styles.support}>{t("nativeFiscal.unitEmpty")}</Text>}
      <View style={styles.actions}>
        {all.slice((page - 1) * size, page * size).map((code) => (
          <Action key={code} styles={styles} label={code} onPress={() => choose(code)} />
        ))}
      </View>
      <Pager styles={styles} page={page} next={page * size < all.length} change={setPage} />
    </View>
  );
}

export function FiscalForm(
  props: ClinicPatientProps & {
    sale: Sale;
    env: Environment;
    back: () => void;
    refresh: () => void;
  },
) {
  const { t, i18n } = useTranslation(),
    { client, scope, account, styles, sale, env, refresh } = props;
  const [fields, setFields] = useState<Fields>(() => newFiscalDraft(sale)),
    [unitIndex, setUnitIndex] = useState<number>(),
    [review, setReview] = useState(false);
  const write = useBillingWrite<Draft, FiscalRecord>(
    account,
    (_id, b) => client.fiscal.issue(scope, sale.id, env, b),
    refresh,
  );
  const prepared = prepareFiscal(sale, fields);
  const draft = write.pending?.body ?? prepared,
    locked = !!write.pending,
    issueLabel = t(
      env === "sandbox" ? "nativeFiscal.issueSandbox" : "nativeFiscal.issueProduction",
    );
  function update<K extends keyof Fields>(key: K, value: Fields[K]) {
    setFields((f) => ({ ...f, [key]: value }));
  }
  function updateLine(index: number, patch: Partial<LineFields>) {
    setFields((f) => ({
      ...f,
      lines: f.lines.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    }));
  }
  if (review && !draft) setReview(false);
  if (unitIndex !== undefined)
    return (
      <ChooseUnit
        styles={styles}
        choose={(unitCode) => {
          updateLine(unitIndex, { unitCode });
          setUnitIndex(undefined);
        }}
        back={() => setUnitIndex(undefined)}
      />
    );
  if (review && draft)
    return (
      <View style={styles.section}>
        <Heading styles={styles}>{t("nativeFiscal.review")}</Heading>
        <Text style={styles.heading}>
          {t("nativeFiscal.currentEnvironment", { environment: t(`nativeFiscal.${env}`) })}
        </Text>
        {write.issue !== "denied" && (
          <>
            <Text style={styles.heading}>{draft.recipient.name}</Text>
            <Text style={styles.support}>
              {t(`nativeFiscal.id${draft.recipient.identity.type}`) +
                " · " +
                draft.recipient.identity.number}
            </Text>
            {draft.recipient.email && <Text style={styles.support}>{draft.recipient.email}</Text>}
            {draft.recipientActivity && (
              <Text style={styles.support}>
                {t("nativeFiscal.recipientActivity") + " · " + draft.recipientActivity}
              </Text>
            )}
            <Text style={styles.support}>
              {draft.terms.code === "01"
                ? t("nativeFiscal.immediate")
                : t("nativeFiscal.creditReview", { days: draft.terms.days })}
            </Text>
            <Text style={styles.support}>
              {t("nativeFiscal.exchangeReview", {
                rate: formatDecimal(draft.exchangeRate, i18n.language),
                currency: sale.currency,
              })}
            </Text>
            {draft.lines.map((line, index) => (
              <View style={styles.row} key={index}>
                <Heading styles={styles}>{sale.lines[index]!.name}</Heading>
                <Text style={styles.support}>
                  {t("nativeFiscal.lineSummary", {
                    category: t(`nativeFiscal.${line.category}`),
                    unit: line.unitCode,
                    tariff: t(`nativeFiscal.tariff${line.vatTariffCode}`, {
                      rate: formatDecimal(sale.lines[index]!.taxRate, i18n.language),
                    }),
                    cabys: sale.lines[index]!.cabys,
                  })}
                </Text>
                {line.medicine && (
                  <Text style={styles.support}>
                    {line.medicine.registration + " · " + line.medicine.form}
                  </Text>
                )}
              </View>
            ))}
          </>
        )}
        <Action
          styles={styles}
          label={t("nativeFiscal.edit")}
          disabled={locked || write.issue === "denied" || write.issue === "conflict"}
          onPress={() => setReview(false)}
        />
        <Submit
          styles={styles}
          state={write}
          valid={!!prepared}
          label={issueLabel}
          onPress={() => write.submit(prepared, sale.id)}
        />
        {(write.issue === "conflict" || write.issue === "denied") && (
          <Action styles={styles} label={t("nativeFiscal.refreshFiscal")} onPress={refresh} />
        )}
      </View>
    );
  return (
    <View style={styles.section}>
      <Action styles={styles} label={t("nativeFiscal.backStatus")} onPress={props.back} />
      <Heading styles={styles}>{t("nativeFiscal.prepareInvoice")}</Heading>
      <Text style={styles.support}>
        {t("nativeFiscal.currentEnvironment", { environment: t(`nativeFiscal.${env}`) })}
      </Text>
      <Field
        styles={styles}
        disabled={false}
        label={t("nativeFiscal.recipient")}
        value={fields.name}
        maxLength={100}
        onChange={(v) => update("name", v)}
      />
      <Heading styles={styles}>{t("nativeFiscal.idType")}</Heading>
      <View style={styles.actions}>
        {identities.map((code) => (
          <Action
            key={code}
            styles={styles}
            role="radio"
            selected={fields.identityType === code}
            label={t(`nativeFiscal.id${code}`)}
            onPress={() => update("identityType", code)}
          />
        ))}
      </View>
      <Field
        styles={styles}
        identifier
        inputMode="numeric"
        disabled={false}
        label={t("nativeFiscal.idNumber")}
        value={fields.number}
        maxLength={12}
        onChange={(v) => update("number", v)}
      />
      <Field
        styles={styles}
        identifier
        inputMode="email"
        disabled={false}
        label={t("nativeFiscal.recipientEmail")}
        value={fields.email}
        maxLength={160}
        onChange={(v) => update("email", v)}
      />
      <Field
        styles={styles}
        identifier
        inputMode="numeric"
        disabled={false}
        label={t("nativeFiscal.recipientActivity")}
        value={fields.activity}
        maxLength={6}
        onChange={(v) => update("activity", v)}
      />
      <Heading styles={styles}>{t("nativeFiscal.terms")}</Heading>
      <Text style={styles.support}>
        {t("nativeFiscal.recordedTerms", {
          paid: formatDecimal(sale.paid, i18n.language),
          balance: formatDecimal(sale.balance, i18n.language),
          currency: sale.currency,
        })}
      </Text>
      <View style={styles.actions}>
        {(["01", "02"] as const).map((code) => (
          <Action
            key={code}
            styles={styles}
            role="radio"
            selected={fields.terms === code}
            disabled={code === "01" && !paidInFull(sale)}
            label={t(code === "01" ? "nativeFiscal.immediate" : "nativeFiscal.credit")}
            onPress={() => update("terms", code)}
          />
        ))}
      </View>
      {fields.terms === "02" && (
        <Field
          styles={styles}
          label={t("nativeFiscal.creditDays")}
          inputMode="numeric"
          identifier
          maxLength={5}
          disabled={false}
          value={fields.days}
          onChange={(v) => update("days", v)}
        />
      )}
      <Field
        styles={styles}
        label={t("nativeFiscal.exchangeRate", { currency: sale.currency })}
        inputMode="decimal"
        identifier
        maxLength={19}
        disabled={sale.currency === "CRC"}
        value={fields.exchangeRate}
        onChange={(v) => update("exchangeRate", v)}
      />
      {fields.lines.map((line, index) => {
        const snapshot = sale.lines[index]!;
        return (
          <View key={index} style={styles.row}>
            <Heading styles={styles}>
              {t("nativeFiscal.invoiceLine", { n: index + 1, name: snapshot.name })}
            </Heading>
            <Text style={styles.support}>
              {t("nativeBilling.lineTax", {
                rate: formatDecimal(snapshot.taxRate, i18n.language),
                cabys: snapshot.cabys,
              })}
            </Text>
            <Heading styles={styles}>{t("nativeFiscal.fiscalCategory")}</Heading>
            <View style={styles.actions}>
              {(["goods", "service"] as const).map((category) => (
                <Action
                  key={category}
                  styles={styles}
                  role="radio"
                  selected={line.category === category}
                  label={t(`nativeFiscal.${category}`)}
                  onPress={() => updateLine(index, { category })}
                />
              ))}
            </View>
            <Action
              styles={styles}
              label={t("nativeFiscal.unitChoice", {
                unit: line.unitCode || t("nativeFiscal.noUnit"),
              })}
              onPress={() => setUnitIndex(index)}
            />
            <Heading styles={styles}>{t("nativeFiscal.vatCode")}</Heading>
            <View style={styles.actions}>
              {matchingTariffs(snapshot.taxRate).map((code) => (
                <Action
                  key={code}
                  styles={styles}
                  selected={line.vatTariffCode === code}
                  role="radio"
                  label={t(`nativeFiscal.tariff${code}`, {
                    rate: formatDecimal(snapshot.taxRate, i18n.language),
                  })}
                  onPress={() => updateLine(index, { vatTariffCode: code })}
                />
              ))}
            </View>
            <Heading styles={styles}>{t("nativeFiscal.medicineFields")}</Heading>
            <Field
              styles={styles}
              disabled={false}
              identifier
              label={t("nativeFiscal.registration")}
              value={line.registration}
              maxLength={100}
              onChange={(registration) => updateLine(index, { registration })}
            />
            <Field
              styles={styles}
              disabled={false}
              identifier
              label={t("nativeFiscal.dosageForm")}
              value={line.form}
              maxLength={3}
              onChange={(form) => updateLine(index, { form })}
            />
          </View>
        );
      })}
      <Action
        styles={styles}
        label={t("nativeFiscal.review")}
        primary
        disabled={!prepared}
        onPress={() => setReview(true)}
      />
    </View>
  );
}
