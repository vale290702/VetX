import { Activity, useCallback, useEffect, useState } from "react";
import { AppState, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { PatientDocuments } from "./medical-documents";
import { Appointments } from "./appointments";
import { PatientEncounters } from "./clinical-notes";
import { startCodeExpiry } from "./code-expiry";
import { Action, Field } from "./controls";
import { PatientForm, type ClinicPatientProps } from "./patient-form";
import {
  PatientNotice,
  PatientReadState,
  usePatientAction,
  usePatientRead,
} from "./patient-controls";
import type { Guardian, PatientSummary } from "./patients";

type Editor =
  | { kind: "patient"; patient: PatientSummary }
  | { kind: "guardian"; id: string; name: string; email: string }
  | { kind: "remove"; guardian: Guardian }
  | { kind: "invite"; guardian: Guardian; requestId: string };

export function PatientDetail({
  patientId,
  back,
  ...props
}: ClinicPatientProps & { patientId: string; back: () => void }) {
  const { account, scope, client, styles } = props;
  const { t, i18n } = useTranslation();
  const load = useCallback(() => client.detail(scope, patientId), [client, scope, patientId]);
  const { result, reload } = usePatientRead(load);
  const action = usePatientAction(account);
  const [care, setCare] = useState<"notes" | "appointments" | "documents">();
  const [edit, setEdit] = useState<Editor>();
  const [issued, setIssued] = useState<{
    guardianId: string;
    email: string;
    code: string;
    expiresAt: string;
  }>();
  useEffect(() => {
    if (!issued) return;
    const expiry = startCodeExpiry(issued.expiresAt, () =>
      setIssued((current) => (current === issued ? undefined : current)),
    );
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") expiry.check();
    });
    return () => {
      subscription.remove();
      expiry.stop();
    };
  }, [issued]);
  const [saved, setSaved] = useState(false);
  function close(saved = false) {
    action.clear();
    setEdit(undefined);
    setIssued(undefined);
    setSaved(saved);
    reload();
  }
  function begin(edit: Editor) {
    action.clear();
    setIssued(undefined);
    setSaved(false);
    setEdit(edit);
  }
  const record = result && "value" in result ? result.value : undefined;
  const issuedTo =
    issued && Date.parse(issued.expiresAt) > Date.now()
      ? record?.guardians.find(
          (g) => g.id === issued.guardianId && g.email === issued.email && !g.linked,
        )
      : undefined;
  const intended =
    edit?.kind === "invite" || edit?.kind === "remove"
      ? record?.guardians.find((g) => g.id === edit.guardian.id && g.email === edit.guardian.email)
      : undefined;
  if (care) {
    const backToPatient = () => {
      setCare(undefined);
      reload();
    };
    return (
      <View style={styles.section}>
        {!record && (
          <PatientReadState
            styles={styles}
            retry={reload}
            error={result && "error" in result ? result.error : undefined}
          />
        )}
        {result && "error" in result ? (
          <Action styles={styles} label={t("nativeCare.backPatient")} onPress={backToPatient} />
        ) : (
          <Activity mode={record ? "visible" : "hidden"}>
            <Text accessibilityRole="header" style={styles.heading}>
              {record?.patient.name}
            </Text>
            {care === "documents" ? (
              <PatientDocuments {...props} patientId={patientId} back={backToPatient} />
            ) : care === "notes" ? (
              <PatientEncounters
                {...props}
                patientId={patientId}
                guardians={record?.guardians ?? []}
                refreshGuardians={reload}
                back={backToPatient}
              />
            ) : (
              <Appointments
                {...props}
                patient={{ id: patientId, name: record?.patient.name ?? "" }}
                back={backToPatient}
              />
            )}
          </Activity>
        )}
      </View>
    );
  }
  return (
    <View style={styles.section}>
      {!edit && (
        <View style={styles.actions}>
          <Action styles={styles} label={t("nativePatients.backPatients")} onPress={back} />
        </View>
      )}
      {edit?.kind === "patient" ? (
        <>
          {!record && (
            <>
              <PatientReadState
                styles={styles}
                retry={reload}
                error={result && "error" in result ? result.error : undefined}
              />
              {result && (
                <Action styles={styles} label={t("nativePatients.backPatients")} onPress={back} />
              )}
            </>
          )}
          <Activity mode={record ? "visible" : "hidden"}>
            <PatientForm
              {...props}
              patient={edit.patient}
              cancel={() => close()}
              saved={() => close(true)}
            />
          </Activity>
        </>
      ) : !record ? (
        <>
          <PatientReadState
            styles={styles}
            retry={reload}
            error={result && "error" in result ? result.error : undefined}
          />
          {edit && (
            <Action styles={styles} label={t("nativePatients.backPatients")} onPress={back} />
          )}
        </>
      ) : (
        <>
          <Text accessibilityRole="header" style={styles.heading}>
            {record.patient.name}
          </Text>
          <Text style={styles.support}>
            {record.patient.species}
            {record.patient.birthDate && " · " + record.patient.birthDate}
          </Text>
          {saved && (
            <Text accessibilityLiveRegion="polite" style={styles.support}>
              {t("directory.saved")}
            </Text>
          )}
          {!edit ? (
            <>
              <View style={styles.actions}>
                <Action
                  styles={styles}
                  label={t("nativeCare.history")}
                  onPress={() => {
                    setIssued(undefined);
                    setCare("notes");
                  }}
                />
                <Action
                  styles={styles}
                  label={t("nativeCare.appointments")}
                  onPress={() => {
                    setIssued(undefined);
                    setCare("appointments");
                  }}
                />
                <Action
                  styles={styles}
                  label={t("nativeDocuments.records")}
                  onPress={() => {
                    setIssued(undefined);
                    setCare("documents");
                  }}
                />
                <Action
                  styles={styles}
                  label={t("nativePatients.editPatient")}
                  onPress={() => begin({ kind: "patient", patient: record.patient })}
                />
              </View>
              <Text accessibilityRole="header" style={styles.heading}>
                {t("nativePatients.guardians")}
              </Text>
              {record.guardians.length === 0 && (
                <Text style={styles.support}>{t("nativePatients.emptyGuardians")}</Text>
              )}
              {record.guardians.map((g) => (
                <View key={g.id} style={styles.row}>
                  <Text style={styles.heading}>{g.name}</Text>
                  <Text selectable style={styles.support}>
                    {g.email}
                  </Text>
                  <Text style={styles.support}>
                    {t(g.linked ? "nativePatients.linked" : "nativePatients.unlinked")}
                  </Text>
                  {issued && issuedTo?.id === g.id && (
                    <View style={styles.section}>
                      <Text style={styles.heading}>{t("nativePatients.code")}</Text>
                      <Text selectable style={styles.heading}>
                        {issued.code}
                      </Text>
                      <Text style={styles.support}>
                        {t("nativePatients.expires", {
                          time: new Date(issued.expiresAt).toLocaleString(i18n.language),
                        })}
                      </Text>
                      <View style={styles.actions}>
                        <Action
                          styles={styles}
                          label={t("nativePatients.hideCode")}
                          onPress={() => setIssued(undefined)}
                        />
                      </View>
                    </View>
                  )}
                  <View style={styles.actions}>
                    {!g.linked && (
                      <Action
                        styles={styles}
                        label={t("nativePatients.issueCode")}
                        accessibilityLabel={t("nativePatients.codeFor", { name: g.name })}
                        onPress={() =>
                          begin({
                            kind: "invite",
                            guardian: g,
                            requestId: globalThis.expo.uuidv4(),
                          })
                        }
                      />
                    )}
                    <Action
                      styles={styles}
                      destructive
                      label={t("nativePatients.removeGuardian")}
                      accessibilityLabel={t("nativePatients.removeNamed", { name: g.name })}
                      onPress={() => begin({ kind: "remove", guardian: g })}
                    />
                  </View>
                </View>
              ))}
              <View style={styles.actions}>
                <Action
                  styles={styles}
                  primary
                  label={t("nativePatients.addGuardian")}
                  onPress={() =>
                    begin({ kind: "guardian", id: globalThis.expo.uuidv4(), name: "", email: "" })
                  }
                />
              </View>
            </>
          ) : (
            <>
              {edit.kind === "guardian" ? (
                <>
                  <Text accessibilityRole="header" style={styles.heading}>
                    {t("nativePatients.addGuardian")}
                  </Text>
                  <Field
                    styles={styles}
                    disabled={action.busy}
                    label={t("nativePatients.guardianName")}
                    value={edit.name}
                    maxLength={120}
                    onChange={(name) => setEdit({ ...edit, name })}
                  />
                  <Field
                    styles={styles}
                    disabled={action.busy}
                    identifier
                    inputMode="email"
                    label={t("nativePatients.guardianEmail")}
                    value={edit.email}
                    maxLength={254}
                    onChange={(email) => setEdit({ ...edit, email })}
                  />
                  <Text style={styles.support}>{t("nativePatients.guardianHelp")}</Text>
                </>
              ) : (
                <Text
                  accessibilityRole={edit.kind === "remove" ? "alert" : "header"}
                  style={styles.heading}
                >
                  {t(
                    edit.kind === "remove"
                      ? "nativePatients.removeConfirm"
                      : "nativePatients.issueConfirm",
                    {
                      name: edit.guardian.name,
                      email: edit.guardian.email,
                      patient: record.patient.name,
                    },
                  )}
                </Text>
              )}
              <PatientNotice styles={styles} error={action.error} />
              <View style={styles.actions}>
                {edit.kind === "guardian" ? (
                  <Action
                    styles={styles}
                    primary
                    busy={action.busy}
                    disabled={!edit.name.trim() || !edit.email.trim()}
                    label={t("nativePatients.addGuardian")}
                    onPress={() =>
                      void action.run(
                        () =>
                          client.saveGuardian(scope, patientId, edit.id, {
                            name: edit.name.trim(),
                            email: edit.email.trim(),
                          }),
                        () => close(true),
                      )
                    }
                  />
                ) : edit.kind === "remove" ? (
                  <Action
                    styles={styles}
                    destructive
                    busy={action.busy}
                    disabled={!intended}
                    label={t("nativePatients.removeGuardian")}
                    onPress={() =>
                      void action.run(
                        () => client.removeGuardian(scope, patientId, edit.guardian.id),
                        () => close(true),
                      )
                    }
                  />
                ) : (
                  <Action
                    styles={styles}
                    primary
                    busy={action.busy}
                    disabled={!intended || intended.linked}
                    label={t("nativePatients.issueCode")}
                    onPress={() =>
                      void action.run(
                        () => client.issue(scope, patientId, edit.guardian.id, edit.requestId),
                        (value) => {
                          setIssued({
                            guardianId: edit.guardian.id,
                            email: edit.guardian.email,
                            ...value,
                          });
                          setEdit(undefined);
                        },
                      )
                    }
                  />
                )}
                <Action
                  styles={styles}
                  disabled={action.busy}
                  label={t("directory.cancel")}
                  onPress={() => close()}
                />
              </View>
            </>
          )}
        </>
      )}
    </View>
  );
}
