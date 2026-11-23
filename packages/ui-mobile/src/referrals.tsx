import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Action, type AccessStyles } from "./controls";
import type { ClinicPatientProps } from "./patient-form";
import type { PatientClient } from "./patients";
import type { MobileAccount } from "./session";
import { ReferralList } from "./referral-list";
import { RequestReferral } from "./referral-request";

export function ClinicReferrals({ back, ...props }: ClinicPatientProps & { back: () => void }) {
  const { client, scope, account, styles } = props,
    { t } = useTranslation();
  const page = useCallback(
    (p: number) => client.referrals.staffList(scope, "incoming", p),
    [client, scope],
  );
  return (
    <ReferralList
      title={t("nativeReferrals.inbox")}
      backLabel={t("nativePatients.backPatients")}
      back={back}
      styles={styles}
      account={account}
      loadPage={page}
      role={{ kind: "incoming", respond: (id, body) => client.referrals.respond(scope, id, body) }}
    />
  );
}
export function PatientReferrals({
  patientId,
  back,
  ...props
}: ClinicPatientProps & { patientId: string; back: () => void }) {
  const { client, scope, account, styles } = props,
    { t } = useTranslation();
  const [requestId, setRequestId] = useState<string>(),
    [notice, setNotice] = useState<"saved" | "changed">();
  const loadPage = useCallback(
    (p: number) => client.referrals.staffList(scope, "outgoing", p, patientId),
    [client, scope, patientId],
  );
  if (requestId)
    return (
      <RequestReferral
        {...props}
        patientId={patientId}
        requestId={requestId}
        close={(message) => {
          setNotice(message);
          setRequestId(undefined);
        }}
      />
    );
  return (
    <ReferralList
      title={t("nativeReferrals.outbox")}
      styles={styles}
      account={account}
      backLabel={t("nativeCare.backPatient")}
      back={back}
      role={{ kind: "outgoing" }}
      loadPage={loadPage}
    >
      <View style={styles.actions}>
        <Action
          styles={styles}
          label={t("nativeReferrals.newRequest")}
          onPress={() => {
            setNotice(undefined);
            setRequestId(globalThis.expo.uuidv4());
          }}
        />
      </View>
      {notice && (
        <Text style={styles.support} accessibilityLiveRegion="polite">
          {t(notice === "saved" ? "nativeReferrals.requested" : "nativeReferrals.changed")}
        </Text>
      )}
    </ReferralList>
  );
}
export function OwnerReferrals({
  pet,
  account,
  client,
  styles,
  back,
}: {
  pet: { id: string; name: string };
  account: MobileAccount;
  client: PatientClient;
  styles: AccessStyles;
  back: () => void;
}) {
  const { t } = useTranslation();
  const page = useCallback(
    (p: number) => client.referrals.ownerList(account.subject, pet.id, p),
    [account, client, pet.id],
  );
  return (
    <ReferralList
      title={t("nativeReferrals.forPet", { name: pet.name })}
      account={account}
      styles={styles}
      backLabel={t("nativeCare.backPets")}
      back={back}
      loadPage={page}
      role={{
        kind: "owner",
        decide: (id, body) => client.referrals.decide(account.subject, pet.id, id, body),
      }}
    />
  );
}
