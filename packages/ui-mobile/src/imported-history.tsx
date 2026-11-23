import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Action } from "./controls";
import { useExchangeHandoff } from "./exchange-files";
import type { ImportedRecord } from "./exchange-forms";
import { Pager, PatientNotice, PatientReadState, usePatientRead } from "./patient-controls";
import type { ClinicPatientProps } from "./patient-form";

const kinds = [
  "encounter",
  "addendum",
  "diagnosis",
  "treatment",
  "prescription",
  "vaccination",
  "labResult",
  "document",
  "radiograph",
  "dicom",
  "referral",
  "counterReferral",
] as const;
export function kindKey(value: string) {
  const kind = kinds.find((k) => k === value);
  return kind ? (`nativeExchange.kinds.${kind}` as const) : ("nativeExchange.record" as const);
}
const fields = [
  "reason",
  "subjective",
  "objective",
  "assessment",
  "plan",
  "addendumTo",
  "diagnosis",
  "code",
  "treatment",
  "notes",
  "medication",
  "quantity",
  "instructions",
  "vaccine",
  "lotNumber",
  "nextDueDate",
  "test",
  "specimen",
  "result",
  "unit",
  "referenceRange",
  "title",
  "byteLength",
  "sha256",
  "mediaType",
  "studyInstanceUid",
  "seriesInstanceUid",
  "sopInstanceUid",
  "referredTo",
  "referringClinic",
  "referralId",
  "summary",
] as const;
const formats = {
  "application/pdf": { extension: "pdf", uti: "com.adobe.pdf" },
  "image/jpeg": { extension: "jpg", uti: "public.jpeg" },
  "image/png": { extension: "png", uti: "public.png" },
  "application/dicom": { extension: "dcm", uti: "public.data" },
} as const;
function fieldValue(v: unknown) {
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (
    v &&
    typeof v === "object" &&
    "organizationId" in v &&
    "clinicId" in v &&
    typeof v.organizationId === "string" &&
    typeof v.clinicId === "string"
  )
    return v.organizationId + " / " + v.clinicId;
  return undefined;
}
function ImportedDetail({
  record,
  patientId,
  ...props
}: ClinicPatientProps & { record: ImportedRecord; patientId: string }) {
  const { styles, account, scope, client } = props,
    { t, i18n } = useTranslation();
  const transfer = useExchangeHandoff(account);
  const media = record.data.mediaType,
    size = record.data.byteLength;
  const mime = Object.keys(formats).find((k) => k === media) as keyof typeof formats | undefined;
  const attachment =
    mime &&
    (record.kind === "document" || record.kind === "radiograph" || record.kind === "dicom") &&
    typeof size === "number" &&
    size > 0
      ? { mimeType: mime, ...formats[mime], size }
      : undefined;
  return (
    <View style={styles.section}>
      <Text selectable style={styles.support}>
        {t("nativeExchange.original", {
          org: record.source.organizationId,
          clinic: record.source.clinicId,
          patient: record.source.patientId,
        })}
      </Text>
      <Text selectable style={styles.support}>
        {t("nativeExchange.author", {
          issuer: record.author.issuer,
          subject: record.author.subject,
        })}
      </Text>
      <Text selectable style={styles.support}>
        {t("nativeExchange.originalId", { id: record.id })}
      </Text>
      <Text selectable style={styles.support}>
        {t("nativeExchange.packageId", { id: record.packageId })}
      </Text>
      <Text style={styles.support}>
        {t("nativeExchange.recorded", {
          time: new Date(record.recordedAt).toLocaleString(i18n.language),
        })}
      </Text>
      <Text style={styles.support}>
        {t("nativeExchange.imported", {
          time: new Date(record.importedAt).toLocaleString(i18n.language),
        })}
      </Text>
      {record.clinicalRevision && (
        <View style={styles.section}>
          <Text selectable style={styles.support}>
            {t("nativeClinical.sourceRecord") + " · " + record.clinicalRevision.recordId}
          </Text>
          <Text style={styles.support}>
            {t("nativeClinical.sourceVersion") + " · " + record.clinicalRevision.revision}
          </Text>
          {record.clinicalRevision.resultAuthor && (
            <Text selectable style={styles.support}>
              {t("nativeClinical.resultAuthor") +
                " · " +
                record.clinicalRevision.resultAuthor.subject +
                " · " +
                record.clinicalRevision.resultAuthor.issuer}
            </Text>
          )}
          {record.clinicalRevision.resultRecordedAt && (
            <Text style={styles.support}>
              {t("nativeClinical.resultRecordedAt") +
                " · " +
                new Date(record.clinicalRevision.resultRecordedAt).toLocaleString(i18n.language)}
            </Text>
          )}
        </View>
      )}
      {fields.map((key) => {
        const value = fieldValue(record.data[key]);
        return value ? (
          <View key={key} style={styles.section}>
            <Text style={styles.heading}>{t(`nativeExchange.fields.${key}`)}</Text>
            <Text selectable style={styles.support}>
              {value}
            </Text>
          </View>
        ) : null;
      })}
      {attachment && (
        <>
          <PatientNotice styles={styles} error={transfer.error} />
          <Action
            styles={styles}
            busy={transfer.busy}
            label={t("nativeDocuments.open")}
            onPress={() =>
              transfer.open(
                attachment,
                () => client.exchange.content(scope, patientId, record.importedId, attachment.size),
                t(kindKey(record.kind)),
              )
            }
          />
        </>
      )}
    </View>
  );
}
export function ImportedHistory({
  patientId,
  back,
  ...props
}: ClinicPatientProps & { patientId: string; back: () => void }) {
  const { t, i18n } = useTranslation(),
    { scope, client, styles } = props;
  const [page, setPage] = useState(1),
    [expanded, setExpanded] = useState<string>();
  const load = useCallback(
    () => client.exchange.history(scope, patientId, page),
    [client, scope, patientId, page],
  );
  const { result, reload } = usePatientRead(load);
  return (
    <View style={styles.section}>
      <Action styles={styles} label={t("nativeCare.backPatient")} onPress={back} />
      <Text accessibilityRole="header" style={styles.heading}>
        {t("nativeExchange.history")}
      </Text>
      {!result || "error" in result ? (
        <PatientReadState styles={styles} retry={reload} error={result?.error} />
      ) : (
        <>
          {!result.value.records.length && (
            <Text style={styles.support}>{t("nativeExchange.emptyHistory")}</Text>
          )}
          {result.value.records.map((r) => (
            <View style={styles.row} key={r.importedId}>
              <Text accessibilityRole="header" style={styles.heading}>
                {t(kindKey(r.kind))} · {new Date(r.occurredAt).toLocaleString(i18n.language)}
              </Text>
              <Action
                styles={styles}
                expanded={r.importedId === expanded}
                label={t(
                  r.importedId === expanded ? "nativeExchange.hide" : "nativeExchange.details",
                )}
                onPress={() => setExpanded(r.importedId === expanded ? undefined : r.importedId)}
              />
              {expanded === r.importedId && (
                <ImportedDetail {...props} patientId={patientId} record={r} />
              )}
            </View>
          ))}
          <Pager styles={styles} page={page} next={result.value.hasNextPage} change={setPage} />
        </>
      )}
    </View>
  );
}
