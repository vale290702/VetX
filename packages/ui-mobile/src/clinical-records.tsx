import { Activity, useCallback, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Action, type AccessStyles } from "./controls";
import type { ClinicPatientProps } from "./patient-form";
import type { MobileAccount } from "./session";
import type { Guardian, PatientClient } from "./patients";
import { Pager, PatientReadState, usePatientRead } from "./patient-controls";
import {
  canRelease,
  clinicalSharing,
  labData,
  type ClinicalShare,
  type StaffRecord,
  type Operation,
} from "./clinical-record-forms";
import {
  ClinicalHeading,
  ClinicalEntry,
  SubmitClinical,
  useClinicalWrite,
} from "./clinical-record-controls";
import { ClinicalEditor } from "./clinical-record-editor";
type Props = ClinicPatientProps & { patientId: string; back: () => void; openNotes: () => void };
type Screen =
  { op: Operation; current?: StaffRecord } | { op: "share" | "history"; current: StaffRecord };
export function ClinicalRecords(props: Props) {
  const { t } = useTranslation(),
    { styles, scope, patientId, client } = props,
    [page, setPage] = useState(1),
    [screen, setScreen] = useState<Screen>();
  const { result, reload } = usePatientRead(
    useCallback(
      () => client.clinical.list(scope, patientId, page),
      [client, scope, patientId, page],
    ),
  );
  function back() {
    setScreen(undefined);
    reload();
  }
  if (screen?.op === "history")
    return <ClinicalHistory {...props} id={screen.current.id} back={back} />;
  if (screen?.op === "share")
    return <ClinicalAccess {...props} id={screen.current.id} back={back} />;
  if (screen)
    return <ClinicalEditor {...props} op={screen.op} current={screen.current} back={back} />;
  return (
    <View style={styles.section}>
      <Action styles={styles} label={t("nativeCare.backPatient")} onPress={props.back} />
      <ClinicalHeading styles={styles}>{t("nativeClinical.title")}</ClinicalHeading>
      {!result || "error" in result ? (
        <PatientReadState styles={styles} retry={reload} error={result?.error} />
      ) : (
        <>
          <View style={styles.actions}>
            <Action
              styles={styles}
              primary
              label={t("nativeClinical.new")}
              onPress={() => setScreen({ op: "new" })}
            />
            <Action styles={styles} label={t("nativeClinical.refresh")} onPress={reload} />
          </View>
          {!result.value.records.length && (
            <Text style={styles.support}>{t("nativeClinical.empty")}</Text>
          )}
          {result.value.records.map((r) => {
            const status = labData(r)?.status;
            return (
              <View key={r.id} style={styles.row}>
                <ClinicalEntry record={r} styles={styles} refs />
                <View style={styles.actions}>
                  <Action
                    styles={styles}
                    label={t("nativeClinical.openHistory")}
                    onPress={() => setScreen({ op: "history", current: r })}
                  />
                  {(!status || status === "ORDERED") && (
                    <Action
                      styles={styles}
                      label={t(
                        status ? "nativeClinical.orderCorrection" : "nativeClinical.correct",
                      )}
                      onPress={() => setScreen({ op: "correct", current: r })}
                    />
                  )}
                  {status && (
                    <Action
                      styles={styles}
                      label={t(
                        status === "ORDERED"
                          ? "nativeClinical.enterResult"
                          : "nativeClinical.correctResult",
                      )}
                      onPress={() => setScreen({ op: "result", current: r })}
                    />
                  )}
                  {status === "RESULTED" && (
                    <Action
                      styles={styles}
                      label={t("nativeClinical.review")}
                      onPress={() => setScreen({ op: "review", current: r })}
                    />
                  )}
                  {canRelease(r) && (
                    <Action
                      styles={styles}
                      label={t("nativeClinical.sharing")}
                      onPress={() => setScreen({ op: "share", current: r })}
                    />
                  )}
                </View>
                <Text style={styles.support}>
                  {!canRelease(r)
                    ? t("nativeClinical.labPrivate")
                    : r.sharing.guardianIds.length
                      ? t("nativeClinical.recipientCount", { count: r.sharing.guardianIds.length })
                      : t("nativeClinical.private")}
                </Text>
              </View>
            );
          })}
          <Pager styles={styles} page={page} next={result.value.hasNextPage} change={setPage} />
        </>
      )}
    </View>
  );
}
function ClinicalHistory({ styles, client, scope, patientId, id, back }: Props & { id: string }) {
  const { t } = useTranslation(),
    [page, setPage] = useState(1);
  const { result, reload } = usePatientRead(
    useCallback(
      () => client.clinical.history(scope, patientId, id, page),
      [client, scope, patientId, id, page],
    ),
  );
  return (
    <View style={styles.section}>
      <Action styles={styles} label={t("nativeClinical.all")} onPress={back} />
      <ClinicalHeading styles={styles}>{t("nativeClinical.history")}</ClinicalHeading>
      {!result || "error" in result ? (
        <PatientReadState styles={styles} error={result?.error} retry={reload} />
      ) : (
        <>
          <Action styles={styles} label={t("nativeClinical.refresh")} onPress={reload} />
          {!result.value.records.length && (
            <Text style={styles.support}>{t("nativeClinical.emptyPage")}</Text>
          )}
          {result.value.records.map((r) => (
            <ClinicalEntry key={r.revisionId} styles={styles} record={r} refs />
          ))}
          <Pager styles={styles} page={page} next={result.value.hasNextPage} change={setPage} />
        </>
      )}
    </View>
  );
}
function ClinicalAccess(props: Props & { id: string }) {
  const { t } = useTranslation(),
    { styles, client, scope, patientId, id, back } = props;
  const { result, reload } = usePatientRead(
    useCallback(async () => {
      const [history, detail] = await Promise.all([
        client.clinical.history(scope, patientId, id, 1),
        client.detail(scope, patientId),
      ]);
      return { current: history.records[0], guardians: detail.guardians };
    }, [scope, client, patientId, id]),
  );
  const valid = result && "value" in result ? result.value : undefined;
  const [previous, setPrevious] = useState<typeof valid>();
  const [refreshVersion, setRefreshVersion] = useState(0);
  function refresh() {
    setRefreshVersion((v) => v + 1);
    reload();
  }
  if (previous && result && "error" in result && result.error === "denied") setPrevious(undefined);
  if (valid && previous !== valid) setPrevious(valid);
  const snapshot = valid ?? previous;
  if ((result && "error" in result) || !snapshot?.current)
    return (
      <View style={styles.section}>
        <Action styles={styles} label={t("nativeClinical.all")} onPress={back} />
        <PatientReadState
          styles={styles}
          error={result && "error" in result ? result.error : valid ? "denied" : undefined}
          retry={reload}
        />
      </View>
    );
  const { current, guardians } = snapshot;
  const key = JSON.stringify([
    refreshVersion,
    current.revisionId,
    current.sharing,
    guardians.map((g) => [g.id, g.linked]),
  ]);
  return (
    <>
      {!valid && <PatientReadState styles={styles} retry={reload} />}
      <Activity mode={valid ? "visible" : "hidden"}>
        <ShareForm {...props} key={key} current={current} guardians={guardians} reload={refresh} />
      </Activity>
    </>
  );
}
function ShareForm(
  props: Props & { current: StaffRecord; guardians: Guardian[]; reload: () => void },
) {
  const { t } = useTranslation(),
    { styles, current, guardians, scope, client, account, patientId, back, reload } = props;
  const [selected, setSelected] = useState(current.sharing.guardianIds);
  const send = useClinicalWrite<ClinicalShare, StaffRecord["sharing"]>(
    account,
    (_id, b) => client.clinical.share(scope, patientId, current.id, b),
    back,
  );
  const change = clinicalSharing(current, guardians, selected),
    linked = guardians.filter((g) => g.linked);
  return (
    <View style={styles.section}>
      <Action
        styles={styles}
        label={t("nativeClinical.all")}
        disabled={send.pending}
        onPress={back}
      />
      <ClinicalHeading styles={styles}>{t("nativeClinical.sharing")}</ClinicalHeading>
      {send.issue !== "denied" && (
        <>
          <ClinicalEntry styles={styles} record={current} />
          {canRelease(current) ? (
            <>
              <Text style={styles.support}>{t("nativeClinical.sharingHint")}</Text>
              {!linked.length && (
                <Text style={styles.support}>{t("nativeClinical.noGuardians")}</Text>
              )}
              {current.sharing.guardianIds.some((id) => !linked.some((g) => g.id === id)) && (
                <Text style={styles.support}>{t("nativeClinical.staleGuardians")}</Text>
              )}
              {linked.map((g) => (
                <Action
                  styles={styles}
                  key={g.id}
                  role="checkbox"
                  disabled={send.pending}
                  selected={selected.includes(g.id)}
                  label={g.name + " · " + g.email}
                  onPress={() =>
                    setSelected((ids) =>
                      ids.includes(g.id) ? ids.filter((i) => i !== g.id) : [...ids, g.id],
                    )
                  }
                />
              ))}
            </>
          ) : (
            <Text style={styles.support}>{t("nativeClinical.labPrivate")}</Text>
          )}
        </>
      )}
      <Action
        styles={styles}
        disabled={send.pending}
        label={t("nativeCare.refreshGuardians")}
        onPress={reload}
      />
      <SubmitClinical
        styles={styles}
        state={send}
        valid={!!change}
        label={t("nativeClinical.saveAccess")}
        submit={() => send.submit(change)}
        refresh={reload}
      />
    </View>
  );
}
export function ReleasedClinical({
  account,
  client,
  styles,
  pet,
  back,
}: {
  account: MobileAccount;
  client: PatientClient;
  styles: AccessStyles;
  pet: { id: string; name: string };
  back: () => void;
}) {
  const { t } = useTranslation(),
    [page, setPage] = useState(1);
  const { result, reload } = usePatientRead(
    useCallback(
      () => client.clinical.released(account.subject, pet.id, page),
      [account, client, pet.id, page],
    ),
  );
  return (
    <View style={styles.section}>
      <Action styles={styles} label={t("nativeCare.backPets")} onPress={back} />
      <ClinicalHeading styles={styles}>
        {t("nativeClinical.patientHeading", { patient: pet.name })}
      </ClinicalHeading>
      {!result || "error" in result ? (
        <PatientReadState styles={styles} error={result?.error} retry={reload} />
      ) : (
        <>
          <Action styles={styles} label={t("nativeClinical.refresh")} onPress={reload} />
          {!result.value.records.length && (
            <Text style={styles.support}>{t("nativeClinical.noneReleased")}</Text>
          )}
          {result.value.records.map((r) => (
            <ClinicalEntry key={r.revisionId} record={r} styles={styles} />
          ))}
          <Pager styles={styles} page={page} next={result.value.hasNextPage} change={setPage} />
        </>
      )}
    </View>
  );
}
