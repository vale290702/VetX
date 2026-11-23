import { useCallback, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Action, Field, type AccessStyles } from "./controls";
import { Pager, PatientReadState, usePatientRead } from "./patient-controls";
import type { ClinicPatientProps } from "./patient-form";
import type { Item, Warehouse, Balance } from "./inventory-forms";
type Open = Pick<ClinicPatientProps, "scope" | "client" | "styles">;
export function StockRows<T>({
  styles,
  load,
  render,
  rowKey,
  empty,
}: {
  styles: AccessStyles;
  load: (page: number) => Promise<{ rows: T[]; hasNextPage: boolean }>;
  render: (row: T) => ReactNode;
  rowKey: (row: T) => string;
  empty: string;
}) {
  const { t } = useTranslation(),
    [page, setPage] = useState(1);
  const read = useCallback(() => load(page), [load, page]);
  const { result, reload } = usePatientRead(read);
  if (!result || "error" in result)
    return <PatientReadState styles={styles} error={result?.error} retry={reload} />;
  return (
    <View style={styles.section}>
      <Action styles={styles} label={t("nativeInventory.refresh")} onPress={reload} />
      {!result.value.rows.length && <Text style={styles.support}>{empty}</Text>}
      {result.value.rows.map((r) => (
        <View key={rowKey(r)} style={styles.row}>
          {render(r)}
        </View>
      ))}
      <Pager page={page} next={result.value.hasNextPage} styles={styles} change={setPage} />
    </View>
  );
}
export function Warehouses({
  scope,
  client,
  styles,
  render,
  exclude,
}: Open & { render: (w: Warehouse) => ReactNode; exclude?: string }) {
  const { t } = useTranslation();
  const load = useCallback(
    async (p: number) => {
      const r = await client.inventory.warehouses(scope, p);
      return { rows: r.warehouses.filter((w) => w.id !== exclude), hasNextPage: r.hasNextPage };
    },
    [scope, client, exclude],
  );
  return (
    <StockRows
      styles={styles}
      load={load}
      empty={t("nativeInventory.noWarehouses")}
      render={render}
      rowKey={(w) => w.id}
    />
  );
}
export function Items({
  scope,
  client,
  styles,
  render,
}: Open & { render: (i: Item) => ReactNode }) {
  const { t } = useTranslation(),
    [text, setText] = useState(""),
    [query, setQuery] = useState("");
  const load = useCallback(
    async (p: number) => {
      const r = await client.inventory.items(scope, p, query);
      return { rows: r.items, hasNextPage: r.hasNextPage };
    },
    [scope, client, query],
  );
  return (
    <View style={styles.section}>
      <Field
        styles={styles}
        label={t("nativeInventory.searchItems")}
        value={text}
        onChange={setText}
        maxLength={120}
        disabled={false}
      />
      <Action
        styles={styles}
        label={t("nativePatients.search")}
        onPress={() => setQuery(text.trim())}
      />
      <StockRows
        key={query}
        styles={styles}
        load={load}
        empty={t("nativeInventory.noItems")}
        render={render}
        rowKey={(i) => i.id}
      />
    </View>
  );
}
export function Balances({
  scope,
  client,
  styles,
  warehouseId,
  render,
  itemId,
}: Open & { warehouseId: string; itemId?: string; render: (b: Balance) => ReactNode }) {
  const { t } = useTranslation();
  const load = useCallback(
    async (p: number) => {
      const r = await client.inventory.balances(scope, warehouseId, p);
      return {
        rows: r.balances.filter((b) => !itemId || b.itemId === itemId),
        hasNextPage: r.hasNextPage,
      };
    },
    [scope, client, warehouseId, itemId],
  );
  return (
    <StockRows
      styles={styles}
      load={load}
      empty={t("nativeInventory.noBalances")}
      render={render}
      rowKey={(b) => b.itemId + ":" + b.lot}
    />
  );
}

export function InventoryAccessLost({ styles, back }: { styles: AccessStyles; back: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={styles.section}>
      <Text accessibilityRole="alert" style={styles.error}>
        {t("nativeInventory.denied")}
      </Text>
      <Action styles={styles} label={t("nativeInventory.backInventory")} onPress={back} />
    </View>
  );
}
