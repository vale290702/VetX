import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Action, Field } from "./controls";
import {
  PatientNotice,
  PatientReadState,
  usePatientRead,
  usePatientAction,
} from "./patient-controls";
import type { ClinicPatientProps } from "./patient-form";
import { requestInput, recipientMatches, type Destination } from "./referral-forms";
import { updateReferral } from "./referral-client";
export function RequestReferral({
  account,
  styles,
  client,
  scope,
  patientId,
  requestId,
  close,
}: ClinicPatientProps & {
  patientId: string;
  requestId: string;
  close: (notice?: "saved" | "changed") => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState(""),
    [summary, setSummary] = useState(""),
    [query, setQuery] = useState("");
  const [dest, setDest] = useState<Destination>(),
    [guardian, setGuardian] = useState<string>();
  const load = useCallback(async () => {
    const [routes, record] = await Promise.all([
      client.referrals.destinations(scope),
      client.detail(scope, patientId),
    ]);
    return { routes: routes.destinations, guardians: record.guardians.filter((g) => g.linked) };
  }, [client, scope, patientId]);
  const { result, reload } = usePatientRead(load),
    action = usePatientAction(account);
  const options = result && "value" in result ? result.value : undefined;
  const body =
    options && requestInput(options.routes, options.guardians, dest, guardian, reason, summary);
  const current = options?.routes.find(
    (d) => d.clinicId === dest?.clinicId && d.organizationId === dest.organizationId,
  );
  const fixed = options?.guardians.find((g) => g.id === guardian);
  const matches = options?.routes.filter((d) => recipientMatches(d, query));
  return (
    <View style={styles.section}>
      <Action
        styles={styles}
        disabled={action.busy}
        label={t("nativeReferrals.backList")}
        onPress={() => close()}
      />
      <Text accessibilityRole="header" style={styles.heading}>
        {t("nativeReferrals.newRequest")}
      </Text>
      {!options ? (
        <PatientReadState
          styles={styles}
          error={result && "error" in result ? result.error : undefined}
          retry={reload}
        />
      ) : (
        <>
          <Text style={styles.support}>{t("nativeReferrals.requestHelp")}</Text>
          <Text accessibilityRole="header" style={styles.heading}>
            {t("nativeReferrals.guardian")}
          </Text>
          {!options.guardians.length && (
            <Text style={styles.support}>{t("nativeReferrals.noGuardian")}</Text>
          )}
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel={t("nativeReferrals.guardian")}
            style={styles.actions}
          >
            {options.guardians.map((g) => (
              <Action
                key={g.id}
                styles={styles}
                role="radio"
                selected={g.id === guardian}
                label={g.name + " · " + g.email}
                disabled={action.busy}
                onPress={() => setGuardian(g.id)}
              />
            ))}
          </View>
          <Text accessibilityRole="header" style={styles.heading}>
            {t("nativeReferrals.destination")}
          </Text>
          {!options.routes.length ? (
            <Text style={styles.support}>{t("nativeReferrals.noRoutes")}</Text>
          ) : (
            <>
              <Field
                styles={styles}
                label={t("nativeReferrals.searchDestination")}
                value={query}
                maxLength={120}
                onChange={setQuery}
                disabled={action.busy}
              />
              {!matches?.length && (
                <Text style={styles.support}>{t("nativeReferrals.noRouteMatch")}</Text>
              )}
              <View
                accessibilityRole="radiogroup"
                accessibilityLabel={t("nativeReferrals.destination")}
                style={styles.actions}
              >
                {matches?.map((d) => (
                  <Action
                    key={d.organizationId + ":" + d.clinicId}
                    styles={styles}
                    role="radio"
                    selected={current === d}
                    label={d.name}
                    disabled={action.busy}
                    onPress={() => setDest(d)}
                  />
                ))}
              </View>
            </>
          )}
          <Action
            styles={styles}
            disabled={action.busy}
            label={t("nativeReferrals.refreshOptions")}
            onPress={reload}
          />
          <Field
            styles={styles}
            label={t("nativeReferrals.reason")}
            value={reason}
            maxLength={250}
            onChange={setReason}
            disabled={action.busy}
          />
          <Field
            styles={styles}
            label={t("nativeReferrals.summaryLabel")}
            value={summary}
            maxLength={8000}
            onChange={setSummary}
            multiline
            disabled={action.busy}
          />
          {current && fixed && (
            <Text style={styles.support}>
              {t("nativeReferrals.reviewRequest", { guardian: fixed.name, clinic: current.name })}
            </Text>
          )}
          <PatientNotice styles={styles} error={action.error} />
          <Action
            styles={styles}
            primary
            label={t("nativeReferrals.send")}
            busy={action.busy}
            disabled={!body}
            onPress={() => {
              if (body)
                void action.run(
                  () =>
                    updateReferral(() =>
                      client.referrals.request(scope, patientId, requestId, body),
                    ),
                  close,
                );
            }}
          />
        </>
      )}
    </View>
  );
}
