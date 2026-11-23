import { Activity, useCallback, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Action } from "./controls";
import { Heading, Submit, useBillingWrite } from "./billing-controls";
import { PatientReadState, usePatientRead } from "./patient-controls";
import { useExchangeHandoff } from "./exchange-files";
import { FiscalForm } from "./fiscal-form";
import {
  xmlFormat,
  issueCodes,
  matchingTariffs,
  type Environment,
  type FiscalRecord,
} from "./fiscal-forms";
import type { Sale } from "./billing-forms";
import type { ClinicPatientProps } from "./patient-form";

type Props = ClinicPatientProps & { sale: Sale; admin: boolean | undefined; back: () => void };
export function FiscalInvoice(props: Props) {
  const [env, setEnv] = useState<Environment>("sandbox");
  return <FiscalEnvironment key={env} {...props} env={env} change={setEnv} />;
}
function FiscalEnvironment(
  props: Props & { env: Environment; change: (env: Environment) => void },
) {
  const { t } = useTranslation(),
    { styles, sale, env, scope, client } = props,
    [editing, setEditing] = useState(false);
  const { result, reload } = usePatientRead(
    useCallback(() => client.fiscal.status(scope, sale.id, env), [client, scope, sale.id, env]),
  );
  const status = result && "value" in result ? result.value : undefined,
    error = result && "error" in result ? result.error : undefined;
  const canPrepare =
    status?.enabled &&
    !status.invoice &&
    sale.lines.length > 0 &&
    sale.lines.every((l) => matchingTariffs(l.taxRate).length > 0);
  if (editing && (error === "denied" || (status && !canPrepare))) setEditing(false);
  if (editing && error !== "denied" && (!status || canPrepare)) {
    return (
      <>
        {!status && <PatientReadState styles={styles} error={error} retry={reload} />}
        <Activity mode={canPrepare ? "visible" : "hidden"}>
          <FiscalForm
            {...props}
            back={() => setEditing(false)}
            refresh={() => {
              setEditing(false);
              reload();
            }}
          />
        </Activity>
      </>
    );
  }
  return (
    <View style={styles.section}>
      <Action styles={styles} label={t("nativeFiscal.backInvoice")} onPress={props.back} />
      <Heading styles={styles}>{t("nativeFiscal.electronicInvoice") + " · " + sale.number}</Heading>
      <Heading styles={styles}>{t("nativeFiscal.fiscalEnvironment")}</Heading>
      <View style={styles.actions}>
        {(["sandbox", "production"] as const).map((e) => (
          <Action
            key={e}
            styles={styles}
            label={t(`nativeFiscal.${e}`)}
            role="radio"
            selected={env === e}
            onPress={() => props.change(e)}
          />
        ))}
      </View>
      {!status ? (
        <PatientReadState styles={styles} error={error} retry={reload} />
      ) : (
        <>
          {!status.enabled && (
            <Text style={styles.support}>{t("nativeFiscal.fiscalDisabled")}</Text>
          )}
          {status.invoice ? (
            <RecordView
              {...props}
              record={status.invoice}
              enabled={status.enabled}
              reload={reload}
            />
          ) : (
            status.enabled && (
              <>
                <Text style={styles.support}>{t("nativeFiscal.noneIssued")}</Text>
                {canPrepare ? (
                  <Action
                    styles={styles}
                    label={t("nativeFiscal.prepareInvoice")}
                    onPress={() => setEditing(true)}
                  />
                ) : (
                  <Text style={styles.support}>{t("nativeFiscal.unsupportedSale")}</Text>
                )}
              </>
            )
          )}
          <Action styles={styles} label={t("nativeFiscal.refreshFiscal")} onPress={reload} />
        </>
      )}
    </View>
  );
}
function RecordView(
  props: Props & { env: Environment; record: FiscalRecord; enabled: boolean; reload: () => void },
) {
  const { t, i18n } = useTranslation(),
    { styles, record, env, scope, sale, client, account } = props;
  const download = useExchangeHandoff(account);
  const retry = useBillingWrite<true, FiscalRecord>(
    account,
    () => client.fiscal.retry(scope, sale.id, env),
    props.reload,
  );
  const code = issueCodes.find((c) => c === record.issue);
  return (
    <View style={styles.section}>
      <Text accessibilityLiveRegion="polite" style={styles.heading}>
        {record.state === "invalid"
          ? t("nativeFiscal.invalidInvoice")
          : t(`nativeFiscal.${record.state}`)}
      </Text>
      <Text style={styles.support}>
        {t("nativeFiscal.issuedDate", {
          when: new Date(record.createdAt).toLocaleString(i18n.language),
        })}
      </Text>
      <Text style={styles.heading}>{t("nativeFiscal.invoiceKey")}</Text>
      <Text selectable style={styles.support}>
        {record.key}
      </Text>
      {code && <Text style={styles.support}>{t(`nativeFiscal.issue_${code}`)}</Text>}
      {(["invoice", "receipt"] as const).map((kind) => {
        const present = kind === "invoice" ? record.hasSignedXml : record.hasReceipt,
          label = t(
            kind === "invoice" ? "nativeFiscal.downloadXml" : "nativeFiscal.downloadReceipt",
          );
        return present ? (
          <Action
            key={kind}
            styles={styles}
            label={label}
            busy={download.busy}
            onPress={() =>
              download.open(
                xmlFormat(kind, record.key),
                () => client.fiscal.artifact(scope, sale.id, env, kind),
                label,
              )
            }
          />
        ) : (
          <Text key={kind} style={styles.support}>
            {t(kind === "invoice" ? "nativeFiscal.signature" : "nativeFiscal.authorityReceipt") +
              " · " +
              t("nativeFiscal.notAvailable")}
          </Text>
        );
      })}
      {download.error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {download.error === "handoffUnavailable" || download.error === "denied"
            ? t(`nativePatients.${download.error}`)
            : t("nativeFiscal.artifactFailed")}
        </Text>
      )}
      {record.state === "blocked" && props.enabled && props.admin === true && (
        <>
          <Text style={styles.support}>{t("nativeFiscal.retryHelp")}</Text>
          <Submit
            styles={styles}
            state={retry}
            label={t("nativeFiscal.retryInvoice")}
            valid
            onPress={() => retry.submit(true, sale.id)}
          />
        </>
      )}
    </View>
  );
}
