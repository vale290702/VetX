import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Action } from "./controls";
import { Pager, PatientReadState, usePatientRead } from "./patient-controls";
import type { ClinicPatientProps } from "./patient-form";
import { capabilityBody, type Capability, type GrantBody } from "./trade-forms";
import { ConfirmWrite, TradeNotice, useTradeSave, type Close, type Notice } from "./trade-controls";
export function PharmacyGrants(p: ClinicPatientProps) {
  const { styles } = p,
    { t } = useTranslation(),
    [page, setPage] = useState(1),
    [selected, setSelected] = useState<string>(),
    [notice, setNotice] = useState<Notice>();
  const load = useCallback(() => p.client.trade.grants(p.scope, page), [p.client, p.scope, page]);
  const { result, reload } = usePatientRead(load);
  if (!result || "error" in result)
    return <PatientReadState styles={styles} retry={reload} error={result?.error} />;
  const current = result.value.capabilities.find((c) => c.subject === selected);
  if (current)
    return (
      <GrantForm
        key={current.issuer + current.subject + ":" + current.revision}
        {...p}
        grant={current}
        close={(n) => {
          setSelected(undefined);
          setNotice(n);
          if (n) reload();
        }}
      />
    );
  return (
    <View style={styles.section}>
      <TradeNotice styles={styles} notice={notice} />
      <Text style={styles.support}>{t("nativeTrade.grantHelp")}</Text>
      <Action styles={styles} label={t("nativeTrade.refresh")} onPress={reload} />
      {!result.value.capabilities.length && (
        <Text style={styles.support}>{t("nativeTrade.noStaff")}</Text>
      )}
      {result.value.capabilities.map((g) => (
        <View key={g.issuer + ":" + g.subject} style={styles.row}>
          <Text style={styles.heading}>{g.subject}</Text>
          <Text selectable style={styles.support}>
            {g.issuer}
          </Text>
          <Text style={styles.support}>
            {t(g.clinicAccess ? "nativeTrade.clinicActive" : "nativeTrade.clinicInactive")}
          </Text>
          <Text style={styles.support}>
            {t("nativeTrade.grantStatus", {
              sign: t(g.canPrescribe ? "nativeTrade.on" : "nativeTrade.off"),
              dispense: t(g.canDispense ? "nativeTrade.on" : "nativeTrade.off"),
            })}
          </Text>
          <Action
            styles={styles}
            label={t("nativeTrade.editGrant")}
            onPress={() => setSelected(g.subject)}
          />
        </View>
      ))}
      <Pager page={page} next={result.value.hasNextPage} change={setPage} styles={styles} />
    </View>
  );
}
function GrantForm({
  grant,
  close,
  ...p
}: ClinicPatientProps & { grant: Capability; close: Close }) {
  const { t } = useTranslation(),
    { styles } = p,
    [sign, setSign] = useState(grant.canPrescribe),
    [disp, setDisp] = useState(grant.canDispense);
  const save = useTradeSave<GrantBody>(
      p.account,
      (_id, b) => p.client.trade.grant(p.scope, grant.subject, b),
      close,
      grant.subject,
    ),
    body = capabilityBody(grant, sign, disp);
  return (
    <View style={styles.section}>
      <Action
        styles={styles}
        label={t("nativeTrade.backGrants")}
        disabled={save.busy}
        onPress={() => close()}
      />
      <Text style={styles.heading} accessibilityRole="header">
        {t("nativeTrade.editGrant")} · {grant.subject}
      </Text>
      <Text selectable style={styles.support}>
        {grant.issuer}
      </Text>
      {!grant.clinicAccess && <Text style={styles.support}>{t("nativeTrade.revokeOnly")}</Text>}
      <Action
        styles={styles}
        role="checkbox"
        selected={sign}
        label={t("nativeTrade.signPrivilege")}
        disabled={save.locked || (!grant.clinicAccess && !grant.canPrescribe)}
        onPress={() => setSign(!sign)}
      />
      <Action
        styles={styles}
        role="checkbox"
        selected={disp}
        label={t("nativeTrade.dispensePrivilege")}
        disabled={save.locked || (!grant.clinicAccess && !grant.canDispense)}
        onPress={() => setDisp(!disp)}
      />
      <ConfirmWrite
        styles={styles}
        state={save}
        valid={!!body}
        label={t("nativeTrade.saveGrant")}
        submit={() => save.submit(body)}
      />
    </View>
  );
}
