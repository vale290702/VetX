import { Activity, useCallback, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Action, Field } from "./controls";
import { StockRows } from "./inventory-lists";
import { displayQuantity } from "./inventory-forms";
import { Pager, PatientReadState, usePatientRead } from "./patient-controls";
import { OrderForm, ReceiptForm, SupplierForm, Suppliers } from "./purchasing-forms";
import type { ClinicPatientProps } from "./patient-form";
import {
  AmountField,
  ConfirmWrite,
  EventAuthor,
  TradeNotice,
  useTradeSave,
  type Close,
  type Notice,
} from "./trade-controls";
import {
  remaining,
  returnBody,
  type Order,
  type Supplier,
  type ReceivedLine,
  type ReturnBody,
} from "./trade-forms";
import { warehouseLabels, receiptMovements } from "./trade-labels";
import { PharmacyGrants } from "./pharmacy-grants";
export function Purchasing({
  back,
  admin,
  ...p
}: ClinicPatientProps & { back: () => void; admin: boolean | undefined }) {
  const { styles } = p,
    { t } = useTranslation();
  const [tab, setTab] = useState<"orders" | "suppliers" | "grants">("orders"),
    [form, setForm] = useState<"newOrder" | { supplier?: Supplier }>();
  const [page, setPage] = useState(1),
    [selected, setSelected] = useState<Order>(),
    [notice, setNotice] = useState<Notice>();
  const load = useCallback(() => p.client.trade.orders(p.scope, page), [p.client, p.scope, page]);
  const { result, reload } = usePatientRead(load);
  const current =
    result && "value" in result
      ? result.value.orders.find((o) => o.id === selected?.id)
      : undefined;
  function close(n?: Notice) {
    setForm(undefined);
    setNotice(n);
    if (n) {
      setPage(1);
      reload();
    }
  }
  function changeTab(k: typeof tab) {
    setTab(k);
    setNotice(undefined);
    setSelected(undefined);
  }
  if (form === "newOrder") return <OrderForm {...p} close={close} />;
  if (form && admin !== false)
    return <SupplierForm {...p} supplier={form.supplier} close={close} />;
  if (selected && tab === "orders" && (current || !result))
    return (
      <>
        {!current && <PatientReadState styles={styles} retry={reload} />}
        <Activity mode={current ? "visible" : "hidden"}>
          <OrderDetail
            {...p}
            order={current ?? selected}
            back={() => {
              setSelected(undefined);
              setNotice(undefined);
              reload();
            }}
            notice={notice}
            refresh={(n) => {
              setNotice(n);
              reload();
            }}
          />
        </Activity>
      </>
    );
  return (
    <View style={styles.section}>
      <Action styles={styles} label={t("nativePatients.backPatients")} onPress={back} />
      <Text accessibilityRole="header" style={styles.heading}>
        {t("nativeTrade.purchasing")}
      </Text>
      <View
        style={styles.actions}
        accessibilityRole="radiogroup"
        accessibilityLabel={t("nativeTrade.purchasing")}
      >
        {(["orders", "suppliers", ...(admin ? ["grants" as const] : [])] as const).map((k) => (
          <Action
            styles={styles}
            key={k}
            role="radio"
            selected={tab === k}
            label={t(`nativeTrade.${k}`)}
            onPress={() => changeTab(k)}
          />
        ))}
      </View>
      <TradeNotice styles={styles} notice={notice} />
      {tab === "grants" && admin ? (
        <PharmacyGrants {...p} />
      ) : tab === "suppliers" ? (
        <>
          {admin && (
            <Action
              styles={styles}
              label={t("nativeTrade.newSupplier")}
              onPress={() => setForm({})}
            />
          )}
          <Suppliers
            {...p}
            render={(s) => (
              <>
                <Text style={styles.heading}>{s.name}</Text>
                {admin && (
                  <Action
                    styles={styles}
                    label={t("nativeTrade.editSupplier")}
                    onPress={() => setForm({ supplier: s })}
                  />
                )}
              </>
            )}
          />
        </>
      ) : (
        <>
          <Action
            styles={styles}
            label={t("nativeTrade.newOrder")}
            onPress={() => setForm("newOrder")}
          />
          {!result || "error" in result ? (
            <PatientReadState styles={styles} error={result?.error} retry={reload} />
          ) : (
            <>
              <Action styles={styles} label={t("nativeTrade.refresh")} onPress={reload} />
              {!result.value.orders.length && (
                <Text style={styles.support}>{t("nativeTrade.noOrders")}</Text>
              )}
              {result.value.orders.map((o) => (
                <View style={styles.row} key={o.id}>
                  <Text style={styles.heading}>
                    {o.supplierName} · {t(`nativeTrade.status.${o.status}`)}
                  </Text>
                  <EventAuthor event={o} styles={styles} />
                  <Text selectable style={styles.support}>
                    {t("nativeTrade.orderId", { id: o.id })}
                  </Text>
                  <Action
                    styles={styles}
                    label={t("nativeTrade.openOrder")}
                    onPress={() => setSelected(o)}
                  />
                </View>
              ))}
              <Pager styles={styles} page={page} next={result.value.hasNextPage} change={setPage} />
            </>
          )}
        </>
      )}
    </View>
  );
}
function OrderDetail({
  order,
  back,
  refresh,
  notice,
  ...p
}: ClinicPatientProps & {
  order: Order;
  back: () => void;
  refresh: (notice?: Notice) => void;
  notice?: Notice;
}) {
  const { styles } = p,
    { t, i18n } = useTranslation(),
    [form, setForm] = useState<"receive" | ReceivedLine>(),
    [tab, setTab] = useState<"lines" | "receipts" | "returns">("lines");
  const receipts = useCallback(
    async (page: number) => {
      const r = await p.client.trade.receipts(p.scope, order.id, page);
      const names = await warehouseLabels(
        r.receipts.flatMap((receipt) => receipt.lines.map((l) => l.warehouseId)),
        (n) => p.client.inventory.warehouses(p.scope, n),
      );
      return {
        rows: r.receipts.map((receipt) => ({
          ...receipt,
          lines: receipt.lines.map((l) => ({
            ...l,
            warehouseName: names.get(l.warehouseId) ?? l.warehouseId,
          })),
        })),
        hasNextPage: r.hasNextPage,
      };
    },
    [p.client, p.scope, order.id],
  );
  const returns = useCallback(
    async (page: number) => {
      const r = await p.client.trade.returns(p.scope, order.id, page);
      const lines = await receiptMovements(
        r.returns.map((v) => v.receiptMovementId),
        (n) => p.client.trade.receipts(p.scope, order.id, n),
      );
      const names = await warehouseLabels(
        [...lines.values()].map((l) => l.warehouseId),
        (n) => p.client.inventory.warehouses(p.scope, n),
      );
      const rows = r.returns.map((entry) => {
        const line = lines.get(entry.receiptMovementId),
          item = order.lines.find((i) => i.itemId === line?.itemId);
        return {
          ...entry,
          itemName: item?.itemName,
          unit: item?.unit,
          warehouse: line && (names.get(line.warehouseId) ?? line.warehouseId),
          lot: line?.lot,
        };
      });
      return { rows, hasNextPage: r.hasNextPage };
    },
    [p.client, p.scope, order],
  );
  function close(n?: Notice) {
    setForm(undefined);
    if (n) refresh(n);
  }
  if (form === "receive") return <ReceiptForm {...p} order={order} close={close} />;
  if (form) return <ReturnForm {...p} order={order} line={form} close={close} />;
  return (
    <View style={styles.section}>
      <Action styles={styles} label={t("nativeTrade.backOrders")} onPress={back} />
      <Text accessibilityRole="header" style={styles.heading}>
        {order.supplierName} · {t(`nativeTrade.status.${order.status}`)}
      </Text>
      <Text selectable style={styles.support}>
        {t("nativeTrade.orderId", { id: order.id })}
      </Text>
      <EventAuthor event={order} styles={styles} />
      <TradeNotice styles={styles} notice={notice} />
      <Action styles={styles} label={t("nativeTrade.refresh")} onPress={() => refresh()} />
      {order.status !== "RECEIVED" && (
        <Action
          styles={styles}
          primary
          label={t("nativeTrade.receive")}
          onPress={() => setForm("receive")}
        />
      )}
      <View
        style={styles.actions}
        accessibilityRole="radiogroup"
        accessibilityLabel={t("nativeTrade.openOrder")}
      >
        {(["lines", "receipts", "returns"] as const).map((k) => (
          <Action
            key={k}
            styles={styles}
            role="radio"
            selected={tab === k}
            label={t(`nativeTrade.${k}`)}
            onPress={() => setTab(k)}
          />
        ))}
      </View>
      {tab === "lines" ? (
        order.lines.map((l) => (
          <View style={styles.row} key={l.itemId}>
            <Text style={styles.heading}>{l.itemName}</Text>
            <Text style={styles.support}>
              {t("nativeTrade.progress", {
                ordered: displayQuantity(l.quantity, i18n.language),
                received: displayQuantity(l.receivedQuantity, i18n.language),
                unit: l.unit,
              })}
            </Text>
          </View>
        ))
      ) : tab === "receipts" ? (
        <StockRows
          refreshLabel={t("nativeTrade.refresh")}
          styles={styles}
          load={receipts}
          empty={t("nativeTrade.noReceipts")}
          rowKey={(r) => r.id}
          render={(r) => (
            <>
              <EventAuthor event={r} styles={styles} />
              <Text selectable style={styles.support}>
                {t("nativeTrade.receiptId", { id: r.id })}
              </Text>
              {r.lines.map((l) => {
                const i = order.lines.find((o) => o.itemId === l.itemId);
                return (
                  <View key={l.movementId} style={styles.row}>
                    <Text style={styles.heading}>
                      {i?.itemName ?? l.itemId} · {displayQuantity(l.quantity, i18n.language)}{" "}
                      {i?.unit}
                    </Text>
                    <Text selectable style={styles.support}>
                      {t("nativeTrade.warehouseLot", {
                        warehouse: l.warehouseName,
                        lot: l.lot || t("nativeInventory.noLot"),
                      })}
                    </Text>
                    <Text selectable style={styles.support}>
                      {t("nativeInventory.movementId", { id: l.movementId })}
                    </Text>
                    <Action
                      styles={styles}
                      label={t("nativeTrade.returnLine")}
                      onPress={() => setForm(l)}
                    />
                  </View>
                );
              })}
            </>
          )}
        />
      ) : (
        <StockRows
          refreshLabel={t("nativeTrade.refresh")}
          styles={styles}
          load={returns}
          empty={t("nativeTrade.noReturns")}
          rowKey={(r) => r.id}
          render={(r) => (
            <>
              <Text style={styles.heading}>
                {r.itemName && r.itemName + " · "}
                {displayQuantity(r.quantity, i18n.language)} {r.unit} · {r.reason}
              </Text>
              <EventAuthor event={r} styles={styles} />
              {r.warehouse && (
                <Text style={styles.support}>
                  {t("nativeTrade.warehouseLot", {
                    warehouse: r.warehouse,
                    lot: r.lot || t("nativeInventory.noLot"),
                  })}
                </Text>
              )}
              <Text selectable style={styles.support}>
                {t("nativeTrade.originalMovement", { id: r.receiptMovementId })}
              </Text>
              <Text selectable style={styles.support}>
                {t("nativeInventory.movementId", { id: r.movementId })}
              </Text>
            </>
          )}
        />
      )}
    </View>
  );
}
function ReturnForm({
  order,
  line,
  close,
  ...p
}: ClinicPatientProps & { order: Order; line: ReceivedLine; close: Close }) {
  const { styles } = p,
    { t, i18n } = useTranslation(),
    [qty, setQty] = useState(""),
    [reason, setReason] = useState("");
  const load = useCallback(async () => {
    async function unreturned() {
      const prior: string[] = [];
      for (let page = 1; ; page++) {
        const r = await p.client.trade.returns(p.scope, order.id, page);
        prior.push(
          ...r.returns
            .filter((x) => x.receiptMovementId === line.movementId)
            .map((x) => x.quantity),
        );
        if (!r.hasNextPage) return remaining(line.quantity, prior);
      }
    }
    async function onHand() {
      for (let page = 1; ; page++) {
        const r = await p.client.inventory.balances(p.scope, line.warehouseId, page);
        const b = r.balances.find((x) => x.itemId === line.itemId && x.lot === line.lot);
        if (b || !r.hasNextPage) return b;
      }
    }
    const [left, stock] = await Promise.all([unreturned(), onHand()]);
    return { left, stock };
  }, [p.client, p.scope, order.id, line]);
  const { result, reload } = usePatientRead(load),
    save = useTradeSave<ReturnBody>(
      p.account,
      (id, body) => p.client.trade.returnStock(p.scope, order.id, id, body),
      close,
    );
  const data = result && "value" in result ? result.value : undefined,
    item = order.lines.find((l) => l.itemId === line.itemId),
    unit = item?.unit ?? "",
    available = data?.stock?.quantity ?? "0.000";
  const body = data && returnBody(line.movementId, qty, data.left, available, reason);
  return (
    <View style={styles.section}>
      <Action
        styles={styles}
        label={t("nativeTrade.backOrder")}
        disabled={save.busy}
        onPress={() => close()}
      />
      <Text style={styles.heading} accessibilityRole="header">
        {t("nativeTrade.returnLine")} · {item?.itemName ?? line.itemId}
      </Text>
      {!data ? (
        <PatientReadState
          styles={styles}
          retry={reload}
          error={result && "error" in result ? result.error : undefined}
        />
      ) : (
        <>
          <Text style={styles.support}>
            {t("nativeTrade.warehouseLot", {
              warehouse: data.stock?.warehouseName ?? line.warehouseId,
              lot: line.lot || t("nativeInventory.noLot"),
            })}
          </Text>
          <Text style={styles.support}>
            {t("nativeTrade.returnLimits", {
              remaining: displayQuantity(data.left, i18n.language),
              stock: displayQuantity(available, i18n.language),
              unit,
            })}
          </Text>
          <Text selectable style={styles.support}>
            {t("nativeTrade.originalMovement", { id: line.movementId })}
          </Text>
          <AmountField
            styles={styles}
            unit={unit}
            value={qty}
            onChange={setQty}
            locked={save.locked}
          />
          <Field
            styles={styles}
            label={t("nativeInventory.reason")}
            value={reason}
            maxLength={250}
            onChange={setReason}
            disabled={save.locked}
          />
          <ConfirmWrite
            styles={styles}
            state={save}
            valid={!!body}
            label={t("nativeTrade.confirmReturn")}
            submit={() => save.submit(body)}
          />
        </>
      )}
    </View>
  );
}
