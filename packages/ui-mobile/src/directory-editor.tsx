import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Action, Field, type AccessStyles } from "./controls";
import type { DirectoryClinic, DirectoryMember } from "./directory";

export type Edit =
  | { kind: "clinic"; revision: number; clinic: DirectoryClinic; creating: boolean }
  | { kind: "member"; revision: number; member: DirectoryMember; creating: boolean }
  | { kind: "revoke"; revision: number; subject: string };

export function DirectoryEditor({
  edit,
  clinics,
  organization,
  styles,
  busy,
  update,
  cancel,
  save,
}: {
  edit: Edit;
  clinics: DirectoryClinic[];
  organization: string;
  styles: AccessStyles;
  busy: boolean;
  update: (edit: Edit) => void;
  cancel: () => void;
  save: () => void;
}) {
  const { t } = useTranslation();
  const invalid =
    edit.kind === "clinic"
      ? !edit.clinic.name.trim()
      : edit.kind === "member" && !edit.member.subject.trim();
  const changeMember = (member: Partial<DirectoryMember>) => {
    if (edit.kind === "member") update({ ...edit, member: { ...edit.member, ...member } });
  };
  return (
    <View style={styles.section}>
      {edit.kind === "clinic" && (
        <>
          <Text accessibilityRole="header" style={styles.heading}>
            {t(edit.creating ? "directory.addClinic" : "directory.renameClinic")}
          </Text>
          <Field
            styles={styles}
            disabled={busy}
            label={t("directory.name")}
            maxLength={120}
            value={edit.clinic.name}
            onChange={(name) => update({ ...edit, clinic: { ...edit.clinic, name } })}
          />
        </>
      )}
      {edit.kind === "member" && (
        <>
          {edit.creating ? (
            <>
              <Field
                styles={styles}
                disabled={busy}
                label={t("directory.subject")}
                maxLength={255}
                value={edit.member.subject}
                onChange={(subject) => changeMember({ subject })}
                identifier
              />
              <Text style={styles.support}>{t("directory.subjectHint")}</Text>
            </>
          ) : (
            <Text accessibilityRole="header" selectable style={styles.heading}>
              {edit.member.subject}
            </Text>
          )}
          <Text style={styles.heading}>{t("directory.role")}</Text>
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel={t("directory.role")}
            style={styles.actions}
          >
            {(["STAFF", "ADMIN"] as const).map((role) => (
              <Action
                key={role}
                label={t(`directory.${role}`)}
                role="radio"
                selected={edit.member.role === role}
                disabled={busy}
                styles={styles}
                onPress={() => changeMember({ role })}
              />
            ))}
          </View>
          <Text style={styles.heading}>{t("directory.grants")}</Text>
          {edit.member.role === "ADMIN" ? (
            <Text style={styles.support}>{t("directory.allClinics")}</Text>
          ) : clinics.length ? (
            <View style={styles.actions}>
              {clinics.map((clinic) => {
                const selected = edit.member.clinicIds.includes(clinic.id);
                return (
                  <Action
                    key={clinic.id}
                    role="checkbox"
                    label={clinic.name}
                    selected={selected}
                    disabled={busy}
                    styles={styles}
                    onPress={() =>
                      changeMember({
                        clinicIds: selected
                          ? edit.member.clinicIds.filter((id) => id !== clinic.id)
                          : [...edit.member.clinicIds, clinic.id],
                      })
                    }
                  />
                );
              })}
            </View>
          ) : (
            <Text style={styles.support}>{t("directory.noGrants")}</Text>
          )}
        </>
      )}
      {edit.kind === "revoke" && (
        <Text accessibilityRole="alert" style={styles.heading}>
          {t("directory.removeConfirm", { subject: edit.subject, organization })}
        </Text>
      )}
      <View style={styles.actions}>
        <Action
          styles={styles}
          label={t(
            busy
              ? "directory.saving"
              : edit.kind === "revoke"
                ? "directory.remove"
                : "directory.save",
          )}
          primary={edit.kind !== "revoke"}
          destructive={edit.kind === "revoke"}
          disabled={invalid}
          busy={busy}
          onPress={save}
        />
        <Action styles={styles} label={t("directory.cancel")} disabled={busy} onPress={cancel} />
      </View>
    </View>
  );
}
