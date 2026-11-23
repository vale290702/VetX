import { Activity, useCallback, useState } from "react";
import { View, Text } from "react-native";
import { useTranslation } from "react-i18next";
import { Action, type AccessStyles } from "./controls";
import { Pager, PatientReadState, usePatientRead } from "./patient-controls";
import { displayQuantity } from "./inventory-forms";
import { StockRows } from "./inventory-lists";
import type { ClinicPatientProps } from "./patient-form";
import type { MobileAccount } from "./session";
import type { PatientClient } from "./patients";
import { allowedActions, remaining, type Rx } from "./trade-forms";
import { EventAuthor, TradeNotice, type Notice } from "./trade-controls";
import { SignRx, DispenseRx, ShareRx } from "./pharmacy-forms";
import { warehouseLabels } from "./trade-labels";

export function PatientPharmacy({
  patientId,
  back,
  ...p
}: ClinicPatientProps & { patientId: string; back: () => void }) {
  const { styles } = p,
    { t, i18n } = useTranslation(),
    [page, setPage] = useState(1),
    [selected, setSelected] = useState<Rx>(),
    [form, setForm] = useState<"sign" | "dispense" | "share">(),
    [notice, setNotice] = useState<Notice>();
  const load = useCallback(async () => {
    const [data, grant] = await Promise.all([
      p.client.trade.prescriptions(p.scope, patientId, page),
      p.client.trade.me(p.scope),
    ]);
    return { ...data, rights: allowedActions(grant, p.account.subject) };
  }, [p.account, p.client, p.scope, page, patientId]);
  const { result, reload } = usePatientRead(load);
  function close(n?: Notice) {
    setForm(undefined);
    setNotice(n);
    if (n) {
      if (n === "denied") setSelected(undefined);
      reload();
    }
  }
  const current = result && "value" in result ? result.value : undefined;
  const rx = current?.prescriptions.find((r) => r.id === selected?.id);
  const canOpen =
    form === "sign"
      ? current?.rights.prescribe
      : !!rx && (form === "dispense" ? current?.rights.dispense : current?.rights.prescribe);
  // Preserve the signed-in account's draft while the server rechecks the clinic and capability after foregrounding.
  if (form && (canOpen || !result) && (form === "sign" || selected)) {
    const record = rx ?? selected;
    return (
      <>
        {!canOpen && <PatientReadState styles={styles} retry={reload} />}
        <Activity mode={canOpen ? "visible" : "hidden"}>
          {form === "sign" ? (
            <SignRx {...p} patientId={patientId} close={close} />
          ) : (
            record &&
            (form === "dispense" ? (
              <DispenseRx {...p} patientId={patientId} rx={record} close={close} />
            ) : (
              <ShareRx {...p} patientId={patientId} rxId={record.id} page={page} close={close} />
            ))
          )}
        </Activity>
      </>
    );
  }
  if (!current)
    return (
      <View style={styles.section}>
        <Action styles={styles} label={t("nativeCare.backPatient")} onPress={back} />
        <PatientReadState
          styles={styles}
          retry={reload}
          error={result && "error" in result ? result.error : undefined}
        />
      </View>
    );
  const { prescriptions, rights, hasNextPage } = current;
  if (rx)
    return (
      <RxDetail
        {...p}
        patientId={patientId}
        rx={rx}
        rights={rights}
        notice={notice}
        refresh={reload}
        back={() => {
          setSelected(undefined);
          setForm(undefined);
          setNotice(undefined);
        }}
        edit={(k) => {
          setForm(k);
          setNotice(undefined);
        }}
      />
    );
  return (
    <View style={styles.section}>
      <Action styles={styles} label={t("nativeCare.backPatient")} onPress={back} />
      <Text style={styles.heading} accessibilityRole="header">
        {t("nativeTrade.prescriptions")}
      </Text>
      <TradeNotice styles={styles} notice={notice} />
      <Action styles={styles} label={t("nativeTrade.refresh")} onPress={reload} />
      {rights.prescribe && (
        <Action
          styles={styles}
          primary
          label={t("nativeTrade.newRx")}
          onPress={() => {
            setForm("sign");
            setNotice(undefined);
          }}
        />
      )}
      {!prescriptions.length && <Text style={styles.support}>{t("nativeTrade.noRx")}</Text>}
      {prescriptions.map((r) => (
        <View key={r.id} style={styles.row}>
          <Text style={styles.heading}>{r.medication}</Text>
          <Text style={styles.support}>
            {t("nativeTrade.authorizedQty", {
              amount: displayQuantity(r.quantity, i18n.language),
              unit: r.unit,
            })}
          </Text>
          <EventAuthor event={r} styles={styles} />
          <Action
            styles={styles}
            label={t("nativeTrade.openRx")}
            onPress={() => {
              setSelected(r);
              setNotice(undefined);
            }}
          />
        </View>
      ))}
      <Pager styles={styles} next={hasNextPage} page={page} change={setPage} />
    </View>
  );
}
function RxDetail({
  rx,
  patientId,
  rights,
  back,
  edit,
  refresh,
  notice,
  ...p
}: ClinicPatientProps & {
  patientId: string;
  rx: Rx;
  rights: { prescribe: boolean; dispense: boolean };
  back: () => void;
  edit: (k: "dispense" | "share") => void;
  refresh: () => void;
  notice?: Notice;
}) {
  const { styles } = p,
    { t, i18n } = useTranslation(),
    left = remaining(rx.quantity, [rx.dispensedQuantity]);
  const load = useCallback(
    async (page: number) => {
      const data = await p.client.trade.dispensings(p.scope, patientId, rx.id, page);
      const names = await warehouseLabels(
        data.dispensings.map((d) => d.warehouseId),
        (n) => p.client.inventory.warehouses(p.scope, n),
      );
      return {
        rows: data.dispensings.map((d) => ({
          ...d,
          warehouseName: names.get(d.warehouseId) ?? d.warehouseId,
        })),
        hasNextPage: data.hasNextPage,
      };
    },
    [p.client, p.scope, patientId, rx.id],
  );
  return (
    <View style={styles.section}>
      <Action styles={styles} label={t("nativeTrade.backRxList")} onPress={back} />
      <Text style={styles.heading} accessibilityRole="header">
        {rx.medication}
      </Text>
      <TradeNotice styles={styles} notice={notice} />
      <Text style={styles.heading}>{t("nativeTrade.instructions")}</Text>
      <Text selectable style={styles.support}>
        {rx.instructions}
      </Text>
      <Text style={styles.support}>{rx.itemName}</Text>
      <Text style={styles.support}>
        {t("nativeTrade.rxProgress", {
          ordered: displayQuantity(rx.quantity, i18n.language),
          dispensed: displayQuantity(rx.dispensedQuantity, i18n.language),
          remaining: displayQuantity(left, i18n.language),
          unit: rx.unit,
        })}
      </Text>
      <EventAuthor event={rx} styles={styles} />
      <Text selectable style={styles.support}>
        {t("nativeTrade.rxId", { id: rx.id })}
      </Text>
      <Action styles={styles} label={t("nativeTrade.refresh")} onPress={refresh} />
      <View style={styles.actions}>
        {rights.prescribe && (
          <Action styles={styles} label={t("nativeTrade.release")} onPress={() => edit("share")} />
        )}
        {rights.dispense && left !== "0.000" && (
          <Action
            styles={styles}
            primary
            label={t("nativeTrade.dispense")}
            onPress={() => edit("dispense")}
          />
        )}
      </View>
      <Text style={styles.heading} accessibilityRole="header">
        {t("nativeTrade.dispensings")}
      </Text>
      <StockRows
        refreshLabel={t("nativeTrade.refresh")}
        styles={styles}
        load={load}
        rowKey={(d) => d.id}
        empty={t("nativeTrade.noDispensings")}
        render={(d) => (
          <>
            <Text style={styles.heading}>
              {displayQuantity(d.quantity, i18n.language)} {rx.unit}
            </Text>
            <Text style={styles.support}>
              {t("nativeTrade.warehouseLot", {
                warehouse: d.warehouseName,
                lot: d.lot || t("nativeInventory.noLot"),
              })}
            </Text>
            <EventAuthor event={d} styles={styles} />
            <Text selectable style={styles.support}>
              {t("nativeInventory.movementId", { id: d.movementId })}
            </Text>
          </>
        )}
      />
    </View>
  );
}
export function OwnerPrescriptions({
  account,
  client,
  pet,
  styles,
  back,
}: {
  account: MobileAccount;
  client: PatientClient;
  pet: { id: string; name: string };
  styles: AccessStyles;
  back: () => void;
}) {
  const { t, i18n } = useTranslation();
  const load = useCallback(
    async (page: number) => {
      const r = await client.trade.owner(account.subject, pet.id, page);
      return { rows: r.prescriptions, hasNextPage: r.hasNextPage };
    },
    [account, client, pet.id],
  );
  return (
    <View style={styles.section}>
      <Action styles={styles} label={t("nativeCare.backPets")} onPress={back} />
      <Text accessibilityRole="header" style={styles.heading}>
        {t("nativeTrade.forPet", { name: pet.name })}
      </Text>
      <StockRows
        refreshLabel={t("nativeTrade.refresh")}
        styles={styles}
        load={load}
        rowKey={(r) => r.clinicId + ":" + r.id}
        empty={t("nativeTrade.noReleased")}
        render={(r) => (
          <>
            <Text style={styles.heading}>{r.medication}</Text>
            <Text selectable style={styles.support}>
              {r.instructions}
            </Text>
            <Text style={styles.support}>
              {t("nativeTrade.authorizedQty", {
                amount: displayQuantity(r.quantity, i18n.language),
                unit: r.unit,
              })}
            </Text>
            <Text style={styles.support}>
              {r.clinicName} · {r.organizationName} ·{" "}
              {new Date(r.recordedAt).toLocaleString(i18n.language)}
            </Text>
          </>
        )}
      />
    </View>
  );
}
