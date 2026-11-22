import { useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Action, Field, type AccessStyles } from "./controls";
import { PatientNotice, usePatientAction } from "./patient-controls";
import {
  validBirthDate,
  type ClinicScope,
  type PatientClient,
  type PatientSummary,
} from "./patients";
import type { MobileAccount } from "./session";

export type ClinicPatientProps = {
  scope: ClinicScope;
  account: MobileAccount;
  client: PatientClient;
  styles: AccessStyles;
};
export function PatientForm({
  patient,
  account,
  scope,
  client,
  styles,
  cancel,
  saved,
}: ClinicPatientProps & {
  patient: PatientSummary;
  cancel: () => void;
  saved: (patient: PatientSummary) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(patient.name);
  const [species, setSpecies] = useState(patient.species);
  const [birthDate, setBirthDate] = useState(patient.birthDate ?? "");
  const action = usePatientAction(account);
  const dateValid = validBirthDate(birthDate.trim());
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.heading}>
        {t(patient.revision === 0 ? "nativePatients.register" : "nativePatients.editPatient")}
      </Text>
      <Field
        styles={styles}
        disabled={action.busy}
        label={t("nativePatients.patientName")}
        value={name}
        maxLength={120}
        onChange={setName}
      />
      <Field
        styles={styles}
        disabled={action.busy}
        label={t("nativePatients.species")}
        value={species}
        maxLength={80}
        onChange={setSpecies}
      />
      <Field
        styles={styles}
        disabled={action.busy}
        identifier
        label={t("nativePatients.birthDate")}
        value={birthDate}
        maxLength={10}
        onChange={setBirthDate}
      />
      {!dateValid && <Text style={styles.error}>{t("nativePatients.dateHelp")}</Text>}
      <PatientNotice styles={styles} error={action.error} />
      <View style={styles.actions}>
        <Action
          styles={styles}
          primary
          busy={action.busy}
          label={t("directory.save")}
          disabled={!dateValid || !name.trim() || !species.trim() || action.error === "conflict"}
          onPress={() =>
            void action.run(
              () =>
                client.save(scope, patient.id, {
                  name: name.trim(),
                  species: species.trim(),
                  birthDate: birthDate.trim() || null,
                  revision: patient.revision,
                }),
              saved,
            )
          }
        />
        <Action
          styles={styles}
          disabled={action.busy}
          label={t("directory.cancel")}
          onPress={cancel}
        />
      </View>
    </View>
  );
}
