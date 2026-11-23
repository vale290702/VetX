import { Activity, useCallback, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Action, type AccessStyles } from "./controls";
import {
  exportBody,
  hasRecord,
  toggleExportRecord,
  type Source,
  type Destination,
  type RecordKey,
} from "./exchange-forms";
import { useExchangeHandoff, vetpkgFormat } from "./exchange-files";
import { Pager, PatientNotice, PatientReadState, usePatientRead } from "./patient-controls";
import type { PatientClient } from "./patients";
import type { MobileAccount } from "./session";
type Props = {
  account: MobileAccount;
  client: PatientClient;
  styles: AccessStyles;
  pet: { id: string; name: string };
  back: () => void;
};
const sourceKey = (s: Source) => [s.organizationId, s.clinicId, s.patientId].join("/");
export function OwnerExchange({ account, client, styles, pet, back }: Props) {
  const { t } = useTranslation();
  const [selected, select] = useState<Source>();
  const load = useCallback(
    () => client.exchange.options(account.subject, pet.id),
    [account, client, pet.id],
  );
  const { result, reload } = usePatientRead(load);
  const sources = result && "value" in result ? result.value.sources : undefined;
  const current = selected && sources?.find((s) => sourceKey(s) === sourceKey(selected));
  if (selected && (current || !result)) {
    return (
      <>
        {!current && <PatientReadState styles={styles} retry={reload} />}
        <Activity mode={current ? "visible" : "hidden"}>
          <ExportSelection
            key={sourceKey(selected)}
            account={account}
            client={client}
            styles={styles}
            pet={pet}
            source={current ?? selected}
            back={() => {
              select(undefined);
              reload();
            }}
          />
        </Activity>
      </>
    );
  }
  return (
    <View style={styles.section}>
      <View style={styles.actions}>
        <Action styles={styles} label={t("nativeCare.backPets")} onPress={back} />
      </View>
      <Text accessibilityRole="header" style={styles.heading}>
        {t("nativeExchange.exportFor", { name: pet.name })}
      </Text>
      {!result || "error" in result ? (
        <PatientReadState styles={styles} retry={reload} error={result?.error} />
      ) : (
        <>
          <Text style={styles.support}>{t("nativeExchange.chooseSource")}</Text>
          {!result.value.sources.some((s) => s.destinations.length) && (
            <Text style={styles.support}>{t("nativeExchange.noRoutes")}</Text>
          )}
          {result.value.sources.map((s) => (
            <Action
              key={sourceKey(s)}
              styles={styles}
              disabled={!s.destinations.length}
              label={s.clinicName + " · " + s.organizationName}
              onPress={() => select(s)}
            />
          ))}
        </>
      )}
    </View>
  );
}
function ExportSelection({
  account,
  client,
  styles,
  pet,
  source,
  back,
}: Props & { source: Source }) {
  const { t, i18n } = useTranslation();
  const [page, setPage] = useState(1),
    [destination, setDestination] = useState<Destination>(),
    [records, setRecords] = useState<RecordKey[]>([]),
    [include, setInclude] = useState(false);
  const load = useCallback(
    () => client.exchange.choices(account.subject, pet.id, source, page),
    [account, client, pet.id, source, page],
  );
  const { result, reload } = usePatientRead(load);
  const transfer = useExchangeHandoff(account);
  const body = exportBody(source, destination, records, include);
  const selectedDestination = source.destinations.find(
    (d) =>
      destination &&
      d.organizationId === destination.organizationId &&
      d.clinicId === destination.clinicId,
  );
  return (
    <View style={styles.section}>
      <View style={styles.actions}>
        <Action
          styles={styles}
          label={t("nativeExchange.changeSource")}
          disabled={transfer.busy}
          onPress={back}
        />
      </View>
      <Text accessibilityRole="header" style={styles.heading}>
        {t("nativeExchange.exportFor", { name: pet.name })}
      </Text>
      <Text style={styles.support}>
        {source.clinicName} · {source.organizationName}
      </Text>
      <Text style={styles.heading}>{t("nativeExchange.receivingClinic")}</Text>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={t("nativeExchange.receivingClinic")}
        style={styles.actions}
      >
        {source.destinations.map((d) => (
          <Action
            key={d.organizationId + "/" + d.clinicId}
            styles={styles}
            role="radio"
            selected={selectedDestination === d}
            label={d.name}
            disabled={transfer.busy}
            onPress={() => setDestination(d)}
          />
        ))}
      </View>
      {!source.destinations.length && (
        <Text style={styles.support}>{t("nativeExchange.noRoutes")}</Text>
      )}
      <Text style={styles.heading}>{t("nativeExchange.chooseRecords")}</Text>
      {!result || "error" in result ? (
        <PatientReadState styles={styles} retry={reload} error={result?.error} />
      ) : (
        <>
          {!result.value.records.length && (
            <Text style={styles.support}>{t("nativeExchange.noChoices")}</Text>
          )}
          {result.value.records.map((r) => (
            <Action
              key={r.kind + ":" + r.id}
              styles={styles}
              role="checkbox"
              selected={hasRecord(records, r)}
              disabled={transfer.busy}
              label={
                r.title +
                " · " +
                t(`nativeExchange.kinds.${r.kind}`) +
                " · " +
                new Date(r.occurredAt).toLocaleDateString(i18n.language)
              }
              onPress={() => setRecords((previous) => toggleExportRecord(previous, r))}
            />
          ))}
          {!transfer.busy && (
            <Pager styles={styles} page={page} next={result.value.hasNextPage} change={setPage} />
          )}
        </>
      )}
      <Action
        styles={styles}
        role="checkbox"
        selected={include}
        label={t("nativeExchange.includeContact")}
        disabled={transfer.busy}
        onPress={() => setInclude(!include)}
      />
      <Text style={styles.support}>
        {t("nativeExchange.selectedCount", { count: records.length })}
      </Text>
      {selectedDestination && (
        <Text style={styles.support}>
          {t("nativeExchange.exportDisclosure", { clinic: selectedDestination.name })}
        </Text>
      )}
      <PatientNotice styles={styles} error={transfer.error} />
      <View style={styles.actions}>
        <Action
          styles={styles}
          primary
          busy={transfer.busy}
          disabled={!body || !result || "error" in result || transfer.error === "denied"}
          label={t("nativeExchange.sharePackage")}
          onPress={() => {
            if (body)
              transfer.open(
                vetpkgFormat,
                () => client.exchange.exportPackage(account.subject, pet.id, body),
                t("nativeExchange.sharePackage"),
              );
          }}
        />
        {transfer.error === "denied" && (
          <Action styles={styles} label={t("nativeExchange.reviewExport")} onPress={back} />
        )}
      </View>
    </View>
  );
}
