import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Action, Field } from "./controls";
import { Pager, PatientReadState, usePatientRead } from "./patient-controls";
import type { ClinicPatientProps } from "./patient-form";
import { episodeActionLabel, initialClinicalValues, isEpisode } from "./inpatient-forms";
import { localMinute, minuteInstant } from "./care-time";
import {
  buildClinical,
  clinicalFields,
  limits,
  kinds,
  type Kind,
  type Operation,
  type StaffRecord,
  type ClinicalWrite,
  type Values,
} from "./clinical-record-forms";
import {
  ClinicalEntry,
  ClinicalHeading,
  SubmitClinical,
  useClinicalWrite,
} from "./clinical-record-controls";
type Props = ClinicPatientProps & {
  patientId: string;
  back: () => void;
  openNotes: () => void;
  op: Operation;
  current?: StaffRecord;
};
export function ClinicalEditor(props: Props) {
  const { t, i18n } = useTranslation(),
    { client, scope, patientId, account, styles, current, op, back } = props;
  const [recordId] = useState(() => current?.id ?? globalThis.expo.uuidv4()),
    [kind, setKind] = useState<Kind>(current?.kind ?? "diagnosis"),
    [values, setValues] = useState<Values>(() => initialClinicalValues(current, op)),
    [when, setWhen] = useState(() =>
      localMinute(
        current && isEpisode(current.kind) && op !== "amend"
          ? new Date(Math.max(Date.now(), Date.parse(current.occurredAt)))
          : current
            ? new Date(current.occurredAt)
            : new Date(),
      ),
    ),
    [reason, setReason] = useState("");
  const [encounter, setEncounter] = useState<{ id: string; reason: string }>(),
    [choose, setChoose] = useState(false),
    [page, setPage] = useState(1);
  const encounters = usePatientRead(
    useCallback(
      async () => (choose ? client.care.encounters(scope, patientId, page) : undefined),
      [choose, client, scope, patientId, page],
    ),
  );
  const send = useClinicalWrite<ClinicalWrite, StaffRecord>(
    account,
    (id, b) => client.clinical.save(scope, patientId, recordId, id, b),
    back,
  );
  const eventTime = minuteInstant(when, current?.occurredAt);
  const body = buildClinical(kind, op, encounter?.id ?? "", eventTime, values, reason, current),
    locked = send.pending;
  if (choose) {
    const r = encounters.result;
    return (
      <View style={styles.section}>
        <Action
          styles={styles}
          label={t("nativeClinical.backForm")}
          onPress={() => setChoose(false)}
        />
        <ClinicalHeading styles={styles}>{t("nativeClinical.selectEncounter")}</ClinicalHeading>
        {!r || "error" in r || !r.value ? (
          <PatientReadState
            styles={styles}
            error={r && "error" in r ? r.error : undefined}
            retry={encounters.reload}
          />
        ) : (
          <>
            {!r.value.encounters.length && (
              <>
                <Text style={styles.support}>{t("nativeClinical.noEncounters")}</Text>
                <Action
                  styles={styles}
                  label={t("nativeClinical.openEncounters")}
                  onPress={props.openNotes}
                />
              </>
            )}
            {r.value.encounters.map((e) => (
              <Action
                key={e.id}
                styles={styles}
                label={e.reason + " · " + new Date(e.occurredAt).toLocaleString(i18n.language)}
                onPress={() => {
                  setEncounter(e);
                  setChoose(false);
                }}
              />
            ))}
            <Pager styles={styles} page={page} next={r.value.hasNextPage} change={setPage} />
          </>
        )}
      </View>
    );
  }
  return (
    <View style={styles.section}>
      <Action styles={styles} label={t("nativeClinical.all")} disabled={locked} onPress={back} />
      <ClinicalHeading styles={styles}>
        {t(
          isEpisode(kind) && op !== "new"
            ? `nativeClinical.${episodeActionLabel(kind, op)}`
            : op === "new"
              ? "nativeClinical.new"
              : op === "review"
                ? "nativeClinical.review"
                : op === "result"
                  ? current && "status" in current.data && current.data.status !== "ORDERED"
                    ? "nativeClinical.correctResult"
                    : "nativeClinical.enterResult"
                  : "nativeClinical.correct",
        )}
      </ClinicalHeading>
      {send.issue !== "denied" && (
        <>
          {current ? (
            <>
              <ClinicalEntry record={current} styles={styles} />
              <Text style={styles.support}>
                {t(op === "review" ? "nativeClinical.reviewHint" : "nativeClinical.correctionHint")}
              </Text>
            </>
          ) : (
            <>
              <Action
                styles={styles}
                disabled={locked}
                label={
                  encounter
                    ? t("nativeClinical.encounter") + " · " + encounter.reason
                    : t("nativeClinical.selectEncounter")
                }
                onPress={() => setChoose(true)}
              />
              <ClinicalHeading styles={styles}>{t("nativeClinical.kind")}</ClinicalHeading>
              <View style={styles.actions}>
                {kinds.map((k) => (
                  <Action
                    key={k}
                    styles={styles}
                    disabled={locked}
                    role="radio"
                    selected={kind === k}
                    label={t(`nativeClinical.${k}`)}
                    onPress={() => {
                      if (k !== kind) {
                        setKind(k);
                        setValues({});
                      }
                    }}
                  />
                ))}
              </View>
            </>
          )}
          {kind === "hospitalization" && op === "new" && (
            <Text style={styles.support}>{t("nativeClinical.activeAdmission")}</Text>
          )}
          {isEpisode(kind) && <Text style={styles.support}>{t("nativeClinical.signature")}</Text>}
          {op !== "review" && (
            <>
              <Field
                styles={styles}
                disabled={locked || op === "amend"}
                identifier
                label={t("nativeClinical.occurredAt", {
                  zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                })}
                value={when}
                onChange={setWhen}
                maxLength={16}
              />
              <Text style={styles.support}>
                {t("nativeCare.timeHelp", {
                  zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                })}
              </Text>
              {isEpisode(kind) &&
                op !== "amend" &&
                current &&
                eventTime &&
                Date.parse(eventTime) < Date.parse(current.occurredAt) && (
                  <Text accessibilityRole="alert" style={styles.error}>
                    {t("nativeClinical.eventOrder")}
                  </Text>
                )}
              {clinicalFields(kind, op, current).map((k) => (
                <Field
                  key={k}
                  styles={styles}
                  label={
                    t(
                      `nativeClinical.${kind === "surgery" && k === "notes" ? "surgeryNotes" : k}`,
                    ) + (k === "nextDueDate" ? " (YYYY-MM-DD)" : "")
                  }
                  disabled={locked}
                  maxLength={limits[k]}
                  identifier={
                    k === "scheduledAt" || k === "nextDueDate" || k === "code" || k === "lotNumber"
                  }
                  multiline={limits[k] === 8000}
                  value={values[k] ?? ""}
                  onChange={(v) => setValues((prev) => ({ ...prev, [k]: v }))}
                />
              ))}
            </>
          )}
          {current && (
            <Field
              styles={styles}
              label={t("nativeClinical.changeReason")}
              disabled={locked}
              value={reason}
              onChange={setReason}
              maxLength={500}
            />
          )}
        </>
      )}
      <SubmitClinical
        styles={styles}
        state={send}
        valid={!!body}
        label={t(
          isEpisode(kind)
            ? `nativeClinical.${episodeActionLabel(kind, op)}`
            : op === "review"
              ? "nativeClinical.reviewConfirm"
              : current
                ? "nativeClinical.saveVersion"
                : "nativeClinical.save",
        )}
        submit={() => send.submit(body)}
        refresh={back}
      />
    </View>
  );
}
