import { useRef, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Action, type AccessStyles } from "./controls";
import { usePatientAction, PatientNotice } from "./patient-controls";
import { inventoryWrite } from "./inventory-client";
import type { MobileAccount } from "./session";
import {
  clinicalFields,
  labData,
  type ReleasedRecord,
  type StaffRecord,
  type Values,
} from "./clinical-record-forms";

export function useClinicalWrite<T, R>(
  account: MobileAccount,
  save: (id: string, b: T) => Promise<R>,
  done: (row: R) => void,
) {
  const action = usePatientAction(account),
    saved = useRef<{ id: string; body: T } | undefined>(undefined),
    [pending, setPending] = useState(false),
    [issue, setIssue] = useState<"denied" | "invalid" | "conflict">();
  function submit(body: T | undefined) {
    if (action.busy || (!body && !saved.current) || issue === "conflict" || issue === "denied")
      return;
    const attempt = saved.current ?? { id: globalThis.expo.uuidv4(), body: body! };
    saved.current = attempt;
    setPending(true);
    setIssue(undefined);
    void action.run(
      () => inventoryWrite(() => save(attempt.id, attempt.body)),
      (result) => {
        saved.current = undefined;
        setPending(false);
        if (result.issue) {
          setIssue(result.issue);
          return;
        }
        done(result.value);
      },
    );
  }
  return { pending, busy: action.busy, error: action.error, issue, submit };
}
export function SubmitClinical({
  styles,
  state,
  label,
  valid,
  submit,
  refresh,
}: {
  styles: AccessStyles;
  state: {
    pending: boolean;
    busy: boolean;
    error: ReturnType<typeof usePatientAction>["error"];
    issue?: "denied" | "conflict" | "invalid";
  };
  label: string;
  valid: boolean;
  submit: () => void;
  refresh: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <PatientNotice styles={styles} error={state.error} />
      {state.pending && !state.busy && (
        <Text accessibilityRole="alert" style={styles.support}>
          {t("nativeClinical.uncertain")}
        </Text>
      )}
      {state.issue && (
        <Text accessibilityRole="alert" style={styles.error}>
          {t(`nativeClinical.${state.issue}`)}
        </Text>
      )}
      {state.issue === "denied" || state.issue === "conflict" ? (
        <Action styles={styles} label={t("nativeClinical.refresh")} onPress={refresh} />
      ) : (
        <Action
          styles={styles}
          primary
          busy={state.busy}
          disabled={!valid && !state.pending}
          label={state.pending ? t("nativeClinical.retry") : label}
          onPress={submit}
        />
      )}
    </>
  );
}
export function ClinicalHeading({
  styles,
  children,
}: {
  styles: AccessStyles;
  children: ReactNode;
}) {
  return (
    <Text style={styles.heading} accessibilityRole="header">
      {children}
    </Text>
  );
}
export function ClinicalEntry({
  record,
  styles,
  refs = false,
}: {
  record: StaffRecord | ReleasedRecord;
  styles: AccessStyles;
  refs?: boolean;
}) {
  const { t, i18n } = useTranslation(),
    [expanded, setExpanded] = useState(false),
    data: Values = record.data,
    status = labData(record)?.status;
  const local = (v: string) => new Date(v).toLocaleString(i18n.language);
  return (
    <View style={styles.row}>
      <ClinicalHeading styles={styles}>
        {t(`nativeClinical.${record.kind}`) + (status ? " · " + t(`nativeClinical.${status}`) : "")}
      </ClinicalHeading>
      <Text style={styles.support}>
        {t("nativeClinical.version", { n: record.revision }) + " · " + local(record.occurredAt)}
      </Text>
      {"clinicName" in record && (
        <Text style={styles.support}>{record.clinicName + " · " + record.organizationName}</Text>
      )}
      {clinicalFields(record.kind, "show").map((k) => {
        const v = data[k];
        return v ? (
          <View key={k}>
            <Text style={styles.heading}>{t(`nativeClinical.${k}`)}</Text>
            <Text selectable style={styles.support}>
              {k === "nextDueDate"
                ? new Date(v + "T12:00:00Z").toLocaleDateString(i18n.language, { timeZone: "UTC" })
                : v}
            </Text>
          </View>
        ) : null;
      })}
      {"author" in record && (
        <>
          <Text style={styles.support}>
            {t(
              status === "REVIEWED" ? "nativeClinical.resultReviewedBy" : "nativeClinical.recorded",
              { name: record.author.subject, when: local(record.recordedAt) },
            )}
          </Text>
          {record.changeReason && (
            <Text style={styles.support}>
              {t("nativeClinical.changeReason") + " · " + record.changeReason}
            </Text>
          )}
          {refs && (
            <>
              <Action
                styles={styles}
                label={t("nativeClinical.reference")}
                expanded={expanded}
                onPress={() => setExpanded(!expanded)}
              />
              {expanded &&
                (
                  [
                    ["recordId", record.id],
                    ["revisionId", record.revisionId],
                    ["encounterId", record.encounterId],
                    ["issuer", record.author.issuer],
                  ] as const
                ).map(([key, value]) => (
                  <Text key={key} selectable style={styles.support}>
                    {t(`nativeClinical.${key}`) + " · " + value}
                  </Text>
                ))}
            </>
          )}
        </>
      )}
    </View>
  );
}
