import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Action, Field } from "./controls";
import { Balances, Items, Warehouses } from "./inventory-lists";
import { displayQuantity, type Balance, type Item, type Warehouse } from "./inventory-forms";
import { sharingChange } from "./care-forms";
import { PatientReadState, usePatientRead } from "./patient-controls";
import { readRxRecipients } from "./pharmacy-read";
import type { Guardian } from "./patients";
import type { ClinicPatientProps } from "./patient-form";
import {
  dispenseBody,
  prescriptionBody,
  remaining,
  type DispenseBody,
  type Rx,
  type RxBody,
  type Sharing,
} from "./trade-forms";
import { AmountField, ConfirmWrite, TradeNotice, useTradeSave, type Close } from "./trade-controls";
type Props = ClinicPatientProps & { patientId: string; close: Close };
export function SignRx({ patientId, close, ...p }: Props) {
  const { styles } = p,
    { t } = useTranslation(),
    [item, setItem] = useState<Item>(),
    [picking, setPicking] = useState(false),
    [med, setMed] = useState(""),
    [note, setNote] = useState(""),
    [qty, setQty] = useState("");
  const save = useTradeSave<RxBody>(
      p.account,
      (id, b) => p.client.trade.prescribe(p.scope, patientId, id, b),
      close,
    ),
    body = prescriptionBody(item, med, note, qty);
  if (picking)
    return (
      <View style={styles.section}>
        <Action
          styles={styles}
          label={t("nativeTrade.backPrescription")}
          onPress={() => setPicking(false)}
        />
        <Items
          {...p}
          render={(i) => (
            <Action
              styles={styles}
              label={i.name + " · " + i.sku + " · " + i.unit}
              onPress={() => {
                setItem(i);
                setPicking(false);
              }}
            />
          )}
        />
      </View>
    );
  return (
    <View style={styles.section}>
      <Action
        styles={styles}
        label={t("nativeTrade.backRxList")}
        disabled={save.busy}
        onPress={() => close()}
      />
      <Text style={styles.heading} accessibilityRole="header">
        {t("nativeTrade.newRx")}
      </Text>
      <Text style={styles.heading}>{t("nativeTrade.stockItem")}</Text>
      <Action
        styles={styles}
        label={item ? item.name + " · " + item.sku : t("nativeTrade.chooseItem")}
        onPress={() => setPicking(true)}
        disabled={save.locked}
      />
      <Field
        styles={styles}
        label={t("nativeTrade.medication")}
        maxLength={250}
        value={med}
        onChange={setMed}
        disabled={save.locked}
      />
      <Field
        styles={styles}
        label={t("nativeTrade.instructions")}
        maxLength={8000}
        multiline
        value={note}
        onChange={setNote}
        disabled={save.locked}
      />
      {item && (
        <AmountField
          styles={styles}
          locked={save.locked}
          value={qty}
          unit={item.unit}
          onChange={setQty}
        />
      )}
      <Text style={styles.support}>{t("nativeTrade.signHelp")}</Text>
      <ConfirmWrite
        styles={styles}
        state={save}
        valid={!!body}
        label={t("nativeTrade.sign")}
        submit={() => save.submit(body)}
      />
    </View>
  );
}
export function DispenseRx({ patientId, rx, close, ...p }: Props & { rx: Rx }) {
  const { styles } = p,
    { t, i18n } = useTranslation(),
    [warehouse, setWarehouse] = useState<Warehouse>(),
    [balance, setBalance] = useState<Balance>(),
    [picker, setPicker] = useState<"warehouse" | "lot">(),
    [qty, setQty] = useState("");
  const left = remaining(rx.quantity, [rx.dispensedQuantity]);
  const save = useTradeSave<DispenseBody>(
      p.account,
      (id, b) => p.client.trade.dispense(p.scope, patientId, rx.id, id, b),
      close,
    ),
    body = balance && dispenseBody(warehouse?.id, balance.lot, qty, left, balance.quantity);
  if (picker)
    return (
      <View style={styles.section}>
        <Action
          styles={styles}
          label={t("nativeTrade.backDispense")}
          onPress={() => setPicker(undefined)}
        />
        {picker === "lot" && warehouse ? (
          <Balances
            {...p}
            warehouseId={warehouse.id}
            itemId={rx.itemId}
            render={(b) => (
              <Action
                styles={styles}
                disabled={b.quantity === "0.000"}
                label={t("nativeInventory.available", {
                  lot: b.lot || t("nativeInventory.noLot"),
                  amount: displayQuantity(b.quantity, i18n.language),
                  unit: b.unit,
                })}
                onPress={() => {
                  setBalance(b);
                  setPicker(undefined);
                }}
              />
            )}
          />
        ) : (
          <Warehouses
            {...p}
            render={(w) => (
              <Action
                styles={styles}
                label={w.name}
                onPress={() => {
                  if (w.id !== warehouse?.id) setBalance(undefined);
                  setWarehouse(w);
                  setPicker("lot");
                }}
              />
            )}
          />
        )}
      </View>
    );
  return (
    <View style={styles.section}>
      <Action
        styles={styles}
        label={t("nativeTrade.backPrescription")}
        onPress={() => close()}
        disabled={save.busy}
      />
      <Text accessibilityRole="header" style={styles.heading}>
        {t("nativeTrade.dispense")} · {rx.medication}
      </Text>
      <Text selectable style={styles.support}>
        {rx.instructions}
      </Text>
      <Text style={styles.support}>
        {t("nativeTrade.rxLeft", { amount: displayQuantity(left, i18n.language), unit: rx.unit })}
      </Text>
      <Action
        styles={styles}
        label={warehouse?.name ?? t("nativeInventory.chooseWarehouse")}
        onPress={() => setPicker("warehouse")}
        disabled={save.locked}
      />
      {warehouse && (
        <Action
          styles={styles}
          disabled={save.locked}
          label={
            balance
              ? t("nativeInventory.available", {
                  lot: balance.lot || t("nativeInventory.noLot"),
                  amount: displayQuantity(balance.quantity, i18n.language),
                  unit: rx.unit,
                })
              : t("nativeInventory.chooseLot")
          }
          onPress={() => setPicker("lot")}
        />
      )}
      <AmountField
        styles={styles}
        unit={rx.unit}
        value={qty}
        onChange={setQty}
        locked={save.locked}
      />
      <ConfirmWrite
        styles={styles}
        state={save}
        valid={!!body}
        label={t("nativeTrade.confirmDispense")}
        submit={() => save.submit(body)}
      />
    </View>
  );
}
export function ShareRx({
  patientId,
  rxId,
  page,
  close,
  ...p
}: Props & { rxId: string; page: number }) {
  const { styles } = p,
    { t } = useTranslation(),
    [changed, setChanged] = useState(false);
  const load = useCallback(
    () => readRxRecipients(p.client, p.scope, patientId, rxId, page),
    [p.client, p.scope, patientId, rxId, page],
  );
  const { result, reload } = usePatientRead(load);
  if (!result || "error" in result)
    return (
      <View style={styles.section}>
        <Action styles={styles} label={t("nativeTrade.backPrescription")} onPress={() => close()} />
        <PatientReadState styles={styles} error={result?.error} retry={reload} />
      </View>
    );
  return (
    <Recipients
      {...p}
      patientId={patientId}
      {...result.value}
      changed={changed}
      close={close}
      refresh={(stale = false) => {
        setChanged(stale);
        reload();
      }}
    />
  );
}
function Recipients({
  patientId,
  rx,
  guardians,
  changed,
  refresh,
  close,
  ...p
}: Props & {
  rx: Rx;
  guardians: Guardian[];
  changed: boolean;
  refresh: (stale?: boolean) => void;
}) {
  const { t } = useTranslation(),
    { styles } = p,
    [selected, setSelected] = useState(rx.sharing.guardianIds);
  const body = sharingChange(rx.sharing, guardians, selected),
    linked = guardians.filter((g) => g.linked);
  const save = useTradeSave<Sharing>(
    p.account,
    (_id, b) => p.client.trade.share(p.scope, patientId, rx.id, b),
    (n) => {
      if (n === "changed" || n === "denied") refresh(true);
      else close(n);
    },
    rx.id,
  );
  return (
    <View style={styles.section}>
      <Action
        styles={styles}
        label={t("nativeTrade.backPrescription")}
        disabled={save.busy}
        onPress={() => close()}
      />
      <Text style={styles.heading} accessibilityRole="header">
        {t("nativeTrade.release")} · {rx.medication}
      </Text>
      <TradeNotice styles={styles} notice={changed ? "changed" : undefined} />
      <Text style={styles.support}>{t("nativeTrade.releaseHelp")}</Text>
      <Action
        styles={styles}
        label={t("nativeDocuments.refreshGuardians")}
        onPress={() => refresh()}
        disabled={save.locked}
      />
      {!linked.length && <Text style={styles.support}>{t("nativeDocuments.noLinked")}</Text>}
      {linked.map((g) => (
        <Action
          styles={styles}
          key={g.id}
          role="checkbox"
          selected={selected.includes(g.id)}
          label={g.name + " · " + g.email}
          disabled={save.locked}
          onPress={() =>
            setSelected((ids) =>
              ids.includes(g.id) ? ids.filter((x) => x !== g.id) : [...ids, g.id],
            )
          }
        />
      ))}
      <ConfirmWrite
        styles={styles}
        state={save}
        valid={!!body && body.guardianIds.length <= 100}
        submit={() => save.submit(body)}
        label={t("nativeTrade.saveAccess")}
      />
    </View>
  );
}
