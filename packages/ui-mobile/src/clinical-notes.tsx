import { useCallback, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Action, type AccessStyles } from "./controls";
import type { OwnerNote, StaffNote } from "./care-client";
import type { ClinicPatientProps } from "./patient-form";
import { Pager, PatientReadState, usePatientRead } from "./patient-controls";
import type { Guardian, PatientClient } from "./patients";
import type { MobileAccount } from "./session";
import { EditEncounter, ShareEncounter } from "./encounter-forms";

function EncounterRow({
  entry,
  styles,
  children,
  expanded,
  toggle,
}: {
  entry: StaffNote | OwnerNote;
  styles: AccessStyles;
  children?: ReactNode;
  expanded: boolean;
  toggle: () => void;
}) {
  const { t, i18n } = useTranslation();
  return (
    <View style={styles.row}>
      <Text accessibilityRole="header" style={styles.heading}>
        {entry.reason}
      </Text>
      {"clinicName" in entry && (
        <Text style={styles.support}>
          {entry.clinicName} · {entry.organizationName}
        </Text>
      )}
      <Text style={styles.support}>
        {t("nativeCare.occurred", {
          time: new Date(entry.occurredAt).toLocaleString(i18n.language),
        })}
      </Text>
      {entry.addendumTo && <Text style={styles.support}>{t("nativeCare.addendum")}</Text>}
      <View style={styles.actions}>
        <Action
          styles={styles}
          label={t(expanded ? "nativeCare.closeNote" : "nativeCare.readNote")}
          accessibilityLabel={t(expanded ? "nativeCare.closeNamed" : "nativeCare.readNamed", {
            reason: entry.reason,
          })}
          expanded={expanded}
          onPress={toggle}
        />
      </View>
      {expanded && (
        <>
          <Text style={styles.support}>
            {t("nativeCare.recorded", {
              time: new Date(entry.recordedAt).toLocaleString(i18n.language),
            })}
          </Text>
          <Text selectable style={styles.support}>
            {t("nativeCare.recordId", { id: entry.id })}
          </Text>
          {entry.addendumTo && (
            <Text selectable style={styles.support}>
              {t("nativeCare.parentId", { id: entry.addendumTo })}
            </Text>
          )}
          {"authorSubject" in entry && (
            <Text selectable style={styles.support}>
              {t("nativeCare.author", { id: entry.authorSubject })}
            </Text>
          )}
          {(["subjective", "objective", "assessment", "plan"] as const).map((section) =>
            entry[section] ? (
              <View style={styles.section} key={section}>
                <Text style={styles.heading}>{t(`nativeCare.${section}`)}</Text>
                <Text selectable style={styles.support}>
                  {entry[section]}
                </Text>
              </View>
            ) : null,
          )}
          {children}
        </>
      )}
    </View>
  );
}

type Editor =
  { kind: "append"; id: string; parent?: StaffNote } | { kind: "share"; entry: StaffNote };
export function PatientEncounters({
  patientId,
  guardians,
  refreshGuardians,
  back,
  ...props
}: ClinicPatientProps & {
  patientId: string;
  guardians: Guardian[];
  refreshGuardians: () => void;
  back: () => void;
}) {
  const { scope, client, styles } = props;
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string>();
  const [editor, setEditor] = useState<Editor>();
  const [saved, setSaved] = useState(false);
  const load = useCallback(
    () => client.care.encounters(scope, patientId, page),
    [client, scope, patientId, page],
  );
  const { result, reload } = usePatientRead(load);
  function close(success = false) {
    setEditor(undefined);
    setSaved(success);
    if (success) setPage(1);
    reload();
  }
  if (editor?.kind === "append")
    return (
      <EditEncounter
        {...props}
        patientId={patientId}
        id={editor.id}
        parent={editor.parent}
        close={close}
      />
    );
  if (editor?.kind === "share")
    return (
      <ShareEncounter
        {...props}
        patientId={patientId}
        entry={editor.entry}
        guardians={guardians}
        refreshGuardians={refreshGuardians}
        close={close}
      />
    );
  return (
    <View style={styles.section}>
      <View style={styles.actions}>
        <Action styles={styles} label={t("nativeCare.backPatient")} onPress={back} />
      </View>
      <Text accessibilityRole="header" style={styles.heading}>
        {t("nativeCare.history")}
      </Text>
      {saved && (
        <Text accessibilityLiveRegion="polite" style={styles.support}>
          {t("directory.saved")}
        </Text>
      )}
      {!result || "error" in result ? (
        <PatientReadState styles={styles} error={result?.error} retry={reload} />
      ) : (
        <>
          <View style={styles.actions}>
            <Action
              styles={styles}
              primary
              label={t("nativeCare.newNote")}
              onPress={() => setEditor({ kind: "append", id: globalThis.expo.uuidv4() })}
            />
          </View>
          {!result.value.encounters.length && (
            <Text style={styles.support}>{t("nativeCare.noNotes")}</Text>
          )}
          {result.value.encounters.map((entry) => (
            <EncounterRow
              key={entry.id}
              entry={entry}
              styles={styles}
              expanded={entry.id === expanded}
              toggle={() => setExpanded(entry.id === expanded ? undefined : entry.id)}
            >
              <Text style={styles.support}>
                {entry.sharing.guardianIds.length
                  ? t("nativeCare.sharedCount", { count: entry.sharing.guardianIds.length })
                  : t("nativeCare.private")}
              </Text>
              <View style={styles.actions}>
                <Action
                  styles={styles}
                  label={t("nativeCare.addAddendum")}
                  onPress={() =>
                    setEditor({ kind: "append", id: globalThis.expo.uuidv4(), parent: entry })
                  }
                />
                <Action
                  styles={styles}
                  label={t("nativeCare.manageAccess")}
                  onPress={() => setEditor({ kind: "share", entry })}
                />
              </View>
            </EncounterRow>
          ))}
          <Pager styles={styles} page={page} next={result.value.hasNextPage} change={setPage} />
        </>
      )}
    </View>
  );
}

export function ReleasedEncounters({
  account,
  pet,
  client,
  styles,
  back,
}: {
  account: MobileAccount;
  pet: { id: string; name: string };
  client: PatientClient;
  styles: AccessStyles;
  back: () => void;
}) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string>();
  const load = useCallback(
    () => client.care.released(account.subject, pet.id, page),
    [account, client, pet.id, page],
  );
  const { result, reload } = usePatientRead(load);
  return (
    <View style={styles.section}>
      <View style={styles.actions}>
        <Action styles={styles} label={t("nativeCare.backPets")} onPress={back} />
      </View>
      <Text accessibilityRole="header" style={styles.heading}>
        {t("nativeCare.releasedFor", { name: pet.name })}
      </Text>
      {!result || "error" in result ? (
        <PatientReadState styles={styles} retry={reload} error={result?.error} />
      ) : (
        <>
          {!result.value.encounters.length && (
            <Text style={styles.support}>{t("nativeCare.noReleased")}</Text>
          )}
          {result.value.encounters.map((entry) => {
            const key = JSON.stringify([
              entry.organizationName,
              entry.clinicId,
              entry.patientId,
              entry.id,
            ]);
            return (
              <EncounterRow
                key={key}
                styles={styles}
                entry={entry}
                expanded={expanded === key}
                toggle={() => setExpanded(expanded === key ? undefined : key)}
              />
            );
          })}
          <Pager styles={styles} page={page} next={result.value.hasNextPage} change={setPage} />
        </>
      )}
    </View>
  );
}
