import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Action, type AccessStyles } from "./controls";
import { ShareDocument, UploadDocument } from "./document-forms";
import { StudyPreview } from "./study-preview";
import { DocumentFileError, openDocument } from "./document-files";
import { extensions, type StaffDocument, type OwnerDocument } from "./documents";
import { Pager, PatientReadState, usePatientRead } from "./patient-controls";
import { patientFailure, type PatientClient } from "./patients";
import type { ClinicPatientProps } from "./patient-form";
import type { MobileAccount } from "./session";

function DocumentRow({
  doc,
  account,
  styles,
  download,
  preview,
  children,
}: {
  doc: StaffDocument | OwnerDocument;
  account: MobileAccount;
  styles: AccessStyles;
  download: () => Promise<Uint8Array>;
  preview: () => Promise<Uint8Array>;
  children?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [issue, setIssue] = useState<"openFailed" | "openUnavailable" | "denied">();
  const sequence = useRef(0),
    locked = useRef(false);
  useLayoutEffect(() => {
    locked.current = false;
    setLoading(false);
    return () => {
      sequence.current++;
    };
  }, [account, doc.assetId]);
  async function open() {
    if (locked.current) return;
    locked.current = true;
    setLoading(true);
    setIssue(undefined);
    const current = sequence.current;
    const active = () => current === sequence.current;
    try {
      await openDocument(doc, download, active, doc.title);
    } catch (error) {
      if (active())
        setIssue(
          error instanceof DocumentFileError && error.issue === "openUnavailable"
            ? "openUnavailable"
            : patientFailure(error, "read") === "denied"
              ? "denied"
              : "openFailed",
        );
    } finally {
      if (active()) {
        locked.current = false;
        setLoading(false);
      }
    }
  }
  return (
    <View style={styles.row}>
      <Text accessibilityRole="header" style={styles.heading}>
        {doc.title}
      </Text>
      {"clinicName" in doc && (
        <Text style={styles.support}>
          {doc.clinicName} · {doc.organizationName}
        </Text>
      )}
      <Text style={styles.support}>
        {doc.mediaType === "application/dicom" ? "DICOM" : extensions[doc.mediaType].toUpperCase()}{" "}
        · {t("nativeDocuments.kib", { count: Math.ceil(doc.byteLength / 1024) })} ·{" "}
        {new Date(doc.recordedAt).toLocaleDateString(i18n.language)}
      </Text>
      {doc.mediaType === "application/dicom" && doc.ready && (
        <StudyPreview
          title={doc.title}
          imaging={doc.imaging}
          download={preview}
          account={account}
          styles={styles}
        />
      )}
      {issue && (
        <Text accessibilityRole="alert" style={styles.error}>
          {issue === "denied" ? t("nativePatients.denied") : t(`nativeDocuments.${issue}`)}
        </Text>
      )}
      <View style={styles.actions}>
        <Action
          styles={styles}
          label={t(
            doc.mediaType === "application/dicom"
              ? "nativeDocuments.openOriginal"
              : "nativeDocuments.open",
          )}
          accessibilityLabel={t(
            doc.mediaType === "application/dicom"
              ? "nativeDocuments.openOriginalNamed"
              : "nativeDocuments.openNamed",
            { title: doc.title },
          )}
          disabled={!doc.ready}
          busy={loading}
          onPress={() => void open()}
        />
      </View>
      {children}
    </View>
  );
}

type StaffProps = ClinicPatientProps & {
  patientId: string;
  back: () => void;
};
export function PatientDocuments({ patientId, back, ...props }: StaffProps) {
  const { account, scope, client, styles } = props;
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [editor, setEditor] = useState<"upload" | { documentId: string }>();
  const [saved, setSaved] = useState(false);
  const load = useCallback(
    () => client.documents.list(scope, patientId, page),
    [client, scope, patientId, page],
  );
  const { result, reload } = usePatientRead(load);
  function close(success = false) {
    setEditor(undefined);
    setSaved(success);
    if (success) setPage(1);
    reload();
  }
  if (editor === "upload") return <UploadDocument {...props} patientId={patientId} close={close} />;
  if (editor)
    return (
      <ShareDocument
        {...props}
        patientId={patientId}
        documentId={editor.documentId}
        currentPage={page}
        close={close}
      />
    );
  return (
    <View style={styles.section}>
      <View style={styles.actions}>
        <Action styles={styles} label={t("nativeDocuments.backPatient")} onPress={back} />
      </View>
      <Text accessibilityRole="header" style={styles.heading}>
        {t("nativeDocuments.records")}
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
              label={t("nativeDocuments.attach")}
              onPress={() => setEditor("upload")}
            />
          </View>
          {!result.value.documents.length && (
            <Text style={styles.support}>{t("nativeDocuments.empty")}</Text>
          )}
          {result.value.documents.map((doc) => (
            <DocumentRow
              key={[
                scope.subject,
                scope.organizationId,
                scope.clinicId,
                patientId,
                doc.assetId,
              ].join("/")}
              doc={doc}
              account={account}
              styles={styles}
              download={() => client.documents.staffContent(scope, patientId, doc)}
              preview={() => client.documents.staffPreview(scope, patientId, doc)}
            >
              <Text style={styles.support}>
                {doc.sharing.guardianIds.length
                  ? t("nativeDocuments.sharedCount", { count: doc.sharing.guardianIds.length })
                  : t("nativeDocuments.private")}
              </Text>
              <View style={styles.actions}>
                <Action
                  styles={styles}
                  label={t("nativeDocuments.access")}
                  disabled={!doc.ready}
                  onPress={() => setEditor({ documentId: doc.id })}
                />
              </View>
            </DocumentRow>
          ))}
          <Pager styles={styles} page={page} next={result.value.hasNextPage} change={setPage} />
        </>
      )}
    </View>
  );
}

export function OwnerDocuments({
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
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const load = useCallback(
    () => client.documents.released(account.subject, pet.id, page),
    [client, account, pet.id, page],
  );
  const { result, reload } = usePatientRead(load);
  return (
    <View style={styles.section}>
      <View style={styles.actions}>
        <Action styles={styles} label={t("nativeDocuments.backPets")} onPress={back} />
      </View>
      <Text accessibilityRole="header" style={styles.heading}>
        {t("nativeDocuments.releasedFor", { name: pet.name })}
      </Text>
      {!result || "error" in result ? (
        <PatientReadState styles={styles} error={result?.error} retry={reload} />
      ) : (
        <>
          {!result.value.documents.length && (
            <Text style={styles.support}>{t("nativeDocuments.noReleased")}</Text>
          )}
          {result.value.documents.map((doc) => (
            <DocumentRow
              key={[account.subject, pet.id, doc.assetId].join("/")}
              styles={styles}
              account={account}
              doc={doc}
              download={() => client.documents.ownerContent(account.subject, pet.id, doc)}
              preview={() => client.documents.ownerPreview(account.subject, pet.id, doc)}
            />
          ))}
          <Pager styles={styles} page={page} next={result.value.hasNextPage} change={setPage} />
        </>
      )}
    </View>
  );
}
