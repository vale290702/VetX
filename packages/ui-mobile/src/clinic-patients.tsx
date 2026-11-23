import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Action, Field } from "./controls";
import { PatientReadState, usePatientRead } from "./patient-controls";
import { PatientForm, type ClinicPatientProps } from "./patient-form";
import { ClinicBilling } from "./billing";
import { ClinicInventory } from "./inventory";
import { ClinicReferrals } from "./referrals";
import { StaffExchange } from "./staff-exchange";
import { Appointments } from "./appointments";
import { PatientDetail } from "./patient-detail";

export function ClinicPatients({
  account,
  organizationId,
  admin,
  clinic,
  client,
  styles,
  back,
}: Omit<ClinicPatientProps, "scope"> & {
  organizationId: string;
  admin: boolean | undefined;
  clinic: { id: string; name: string };
  back: () => void;
}) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [clinicScreen, setClinicScreen] = useState<
    "calendar" | "import" | "referrals" | "inventory" | "billing"
  >();
  const [selected, setSelected] = useState<{ id: string; create?: boolean }>();
  const scope = useMemo(
    () => ({ subject: account.subject, organizationId, clinicId: clinic.id }),
    [account, organizationId, clinic.id],
  );
  const load = useCallback(() => client.list(scope, page, search), [client, scope, page, search]);
  const { result, reload } = usePatientRead(load);
  const props = { account, scope, client, styles };
  function list() {
    setSelected(undefined);
    reload();
  }
  if (clinicScreen === "billing")
    return (
      <View style={styles.section}>
        <Text accessibilityRole="header" style={styles.heading}>
          {clinic.name}
        </Text>
        <ClinicBilling {...props} admin={admin} back={() => setClinicScreen(undefined)} />
      </View>
    );
  if (clinicScreen === "inventory")
    return (
      <View style={styles.section}>
        <Text accessibilityRole="header" style={styles.heading}>
          {clinic.name}
        </Text>
        <ClinicInventory {...props} admin={admin} back={() => setClinicScreen(undefined)} />
      </View>
    );
  if (clinicScreen === "referrals")
    return (
      <View style={styles.section}>
        <Text accessibilityRole="header" style={styles.heading}>
          {clinic.name}
        </Text>
        <ClinicReferrals {...props} back={() => setClinicScreen(undefined)} />
      </View>
    );
  if (clinicScreen === "import")
    return (
      <View style={styles.section}>
        <Text accessibilityRole="header" style={styles.heading}>
          {clinic.name}
        </Text>
        <StaffExchange
          {...props}
          back={() => setClinicScreen(undefined)}
          openPatient={(id) => {
            setClinicScreen(undefined);
            setSelected({ id });
          }}
        />
      </View>
    );
  if (clinicScreen === "calendar")
    return (
      <View style={styles.section}>
        <Text accessibilityRole="header" style={styles.heading}>
          {clinic.name}
        </Text>
        <Appointments {...props} back={() => setClinicScreen(undefined)} />
      </View>
    );
  if (selected)
    return (
      <View style={styles.section}>
        <Text style={styles.heading}>{clinic.name}</Text>
        {selected.create ? (
          <PatientForm
            {...props}
            patient={{ id: selected.id, name: "", species: "", revision: 0, birthDate: null }}
            cancel={list}
            saved={(patient) => setSelected({ id: patient.id })}
          />
        ) : (
          <PatientDetail {...props} key={selected.id} patientId={selected.id} back={list} />
        )}
      </View>
    );
  return (
    <View style={styles.section}>
      <View style={styles.actions}>
        <Action styles={styles} label={t("nativePatients.backClinics")} onPress={back} />
        <Action
          styles={styles}
          label={t("nativeBilling.title")}
          onPress={() => setClinicScreen("billing")}
        />
        <Action
          styles={styles}
          label={t("nativeInventory.title")}
          onPress={() => setClinicScreen("inventory")}
        />
        <Action
          styles={styles}
          label={t("nativeReferrals.inbox")}
          onPress={() => setClinicScreen("referrals")}
        />
        <Action
          styles={styles}
          label={t("nativeExchange.import")}
          onPress={() => setClinicScreen("import")}
        />
        <Action
          styles={styles}
          label={t("nativeCare.calendar")}
          onPress={() => setClinicScreen("calendar")}
        />
      </View>
      <Text accessibilityRole="header" style={styles.heading}>
        {t("nativePatients.patientsIn", { clinic: clinic.name })}
      </Text>
      <Field
        styles={styles}
        disabled={false}
        label={t("nativePatients.searchLabel")}
        maxLength={120}
        value={filter}
        onChange={setFilter}
      />
      <View style={styles.actions}>
        <Action
          styles={styles}
          label={t("nativePatients.search")}
          onPress={() => {
            setSearch(filter.trim());
            setPage(1);
            reload();
          }}
        />
        <Action
          styles={styles}
          primary
          disabled={!result || "error" in result}
          label={t("nativePatients.register")}
          onPress={() => setSelected({ id: globalThis.expo.uuidv4(), create: true })}
        />
      </View>
      {!result || "error" in result ? (
        <PatientReadState styles={styles} retry={reload} error={result?.error} />
      ) : (
        <>
          {result.value.patients.length === 0 && (
            <Text style={styles.support}>{t("nativePatients.emptyPatients")}</Text>
          )}
          {result.value.patients.map((patient) => (
            <View key={patient.id} style={styles.row}>
              <Text style={styles.heading}>{patient.name}</Text>
              <Text style={styles.support}>{patient.species}</Text>
              <View style={styles.actions}>
                <Action
                  styles={styles}
                  label={t("nativePatients.openRecord")}
                  accessibilityLabel={t("nativePatients.openNamed", { name: patient.name })}
                  onPress={() => setSelected({ id: patient.id })}
                />
              </View>
            </View>
          ))}
          {(page > 1 || result.value.hasNextPage) && (
            <View style={styles.section}>
              <Text style={styles.support}>{t("directory.page", { page })}</Text>
              <View style={styles.actions}>
                {page > 1 && (
                  <Action
                    styles={styles}
                    label={t("directory.previous")}
                    onPress={() => setPage(page - 1)}
                  />
                )}
                {result.value.hasNextPage && (
                  <Action
                    styles={styles}
                    label={t("directory.next")}
                    onPress={() => setPage(page + 1)}
                  />
                )}
              </View>
            </View>
          )}
        </>
      )}
    </View>
  );
}
