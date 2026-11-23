import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Action, Field } from "./controls";
import { Items, Warehouses, StockRows } from "./inventory-lists";
import { displayQuantity, catalogInput, type Item, type Warehouse } from "./inventory-forms";
import {
  orderBody,
  receiptBody,
  remaining,
  type PurchaseBody,
  type ReceiptBody,
  type SupplierBody,
  type Supplier,
  type Order,
  type OrderLine,
} from "./trade-forms";
import { AmountField, ConfirmWrite, useTradeSave, type Close } from "./trade-controls";
import type { ClinicPatientProps } from "./patient-form";

type Props = ClinicPatientProps & { close: Close };
export function SupplierForm({ supplier, close, ...p }: Props & { supplier?: Supplier }) {
  const { styles } = p,
    { t } = useTranslation(),
    [name, setName] = useState(supplier?.name ?? "");
  const save = useTradeSave<SupplierBody>(
    p.account,
    (id, body) => p.client.trade.saveSupplier(p.scope, id, body),
    close,
    supplier?.id,
  );
  const value = catalogInput("warehouse", { name, revision: supplier?.revision ?? 0 }),
    body = value && value.name !== supplier?.name ? value : undefined;
  return (
    <View style={styles.section}>
      <Action
        styles={styles}
        label={t("nativeTrade.backSuppliers")}
        disabled={save.busy}
        onPress={() => close()}
      />
      <Text style={styles.heading} accessibilityRole="header">
        {t(supplier ? "nativeTrade.editSupplier" : "nativeTrade.newSupplier")}
      </Text>
      <Field
        styles={styles}
        label={t("nativeTrade.supplierName")}
        value={name}
        onChange={setName}
        maxLength={120}
        disabled={save.locked}
      />
      <ConfirmWrite
        styles={styles}
        state={save}
        valid={!!body}
        submit={() => save.submit(body)}
        label={t("directory.save")}
      />
    </View>
  );
}
export function Suppliers({
  render,
  ...p
}: ClinicPatientProps & { render: (s: Supplier) => React.ReactNode }) {
  const { t } = useTranslation();
  const load = useCallback(
    async (page: number) => {
      const r = await p.client.trade.suppliers(p.scope, page);
      return { rows: r.suppliers, hasNextPage: r.hasNextPage };
    },
    [p.client, p.scope],
  );
  return (
    <StockRows
      refreshLabel={t("nativeTrade.refresh")}
      styles={p.styles}
      load={load}
      empty={t("nativeTrade.noSuppliers")}
      render={render}
      rowKey={(s) => s.id}
    />
  );
}
export function OrderForm({ close, ...p }: Props) {
  const { t } = useTranslation(),
    { styles } = p;
  const [supplier, setSupplier] = useState<Supplier>(),
    [lines, setLines] = useState<{ item: Item; quantity: string }[]>([]),
    [picker, setPicker] = useState<"supplier" | "item">();
  const save = useTradeSave<PurchaseBody>(
    p.account,
    (id, body) => p.client.trade.order(p.scope, id, body),
    close,
  );
  const body = orderBody(
    supplier?.id,
    lines.map((l) => ({ itemId: l.item.id, expectedUnit: l.item.unit, quantity: l.quantity })),
  );
  if (picker)
    return (
      <View style={styles.section}>
        <Action
          styles={styles}
          label={t("nativeTrade.backOrder")}
          onPress={() => setPicker(undefined)}
        />
        {picker === "supplier" ? (
          <Suppliers
            {...p}
            render={(s) => (
              <Action
                styles={styles}
                label={s.name}
                onPress={() => {
                  setSupplier(s);
                  setPicker(undefined);
                }}
              />
            )}
          />
        ) : (
          <Items
            {...p}
            render={(i) => (
              <Action
                styles={styles}
                label={i.name + " · " + i.sku + " · " + i.unit}
                disabled={lines.some((l) => l.item.id === i.id)}
                onPress={() => {
                  setLines([...lines, { item: i, quantity: "" }]);
                  setPicker(undefined);
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
        disabled={save.busy}
        label={t("nativeTrade.backOrders")}
        onPress={() => close()}
      />
      <Text accessibilityRole="header" style={styles.heading}>
        {t("nativeTrade.newOrder")}
      </Text>
      <Text style={styles.heading}>{t("nativeTrade.supplier")}</Text>
      <Action
        styles={styles}
        label={supplier?.name ?? t("nativeTrade.chooseSupplier")}
        disabled={save.locked}
        onPress={() => setPicker("supplier")}
      />
      {lines.map((l) => (
        <View key={l.item.id} style={styles.row}>
          <Text style={styles.heading}>
            {l.item.name} · {l.item.sku}
          </Text>
          <AmountField
            styles={styles}
            locked={save.locked}
            unit={l.item.unit}
            value={l.quantity}
            onChange={(quantity) =>
              setLines((rows) =>
                rows.map((row) => (row.item.id === l.item.id ? { ...row, quantity } : row)),
              )
            }
          />
          <Action
            styles={styles}
            disabled={save.locked}
            label={t("nativeTrade.removeLine", { name: l.item.name })}
            onPress={() => setLines((rows) => rows.filter((row) => row.item.id !== l.item.id))}
          />
        </View>
      ))}
      <Action
        styles={styles}
        disabled={save.locked || lines.length >= 100}
        label={t("nativeTrade.addItem")}
        onPress={() => setPicker("item")}
      />
      <ConfirmWrite
        styles={styles}
        state={save}
        valid={!!body}
        label={t("nativeTrade.placeOrder")}
        submit={() => save.submit(body)}
      />
    </View>
  );
}
type DraftLine = ReceiptBody["lines"][number] & {
  localId: string;
  itemName: string;
  warehouseName: string;
  unit: string;
};
export function ReceiptForm({ order, close, ...p }: Props & { order: Order }) {
  const { styles } = p,
    { t, i18n } = useTranslation();
  const [lines, setLines] = useState<DraftLine[]>([]),
    [target, setTarget] = useState<OrderLine>(),
    [warehouse, setWarehouse] = useState<Warehouse>(),
    [picking, setPicking] = useState(false),
    [qty, setQty] = useState(""),
    [lot, setLot] = useState("");
  const save = useTradeSave<ReceiptBody>(
    p.account,
    (id, body) => p.client.trade.receive(p.scope, order.id, id, body),
    close,
  );
  const serialize = (l: DraftLine) => ({
    itemId: l.itemId,
    quantity: l.quantity,
    warehouseId: l.warehouseId,
    lot: l.lot,
  });
  const draft = lines.map(serialize),
    body = receiptBody(order.lines, draft);
  const candidate =
    target && warehouse
      ? { itemId: target.itemId, warehouseId: warehouse.id, quantity: qty, lot }
      : undefined;
  const valid = !!candidate && !!receiptBody(order.lines, [...draft, candidate]);
  if (picking)
    return (
      <View style={styles.section}>
        <Action
          styles={styles}
          label={t("nativeTrade.backReceipt")}
          onPress={() => setPicking(false)}
        />
        <Warehouses
          {...p}
          render={(w) => (
            <Action
              styles={styles}
              label={w.name}
              onPress={() => {
                setWarehouse(w);
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
        label={t("nativeTrade.backOrder")}
        disabled={save.busy}
        onPress={() => close()}
      />
      <Text accessibilityRole="header" style={styles.heading}>
        {t("nativeTrade.receive")}
      </Text>
      {lines.map((l) => (
        <View style={styles.row} key={l.localId}>
          <Text style={styles.support}>
            {l.itemName} · {displayQuantity(l.quantity, i18n.language)} {l.unit} · {l.warehouseName}{" "}
            · {l.lot || t("nativeInventory.noLot")}
          </Text>
          <Action
            styles={styles}
            label={t("nativeTrade.removeLine", { name: l.itemName })}
            disabled={save.locked}
            onPress={() => setLines((rows) => rows.filter((row) => row.localId !== l.localId))}
          />
        </View>
      ))}
      <Text style={styles.heading}>{t("nativeTrade.receiveLine")}</Text>
      {order.lines.map((l) => {
        const left = remaining(l.quantity, [
          l.receivedQuantity,
          ...(body?.lines ?? []).filter((q) => q.itemId === l.itemId).map((q) => q.quantity),
        ]);
        return (
          <Action
            key={l.itemId}
            role="radio"
            selected={target?.itemId === l.itemId}
            styles={styles}
            disabled={save.locked || left === "0.000"}
            label={t("nativeTrade.openQty", {
              name: l.itemName,
              amount: displayQuantity(left, i18n.language),
              unit: l.unit,
            })}
            onPress={() => {
              setTarget(l);
              setQty("");
            }}
          />
        );
      })}
      {target && (
        <>
          <Action
            styles={styles}
            label={warehouse?.name ?? t("nativeInventory.chooseWarehouse")}
            disabled={save.locked}
            onPress={() => setPicking(true)}
          />
          <AmountField
            styles={styles}
            unit={target.unit}
            locked={save.locked}
            value={qty}
            onChange={setQty}
          />
          <Field
            styles={styles}
            label={t("nativeInventory.lotLabel")}
            value={lot}
            maxLength={120}
            onChange={setLot}
            disabled={save.locked}
            identifier
          />
          <View style={styles.actions}>
            <Action
              styles={styles}
              label={t("nativeTrade.addReceiptLine")}
              disabled={save.locked || !valid}
              onPress={() => {
                if (!candidate || !warehouse || !valid) return;
                setLines([
                  ...lines,
                  {
                    ...candidate,
                    quantity: candidate.quantity.trim().replace(",", "."),
                    localId: globalThis.expo.uuidv4(),
                    itemName: target.itemName,
                    unit: target.unit,
                    warehouseName: warehouse.name,
                  },
                ]);
                setQty("");
                setLot("");
                setTarget(undefined);
              }}
            />
            <Action
              styles={styles}
              label={t("directory.cancel")}
              onPress={() => setTarget(undefined)}
              disabled={save.locked}
            />
          </View>
        </>
      )}
      <ConfirmWrite
        styles={styles}
        state={save}
        valid={!!body && !target}
        label={t("nativeTrade.confirmReceipt")}
        submit={() => save.submit(body)}
      />
    </View>
  );
}
