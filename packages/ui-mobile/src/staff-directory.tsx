import { Activity, useEffect, useRef, useState } from "react";
import { Share, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Action, type AccessStyles } from "./controls";
import { DirectoryError, type DirectoryView, type StaffDirectoryClient } from "./directory";
import { DirectoryEditor, type Edit } from "./directory-editor";
import { ClinicPatients } from "./clinic-patients";
import type { PatientClient } from "./patients";
import type { MobileAccount } from "./session";

type Props = { client: StaffDirectoryClient; patients: PatientClient; styles: AccessStyles };
type Organization = MobileAccount["organizations"][number];

export function StaffDirectory({
  account,
  client,
  patients,
  styles,
}: Props & { account: MobileAccount }) {
  const { t } = useTranslation();
  const [selected, select] = useState<string>();
  const [shareFailed, setShareFailed] = useState(false);
  const organization =
    account.organizations.find(({ id }) => id === selected) ?? account.organizations[0];
  async function shareId() {
    setShareFailed(false);
    try {
      await Share.share({ message: account.subject });
    } catch {
      setShareFailed(true);
    }
  }

  return (
    <View style={styles.section}>
      <View style={styles.row}>
        <Text accessibilityRole="header" style={styles.heading}>
          {t("directory.staffId")}
        </Text>
        <Text selectable style={styles.support}>
          {account.subject}
        </Text>
        <View style={styles.actions}>
          <Action styles={styles} label={t("directory.shareId")} onPress={() => void shareId()} />
        </View>
        {shareFailed && (
          <Text accessibilityRole="alert" style={styles.error}>
            {t("directory.shareError")}
          </Text>
        )}
      </View>
      <Text accessibilityRole="header" style={styles.heading}>
        {t("nativeAuth.organizations")}
      </Text>
      {organization ? (
        <>
          {account.organizations.length > 1 ? (
            <View
              style={styles.actions}
              accessibilityRole="radiogroup"
              accessibilityLabel={t("nativeAuth.organizations")}
            >
              {account.organizations.map((org) => (
                <Action
                  key={org.id}
                  role="radio"
                  selected={org.id === organization.id}
                  label={org.name}
                  styles={styles}
                  onPress={() => select(org.id)}
                />
              ))}
            </View>
          ) : (
            <Text style={styles.heading}>{organization.name}</Text>
          )}
          <OrganizationDirectory
            key={organization.id}
            organization={organization}
            account={account}
            client={client}
            patients={patients}
            styles={styles}
          />
        </>
      ) : (
        <Text style={styles.support}>{t("nativeAuth.noOrganizations")}</Text>
      )}
    </View>
  );
}

type Notice = "saved" | "invalid" | "conflict" | "lastAdmin" | "changed" | "denied" | "writeError";
type Result = { view: DirectoryView } | { error: "denied" | "loadError" };

function OrganizationDirectory({
  organization,
  account,
  client,
  patients,
  styles,
}: Props & { organization: Organization; account: MobileAccount }) {
  const { t } = useTranslation();
  const [selectedClinic, setSelectedClinic] = useState<{ id: string; name: string }>();
  const [tab, setTab] = useState<"clinics" | "staff">("clinics");
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [loaded, setLoaded] = useState<{
    account: MobileAccount;
    page: number;
    refresh: number;
    result: Result;
  }>();
  const [edit, setEdit] = useState<Edit>();
  const [notice, setNotice] = useState<Notice>();
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const generation = useRef(0);
  const { id: organizationId } = organization;
  useEffect(() => {
    const current = ++generation.current;
    savingRef.current = false;
    setSaving(false);
    const publish = (result: Result) => {
      if (generation.current === current) setLoaded({ account, page, refresh, result });
    };
    void client.load({ subject: account.subject, organizationId }, page).then(
      (view) => publish({ view }),
      (error) =>
        publish({
          error: error instanceof DirectoryError && error.status === 403 ? "denied" : "loadError",
        }),
    );
    return () => {
      generation.current++;
    };
  }, [client, account, organizationId, page, refresh]);

  function begin(draft: Edit) {
    setNotice(undefined);
    setEdit(draft);
  }
  function reload() {
    setRefresh((value) => value + 1);
  }
  function chooseTab(value: typeof tab) {
    setTab(value);
    setPage(1);
    setEdit(undefined);
    setNotice(undefined);
  }

  async function save() {
    if (!edit || savingRef.current) return;
    const current = generation.current;
    savingRef.current = true;
    setSaving(true);
    const scope = { subject: account.subject, organizationId };
    try {
      if (edit.kind === "clinic")
        await client.saveClinic(scope, edit.clinic.id, edit.clinic.name.trim(), edit.revision);
      else if (edit.kind === "member")
        await client.saveMember(
          scope,
          {
            ...edit.member,
            subject: edit.member.subject.trim(),
            clinicIds: edit.member.role === "ADMIN" ? [] : edit.member.clinicIds,
          },
          edit.revision,
        );
      else await client.revokeMember(scope, edit.subject, edit.revision);
      if (generation.current !== current) return;
      setNotice("saved");
      setEdit(undefined);
      reload();
    } catch (error) {
      if (generation.current !== current) return;
      const status = error instanceof DirectoryError && error.status;
      if (status === 400) setNotice("invalid");
      else {
        setNotice(
          error instanceof DirectoryError && error.code === "LAST_ORGANIZATION_ADMIN"
            ? "lastAdmin"
            : status === 409
              ? "conflict"
              : status === 403
                ? "denied"
                : "writeError",
        );
        if (status === 409 || status === 403) setEdit(undefined);
        reload();
      }
    } finally {
      if (generation.current === current) {
        savingRef.current = false;
        setSaving(false);
      }
    }
  }

  const result =
    loaded?.account === account && loaded.page === page && loaded.refresh === refresh
      ? loaded.result
      : undefined;
  const granted =
    result && "view" in result
      ? result.view.kind === "staff"
        ? result.view.clinics
        : result.view.directory.clinics
      : undefined;
  const currentClinic = granted?.find((c) => c.id === selectedClinic?.id);
  if (selectedClinic && (!result || currentClinic)) {
    return (
      <>
        {!currentClinic && (
          <Text accessibilityLiveRegion="polite" style={styles.support}>
            {t("directory.loading")}
          </Text>
        )}
        <Activity mode={currentClinic ? "visible" : "hidden"}>
          <ClinicPatients
            key={selectedClinic.id}
            account={account}
            client={patients}
            styles={styles}
            organizationId={organizationId}
            clinic={currentClinic ?? selectedClinic}
            back={() => setSelectedClinic(undefined)}
          />
        </Activity>
      </>
    );
  }
  if (!result)
    return (
      <Text accessibilityLiveRegion="polite" style={styles.support}>
        {t("directory.loading")}
      </Text>
    );
  if ("error" in result)
    return (
      <View style={styles.section}>
        <Text accessibilityRole="alert" style={styles.error}>
          {t(`directory.${result.error}`)}
        </Text>
        <View style={styles.actions}>
          <Action label={t("directory.retry")} styles={styles} onPress={reload} />
        </View>
      </View>
    );

  const { view } = result;
  const admin = view.kind === "admin" ? view.directory : undefined;
  const clinics = view.kind === "staff" ? view.clinics : view.directory.clinics;
  const currentEdit = admin && edit?.revision === admin.revision ? edit : undefined;
  const message = notice ?? (admin && edit && !currentEdit ? "changed" : undefined);
  return (
    <View style={styles.section}>
      {message && (
        <Text
          accessibilityLiveRegion="polite"
          style={message === "saved" ? styles.support : styles.error}
        >
          {t(`directory.${message}`)}
        </Text>
      )}
      {admin && !currentEdit && (
        <View
          style={styles.actions}
          accessibilityRole="radiogroup"
          accessibilityLabel={organization.name}
        >
          {(["clinics", "staff"] as const).map((section) => (
            <Action
              key={section}
              label={t(`directory.${section}`)}
              styles={styles}
              role="radio"
              selected={tab === section}
              onPress={() => chooseTab(section)}
            />
          ))}
        </View>
      )}
      {currentEdit ? (
        <DirectoryEditor
          edit={currentEdit}
          clinics={clinics}
          organization={organization.name}
          styles={styles}
          busy={saving}
          update={setEdit}
          cancel={() => {
            setEdit(undefined);
            setNotice(undefined);
          }}
          save={() => void save()}
        />
      ) : !admin || tab === "clinics" ? (
        <>
          {!admin && (
            <Text accessibilityRole="header" style={styles.heading}>
              {t("directory.clinics")}
            </Text>
          )}
          {admin && (
            <View style={styles.actions}>
              <Action
                styles={styles}
                primary
                label={t("directory.addClinic")}
                onPress={() =>
                  begin({
                    kind: "clinic",
                    creating: true,
                    clinic: { id: globalThis.expo.uuidv4(), name: "" },
                    revision: admin.revision,
                  })
                }
              />
            </View>
          )}
          {clinics.length === 0 && <Text style={styles.support}>{t("directory.noClinics")}</Text>}
          {clinics.map((clinic) => (
            <View key={clinic.id} style={styles.row}>
              <Text style={styles.heading}>{clinic.name}</Text>
              <View style={styles.actions}>
                <Action
                  styles={styles}
                  label={t("nativePatients.patients")}
                  accessibilityLabel={t("nativePatients.patientsIn", { clinic: clinic.name })}
                  onPress={() => setSelectedClinic(clinic)}
                />
                {admin && (
                  <Action
                    styles={styles}
                    label={t("directory.renameClinic")}
                    accessibilityLabel={`${t("directory.renameClinic")} · ${clinic.name}`}
                    onPress={() =>
                      begin({ kind: "clinic", creating: false, clinic, revision: admin.revision })
                    }
                  />
                )}
              </View>
            </View>
          ))}
        </>
      ) : (
        <>
          <View style={styles.actions}>
            <Action
              styles={styles}
              primary
              label={t("directory.updateAccess")}
              onPress={() =>
                begin({
                  kind: "member",
                  creating: true,
                  member: { subject: "", role: "STAFF", clinicIds: [] },
                  revision: admin.revision,
                })
              }
            />
          </View>
          {admin.members.length === 0 && (
            <Text style={styles.support}>{t("directory.noStaff")}</Text>
          )}
          {admin.members.map((member) => (
            <View key={member.subject} style={styles.row}>
              <Text selectable style={styles.heading}>
                {member.subject}
              </Text>
              <Text style={styles.support}>{t(`directory.${member.role}`)}</Text>
              <Text style={styles.support}>
                {member.role === "ADMIN"
                  ? t("directory.allClinics")
                  : clinics
                      .filter(({ id }) => member.clinicIds.includes(id))
                      .map(({ name }) => name)
                      .join(", ") || t("directory.noGrants")}
              </Text>
              <View style={styles.actions}>
                <Action
                  styles={styles}
                  label={t("directory.editMember")}
                  accessibilityLabel={`${t("directory.editMember")} · ${member.subject}`}
                  onPress={() =>
                    begin({ kind: "member", creating: false, member, revision: admin.revision })
                  }
                />
                <Action
                  styles={styles}
                  destructive
                  label={t("directory.remove")}
                  accessibilityLabel={`${t("directory.remove")} · ${member.subject}`}
                  onPress={() =>
                    begin({ kind: "revoke", subject: member.subject, revision: admin.revision })
                  }
                />
              </View>
            </View>
          ))}
          {(page > 1 || admin.hasNextPage) && (
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
                {admin.hasNextPage && (
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
