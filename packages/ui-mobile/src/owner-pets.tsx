import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Action, Field, type AccessStyles } from "./controls";
import type { PatientClient } from "./patients";
import {
  PatientNotice,
  PatientReadState,
  usePatientAction,
  usePatientRead,
} from "./patient-controls";
import type { MobileAccount } from "./session";

type LinkDraft = { code: string; existingPetId?: string; requestId: string };

export function OwnerPets({
  account,
  client,
  styles,
  openAccount,
}: {
  account: MobileAccount;
  client: PatientClient;
  styles: AccessStyles;
  openAccount: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<LinkDraft>();
  const [linked, setLinked] = useState(false);
  const load = useCallback(() => client.pets(account.subject), [client, account]);
  const { result, reload } = usePatientRead(load);
  const action = usePatientAction(account);
  if (!result || "error" in result)
    return <PatientReadState styles={styles} retry={reload} error={result?.error} />;
  const { pets } = result.value;
  function revise(change: Partial<LinkDraft>) {
    setDraft(
      (previous) => previous && { ...previous, ...change, requestId: globalThis.expo.uuidv4() },
    );
    action.clear();
  }
  function submit() {
    if (!draft) return;
    const { code, existingPetId, requestId } = draft;
    void action.run(
      () => client.redeem(account.subject, { code: code.trim(), requestId, existingPetId }),
      () => {
        setDraft(undefined);
        setLinked(true);
        reload();
      },
      "redeem",
    );
  }
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.heading}>
        {t("nativePatients.myPets")}
      </Text>
      {linked && (
        <Text accessibilityLiveRegion="polite" style={styles.support}>
          {t("nativePatients.linkedSuccess")}
        </Text>
      )}
      {pets.length === 0 && <Text style={styles.support}>{t("nativePatients.emptyOwner")}</Text>}
      {pets.map((pet) => (
        <View key={pet.id} style={styles.row}>
          <Text accessibilityRole="header" style={styles.heading}>
            {pet.name}
          </Text>
          <Text style={styles.support}>{pet.species}</Text>
          {pet.clinics.map((clinic) => (
            <Text key={`${clinic.clinicId}:${clinic.recordId}`} style={styles.support}>
              {clinic.clinicName} · {clinic.organizationName}
            </Text>
          ))}
        </View>
      ))}
      {draft ? (
        <View style={styles.row}>
          <Field
            styles={styles}
            label={t("nativePatients.code")}
            value={draft.code}
            onChange={(code) => revise({ code })}
            identifier
            maxLength={80}
            disabled={action.busy}
          />
          <Text style={styles.support}>{t("nativePatients.codeHelp")}</Text>
          {(pets.length > 0 || draft.existingPetId) && (
            <>
              <Text style={styles.heading}>{t("nativePatients.whichPet")}</Text>
              <View
                style={styles.actions}
                accessibilityRole="radiogroup"
                accessibilityLabel={t("nativePatients.whichPet")}
              >
                <Action
                  styles={styles}
                  label={t("nativePatients.newPet")}
                  disabled={action.busy}
                  role="radio"
                  selected={!draft.existingPetId}
                  onPress={() => revise({ existingPetId: undefined })}
                />
                {pets.map((pet) => (
                  <Action
                    key={pet.id}
                    styles={styles}
                    label={
                      pet.name +
                      " · " +
                      pet.species +
                      " · " +
                      pet.clinics.map((clinic) => clinic.clinicName).join(", ")
                    }
                    disabled={action.busy}
                    role="radio"
                    selected={draft.existingPetId === pet.id}
                    onPress={() => revise({ existingPetId: pet.id })}
                  />
                ))}
              </View>
            </>
          )}
          <PatientNotice styles={styles} error={action.error} />
          <View style={styles.actions}>
            {action.error === "verifyEmail" && (
              <Action styles={styles} label={t("nativeAuth.manageAccount")} onPress={openAccount} />
            )}
            <Action
              styles={styles}
              primary
              busy={action.busy}
              disabled={
                !/^[a-f0-9]{32}$/i.test(draft.code.replace(/[ -]/g, "")) ||
                Boolean(draft.existingPetId && !pets.some((p) => p.id === draft.existingPetId))
              }
              label={t("nativePatients.linkRecord")}
              onPress={submit}
            />
            <Action
              styles={styles}
              disabled={action.busy}
              label={t("directory.cancel")}
              onPress={() => {
                setDraft(undefined);
                action.clear();
              }}
            />
          </View>
        </View>
      ) : (
        <View style={styles.actions}>
          <Action
            styles={styles}
            primary
            label={t("nativePatients.useCode")}
            onPress={() => {
              action.clear();
              setLinked(false);
              setDraft({ code: "", requestId: globalThis.expo.uuidv4() });
            }}
          />
        </View>
      )}
    </View>
  );
}
