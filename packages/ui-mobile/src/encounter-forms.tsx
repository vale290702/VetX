import { useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import type { StaffNote } from "./care-client";
import { encounterBody, sharingChange } from "./care-forms";
import { localMinute, minuteInstant } from "./care-time";
import { Action, Field } from "./controls";
import { PatientNotice, usePatientAction } from "./patient-controls";
import type { ClinicPatientProps } from "./patient-form";
import type { Guardian } from "./patients";

type Props = ClinicPatientProps & { patientId: string; close: (saved?: boolean) => void };
export function EditEncounter({
  account,
  client,
  scope,
  styles,
  patientId,
  id,
  parent,
  close,
}: Props & { id: string; parent?: StaffNote }) {
  const { t } = useTranslation();
  const [when, setWhen] = useState(() => localMinute());
  const [reason, setReason] = useState("");
  const [fields, setFields] = useState({ subjective: "", objective: "", assessment: "", plan: "" });
  const action = usePatientAction(account);
  const occurredAt = minuteInstant(when);
  const body = encounterBody(occurredAt, reason, fields, parent?.id);
  function submit() {
    if (!body) return;
    void action.run(
      () => client.care.append(scope, patientId, id, body),
      () => close(true),
    );
  }
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.heading}>
        {parent ? t("nativeCare.addendumFor", { reason: parent.reason }) : t("nativeCare.newNote")}
      </Text>
      <Text style={styles.support}>{t("nativeCare.noteHelp")}</Text>
      <Field
        styles={styles}
        disabled={action.busy}
        identifier
        label={t("nativeCare.encounterTime")}
        value={when}
        onChange={setWhen}
        maxLength={16}
      />
      <Text style={styles.support}>
        {t("nativeCare.timeHelp", { zone: Intl.DateTimeFormat().resolvedOptions().timeZone })}
      </Text>
      {when && !occurredAt ? <Text style={styles.error}>{t("nativeCare.invalidTime")}</Text> : null}
      <Field
        styles={styles}
        disabled={action.busy}
        label={t("nativeCare.reason")}
        value={reason}
        onChange={setReason}
        maxLength={250}
      />
      {(["subjective", "objective", "assessment", "plan"] as const).map((section) => (
        <Field
          key={section}
          styles={styles}
          disabled={action.busy}
          multiline
          label={t(`nativeCare.${section}`)}
          value={fields[section]}
          maxLength={8000}
          onChange={(value) => setFields((previous) => ({ ...previous, [section]: value }))}
        />
      ))}
      <PatientNotice error={action.error} styles={styles} />
      <View style={styles.actions}>
        <Action
          styles={styles}
          label={t("nativeCare.saveNote")}
          primary
          disabled={!body || action.error === "conflict" || action.error === "denied"}
          busy={action.busy}
          onPress={submit}
        />
        <Action
          styles={styles}
          label={t("directory.cancel")}
          disabled={action.busy}
          onPress={() => close()}
        />
      </View>
    </View>
  );
}

export function ShareEncounter({
  account,
  client,
  scope,
  styles,
  patientId,
  entry,
  guardians,
  refreshGuardians,
  close,
}: Props & { entry: StaffNote; guardians: Guardian[]; refreshGuardians: () => void }) {
  const { t } = useTranslation();
  const action = usePatientAction(account);
  const linked = guardians.filter((g) => g.linked);
  const [selected, setSelected] = useState(entry.sharing.guardianIds);
  const change = sharingChange(entry.sharing, guardians, selected);
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.heading}>
        {t("nativeCare.accessFor", { reason: entry.reason })}
      </Text>
      <Text style={styles.support}>{t("nativeCare.shareHelp")}</Text>
      <View style={styles.actions}>
        <Action
          styles={styles}
          label={t("nativeCare.refreshGuardians")}
          disabled={action.busy}
          onPress={refreshGuardians}
        />
      </View>
      {!linked.length && <Text style={styles.support}>{t("nativeCare.noLinked")}</Text>}
      {linked.map((g) => (
        <Action
          key={g.id}
          styles={styles}
          disabled={action.busy}
          role="checkbox"
          selected={selected.includes(g.id)}
          label={g.name + " · " + g.email}
          onPress={() =>
            setSelected((prev) =>
              prev.includes(g.id) ? prev.filter((id) => id !== g.id) : [...prev, g.id],
            )
          }
        />
      ))}
      <PatientNotice error={action.error} styles={styles} />
      <View style={styles.actions}>
        <Action
          styles={styles}
          primary
          label={t("nativeCare.saveAccess")}
          busy={action.busy}
          disabled={!change || action.error === "conflict" || action.error === "denied"}
          onPress={() => {
            if (change)
              void action.run(
                () => client.care.share(scope, patientId, entry.id, change),
                () => close(true),
              );
          }}
        />
        <Action
          styles={styles}
          label={t("directory.cancel")}
          disabled={action.busy}
          onPress={() => close()}
        />
      </View>
    </View>
  );
}
