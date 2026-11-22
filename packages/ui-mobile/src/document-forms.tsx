import { useCallback, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Action, Field } from "./controls";
import { pickDocument, DocumentFileError } from "./document-files";
import { documentSharingChange, type PickedDocument, type StaffDocument } from "./documents";
import {
  PatientNotice,
  PatientReadState,
  usePatientAction,
  usePatientRead,
} from "./patient-controls";
import type { ClinicPatientProps } from "./patient-form";
import type { Guardian } from "./patients";

type Props = ClinicPatientProps & { patientId: string; close: (saved?: boolean) => void };
export function UploadDocument({ styles, account, scope, client, patientId, close }: Props) {
  const { t } = useTranslation();
  const [file, setFile] = useState<PickedDocument>();
  const [title, setTitle] = useState("");
  const [id, setId] = useState(() => globalThis.expo.uuidv4());
  const [picking, setPicking] = useState(false);
  const pickingLock = useRef(false);
  const [issue, setIssue] = useState<"pickFailed" | "fileSize" | "fileType">();
  const action = usePatientAction(account);
  const busy = picking || action.busy;
  async function choose() {
    if (pickingLock.current) return;
    pickingLock.current = true;
    setPicking(true);
    setIssue(undefined);
    action.clear();
    try {
      const picked = await pickDocument();
      if (!picked) return;
      setFile(picked);
      setTitle(
        picked.name
          .replace(/\.[^.]*$/, "")
          .replace(/[\p{Cc}]/gu, " ")
          .slice(0, 180),
      );
      setId(globalThis.expo.uuidv4());
    } catch (error) {
      setIssue(
        error instanceof DocumentFileError && error.issue !== "openUnavailable"
          ? error.issue
          : "pickFailed",
      );
    } finally {
      pickingLock.current = false;
      setPicking(false);
    }
  }
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.heading}>
        {t("nativeDocuments.attach")}
      </Text>
      <Text style={styles.support}>{t("nativeDocuments.pickHelp")}</Text>
      <View style={styles.actions}>
        <Action
          styles={styles}
          label={t(file ? "nativeDocuments.replace" : "nativeDocuments.choose")}
          busy={picking}
          disabled={action.busy}
          onPress={() => void choose()}
        />
      </View>
      {issue && (
        <Text accessibilityRole="alert" style={styles.error}>
          {t(`nativeDocuments.${issue}`)}
        </Text>
      )}
      {file && (
        <>
          <Text style={styles.support}>
            {file.name} · {t("nativeDocuments.kib", { count: Math.ceil(file.bytes.length / 1024) })}
          </Text>
          <Field
            styles={styles}
            label={t("nativeDocuments.title")}
            disabled={busy}
            value={title}
            maxLength={180}
            onChange={(value) => {
              setTitle(value);
              setId(globalThis.expo.uuidv4());
              action.clear();
            }}
          />
        </>
      )}
      <PatientNotice styles={styles} error={action.error} />
      <View style={styles.actions}>
        <Action
          styles={styles}
          primary
          label={t("nativeDocuments.upload")}
          busy={action.busy}
          disabled={
            picking ||
            !file ||
            !title.trim() ||
            /[\p{Cc}]/u.test(title) ||
            action.error === "conflict" ||
            action.error === "denied"
          }
          onPress={() => {
            if (file)
              void action.run(
                () =>
                  client.documents.upload(
                    scope,
                    patientId,
                    id,
                    title.trim(),
                    file,
                    globalThis.expo.uuidv4(),
                  ),
                () => close(true),
              );
          }}
        />
        <Action
          styles={styles}
          label={t("directory.cancel")}
          disabled={busy}
          onPress={() => close()}
        />
      </View>
    </View>
  );
}
export function ShareDocument({
  documentId,
  currentPage,
  ...props
}: Props & { documentId: string; currentPage: number }) {
  const { scope, client, styles, patientId, close } = props;
  const { t } = useTranslation();
  const [changed, setChanged] = useState(false);
  const load = useCallback(
    () => client.documents.sharingDetails(scope, patientId, documentId, currentPage),
    [client, scope, patientId, documentId, currentPage],
  );
  const { result, reload } = usePatientRead(load);
  function refresh(stale = false) {
    setChanged(stale);
    reload();
  }
  if (!result || "error" in result)
    return (
      <View style={styles.section}>
        <PatientReadState styles={styles} error={result?.error} retry={() => refresh()} />
        <Action styles={styles} label={t("directory.cancel")} onPress={() => close()} />
      </View>
    );
  // Loading unmounts the old selection. Each successful read opens the current revision and recipients.
  return <DocumentRecipients {...props} {...result.value} changed={changed} refresh={refresh} />;
}

function DocumentRecipients({
  styles,
  account,
  scope,
  client,
  patientId,
  doc,
  guardians,
  refresh,
  changed,
  close,
}: Props & {
  doc: StaffDocument;
  guardians: Guardian[];
  refresh: (stale?: boolean) => void;
  changed: boolean;
}) {
  const { t } = useTranslation();
  const action = usePatientAction(account);
  const linked = guardians.filter((g) => g.linked);
  const [selected, setSelected] = useState(doc.sharing.guardianIds);
  const change = documentSharingChange(
    doc.sharing,
    linked.map((g) => g.id),
    selected,
  );
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.heading}>
        {t("nativeDocuments.accessFor", { title: doc.title })}
      </Text>
      {changed && (
        <Text accessibilityRole="alert" style={styles.support}>
          {t("nativeDocuments.reviewRefreshed")}
        </Text>
      )}
      <Text style={styles.support}>{t("nativeDocuments.accessHelp")}</Text>
      <View style={styles.actions}>
        <Action
          styles={styles}
          label={t("nativeDocuments.refreshGuardians")}
          disabled={action.busy}
          onPress={() => refresh()}
        />
      </View>
      {!linked.length && <Text style={styles.support}>{t("nativeDocuments.noLinked")}</Text>}
      {linked.map((g) => (
        <Action
          key={g.id}
          styles={styles}
          role="checkbox"
          selected={selected.includes(g.id)}
          disabled={action.busy}
          label={g.name + " · " + g.email}
          onPress={() =>
            setSelected((prev) =>
              prev.includes(g.id) ? prev.filter((id) => id !== g.id) : [...prev, g.id],
            )
          }
        />
      ))}
      <PatientNotice styles={styles} error={action.error} />
      <View style={styles.actions}>
        <Action
          styles={styles}
          primary
          label={t("nativeDocuments.saveAccess")}
          disabled={!change || action.error === "conflict" || action.error === "denied"}
          busy={action.busy}
          onPress={() => {
            if (change)
              void action.run(
                () => client.documents.share(scope, patientId, doc.id, change),
                (outcome) => {
                  if (outcome === "refresh") refresh(true);
                  else close(true);
                },
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
