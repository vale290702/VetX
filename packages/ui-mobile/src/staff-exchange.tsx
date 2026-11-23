import { useRef, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Action } from "./controls";
import { DocumentFileError, pickPackage } from "./document-files";
import { ImportReview } from "./import-review";
import type { Preview } from "./exchange-forms";
import { PatientNotice, usePatientAction } from "./patient-controls";
import type { ClinicPatientProps } from "./patient-form";

export function StaffExchange({
  back,
  openPatient,
  ...props
}: ClinicPatientProps & { back: () => void; openPatient: (id: string) => void }) {
  const { t } = useTranslation(),
    { styles, account, scope, client } = props;
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array }>(),
    [preview, setPreview] = useState<Preview>();
  const [issue, setIssue] = useState<"packageType" | "packageSize" | "pickFailed">();
  const [picking, setPicking] = useState(false),
    locked = useRef(false);
  const action = usePatientAction(account);
  async function choose() {
    if (locked.current) return;
    locked.current = true;
    setIssue(undefined);
    action.clear();
    setPicking(true);
    try {
      const selected = await pickPackage();
      if (selected) setFile(selected);
    } catch (e) {
      setIssue(
        e instanceof DocumentFileError && e.issue === "fileType"
          ? "packageType"
          : e instanceof DocumentFileError && e.issue === "fileSize"
            ? "packageSize"
            : "pickFailed",
      );
    } finally {
      locked.current = false;
      setPicking(false);
    }
  }
  if (preview)
    return (
      <ImportReview
        {...props}
        preview={preview}
        openPatient={openPatient}
        back={() => {
          setPreview(undefined);
          action.clear();
        }}
      />
    );
  return (
    <View style={styles.section}>
      <Action
        styles={styles}
        label={t("nativePatients.backPatients")}
        disabled={action.busy || picking}
        onPress={back}
      />
      <Text accessibilityRole="header" style={styles.heading}>
        {t("nativeExchange.import")}
      </Text>
      <Text style={styles.support}>{t("nativeExchange.previewHelp")}</Text>
      <Action
        styles={styles}
        label={t(file ? "nativeExchange.replacePackage" : "nativeExchange.pickPackage")}
        disabled={action.busy}
        busy={picking}
        onPress={() => void choose()}
      />
      {issue && (
        <Text accessibilityRole="alert" style={styles.error}>
          {t(`nativeExchange.${issue}`)}
        </Text>
      )}
      {file && (
        <Text style={styles.support}>
          {file.name} · {t("nativeDocuments.kib", { count: Math.ceil(file.bytes.length / 1024) })}
        </Text>
      )}
      <PatientNotice styles={styles} error={action.error} />
      <Action
        styles={styles}
        primary
        busy={action.busy}
        disabled={!file || picking}
        label={t("nativeExchange.preview")}
        onPress={() => {
          if (file)
            void action.run(
              () => client.exchange.preview(scope, file.bytes, globalThis.expo.uuidv4()),
              setPreview,
            );
        }}
      />
    </View>
  );
}
